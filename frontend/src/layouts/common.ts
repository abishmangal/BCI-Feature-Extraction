// Shared pure helpers for the page layouts. No React, no Pixi, no current piece positions.
import { Registry, type Kind } from '../engine/registry';
import type { Layout, StageSize, TargetState } from '../engine/types';
import type { Data, Results, Settings, Ui } from '../store/store';
import type { Preset } from '../api/types';
import { CLASS_COLORS } from '../engine/colors';

export const REG = new Registry();
export const TOP = 132; // below the DOM page header
export const PAD = 32;

export interface ValSlots {
  /** Trials shown in the val pool (original indices, original order). */
  trials: number[];
  /** Class-order rank of each val trial (rows sorted by class). */
  classRank: number[];
  nFeatures: number;
  /** Which matrix the val pieces map to on this page. */
  matrix: 'F' | 'Z' | 'none';
}

export interface CtxSlots {
  /** Displayed trials for ribbons / env / strip / dot (original indices). */
  shown: number[];
  shownClassRank: number[];
  nCh: number;
  val: ValSlots;
}

export interface LayoutCtx {
  data: Data | null;
  paradigm: Preset;
  settings: Settings;
  ui: Ui;
  stageSize: StageSize;
  backendResults: Results;
  slots: CtxSlots;
  /** Page currently laid out (layouts may use page-specific parking). */
  page: number;
}

export const W = (c: LayoutCtx): number => c.stageSize.width;
export const H = (c: LayoutCtx): number => c.stageSize.stageHeight;
export const classColor = (k: number): number => CLASS_COLORS[k % CLASS_COLORS.length];

export function park(kind: Kind, c: LayoutCtx): TargetState {
  const w = W(c);
  const h = H(c);
  const base = { scaleX: 0, scaleY: 0, alpha: 0 };
  switch (kind) {
    case 'dot':
      return { x: w, y: h, ...base };
    case 'electrode':
    case 'spark':
      return { x: w / 2, y: 0, ...base };
    case 'sine':
    case 'wave':
    case 'val':
      return { x: w / 2, y: h, ...base };
    case 'card':
      return { x: -130, y: h / 2, ...base };
    case 'chip':
      return { x: 0, y: h / 2, ...base };
    case 'decor':
      return { x: 0, y: 0, alpha: 0, reveal: 0, scaleX: 1, scaleY: 1 };
    default:
      return { x: 0, y: h / 2, ...base };
  }
}

/** Fill every id that the page did not set with its default parking pose. */
export function finish(m: Layout, c: LayoutCtx): Layout {
  for (let i = 0; i < REG.n; i++) {
    const id = REG.ids[i];
    if (!m.has(id)) m.set(id, park(REG.kinds[i], c));
  }
  return m;
}

export function setDecor(
  m: Layout,
  page: number,
  name: string,
  t: Partial<TargetState> & { extra?: Record<string, unknown> },
): void {
  m.set(`decor:${page}:${name}`, {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    reveal: 1,
    ...t,
  });
}

// -------------------------------------------------------------------------------------------
// Trial and feature dimensions shown in the pipeline rail.
export function shapes(c: Pick<LayoutCtx, 'data' | 'settings' | 'backendResults'>): (number[] | null)[] {
  const d = c.data;
  const r = c.backendResults;
  if (!d) return [null, null, null, null, null, null, null, null];
  const n = d.shape[0];
  const s1 = d.shape;
  // Real shapes after the crop and channel choice, computed from the data's own time vector so the rail
  // updates immediately (downstream backend results are fetched lazily).
  const { start, end } = c.settings.window;
  let ns = 0;
  for (let i = 0; i < d.times.length; i++) if (d.times[i] >= start - 1e-9 && d.times[i] < end - 1e-9) ns++;
  const s2 = [n, d.shape[1], ns];
  const s3 = [n, c.settings.channels.length, ns];
  const s4 = s3;
  const s5 = r.features?.shape ?? null;
  const s7 = r.evaluate?.shape ?? null;
  return [s1, s2, s3, s4, s5, s5, s7, null];
}

// -------------------------------------------------------------------------------------------
// Time axis helpers (section 3.1)
export function tickStep(t0: number, t1: number): number {
  const count = (s: number): number => Math.floor(t1 / s + 1e-9) - Math.ceil(t0 / s - 1e-9) + 1;
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5]) if (count(s) <= 10) return s;
  return 5;
}
export function ticks(t0: number, t1: number): number[] {
  const s = tickStep(t0, t1);
  const out: number[] = [];
  for (let t = Math.ceil(t0 / s - 1e-9) * s; t <= t1 + 1e-9; t += s) out.push(Math.round(t / s) * s);
  return out;
}
export function windowSnap(epochLen: number): number {
  return epochLen <= 1.5 ? 0.05 : 0.1;
}
export function minWindow(epochLen: number): number {
  return epochLen >= 2.5 ? 0.5 : 0.2;
}
export function epochSpan(d: Data): { t0: number; t1: number; len: number } {
  const t0 = d.times[0];
  const t1 = d.times[d.times.length - 1];
  return { t0, t1, len: t1 - t0 + 1 / d.sfreq };
}
export function freqMax(sfreq: number): number {
  return Math.min(45, 0.9 * (sfreq / 2));
}
