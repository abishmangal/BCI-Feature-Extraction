// Typed backend responses (section 9). Arrays arrive as F32 and are decoded by the store.
import type { F32 } from './f32';

export interface Band {
  name?: string;
  low: number;
  high: number;
}
export interface ProbeFeature {
  channel: string;
  type: 'log_band_power' | 'mean_amplitude';
  band: [number, number] | null;
  followBand?: boolean;
}
export interface WindowPreset {
  label: string;
  full?: boolean;
  start?: number;
  end?: number;
}
export interface BandPreset {
  label: string;
  low: number;
  high: number;
}
export interface ChannelPreset {
  label: string;
  channels: string[];
  default?: boolean;
}
export interface MapMetricSpec {
  metric: 'bandpower_change' | 'separability_bandpower' | 'separability_amplitude' | 'snr';
  band: [number, number] | null;
  mapClass: number | 'diff';
}
export interface Preset {
  id: string;
  name: string;
  synthetic?: string;
  classNames: string[] | null;
  eventLabel: string;
  sfreq?: number;
  epoch?: { tmin: number; n_samples: number };
  channels?: string[];
  baseline: { start: number; end: number } | null;
  zone: { start: number; end: number; label: string } | null;
  defaultWindow: { start: number; end: number };
  defaultBand: { low: number; high: number; order: number };
  windowPresets: WindowPreset[];
  bandPresets: BandPreset[];
  channelPresets: ChannelPreset[];
  probe: { x: ProbeFeature; y: ProbeFeature };
  mapMetric: MapMetricSpec;
  keyBands: { name: string; low: number; high: number }[];
  stimulusFrequencies: number[] | null;
  defaultFeature: { family: string; settings: Record<string, unknown> };
  recommendedFamilies: string[];
  waveletRange: [number, number];
  hints: { page2: string; page3: string; page4: string } | null;
  facts: string | null;
}
export interface ParadigmsResponse {
  version: string;
  presets: Preset[];
  montages: string[];
  namedBands: { name: string; low: number; high: number }[];
}
export interface ElectrodePreset {
  id: string;
  label: string;
  row: 'basic' | 'paradigm' | 'generic' | 'computed' | 'region';
  channels: string[];
  present: number;
  total: number;
  isDefault?: boolean;
  group?: string;
}
export interface DatasetResponse {
  id: string;
  hash: string;
  shape: [number, number, number];
  source: 'sample' | 'csv' | 'npz';
  sampleId: string | null;
  paradigm: string;
  preset: Preset;
  sfreq: number;
  tmin: number;
  times: F32;
  labels: number[];
  classNames: string[];
  classCounts: number[];
  channels: string[];
  positions: ([number, number] | null)[];
  regions: string[];
  baseline: { start: number; end: number } | null;
  montage: string;
  display: { trials: number[]; points: number; ribbons: F32; scale_uv: number; env: F32 };
  layout: { id: string; n_channels: number; label: string; n_on_head: number; n_in_tray: number };
  electrodePresets: ElectrodePreset[];
  asymmetryPairs: { left: string; right: string }[];
  provenance: {
    source: string;
    units?: string;
    artifact_steps?: unknown[];
    preset?: string;
    event_id?: unknown;
  };
  upstream: { settings: Record<string, unknown> } | null;
  hasTfr: boolean;
  warnings: string[];
}
export interface WindowResponse {
  shape: number[];
  hash: string;
  window: { start: number; end: number };
  nSamples: number;
  env: F32;
  probe: { x: F32; y: F32; spec: { x: ProbeFeature; y: ProbeFeature } };
  separability: { accuracy: number; std: number; chance: number; folds: number; foldMessage: string | null };
}
export interface ChannelsResponse {
  shape: number[];
  hash: string;
  channels: string[];
  sparklines: F32; // (channels, classes, 60)
  map: {
    error: string | null;
    metric: string;
    name?: string;
    unit?: string;
    values?: number[];
    shownValues?: number[];
    grid?: F32;
    vmin?: number;
    vmax?: number;
    diverging?: boolean;
    note?: string | null;
    mapClass?: number | 'diff';
    pair?: { a: number; b: number };
  };
}
export interface BandResponse {
  shape: number[];
  hash: string;
  bins: F32;
  curves: { class: number; shown: boolean; psd: F32 }[];
  baseline: F32 | null;
  example: { trial: number; channel: string; raw: F32; filtered: F32; times: F32 };
  welch: { nperseg: number; noverlap: number; nfft: number };
  resolutionHz: number;
  warnings: string[];
  sos: F32;
}
export interface FamilyMeta {
  id: string;
  title: string;
  names: string[];
  units: string[];
  count: number;
  interval?: string;
  formula?: string;
  category?: string;
  learned?: boolean;
  preview?: Record<string, unknown>;
  error: string | null;
  explanation: string;
  duplicates?: number;
  warnings?: string[];
  droppedSamples?: number;
  [k: string]: unknown;
}
export interface FeaturesResponse {
  shape: [number, number] | null;
  hash: string;
  usingDefault: boolean;
  defaultFeature: string;
  selected: { families: FamilyMeta[]; total: number };
  cards: Record<string, FamilyMeta>;
  errors: string[];
  learnedSelected: string[];
  filterWarnings: string[];
}
export interface HistSide {
  values: F32;
  edges: number[];
  counts: number[][];
  bin: number[];
  skew: number;
  kurtosis: number;
  perClass: { mean: number; std: number }[];
}
export interface TransformResponse {
  shape: number[];
  hash: string;
  feature: string;
  featureIndex: number;
  before: HistSide;
  after: HistSide;
  logSkipped: number;
  logApplied: boolean | null;
  footnote: string;
  defaultFeature?: string;
}
export interface Acc {
  mean: number;
  std: number;
  perFold: number[];
}
export interface EvaluateResponse {
  shape: [number, number];
  preShape: [number, number];
  hash: string;
  accuracy: Acc;
  correct: Acc;
  leaky: Acc;
  gapPoints: number;
  folds: number;
  foldMessage: string | null;
  foldDiagnostics: { fold: number; train: number; test: number; accuracy: number; leaky: number }[];
  foldIsolation: boolean;
  chance: number;
  classCounts: number[];
  learnedSteps: string[];
  anyLearned: boolean;
  names: string[];
  preNames: string[];
  units: string[];
  familyOf: string[];
  provenance: { name: string; sources: string[] }[];
  ranking: { auc: number[]; fisher: number[]; mi: number[] };
  preRanking: { auc: number[]; fisher: number[]; mi: number[] };
  pca: { explainedVarianceRatio: number[]; cumulative: number[] } | null;
  correlation: { order: number[]; names: string[]; matrix: F32 };
  matrix: F32;
  preMatrix: F32;
  scatter: {
    x: string;
    y: string;
    values: F32;
    accuracy: number;
    std: number;
    extent: [number, number, number, number];
    boundary?: { w: [number, number]; b: number };
    regions?: number[][];
  };
  pca2: F32;
  tsne: F32 | null;
  rowStrip: F32;
  exploratoryTag: string;
  classifier: string;
}
export interface ExportResponse {
  shape: number[];
  hash: string;
  script: string;
  settingsJson: Record<string, unknown>;
  token: string;
  mode: string;
  modeLabel: string;
  accuracy: number;
}
export interface AeStatus {
  id?: string;
  state: 'running' | 'done' | 'cancelled' | 'error' | 'unknown';
  progress?: number;
  history?: { epoch: number; train: number; val: number | null }[];
  result?: {
    trial: number;
    original: F32;
    reconstructed: F32;
    latentPca: F32;
    labels: number[];
    lossDrop: number;
    note: string;
  } | null;
  error?: string | null;
}
export interface ApiError {
  errors: string[];
}
