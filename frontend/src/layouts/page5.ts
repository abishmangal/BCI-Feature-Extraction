// Page 5: Choose features. 12 family cards in a clipped, scrollable 3-column grid, plus the feature basket.
import type { Layout } from '../engine/types';
import { COLORS } from '../engine/colors';
import { FAMILY_IDS, type FamilyId } from '../engine/registry';
import { type LayoutCtx, H, PAD, TOP, W, finish } from './common';
import { inBand, p4Geo } from './page4';

export const CATEGORY: Record<FamilyId, string> = {
  time_stats: 'Time',
  window_means: 'Time',
  hjorth: 'Time',
  complexity: 'Time',
  band_power: 'Frequency',
  spectral_features: 'Frequency',
  wavelet: 'Time-frequency',
  tf_regions: 'Time-frequency',
  csp: 'Spatial',
  covariance: 'Spatial',
  asymmetry: 'Spatial',
  autoencoder: 'Learned',
};
export const TITLES: Record<FamilyId, string> = {
  band_power: 'Band power',
  csp: 'CSP (spatial filters)',
  hjorth: 'Hjorth parameters',
  wavelet: 'Wavelet energy',
  covariance: 'Covariance (Riemannian)',
  time_stats: 'Time-domain statistics',
  window_means: 'Windowed means (ERP-style)',
  spectral_features: 'Spectral descriptors',
  tf_regions: 'Time-frequency regions',
  asymmetry: 'Hemispheric asymmetry',
  complexity: 'Signal complexity',
  autoencoder: 'Learned latent features (advanced)',
};

export const CARD_W = 200;
export const CARD_H = 170;
export const GAP = 16;

export interface P5Geo {
  gx0: number;
  gy0: number;
  gw: number;
  gh: number;
  /** Uniform card scale (cards are designed at 200 x 170 and grow to fill the free area). */
  s: number;
  basket: { x: number; y: number; w: number; h: number };
  /** visible (matching, unselected) families in grid order */
  visible: FamilyId[];
  /** The hovered card that is expanded sideways (shows its settings), or null. */
  expanded: FamilyId | null;
  /** Design-unit width of visible card k (200, or wider when expanded). */
  widthOf: (k: number) => number;
  /** Uniform scale of visible card k (row-mates of an expanded card shrink). */
  scaleOf: (k: number) => number;
  /** Centre of the 200 x 170 base area of visible card k (the expansion grows to the right). */
  slotOf: (k: number) => { x: number; y: number };
  rows: number;
  /** The expanded card's settings pane opens to the left (the card is in the last column). */
  paneLeft: boolean;
}

/** Basket geometry (sidebar column): teal header with the count, rounded body with the chips. */
export const BASKET_W = 300;
export const BASKET_HEAD = 56;
export const BASKET_BODY_TOP = BASKET_HEAD + 58; // below "Selected features"
export const CHIP_ROW = 38;
export const CHIP_W = 520;
export const CHIP_H = 64;
export const CHIP_SCALE = 0.5;
/** Width (design units) of an expanded card: base area plus the settings pane. */
export const EXPANDED_W = 2 * CARD_W + GAP;

export function matches(c: LayoutCtx, f: FamilyId): boolean {
  const cat = c.ui.categoryFilter;
  if (cat !== 'All' && CATEGORY[f] !== cat) return false;
  const q = c.ui.search.trim().toLowerCase();
  if (!q) return true;
  const meta = c.backendResults.features?.cards?.[f];
  const hay = `${TITLES[f]} ${f} ${meta?.explanation ?? ''} ${CATEGORY[f]}`.toLowerCase();
  return hay.includes(q);
}

/** The floating basket is scaled by this while it flips (Basket.tsx uses the same value). */
export const BASKET_FLIP_SCALE = 1.1;

/** Where the basket lands on the stage after floating out of the sidebar (its real size, scaled):
 *  after it turns upside down, its opening is the bottom edge of this rectangle. */
export function flipRect(c: LayoutCtx): { x: number; y: number; w: number; h: number } {
  const w = c.ui.basketSize.w * BASKET_FLIP_SCALE;
  const h = Math.min(c.ui.basketSize.h * BASKET_FLIP_SCALE, H(c) - TOP - 140);
  const cx = W(c) - w / 2 - 40;
  const cy = TOP + 10 + h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Row-mates of an expanded card shrink to this fraction of the normal card scale. */
export const SHRINK = 0.6;

export function p5Geo(c: LayoutCtx): P5Geo {
  const gx0 = PAD;
  const gy0 = TOP + 44;
  const cols = 3; // always three feature cards per row
  const gw = W(c) - 2 * PAD;
  const gh = H(c) - gy0 - 12;
  // Cards are as large as the width allows (equal sizes); the grid scrolls vertically.
  const sc = Math.max(0.8, (gw - (cols - 1) * GAP) / (cols * CARD_W));
  const visible = FAMILY_IDS.filter((f) => matches(c, f) && !c.settings.features.includes(f));
  const ex = c.ui.expandFamily as FamilyId | null;
  const expanded = ex && visible.includes(ex) ? ex : null;
  const ek = expanded ? visible.indexOf(expanded) : -1;
  const expRow = ek >= 0 ? Math.floor(ek / cols) : -1;
  const rowW = cols * CARD_W * sc + (cols - 1) * GAP;
  const nInRow = (r: number): number => Math.min(cols, visible.length - r * cols);
  // In the expanded card's row the other cards shrink (uniformly) and the expanded card takes the rest.
  const scaleOf = (k: number): number => (Math.floor(k / cols) === expRow && k !== ek ? sc * SHRINK : sc);
  const widthOf = (k: number): number => {
    if (k !== ek) return CARD_W;
    const others = nInRow(expRow) - 1;
    const px = rowW - others * (CARD_W * sc * SHRINK + GAP);
    return Math.max(CARD_W, px / sc);
  };
  const pos: { x: number; y: number }[] = [];
  for (let k = 0; k < visible.length; k++) {
    const r = Math.floor(k / cols);
    let x = gx0;
    for (let q = r * cols; q < k; q++) x += widthOf(q) * scaleOf(q) + GAP;
    pos.push({
      x: x + (CARD_W * scaleOf(k)) / 2,
      y: gy0 + r * (CARD_H * sc + GAP) + (CARD_H * sc) / 2 - c.ui.scrollY,
    });
  }
  const slotOf = (k: number): { x: number; y: number } => {
    if (k < pos.length) return pos[k];
    return {
      x: gx0 + (k % cols) * (CARD_W * sc + GAP) + (CARD_W * sc) / 2,
      y: gy0 + Math.floor(k / cols) * (CARD_H * sc + GAP) + (CARD_H * sc) / 2 - c.ui.scrollY,
    };
  };
  const rows = Math.max(1, Math.ceil(visible.length / cols));
  return {
    gx0,
    gy0,
    gw,
    gh,
    s: sc,
    // where the basket lands on the stage after floating out of the sidebar (5 -> 6 spill origin)
    basket: flipRect(c),
    visible,
    expanded,
    widthOf,
    scaleOf,
    slotOf,
    rows,
    paneLeft: false,
  };
}

export function basketChipPos(g: P5Geo, k: number): { x: number; y: number } {
  return {
    x: g.basket.x + g.basket.w / 2,
    y: g.basket.y + BASKET_BODY_TOP + 12 + k * CHIP_ROW + (CHIP_H * CHIP_SCALE) / 2,
  };
}

export function maxScroll(c: LayoutCtx): number {
  const g = p5Geo(c);
  return Math.max(0, g.rows * (CARD_H * g.s + GAP) - GAP - g.gh);
}

function hash01(n: number): number {
  let x = (n + 1) * 2654435761;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x % 10000) / 10000;
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const d = c.data;
  if (!d) return finish(m, c);
  const g = p5Geo(c);
  const fr = c.backendResults.features;
  const chosen = c.settings.features;
  const rec = new Set(c.paradigm.recommendedFamilies);
  FAMILY_IDS.forEach((f, idx) => {
    const meta = fr?.cards?.[f];
    const inBasket = chosen.includes(f);
    const vis = g.visible.indexOf(f);
    const common = {
      w: CARD_W,
      h: CARD_H,
      rotation: 0,
      alpha: 1,
      color: COLORS.panel,
      extra: {
        family: f,
        title: TITLES[f],
        explanation: meta?.explanation ?? '',
        count: meta?.error ? null : (meta?.count ?? null),
        error: meta?.error ?? null,
        units: meta?.units ? Array.from(new Set(meta.units)).join(', ') : '',
        preview: meta?.preview ?? null,
        recommended: rec.has(f) ? `recommended for ${c.paradigm.name}` : null,
        category: CATEGORY[f],
        selected: inBasket,
        expanded: g.expanded === f,
        paneLeft: g.expanded === f && g.paneLeft,
        classColors: d.classNames.length,
      },
    };
    if (inBasket) {
      // the card flies into the basket in the sidebar (just right of the stage) and shrinks away there
      m.set(`card:${f}`, {
        ...common,
        x: W(c) + 40,
        y: TOP + 120 + chosen.indexOf(f) * 30,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
      });
    } else if (vis >= 0) {
      const p = g.slotOf(vis);
      const sc = g.scaleOf(vis);
      m.set(`card:${f}`, { ...common, w: g.widthOf(vis), x: p.x, y: p.y, scaleX: sc, scaleY: sc });
    } else {
      const p = g.slotOf(idx);
      m.set(`card:${f}`, { ...common, x: p.x, y: p.y, scaleX: 0, scaleY: 0 });
    }
  });
  // Sine pieces: in-band bars fly to card slots (scale 0); out-of-band flatten in place (4 -> 5).
  const g4 = p4Geo(c);
  let bi = 0;
  const nv = Math.max(1, g.visible.length);
  for (let k = 0; k < g4.nBins; k++) {
    const f = g4.binF(k);
    if (inBand(c, f)) {
      const p = g.slotOf(bi % nv);
      bi++;
      m.set(`sine:${k}`, { x: p.x, y: p.y, w: 2, h: 20, scaleX: 0, scaleY: 0, alpha: 0, color: COLORS.ink });
    } else {
      m.set(`sine:${k}`, {
        x: g4.fx(f),
        y: g4.y1,
        w: 2,
        h: 20,
        scaleX: 1,
        scaleY: 0,
        alpha: 0,
        color: COLORS.ink,
      });
    }
  }
  // val pieces of the matrix rest hidden at the bottom of the basket; on 5 -> 6 they drop out of it.
  const vs = c.slots.val;
  const tiles = vs.trials.length * vs.nFeatures;
  const bx = g.basket;
  for (let s = 0; s < tiles; s++) {
    const jx = hash01(s);
    const jy = hash01(s + 7919);
    m.set(`val:${s}`, {
      x: bx.x + 24 + jx * (bx.w - 48),
      y: bx.y + bx.h - 14 - Math.pow(jy, 2) * 30,
      w: 20,
      h: 20,
      rotation: (jx - 0.5) * 0.8,
      scaleX: 0.15,
      scaleY: 0.15,
      alpha: 0,
      color: COLORS.ink,
    });
  }
  const total = fr?.selected?.total ?? 0;
  // The basket lives in the sidebar on this page (DOM); the canvas basket decor stays hidden.
  void total;
  void bx;
  return finish(m, c);
}
