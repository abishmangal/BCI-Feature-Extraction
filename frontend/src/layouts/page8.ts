// Page 8: Export. Eight settings chips (one per page) fly into the code panel; the script types itself out.
import type { Layout } from '../engine/types';
import { COLORS } from '../engine/colors';
import { type LayoutCtx, H, PAD, TOP, W, finish, setDecor } from './common';
import { TITLES } from './page5';
import type { FamilyId } from '../store/store';

export function chipTexts(c: LayoutCtx): string[] {
  const s = c.settings;
  const d = c.data;
  const fr = c.backendResults.features;
  const fam = s.features.length ? s.features : ([c.paradigm.defaultFeature.family] as FamilyId[]);
  const counts = fam.map((f) => {
    const n = fr?.selected.families.find((x) => x.id === f)?.count;
    return `${TITLES[f as FamilyId]?.split(' (')[0] ?? f}${n !== undefined ? ` (${n})` : ''}`;
  });
  const chs =
    s.channels.length > 6
      ? `${s.channels.slice(0, 5).join(', ')} +${s.channels.length - 5}`
      : s.channels.join(', ');
  const tr = { none: 'none', log: 'log', signed_log: 'signed log' }[s.transform];
  const nm = { none: 'none', zscore: 'z-score', robust: 'robust scale', minmax: 'min-max' }[s.normalise];
  const clf = { lda: 'LDA', logreg: 'logistic regression', svm: 'linear SVM' }[s.classifier];
  const folds = c.backendResults.evaluate?.folds ?? s.cvFolds;
  return [
    `Data: ${d ? `${d.shape.join(' x ')}, ${d.sfreq} Hz` : 'none'}`,
    `Window: ${s.window.start.toFixed(1)} to ${s.window.end.toFixed(1)} s`,
    `Channels: ${chs}`,
    `Band: ${s.band.low} to ${s.band.high} Hz, order ${s.band.order}`,
    `Features: ${counts.join(', ')}`,
    `Transform: ${tr}; Normalise: ${nm}`,
    `Classifier: ${clf}, ${folds}-fold`,
    `Leakage guard: ${s.leakageGuard ? 'on' : 'off'}`,
  ];
}

/** Chip text wraps at about this many monospace characters per line. */
export const CHIP_CHARS = 38;
export const CHIP_W = 330;

export interface P8Geo {
  cx: number;
  chipW: number;
  chips: { y: number; h: number }[];
  panel: { x0: number; y0: number; x1: number; y1: number };
  junction: { x: number; y: number };
}

export function p8Geo(c: LayoutCtx, texts = chipTexts(c)): P8Geo {
  const chipW = CHIP_W;
  // Each chip grows with its text (the Features chip grows with the number of features).
  const hs = texts.map((t) => 22 + Math.max(1, Math.ceil(t.length / CHIP_CHARS)) * 17);
  const avail = H(c) - 16 - TOP;
  const total = hs.reduce((a, b) => a + b, 0);
  const gap = Math.max(4, Math.min(12, (avail - total) / 7));
  let y = TOP + 4;
  const chips = hs.map((h) => {
    const r = { y: y + h / 2, h };
    y += h + gap;
    return r;
  });
  const x0 = PAD + chipW + 110; // room for the connector lines
  const panel = { x0, y0: TOP, x1: W(c) - PAD, y1: H(c) - 16 };
  return { cx: PAD + chipW / 2, chipW, chips, panel, junction: { x: x0, y: (panel.y0 + panel.y1) / 2 } };
}

export function layout(c: LayoutCtx): Layout {
  const m: Layout = new Map();
  const texts = chipTexts(c);
  const g = p8Geo(c, texts);
  // Chips stay in the left column; teal lines then connect them to the code panel (codepanel decor).
  texts.forEach((t, k) => {
    m.set(`chip:${k + 1}`, {
      x: g.cx,
      y: g.chips[k].y,
      w: g.chipW,
      h: g.chips[k].h,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      color: COLORS.panel,
      extra: { text: t, page: k + 1, w: g.chipW, h: g.chips[k].h },
    });
  });
  // val pieces dissolve into the chip assigned to their row (chip index = trial rank mod 8).
  const vs = c.slots.val;
  const T = vs.trials.length;
  for (let f = 0; f < vs.nFeatures; f++)
    for (let r = 0; r < T; r++) {
      const k = r % 8;
      m.set(`val:${f * T + r}`, {
        x: g.cx,
        y: g.chips[k].y,
        w: 6,
        h: 6,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
      });
    }
  setDecor(m, 8, 'codepanel', {
    extra: {
      ...g.panel,
      junction: g.junction,
      anchors: g.chips.map((ch) => ({ x: g.cx + g.chipW / 2, y: ch.y })),
      reduced: c.ui.reduceMotion,
      version: texts.join('|'),
    },
  });
  return finish(m, c);
}
