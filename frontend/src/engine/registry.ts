// Piece registry (section 5.1). Pieces are allocated ONCE as fixed pools with permanent slot ids.
// No piece is created or destroyed after startup.

export type Kind =
  | 'ribbon'
  | 'env'
  | 'strip'
  | 'dot'
  | 'electrode'
  | 'spark'
  | 'sine'
  | 'wave'
  | 'card'
  | 'val'
  | 'chip'
  | 'decor';

export const KINDS: Kind[] = [
  'ribbon',
  'env',
  'strip',
  'dot',
  'electrode',
  'spark',
  'sine',
  'wave',
  'card',
  'val',
  'chip',
  'decor',
];

export const POOL = {
  ribbon: 2400,
  env: 200,
  strip: 4800,
  dot: 200,
  electrode: 128,
  spark: 128,
  sine: 90,
  val: 4000,
} as const;

export const FAMILY_IDS = [
  'band_power',
  'csp',
  'hjorth',
  'wavelet',
  'covariance',
  'time_stats',
  'window_means',
  'spectral_features',
  'tf_regions',
  'asymmetry',
  'complexity',
  'autoencoder',
] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

export const WAVES = ['raw', 'filtered'] as const;
export const PAGES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export const DECOR: Record<number, string[]> = {
  1: ['droptext'],
  2: ['axis', 'cue', 'zone', 'frame', 'minimap'],
  3: ['head', 'nose', 'ears', 'cap', 'mesh', 'scalp', 'heat', 'links', 'legend', 'tray'],
  4: ['axes', 'bands', 'gate', 'fill', 'handles', 'wavepanel', 'prism'],
  5: ['basket', 'odometer'],
  6: ['histaxis', 'guides', 'ghost', 'meanticks'],
  7: ['rowstrip', 'colheads', 'brackets', 'gauge', 'race', 'leak', 'views'],
  8: ['codepanel'],
};

export const DECOR_IDS: string[] = Object.entries(DECOR).flatMap(([pg, names]) =>
  names.map((n) => `decor:${pg}:${n}`),
);

export class Registry {
  readonly ids: string[] = [];
  readonly kinds: Kind[] = [];
  readonly kindCode: Uint8Array;
  /** Pool slot number within the kind (or index within its list). */
  readonly slot: Int32Array;
  readonly index = new Map<string, number>();
  readonly ranges = new Map<Kind, [number, number]>();
  /** Group keys, rewritten by the slot mapping when data or settings change (-1 = none). */
  readonly gTrial: Int32Array;
  readonly gTrialRank: Int32Array;
  readonly gChannel: Int32Array;
  readonly gFeature: Int32Array;
  readonly gClass: Int32Array;
  /** Rank of the trial when trials are ordered by class then trial index. */
  readonly gClassRank: Int32Array;
  readonly gFreq: Int32Array;
  readonly n: number;

  constructor() {
    const add = (kind: Kind, id: string, slot: number): void => {
      this.index.set(id, this.ids.length);
      this.ids.push(id);
      this.kinds.push(kind);
      slots.push(slot);
    };
    const slots: number[] = [];
    const range = (kind: Kind, fn: () => void): void => {
      const a = this.ids.length;
      fn();
      this.ranges.set(kind, [a, this.ids.length]);
    };
    range('ribbon', () => {
      for (let s = 0; s < POOL.ribbon; s++) add('ribbon', `ribbon:${s}`, s);
    });
    range('env', () => {
      for (let s = 0; s < POOL.env; s++) add('env', `env:${s}`, s);
    });
    range('strip', () => {
      for (let s = 0; s < POOL.strip; s++) add('strip', `strip:${s}`, s);
    });
    range('dot', () => {
      for (let s = 0; s < POOL.dot; s++) add('dot', `dot:${s}`, s);
    });
    range('electrode', () => {
      for (let s = 0; s < POOL.electrode; s++) add('electrode', `electrode:${s}`, s);
    });
    range('spark', () => {
      for (let s = 0; s < POOL.spark; s++) add('spark', `spark:${s}`, s);
    });
    range('sine', () => {
      for (let s = 0; s < POOL.sine; s++) add('sine', `sine:${s}`, s);
    });
    range('wave', () => {
      WAVES.forEach((w, s) => add('wave', `wave:${w}`, s));
    });
    range('card', () => {
      FAMILY_IDS.forEach((f, s) => add('card', `card:${f}`, s));
    });
    range('val', () => {
      for (let s = 0; s < POOL.val; s++) add('val', `val:${s}`, s);
    });
    range('chip', () => {
      PAGES.forEach((p, s) => add('chip', `chip:${p}`, s));
    });
    range('decor', () => {
      DECOR_IDS.forEach((d, s) => add('decor', d, s));
    });
    this.n = this.ids.length;
    this.kindCode = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) this.kindCode[i] = KINDS.indexOf(this.kinds[i]);
    this.slot = Int32Array.from(slots);
    const neg = (): Int32Array => new Int32Array(this.n).fill(-1);
    this.gTrial = neg();
    this.gTrialRank = neg();
    this.gChannel = neg();
    this.gFeature = neg();
    this.gClass = neg();
    this.gClassRank = neg();
    this.gFreq = neg();
    for (const [a, b] of [this.ranges.get('sine')!]) for (let i = a; i < b; i++) this.gFreq[i] = i - a;
  }

  range(kind: Kind): [number, number] {
    return this.ranges.get(kind)!;
  }
  /** Decor page number and name for a decor index. */
  decorInfo(i: number): { page: number; name: string } {
    const [, pg, name] = this.ids[i].split(':');
    return { page: Number(pg), name };
  }
}
