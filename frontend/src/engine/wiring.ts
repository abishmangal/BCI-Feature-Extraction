// Wiring between the vanilla store and the engine (no React). The engine reads settings through the
// vanilla Zustand store, calls the pure layouts, and retargets springs.
import { Graphics } from 'pixi.js';
import { Engine } from './index';
import { createPainters } from './painters';
import type { TransitionDef } from './transitions';
import { PLANS } from './stagger';
import { CLASS_MARKERS } from './colors';
import { POOL, FAMILY_IDS } from './registry';
import { RIBBON_POINTS } from './ribbonShader';
import { classOrderRank, stratifiedSubset } from './slots';
import { P } from './springs';
import { store, get, set, emptyPreset, type AppState } from '../store/store';
import { layoutFor, helpersFor, tablesFor } from '../layouts';
import { REG, railNodes, type CtxSlots, type LayoutCtx } from '../layouts/common';
import { p5Geo } from '../layouts/page5';
import { p1Stack } from '../layouts/page1';
import { p7Geo } from '../layouts/page7';
import type { MarkerName } from './stage';

export const engine = new Engine<LayoutCtx>();

// -------------------------------------------------------------------------------------------
export function computeSlots(s: AppState): CtxSlots {
  const d = s.data;
  if (!d)
    return {
      shown: [],
      shownClassRank: [],
      nCh: 0,
      val: { trials: [], classRank: [], nFeatures: 0, matrix: 'none' },
    };
  const K = d.classNames.length;
  let shown = d.display.trials;
  if (shown.length > s.shownTrialsLimit) {
    const lab = shown.map((t) => d.labels[t]);
    shown = stratifiedSubset(lab, s.shownTrialsLimit, K).map((k) => shown[k]);
  }
  const ev = s.results.evaluate;
  let nF = 0;
  let matrix: 'F' | 'Z' | 'none' = 'none';
  if (s.page >= 7 && ev) {
    nF = s.settings.showPreSelection ? ev.preShape[1] : ev.shape[1];
    matrix = s.settings.showPreSelection ? 'F' : 'Z';
  } else if (s.results.features?.shape) {
    nF = s.results.features.shape[1];
    matrix = 'F';
  }
  const n = d.labels.length;
  const tv = nF > 0 ? Math.min(n, Math.floor(POOL.val / nF)) : 0;
  const trials = tv > 0 ? stratifiedSubset(d.labels, tv, K) : [];
  return {
    shown,
    shownClassRank: classOrderRank(shown, d.labels),
    nCh: d.channels.length,
    val: { trials, classRank: classOrderRank(trials, d.labels), nFeatures: trials.length ? nF : 0, matrix },
  };
}

export function buildCtx(): LayoutCtx {
  const s = get();
  return {
    data: s.data,
    paradigm: s.data?.preset ?? emptyPreset(),
    settings: s.settings,
    ui: s.ui,
    stageSize: engine.stageSize(),
    backendResults: s.results,
    slots: computeSlots(s),
    page: s.page,
  };
}

function resample(a: ArrayLike<number>, n = RIBBON_POINTS, scale = 1): Float32Array {
  const out = new Float32Array(n);
  const m = a.length;
  if (!m) return out;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * (m - 1);
    const j = Math.floor(u);
    const f = u - j;
    const v = j + 1 < m ? a[j] * (1 - f) + a[j + 1] * f : a[m - 1];
    out[i] = Math.max(-0.5, Math.min(0.5, v * scale));
  }
  return out;
}
function maxAbs(...arrs: ArrayLike<number>[]): number {
  let m = 0;
  for (const a of arrs) for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m || 1;
}

// -------------------------------------------------------------------------------------------
let meshKey = '';
let sparkKey = '';
let waveKey = '';

function prepare(c: LayoutCtx): void {
  const core = engine.core;
  const stage = engine.stage!;
  const reg = core.reg;
  const d = c.data;
  const sl = c.slots;
  const [ra, rb] = reg.range('ribbon');
  const [ea] = reg.range('env');
  const [sa, sb] = reg.range('strip');
  const [da] = reg.range('dot');
  const [ela] = reg.range('electrode');
  const [spa] = reg.range('spark');
  const [va, vb] = reg.range('val');
  const [ca] = reg.range('card');
  // Mesh geometry: rebuilt only when the dataset (or the displayed subset) changes.
  const mk = d ? `${d.version}:${sl.shown.length}` : 'empty';
  if (mk !== meshKey) {
    meshKey = mk;
    const disp = d?.display;
    const idxOf = new Map<number, number>();
    disp?.trials.forEach((t, k) => idxOf.set(t, k));
    for (let i = ra; i < rb; i++) {
      const s = i - ra;
      const r = sl.nCh ? Math.floor(s / sl.nCh) : -1;
      const ch = sl.nCh ? s % sl.nCh : 0;
      if (d && disp && r >= 0 && r < sl.shown.length) {
        const k = idxOf.get(sl.shown[r])!;
        const off = (k * sl.nCh + ch) * disp.points;
        stage.setMeshPoints(i, resample(disp.ribbons.subarray(off, off + disp.points)));
        stage.setMeshFill(i, ch === 0 ? 0.35 : 0);
      } else {
        stage.setMeshPoints(i, null);
        stage.setMeshFill(i, 0);
      }
    }
    for (let r = 0; r < POOL.env; r++) {
      if (d && disp && r < sl.shown.length) {
        const k = idxOf.get(sl.shown[r])!;
        stage.setMeshPoints(ea + r, resample(disp.env.subarray(k * disp.points, (k + 1) * disp.points)));
      } else stage.setMeshPoints(ea + r, null);
    }
  }
  // Group keys (stagger by meaning).
  reg.gTrialRank.fill(-1);
  reg.gClassRank.fill(-1);
  reg.gChannel.fill(-1);
  reg.gFeature.fill(-1);
  reg.gClass.fill(-1);
  if (d) {
    for (let i = ra; i < rb; i++) {
      const s = i - ra;
      const r = Math.floor(s / Math.max(1, sl.nCh));
      if (r < sl.shown.length) {
        reg.gTrialRank[i] = r;
        reg.gClassRank[i] = sl.shownClassRank[r];
        reg.gChannel[i] = s % sl.nCh;
        reg.gClass[i] = d.labels[sl.shown[r]];
      }
    }
    for (let i = sa; i < sb; i++) {
      const rib = ra + Math.floor((i - sa) / 2);
      reg.gTrialRank[i] = reg.gTrialRank[rib];
      reg.gClassRank[i] = reg.gClassRank[rib];
      reg.gChannel[i] = reg.gChannel[rib];
    }
    for (let r = 0; r < sl.shown.length && r < POOL.env; r++) {
      reg.gTrialRank[ea + r] = reg.gTrialRank[da + r] = r;
      reg.gClassRank[ea + r] = reg.gClassRank[da + r] = sl.shownClassRank[r];
    }
    for (let ch = 0; ch < d.channels.length; ch++) {
      reg.gChannel[ela + ch] = ch;
      reg.gChannel[spa + ch] = ch;
    }
    const T = sl.val.trials.length;
    for (let i = va; i < vb; i++) {
      const s = i - va;
      if (T && s < T * sl.val.nFeatures) {
        reg.gFeature[i] = Math.floor(s / T);
        reg.gTrialRank[i] = s % T;
        reg.gClassRank[i] = sl.val.classRank[s % T];
      }
    }
    FAMILY_IDS.forEach((_, k) => (reg.gFeature[ca + k] = k));
  }
  // Sparklines: one class-mean trace per shown class.
  const chRes = c.backendResults.channels;
  const sk = chRes ? `${chRes.hash}:${c.settings.showClasses.join(',')}:${d?.version}` : '';
  if (d && chRes && sk !== sparkKey) {
    sparkKey = sk;
    const K = d.classNames.length;
    const sp = chRes.spark;
    const colors = d.classNames.map(
      (_, k) => [0xc4623d, 0x1f6f78, 0xb58b2a, 0x7a4e7e, 0x6b7a3a, 0xa8586b][k % 6],
    );
    for (let ch = 0; ch < d.channels.length; ch++) {
      const per: (Float32Array | null)[] = [];
      for (let k = 0; k < K; k++) {
        if (!c.settings.showClasses.includes(k)) per.push(null);
        else per.push(resample(sp.subarray((ch * K + k) * 60, (ch * K + k + 1) * 60)));
      }
      stage.setSparkPoints(spa + ch, per, colors);
    }
  }
  // Example waveforms (Page 4) and the hovered-trial strip (Page 7).
  const [wa] = reg.range('wave');
  if (c.page === 7) {
    const ev = c.backendResults.evaluate;
    const hr = c.ui.hoverRow;
    const wk = `7:${ev?.hash}:${hr}`;
    if (wk !== waveKey && ev && hr !== null) {
      waveKey = wk;
      const pts = ev.stripD.subarray(hr * 100, (hr + 1) * 100);
      stage.setMeshPoints(wa + 1, resample(pts, RIBBON_POINTS, 0.5 / maxAbs(pts)));
    }
  } else {
    const b = c.backendResults.band;
    const wk = `4:${b?.hash}:${b?.example.trial}:${b?.example.channel}`;
    if (wk !== waveKey && b) {
      waveKey = wk;
      const sc = 0.5 / maxAbs(b.raw, b.filt);
      stage.setMeshPoints(wa, resample(b.raw, RIBBON_POINTS, sc));
      stage.setMeshPoints(wa + 1, resample(b.filt, RIBBON_POINTS, sc));
    }
  }
  // Markers: dots always carry the class marker; val cells only in scatter views.
  const labels = d?.labels;
  stage.markerOf = (i: number): MarkerName | null => {
    if (!labels) return null;
    const kind = reg.kinds[i];
    if (kind === 'dot') {
      const r = i - da;
      return r < sl.shown.length ? (CLASS_MARKERS[labels[sl.shown[r]] % 6] as MarkerName) : null;
    }
    if (kind === 'val' && core.extras[i]?.marker) {
      const r = reg.gTrialRank[i];
      return r >= 0 ? (CLASS_MARKERS[labels[sl.val.trials[r]] % 6] as MarkerName) : null;
    }
    return null;
  };
  // Clip the card layer to the grid and basket on Page 5.
  if ((c.page === 5 || c.page === 6) && d) {
    // Page 6 keeps the grid clip so the card list slides away inside it during 5 -> 6.
    const g = p5Geo({ ...c, page: 5 });
    stage.setCardClip([{ x: g.gx0 - 6, y: g.gy0 - 6, w: g.gw + 12, h: g.gh + 12 }]);
  } else stage.setCardClip(null);
  // Animated views.
  for (let k = 0; k < 12; k++) stage.setAnimating(ca + k, c.page === 5);
  stage.setAnimating(reg.index.get('decor:5:odometer')!, c.page === 5);
  stage.setAnimating(reg.index.get('decor:7:gauge')!, c.page === 7);
  stage.setAnimating(reg.index.get('decor:7:race')!, c.page === 7);
  stage.setAnimating(reg.index.get('decor:8:codepanel')!, c.page === 8);
  stage.ambientPaused = c.ui.ambientPaused;
}

// -------------------------------------------------------------------------------------------
// Page-internal choreography (section 5.7.4 and the Page 8 phase).
function loadDef(kind: 'pour' | 'drop' | 'replace', c: LayoutCtx): TransitionDef {
  const st = p1Stack(c);
  const lineY = c.stageSize.stageHeight / 2;
  return {
    plan: PLANS['1->2'], // stagger by trial, 8 ms
    rule: (e) => {
      if (e.kind === 'decor' && e.decorName === 'droptext') return { flavor: 'snappy', stagger: false };
      if (e.kind !== 'ribbon') return null;
      if (kind === 'pour')
        // Ribbons start above the stage top edge over their final column and fall into the stack.
        return {
          flavor: 'fall',
          forceStart: true,
          start: { x: e.final.x, y: -40, w: e.final.w, h: e.final.h, rotation: 0, winStart: 0, winEnd: 1 },
        };
      if (kind === 'replace') return { flavor: 'soft', via: { y: -40 }, viaMaxMs: 320 };
      // CSV / NPZ: the flat line draws itself left to right, then thickens into the stack.
      return {
        flavor: 'soft',
        start: null,
        via: {
          y: lineY,
          h: 0,
          winEnd: 1,
          x: c.stageSize.width * 0.2 + ((e.final.y - st.y0) / st.h) * c.stageSize.width * 0.6,
        },
        viaMinHoldMs: 600,
        viaMaxMs: 600,
      };
    },
  };
}

function chipsDef(): TransitionDef {
  return {
    plan: { groupBy: 'trial', order: 'ascending', delayPerGroupMs: 0, maxTotalDelayMs: 0 },
    rule: (e) =>
      e.kind === 'chip'
        ? { flavor: 'soft', stagger: false, extraMs: 120 * (e.i - REG.range('chip')[0]) }
        : null,
  };
}

// -------------------------------------------------------------------------------------------
// Pipeline-rail change ripple: a pooled pulse (accent dot with a fading trail), 120 ms per node.
const ripple = { g: null as Graphics | null, from: 0, t0: 0, active: false };
function drawRipple(now: number): void {
  const g = ripple.g;
  if (!g) return;
  g.clear();
  if (!ripple.active) return;
  const c = buildCtx();
  const nodes = railNodes(c);
  const el = now - ripple.t0;
  const from = ripple.from - 1;
  const pos = from + el / 120;
  if (pos >= 7.6 || from >= 7) {
    ripple.active = false;
    return;
  }
  const at = (p: number): { x: number; y: number } => {
    const k = Math.max(0, Math.min(7, Math.floor(p)));
    const f = Math.min(1, p - k);
    const a = nodes[k];
    const b = nodes[Math.min(7, k + 1)];
    return { x: a.x + (b.x - a.x) * f, y: a.y - 2 };
  };
  for (let k = 0; k < 6; k++) {
    const p = pos - k * 0.06;
    if (p < from) break;
    const q = at(Math.min(7, p));
    g.circle(q.x, q.y, 4 - k * 0.5).fill({ color: 0x2a9d8f, alpha: 1 - k * 0.16 });
  }
  for (let n = from + 1; n <= Math.min(7, Math.floor(pos)); n++) {
    const fl = Math.max(0, 1 - (pos - n) * 2);
    if (fl > 0)
      g.circle(nodes[n].x, nodes[n].y - 2, 22).stroke({ width: 2, color: 0x2a9d8f, alpha: fl * 0.6 });
  }
}

// -------------------------------------------------------------------------------------------
let wired = false;
let pending = 0;

export function wireEngine(): void {
  if (wired) return;
  wired = true;
  engine.configure({
    ctx: buildCtx,
    layout: (page, ctx) => layoutFor(page, ctx),
    helpers: helpersFor,
    tables: tablesFor,
    painters: createPainters(),
    prepare: (ctx) => prepare(ctx),
    reduced: () => get().ui.reduceMotion,
  });
  const schedule = (): void => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      engine.refresh();
    });
  };
  store.subscribe((s, prev) => {
    if (s.page !== prev.page) {
      if (pending) {
        cancelAnimationFrame(pending);
        pending = 0;
      }
      engine.navigate(s.page);
      if (prev.page === 8) {
        // leaving and returning to Page 8 replays the connector animation
        const v = engine.stage?.getView(REG.index.get('decor:8:codepanel')!);
        if (v) v.state.codeVer = '';
      }
      return;
    }
    if (
      s.data !== prev.data &&
      s.data &&
      s.data.version !== prev.data?.version &&
      s.page === 1 &&
      s.ui.loadAnim !== 'none'
    ) {
      if (pending) {
        cancelAnimationFrame(pending);
        pending = 0;
      }
      engine.applyCustom(loadDef(s.ui.loadAnim, buildCtx()));
      set({ ui: { ...get().ui, loadAnim: 'none' } });
      return;
    }
    if (s.ui.exportPhase !== prev.ui.exportPhase && s.page === 8 && s.ui.exportPhase === 'chips-in-panel') {
      engine.applyCustom(chipsDef());
      return;
    }
    if (s.ripple.seq !== prev.ripple.seq && !s.ui.reduceMotion) {
      ripple.from = s.ripple.from;
      ripple.t0 = performance.now();
      ripple.active = true;
      engine.wake();
    }
    if (
      s.settings !== prev.settings ||
      s.results !== prev.results ||
      s.data !== prev.data ||
      s.ui !== prev.ui ||
      s.shownTrialsLimit !== prev.shownTrialsLimit
    ) {
      engine.dragging = s.ui.draggingWindow;
      schedule();
    }
  });
  engine.onFrame(() => {
    const st = engine.stage;
    if (!st) return;
    if (!ripple.g) {
      ripple.g = new Graphics();
      st.railLayer.addChild(ripple.g);
    }
    drawRipple(performance.now());
    if (ripple.active) st.setAnimating(-1, true);
    else st.setAnimating(-1, false);
  });
}

/** True when the connector lines and the binary stream have finished (the code may appear). */
export function chipsArrived(): boolean {
  if (get().ui.reduceMotion) return true;
  const v = engine.stage?.getView(REG.index.get('decor:8:codepanel')!);
  return !!v?.state.codeReady;
}

/** Current spring pose of a piece (for the accessibility overlay). */
export function poseOf(
  id: string,
): { x: number; y: number; w: number; h: number; sx: number; sy: number; alpha: number } | null {
  const i = engine.core.reg.index.get(id);
  if (i === undefined) return null;
  const p = engine.core.springs.pos;
  return {
    x: p[P.x][i],
    y: p[P.y][i],
    w: p[P.w][i],
    h: p[P.h][i],
    sx: p[P.scaleX][i],
    sy: p[P.scaleY][i],
    alpha: p[P.alpha][i],
  };
}

/** Matrix row under a stage point (Page 7), or null. */
export function matrixRowAt(x: number, y: number): number | null {
  const c = buildCtx();
  if (!c.data || c.settings.view !== 'matrix') return null;
  const g = p7Geo(c);
  if (x < g.vx0 || x > g.vx1 || y < g.my0 || y > g.vy1) return null;
  const cr = Math.floor((y - g.my0) / g.cellH);
  const r = c.slots.val.classRank.indexOf(cr);
  return r >= 0 ? c.slots.val.trials[r] : null;
}

/** Trial row under a stage point (Page 1 stack), or null. */
export function stackTrialAt(x: number, y: number): number | null {
  const c = buildCtx();
  if (!c.data) return null;
  const st = p1Stack(c);
  if (x < st.x - st.w / 2 || x > st.x + st.w / 2 || y < st.y0 || y > st.y0 + st.h) return null;
  const r = Math.floor((y - st.y0) / st.rowH);
  return c.slots.shown[r] ?? null;
}
