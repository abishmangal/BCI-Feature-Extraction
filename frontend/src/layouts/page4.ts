// Page 4: Frequency band. Spectrum landscape of 0.5 Hz bars (sine pieces), class curves, gate, waveform panel.
import type { Layout } from '../engine/types';
import { COLORS } from '../engine/colors';
import { POOL } from '../engine/registry';
import { type LayoutCtx, H, PAD, TOP, W, finish, freqMax, setDecor } from './common';

export const NAMED = [
  { name: 'delta', low: 0.5, high: 4 },
  { name: 'theta', low: 4, high: 8 },
  { name: 'alpha', low: 8, high: 13 },
  { name: 'mu', low: 8, high: 12 },
  { name: 'beta', low: 13, high: 30 },
  { name: 'gamma', low: 30, high: 45 },
];

export interface P4Geo {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  fmax: number;
  fx: (f: number) => number;
  nBins: number;
  binF: (k: number) => number;
  prism: { x: number; y: number; exitX: number; entryX: number };
  wave: { x0: number; x1: number; y0: number; y1: number };
}

export function p4Geo(c: LayoutCtx): P4Geo {
  const w = W(c);
  const h = H(c);
  const wide = w >= 760;
  const spectrumControls = Math.min(450, w * 0.36);
  const exampleControls = Math.min(208, Math.max(148, w * 0.17));
  const x0 = wide ? PAD + 46 : PAD + 18;
  const x1 = w - (wide ? spectrumControls + 32 : 24);
  const y0 = TOP + 26;
  const waveBottom = h - 18;
  // Match the control deck's lower row, at half the previous waveform height.
  const waveHeight = Math.max(110, (waveBottom - y0) * 0.215 - 16);
  const waveTop = wide ? waveBottom - waveHeight : TOP + 806;
  const y1 = wide ? waveTop - 56 : TOP + 194;
  const fmax = freqMax(c.data?.sfreq ?? 250);
  const nBins = Math.min(POOL.sine, Math.floor((fmax - 1) / 0.5) + 1);
  const fx = (f: number): number => x0 + ((f - 1) / (fmax - 1)) * (x1 - x0);
  const px = (x0 + x1) / 2;
  const py = (y0 + y1) / 2;
  return {
    x0,
    x1,
    y0,
    y1,
    fmax,
    fx,
    nBins,
    binF: (k) => 1 + 0.5 * k,
    prism: { x: px, y: py, entryX: px - 22, exitX: px + 22 },
    wave: {
      x0: wide ? exampleControls + 32 : PAD,
      x1: w - 24,
      y0: waveTop,
      y1: wide ? waveBottom : waveTop + Math.max(110, (waveBottom - (TOP + 868)) / 2),
    },
  };
}

export function dbRange(c: LayoutCtx): [number, number] {
  const b = c.backendResults.band;
  if (!b) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  const arrs = [...b.psdD, ...(b.baseD ? [b.baseD] : [])];
  for (const a of arrs)
    for (let i = 0; i < a.length; i++) {
      lo = Math.min(lo, a[i]);
      hi = Math.max(hi, a[i]);
    }
  if (!isFinite(lo) || hi <= lo) return [0, 1];
  return [lo - 1, hi + 1];
}

/** Bar height in dB: mean over the shown classes. */
export function barDb(c: LayoutCtx, k: number): number | null {
  const b = c.backendResults.band;
  if (!b) return null;
  const shown = c.settings.showClasses;
  let s = 0;
  let n = 0;
  b.psdD.forEach((a, cls) => {
    if (shown.includes(cls) && k < a.length) {
      s += a[k];
      n++;
    }
  });
  return n ? s / n : null;
}

export function inBand(c: LayoutCtx, f: number): boolean {
  return f >= c.settings.band.low - 1e-9 && f <= c.settings.band.high + 1e-9;
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const d = c.data;
  if (!d) return finish(m, c);
  const g = p4Geo(c);
  const [lo, hi] = dbRange(c);
  const ph = g.y1 - g.y0;
  const bw = Math.max(1, ((g.x1 - g.x0) / g.nBins) * 0.55);
  for (let k = 0; k < g.nBins; k++) {
    const f = g.binF(k);
    const db = barDb(c, k);
    const hpx = db === null ? 1 : Math.max(1, ((db - lo) / (hi - lo)) * (ph / 1.15)); // room for the 1.15x gate
    const on = inBand(c, f);
    m.set(`sine:${k}`, {
      x: g.fx(f),
      y: g.y1,
      w: bw,
      h: hpx,
      rotation: 0,
      scaleX: 1,
      scaleY: on ? 1.15 : 0.35,
      alpha: on ? 1 : 0.35,
      color: COLORS.ink,
    });
  }
  // Sparks collapse onto the centre line at the prism entrance (3 -> 4 exit pose).
  d.channels.forEach((_, i) =>
    m.set(`spark:${i}`, {
      x: g.prism.entryX,
      y: g.prism.y,
      w: 2,
      h: 20,
      scaleX: 1,
      scaleY: 1,
      alpha: 0,
      rotation: 0,
    }),
  );
  const band = c.backendResults.band;
  const wv = g.wave;
  const wcx = (wv.x0 + wv.x1) / 2;
  const wh = (wv.y1 - wv.y0) * 0.8;
  m.set('wave:raw', {
    x: wcx,
    y: (wv.y0 + wv.y1) / 2 + 6,
    w: wv.x1 - wv.x0,
    h: wh,
    scaleX: 1,
    scaleY: 1,
    alpha: band ? 0.4 : 0,
    color: COLORS.grey,
    winStart: 0,
    winEnd: 1,
    rotation: 0,
  });
  m.set('wave:filtered', {
    x: wcx,
    y: (wv.y0 + wv.y1) / 2 + 6,
    w: wv.x1 - wv.x0,
    h: wh,
    scaleX: 1,
    scaleY: 1,
    alpha: band ? 1 : 0,
    color: COLORS.ink,
    winStart: 0,
    winEnd: 1,
    rotation: 0,
  });

  const fTicks: { x: number; label: string }[] = [];
  for (let f = 5; f <= g.fmax + 1e-9; f += 5) fTicks.push({ x: g.fx(f), label: `${f}` });
  const dbTicks: { y: number; label: string }[] = [];
  const step = niceStep(hi - lo);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step)
    dbTicks.push({ y: g.y1 - ((v - lo) / (hi - lo)) * ph, label: `${Math.round(v)}` });
  setDecor(m, 4, 'axes', { extra: { x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1, fTicks, dbTicks } });
  const named = c.settings.showAllBands ? NAMED : c.paradigm.keyBands;
  const regions = named
    .map((b) => ({
      x0: g.fx(Math.max(1, b.low)),
      x1: g.fx(Math.min(g.fmax, b.high)),
      label: `${b.name} ${b.low}-${b.high}`,
    }))
    .filter((r) => r.x1 > r.x0);
  const stim = (c.paradigm.stimulusFrequencies ?? []).flatMap((f, k) =>
    [f, 2 * f]
      .filter((v) => v <= g.fmax)
      .map((v, j) => ({ x: g.fx(v), label: `${d.classNames[k]}${j ? ' 2f' : ''}` })),
  );
  setDecor(m, 4, 'bands', { extra: { regions, stim, y0: g.y0, y1: g.y1 } });
  const bx0 = g.fx(Math.max(1, c.settings.band.low));
  const bx1 = g.fx(Math.min(g.fmax, c.settings.band.high));
  setDecor(m, 4, 'gate', { extra: { x0: bx0, x1: bx1, y0: g.y0 - 10, y1: g.y1 } });
  setDecor(m, 4, 'handles', {
    extra: {
      x0: bx0,
      x1: bx1,
      y0: g.y0 - 14,
      y1: g.y1 + 4,
      low: c.settings.band.low,
      high: c.settings.band.high,
    },
  });
  // Class curves, reference curve and the gap fill.
  const curves: { color: number; pts: number[] }[] = [];
  let ref: number[] | null = null;
  if (band) {
    const toPts = (a: Float32Array): number[] => {
      const out: number[] = [];
      for (let k = 0; k < Math.min(a.length, g.nBins); k++)
        out.push(g.fx(g.binF(k)), g.y1 - ((a[k] - lo) / (hi - lo)) * ph);
      return out;
    };
    band.psdD.forEach((a, cls) => {
      if (c.settings.showClasses.includes(cls)) curves.push({ color: cls, pts: toPts(a) });
    });
    if (band.baseD && c.settings.baselineVisible && d.baseline) ref = toPts(band.baseD);
  }
  setDecor(m, 4, 'fill', { extra: { curves, ref } });
  const ex = band?.example;
  setDecor(m, 4, 'wavepanel', {
    extra: {
      ...wv,
      label: ex
        ? `Trial ${ex.trial + 1} · ${ex.channel}`
        : 'Example waveform',
      note: 'Raw (grey) · Filtered (ink)',
    },
  });
  setDecor(m, 4, 'prism', { alpha: 0, reveal: 0, extra: { x: g.prism.x, y: g.prism.y } });
  return finish(m, c);
}

export function niceStep(span: number): number {
  for (const s of [1, 2, 5, 10, 20, 50]) if (span / s <= 6) return s;
  return 100;
}
