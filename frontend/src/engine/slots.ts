// Deterministic pool mapping tables (section 5.1). Pure functions of the data and settings.
import { POOL } from './registry';

/** Stratified subsample by class, kept in original order. Deterministic. */
export function stratifiedSubset(labels: ArrayLike<number>, k: number, nClasses: number): number[] {
  const n = labels.length;
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  const byClass: number[][] = Array.from({ length: nClasses }, () => []);
  for (let i = 0; i < n; i++) byClass[labels[i]].push(i);
  // Largest-remainder proportional allocation, at least one per non-empty class when possible.
  const quotas = byClass.map((c) => (c.length * k) / n);
  const alloc = quotas.map((q, c) => Math.min(byClass[c].length, Math.floor(q)));
  let left = k - alloc.reduce((a, b) => a + b, 0);
  const order = quotas.map((q, c) => ({ c, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r || a.c - b.c);
  for (let j = 0; left > 0 && j < order.length * 2; j++) {
    const c = order[j % order.length].c;
    if (alloc[c] < byClass[c].length) {
      alloc[c]++;
      left--;
    }
  }
  const chosen: number[] = [];
  byClass.forEach((members, c) => {
    const m = alloc[c];
    for (let j = 0; j < m; j++) chosen.push(members[Math.floor(((j + 0.5) * members.length) / m)]);
  });
  return chosen.sort((a, b) => a - b);
}

export interface Slots {
  /** Displayed trials for ribbons, env, strip and dot (original trial indices, original order). */
  shownTrials: number[];
  /** Rank of each displayed trial when sorted by class order (class 0 first), then trial order. */
  classRank: number[];
  nChannels: number;
  /** ribbon slot = trialRank * nChannels + channel */
  ribbonCount: number;
  /** val pool mapping */
  valTrials: number[];
  valClassRank: number[];
  nFeatures: number;
  valCount: number;
}

export function displayedTrialCount(nTrials: number, nChannels: number): number {
  return Math.max(0, Math.min(nTrials, Math.floor(POOL.ribbon / Math.max(1, nChannels)), 200));
}

export function classOrderRank(trials: number[], labels: ArrayLike<number>): number[] {
  const order = trials.map((t, r) => ({ t, r, c: labels[t] })).sort((a, b) => a.c - b.c || a.t - b.t);
  const rank = new Array<number>(trials.length);
  order.forEach((o, j) => (rank[o.r] = j));
  return rank;
}

export function buildSlots(
  labels: ArrayLike<number>,
  nClasses: number,
  nChannels: number,
  nFeatures: number,
  maxShown = 200,
): Slots {
  const nTrials = labels.length;
  const m = Math.min(displayedTrialCount(nTrials, nChannels), maxShown);
  const shownTrials = stratifiedSubset(labels, m, nClasses);
  const nf = Math.max(1, nFeatures);
  const tv = Math.min(nTrials, Math.floor(POOL.val / nf));
  const valTrials = stratifiedSubset(labels, Math.max(0, tv), nClasses);
  return {
    shownTrials,
    classRank: classOrderRank(shownTrials, labels),
    nChannels,
    ribbonCount: shownTrials.length * nChannels,
    valTrials,
    valClassRank: classOrderRank(valTrials, labels),
    nFeatures: nFeatures,
    valCount: Math.min(POOL.val, valTrials.length * nFeatures),
  };
}

export const ribbonSlot = (trialRank: number, ch: number, nCh: number): number => trialRank * nCh + ch;
export const valSlot = (feature: number, trialRank: number, trialsShown: number): number =>
  feature * trialsShown + trialRank;
