// Page 6: Transform and normalise. The inspected feature's val pieces form a 40-bin histogram of grains.
import type { Layout } from '../engine/types';
import { COLORS } from '../engine/colors';
import { type LayoutCtx, H, PAD, TOP, W, classColor, finish, setDecor } from './common';
import { FAMILY_IDS } from '../engine/registry';
import { BASKET_HEAD, BASKET_BODY_TOP, CHIP_H, CHIP_SCALE, CHIP_W, basketChipPos, p5Geo } from './page5';

export interface P6Geo {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  binW: number;
}

export function p6Geo(c: LayoutCtx): P6Geo {
  const x0 = PAD + 50;
  const x1 = W(c) - PAD - 30;
  return { x0, x1, y0: TOP + 30, y1: H(c) - 76, binW: (x1 - x0) / 40 };
}

/** Column index of the inspected feature inside the val mapping (F matrix). */
export function inspectedColumn(c: LayoutCtx): number {
  return c.backendResults.transform?.featureIndex ?? 0;
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const d = c.data;
  const tr = c.backendResults.transform;
  if (!d) return finish(m, c);
  const g = p6Geo(c);
  const vs = c.slots.val;
  const T = vs.trials.length;
  const j = inspectedColumn(c);
  const applied = c.settings.transform !== 'none' || c.settings.normalise !== 'none';
  if (tr && vs.matrix !== 'none') {
    const side = tr.after;
    const K = d.classNames.length;
    // Stack heights from the val trials themselves (one overlaid pile per class).
    const stack = new Map<string, number>();
    let maxCount = 1;
    const binOf: number[] = [];
    for (let r = 0; r < T; r++) {
      const t = vs.trials[r];
      const b = side.bin[t];
      const k = d.labels[t];
      const key = `${k}:${b}`;
      const n = (stack.get(key) ?? 0) + 1;
      stack.set(key, n);
      maxCount = Math.max(maxCount, n);
      binOf.push(n - 1);
    }
    const gh = Math.min(g.binW * 0.9, (g.y1 - g.y0) / maxCount);
    for (let f = 0; f < vs.nFeatures; f++) {
      for (let r = 0; r < T; r++) {
        const s = f * T + r;
        const t = vs.trials[r];
        if (f === j) {
          const b = side.bin[t];
          m.set(`val:${s}`, {
            x: g.x0 + (b + 0.5) * g.binW,
            y: g.y1 - (binOf[r] + 0.5) * gh,
            w: Math.max(1, g.binW * 0.86),
            h: Math.max(1, gh * 0.86),
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            alpha: 0.7,
            color: classColor(d.labels[t]),
          });
        } else {
          m.set(`val:${s}`, {
            x: g.x0 + (((r * 37) % 40) + 0.5) * g.binW,
            y: g.y1 + 22,
            w: 6,
            h: 6,
            rotation: 0,
            scaleX: 0,
            scaleY: 0,
            alpha: 0,
            color: COLORS.ink,
          });
        }
      }
    }
    void K;
    const e = side.edges;
    const lo = e[0];
    const hi = e[e.length - 1];
    const vx = (v: number): number => g.x0 + ((v - lo) / (hi - lo)) * (g.x1 - g.x0);
    const ticksV = niceTicks(lo, hi).map((v) => ({ x: vx(v), label: fmt(v) }));
    setDecor(m, 6, 'histaxis', { extra: { ...g, ticks: ticksV, label: tr.feature } });
    setDecor(m, 6, 'guides', {
      alpha: c.settings.normalise === 'zscore' ? 1 : 0,
      extra: {
        xs: [-1, 0, 1].filter((v) => v >= lo && v <= hi).map((v) => ({ x: vx(v), label: `${v}` })),
        y0: g.y0,
        y1: g.y1,
      },
    });
    setDecor(m, 6, 'meanticks', {
      extra: { ticks: side.perClass.map((pc, k) => ({ x: vx(pc.mean), color: classColor(k) })), y: g.y1 },
    });
    // Ghost: the "before" histogram outline (alpha 0.15) behind the change.
    const bc = tr.before.counts;
    const bmax = Math.max(1, ...bc.flat());
    setDecor(m, 6, 'ghost', {
      alpha: applied ? 0.15 : 0,
      // Same vertical scale as the grains (one grain height per trial), so the ghost matches the pile.
      extra: { counts: bc, max: bmax, grain: gh, ...g, colors: bc.map((_, k) => classColor(k)) },
    });
  }
  // The feature list slides off the left edge in formation; basket chips shrink inside the basket.
  const g5 = p5Geo(c);
  const shift = g5.gx0 + g5.gw + 160;
  FAMILY_IDS.forEach((f) => {
    const k = c.settings.features.indexOf(f);
    if (k >= 0) {
      const p = basketChipPos(g5, k);
      m.set(`card:${f}`, { x: p.x, y: p.y, w: CHIP_W, h: CHIP_H, scaleX: 0, scaleY: 0, alpha: 0 });
      return;
    }
    const v = g5.visible.indexOf(f);
    if (v < 0) return;
    const p = g5.slotOf(v);
    m.set(`card:${f}`, { x: p.x - shift, y: p.y, w: 200, h: 170, scaleX: 1, scaleY: 1, alpha: 1 });
  });
  const bx = g5.basket;
  // The basket ends upturned (it flipped to spill its contents) and faded out.
  const pivot = { x: bx.x + bx.w / 2, y: bx.y + bx.h / 2 };
  setDecor(m, 5, 'basket', {
    alpha: 0,
    rotation: Math.PI,
    scaleX: 1.15,
    scaleY: 1.15,
    extra: {
      ...bx,
      head: BASKET_HEAD,
      bodyTop: BASKET_BODY_TOP,
      count: 0,
      chips: c.settings.features.map(() => ''),
      pivot,
    },
  });
  setDecor(m, 5, 'odometer', {
    alpha: 0,
    extra: { x: bx.x + bx.w - 40, y: bx.y + BASKET_HEAD / 2, value: 0, pivot },
  });
  void CHIP_SCALE;
  return finish(m, c);
}

export function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / 6;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => span / s <= 7) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toPrecision(10));
  return out;
}

export function fmt(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(1);
  return `${+v.toPrecision(3)}`;
}
