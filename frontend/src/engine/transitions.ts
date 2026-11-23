// Page transition choreography table (section 5.7). Separate from the layouts so layouts stay pure.
// Final poses come from the layouts (including meaningful parking, `parkAt`). This table supplies, per
// piece: flavor, stagger use, kind offset, optional extra per-piece offset, optional via pose and an
// optional start pose (applied only to pieces that are currently invisible, so nothing visibly jumps).
import type { FlavorName } from './springs';
import type { Registry, Kind } from './registry';
import type { TargetState } from './types';
import { PLANS, type StaggerPlan } from './stagger';

/** Geometry helpers implemented by the layout module (pure functions of ctx). */
export interface TransitionHelpers {
  stageW: number;
  stageH: number;
  /** Number of displayed trials (ribbon rows). */
  shownCount: number;
  /** Is sine bin k inside the selected band? */
  sineInBand(k: number): boolean;
  /** Rank of sine bin k among in-band bins (frequency ascending), or -1. */
  sineBandRank(k: number): number;
  /** Prism entrance and exit (page 4). */
  prism: { x: number; y: number; exitX: number };
  /** Centre of the lifted band on page 4 (where cards start). */
  bandCentre: { x: number; y: number };
  /** Matrix centre on page 7 (where chips start). */
  matrixCentre: { x: number; y: number };
  /** Page 5 basket rectangle (the 5 -> 6 flip spills its contents from here). */
  basket: { x: number; y: number; w: number; h: number };
  /** Page 7 row centre x for a val piece's row. */
  rowCentreX: number;
  /** Is a channel included (page 3)? */
  channelIncluded(ch: number): boolean;
  /** Included-channel ordinal (for the 3 -> 4 waveform pose rows). */
  includedOrdinal(ch: number): number;
  includedCount: number;
  /** Column index of a val piece in the matrix (6 -> 7 unroll), or -1. */
  valColumn(i: number): number;
  /** Is a val piece part of the inspected feature (pages 6 and 7)? */
  valInspected(i: number): boolean;
  /** Is a card currently in the basket? */
  cardSelected(i: number): boolean;
  /** Page index (0..7) of a chip piece. */
  chipIndex(i: number): number;
  /** Deterministic hash jitter in [-1, 1] from a slot number. */
  jitter(slot: number): number;
}

export interface TEnv {
  i: number;
  kind: Kind;
  decorName: string | null;
  decorPage: number;
  reg: Registry;
  final: TargetState;
  /** Current spring position of a property by name. */
  cur: (prop: keyof TargetState) => number;
  h: TransitionHelpers;
}

export interface Rule {
  flavor: FlavorName;
  /** Optional separate flavor for size properties (w, h, scaleX, scaleY). */
  scaleFlavor?: FlavorName;
  offsetMs?: number;
  /** Extra per-piece offset (for example 3 ms per trial for dots). */
  extraMs?: number;
  /** Whether the group rank delay applies (default true for pieces that have the group key). */
  stagger?: boolean;
  via?: Partial<TargetState> | null;
  viaMaxMs?: number;
  viaMinHoldMs?: number;
  /** Start pose for pieces that are currently invisible. */
  start?: Partial<TargetState> | null;
  /** Apply the start pose even to visible pieces (Page 1 pour: ribbons start above the stage top). */
  forceStart?: boolean;
}

export interface TransitionDef {
  plan: StaggerPlan;
  rule: (e: TEnv) => Rule | null;
}

const DEFAULT_RULE: Rule = { flavor: 'standard', offsetMs: 0, stagger: false };
const snapOut: Rule = { flavor: 'snappy', offsetMs: 0, stagger: false };
const dec = (e: TEnv, page: number, name: string): boolean => e.decorPage === page && e.decorName === name;
const decorOf = (e: TEnv, page: number): boolean => e.kind === 'decor' && e.decorPage === page;

// ---------------------------------------------------------------------------------------------
const t12: TransitionDef = {
  plan: PLANS['1->2'],
  rule: (e) => {
    switch (e.kind) {
      case 'ribbon': {
        if (e.reg.gTrialRank[e.i] < 0) return null;
        // Two calm moves: first each row resizes in place to the Page 2 band width (and dims), then the
        // rows glide vertically into their class-sorted order, top to bottom.
        return {
          flavor: 'soft',
          via: {
            x: e.final.x,
            w: e.final.w,
            y: e.cur('y'),
            rotation: 0,
            alpha: Math.min(e.cur('alpha'), 0.22),
          },
          viaMaxMs: 320,
        };
      }
      case 'env':
        // each trial's envelope grows in its row as the row arrives
        return {
          flavor: 'soft',
          offsetMs: 520,
          start: { x: e.final.x, y: e.final.y, w: e.final.w, scaleY: 0, alpha: 0 },
        };
      case 'strip':
        return { flavor: 'standard', offsetMs: 520, start: { x: e.final.x, y: e.final.y, alpha: 0 } };
      case 'dot': {
        const rank = Math.max(0, e.reg.gTrialRank[e.i]);
        return {
          flavor: 'soft',
          offsetMs: 850,
          stagger: false,
          extraMs: 2 * rank,
          start: { x: e.final.x, y: e.final.y, scaleX: 0, scaleY: 0 },
        };
      }
      case 'decor':
        if (dec(e, 2, 'axis')) return { flavor: 'reveal', offsetMs: 350, start: { reveal: 0 } };
        if (dec(e, 2, 'cue')) return { flavor: 'reveal', offsetMs: 650, start: { reveal: 0 } };
        if (dec(e, 2, 'zone')) return { flavor: 'reveal', offsetMs: 700, start: { reveal: 0 } };
        if (dec(e, 2, 'frame')) return { flavor: 'soft', offsetMs: 760, start: { scaleY: 0, alpha: 0 } };
        if (dec(e, 2, 'minimap')) return { flavor: 'reveal', offsetMs: 800, start: { reveal: 0 } };
        if (dec(e, 1, 'droptext')) return snapOut;
        return null;
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------------------------
const t23: TransitionDef = {
  plan: PLANS['2->3'],
  rule: (e) => {
    if (decorOf(e, 2) || e.kind === 'dot' || e.kind === 'env') return snapOut;
    switch (e.kind) {
      case 'ribbon':
        // each channel's bundle lifts and fades quickly; only a faint wisp converges onto its electrode
        return { flavor: 'soft', via: { y: e.cur('y') - 16, alpha: 0.12, scaleY: 0.4 }, viaMaxMs: 220 };
      case 'strip':
        return { flavor: 'snappy', stagger: false };
      case 'electrode':
        return {
          flavor: 'standard',
          offsetMs: 220,
          start: { x: e.final.x, y: e.final.y, scaleX: 0, scaleY: 0 },
        };
      case 'spark':
        return {
          flavor: 'standard',
          offsetMs: 300,
          start: { x: e.final.x, y: e.final.y, scaleX: 0, alpha: 0 },
        };
      case 'decor': {
        const n = e.decorName;
        if (e.decorPage !== 3) return null;
        if (n === 'head') return { flavor: 'reveal', offsetMs: 150, start: { reveal: 0 } };
        if (n === 'scalp') return { flavor: 'reveal', offsetMs: 300 };
        if (n === 'cap') return { flavor: 'reveal', offsetMs: 400, start: { reveal: 0 } };
        if (n === 'nose' || n === 'ears')
          return { flavor: 'standard', offsetMs: 450, start: { scaleX: 0, scaleY: 0 } };
        if (n === 'mesh') return { flavor: 'reveal', offsetMs: 520, start: { reveal: 0 } };
        if (n === 'heat') return { flavor: 'reveal', offsetMs: 600 };
        if (n === 'links' || n === 'legend') return { flavor: 'reveal', offsetMs: 700 };
        if (n === 'tray') return { flavor: 'reveal', offsetMs: 450 };
        return null;
      }
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------------------------
const t34: TransitionDef = {
  plan: PLANS['3->4'],
  rule: (e) => {
    if (e.kind === 'electrode' || decorOf(e, 3)) return snapOut;
    switch (e.kind) {
      case 'spark': {
        const ch = e.reg.gChannel[e.i];
        if (ch < 0 || !e.h.channelIncluded(ch)) return snapOut;
        const n = Math.max(1, e.h.includedCount);
        const gap = Math.min(14, (e.h.stageH * 0.7) / n);
        const row = e.h.includedOrdinal(ch);
        const w = e.h.stageW * 0.6;
        return {
          flavor: 'soft',
          via: {
            x: e.h.stageW / 2 - w / 2,
            y: e.h.stageH / 2 + (row - (n - 1) / 2) * gap,
            w,
            scaleX: 1,
            scaleY: 1,
            alpha: 1,
          },
        };
      }
      case 'sine': {
        const k = e.reg.gFreq[e.i];
        return {
          flavor: 'soft',
          scaleFlavor: 'standard',
          offsetMs: 520,
          stagger: false,
          extraMs: 6 * Math.max(0, k),
          start: { x: e.h.prism.exitX, y: e.final.y, scaleY: 0 },
        };
      }
      case 'wave':
        return { flavor: 'standard', offsetMs: 950, stagger: false, start: { scaleY: 0 } };
      case 'decor': {
        if (e.decorPage !== 4) return null;
        const n = e.decorName;
        if (n === 'prism')
          return {
            flavor: 'reveal',
            offsetMs: 260,
            via: { reveal: 1, alpha: 1 },
            viaMinHoldMs: 400,
            viaMaxMs: 400,
          };
        if (n === 'axes') return { flavor: 'reveal', offsetMs: 600, start: { reveal: 0 } };
        if (n === 'bands') return { flavor: 'reveal', offsetMs: 750 };
        if (n === 'fill') return { flavor: 'reveal', offsetMs: 850 };
        if (n === 'gate' || n === 'handles' || n === 'wavepanel') return { flavor: 'reveal', offsetMs: 900 };
        return null;
      }
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------------------------
const t45: TransitionDef = {
  plan: PLANS['4->5'],
  rule: (e) => {
    if (decorOf(e, 4) || e.kind === 'wave') return snapOut;
    switch (e.kind) {
      case 'sine': {
        const k = e.reg.gFreq[e.i];
        if (!e.h.sineInBand(k)) return snapOut;
        return { flavor: 'soft', stagger: false, via: { y: e.cur('y') - 36, alpha: 1 } };
      }
      case 'card':
        return {
          flavor: 'soft',
          offsetMs: 120,
          start: { x: e.h.bandCentre.x, y: e.h.bandCentre.y, scaleX: 0.3, scaleY: 0.3, alpha: 0 },
        };
      case 'decor':
        // the basket lives in the sidebar on Page 5 (DOM); only the counter decor remains on the stage
        if (dec(e, 5, 'odometer')) return { flavor: 'reveal', offsetMs: 600 };
        return null;
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------------------------
const t56: TransitionDef = {
  plan: PLANS['5->6'],
  rule: (e) => {
    const b = e.h.basket;
    switch (e.kind) {
      case 'val': {
        // After the basket has turned upside down, the tiles pour out of its opening (now its bottom
        // edge), drop just below it, then fall and morph into the histogram grains.
        const j1 = e.h.jitter(e.reg.slot[e.i]);
        const j2 = e.h.jitter(e.reg.slot[e.i] + 7919);
        const mouthY = b.y + b.h - 18;
        return {
          flavor: 'fall',
          offsetMs: 900,
          start: {
            x: b.x + b.w / 2 + j1 * b.w * 0.32,
            y: mouthY - Math.abs(j2) * 30,
            scaleX: 0.35,
            scaleY: 0.35,
            alpha: 0,
            rotation: j1 * 3,
          },
          via: {
            x: b.x + b.w / 2 + j1 * b.w * 0.42,
            y: mouthY + 40 + Math.abs(j2) * 70,
            alpha: 0.95,
            scaleX: 0.6,
            scaleY: 0.6,
            rotation: j2 * 2,
          },
          viaMaxMs: 240,
        };
      }
      case 'card':
        return e.h.cardSelected(e.i)
          ? { flavor: 'snappy', offsetMs: 150, stagger: false }
          : { flavor: 'soft', offsetMs: 0 }; // the list slides off to the left, card by card
      case 'decor':
        // the basket itself swells and flips in the sidebar (DOM, spring-driven): see ui/Basket.tsx
        if (dec(e, 6, 'histaxis')) return { flavor: 'reveal', offsetMs: 700, start: { reveal: 0 } };
        if (dec(e, 6, 'guides')) return { flavor: 'reveal', offsetMs: 850 };
        if (dec(e, 6, 'meanticks')) return { flavor: 'reveal', offsetMs: 950 };
        if (dec(e, 6, 'ghost')) return { flavor: 'reveal', offsetMs: 0 };
        return null;
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------------------------
const t67: TransitionDef = {
  plan: PLANS['6->7'],
  rule: (e) => {
    if (decorOf(e, 6)) return snapOut;
    switch (e.kind) {
      case 'val': {
        if (e.h.valInspected(e.i)) return { flavor: 'soft' };
        const col = Math.max(0, e.h.valColumn(e.i));
        return {
          flavor: 'standard',
          offsetMs: 150,
          extraMs: 6 * col,
          start: { x: e.final.x, y: e.final.y, scaleX: 0, scaleY: 0 },
        };
      }
      case 'decor': {
        if (e.decorPage !== 7) return null;
        const n = e.decorName;
        if (n === 'rowstrip') return { flavor: 'reveal', offsetMs: 300, start: { reveal: 0 } };
        if (n === 'colheads') return { flavor: 'reveal', offsetMs: 350 };
        if (n === 'brackets') return { flavor: 'reveal', offsetMs: 500, start: { reveal: 0 } };
        const slide = (off: number): Rule => ({
          flavor: 'standard',
          offsetMs: off,
          stagger: false,
          start: { x: e.final.x + 24, alpha: 0 },
        });
        if (n === 'gauge') return slide(450);
        if (n === 'race') return slide(550);
        if (n === 'leak') return slide(650);
        if (n === 'views') return slide(450);
        return null;
      }
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------------------------
const t78: TransitionDef = {
  plan: PLANS['7->8'],
  rule: (e) => {
    if (decorOf(e, 7)) return snapOut;
    switch (e.kind) {
      case 'val':
        return { flavor: 'soft', via: { x: e.h.rowCentreX, scaleX: 0.1, alpha: 0.8 } };
      case 'chip':
        return {
          flavor: 'standard',
          offsetMs: 260,
          extraMs: 70 * e.h.chipIndex(e.i),
          stagger: false,
          start: {
            x: e.h.matrixCentre.x,
            y: e.h.matrixCentre.y,
            scaleX: 0.2,
            scaleY: 0.2,
            alpha: 0,
          },
        };
      case 'decor':
        if (dec(e, 8, 'codepanel')) return { flavor: 'reveal', offsetMs: 700, start: { reveal: 0 } };
        return null;
      default:
        return null;
    }
  },
};

export const FORWARD: Record<string, TransitionDef> = {
  '1->2': t12,
  '2->3': t23,
  '3->4': t34,
  '4->5': t45,
  '5->6': t56,
  '6->7': t67,
  '7->8': t78,
};

export type Mode = 'forward' | 'backward' | 'nonadjacent' | 'inpage' | 'reduced' | 'initial';

export function transitionMode(from: number, to: number, reduced: boolean): Mode {
  if (from === to) return reduced ? 'reduced' : 'inpage';
  if (reduced) return 'reduced';
  if (to === from + 1) return 'forward';
  if (to === from - 1) return 'backward';
  return 'nonadjacent';
}

export function getRule(def: TransitionDef | null, e: TEnv): Rule {
  if (!def) return DEFAULT_RULE;
  return def.rule(e) ?? DEFAULT_RULE;
}
