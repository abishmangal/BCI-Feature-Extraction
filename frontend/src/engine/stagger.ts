// Stagger by meaning (section 5.4).
import type { Registry } from './registry';

export type GroupBy = 'channel' | 'trial' | 'feature' | 'class' | 'frequency';
export type StaggerOrder =
  'ascending' | 'by-electrode-posterior-to-anterior' | 'by-effect-strength' | 'by-feature-rank';

export interface StaggerPlan {
  groupBy: GroupBy;
  order: StaggerOrder;
  delayPerGroupMs: number;
  maxTotalDelayMs: number;
  /** Optional secondary grouping (5 -> 6: feature then trial, 3 ms per trial). */
  thenBy?: GroupBy;
  thenPerGroupMs?: number;
}

export const DEFAULT_PLAN: StaggerPlan = {
  groupBy: 'trial',
  order: 'ascending',
  delayPerGroupMs: 18,
  maxTotalDelayMs: 700,
};

/** Optional order tables supplied by the caller (pure functions of ctx). */
export interface OrderTables {
  /** channel index -> rank (posterior to anterior, unpositioned last in tray order) */
  channelRank?: Int32Array | number[];
  /** feature index -> rank (by separability) */
  featureRank?: Int32Array | number[];
  /** card (feature group) rank for card pieces: piece index -> rank */
  cardRank?: Map<number, number>;
}

function keyRank(reg: Registry, i: number, g: GroupBy, order: StaggerOrder, tables: OrderTables): number {
  switch (g) {
    case 'trial':
      return reg.gTrialRank[i];
    case 'class':
      // class then trial: the trial's ordinal when trials are ordered by class.
      return reg.gClassRank[i];
    case 'channel': {
      const c = reg.gChannel[i];
      if (c < 0) return -1;
      if (order === 'by-electrode-posterior-to-anterior' && tables.channelRank)
        return tables.channelRank[c] ?? c;
      return c;
    }
    case 'feature': {
      if (reg.kinds[i] === 'card' && tables.cardRank) return tables.cardRank.get(i) ?? -1;
      const f = reg.gFeature[i];
      if (f < 0) return -1;
      if (order === 'by-feature-rank' && tables.featureRank) return tables.featureRank[f] ?? f;
      return f;
    }
    case 'frequency':
      return reg.gFreq[i];
  }
}

/**
 * The rank part of the delay for piece i, clamped to maxTotalDelayMs. Pieces without the group key get 0.
 * `reverse` mirrors the order (backward transitions) using `maxRank` of the plan's groups.
 */
export function rankDelay(
  plan: StaggerPlan,
  reg: Registry,
  i: number,
  tables: OrderTables,
  reverse = false,
  maxRanks?: { primary: number; secondary: number },
): number {
  let r = keyRank(reg, i, plan.groupBy, plan.order, tables);
  if (r < 0) return 0;
  if (reverse && maxRanks) r = Math.max(0, maxRanks.primary - r);
  let d = r * plan.delayPerGroupMs;
  if (plan.thenBy && plan.thenPerGroupMs) {
    let r2 = keyRank(reg, i, plan.thenBy, 'ascending', tables);
    if (r2 >= 0) {
      if (reverse && maxRanks) r2 = Math.max(0, maxRanks.secondary - r2);
      d += r2 * plan.thenPerGroupMs;
    }
  }
  return Math.min(d, plan.maxTotalDelayMs);
}

export function maxRanks(
  plan: StaggerPlan,
  reg: Registry,
  tables: OrderTables,
): { primary: number; secondary: number } {
  let a = 0;
  let b = 0;
  for (let i = 0; i < reg.n; i++) {
    a = Math.max(a, keyRank(reg, i, plan.groupBy, plan.order, tables));
    if (plan.thenBy) b = Math.max(b, keyRank(reg, i, plan.thenBy, 'ascending', tables));
  }
  return { primary: a, secondary: b };
}

/** Exact stagger plans of section 5.4, keyed "A->B" for forward adjacent moves. */
export const PLANS: Record<string, StaggerPlan> = {
  // rows settle top to bottom in their final (class-sorted) order
  '1->2': { groupBy: 'class', order: 'ascending', delayPerGroupMs: 5, maxTotalDelayMs: 600 },
  '2->3': {
    groupBy: 'channel',
    order: 'by-electrode-posterior-to-anterior',
    delayPerGroupMs: 30,
    maxTotalDelayMs: 700,
  },
  '3->4': { groupBy: 'channel', order: 'ascending', delayPerGroupMs: 12, maxTotalDelayMs: 700 },
  '4->5': { groupBy: 'feature', order: 'ascending', delayPerGroupMs: 60, maxTotalDelayMs: 700 },
  '5->6': {
    groupBy: 'feature',
    order: 'ascending',
    delayPerGroupMs: 40,
    maxTotalDelayMs: 700,
    thenBy: 'trial',
    thenPerGroupMs: 3,
  },
  '6->7': { groupBy: 'trial', order: 'ascending', delayPerGroupMs: 4, maxTotalDelayMs: 700 },
  '7->8': { groupBy: 'trial', order: 'ascending', delayPerGroupMs: 3, maxTotalDelayMs: 500 },
};
/** Any other jump (non-adjacent): group by class then trial, 4 ms per trial, max 500 ms. */
export const NON_ADJACENT_PLAN: StaggerPlan = {
  groupBy: 'class',
  order: 'ascending',
  delayPerGroupMs: 4,
  maxTotalDelayMs: 500,
};
