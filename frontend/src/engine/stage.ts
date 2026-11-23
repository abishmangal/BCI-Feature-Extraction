// PixiJS v8 stage (one Application, one canvas). Draws pieces from the spring state. No React.
import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Rectangle,
  Texture,
  type Renderer,
} from 'pixi.js';
import { P } from './springs';
import type { EngineCore } from './core';
import { createRibbonMesh, type RibbonMesh } from './ribbonShader';
import type { Kind } from './registry';
import { COLORS } from './colors';

export type MarkerName = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'star';
export const MARKERS: MarkerName[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'star'];
const MARKER_PX = 32;

export interface ContainerView {
  root: Container;
  /** Arbitrary per-view state owned by the painter. */
  state: Record<string, unknown>;
}

/** Painters draw low-count containers and decor from layout extras. Supplied by the app layer. */
export interface Painters {
  /** Build children once. */
  init(kind: Kind, id: string, view: ContainerView): void;
  /** Repaint from extras (called when extras change, data changes or stage size changes). */
  paint(
    kind: Kind,
    id: string,
    view: ContainerView,
    extra: Record<string, unknown> | undefined,
    reveal: number,
  ): void;
  /** Apply the animated colour (0xRRGGBB) to a container view. */
  tint?(kind: Kind, id: string, view: ContainerView, color: number): void;
  /** Size change of a container view (w, h springs), e.g. the electrode radius. */
  size?(kind: Kind, id: string, view: ContainerView, w: number, h: number): void;
  /** Per-frame animation hook for views that animate (card previews, odometer, gauge, typing). */
  animate?(kind: Kind, id: string, view: ContainerView, dtMs: number): boolean;
}

type ParticleKind = 'strip' | 'dot' | 'sine' | 'val';
const PARTICLE_KINDS: ParticleKind[] = ['strip', 'dot', 'sine', 'val'];
const MESH_KINDS: Kind[] = ['ribbon', 'env', 'wave'];
const DRIFT = new Set<Kind>(['ribbon', 'env', 'dot', 'val', 'sine', 'electrode', 'spark']);

export class Stage {
  app: Application | null = null;
  limited = false;
  private core: EngineCore;
  private painters: Painters;
  readonly camera = new Container({ label: 'camera' });
  readonly layers: Record<string, Container> = {};
  private meshes = new Map<number, RibbonMesh>();
  private particles = new Map<number, Particle>();
  private pcs: Record<ParticleKind, ParticleContainer> = {} as never;
  private views = new Map<number, ContainerView>();
  private sparkMeshes = new Map<number, RibbonMesh[]>();
  private lastReveal = new Float32Array(0);
  private lastColor = new Int32Array(0);
  private lastW = new Float32Array(0);
  private lastH = new Float32Array(0);
  textures: { white: Texture; markers: Record<MarkerName, Texture> } | null = null;
  ambientPaused = false;
  reduced = false;
  private dirtyAll = true;
  private animating = new Set<number>();
  onFrame: ((dtMs: number) => void) | null = null;
  width = 1280;
  height = 800;
  private initPromise: Promise<void> | null = null;
  private wallTime = 0;
  /** Card grid clip (page 5). */
  readonly cardMask = new Graphics();
  /** Per-kind marker texture index for particles, set by the app (dot/val markers). */
  markerOf: ((i: number) => MarkerName | null) | null = null;

  constructor(core: EngineCore, painters: Painters) {
    this.core = core;
    this.painters = painters;
  }

  init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit(canvas);
    return this.initPromise;
  }

  private async doInit(canvas: HTMLCanvasElement): Promise<void> {
    const app = new Application();
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || 1280;
    const h = parent?.clientHeight || 800;
    await app.init({
      canvas,
      width: w,
      height: h,
      preference: 'webgl',
      background: COLORS.cream,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoStart: false,
    });
    this.app = app;
    this.width = w;
    this.height = h;
    this.limited = (app.renderer as Renderer).name !== 'webgl';
    this.buildTextures();
    this.buildScene();
    app.ticker.add((t) => this.frame(t.deltaMS));
    app.ticker.start();
  }

  private buildTextures(): void {
    const cols = 8;
    const c = document.createElement('canvas');
    c.width = MARKER_PX * cols;
    c.height = MARKER_PX;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 4, 4); // white pixel block (use the centre pixel)
    const draw = (k: number, name: MarkerName): void => {
      const ox = (k + 1) * MARKER_PX;
      const cx = ox + MARKER_PX / 2;
      const cy = MARKER_PX / 2;
      const r = MARKER_PX / 2 - 3;
      g.beginPath();
      switch (name) {
        case 'circle':
          g.arc(cx, cy, r, 0, Math.PI * 2);
          break;
        case 'square':
          g.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
          break;
        case 'triangle':
          g.moveTo(cx, cy - r);
          g.lineTo(cx + r, cy + r * 0.8);
          g.lineTo(cx - r, cy + r * 0.8);
          g.closePath();
          break;
        case 'diamond':
          g.moveTo(cx, cy - r);
          g.lineTo(cx + r, cy);
          g.lineTo(cx, cy + r);
          g.lineTo(cx - r, cy);
          g.closePath();
          break;
        case 'cross': {
          const t = r * 0.38;
          g.moveTo(cx - t, cy - r);
          g.lineTo(cx + t, cy - r);
          g.lineTo(cx + t, cy - t);
          g.lineTo(cx + r, cy - t);
          g.lineTo(cx + r, cy + t);
          g.lineTo(cx + t, cy + t);
          g.lineTo(cx + t, cy + r);
          g.lineTo(cx - t, cy + r);
          g.lineTo(cx - t, cy + t);
          g.lineTo(cx - r, cy + t);
          g.lineTo(cx - r, cy - t);
          g.lineTo(cx - t, cy - t);
          g.closePath();
          break;
        }
        case 'star':
          for (let j = 0; j < 10; j++) {
            const rr = j % 2 === 0 ? r : r * 0.45;
            const a = -Math.PI / 2 + (j * Math.PI) / 5;
            if (j === 0) g.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
            else g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
          }
          g.closePath();
          break;
      }
      g.fill();
    };
    MARKERS.forEach((m, k) => draw(k, m));
    const base = Texture.from(c);
    base.source.scaleMode = 'linear';
    const white = new Texture({ source: base.source, frame: new Rectangle(1, 1, 1, 1) });
    const markers = {} as Record<MarkerName, Texture>;
    MARKERS.forEach((m, k) => {
      markers[m] = new Texture({
        source: base.source,
        frame: new Rectangle((k + 1) * MARKER_PX, 0, MARKER_PX, MARKER_PX),
      });
    });
    this.textures = { white, markers };
  }

  private buildScene(): void {
    const app = this.app!;
    const core = this.core;
    const reg = core.reg;
    const names = ['decorBack', 'ribbon', 'stripdot', 'valsine', 'elec', 'cards', 'decorFront'];
    for (const nm of names) {
      const c = new Container({ label: nm });
      this.layers[nm] = c;
      this.camera.addChild(c);
    }
    app.stage.addChild(this.camera);
    this.camera.addChild(this.cardMask);

    const tex = this.textures!;
    for (const k of PARTICLE_KINDS) {
      const pc = new ParticleContainer({
        texture: tex.white.source as never,
        dynamicProperties: { position: true, vertex: true, rotation: true, color: true, uvs: true },
      });
      // A particle container shares one base texture: the atlas.
      pc.texture = tex.white;
      this.pcs[k] = pc;
      (k === 'strip' || k === 'dot' ? this.layers.stripdot : this.layers.valsine).addChild(pc);
    }

    for (let i = 0; i < reg.n; i++) {
      const kind = reg.kinds[i];
      const id = reg.ids[i];
      if (MESH_KINDS.includes(kind)) {
        const rm = createRibbonMesh({
          fill: kind === 'wave' ? 0 : 0.35,
          // traces are drawn in the piece's own (class) colour, not black, so they do not cover the bands
          ink: 0,
          inkColor: COLORS.ink,
        });
        rm.mesh.visible = false;
        this.meshes.set(i, rm);
        (kind === 'wave' ? this.layers.valsine : this.layers.ribbon).addChild(rm.mesh);
      } else if ((PARTICLE_KINDS as Kind[]).includes(kind)) {
        // Spectrum bars grow from the baseline, so sine particles are anchored at the bottom.
        const p = new Particle({
          texture: tex.white,
          anchorX: 0.5,
          anchorY: kind === 'sine' ? 1 : 0.5,
          alpha: 0,
        });
        this.particles.set(i, p);
        this.pcs[kind as ParticleKind].addParticle(p);
      } else {
        const root = new Container({ label: id });
        root.visible = false;
        const view: ContainerView = { root, state: {} };
        if (kind === 'spark') {
          const list: RibbonMesh[] = [];
          for (let c = 0; c < 6; c++) {
            const rm = createRibbonMesh({ fill: 0, ink: 0, inkColor: COLORS.ink, thick: 0.6 });
            rm.mesh.visible = false;
            list.push(rm);
            root.addChild(rm.mesh);
          }
          this.sparkMeshes.set(i, list);
          view.state.meshes = list;
        }
        this.painters.init(kind, id, view);
        this.views.set(i, view);
        if (kind === 'decor') {
          const { name } = reg.decorInfo(i);
          (name === 'prism' || name === 'frame' ? this.layers.decorFront : this.layers.decorBack).addChild(
            root,
          );
        } else if (kind === 'electrode' || kind === 'spark') this.layers.elec.addChild(root);
        else this.layers.cards.addChild(root);
      }
    }
    for (const pc of Object.values(this.pcs)) pc.update();
    this.lastReveal = new Float32Array(reg.n).fill(-1);
    this.lastColor = new Int32Array(reg.n).fill(-1);
    this.lastW = new Float32Array(reg.n).fill(-1);
    this.lastH = new Float32Array(reg.n).fill(-1);
  }

  /** Static (non-animated) fill amount of a ribbon mesh: the class tint band is carried by channel 0. */
  setMeshFill(i: number, fill: number): void {
    const m = this.meshes.get(i);
    if (m) m.uniforms.uFill = fill;
  }
  /** Card layer clip (Page 5 grid and basket); null = whole stage. */
  setCardClip(rects: { x: number; y: number; w: number; h: number }[] | null): void {
    const g = this.cardMask;
    g.clear();
    const list = rects ?? [{ x: -10000, y: -10000, w: 30000, h: 30000 }];
    for (const r of list) g.rect(r.x, r.y, r.w, r.h).fill({ color: 0xffffff });
    this.layers.cards.mask = g;
  }
  /** Ribbon geometry update (dataset change only). */
  setMeshPoints(i: number, y: Float32Array | null): void {
    this.meshes.get(i)?.setPoints(y);
  }
  setSparkPoints(i: number, perClass: (Float32Array | null)[], colors: number[]): void {
    const list = this.sparkMeshes.get(i);
    if (!list) return;
    list.forEach((rm, c) => {
      const y = perClass[c] ?? null;
      rm.mesh.visible = !!y;
      if (y) {
        rm.setPoints(y);
        rm.mesh.tint = colors[c] ?? COLORS.ink;
      }
    });
  }
  getView(i: number): ContainerView | undefined {
    return this.views.get(i);
  }
  repaintAll(): void {
    this.dirtyAll = true;
    this.wake();
  }
  setAnimating(i: number, on: boolean): void {
    if (on) this.animating.add(i);
    else this.animating.delete(i);
    this.wake();
  }

  resize(w: number, h: number): void {
    if (!this.app) return;
    this.width = w;
    this.height = h;
    this.app.renderer.resize(w, h);
    this.dirtyAll = true;
    this.wake();
  }

  wake(): void {
    if (this.app && !this.app.ticker.started) this.app.ticker.start();
  }

  private frame(dtMs: number): void {
    const core = this.core;
    core.tick(dtMs, !this.reduced);
    this.wallTime += dtMs;
    this.onFrame?.(dtMs);
    this.writeAll(dtMs);
    this.applyCamera();
    const drifting = !this.ambientPaused && !this.reduced;
    if (core.allSettled() && !drifting && this.animating.size === 0 && !this.dirtyAll) {
      this.app!.ticker.stop();
      this.app!.render();
    }
  }

  private applyCamera(): void {
    const c = this.core.camera;
    const w = this.width;
    const h = this.height - 56;
    this.camera.pivot.set(w / 2, h / 2);
    this.camera.position.set(w / 2, h / 2);
    // Fake tilt: a 2-D squash plus a slight skew (forward tilts away top-first).
    const t = (c.tilt * Math.PI) / 180;
    this.camera.scale.set(c.scale, c.scale * Math.cos(t * 4));
    this.camera.skew.set(-t * 0.25, 0);
  }

  private writeAll(dtMs: number): void {
    const core = this.core;
    const s = core.springs;
    const reg = core.reg;
    const all = this.dirtyAll;
    const drift = !this.ambientPaused && !this.reduced;
    const tex = this.textures!;
    const extrasDirty = core.extrasDirty;
    let particlesChanged = false;
    const pos = s.pos;
    const phase = (this.wallTime / 8000) * Math.PI * 2;
    for (let i = 0; i < reg.n; i++) {
      const kind = reg.kinds[i];
      const needs = all || s.active[i] === 1 || extrasDirty.has(i) || (drift && DRIFT.has(kind));
      if (!needs) continue;
      const alpha = pos[P.alpha][i];
      const sx = pos[P.scaleX][i];
      const sy = pos[P.scaleY][i];
      const visible = alpha >= 0.01 && Math.abs(sx) > 1e-3 && Math.abs(sy) > 1e-3;
      let x = pos[P.x][i];
      let y = pos[P.y][i];
      if (drift && DRIFT.has(kind) && visible) {
        x += 1.5 * Math.sin(phase + i * 0.37);
        y += 1.5 * Math.cos(phase * 0.9 + i * 0.53);
      }
      const color =
        (Math.round(pos[P.r][i]) << 16) | (Math.round(pos[P.g][i]) << 8) | Math.round(pos[P.b][i]);
      const rm = this.meshes.get(i);
      if (rm) {
        const m = rm.mesh;
        m.visible = visible;
        if (!visible) continue;
        m.position.set(x, y);
        m.scale.set(pos[P.w][i] * sx, pos[P.h][i] * sy);
        m.rotation = pos[P.rotation][i];
        m.alpha = alpha;
        m.tint = color;
        rm.uniforms.uWinStart = pos[P.winStart][i];
        rm.uniforms.uWinEnd = pos[P.winEnd][i];
        continue;
      }
      const pt = this.particles.get(i);
      if (pt) {
        particlesChanged = true;
        if (!visible) {
          pt.alpha = 0;
          pt.scaleX = 0;
          pt.scaleY = 0;
          continue;
        }
        const w = pos[P.w][i] * sx;
        const h = pos[P.h][i] * sy;
        const small = w < 3 && h < 3;
        const marker = !small && this.markerOf ? this.markerOf(i) : null;
        const t = marker ? tex.markers[marker] : tex.white;
        if (pt.texture !== t) pt.texture = t;
        const base = marker ? MARKER_PX : 1;
        pt.x = x;
        pt.y = y;
        pt.scaleX = w / base;
        pt.scaleY = h / base;
        pt.rotation = pos[P.rotation][i];
        pt.alpha = alpha;
        pt.tint = color;
        continue;
      }
      const view = this.views.get(i);
      if (view) {
        const root = view.root;
        root.visible = visible;
        if (extrasDirty.has(i) || all) {
          this.painters.paint(kind, reg.ids[i], view, core.extras[i], pos[P.reveal][i]);
          this.lastReveal[i] = pos[P.reveal][i];
        } else if (Math.abs(pos[P.reveal][i] - this.lastReveal[i]) > 0.004) {
          this.painters.paint(kind, reg.ids[i], view, core.extras[i], pos[P.reveal][i]);
          this.lastReveal[i] = pos[P.reveal][i];
        }
        if (!visible) continue;
        const pv = (core.extras[i]?.pivot as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
        root.pivot.set(pv.x, pv.y);
        root.position.set(x + pv.x, y + pv.y);
        root.scale.set(sx, sy);
        root.rotation = pos[P.rotation][i];
        root.alpha = alpha;
        const pw = pos[P.w][i];
        const ph = pos[P.h][i];
        if (
          this.painters.size &&
          (all || Math.abs(pw - this.lastW[i]) > 0.01 || Math.abs(ph - this.lastH[i]) > 0.01)
        ) {
          this.lastW[i] = pw;
          this.lastH[i] = ph;
          this.painters.size(kind, reg.ids[i], view, pw, ph);
        }
        if (this.painters.tint && this.lastColor[i] !== color) {
          this.lastColor[i] = color;
          this.painters.tint(kind, reg.ids[i], view, color);
        }
        if (kind === 'spark') {
          const list = this.sparkMeshes.get(i)!;
          const w = pos[P.w][i];
          const h = pos[P.h][i];
          for (const sm of list) {
            sm.mesh.position.set(w / 2, 0);
            sm.mesh.scale.set(w, h);
          }
        }
      }
    }
    if (this.animating.size && this.painters.animate) {
      for (const i of this.animating) {
        const v = this.views.get(i);
        if (v && !this.painters.animate(reg.kinds[i], reg.ids[i], v, dtMs)) this.animating.delete(i);
      }
    }
    extrasDirty.clear();
    this.dirtyAll = false;
    // Particle properties are all declared dynamic, so no update() call is needed per frame.
    void particlesChanged;
  }

  /** Identity check of every piece's display object (created once at startup, never replaced). */
  pieceSignature(): { count: number; attached: number; ids: number } {
    let count = 0;
    let attached = 0;
    let ids = 0;
    const pcs = Object.values(this.pcs);
    for (const [, m] of this.meshes) {
      count++;
      ids = (ids + m.mesh.uid) % 1e9;
      if (m.mesh.parent) attached++;
    }
    for (const [, v] of this.views) {
      count++;
      ids = (ids + v.root.uid) % 1e9;
      if (v.root.parent) attached++;
    }
    for (const [, pt] of this.particles) {
      count++;
      if (pcs.some((pc) => pc.particleChildren.includes(pt))) attached++;
    }
    return { count, attached, ids };
  }

  /** Visible piece count (for performance reporting). */
  visibleCount(): number {
    let n = 0;
    for (let i = 0; i < this.core.reg.n; i++) if (this.core.isVisible(i)) n++;
    return n;
  }
  fps(): number {
    return this.app ? this.app.ticker.FPS : 0;
  }
}
