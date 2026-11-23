// Page 2: Time window. Trials as class-sorted bands; outside-window samples compress into 4 px strips.
import type { Layout } from '../engine/types';
import { desaturate } from '../engine/colors';
import { POOL } from '../engine/registry';
import { type LayoutCtx, H, PAD, TOP, W, classColor, epochSpan, finish, setDecor, ticks } from './common';

export interface P2Geo {
  bx0: number;
  bx1: number;
  by0: number;
  by1: number;
  rowH: number;
  rowTop: (classRank: number) => number;
  /** time (s) -> x (px) under the current mapping */
  xOf: (t: number) => number;
  mesh: { cx: number; w: number; u0: number; u1: number };
  mini: { x0: number; y0: number; width: number; height: number };
  warped: boolean;
}

export function p2Geo(c: LayoutCtx): P2Geo {
  const w = W(c);
  const h = H(c);
  const controlsWidth = Math.min(530, w * 0.42);
  const wide = w >= 860;
  const split = wide ? (TOP + h) / 2 : TOP + 300;
  const probeWidth = Math.min(850, w * 0.68);
  const bx0 = PAD + 14;
  const bx1 = w - controlsWidth - 18;
  const by0 = TOP + 4;
  const by1 = split - 30;
  const plotX = wide ? probeWidth + 62 : 62;
  const plotY = split + (wide ? 32 : w >= 560 ? 270 : 570);
  const d = c.data!;
  const K = d.classNames.length;
  const M = Math.max(1, c.slots.shown.length);
  const gap = 6;
  const rowH = Math.max(0.5, (by1 - by0 - gap * (K - 1)) / M);
  // class group offsets
  const counts = new Array<number>(K).fill(0);
  for (const t of c.slots.shown) counts[d.labels[t]]++;
  const starts: number[] = [];
  let acc = 0;
  for (let k = 0; k < K; k++) {
    starts.push(acc);
    acc += counts[k];
  }
  const classOfRank = (r: number): number => {
    let k = 0;
    while (k + 1 < K && r >= starts[k + 1]) k++;
    return k;
  };
  const rowTop = (r: number): number => by0 + r * rowH + classOfRank(r) * gap;
  const { t0, len } = epochSpan(d);
  const ws = c.settings.window.start;
  const we = c.settings.window.end;
  const u0 = Math.max(0, (ws - t0) / len);
  const u1 = Math.min(1, (we - t0) / len);
  // The whole epoch is always visible; the window is a frame you slide and resize (no zoom).
  const warped = false;
  let xOf: (t: number) => number;
  let mesh: P2Geo['mesh'];
  if (warped) {
    const L = bx0 + 4;
    const R = bx1 - 4;
    const S = (R - L) / Math.max(1e-6, u1 - u0);
    const tEnd = t0 + len;
    xOf = (t: number): number => {
      if (t < ws) return bx0 + (4 * (t - t0)) / Math.max(1e-9, ws - t0);
      if (t > we) return R + (4 * (t - we)) / Math.max(1e-9, tEnd - we);
      return L + ((t - t0) / len - u0) * S;
    };
    mesh = { cx: L - u0 * S + S / 2, w: S, u0, u1 };
  } else {
    xOf = (t: number): number => bx0 + ((t - t0) / len) * (bx1 - bx0);
    mesh = { cx: (bx0 + bx1) / 2, w: bx1 - bx0, u0: 0, u1: 1 };
    void u0;
    void u1;
  }
  return {
    bx0,
    bx1,
    by0,
    by1,
    rowH,
    rowTop,
    xOf,
    mesh,
    mini: {
      x0: plotX,
      y0: plotY,
      width: Math.max(1, w - plotX - PAD),
      height: Math.max(1, h - plotY - 59),
    },
    warped,
  };
}

export function probeRange(px: Float32Array, py: Float32Array): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < px.length; i++) {
    lo = Math.min(lo, px[i], py[i]);
    hi = Math.max(hi, px[i], py[i]);
  }
  if (!isFinite(lo) || hi <= lo) return [0, 1];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const d = c.data;
  if (!d) return finish(m, c);
  const g = p2Geo(c);
  const nCh = c.slots.nCh;
  const shown = c.slots.shown;
  for (let r = 0; r < shown.length; r++) {
    const t = shown[r];
    const cr = c.slots.shownClassRank[r];
    const top = g.rowTop(cr);
    const y = top + g.rowH / 2;
    const col = classColor(d.labels[t]);
    m.set(`env:${r}`, {
      x: g.mesh.cx,
      y,
      w: g.mesh.w,
      h: g.rowH * 0.92,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 0.9,
      color: col,
      winStart: g.mesh.u0,
      winEnd: g.mesh.u1,
    });
    for (let ch = 0; ch < nCh; ch++) {
      const s = r * nCh + ch;
      if (s >= POOL.ribbon) break;
      m.set(`ribbon:${s}`, {
        x: g.mesh.cx,
        y,
        w: g.mesh.w,
        h: g.rowH,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        alpha: 0.05,
        color: col,
        winStart: g.mesh.u0,
        winEnd: g.mesh.u1,
      });
      const sh = g.rowH / nCh;
      for (let side = 0; side < 2; side++) {
        m.set(`strip:${s * 2 + side}`, {
          x: side === 0 ? g.bx0 + 2 : g.bx1 - 2,
          y: top + (ch + 0.5) * sh,
          w: 4,
          h: Math.max(0.5, sh),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          alpha: g.warped ? 0.4 : 0,
          color: desaturate(col),
        });
      }
    }
  }
  // Probe scatter points keep their trial identity across window and class changes.
  const res = c.backendResults.window;
  const mini = g.mini;
  const probeClasses = c.settings.probeClasses;
  const scoreMatches = res?.probeClasses
    ? probeClasses.join() === res.probeClasses.join()
    : probeClasses.length === d.classNames.length;
  const [lo, hi] = res ? probeRange(res.px, res.py) : [0, 1];
  if (res) {
    const classes = new Set(probeClasses);
    for (let r = 0; r < shown.length; r++) {
      const t = shown[r];
      if (!classes.has(d.labels[t])) continue;
      const vx = res.px[t];
      const vy = res.py[t];
      m.set(`dot:${r}`, {
        x: mini.x0 + ((vx - lo) / (hi - lo)) * mini.width,
        y: mini.y0 + (1 - (vy - lo) / (hi - lo)) * mini.height,
        w: 6,
        h: 6,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        color: classColor(d.labels[t]),
      });
    }
  }
  const { t0, t1 } = epochSpan(d);
  const ws = c.settings.window.start;
  const we = c.settings.window.end;
  const tk = ticks(t0, t1)
    .filter((t) => !g.warped || (t >= ws - 1e-9 && t <= we + 1e-9))
    .map((t) => ({ x: g.xOf(t), label: `${+t.toFixed(2)}` }));
  setDecor(m, 2, 'axis', {
    extra: { x0: g.bx0, x1: g.bx1, y: g.by1 + 8, ticks: tk, unit: 's' },
  });
  const hasZero = t0 <= 0 && t1 >= 0;
  setDecor(m, 2, 'cue', {
    alpha: hasZero ? 1 : 0,
    reveal: hasZero ? 1 : 0,
    extra: { x: g.xOf(0), y0: g.by0, y1: g.by1, label: c.paradigm.eventLabel || 'event' },
  });
  const z = c.paradigm.zone;
  setDecor(m, 2, 'zone', {
    alpha: z ? 1 : 0,
    reveal: z ? 1 : 0,
    extra: z
      ? { x0: g.xOf(z.start), x1: g.xOf(Math.min(z.end, t1)), y0: g.by0, y1: g.by1, label: z.label }
      : {},
  });
  const fx0 = g.xOf(ws);
  const fx1 = g.xOf(we);
  setDecor(m, 2, 'frame', {
    extra: {
      x0: g.warped ? g.bx0 + 4 : fx0,
      x1: g.warped ? g.bx1 - 4 : fx1,
      y0: g.by0 - 6,
      y1: g.by1 + 2,
      label: `${ws.toFixed(2)} to ${we.toFixed(2)} s`,
      bx0: g.bx0,
      bx1: g.bx1,
      pivot: { x: (fx0 + fx1) / 2, y: (g.by0 + g.by1) / 2 },
    },
  });
  setDecor(m, 2, 'minimap', {
    extra: {
      x0: mini.x0,
      y0: mini.y0,
      width: mini.width,
      height: mini.height,
      ticks: res ? Array.from({ length: 5 }, (_, i) => {
        const fraction = i / 4;
        return { fraction, label: String(Number((lo + fraction * (hi - lo)).toPrecision(3))) };
      }) : [],
      accuracy: probeClasses.length >= 2 && scoreMatches ? res?.separability?.accuracy : undefined,
      xLabel: res ? probeLabel(res.probe.spec.x) : '',
      yLabel: res ? probeLabel(res.probe.spec.y) : '',
    },
  });
  return finish(m, c);
}

function probeLabel(p: { channel: string; type: string; band: [number, number] | null }): string {
  return p.type === 'mean_amplitude'
    ? `${p.channel} mean amplitude`
    : `${p.channel} log power ${p.band ? `${p.band[0]}-${p.band[1]} Hz` : ''}`;
}
