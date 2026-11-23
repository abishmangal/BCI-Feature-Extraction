// Page 1: Load data. Empty state = one flat line of collapsed ribbons; loaded = the trial stack.
import type { Layout } from '../engine/types';
import { COLORS } from '../engine/colors';
import { POOL } from '../engine/registry';
import { type LayoutCtx, H, TOP, W, classColor, finish, setDecor } from './common';

export function p1Stack(c: LayoutCtx): { x: number; y0: number; w: number; h: number; rowH: number } {
  const w = W(c) * 0.7;
  const h = Math.min(520, H(c) - TOP - 40);
  const y0 = (TOP + H(c)) / 2 - h / 2;
  const m = Math.max(1, c.slots.shown.length);
  return { x: W(c) / 2, y0, w, h, rowH: h / m };
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const d = c.data;
  if (!d || d.status === 'empty') {
    const x0 = W(c) * 0.2;
    const len = W(c) * 0.6;
    const seg = len / POOL.ribbon;
    const y = H(c) / 2;
    for (let s = 0; s < POOL.ribbon; s++) {
      m.set(`ribbon:${s}`, {
        x: x0 + (s + 0.5) * seg,
        y,
        w: seg,
        h: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        color: COLORS.ink,
        winStart: 0,
        winEnd: 1,
      });
    }
    setDecor(m, 1, 'droptext', {
      alpha: 1,
      extra: { text: 'Drop a CSV here, or pour the sample data', x: W(c) / 2, y: y + 28 },
    });
    return finish(m, c);
  }
  const st = p1Stack(c);
  const nCh = c.slots.nCh;
  const shown = c.slots.shown;
  const hover = c.ui.hoverTrial;
  const faint = Math.min(1, 3 / Math.max(1, nCh)) * 0.6;
  for (let r = 0; r < shown.length; r++) {
    const t = shown[r];
    const y = st.y0 + (r + 0.5) * st.rowH;
    const col = classColor(d.labels[t]);
    const hl = hover === t;
    for (let ch = 0; ch < nCh; ch++) {
      const s = r * nCh + ch;
      if (s >= POOL.ribbon) break;
      m.set(`ribbon:${s}`, {
        x: st.x,
        y,
        w: st.w,
        h: st.rowH * 0.92,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        alpha: ch === 0 ? 1 : hl ? 1 : faint,
        color: hl ? COLORS.accent : col,
        winStart: 0,
        winEnd: 1,
      });
    }
  }
  setDecor(m, 1, 'droptext', { alpha: 0, extra: { text: '', x: 0, y: 0 } });
  return finish(m, c);
}
