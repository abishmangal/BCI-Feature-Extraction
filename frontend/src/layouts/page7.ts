// Page 7: Feature matrix. val pieces are the matrix cells; scatter views pull each row into one dot.
import type { Layout } from '../engine/types';
import { COLORS, mix } from '../engine/colors';
import { type LayoutCtx, H, PAD, TOP, W, classColor, finish, setDecor } from './common';

export interface P7Geo {
  vx0: number;
  vx1: number;
  vy0: number;
  vy1: number;
  my0: number;
  rows: number;
  cellW: number;
  cellH: number;
  visibleCols: number;
  offset: number;
  px0: number;
  px1: number;
  strip: { x0: number; x1: number; y0: number; y1: number };
}

export function matrixInfo(c: LayoutCtx): { values: Float32Array | null; names: string[]; nFeat: number } {
  const ev = c.backendResults.evaluate;
  if (!ev) return { values: null, names: [], nFeat: 0 };
  const pre = c.settings.showPreSelection;
  return pre
    ? { values: ev.F, names: ev.preNames, nFeat: ev.preShape[1] }
    : { values: ev.Z, names: ev.names, nFeat: ev.shape[1] };
}

export function p7Geo(c: LayoutCtx): P7Geo {
  const w = W(c);
  const h = H(c);
  const vx0 = PAD + 18;
  const vx1 = Math.round(w * 0.6);
  const vy0 = TOP + 64; // room for the COMPUTING... banner under the page header
  const vy1 = h - 64;
  // tabs (20 px) / family brackets / rotated column names / matrix
  const my0 = vy0 + 136;
  const rows = Math.max(1, c.slots.val.trials.length);
  const nFeat = Math.max(1, c.slots.val.nFeatures);
  const vw = vx1 - vx0;
  const minW = 8;
  const visibleCols = Math.min(nFeat, Math.max(1, Math.floor(vw / minW)));
  const cellW = vw / visibleCols;
  const offset = Math.max(0, Math.min(c.ui.columnOffset, nFeat - visibleCols));
  return {
    vx0,
    vx1,
    vy0,
    vy1,
    my0,
    rows,
    cellW,
    cellH: (vy1 - my0) / rows,
    visibleCols,
    offset,
    px0: vx1 + 28,
    px1: w - PAD,
    strip: { x0: vx0, x1: vx1, y0: h - 54, y1: h - 8 },
  };
}

/** Per-column display scaling of the val trials' values to [0, 1] (single hue) or [-1, 1] (diverging). */
export function cellColor(v: number, lo: number, hi: number, diverging: boolean): number {
  if (!(hi > lo)) return COLORS.cream;
  if (diverging) {
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const t = Math.max(-1, Math.min(1, v / m));
    return t >= 0 ? mix(COLORS.cream, COLORS.teal, t) : mix(COLORS.cream, COLORS.accent, -t);
  }
  return mix(COLORS.cream, COLORS.teal, Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
}

export function scatterPoints(
  c: LayoutCtx,
): { xs: Float32Array; ys: Float32Array; lo: [number, number]; hi: [number, number] } | null {
  const ev = c.backendResults.evaluate;
  if (!ev) return null;
  const view = c.settings.view;
  let arr: Float32Array | null = null;
  if (view === 'scatter') arr = ev.scatterD;
  else if (view === 'pca') arr = ev.pca2D;
  else if (view === 'tsne') arr = ev.tsneD;
  if (!arr) return null;
  const n = arr.length / 2;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const lo: [number, number] = [Infinity, Infinity];
  const hi: [number, number] = [-Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    xs[i] = arr[2 * i];
    ys[i] = arr[2 * i + 1];
    lo[0] = Math.min(lo[0], xs[i]);
    hi[0] = Math.max(hi[0], xs[i]);
    lo[1] = Math.min(lo[1], ys[i]);
    hi[1] = Math.max(hi[1], ys[i]);
  }
  if (view === 'scatter' && ev.scatter.extent) {
    lo[0] = ev.scatter.extent[0];
    hi[0] = ev.scatter.extent[1];
    lo[1] = ev.scatter.extent[2];
    hi[1] = ev.scatter.extent[3];
  }
  for (const a of [0, 1] as const) if (!(hi[a] > lo[a])) hi[a] = lo[a] + 1;
  return { xs, ys, lo, hi };
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const d = c.data;
  const ev = c.backendResults.evaluate;
  if (!d) return finish(m, c);
  const g = p7Geo(c);
  const vs = c.slots.val;
  const T = vs.trials.length;
  const mi = matrixInfo(c);
  const view = c.settings.view;
  const dim = view === 'correlation' || view === 'distribution';
  const sp = scatterPoints(c);
  const pull = !!sp && (view === 'scatter' || view === 'pca' || view === 'tsne');
  const diverging =
    c.settings.normalise !== 'none' || c.settings.selectionSettings.projection.method !== 'none';
  const xName = c.settings.xFeature ?? ev?.scatter.x ?? null;
  const xCol = Math.max(0, xName ? mi.names.indexOf(xName) : 0);
  const sx = (v: number): number =>
    g.vx0 + 20 + ((v - sp!.lo[0]) / (sp!.hi[0] - sp!.lo[0])) * (g.vx1 - g.vx0 - 40);
  const sy = (v: number): number =>
    g.vy1 - 20 - ((v - sp!.lo[1]) / (sp!.hi[1] - sp!.lo[1])) * (g.vy1 - g.my0 - 40);
  if (c.ui.computingSpin) {
    // Results are being computed: the tiles orbit the view centre in a rotating spiral (the swirl is
    // re-targeted on every spinPhase tick and chased by the springs); the result then lands from here.
    const cx = (g.vx0 + g.vx1) / 2;
    const cy = (g.my0 + g.vy1) / 2 - 20;
    const R = Math.min(g.vx1 - g.vx0, g.vy1 - g.my0) * 0.45;
    const n = vs.trials.length * vs.nFeatures;
    const ph = c.ui.spinPhase;
    for (let s = 0; s < n; s++) {
      const t = vs.trials[s % Math.max(1, vs.trials.length)];
      const ring = (s % 89) / 89;
      const a = s * 2.39996 + ph * (0.55 + (1 - ring) * 0.5);
      const r = 18 + ring * R * (0.85 + 0.15 * Math.sin(ph * 0.7 + s));
      m.set(`val:${s}`, {
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r * 0.82,
        w: 6,
        h: 6,
        rotation: a,
        scaleX: 1,
        scaleY: 1,
        alpha: 0.85,
        color: classColor(d.labels[t]),
        extra: { marker: false },
      });
    }
  } else if (mi.values && vs.matrix !== 'none') {
    const nF = vs.nFeatures;
    for (let f = 0; f < nF; f++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let r = 0; r < T; r++) {
        const v = mi.values[vs.trials[r] * mi.nFeat + f];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const visible = f >= g.offset && f < g.offset + g.visibleCols;
      for (let r = 0; r < T; r++) {
        const t = vs.trials[r];
        const s = f * T + r;
        const cr = vs.classRank[r];
        const v = mi.values[t * mi.nFeat + f];
        const cx = g.vx0 + (f - g.offset + 0.5) * g.cellW;
        const cy = g.my0 + (cr + 0.5) * g.cellH;
        if (pull) {
          const px = sx(sp!.xs[t]);
          const py = sy(sp!.ys[t]);
          const keep = f === xCol;
          m.set(`val:${s}`, {
            x: px,
            y: py,
            w: 7,
            h: 7,
            rotation: 0,
            scaleX: keep ? 1 : 0,
            scaleY: keep ? 1 : 0,
            alpha: keep ? 1 : 0,
            color: classColor(d.labels[t]),
            extra: { marker: true },
          });
          continue;
        }
        m.set(`val:${s}`, {
          x: visible ? cx : g.vx1 + 4,
          y: cy,
          w: Math.max(1, g.cellW - (g.cellW > 4 ? 1 : 0)),
          h: Math.max(0.6, g.cellH),
          rotation: 0,
          scaleX: visible ? 1 : 0,
          scaleY: visible ? 1 : 0,
          alpha: visible ? (dim ? 0.15 : 1) : 0,
          color: cellColor(
            diverging ? v : v,
            diverging ? Math.min(lo, -Math.abs(hi)) : lo,
            diverging ? Math.max(hi, Math.abs(lo)) : hi,
            diverging,
          ),
          extra: { marker: false },
        });
      }
    }
  }
  // Hovered row: its source trial's filtered trace on the bottom signal strip.
  const hr = c.ui.hoverRow;
  const st = g.strip;
  m.set('wave:filtered', {
    x: (st.x0 + st.x1) / 2,
    y: (st.y0 + 17 + st.y1) / 2,
    w: st.x1 - st.x0,
    h: st.y1 - st.y0 - 17,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: hr !== null ? 1 : 0,
    color: hr !== null ? classColor(d.labels[hr]) : COLORS.ink,
    winStart: 0,
    winEnd: 1,
  });
  if (ev) {
    const visNames = mi.names.slice(g.offset, g.offset + g.visibleCols);
    const fams = (
      c.settings.showPreSelection
        ? ev.familyOf
        : ev.provenance.map((p) => ev.familyOf[ev.preNames.indexOf(p.sources[0])] ?? 'projection')
    ).slice(g.offset, g.offset + g.visibleCols);
    setDecor(m, 7, 'rowstrip', {
      alpha: pull ? 0 : 1,
      extra: {
        x: g.vx0 - 10,
        y0: g.my0,
        cellH: g.cellH,
        rows: vs.trials.map((t, r) => ({ cr: vs.classRank[r], color: classColor(d.labels[t]) })),
      },
    });
    setDecor(m, 7, 'colheads', {
      alpha: pull ? 0 : 1,
      extra: {
        x0: g.vx0,
        cellW: g.cellW,
        y: g.my0 - 4,
        names: visNames,
        offset: g.offset,
        total: mi.nFeat,
        infoY: g.vy0 + 26,
      },
    });
    setDecor(m, 7, 'brackets', {
      alpha: pull ? 0 : 1,
      extra: { x0: g.vx0, cellW: g.cellW, y: g.vy0 + 48, groups: groupRuns(fams) },
    });
    const pw = g.px1 - g.px0;
    setDecor(m, 7, 'gauge', {
      extra: {
        x: g.px0 + pw / 2,
        y: TOP + 152,
        r: Math.min(100, pw / 2 - 10),
        value: ev.accuracy.mean,
        std: ev.accuracy.std,
        chance: ev.chance,
        labelWidth: pw,
        label: c.settings.leakageGuard
          ? 'cross-validated accuracy (training folds only)'
          : 'cross-validated accuracy (leaky: all-data fit)',
        folds: ev.folds,
      },
    });
    const rank = ev.ranking.auc.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v || a.i - b.i);
    setDecor(m, 7, 'race', {
      extra: {
        x0: g.px0,
        x1: g.px1,
        y0: TOP + RACE_TOP,
        y1: H(c) - 170,
        bars: rank.slice(0, 14).map((o) => ({ name: ev.names[o.i], v: o.v })),
        xFeature: c.settings.xFeature,
      },
    });
    setDecor(m, 7, 'leak', {
      extra: {
        x0: g.px0,
        x1: g.px1,
        y0: H(c) - 160,
        y1: H(c) - 30,
        correct: ev.correct.mean,
        leaky: ev.leaky.mean,
        gap: ev.gapPoints,
        shown: c.ui.leakFlipped,
        noLearned: !ev.anyLearned,
      },
    });
    setDecor(m, 7, 'views', {
      extra: {
        x0: g.vx0,
        x1: g.vx1,
        y0: g.vy0,
        y1: g.vy1,
        my0: g.my0,
        traceLabel: hr === null ? null : `Filtered EEG · Trial ${hr + 1} · ${d.classNames[d.labels[hr]]}`,
        view,
        tabs: VIEW_TABS,
        scatter:
          pull && sp
            ? {
                lo: sp.lo,
                hi: sp.hi,
                x: view === 'scatter' ? ev.scatter.x : view === 'pca' ? 'PCA 1' : 't-SNE 1',
                y: view === 'scatter' ? ev.scatter.y : view === 'pca' ? 'PCA 2' : 't-SNE 2',
              }
            : null,
        decision:
          view === 'scatter'
            ? {
                boundary: ev.scatter.boundary ?? null,
                regions: ev.scatter.regions ?? null,
                accuracy: ev.scatter.accuracy,
                extent: ev.scatter.extent,
              }
            : null,
        correlation:
          view === 'correlation'
            ? { names: ev.correlation.names, matrix: c.backendResults.evaluate!.corrD }
            : null,
        distribution: view === 'distribution' ? distributionData(c, xCol) : null,
        tag:
          view === 'tsne'
            ? 't-SNE: display only, never a classifier input'
            : view === 'pca' || view === 'correlation' || view === 'distribution'
              ? ev.exploratoryTag
              : null,
        pre: c.settings.showPreSelection,
      },
    });
  }
  return finish(m, c);
}

/** Race panel offset below TOP (shared with the accessibility overlay). */
export const RACE_TOP = 232;

export const VIEW_TABS: { id: string; label: string }[] = [
  { id: 'matrix', label: 'Matrix' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'distribution', label: 'Class distribution' },
  { id: 'scatter', label: 'Scatter (2 features)' },
  { id: 'pca', label: 'PCA 2-D' },
  { id: 'tsne', label: 't-SNE (optional, display only)' },
];

function groupRuns(fams: string[]): { start: number; end: number; label: string }[] {
  const out: { start: number; end: number; label: string }[] = [];
  fams.forEach((f, i) => {
    const last = out[out.length - 1];
    if (last && last.label === f) last.end = i;
    else out.push({ start: i, end: i, label: f });
  });
  return out;
}

function distributionData(
  c: LayoutCtx,
  col: number,
): { name: string; values: number[]; labels: number[]; classNames: string[] } | null {
  const mi = matrixInfo(c);
  const d = c.data;
  if (!mi.values || !d) return null;
  const n = d.labels.length;
  const values: number[] = [];
  for (let t = 0; t < n; t++) values.push(mi.values[t * mi.nFeat + col]);
  return { name: mi.names[col] ?? '', values, labels: Array.from(d.labels), classNames: d.classNames };
}
