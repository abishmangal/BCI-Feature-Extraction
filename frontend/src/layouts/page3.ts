// Page 3: Channels. Top-down head with ONLY the dataset's electrodes (positioned on the head, others in a tray).
import type { Layout } from '../engine/types';
import { COLORS } from '../engine/colors';
import { POOL } from '../engine/registry';
import { type LayoutCtx, H, TOP, W, classColor, finish, setDecor } from './common';
import { p2Geo } from './page2';

export interface P3Geo {
  cx: number;
  cy: number;
  R: number;
  radius: number;
  labelSize: number;
  labelsHoverOnly: boolean;
  pos: ({ x: number; y: number } | null)[];
  tray: { x: number; y: number }[];
  trayRect: { x0: number; y0: number; x1: number; y1: number } | null;
  chipW: number;
  chipH: number;
  /** ordered channel indices: posterior to anterior, then left to right; tray chips last. */
  order: number[];
}

export function p3Geo(c: LayoutCtx): P3Geo {
  const d = c.data!;
  const N = d.channels.length;
  const nUn = d.positions.filter((p) => p === null).length;
  const hasTray = nUn > 0;
  const w = W(c);
  const h = H(c);
  const top = TOP + 16;
  const bottom = h - (hasTray ? 126 : 34);
  const edge = 20;
  const target = 1.5 * (N > 40 ? 520 : hasTray ? 380 : 440);
  const diam = Math.max(1, 0.75 * Math.min(target, w - 2 * edge, bottom - top));
  const R = diam / 2;
  const center = c.stageSize.viewportCenter ?? { x: w / 2, y: h / 2 };
  const cx = Math.max(edge + R, Math.min(center.x - Math.min(60, w * 0.075), w - edge - R));
  const cy = Math.max(top + R, Math.min(center.y, bottom - R));
  const pos = d.positions.map((p) => (p ? { x: cx + p[0] * R, y: cy - p[1] * R } : null));
  let dmin = Infinity;
  const pts = pos.filter((p): p is { x: number; y: number } => p !== null);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      dmin = Math.min(dmin, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  const base = N <= 40 ? 15 : 11;
  const want = Math.min(base, 0.45 * dmin);
  const radius = Math.max(9, want);
  const chipW = 48;
  const chipH = 22;
  const tray: { x: number; y: number }[] = [];
  let trayRect: P3Geo['trayRect'] = null;
  if (hasTray) {
    const y0 = cy + R + 44;
    const perRow = Math.max(1, Math.floor((w - 120) / (chipW + 6)));
    const rows = Math.ceil(nUn / perRow);
    const used = Math.min(nUn, perRow);
    const halfWidth = (used * (chipW + 6) - 6) / 2;
    const trayCenter = Math.max(halfWidth + 8, Math.min(cx, w - halfWidth - 8));
    const x0 = trayCenter - halfWidth + chipW / 2;
    for (let k = 0; k < nUn; k++) {
      const row = Math.floor(k / perRow);
      const col = k % perRow;
      tray.push({ x: x0 + col * (chipW + 6), y: y0 + 14 + row * (chipH + 6) - c.ui.scrollY * 0 });
    }
    trayRect = {
      x0: x0 - chipW / 2 - 8,
      y0,
      x1: x0 + (used - 1) * (chipW + 6) + chipW / 2 + 8,
      y1: y0 + Math.min(90, 14 + rows * (chipH + 6)),
    };
  }
  const positioned = d.channels.map((_, i) => i).filter((i) => d.positions[i] !== null);
  positioned.sort((a, b) => {
    const pa = d.positions[a]!;
    const pb = d.positions[b]!;
    return pa[1] - pb[1] || pa[0] - pb[0] || a - b;
  });
  const unpos = d.channels.map((_, i) => i).filter((i) => d.positions[i] === null);
  return {
    cx,
    cy,
    R,
    radius,
    labelSize: N <= 40 ? 10 : 8,
    labelsHoverOnly: want < 9,
    pos,
    tray,
    trayRect,
    chipW,
    chipH,
    order: [...positioned, ...unpos],
  };
}

/** Screen position of channel i (head position or tray slot). */
export function channelXY(g: P3Geo, c: LayoutCtx, i: number): { x: number; y: number } {
  const p = g.pos[i];
  if (p) return p;
  const d = c.data!;
  let k = 0;
  for (let j = 0; j < i; j++) if (d.positions[j] === null) k++;
  return g.tray[k];
}

export function nearestLinks(g: P3Geo, inc: number[]): [number, number, number, number][] {
  const seg: [number, number, number, number][] = [];
  const seen = new Set<string>();
  const pts = inc.map((i) => ({ i, p: g.pos[i] })).filter((o) => o.p !== null) as {
    i: number;
    p: { x: number; y: number };
  }[];
  for (const a of pts) {
    const near = pts
      .filter((b) => b.i !== a.i)
      .map((b) => ({ b, d: Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) }))
      .sort((u, v) => u.d - v.d || u.b.i - v.b.i)
      .slice(0, 2);
    for (const { b } of near) {
      const key = a.i < b.i ? `${a.i}-${b.i}` : `${b.i}-${a.i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seg.push([a.p.x, a.p.y, b.p.x, b.p.y]);
    }
  }
  return seg;
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const d = c.data;
  if (!d) return finish(m, c);
  const g = p3Geo(c);
  const sel = new Set(c.settings.channels.map((s) => s.toLowerCase()));
  const inc = d.channels.map((_, i) => i).filter((i) => sel.has(d.channels[i].toLowerCase()));
  const nInc = inc.length;
  const focus = c.ui.focusChannel;
  const res = c.backendResults.channels;
  const values = res?.map.values;
  const unit = res?.map.unit ?? '';
  d.channels.forEach((name, i) => {
    const p = channelXY(g, c, i);
    const isInc = sel.has(name.toLowerCase());
    const chip = g.pos[i] === null;
    const r = isInc ? g.radius : 7;
    const focused = focus === name;
    const val = values ? values[i] : null;
    m.set(`electrode:${i}`, {
      x: p.x,
      y: p.y,
      w: chip ? g.chipW : 2 * r,
      h: chip ? g.chipH : 2 * r,
      rotation: 0,
      scaleX: focused ? 1.4 : 1,
      scaleY: focused ? 1.4 : 1,
      alpha: 1,
      color: isInc ? COLORS.scalp : COLORS.excluded,
      extra: {
        label: name,
        included: isInc,
        chip,
        labelSize: focused ? Math.max(12, g.labelSize) : g.labelSize,
        labelHidden: g.labelsHoverOnly && focus !== name,
        focused,
        value: val,
        unit,
        region: d.regions[i],
      },
    });
    const sparkOn = isInc && (nInc <= 16 || focus === name);
    m.set(`spark:${i}`, {
      x: p.x + (chip ? g.chipW / 2 : r) + 4,
      y: p.y,
      w: 60,
      h: 20,
      rotation: 0,
      scaleX: isInc ? 1 : 0,
      scaleY: 1,
      alpha: sparkOn ? 1 : 0,
      color: COLORS.ink,
      extra: { channel: i },
    });
  });
  // Meaningful parking: ribbons and strips collapse onto their channel's electrode (2 -> 3).
  const nCh = c.slots.nCh;
  const shown = c.slots.shown;
  for (let r = 0; r < shown.length; r++) {
    for (let ch = 0; ch < nCh; ch++) {
      const s = r * nCh + ch;
      if (s >= POOL.ribbon) break;
      const p = channelXY(g, c, ch);
      m.set(`ribbon:${s}`, {
        x: p.x,
        y: p.y,
        w: 60,
        h: 10,
        rotation: 0,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
        color: classColor(d.labels[shown[r]]),
        winStart: 0,
        winEnd: 1,
      });
      m.set(`strip:${s * 2}`, { x: p.x, y: p.y, w: 4, h: 1, scaleX: 1, scaleY: 1, alpha: 0 });
      m.set(`strip:${s * 2 + 1}`, { x: p.x, y: p.y, w: 4, h: 1, scaleX: 1, scaleY: 1, alpha: 0 });
    }
  }
  // Dots shrink toward the mini-plot corner.
  const g2 = p2Geo(c);
  for (let r = 0; r < shown.length; r++)
    m.set(`dot:${r}`, {
      x: g2.mini.x0 + g2.mini.width,
      y: g2.mini.y0 + g2.mini.height,
      w: 5,
      h: 5,
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
    });

  const head = { cx: g.cx, cy: g.cy, R: g.R };
  const lay = d.layout;
  const tag =
    lay.n_in_tray > 0 ? `${lay.label}, ${lay.n_on_head} on head, ${lay.n_in_tray} in tray` : lay.label;
  setDecor(m, 3, 'scalp', { extra: head });
  setDecor(m, 3, 'head', { extra: { ...head, tag } });
  setDecor(m, 3, 'nose', { extra: { ...head, pivot: { x: g.cx, y: g.cy - g.R } } });
  setDecor(m, 3, 'ears', { extra: { ...head, pivot: { x: g.cx, y: g.cy } } });
  setDecor(m, 3, 'cap', { extra: head });
  setDecor(m, 3, 'mesh', { extra: head });
  const mapOn = c.settings.map.visible && !!res && !res.map.error && !!res.grid;
  setDecor(m, 3, 'heat', {
    alpha: mapOn ? c.settings.map.opacity / 100 : 0,
    extra: {
      ...head,
      grid: res?.grid ?? null,
      vmin: res?.map.vmin ?? 0,
      vmax: res?.map.vmax ?? 1,
      diverging: res?.map.diverging ?? false,
      ramp: rampFor(c),
      version: res?.hash ?? '',
    },
  });
  setDecor(m, 3, 'links', { extra: { segments: nearestLinks(g, inc) } });
  setDecor(m, 3, 'legend', {
    alpha: res && !res.map.error && c.settings.map.visible ? 1 : 0,
    extra: {
      x: 40,
      y: H(c) - 120,
      name: res?.map.name ?? '',
      unit,
      note: res?.map.note ?? '',
      vmin: res?.map.vmin ?? 0,
      vmax: res?.map.vmax ?? 1,
      ramp: rampFor(c),
      diverging: res?.map.diverging ?? false,
    },
  });
  setDecor(m, 3, 'tray', {
    alpha: g.trayRect ? 1 : 0,
    extra: { rect: g.trayRect, label: 'Unpositioned channels (no montage position)' },
  });
  return finish(m, c);
}

export function rampFor(c: LayoutCtx): { from: number; to: number; mid?: number } {
  const mp = c.settings.map;
  const K = c.data?.classNames.length ?? 2;
  if (mp.mapClass === 'diff' && (mp.metric === 'bandpower_change' || mp.metric === 'snr'))
    return {
      from: classColor(Math.min(K - 1, mp.pair.b)),
      mid: COLORS.cream,
      to: classColor(Math.min(K - 1, mp.pair.a)),
    };
  if (mp.metric === 'separability_bandpower' || mp.metric === 'separability_amplitude')
    return { from: COLORS.cream, to: COLORS.accent };
  const k = typeof mp.mapClass === 'number' ? mp.mapClass : 0;
  return { from: COLORS.cream, to: classColor(k) };
}
