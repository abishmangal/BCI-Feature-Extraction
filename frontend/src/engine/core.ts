// Headless engine core: registry + springs + transitions + camera + clock. No Pixi, no React.
import { Registry } from './registry';
import { SpringSystem, P, NPROP, FLAVORS, SUBSTEP, type FlavorName } from './springs';
import type { Layout, TargetState } from './types';
import {
  FORWARD,
  getRule,
  transitionMode,
  type Mode,
  type Rule,
  type TEnv,
  type TransitionDef,
  type TransitionHelpers,
} from './transitions';
import { NON_ADJACENT_PLAN, rankDelay, maxRanks, type OrderTables, type StaggerPlan } from './stagger';

const FIELD_PROPS: [keyof TargetState, number][] = [
  ['x', P.x],
  ['y', P.y],
  ['w', P.w],
  ['h', P.h],
  ['rotation', P.rotation],
  ['scaleX', P.scaleX],
  ['scaleY', P.scaleY],
  ['alpha', P.alpha],
  ['cornerRadius', P.cornerRadius],
  ['reveal', P.reveal],
  ['winStart', P.winStart],
  ['winEnd', P.winEnd],
];

export function encodeTarget(t: TargetState, out: Float32Array): number {
  let mask = 0;
  for (const [f, p] of FIELD_PROPS) {
    const v = t[f] as number | undefined;
    if (v !== undefined) {
      out[p] = v;
      mask |= 1 << p;
    }
  }
  if (t.color !== undefined) {
    out[P.r] = (t.color >> 16) & 255;
    out[P.g] = (t.color >> 8) & 255;
    out[P.b] = t.color & 255;
    mask |= (1 << P.r) | (1 << P.g) | (1 << P.b);
  }
  return mask;
}

export interface CameraState {
  scale: number;
  tilt: number; // degrees, positive = forward (top away from viewer)
  vScale: number;
  vTilt: number;
  tScale: number;
  tTilt: number;
  releaseAt: number;
}

export interface ApplyOptions {
  from: number;
  to: number;
  reduced: boolean;
  helpers: TransitionHelpers;
  tables: OrderTables;
  /** In-page change (same page, settings changed). */
  inPage?: boolean;
  initial?: boolean;
  dragging?: boolean;
  /** Page-internal choreography (Page 1 load states): forward-style rules, no camera. */
  custom?: TransitionDef | null;
}

export class EngineCore {
  readonly reg = new Registry();
  readonly springs = new SpringSystem(this.reg.n);
  /** Engine clock in ms (advances in fixed substeps). */
  now = 0;
  private acc = 0;
  readonly extras: (Record<string, unknown> | undefined)[];
  private readonly pendingExtras: (Record<string, unknown> | undefined)[];
  /** Pieces whose extras changed since the renderer last looked. */
  readonly extrasDirty: Set<number> = new Set();
  readonly camera: CameraState = {
    scale: 1,
    tilt: 0,
    vScale: 0,
    vTilt: 0,
    tScale: 1,
    tTilt: 0,
    releaseAt: 0,
  };
  lastMode: Mode = 'initial';
  lastMaxDelay = 0;
  private readonly buf = new Float32Array(NPROP);
  private readonly vbuf = new Float32Array(NPROP);

  constructor() {
    this.extras = new Array(this.reg.n);
    this.pendingExtras = new Array(this.reg.n);
    this.springs.onDelayEnd = (i) => {
      const ex = this.pendingExtras[i];
      if (ex !== undefined) {
        this.extras[i] = ex;
        this.pendingExtras[i] = undefined;
        this.extrasDirty.add(i);
      }
    };
  }

  get(i: number, p: number): number {
    return this.springs.pos[p][i];
  }

  isVisible(i: number): boolean {
    const s = this.springs;
    return (
      s.pos[P.alpha][i] >= 0.01 && Math.abs(s.pos[P.scaleX][i]) > 1e-3 && Math.abs(s.pos[P.scaleY][i]) > 1e-3
    );
  }

  private teleport(i: number, start: Partial<TargetState>): void {
    const mask = encodeTarget(start as TargetState, this.vbuf);
    for (let p = 0; p < NPROP; p++)
      if (mask & (1 << p)) {
        this.springs.pos[p][i] = this.vbuf[p];
        this.springs.vel[p][i] = 0;
      }
  }

  /** Apply a layout. Returns the longest delay used (ms). */
  apply(layout: Layout, o: ApplyOptions): number {
    const reg = this.reg;
    const s = this.springs;
    const n = reg.n;
    const mode: Mode = o.initial
      ? 'initial'
      : o.custom && !o.reduced
        ? 'forward'
        : o.inPage
          ? o.reduced
            ? 'reduced'
            : 'inpage'
          : transitionMode(o.from, o.to, o.reduced);
    this.lastMode = mode;
    if (mode === 'initial') {
      for (let i = 0; i < n; i++) {
        const t = layout.get(reg.ids[i]);
        if (!t) throw new Error(`layout is missing a target for ${reg.ids[i]}`);
        const mask = encodeTarget(t, this.buf);
        for (let p = 0; p < NPROP; p++) if (mask & (1 << p)) s.setNow(i, p, this.buf[p]);
        s.phase[i] = 0;
        s.viaMask[i] = 0;
        s.pendingVia[i] = 0;
        this.extras[i] = t.extra;
        this.extrasDirty.add(i);
      }
      this.lastMaxDelay = 0;
      return 0;
    }

    let def: TransitionDef | null = null;
    let plan: StaggerPlan | null = null;
    let reverse = false;
    if (o.custom && mode === 'forward') {
      def = o.custom;
      plan = def.plan;
    } else if (mode === 'forward') {
      def = FORWARD[`${o.from}->${o.to}`] ?? null;
      plan = def?.plan ?? null;
    } else if (mode === 'backward') {
      def = FORWARD[`${o.to}->${o.from}`] ?? null;
      plan = def?.plan ?? null;
      reverse = true;
    } else if (mode === 'nonadjacent') {
      plan = NON_ADJACENT_PLAN;
    }

    const cur =
      (i: number) =>
      (prop: keyof TargetState): number => {
        const idx = FIELD_PROPS.find((f) => f[0] === prop)?.[1];
        return idx === undefined ? 0 : s.pos[idx][i];
      };

    // First pass: rules (needed to mirror offsets for backward moves).
    const rules: (Rule | null)[] = new Array(n).fill(null);
    let maxOffset = 0;
    for (let i = 0; i < n; i++) {
      const id = reg.ids[i];
      const final = layout.get(id);
      if (!final) throw new Error(`layout is missing a target for ${id}`);
      if (mode === 'forward' || mode === 'backward') {
        const kind = reg.kinds[i];
        const di = kind === 'decor' ? reg.decorInfo(i) : null;
        const env: TEnv = {
          i,
          kind,
          decorName: di ? di.name : null,
          decorPage: di ? di.page : 0,
          reg,
          final,
          cur: cur(i),
          h: o.helpers,
        };
        const r = def ? def.rule(env) : null;
        rules[i] = r;
        const off = r?.offsetMs ?? 0;
        if (off > maxOffset) maxOffset = off;
      }
    }
    const mr = plan && reverse ? maxRanks(plan, reg, o.tables) : undefined;

    let longest = 0;
    for (let i = 0; i < n; i++) {
      const final = layout.get(reg.ids[i])!;
      const mask = encodeTarget(final, this.buf);
      let delay = 0;
      let flavor: FlavorName = 'snappy';
      let scaleFlavor: FlavorName | undefined;
      let via: { values: Float32Array; mask: number; maxMs: number; minHoldMs: number } | null = null;
      if (mode === 'inpage') flavor = 'snappy';
      else if (mode === 'reduced') flavor = 'reduced';
      else if (mode === 'nonadjacent') {
        const kind = reg.kinds[i];
        const leaving = (final.alpha ?? 1) < 0.01 || final.scaleX === 0 || final.scaleY === 0;
        if (leaving) flavor = 'snappy';
        else if (kind === 'decor') {
          flavor = 'reveal';
          delay = this.isVisible(i) ? 0 : 300;
        } else {
          flavor = 'soft';
          delay = plan ? rankDelay(plan, reg, i, o.tables) : 0;
        }
      } else {
        const listed = rules[i];
        const r = listed ?? getRule(null, null as never);
        const off = (r.offsetMs ?? 0) + (r.extraMs ?? 0);
        const staggered = r.stagger !== false && plan ? rankDelay(plan, reg, i, o.tables, reverse, mr) : 0;
        if (reverse) {
          // Backward: plan reversed, kind offsets mirrored, flavor soft, no via, no start poses.
          flavor = 'soft';
          // Mirrored kind offsets are halved to keep backward moves inside the ~1.8 s budget (5.7.1).
          delay = listed
            ? staggered + 0.5 * (maxOffset - (r.offsetMs ?? 0)) + 0.5 * (r.extraMs ?? 0)
            : staggered;
        } else {
          flavor = r.flavor;
          scaleFlavor = r.scaleFlavor;
          delay = staggered + off;
          if (r.start && (r.forceStart || !this.isVisible(i))) this.teleport(i, r.start);
          if (r.via) {
            const vm = encodeTarget({ x: 0, y: 0, ...r.via } as TargetState, this.vbuf);
            // encodeTarget always marks x and y because of the spread defaults; keep only provided fields.
            let m = vm;
            if (r.via.x === undefined) m &= ~(1 << P.x);
            if (r.via.y === undefined) m &= ~(1 << P.y);
            via = {
              values: Float32Array.from(this.vbuf),
              mask: m,
              maxMs: r.viaMaxMs ?? 260,
              minHoldMs: r.viaMinHoldMs ?? 0,
            };
          }
        }
      }
      if (delay > longest) longest = delay;
      this.pendingExtras[i] = final.extra;
      // Backend results that arrive during a page transition must not cut its choreography short.
      if ((mode === 'inpage' || mode === 'reduced') && !o.custom && s.updateFinal(i, this.buf, mask)) {
        if (s.phase[i] === 2) {
          // Delay already over (in the via pose): extras apply now.
          this.extras[i] = final.extra;
          this.pendingExtras[i] = undefined;
          this.extrasDirty.add(i);
        }
        continue;
      }
      s.retarget(
        i,
        this.buf,
        mask,
        this.now,
        delay,
        FLAVORS[flavor],
        via,
        scaleFlavor ? FLAVORS[scaleFlavor] : null,
      );
    }
    this.lastMaxDelay = longest;
    // Camera pulse (5.5): not for in-page changes, dragging or reduced motion.
    if ((mode === 'forward' || mode === 'backward' || mode === 'nonadjacent') && !o.dragging && !o.custom) {
      const dir = o.to > o.from ? 1 : -1;
      this.camera.tScale = 1.06;
      this.camera.tTilt = 2.5 * dir;
      this.camera.releaseAt = this.now + Math.max(120, 0.4 * longest);
    }
    return longest;
  }

  /** Advance the clock by dtMs of wall time, in fixed substeps. Returns substeps run. */
  tick(dtMs: number, cameraEnabled = true): number {
    this.acc += Math.min(dtMs, 100);
    let steps = 0;
    const sub = SUBSTEP * 1000;
    while (this.acc >= sub && steps < 12) {
      this.acc -= sub;
      this.now += sub;
      this.springs.step(this.now);
      this.stepCamera(cameraEnabled);
      steps++;
    }
    return steps;
  }

  private stepCamera(enabled: boolean): void {
    const c = this.camera;
    if (!enabled) {
      c.scale = 1;
      c.tilt = 0;
      c.vScale = c.vTilt = 0;
      c.tScale = 1;
      c.tTilt = 0;
      return;
    }
    if (this.now >= c.releaseAt) {
      c.tScale = 1;
      c.tTilt = 0;
    }
    const k = 40;
    const d = 2 * Math.sqrt(k);
    const dt = SUBSTEP;
    c.vScale += (-k * (c.scale - c.tScale) - d * c.vScale) * dt;
    c.scale += c.vScale * dt;
    c.vTilt += (-k * (c.tilt - c.tTilt) - d * c.vTilt) * dt;
    c.tilt += c.vTilt * dt;
    c.tilt = Math.max(-4, Math.min(4, c.tilt));
  }

  cameraIdle(): boolean {
    const c = this.camera;
    return (
      Math.abs(c.scale - 1) < 1e-4 &&
      Math.abs(c.tilt) < 1e-3 &&
      Math.abs(c.vScale) < 1e-4 &&
      Math.abs(c.vTilt) < 1e-3
    );
  }

  allSettled(): boolean {
    return this.springs.activeCount === 0 && this.cameraIdle();
  }
}

export type { Mode };
