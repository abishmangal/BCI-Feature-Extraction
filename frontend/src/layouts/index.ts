// Layout dispatcher plus the pure helpers the transition table needs (section 5.2).
import type { Layout } from '../engine/types';
import type { TransitionHelpers } from '../engine/transitions';
import type { OrderTables } from '../engine/stagger';
import { REG, type LayoutCtx } from './common';
import { layout as l1 } from './page1';
import { layout as l2 } from './page2';
import { layout as l3, p3Geo } from './page3';
import { layout as l4, inBand, p4Geo } from './page4';
import { layout as l5, p5Geo } from './page5';
import { layout as l6, inspectedColumn } from './page6';
import { layout as l7, p7Geo } from './page7';
import { FAMILY_IDS } from '../engine/registry';

import { layout as l8 } from './page8';

const LAYOUTS = [l1, l2, l3, l4, l5, l6, l7, l8];

export function layoutFor(page: number, c: LayoutCtx): Layout {
  return LAYOUTS[page - 1]({ ...c, page });
}

export function helpersFor(c: LayoutCtx): TransitionHelpers {
  const w = c.stageSize.width;
  const h = c.stageSize.stageHeight;
  const d = c.data;
  const g4 = d ? p4Geo(c) : null;
  const sel = new Set(c.settings.channels.map((s) => s.toLowerCase()));
  const incList = d ? d.channels.map((_, i) => i).filter((i) => sel.has(d.channels[i].toLowerCase())) : [];
  const incOrd = new Map<number, number>();
  incList.forEach((ch, k) => incOrd.set(ch, k));
  let bandCentre = { x: w / 2, y: h / 2 };
  if (g4) {
    const x0 = g4.fx(Math.max(1, c.settings.band.low));
    const x1 = g4.fx(Math.min(g4.fmax, c.settings.band.high));
    bandCentre = { x: (x0 + x1) / 2, y: g4.y1 - 60 };
  }
  const bandRank: number[] = [];
  if (g4) {
    let r = 0;
    for (let k = 0; k < g4.nBins; k++) bandRank.push(inBand(c, g4.binF(k)) ? r++ : -1);
  }
  const g7 = d ? p7Geo(c) : null;
  const vs = c.slots.val;
  const T = Math.max(1, vs.trials.length);
  const [va] = REG.range('val');
  const [ca] = REG.range('card');
  const [cha] = REG.range('chip');
  const jcol = inspectedColumn(c);
  return {
    stageW: w,
    stageH: h,
    shownCount: c.slots.shown.length,
    sineInBand: (k) => (g4 ? inBand(c, g4.binF(k)) : false),
    sineBandRank: (k) => bandRank[k] ?? -1,
    prism: g4
      ? { x: g4.prism.x, y: g4.prism.y, exitX: g4.prism.exitX }
      : { x: w / 2, y: h / 2, exitX: w / 2 },
    bandCentre,
    basket: d ? p5Geo(c).basket : { x: w / 2, y: h / 2, w: 1, h: 1 },
    matrixCentre: g7 ? { x: (g7.vx0 + g7.vx1) / 2, y: (g7.my0 + g7.vy1) / 2 } : { x: w / 2, y: h / 2 },
    rowCentreX: g7 ? (g7.vx0 + g7.vx1) / 2 : w / 2,
    channelIncluded: (ch) => (d ? sel.has(d.channels[ch]?.toLowerCase() ?? '') : false),
    includedOrdinal: (ch) => incOrd.get(ch) ?? 0,
    includedCount: incList.length,
    valColumn: (i) => {
      const s = i - va;
      const f = Math.floor(s / T);
      return g7 ? f - g7.offset : f;
    },
    valInspected: (i) => Math.floor((i - va) / T) === jcol,
    cardSelected: (i) => c.settings.features.includes(FAMILY_IDS[i - ca]),
    chipIndex: (i) => i - cha,
    jitter: (slot) => {
      let x = (slot + 1) * 2654435761;
      x = (x ^ (x >>> 13)) >>> 0;
      return (x % 2000) / 1000 - 1;
    },
  };
}

export function tablesFor(c: LayoutCtx): OrderTables {
  const d = c.data;
  const out: OrderTables = {};
  if (d) {
    const g = p3Geo(c);
    const rank = new Int32Array(d.channels.length);
    g.order.forEach((ch, k) => (rank[ch] = k));
    out.channelRank = rank;
    const g5 = p5Geo(c);
    const [ca] = REG.range('card');
    const cr = new Map<number, number>();
    g5.visible.forEach((f, k) => cr.set(ca + FAMILY_IDS.indexOf(f), k));
    c.settings.features.forEach((f, k) => cr.set(ca + FAMILY_IDS.indexOf(f), g5.visible.length + k));
    out.cardRank = cr;
  }
  return out;
}
