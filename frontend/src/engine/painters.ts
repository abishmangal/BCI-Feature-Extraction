// Painters: draw low-count containers (electrodes, cards, chips, rail) and decor from layout extras.
// Graphics are rebuilt only when extras, data, stage size or a reveal spring change; never per frame otherwise.
import { BitmapText, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { ContainerView, Painters } from './stage';
import type { Kind } from './registry';
import { CATEGORY_COLORS, CLASS_COLORS, COLORS, mix } from './colors';
import { Scalar } from './scalar';

type Ex = Record<string, unknown>;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const GRAPH_TICK = { size: 13, color: COLORS.ink } as const;
const GRAPH_LABEL = { font: 'sans', size: 14, color: COLORS.ink } as const;
const GRAPH_TITLE = { font: 'sans', size: 17, color: COLORS.ink } as const;

function spacedTicks<T extends { label: string }>(ticks: T[], position: (tick: T) => number, vertical = false): T[] {
  let edge = -Infinity;
  return ticks.slice().sort((a, b) => position(a) - position(b)).filter((tick) => {
    const center = position(tick);
    const half = vertical ? 9 : Math.max(13, tick.label.length * 4 + 4);
    if (center - half < edge) return false;
    edge = center + half;
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Cache text per view and style. Cards use high-resolution canvas text for their compact copy.
function text(
  view: ContainerView,
  key: string,
  s: string,
  o: {
    size?: number;
    color?: number;
    x: number;
    y: number;
    ax?: number;
    ay?: number;
    font?: 'mono' | 'sans' | 'serif';
    rot?: number;
    alpha?: number;
    wrap?: number;
    align?: 'left' | 'center';
  },
): BitmapText | Text {
  const map = (view.state.texts ??= new Map<string, BitmapText | Text>()) as Map<string, BitmapText | Text>;
  const used = (view.state.used ??= new Set<string>()) as Set<string>;
  const font = o.font ?? 'mono';
  const size = o.size ?? 10;
  const fkey = `${key}|${font}|${size}|${o.wrap ?? 0}`;
  let t = map.get(fkey);
  if (!t) {
    const options = {
      text: s,
      style: {
        fontFamily: font === 'mono' ? 'JetBrains Mono' : font === 'serif' ? 'Fraunces' : 'Inter',
        fontSize: size,
        fill: 0xffffff,
        wordWrap: !!o.wrap,
        wordWrapWidth: o.wrap ?? 100,
        align: o.align ?? 'left',
      },
    };
    t = view.state.highResolutionText ? new Text({ ...options, resolution: 3 }) : new BitmapText(options);
    map.set(fkey, t);
    ((view.state.textLayer as Container | undefined) ?? view.root).addChild(t);
  }
  if (t.text !== s) t.text = s;
  t.tint = o.color ?? COLORS.ink;
  t.anchor.set(o.ax ?? 0, o.ay ?? 0);
  t.position.set(o.x, o.y);
  t.rotation = o.rot ?? 0;
  t.alpha = o.alpha ?? 1;
  t.visible = true;
  used.add(fkey);
  return t;
}
function beginText(view: ContainerView): void {
  (view.state.used as Set<string> | undefined)?.clear();
}
function endText(view: ContainerView): void {
  const map = view.state.texts as Map<string, BitmapText | Text> | undefined;
  const used = view.state.used as Set<string> | undefined;
  if (!map) return;
  for (const [k, t] of map) if (!used?.has(k)) t.visible = false;
}
function gfx(view: ContainerView, key = 'g'): Graphics {
  let g = view.state[key] as Graphics | undefined;
  if (!g) {
    g = new Graphics();
    view.state[key] = g;
    view.root.addChildAt(
      g,
      Math.min(view.root.children.length, (view.state.gcount as number | undefined) ?? 0),
    );
    view.state.gcount = ((view.state.gcount as number | undefined) ?? 0) + 1;
  }
  return g;
}
function dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, dash = 5, gap = 4): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / (len || 1);
  const uy = (y1 - y0) / (len || 1);
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + dash);
    g.moveTo(x0 + ux * s, y0 + uy * s).lineTo(x0 + ux * e, y0 + uy * e);
  }
}
function arcStroke(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  reveal: number,
  width: number,
  color: number,
  alpha = 1,
): void {
  if (reveal <= 0.001) return;
  const a0 = -Math.PI / 2;
  g.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  g.arc(cx, cy, r, a0, a0 + Math.PI * 2 * Math.min(1, reveal));
  g.stroke({ width, color, alpha });
}

// ---------------------------------------------------------------------------------------------
type DecorPaint = (view: ContainerView, ex: Ex, reveal: number) => void;

const DECOR: Record<string, DecorPaint> = {
  '1:droptext': (v, ex) => {
    beginText(v);
    if (ex.plot) {
      const { x0, x1, y0, y1, start, end } = ex.plot as Record<string, number>;
      text(v, 'title', 'EEG waveforms by trial', { ...GRAPH_TITLE, x: x0, y: y0 - 22 });
      text(v, 'start', `${fmt(start)} s`, { ...GRAPH_TICK, x: x0, y: y1 + 4 });
      text(v, 'end', `${fmt(end)} s`, { ...GRAPH_TICK, x: x1, y: y1 + 4, ax: 1 });
    } else text(v, 't', str(ex.text), {
      x: num(ex.x),
      y: num(ex.y),
      ax: 0.5,
      size: 15,
      font: 'sans',
      color: COLORS.grey,
    });
    endText(v);
  },
  // ----------------------------------------------------------------- page 2
  '2:axis': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x0 = num(ex.x0);
    const x1 = num(ex.x1);
    const y = num(ex.y);
    const xr = x0 + (x1 - x0) * Math.min(1, reveal);
    g.moveTo(x0, y).lineTo(xr, y).stroke({ width: 1, color: COLORS.ink });
    for (const t of (ex.ticks as { x: number; label: string }[]) ?? []) {
      if (t.x > xr + 0.5) continue;
      g.moveTo(t.x, y)
        .lineTo(t.x, y + 5)
        .stroke({ width: 1, color: COLORS.ink });
    }
    for (const t of spacedTicks((ex.ticks as { x: number; label: string }[]) ?? [], (t) => t.x)) {
      if (t.x <= xr + 0.5) text(v, `t${t.label}`, t.label, { ...GRAPH_TICK, x: t.x, y: y + 7, ax: 0.5 });
    }
    text(v, 'unit', 'Time (s)', { ...GRAPH_LABEL, x: x0, y: y + 23 });
    endText(v);
  },
  '2:cue': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x = num(ex.x);
    const y0 = num(ex.y0);
    const y1 = y0 + (num(ex.y1) - y0) * Math.min(1, reveal);
    dashed(g, x, y0, x, y1);
    g.stroke({ width: 1.2, color: COLORS.ink });
    text(v, 'l', str(ex.label), { ...GRAPH_LABEL, x: x + 4, y: y0 + 2 });
    endText(v);
  },
  '2:zone': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    if (ex.x0 !== undefined) {
      const a = Math.min(1, reveal);
      g.rect(num(ex.x0), num(ex.y0), num(ex.x1) - num(ex.x0), num(ex.y1) - num(ex.y0)).fill({
        color: COLORS.accent,
        alpha: 0.18 * a,
      });
      text(v, 'l', str(ex.label).toUpperCase(), {
        x: num(ex.x0) + 4,
        y: num(ex.y0) + 19,
        ...GRAPH_LABEL,
        color: COLORS.accent,
        alpha: a,
      });
    }
    endText(v);
  },
  '2:frame': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x0 = num(ex.x0);
    const x1 = num(ex.x1);
    const y0 = num(ex.y0);
    const y1 = num(ex.y1);
    const bx0 = num(ex.bx0, x0);
    const bx1 = num(ex.bx1, x1);
    // Samples outside the window stay visible but are dimmed.
    if (x0 > bx0) g.rect(bx0, y0, x0 - bx0, y1 - y0).fill({ color: COLORS.cream, alpha: 0.72 });
    if (bx1 > x1) g.rect(x1, y0, bx1 - x1, y1 - y0).fill({ color: COLORS.cream, alpha: 0.72 });
    g.rect(x0, y0, x1 - x0, y1 - y0).stroke({ width: 2, color: COLORS.teal });
    const ha = Math.max(0, (v.root.alpha - 0.6) / 0.4); // handles fade in after the frame
    for (const x of [x0, x1]) {
      g.roundRect(x - 5, (y0 + y1) / 2 - 20, 10, 40, 4).fill({ color: COLORS.teal, alpha: ha });
      g.moveTo(x - 1.5, (y0 + y1) / 2 - 8)
        .lineTo(x - 1.5, (y0 + y1) / 2 + 8)
        .moveTo(x + 1.5, (y0 + y1) / 2 - 8)
        .lineTo(x + 1.5, (y0 + y1) / 2 + 8)
        .stroke({ width: 1, color: 0xffffff, alpha: ha });
    }
    text(v, 'l', str(ex.label), { ...GRAPH_TICK, x: (x0 + x1) / 2, y: y0 - 17, ax: 0.5, color: COLORS.teal });
    endText(v);
  },
  '2:minimap': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x0 = num(ex.x0);
    const y0 = num(ex.y0);
    const w = num(ex.width);
    const h = num(ex.height);
    g.rect(x0, y0, w, h).fill({ color: COLORS.panel }).stroke({ width: 1, color: COLORS.hairline });
    const ticks = (ex.ticks ?? []) as { fraction: number; label: string }[];
    ticks.forEach(({ fraction }) => {
      const x = x0 + w * fraction;
      const y = y0 + h * (1 - fraction);
      g.moveTo(x, y0).lineTo(x, y0 + h).moveTo(x0, y).lineTo(x0 + w, y)
        .stroke({ width: 1, color: COLORS.hairline, alpha: 0.5 });
    });
    for (const t of spacedTicks(ticks, (t) => x0 + w * t.fraction)) {
      text(v, `xt${t.fraction}`, t.label, { ...GRAPH_TICK, x: x0 + w * t.fraction, y: y0 + h + 5, ax: 0.5 });
    }
    for (const t of spacedTicks(ticks, (t) => y0 + h * (1 - t.fraction), true)) {
      text(v, `yt${t.fraction}`, t.label, { ...GRAPH_TICK, x: x0 - 6, y: y0 + h * (1 - t.fraction), ax: 1, ay: 0.5 });
    }
    dashed(g, x0, y0 + h, x0 + w, y0, 2, 3);
    g.stroke({ width: 1, color: COLORS.grey });
    text(v, 'x', str(ex.xLabel), { ...GRAPH_LABEL, x: x0 + w / 2, y: y0 + h + 23, ax: 0.5, wrap: w, align: 'center' });
    text(v, 'y', str(ex.yLabel), {
      x: x0 - 48,
      y: y0 + h / 2,
      ax: 0.5,
      ay: 1,
      ...GRAPH_LABEL,
      rot: -Math.PI / 2,
    });
    text(v, 't', 'Class separability', { ...GRAPH_TITLE, x: x0, y: y0 - 24 });
    endText(v);
  },
  // ----------------------------------------------------------------- page 3
  '3:scalp': (v, ex) => {
    const g = gfx(v);
    g.clear();
    const cx = num(ex.cx);
    const cy = num(ex.cy);
    const R = num(ex.R);
    g.circle(cx, cy, R).fill({ color: COLORS.scalp });
    for (let k = 1; k <= 6; k++)
      g.circle(cx, cy, R * (1 - k * 0.08)).fill({ color: COLORS.cream, alpha: 0.018 });
  },
  '3:head': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    arcStroke(g, num(ex.cx), num(ex.cy), num(ex.R), reveal, 1.5, COLORS.ink);
    text(v, 'tag', str(ex.tag), {
      x: num(ex.cx),
      y: num(ex.cy) + num(ex.R) + 14,
      ax: 0.5,
      ...GRAPH_LABEL,
      color: COLORS.grey,
    });
    endText(v);
  },
  '3:nose': (v, ex) => {
    const g = gfx(v);
    g.clear();
    const cx = num(ex.cx);
    const top = num(ex.cy) - num(ex.R);
    g.moveTo(cx - 6, top + 2)
      .lineTo(cx, top - 14)
      .lineTo(cx + 6, top + 2)
      .stroke({ width: 1.5, color: COLORS.ink });
  },
  '3:ears': (v, ex) => {
    const g = gfx(v);
    g.clear();
    const cx = num(ex.cx);
    const cy = num(ex.cy);
    const R = num(ex.R);
    for (const s of [-1, 1]) {
      const x = cx + s * R;
      g.moveTo(x, cy - 14);
      g.bezierCurveTo(x + s * 13, cy - 14, x + s * 13, cy + 14, x, cy + 14);
      g.stroke({ width: 1.5, color: COLORS.ink });
    }
  },
  '3:cap': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    const cx = num(ex.cx);
    const cy = num(ex.cy);
    const R = num(ex.R) + 4;
    arcStroke(g, cx, cy, R, reveal, 3, COLORS.taupe);
    if (reveal > 0.95) {
      // chin-strap hint
      g.moveTo(cx - 18, cy + R + 2)
        .quadraticCurveTo(cx, cy + R + 12, cx + 18, cy + R + 2)
        .stroke({ width: 1.5, color: COLORS.taupe });
    }
  },
  '3:mesh': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    const cx = num(ex.cx);
    const cy = num(ex.cy);
    const R = num(ex.R);
    const r = Math.min(1, reveal);
    // nose-to-back midline arc and ear-to-ear arc: thin taupe curves, no markers, no labels.
    g.moveTo(cx, cy - R)
      .quadraticCurveTo(cx + R * 0.06, cy, cx, cy - R + 2 * R * r)
      .stroke({ width: 1, color: COLORS.taupe, alpha: 0.5 });
    g.moveTo(cx - R, cy)
      .quadraticCurveTo(cx, cy + R * 0.06, cx - R + 2 * R * r, cy)
      .stroke({ width: 1, color: COLORS.taupe, alpha: 0.5 });
  },
  '3:heat': (v, ex) => {
    const grid = ex.grid as Float32Array | null;
    const ver = str(ex.version) + JSON.stringify(ex.ramp) + num(ex.vmin) + num(ex.vmax);
    let sp = v.state.sprite as Sprite | undefined;
    let mask = v.state.mask as Graphics | undefined;
    if (!sp) {
      sp = new Sprite();
      mask = new Graphics();
      v.root.addChild(sp);
      v.root.addChild(mask);
      sp.mask = mask;
      v.state.sprite = sp;
      v.state.mask = mask;
    }
    const cx = num(ex.cx);
    const cy = num(ex.cy);
    const R = num(ex.R);
    mask!.clear().circle(cx, cy, R).fill({ color: 0xffffff });
    if (!grid) {
      sp.visible = false;
      return;
    }
    if (v.state.ver !== ver) {
      v.state.ver = ver;
      const n = 64;
      const c = document.createElement('canvas');
      c.width = n;
      c.height = n;
      const ctx2 = c.getContext('2d')!;
      const img = ctx2.createImageData(n, n);
      const ramp = ex.ramp as { from: number; to: number; mid?: number };
      const lo = num(ex.vmin);
      const hi = num(ex.vmax, 1);
      for (let i = 0; i < n * n; i++) {
        const val = grid[i];
        let col: number = COLORS.cream;
        let a = 0;
        if (isFinite(val)) {
          a = 255;
          if (ramp.mid !== undefined) {
            const t = Math.max(-1, Math.min(1, val / (Math.max(Math.abs(lo), Math.abs(hi)) || 1)));
            col = t >= 0 ? mix(ramp.mid, ramp.to, t) : mix(ramp.mid, ramp.from, -t);
          } else col = mix(ramp.from, ramp.to, Math.max(0, Math.min(1, (val - lo) / (hi - lo || 1))));
        }
        img.data[4 * i] = (col >> 16) & 255;
        img.data[4 * i + 1] = (col >> 8) & 255;
        img.data[4 * i + 2] = col & 255;
        img.data[4 * i + 3] = a;
      }
      ctx2.putImageData(img, 0, 0);
      const old = v.state.tex as Texture | undefined;
      const tex = Texture.from(c, true);
      tex.source.scaleMode = 'linear';
      sp.texture = tex;
      v.state.tex = tex;
      old?.destroy(true);
    }
    sp.visible = true;
    sp.position.set(cx - R, cy - R);
    sp.width = 2 * R;
    sp.height = 2 * R;
  },
  '3:links': (v, ex) => {
    const g = gfx(v);
    g.clear();
    for (const s of (ex.segments as [number, number, number, number][]) ?? [])
      g.moveTo(s[0], s[1]).lineTo(s[2], s[3]);
    g.stroke({ width: 1, color: COLORS.teal, alpha: 0.5 });
  },
  '3:legend': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x = num(ex.x);
    const y = num(ex.y);
    const ramp = ex.ramp as { from: number; to: number; mid?: number } | undefined;
    if (ramp) {
      const n = 40;
      const labelWidth = num(ex.labelWidth, 250);
      const name = text(v, 'n', str(ex.name), { ...GRAPH_TITLE, x, y, wrap: labelWidth });
      const rampY = y + Math.max(26, name.height + 4);
      const w = 190;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const col =
          ramp.mid !== undefined
            ? t < 0.5
              ? mix(ramp.from, ramp.mid, t * 2)
              : mix(ramp.mid, ramp.to, (t - 0.5) * 2)
            : mix(ramp.from, ramp.to, t);
        g.rect(x + (i * w) / n, rampY, w / n + 0.5, 10).fill({ color: col });
      }
      g.rect(x, rampY, w, 10).stroke({ width: 1, color: COLORS.hairline });
      text(v, 'lo', `${fmt(num(ex.vmin))} ${str(ex.unit)}`, { ...GRAPH_TICK, x, y: rampY + 14 });
      text(v, 'hi', `${fmt(num(ex.vmax))} ${str(ex.unit)}`, {
        x: x + w,
        y: rampY + 14,
        ax: 1,
        ...GRAPH_TICK,
      });
      if (ex.note) text(v, 'note', str(ex.note), { ...GRAPH_LABEL, x, y: rampY + 33, wrap: labelWidth });
    }
    endText(v);
  },
  '3:tray': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const r = ex.rect as { x0: number; y0: number; x1: number; y1: number } | null;
    if (r) {
      g.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 6).stroke({ width: 1, color: COLORS.hairline });
      text(v, 'l', str(ex.label), { ...GRAPH_LABEL, x: r.x0 + 6, y: r.y0 - 17 });
    }
    endText(v);
  },
  // ----------------------------------------------------------------- page 4
  '4:axes': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x0 = num(ex.x0);
    const x1 = num(ex.x1);
    const y0 = num(ex.y0);
    const y1 = num(ex.y1);
    const r = Math.min(1, reveal);
    g.moveTo(x0, y1)
      .lineTo(x0 + (x1 - x0) * r, y1)
      .stroke({ width: 1, color: COLORS.ink });
    g.moveTo(x0, y1)
      .lineTo(x0, y1 - (y1 - y0) * r)
      .stroke({ width: 1, color: COLORS.ink });
    for (const t of spacedTicks((ex.fTicks as { x: number; label: string }[]) ?? [], (t) => t.x)) {
      g.moveTo(t.x, y1)
        .lineTo(t.x, y1 + 4)
        .stroke({ width: 1, color: COLORS.ink, alpha: r });
      text(v, `f${t.label}`, t.label, { ...GRAPH_TICK, x: t.x, y: y1 + 6, ax: 0.5, alpha: r });
    }
    for (const t of spacedTicks((ex.dbTicks as { y: number; label: string }[]) ?? [], (t) => t.y, true)) {
      g.moveTo(x0 - 4, t.y)
        .lineTo(x0, t.y)
        .stroke({ width: 1, color: COLORS.ink, alpha: r });
      text(v, `d${t.label}`, t.label, { ...GRAPH_TICK, x: x0 - 7, y: t.y, ax: 1, ay: 0.5, alpha: r });
    }
    text(v, 'fx', 'Frequency (Hz)', { ...GRAPH_LABEL, x: x1, y: y1 + 24, ax: 1, alpha: r });
    text(v, 'fy', y1 - y0 < 240 ? 'Power (dB, µV²/Hz)' : 'Power spectral density (dB, µV²/Hz)', {
      ...GRAPH_LABEL,
      x: Math.max(13, x0 - 48),
      y: (y0 + y1) / 2,
      ax: 0.5,
      ay: 0.5,
      rot: -Math.PI / 2,
      alpha: r,
    });
    endText(v);
  },
  '4:bands': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const y0 = num(ex.y0);
    const y1 = num(ex.y1);
    const regions = ex.regions as { x0: number; x1: number; label: string }[];
    const laneEdges = [-Infinity, -Infinity, -Infinity];
    regions.forEach((r, k) => {
      g.rect(r.x0, y0, r.x1 - r.x0, y1 - y0).fill({ color: COLORS.hairline, alpha: 0.25 });
      const width = r.label.length * 7 + 6;
      const x = Math.min(r.x0 + 3, num(ex.x1) - width);
      const lane = laneEdges.findIndex((edge) => x >= edge);
      if (lane < 0) return;
      laneEdges[lane] = x + width;
      text(v, `r${k}`, r.label, { ...GRAPH_LABEL, x, y: y0 + 3 + lane * 18 });
    });
    const stimuli = (ex.stim as { x: number; label: string }[]).slice().sort((a, b) => a.x - b.x);
    stimuli.forEach((s) => {
      g.moveTo(s.x, y1)
        .lineTo(s.x, y1 - 14)
        .stroke({ width: 1, color: COLORS.ink });
    });
    for (const lane of [0, 1]) {
      for (const s of spacedTicks(stimuli.filter((_, i) => i % 2 === lane), (s) => s.x)) {
        text(v, `s${lane}:${s.label}`, s.label, { ...GRAPH_LABEL, x: s.x, y: y1 - 32 - lane * 18, ax: 0.5 });
      }
    }
    endText(v);
  },
  '4:gate': (v, ex) => {
    const g = gfx(v);
    g.clear();
    g.rect(num(ex.x0), num(ex.y0), num(ex.x1) - num(ex.x0), num(ex.y1) - num(ex.y0)).fill({
      color: COLORS.teal,
      alpha: 0.07,
    });
    g.moveTo(num(ex.x0), num(ex.y0)).lineTo(num(ex.x1), num(ex.y0)).stroke({ width: 2, color: COLORS.teal });
  },
  '4:fill': (v, ex) => {
    const g = gfx(v);
    g.clear();
    const ref = ex.ref as number[] | null;
    const curves = (ex.curves as { color: number; pts: number[] }[]) ?? [];
    if (ref) {
      for (const c of curves) {
        // Gap fill where the class curve is below the reference curve.
        const p = c.pts;
        for (let i = 0; i + 3 < p.length && i + 3 < ref.length; i += 2) {
          const ya = p[i + 1];
          const yb = p[i + 3];
          const ra = ref[i + 1];
          const rb = ref[i + 3];
          if (ya > ra || yb > rb) {
            g.poly([p[i], Math.max(ya, ra), p[i + 2], Math.max(yb, rb), p[i + 2], rb, p[i], ra]).fill({
              color: CLASS_COLORS[c.color % 6],
              alpha: 0.35,
            });
          }
        }
      }
      g.moveTo(ref[0], ref[1]);
      for (let i = 2; i < ref.length; i += 2) g.lineTo(ref[i], ref[i + 1]);
      g.stroke({ width: 1.5, color: COLORS.ink, alpha: 0.5 });
    }
    for (const c of curves) {
      const p = c.pts;
      if (p.length < 4) continue;
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.stroke({ width: 1.5, color: CLASS_COLORS[c.color % 6] });
    }
  },
  '4:handles': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    for (const [x, lab] of [
      [num(ex.x0), `${num(ex.low)} Hz`],
      [num(ex.x1), `${num(ex.high)} Hz`],
    ] as [number, string][]) {
      g.moveTo(x, num(ex.y0)).lineTo(x, num(ex.y1)).stroke({ width: 1.5, color: COLORS.teal });
      g.roundRect(x - 5, num(ex.y0) - 2, 10, 18, 3).fill({ color: COLORS.teal });
      text(v, lab, lab, { ...GRAPH_TICK, x, y: num(ex.y0) - 19, ax: 0.5, color: COLORS.teal });
    }
    endText(v);
  },
  '4:wavepanel': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    g.rect(num(ex.x0), num(ex.y0), num(ex.x1) - num(ex.x0), num(ex.y1) - num(ex.y0)).stroke({
      width: 1,
      color: COLORS.hairline,
    });
    const x0 = num(ex.x0) + 8;
    const x1 = num(ex.x1) - 8;
    const y0 = num(ex.y0) + 5;
    const y1 = num(ex.y1) - 18;
    const tight = x1 - x0 < 320;
    text(v, 'l', str(ex.label), { ...GRAPH_TITLE, x: x0, y: y0 });
    text(v, 'n', str(ex.note), { ...GRAPH_LABEL, x: x1, y: y0 + (tight ? 19 : 2), ax: 1 });
    const bounds = ex.times as [number, number] | undefined;
    if (bounds) {
      text(v, 'start', `${fmt(bounds[0])} s`, { ...GRAPH_TICK, x: x0, y: y1 });
      text(v, 'end', `${fmt(bounds[1])} s`, { ...GRAPH_TICK, x: x1, y: y1, ax: 1 });
    }
    endText(v);
  },
  '4:prism': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    const x = num(ex.x);
    const y = num(ex.y);
    const s = 26;
    const pts = [x, y - s, x + s * 0.9, y + s * 0.6, x - s * 0.9, y + s * 0.6, x, y - s];
    const r = Math.min(1, reveal) * 3;
    g.moveTo(pts[0], pts[1]);
    for (let k = 0; k < 3 && k < r; k++) {
      const f = Math.min(1, r - k);
      const ax = pts[2 * k];
      const ay = pts[2 * k + 1];
      g.lineTo(ax + (pts[2 * k + 2] - ax) * f, ay + (pts[2 * k + 3] - ay) * f);
    }
    g.stroke({ width: 1.5, color: COLORS.ink });
  },
  // ----------------------------------------------------------------- page 5
  '5:basket': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x = num(ex.x);
    const y = num(ex.y);
    const w = num(ex.w);
    const h = num(ex.h);
    const head = num(ex.head, 56);
    const r = 22;
    const rb = Math.min(w * 0.42, h * 0.32); // rounded bottom, like a basket
    const yb = y + h - rb;
    const outline = (gg: Graphics): Graphics =>
      gg
        .moveTo(x, y + r)
        .quadraticCurveTo(x, y, x + r, y)
        .lineTo(x + w - r, y)
        .quadraticCurveTo(x + w, y, x + w, y + r)
        .lineTo(x + w, yb)
        .bezierCurveTo(x + w, yb + rb * 0.78, x + w / 2 + w * 0.3, y + h, x + w / 2, y + h)
        .bezierCurveTo(x + w / 2 - w * 0.3, y + h, x, yb + rb * 0.78, x, yb)
        .closePath();
    // pale-teal body with a gentle vertical fade
    outline(g).fill({ color: 0xeef8f6 });
    for (let k = 0; k < 6; k++)
      g.rect(x + 1, y + head + k * ((yb - y - head) / 6), w - 2, (yb - y - head) / 6).fill({
        color: COLORS.teal,
        alpha: 0.012 * k,
      });
    // darker teal wave along the bottom
    const wy = y + h - rb * 0.62;
    g.moveTo(x + w * 0.06, wy + 6)
      .quadraticCurveTo(x + w / 2, wy - 18, x + w * 0.94, wy + 6)
      .bezierCurveTo(x + w * 0.86, y + h - rb * 0.18, x + w / 2 + w * 0.2, y + h, x + w / 2, y + h)
      .bezierCurveTo(x + w / 2 - w * 0.2, y + h, x + w * 0.14, y + h - rb * 0.18, x + w * 0.06, wy + 6)
      .fill({ color: 0xa6d9cf });
    // teal header
    g.moveTo(x, y + head)
      .lineTo(x, y + r)
      .quadraticCurveTo(x, y, x + r, y)
      .lineTo(x + w - r, y)
      .quadraticCurveTo(x + w, y, x + w, y + r)
      .lineTo(x + w, y + head)
      .closePath()
      .fill({ color: COLORS.teal });
    outline(g).stroke({ width: 2, color: COLORS.teal });
    text(v, 'l', 'F E A T U R E   B A S K E T', {
      x: x + 20,
      y: y + head / 2,
      ay: 0.5,
      size: 13,
      color: 0xffffff,
    });
    const n = num(ex.count, 0);
    const chips = (ex.chips as string[]) ?? [];
    if (!chips.length) {
      // Empty basket: the message fills the basket, in a clearly visible colour.
      text(v, 'empty', 'Basket Empty: Default features used', {
        x: x + w / 2,
        y: y + head + (yb - y - head) * 0.45,
        ax: 0.5,
        ay: 0.5,
        font: 'serif',
        size: Math.max(22, Math.min(34, w / 9)),
        color: COLORS.tealDark,
        wrap: w - 40,
        align: 'center',
      });
      text(v, 'hint', 'Click a feature card to add it.', {
        x: x + w / 2,
        y: yb + 4,
        ax: 0.5,
        font: 'sans',
        size: 12,
        color: COLORS.grey,
      });
    } else {
      text(v, 'sel', 'Selected features', {
        x: x + w / 2,
        y: y + head + 14,
        ax: 0.5,
        font: 'serif',
        size: 22,
        color: COLORS.tealDark,
      });
      text(v, 'cnt', `${chips.length} famil${chips.length === 1 ? 'y' : 'ies'}, ${n} features`, {
        x: x + w / 2,
        y: y + head + 42,
        ax: 0.5,
        font: 'sans',
        size: 11,
        color: COLORS.grey,
      });
    }
    if (ex.note)
      text(v, 'n', str(ex.note), {
        x: x + w / 2,
        y: wy - 30,
        ax: 0.5,
        size: 10,
        color: COLORS.tealDark,
        wrap: w - 60,
        align: 'center',
      });
    endText(v);
  },
  '5:odometer': () => undefined, // drawn by the animate hook
  // ----------------------------------------------------------------- page 6
  '6:histaxis': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x0 = num(ex.x0);
    const x1 = num(ex.x1);
    const y1 = num(ex.y1);
    g.moveTo(x0, y1)
      .lineTo(x0 + (x1 - x0) * Math.min(1, reveal), y1)
      .stroke({ width: 1, color: COLORS.ink });
    for (const t of spacedTicks((ex.ticks as { x: number; label: string }[]) ?? [], (t) => t.x)) {
      g.moveTo(t.x, y1)
        .lineTo(t.x, y1 + 4)
        .stroke({ width: 1, color: COLORS.ink });
      text(v, `t${t.label}`, t.label, { ...GRAPH_TICK, x: t.x, y: y1 + 6, ax: 0.5 });
    }
    text(v, 'lab', `Distribution of ${str(ex.label)}`, {
      ...GRAPH_TITLE, x: x0, y: num(ex.y0) - 4, ay: 1, wrap: x1 - x0,
    });
    text(v, 'unit', 'Feature value', { ...GRAPH_LABEL, x: (x0 + x1) / 2, y: y1 + 24, ax: 0.5 });
    text(v, 'count', 'Trials per bin', {
      ...GRAPH_LABEL, x: x0 - 43, y: (num(ex.y0) + y1) / 2, ax: 0.5, rot: -Math.PI / 2,
    });
    endText(v);
  },
  '6:guides': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    for (const s of (ex.xs as { x: number; label: string }[]) ?? []) {
      dashed(g, s.x, num(ex.y0), s.x, num(ex.y1), 4, 4);
      g.stroke({ width: 1, color: COLORS.accent });
      text(v, `g${s.label}`, s.label, { ...GRAPH_TICK, x: s.x, y: num(ex.y0) + 3, ax: 0.5, color: COLORS.accent });
    }
    endText(v);
  },
  '6:ghost': (v, ex) => {
    const g = gfx(v);
    g.clear();
    const counts = (ex.counts as number[][]) ?? [];
    const x0 = num(ex.x0);
    const bw = num(ex.binW);
    const y1 = num(ex.y1);
    const hmax = num(ex.y1) - num(ex.y0);
    const mx = num(ex.max, 1);
    const grain = num(ex.grain, hmax / mx);
    const colors = (ex.colors as number[]) ?? [];
    counts.forEach((row, k) => {
      g.moveTo(x0, y1);
      row.forEach((n, b) => {
        const y = y1 - Math.min(hmax, n * grain);
        g.lineTo(x0 + b * bw, y).lineTo(x0 + (b + 1) * bw, y);
      });
      g.lineTo(x0 + row.length * bw, y1);
      g.stroke({ width: 1.5, color: colors[k] ?? COLORS.ink });
    });
  },
  '6:meanticks': (v, ex) => {
    const g = gfx(v);
    g.clear();
    for (const t of (ex.ticks as { x: number; color: number }[]) ?? [])
      g.moveTo(t.x, num(ex.y) + 18)
        .lineTo(t.x, num(ex.y) + 30)
        .stroke({ width: 2, color: t.color });
  },
  // ----------------------------------------------------------------- page 7
  '7:rowstrip': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    const x = num(ex.x);
    const y0 = num(ex.y0);
    const ch = num(ex.cellH);
    const rows = (ex.rows as { cr: number; color: number }[]) ?? [];
    const maxR = rows.length * Math.min(1, reveal);
    const sorted = [...rows].sort((a, b) => a.cr - b.cr);
    sorted.forEach((r, k) => {
      if (k > maxR) return;
      g.rect(x, y0 + r.cr * ch, 6, Math.max(0.6, ch)).fill({ color: r.color });
      if (k > 0 && sorted[k - 1].color !== r.color)
        g.moveTo(x, y0 + r.cr * ch)
          .lineTo(x + 10 + 10000, y0 + r.cr * ch)
          .stroke({ width: 1, color: COLORS.cream });
    });
  },
  '7:colheads': (v, ex) => {
    beginText(v);
    const names = (ex.names as string[]) ?? [];
    const cw = num(ex.cellW);
    const every = Math.max(1, Math.ceil(14 / cw));
    names.forEach((n, i) => {
      if (i % every) return;
      text(v, `c${i}`, n.length > 14 ? n.slice(0, 13) + '.' : n, {
        x: num(ex.x0) + (i + 0.5) * cw + 3,
        y: num(ex.y),
        rot: -Math.PI / 2.6,
        size: 11,
        color: COLORS.ink,
      });
    });
    if (num(ex.total) > names.length)
      text(
        v,
        'win',
        `showing columns ${num(ex.offset) + 1} to ${num(ex.offset) + names.length} of ${num(ex.total)}`,
        { ...GRAPH_LABEL, x: num(ex.x0) + 160, y: num(ex.infoY) },
      );
    endText(v);
  },
  '7:brackets': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const cw = num(ex.cellW);
    const y = num(ex.y);
    (ex.groups as { start: number; end: number; label: string }[]).forEach((gr, k) => {
      const a = num(ex.x0) + gr.start * cw + 1;
      const b = num(ex.x0) + (gr.end + 1) * cw - 1;
      const bb = a + (b - a) * Math.min(1, reveal);
      g.moveTo(a, y + 6)
        .lineTo(a, y)
        .lineTo(bb, y)
        .stroke({ width: 1, color: COLORS.grey });
      if (reveal > 0.9)
        g.moveTo(b, y)
          .lineTo(b, y + 6)
          .stroke({ width: 1, color: COLORS.grey });
      if (b - a > Math.max(34, gr.label.length * 7))
        text(v, `b${k}`, gr.label, { ...GRAPH_LABEL, x: a + 2, y: y - 17 });
    });
    endText(v);
  },
  '7:views': (v, ex) => paintViews(v, ex),
  '7:gauge': (v, ex) => {
    const panel = gfx(v, 'metrics-panel');
    panel.clear();
    const sidebar = ex.sidebar as { x: number; y: number; width: number; height: number };
    panel.roundRect(sidebar.x, sidebar.y, sidebar.width, sidebar.height, 8)
      .fill({ color: COLORS.panel })
      .stroke({ width: 1, color: COLORS.hairline });
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x = num(ex.x);
    const y = num(ex.y);
    const r = num(ex.r, 90);
    g.arc(x, y, r, Math.PI, 2 * Math.PI).stroke({ width: 10, color: COLORS.hairline });
    const ch = num(ex.chance);
    const ca = Math.PI + Math.PI * ch;
    g.moveTo(x + (r - 14) * Math.cos(ca), y + (r - 14) * Math.sin(ca))
      .lineTo(x + (r + 8) * Math.cos(ca), y + (r + 8) * Math.sin(ca))
      .stroke({ width: 2, color: COLORS.ink });
    text(v, 'chance', `chance ${(ch * 100).toFixed(0)}%`, {
      x: x + (r + 24) * Math.cos(ca),
      y: y + (r + 24) * Math.sin(ca),
      ax: ch < 0.4 ? 1 : ch > 0.6 ? 0 : 0.5,
      ay: 1,
      ...GRAPH_TICK,
    });
    text(v, 'lab', str(ex.label), {
      ...GRAPH_LABEL, x, y: y + 34, ax: 0.5, wrap: num(ex.labelWidth, 220), align: 'center',
    });
    text(v, 'folds', `${num(ex.folds)}-fold stratified CV`, {
      x,
      y: y + 64,
      ax: 0.5,
      ...GRAPH_LABEL,
    });
    const sc0 = v.state.needle as Scalar | undefined;
    v.state.valText = text(
      v,
      'val',
      `${((sc0?.x ?? num(ex.value)) * 100).toFixed(1)}% +- ${(num(ex.std) * 100).toFixed(1)}`,
      { ...GRAPH_TITLE, x, y: y + 10, ax: 0.5, size: 19 },
    );
    endText(v);
    const sc = (v.state.needle ??= new Scalar(num(ex.value), 'standard')) as Scalar;
    sc.t = num(ex.value);
    v.state.gx = x;
    v.state.gy = y;
    v.state.gr = r;
    v.state.std = num(ex.std);
  },
  '7:race': (v, ex) => {
    const bars = (ex.bars as { name: string; v: number }[]) ?? [];
    const prev = (v.state.bars as Map<string, Scalar> | undefined) ?? new Map<string, Scalar>();
    const next = new Map<string, Scalar>();
    bars.forEach((b, k) => {
      const s = prev.get(b.name) ?? new Scalar(0, 'standard');
      if (!prev.has(b.name)) s.delayMs = k * 30; // race into position, stagger by rank 30 ms
      s.t = b.v;
      next.set(b.name, s);
    });
    v.state.bars = next;
    v.state.raceEx = ex;
  },
  '7:leak': (v, ex) => {
    const g = gfx(v);
    g.clear();
    beginText(v);
    const x0 = num(ex.x0);
    const x1 = num(ex.x1);
    const y0 = num(ex.y0);
    text(v, 't', 'Leakage check', { ...GRAPH_TITLE, x: x0, y: y0 });
    if (ex.noLearned) {
      text(v, 'n', 'no learned steps selected: only the scaler could leak', {
        x: x0,
        y: y0 + 24,
        ...GRAPH_LABEL,
        wrap: x1 - x0,
      });
    }
    if (ex.shown) {
      const w = x1 - x0 - 90;
      const rows: [string, number][] = [
        ['correct', num(ex.correct)],
        ['leaky', num(ex.leaky)],
      ];
      rows.forEach(([lab, val], k) => {
        const y = y0 + 48 + k * 26;
        g.rect(x0 + 70, y, w * val, 14).fill({ color: k === 0 ? COLORS.teal : COLORS.amber });
        text(v, `l${k}`, lab, { ...GRAPH_LABEL, x: x0, y: y - 1 });
        text(v, `v${k}`, `${(val * 100).toFixed(1)}%`, {
          ...GRAPH_TICK, x: Math.min(x1, x0 + 124 + w * val), y: y - 1, ax: 1,
        });
      });
      const gap = num(ex.gap);
      const xa = x0 + 70 + w * num(ex.correct);
      const xb = x0 + 70 + w * num(ex.leaky);
      g.moveTo(xa, y0 + 98)
        .lineTo(xa, y0 + 104)
        .lineTo(xb, y0 + 104)
        .lineTo(xb, y0 + 98)
        .stroke({ width: 1.5, color: COLORS.ink });
      text(
        v,
        'gap',
        `leaky fit changed accuracy by ${gap >= 0 ? '+' : '-'}${Math.abs(gap).toFixed(1)} points`,
        { ...GRAPH_LABEL, x: x0, y: y0 + 110, wrap: x1 - x0 },
      );
    } else if (!ex.noLearned) {
      text(v, 'h', 'flip the leakage switch to compare correct and leaky fits', {
        x: x0,
        y: y0 + 24,
        ...GRAPH_LABEL,
        wrap: x1 - x0,
      });
    }
    endText(v);
  },
  // ----------------------------------------------------------------- page 8
  '8:codepanel': (v, ex, reveal) => {
    const g = gfx(v);
    g.clear();
    const x0 = num(ex.x0);
    const y0 = num(ex.y0);
    const x1 = num(ex.x1);
    const y1 = num(ex.y1);
    const r = Math.min(1, reveal);
    g.roundRect(x0, y0, x1 - x0, (y1 - y0) * r, 8)
      .fill({ color: 0xfbfefd })
      .stroke({ width: 1.5, color: COLORS.teal });
    // (Re)start the connector animation whenever the settings (chip texts) change.
    const ver = str(ex.version);
    if (v.state.codeVer !== ver) {
      v.state.codeVer = ver;
      v.state.codeT = ex.reduced ? 1e9 : 0;
      v.state.codeReady = !!ex.reduced;
    }
    v.state.codeEx = ex;
  },
};

/** Page 8: teal connectors from each chip to the code panel, one by one, then 0/1 digits stream out of
 *  the junction into the panel; when they finish the code is shown (codeReady). Returns true while moving. */
function animateCodePanel(view: ContainerView, dtMs: number): boolean {
  const ex = view.state.codeEx as Ex | undefined;
  if (!ex) return true; // extras not applied yet (decor still waiting on its delay): keep animating
  const t = ((view.state.codeT as number | undefined) ?? 0) + dtMs;
  view.state.codeT = t;
  let g = view.state.linkG as Graphics | undefined;
  if (!g) {
    g = new Graphics();
    view.root.addChild(g);
    view.state.linkG = g;
    const layer = new Container();
    view.root.addChild(layer);
    view.state.bitLayer = layer;
    // A fixed pool of digit labels (created once, reused).
    const bits: BitmapText[] = [];
    for (let k = 0; k < 36; k++) {
      const b = new BitmapText({
        text: k % 2 ? '1' : '0',
        style: { fontFamily: 'JetBrains Mono', fontSize: 14, fill: 0xffffff },
      });
      b.tint = 0x2bb673;
      b.visible = false;
      layer.addChild(b);
      bits.push(b);
    }
    view.state.bits = bits;
  }
  const anchors = (ex.anchors as { x: number; y: number }[]) ?? [];
  const j = ex.junction as { x: number; y: number };
  const per = 170; // ms between connectors
  const draw = 260; // ms to draw one connector
  const start = 250;
  g.clear();
  anchors.forEach((a, k) => {
    const p = Math.max(0, Math.min(1, (t - start - k * per) / draw));
    if (p <= 0) return;
    // cubic from the chip to the junction, drawn progressively (sampled)
    const cx1 = a.x + (j.x - a.x) * 0.55;
    const n = 24;
    g!.moveTo(a.x, a.y);
    for (let i = 1; i <= Math.ceil(n * p); i++) {
      const u = Math.min(p, i / n);
      const mu = 1 - u;
      const x = mu * mu * mu * a.x + 3 * mu * mu * u * cx1 + 3 * mu * u * u * cx1 + u * u * u * j.x;
      const y = mu * mu * mu * a.y + 3 * mu * mu * u * a.y + 3 * mu * u * u * j.y + u * u * u * j.y;
      g!.lineTo(x, y);
    }
    g!.stroke({ width: 2.5, color: COLORS.teal, alpha: 0.9 });
    g!.circle(a.x, a.y, 4).fill({ color: COLORS.teal });
  });
  const linesDone = start + (anchors.length - 1) * per + draw;
  if (t > linesDone - 60)
    g.circle(j.x, j.y, 7)
      .fill({ color: COLORS.teal })
      .circle(j.x, j.y, 12)
      .stroke({ width: 2, color: 0x2bb673, alpha: 0.6 });
  // Binary stream out of the junction into the panel.
  const bits = view.state.bits as BitmapText[];
  const bt = t - linesDone;
  const streamMs = 650;
  const w = num(ex.x1) - num(ex.x0);
  bits.forEach((b, k) => {
    const born = (k / bits.length) * streamMs * 0.7;
    const life = (bt - born) / 520;
    if (bt < 0 || life < 0 || life > 1) {
      b.visible = false;
      return;
    }
    const ang = (((k * 137) % 100) / 100 - 0.5) * 1.4;
    const dist = life * (w * 0.35 + ((k * 53) % 40));
    b.visible = true;
    b.text = (k * 7 + Math.floor(bt / 90)) % 3 === 0 ? '1' : '0';
    b.position.set(j.x + 10 + Math.cos(ang) * dist, j.y + Math.sin(ang) * dist * 0.8 - 8);
    b.alpha = life < 0.8 ? 1 : (1 - life) * 5;
    b.scale.set(1 + life * 0.4);
  });
  if (bt > streamMs * 0.55) view.state.codeReady = true;
  return bt < streamMs + 400;
}

/** Liang-Barsky clip of a segment to a rectangle. */
function clipSeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: [number, number][] = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e4)) return v.toExponential(1);
  return `${+v.toPrecision(3)}`;
}

function paintViews(v: ContainerView, ex: Ex): void {
  const g = gfx(v);
  g.clear();
  beginText(v);
  const x0 = num(ex.x0);
  const x1 = num(ex.x1);
  const infoY = num(ex.infoY);
  const viewTop = num(ex.y0);
  const y1 = num(ex.y1);
  const my0 = num(ex.my0);
  g.roundRect(x0 - 15, viewTop - 12, x1 - x0 + 27, y1 - viewTop + 16, 8)
    .stroke({ width: 1.5, color: COLORS.teal, alpha: 0.6 });
  // Tab strip (part of the stage; keyboard access through the accessibility overlay).
  const tabs = (ex.tabs as { id: string; label: string; x: number; y: number; w: number }[]) ?? [];
  tabs.forEach((t) => {
    const active = t.id === ex.view;
    if (active)
      g.moveTo(t.x, t.y + 18)
        .lineTo(t.x + t.w, t.y + 18)
        .stroke({ width: 2, color: COLORS.accent });
    text(v, `tab${t.id}`, t.label, {
      x: t.x + 4,
      y: t.y + 2,
      size: 10,
      color: active ? COLORS.accent : COLORS.grey,
    });
  });
  if (ex.tag) text(v, 'tag', str(ex.tag), { x: x1, y: infoY, ax: 1, size: 9, color: COLORS.grey });
  if (ex.pre) text(v, 'pre', 'pre-selection matrix', { x: x0, y: infoY, size: 9, color: COLORS.grey });
  if (ex.traceLabel) {
    text(v, 'trace', str(ex.traceLabel), { ...GRAPH_LABEL, x: x0, y: y1 + 10 });
  }
  const sc = ex.scatter as { lo: [number, number]; hi: [number, number]; x: string; y: string } | null;
  const px0 = x0 + 20;
  const px1 = x1 - 20;
  const py0 = my0 + 20;
  const py1 = y1 - 20;
  if (sc) {
    g.rect(x0, my0, x1 - x0, y1 - my0).stroke({ width: 1, color: COLORS.hairline });
    text(v, 'sx', sc.x, {
      ...GRAPH_LABEL, x: (x0 + x1) / 2, y: y1 + 5, ax: 0.5, wrap: x1 - x0, align: 'center',
    });
    text(v, 'sy', sc.y, {
      x: x0 - 4,
      y: (my0 + y1) / 2,
      ax: 0.5,
      ay: 1,
      ...GRAPH_LABEL,
      rot: -Math.PI / 2,
      wrap: y1 - my0,
      align: 'center',
    });
    const dec = ex.decision as {
      boundary: { w: [number, number]; b: number } | null;
      regions: number[][] | null;
      accuracy: number;
      extent: number[];
    } | null;
    if (dec) {
      const sx = (val: number): number => px0 + ((val - sc.lo[0]) / (sc.hi[0] - sc.lo[0])) * (px1 - px0);
      const sy = (val: number): number => py1 - ((val - sc.lo[1]) / (sc.hi[1] - sc.lo[1])) * (py1 - py0);
      if (dec.regions) {
        const n = dec.regions.length;
        const e = dec.extent;
        for (let iy = 0; iy < n; iy++)
          for (let ix = 0; ix < n; ix++) {
            const cls = dec.regions[iy][ix];
            const vx = e[0] + ((e[1] - e[0]) * ix) / (n - 1);
            const vy = e[2] + ((e[3] - e[2]) * iy) / (n - 1);
            const cw = (px1 - px0) / (n - 1);
            const chh = (py1 - py0) / (n - 1);
            g.rect(sx(vx) - cw / 2, sy(vy) - chh / 2, cw, chh).fill({
              color: CLASS_COLORS[cls % 6],
              alpha: 0.1,
            });
          }
      } else if (dec.boundary) {
        const [w0, w1] = dec.boundary.w;
        const b = dec.boundary.b;
        if (Math.abs(w1) > 1e-12) {
          const ya = -(w0 * sc.lo[0] + b) / w1;
          const yb = -(w0 * sc.hi[0] + b) / w1;
          const seg = clipSeg(sx(sc.lo[0]), sy(ya), sx(sc.hi[0]), sy(yb), x0, my0, x1, y1);
          if (seg)
            g.moveTo(seg[0], seg[1])
              .lineTo(seg[2], seg[3])
              .stroke({ width: 1.5, color: COLORS.ink, alpha: 0.7 });
        } else if (Math.abs(w0) > 1e-12) {
          const xv = -b / w0;
          g.moveTo(sx(xv), py0).lineTo(sx(xv), py1).stroke({ width: 1.5, color: COLORS.ink, alpha: 0.7 });
        }
      }
      text(v, 'acc', `2-feature LDA accuracy ${(dec.accuracy * 100).toFixed(1)}%`, {
        x: x1 - 4,
        y: my0 + 4,
        ax: 1,
        ...GRAPH_LABEL,
        wrap: x1 - x0 - 8,
      });
    }
  }
  const corr = ex.correlation as { names: string[]; matrix: Float32Array } | null;
  if (corr) {
    const n = corr.names.length;
    const s = Math.min((x1 - x0 - 40) / n, (y1 - my0 - 10) / n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        g.rect(x0 + 40 + j * s, my0 + i * s, s + 0.3, s + 0.3).fill({
          color: mix(COLORS.cream, COLORS.accent, corr.matrix[i * n + j] ?? 0),
        });
    text(v, 'cl', `|Pearson r|, top ${n} ranked features`, {
      x: x0 + 40,
      y: my0 + n * s + 6,
      ...GRAPH_LABEL,
    });
  }
  const dist = ex.distribution as { name: string; values: number[]; labels: number[]; classNames: string[] } | null;
  if (dist && dist.values.length) {
    const K = Math.max(...dist.labels) + 1;
    const lo = Math.min(...dist.values);
    const hi = Math.max(...dist.values);
    const vx = (val: number): number => x0 + 40 + ((val - lo) / (hi - lo || 1)) * (x1 - x0 - 60);
    const bandH = (y1 - my0 - 20) / K;
    for (let k = 0; k < K; k++) {
      const vals = dist.values.filter((_, i) => dist.labels[i] === k).sort((a, b) => a - b);
      if (!vals.length) continue;
      const yb = my0 + (k + 1) * bandH;
      const col = CLASS_COLORS[k % 6];
      if (bandH >= 30) {
        text(v, `class${k}`, dist.classNames[k], { ...GRAPH_LABEL, x: x0 + 6, y: yb - bandH + 2 });
      }
      // histogram (20 bins)
      const nb = 20;
      const counts = new Array<number>(nb).fill(0);
      for (const val of vals) counts[Math.min(nb - 1, Math.floor(((val - lo) / (hi - lo || 1)) * nb))]++;
      const cm = Math.max(...counts);
      counts.forEach((cn, b) => {
        const bx = vx(lo + ((hi - lo) * b) / nb);
        const bw = (x1 - x0 - 60) / nb;
        g.rect(bx, yb - (cn / cm) * bandH * 0.45, bw - 1, (cn / cm) * bandH * 0.45).fill({
          color: col,
          alpha: 0.35,
        });
      });
      // violin-style density (Gaussian kernel)
      const sd =
        Math.sqrt(
          vals.reduce((a, b) => a + (b - vals.reduce((x, y) => x + y, 0) / vals.length) ** 2, 0) /
            vals.length,
        ) || 1;
      const bwk = 1.06 * sd * Math.pow(vals.length, -0.2);
      const pts: number[] = [];
      let dmax = 0;
      const dens: number[] = [];
      for (let i = 0; i <= 60; i++) {
        const xv = lo + ((hi - lo) * i) / 60;
        let s = 0;
        for (const val of vals) s += Math.exp(-0.5 * ((xv - val) / bwk) ** 2);
        dens.push(s);
        dmax = Math.max(dmax, s);
      }
      dens.forEach((dv, i) =>
        pts.push(vx(lo + ((hi - lo) * i) / 60), yb - bandH * 0.55 - (dv / dmax) * bandH * 0.3),
      );
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.stroke({ width: 1.2, color: col });
      // box plot
      const q = (p: number): number =>
        vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
      const by = yb - bandH * 0.15;
      g.rect(vx(q(0.25)), by - 5, vx(q(0.75)) - vx(q(0.25)), 10).stroke({ width: 1, color: col });
      g.moveTo(vx(q(0.5)), by - 5)
        .lineTo(vx(q(0.5)), by + 5)
        .stroke({ width: 2, color: col });
      g.moveTo(vx(vals[0]), by)
        .lineTo(vx(q(0.25)), by)
        .moveTo(vx(q(0.75)), by)
        .lineTo(vx(vals[vals.length - 1]), by)
        .stroke({ width: 1, color: col });
    }
    text(v, 'dn', dist.name, {
      ...GRAPH_LABEL, x: x0 + 40, y: y1 + 4, wrap: x1 - x0 - 40,
    });
  }
  endText(v);
}

// ---------------------------------------------------------------------------------------------
function paintElectrode(v: ContainerView, ex: Ex): void {
  const ring = gfx(v, 'ring');
  const body = gfx(v, 'body');
  ring.clear();
  body.clear();
  beginText(v);
  const chip = !!ex.chip;
  const inc = !!ex.included;
  v.state.chip = chip;
  if (chip) {
    body.roundRect(-24, -11, 48, 22, 5).fill({ color: 0xffffff }).stroke({ width: 1.5, color: COLORS.ink });
    if (inc) ring.roundRect(-27, -14, 54, 28, 7).stroke({ width: 6, color: COLORS.teal, alpha: 0.5 });
  } else {
    body
      .circle(0, 0, 50)
      .fill({ color: 0xffffff })
      .stroke({ width: 1.5 * (100 / 30), color: COLORS.ink });
    if (inc)
      ring
        .circle(0, 0, 50 + 6 * (100 / 30))
        .stroke({ width: 6 * (100 / 30), color: COLORS.teal, alpha: 0.5 });
  }
  if (ex.focused) {
    if (chip) ring.roundRect(-29, -16, 58, 32, 8).stroke({ width: 2, color: COLORS.accent });
    else ring.circle(0, 0, 50 + 12 * (100 / 30)).stroke({ width: 2 * (100 / 30), color: COLORS.accent });
  }
  const hidden = !!ex.labelHidden;
  text(v, 'l', str(ex.label), {
    x: 0,
    y: 0,
    ax: 0.5,
    ay: 0.5,
    size: num(ex.labelSize, 10),
    alpha: hidden ? 0 : inc ? 1 : 0.4,
  });
  endText(v);
}

function paintCard(v: ContainerView, ex: Ex): void {
  const g = gfx(v, 'fg');
  const pg = gfx(v, 'pv');
  g.clear();
  pg.clear();
  beginText(v);
  const cat = CATEGORY_COLORS[str(ex.category)] ?? COLORS.teal;
  v.state.cat = cat;
  v.state.chipMode = !!ex.selected;
  v.state.expanded = !!ex.expanded;
  v.state.paneLeft = !!ex.paneLeft;
  const w = num(ex.baseWidth, 200);
  const h = num(ex.baseHeight, 170);
  v.state.baseWidth = w;
  v.state.baseHeight = h;
  paintCardFrame(v);
  if (ex.selected) {
    // In the basket the card becomes a readable chip (drawn at 2x, shown at scale 0.5).
    v.state.preview = null;
    g.circle(-226, 0, 14).fill({ color: cat });
    text(v, 'chip', str(ex.title), { x: -200, y: 0, ay: 0.5, font: 'sans', size: 24, wrap: 440 });
    endText(v);
    return;
  }
  const x0 = -w / 2;
  const y0 = -h / 2;
  const tt = text(v, 'title', str(ex.title), { x: x0 + 10, y: y0 + 8, font: 'serif', size: 13, wrap: w - 20 });
  const ty = y0 + 8 + Math.max(16, tt.height) + 2;
  text(v, 'cat', str(ex.category), {
    x: x0 + w - 10,
    y: y0 + h - 31,
    ax: 1,
    ay: 0.5,
    size: 8,
    color: COLORS.grey,
    alpha: ex.error ? 1 : 0,
  });
  if (ex.recommended)
    text(v, 'rec', str(ex.recommended), { x: x0 + 10, y: y0 + h - 16, size: 8, color: COLORS.accent });
  else text(v, 'cat2', str(ex.category), { x: x0 + 10, y: y0 + h - 16, size: 8, color: cat });
  text(v, 'exp', str(ex.explanation), {
    x: x0 + 10,
    y: ty,
    font: 'sans',
    size: 10,
    color: COLORS.ink,
    wrap: w - 20,
  });
  const err = ex.error as string | null;
  if (err) {
    text(v, 'err', err, { x: x0 + 10, y: y0 + 64, size: 8, color: COLORS.ink, wrap: w - 20 });
  } else {
    const cnt = ex.count as number | null;
    const badge = cnt === null ? '... features' : `${cnt} features`;
    g.roundRect(x0 + w - 86, y0 + h - 40, 76, 18, 9).stroke({ width: 1, color: COLORS.ink });
    text(v, 'badge', badge, { x: x0 + w - 48, y: y0 + h - 31, ax: 0.5, ay: 0.5, size: 9 });
    if (ex.units)
      text(v, 'units', `units: ${str(ex.units)}`, {
        x: x0 + 10,
        y: y0 + h - 40,
        font: 'sans',
        size: 11,
        color: COLORS.ink,
        wrap: Math.max(60, w - 104),
      });
  }
  v.state.preview = ex.preview ?? null;
  v.state.nClasses = num(ex.classColors, 2);
  endText(v);
}

/** Card frame: drawn for the current (spring) width so an expanding card widens smoothly to the right. */
function paintCardFrame(v: ContainerView): void {
  const bg = v.state.bg as Graphics | undefined;
  if (!bg) return;
  bg.clear();
  const cat = (v.state.cat as number | undefined) ?? COLORS.teal;
  if (v.state.chipMode) {
    bg.roundRect(-250, -32, 500, 64, 32).fill({ color: 0xffffff }).stroke({ width: 3, color: cat });
    return;
  }
  const baseWidth = num(v.state.baseWidth, 200);
  const baseHeight = num(v.state.baseHeight, 170);
  const w = Math.max(baseWidth, num(v.state.w, baseWidth));
  const h = Math.max(baseHeight, num(v.state.h, baseHeight));
  const left = v.state.paneLeft ? baseWidth / 2 - w : -baseWidth / 2;
  bg.roundRect(left, -h / 2, w, h, 8)
    .fill({ color: COLORS.panel })
    .stroke({ width: v.state.expanded ? 2 : 1, color: v.state.expanded ? cat : COLORS.hairline });
  bg.roundRect(left, -h / 2, w, 5, 2).fill({ color: cat });
  if (w > baseWidth + 10) {
    const sx = (v.state.paneLeft ? -1 : 1) * (baseWidth / 2 + 4);
    bg.moveTo(sx, -h / 2 + 13).lineTo(sx, h / 2 - 13).stroke({ width: 1, color: COLORS.hairline });
  }
}

function drawPreview(v: ContainerView, dtMs: number): boolean {
  const pv = v.state.preview as Ex | null;
  const pg = v.state.pv as Graphics | undefined;
  if (!pg || !pv) return false;
  pg.clear();
  const w = num(v.state.baseWidth, 200) - 20;
  const x0 = -w / 2;
  const h = Math.min(86, 46 + Math.max(0, num(v.state.baseHeight, 170) - 170) * 0.55);
  const y0 = 1 - h / 2;
  const time = ((v.state.time as number | undefined) ?? 0) + dtMs;
  v.state.time = time;
  const K = num(v.state.nClasses, 2);
  const cls = Math.floor(time / 2000) % K; // classes alternate every 2 s
  let moving = true;
  switch (str(pv.kind)) {
    case 'glass': {
      const lv = (pv.levels as number[]) ?? [];
      const s = (v.state.lvl ??= new Scalar(lv[0] ?? 0, 'soft')) as Scalar;
      s.t = lv[cls] ?? 0;
      s.step(dtMs);
      const gx = -20;
      pg.rect(gx, y0, 40, h).stroke({ width: 1.2, color: COLORS.ink });
      const fh = h * Math.max(0, Math.min(1, s.x));
      pg.rect(gx + 1, y0 + h - fh, 38, fh).fill({ color: CLASS_COLORS[cls % 6], alpha: 0.6 });
      break;
    }
    case 'ellipses': {
      const ang = (v.state.ang ??= new Scalar(0, 'soft')) as Scalar;
      ang.flavor = 'soft';
      ang.t = -num(pv.cspAngle);
      ang.step(dtMs * 0.25);
      for (const [key, col] of [
        ['a', CLASS_COLORS[0]],
        ['b', CLASS_COLORS[1]],
      ] as [string, number][]) {
        const e = pv[key] as { rx: number; ry: number; angle: number };
        const a = e.angle + ang.x;
        const pts: number[] = [];
        for (let i = 0; i <= 40; i++) {
          const t = (i / 40) * Math.PI * 2;
          const ex = e.rx * 20 * Math.cos(t);
          const ey = e.ry * 20 * Math.sin(t);
          pts.push(
            ex * Math.cos(a) - ey * Math.sin(a),
            y0 + h / 2 + ex * Math.sin(a) + ey * Math.cos(a),
          );
        }
        pg.poly(pts).stroke({ width: 1.2, color: col });
      }
      break;
    }
    case 'gauges': {
      const mean = (pv.mean as number[]) ?? [];
      const mn = (pv.min as number[]) ?? [];
      const mx = (pv.max as number[]) ?? [];
      const lg = (pv.log as boolean[]) ?? [];
      for (let k = 0; k < 3; k++) {
        const cx = x0 + ((k + 0.5) * w) / 3;
        const cy = y0 + h - 6;
        pg.arc(cx, cy, 22, Math.PI, 2 * Math.PI).stroke({ width: 3, color: COLORS.hairline });
        const f = lg[k]
          ? (Math.log(mean[k]) - Math.log(mn[k] || 1e-9)) /
            (Math.log(mx[k] || 1) - Math.log(mn[k] || 1e-9) || 1)
          : (mean[k] - mn[k]) / (mx[k] - mn[k] || 1);
        const a = Math.PI + Math.PI * Math.max(0, Math.min(1, f));
        pg.moveTo(cx, cy)
          .lineTo(cx + 20 * Math.cos(a), cy + 20 * Math.sin(a))
          .stroke({ width: 1.5, color: COLORS.ink });
      }
      moving = false;
      break;
    }
    case 'tfmap':
    case 'tfrect': {
      const map = (pv.map as number[][]) ?? [];
      const nf = map.length;
      const nt = nf ? map[0].length : 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const r of map)
        for (const val of r) {
          lo = Math.min(lo, val);
          hi = Math.max(hi, val);
        }
      for (let i = 0; i < nf; i++)
        for (let j = 0; j < nt; j++)
          pg.rect(x0 + (j * w) / nt, y0 + h - ((i + 1) * h) / nf, w / nt + 0.4, h / nf + 0.4).fill({
            color: mix(COLORS.cream, COLORS.accent, (map[i][j] - lo) / (hi - lo || 1)),
          });
      moving = false;
      break;
    }
    case 'matrix': {
      const M = (pv.matrix as number[][]) ?? [];
      const n = M.length;
      let mx = 0;
      for (const r of M) for (const val of r) mx = Math.max(mx, Math.abs(val));
      const s = Math.min(h / n, 6);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          pg.rect((j - n / 2) * s, y0 + i * s, s - 0.5, s - 0.5).fill({
            color: mix(COLORS.cream, COLORS.accent, Math.abs(M[i][j]) / (mx || 1)),
          });
      moving = false;
      break;
    }
    case 'meters':
    case 'steps':
    case 'noise':
    case 'psd':
    case 'pair': {
      const wave = (pv.wave as number[]) ?? (pv.psd as number[]) ?? [];
      if (wave.length) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const val of wave) {
          lo = Math.min(lo, val);
          hi = Math.max(hi, val);
        }
        pg.moveTo(x0, y0 + h - ((wave[0] - lo) / (hi - lo || 1)) * h);
        for (let i = 1; i < wave.length; i++)
          pg.lineTo(x0 + (i / (wave.length - 1)) * w, y0 + h - ((wave[i] - lo) / (hi - lo || 1)) * h);
        pg.stroke({ width: 1, color: COLORS.ink });
        const steps = pv.steps as number[] | undefined;
        if (steps) {
          const bs = num(pv.binSamples, 1);
          steps.forEach((sv, j) => {
            const xa = x0 + ((j * bs) / (wave.length - 1)) * w;
            const xb = x0 + (((j + 1) * bs) / (wave.length - 1)) * w;
            const yy = y0 + h - ((sv - lo) / (hi - lo || 1)) * h;
            pg.moveTo(xa, yy).lineTo(xb, yy).stroke({ width: 2, color: COLORS.accent });
          });
        }
      }
      const pc = pv.perClass as { left: number; right: number }[] | undefined;
      if (pc) {
        const mx = Math.max(...pc.flatMap((p) => [p.left, p.right]), 1e-12);
        const p = pc[cls % pc.length];
        pg.rect(-40, y0 + h - (p.left / mx) * h, 30, (p.left / mx) * h).fill({
          color: CLASS_COLORS[cls % 6],
          alpha: 0.7,
        });
        pg.rect(10, y0 + h - (p.right / mx) * h, 30, (p.right / mx) * h).fill({
          color: CLASS_COLORS[cls % 6],
          alpha: 0.35,
        });
      }
      const rows = pv.rows as { noise: number; higuchi: number | null }[] | undefined;
      if (rows) {
        rows.forEach((r, k) => {
          const hv = r.higuchi ?? 1;
          const stride = w / rows.length;
          pg.rect(x0 + k * stride, y0 + h - (hv - 1) * h, stride * 0.76, (hv - 1) * h).fill({
            color: COLORS.accent,
            alpha: 0.5,
          });
        });
      }
      moving = !!pc;
      break;
    }
    default:
      moving = false;
  }
  return moving;
}

function paintChip(v: ContainerView, ex: Ex): void {
  const g = gfx(v);
  g.clear();
  beginText(v);
  const w = num(ex.w, 270);
  const h = num(ex.h, 44);
  g.roundRect(-w / 2, -h / 2, w, h, 10)
    .fill({ color: 0xffffff })
    .stroke({ width: 1.5, color: COLORS.teal });
  g.roundRect(-w / 2, -h / 2, 6, h, 3).fill({ color: COLORS.teal });
  g.circle(-w / 2 + 24, 0, 12).fill({ color: COLORS.teal });
  text(v, 'p', `${num(ex.page)}`, { x: -w / 2 + 24, y: 0, ax: 0.5, ay: 0.5, size: 12, color: 0xffffff });
  text(v, 't', str(ex.text), { x: -w / 2 + 46, y: 0, ay: 0.5, size: 13, wrap: w - 60 });
  endText(v);
}

function paintRail(v: ContainerView, ex: Ex): void {
  beginText(v);
  text(v, 'l', str(ex.label), {
    x: 0,
    y: 18,
    ax: 0.5,
    size: 9,
    color: ex.active ? COLORS.teal : COLORS.grey,
  });
  endText(v);
  v.state.railScript = !!ex.script;
  v.state.railActive = !!ex.active;
  v.state.railPage = num(ex.page, 1);
}

/** One small line icon per page (about 14 px), centred on (cx, cy). */
function railIcon(g: Graphics, page: number, cx: number, cy: number, color: number): void {
  const st = { width: 1.6, color };
  switch (page) {
    case 1: // load: tray with a down arrow
      g.moveTo(cx - 7, cy + 1)
        .lineTo(cx - 7, cy + 6)
        .lineTo(cx + 7, cy + 6)
        .lineTo(cx + 7, cy + 1)
        .stroke(st);
      g.moveTo(cx, cy - 7)
        .lineTo(cx, cy + 2)
        .moveTo(cx - 3.5, cy - 1.5)
        .lineTo(cx, cy + 2)
        .lineTo(cx + 3.5, cy - 1.5)
        .stroke(st);
      break;
    case 2: // time window: brackets around a wave
      g.moveTo(cx - 4, cy - 7)
        .lineTo(cx - 7, cy - 7)
        .lineTo(cx - 7, cy + 7)
        .lineTo(cx - 4, cy + 7)
        .stroke(st);
      g.moveTo(cx + 4, cy - 7)
        .lineTo(cx + 7, cy - 7)
        .lineTo(cx + 7, cy + 7)
        .lineTo(cx + 4, cy + 7)
        .stroke(st);
      g.moveTo(cx - 4, cy)
        .quadraticCurveTo(cx - 2, cy - 5, cx, cy)
        .quadraticCurveTo(cx + 2, cy + 5, cx + 4, cy)
        .stroke({ width: 1.3, color });
      break;
    case 3: // channels: head with electrodes
      g.circle(cx, cy + 1, 6.5).stroke(st);
      g.moveTo(cx - 2, cy - 5)
        .lineTo(cx, cy - 8)
        .lineTo(cx + 2, cy - 5)
        .stroke({ width: 1.2, color });
      for (const [dx, dy] of [
        [-3, 1],
        [0, 1],
        [3, 1],
        [0, -2.5],
      ])
        g.circle(cx + dx, cy + dy, 1.2).fill({ color });
      break;
    case 4: // frequency: sine wave
      g.moveTo(cx - 8, cy);
      for (let k = 1; k <= 16; k++) g.lineTo(cx - 8 + k, cy - 5 * Math.sin((k / 16) * Math.PI * 4));
      g.stroke(st);
      break;
    case 5: // features: a small basket
      g.poly([cx - 7, cy - 1, cx + 7, cy - 1, cx + 5, cy + 7, cx - 5, cy + 7]).stroke(st);
      g.moveTo(cx - 4, cy - 1)
        .quadraticCurveTo(cx, cy - 9, cx + 4, cy - 1)
        .stroke(st);
      g.moveTo(cx - 6, cy + 3)
        .lineTo(cx + 6, cy + 3)
        .stroke({ width: 1, color });
      break;
    case 6: // transform: bell curve
      g.moveTo(cx - 8, cy + 6);
      for (let k = 0; k <= 16; k++) {
        const t = (k - 8) / 3;
        g.lineTo(cx - 8 + k, cy + 6 - 12 * Math.exp(-0.5 * t * t));
      }
      g.stroke(st);
      break;
    case 7: // matrix: 3 x 3 grid
      g.rect(cx - 7, cy - 7, 14, 14).stroke(st);
      g.moveTo(cx - 2.3, cy - 7)
        .lineTo(cx - 2.3, cy + 7)
        .moveTo(cx + 2.3, cy - 7)
        .lineTo(cx + 2.3, cy + 7)
        .stroke({ width: 1, color });
      g.moveTo(cx - 7, cy - 2.3)
        .lineTo(cx + 7, cy - 2.3)
        .moveTo(cx - 7, cy + 2.3)
        .lineTo(cx + 7, cy + 2.3)
        .stroke({ width: 1, color });
      break;
    default: // export: code chevrons
      g.moveTo(cx - 3, cy - 5)
        .lineTo(cx - 8, cy)
        .lineTo(cx - 3, cy + 5)
        .stroke(st);
      g.moveTo(cx + 3, cy - 5)
        .lineTo(cx + 8, cy)
        .lineTo(cx + 3, cy + 5)
        .stroke(st);
      g.moveTo(cx + 1.5, cy - 7)
        .lineTo(cx - 1.5, cy + 7)
        .stroke({ width: 1.2, color });
  }
}

// ---------------------------------------------------------------------------------------------
export function createPainters(): Painters {
  return {
    init(kind: Kind, _id: string, view: ContainerView) {
      if (kind === 'card') {
        const tl = new Container();
        view.state.highResolutionText = true;
        view.state.textLayer = tl;
        gfx(view, 'bg');
        gfx(view, 'pv');
        gfx(view, 'fg');
        view.root.addChild(tl);
      }
      if (kind === 'rail') gfx(view, 'mini');
    },
    paint(kind, id, view, extra, reveal) {
      if (kind === 'decor' && !extra) return; // parked decor carries no extras: nothing to draw
      const ex = extra ?? {};
      if (kind === 'decor') {
        const [, pg, name] = id.split(':');
        DECOR[`${pg}:${name}`]?.(view, ex, reveal);
      } else if (kind === 'electrode') paintElectrode(view, ex);
      else if (kind === 'card') paintCard(view, ex);
      else if (kind === 'chip') paintChip(view, ex);
      else if (kind === 'rail') paintRail(view, ex);
    },
    tint(kind, _id, view, color) {
      if (kind === 'electrode') {
        const b = view.state.body as Graphics | undefined;
        if (b) b.tint = color;
      }
    },
    size(kind, _id, view, w, h) {
      if (kind === 'card') {
        view.state.w = w;
        view.state.h = h;
        paintCardFrame(view);
        return;
      }
      if (kind === 'electrode') {
        const b = view.state.body as Graphics | undefined;
        const r = view.state.ring as Graphics | undefined;
        if (view.state.chip) {
          b?.scale.set(1, 1);
          r?.scale.set(1, 1);
        } else {
          b?.scale.set(w / 100, h / 100);
          r?.scale.set(w / 100, h / 100);
        }
      } else if (kind === 'rail') {
        const g = view.state.mini as Graphics;
        g.clear();
        const active = !!view.state.railActive;
        // Page icon only (no data miniature box).
        if (active) g.circle(0, -2, 14).fill({ color: COLORS.teal });
        else g.circle(0, -2, 13).fill({ color: COLORS.tealLight }).stroke({ width: 1, color: COLORS.teal });
        railIcon(g, num(view.state.railPage, 1), 0, -2, active ? 0xffffff : COLORS.teal);
        if (active) g.circle(0, -2, 19).stroke({ width: 2, color: COLORS.teal });
        void w;
        void h;
      }
    },
    animate(kind, id, view, dtMs) {
      if (kind === 'card') return drawPreview(view, dtMs);
      if (id === 'decor:7:gauge') {
        const s = view.state.needle as Scalar | undefined;
        if (!s) return false;
        const moving = s.step(dtMs);
        let g = view.state.needleG as Graphics | undefined;
        if (!g) {
          g = new Graphics();
          view.root.addChild(g);
          view.state.needleG = g;
        }
        const x = num(view.state.gx);
        const y = num(view.state.gy);
        const r = num(view.state.gr, 90);
        const a = Math.PI + Math.PI * Math.max(0, Math.min(1, s.x));
        g.clear();
        g.arc(x, y, r, Math.PI, a).stroke({ width: 10, color: COLORS.teal });
        g.moveTo(x, y)
          .lineTo(x + (r - 8) * Math.cos(a), y + (r - 8) * Math.sin(a))
          .stroke({ width: 2.5, color: COLORS.ink });
        g.circle(x, y, 4).fill({ color: COLORS.ink });
        const vt = view.state.valText as BitmapText | undefined;
        if (vt) vt.text = `${(s.x * 100).toFixed(1)}% +- ${(num(view.state.std) * 100).toFixed(1)}`;
        return moving;
      }
      if (id === 'decor:7:race') {
        const bars = view.state.bars as Map<string, Scalar> | undefined;
        const ex = view.state.raceEx as Ex | undefined;
        if (!bars || !ex) return false;
        const g = gfx(view);
        g.clear();
        beginText(view);
        const x0 = num(ex.x0);
        const x1 = num(ex.x1);
        const y0 = num(ex.y0);
        const bh = num(ex.barHeight);
        const labelStride = Math.max(1, Math.ceil(14 / (bh + 3)));
        text(view, 't', 'Feature race · separability (0–1)', { ...GRAPH_LABEL, x: x0, y: y0 });
        let moving = false;
        let k = 0;
        for (const [name, s] of bars) {
          moving = s.step(dtMs) || moving;
          const y = y0 + num(ex.headerHeight) + k * (bh + 3);
          const w = (x1 - x0 - 120) * Math.max(0, Math.min(1, s.x));
          g.rect(x0 + 120, y, w, bh).fill({
            color: name === ex.xFeature ? COLORS.accent : COLORS.teal,
            alpha: 0.8,
          });
          if (k % labelStride === 0) {
            text(view, `n${k}`, name.length > 15 ? name.slice(0, 14) + '…' : name, {
              ...GRAPH_LABEL, x: x0 + 114, y: y + bh / 2, ax: 1, ay: 0.5, size: 12,
            });
          }
          view.state[`bar:${k}`] = { x: x0, y, w: x1 - x0, h: bh, name };
          k++;
        }
        view.state.barCount = k;
        endText(view);
        return moving;
      }
      if (id === 'decor:5:odometer') return animateOdometer(view, dtMs);
      if (id === 'decor:8:codepanel') return animateCodePanel(view, dtMs);
      return false;
    },
  };
}

function animateOdometer(view: ContainerView, dtMs: number): boolean {
  const ex = view.state.odoEx as Ex | undefined;
  if (!ex) return false;
  const s = (view.state.odo ??= new Scalar(0, 'soft')) as Scalar;
  s.t = num(ex.value);
  const moving = s.step(dtMs);
  let g = view.state.odoG as Graphics | undefined;
  if (!g) {
    g = new Graphics();
    view.root.addChild(g);
    view.state.odoG = g;
    const mask = new Graphics();
    view.root.addChild(mask);
    view.state.odoMask = mask;
    const tl = new Container();
    view.root.addChild(tl);
    view.state.textLayer = tl;
    tl.mask = mask;
  }
  const x = num(ex.x);
  const y = num(ex.y);
  const digits = Math.max(1, String(Math.round(Math.max(num(ex.value), s.x))).length);
  const dw = 13;
  const bw = Math.max(40, digits * dw + 20);
  const mask = view.state.odoMask as Graphics;
  mask
    .clear()
    .rect(x - bw / 2, y - 14, bw, 28)
    .fill({ color: 0xffffff });
  // White count bubble on the teal header (digits roll inside it).
  g.clear()
    .roundRect(x - bw / 2, y - 20, bw, 40, 20)
    .fill({ color: 0xffffff });
  beginText(view);
  // Digits roll: each digit shows its value and the next one, offset by the fractional part.
  const val = Math.max(0, s.x);
  for (let k = 0; k < digits; k++) {
    const place = Math.pow(10, digits - 1 - k);
    const dv = val / place;
    const d0 = Math.floor(dv) % 10;
    const frac = k === digits - 1 ? dv - Math.floor(dv) : Math.max(0, (dv - Math.floor(dv)) * 10 - 9);
    const cx = x - (digits * dw) / 2 + dw * (k + 0.5);
    text(view, `d${k}a`, `${d0}`, {
      x: cx,
      y: y - frac * 28,
      ax: 0.5,
      ay: 0.5,
      size: 20,
      color: COLORS.tealDark,
    });
    text(view, `d${k}b`, `${(d0 + 1) % 10}`, {
      x: cx,
      y: y + 28 - frac * 28,
      ax: 0.5,
      ay: 0.5,
      size: 20,
      color: COLORS.tealDark,
    });
  }
  endText(view);
  return moving;
}

/** Odometer extras are read by the animate hook. */
export function setOdometer(view: ContainerView, ex: Ex): void {
  view.state.odoEx = ex;
}
DECOR['5:odometer'] = (v, ex) => {
  setOdometer(v, ex);
  const map = v.state.texts as Map<string, BitmapText> | undefined;
  void map;
};
