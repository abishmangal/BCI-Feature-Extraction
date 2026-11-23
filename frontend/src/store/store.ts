// Single global Zustand store (section 7). Vanilla store so the engine can read and subscribe outside React.
import { createStore } from 'zustand/vanilla';
import { useStore as useZustand } from 'zustand';
import { decodeF32 } from '../api/f32';
import type {
  AeStatus,
  BandResponse,
  ChannelsResponse,
  DatasetResponse,
  ElectrodePreset,
  EvaluateResponse,
  ExportResponse,
  FeaturesResponse,
  ParadigmsResponse,
  Preset,
  ProbeFeature,
  TransformResponse,
  WindowResponse,
} from '../api/types';

export type FamilyId =
  | 'band_power'
  | 'csp'
  | 'hjorth'
  | 'wavelet'
  | 'covariance'
  | 'time_stats'
  | 'window_means'
  | 'spectral_features'
  | 'tf_regions'
  | 'asymmetry'
  | 'complexity'
  | 'autoencoder';

export interface MapSettings {
  metric: 'bandpower_change' | 'separability_bandpower' | 'separability_amplitude' | 'mean_amplitude' | 'mean_bandpower' | 'snr';
  band: [number, number] | null;
  frequency: number | null;
  mapClass: number | 'diff';
  pair: { a: number; b: number };
  visible: boolean;
  opacity: number;
}

export interface SelectionSettings {
  variance: { on: boolean; threshold: number };
  correlation: { on: boolean; threshold: number };
  ranking: { on: boolean; method: 'fisher' | 'mi'; topK: number };
  projection: { method: 'none' | 'pca' | 'lda'; components: number };
}

export interface Settings {
  paradigm: string;
  montage: string;
  timing: { sfreq: number; tmin: number; baseline: { start: number; end: number } | null };
  window: { start: number; end: number };
  channels: string[];
  band: { low: number; high: number; order: number };
  showClasses: number[];
  probe: { x: ProbeFeature; y: ProbeFeature };
  probeClasses: number[];
  baselineVisible: boolean;
  map: MapSettings;
  features: FamilyId[];
  featureSettings: Partial<Record<FamilyId, Record<string, unknown>>>;
  selectionSettings: SelectionSettings;
  transform: 'none' | 'log' | 'signed_log';
  normalise: 'none' | 'zscore' | 'robust' | 'minmax';
  classifier: 'lda' | 'logreg' | 'svm';
  cvFolds: number;
  leakageGuard: boolean;
  view: 'matrix' | 'correlation' | 'distribution' | 'scatter' | 'pca' | 'tsne';
  xFeature: string | null;
  yFeature: string | null;
  exportMode: 'exploratory' | 'oof';
  upstream: Record<string, unknown> | null;
  /** Page 4 example waveform (not part of the hashed pipeline). */
  exampleTrial: number;
  exampleChannel: string | null;
  inspectFeature: string | null;
  showPreSelection: boolean;
  showAllBands: boolean;
}

export interface Ui {
  scrollY: number;
  categoryFilter: 'All' | 'Time' | 'Frequency' | 'Time-frequency' | 'Spatial' | 'Learned';
  search: string;
  columnOffset: number;
  exportPhase: 'chips-left' | 'chips-in-panel';
  reduceMotion: boolean;
  ambientPaused: boolean;
  focusChannel: string | null;
  hoverTrial: number | null;
  hoverRow: number | null;
  draggingWindow: boolean;
  panelOpen: boolean;
  loadAnim: 'none' | 'pour' | 'drop' | 'replace';
  /** The leakage toggle has been flipped at least once (both bars are shown after that). */
  leakFlipped: boolean;
  matrixScroll: number;
  /** Family whose settings drawer is open on Page 5. */
  focusFamily: string | null;
  /** Page 5: the hovered card that is expanded sideways with its settings. */
  expandFamily: string | null;
  /** Keeps the sidebar away while the 5 -> 6 basket flip plays (avoids a mid-transition resize). */
  panelHold: boolean;
  /** Page 7: results are being computed on arrival, so the tiles swirl (spinPhase advances). */
  computingSpin: boolean;
  spinPhase: number;
  /** Size of the sidebar basket (px), so the stage knows where its opening is during the 5 -> 6 flip. */
  basketSize: { w: number; h: number };
}

export interface Data {
  status: 'empty' | 'loaded';
  version: number;
  id: string;
  source: 'sample' | 'csv' | 'npz';
  sampleId: string | null;
  paradigm: string;
  preset: Preset;
  sfreq: number;
  tmin: number;
  times: Float32Array;
  labels: Int32Array;
  classNames: string[];
  classCounts: number[];
  channels: string[];
  positions: ([number, number] | null)[];
  regions: string[];
  baseline: { start: number; end: number } | null;
  montage: string;
  layout: DatasetResponse['layout'];
  electrodePresets: ElectrodePreset[];
  pairs: { left: string; right: string }[];
  provenance: DatasetResponse['provenance'];
  upstream: DatasetResponse['upstream'];
  warnings: string[];
  shape: [number, number, number];
  display: { trials: number[]; points: number; ribbons: Float32Array; env: Float32Array };
}

export interface Results {
  window?: WindowResponse & { px: Float32Array; py: Float32Array; envD: Float32Array };
  channels?: ChannelsResponse & { spark: Float32Array; grid: Float32Array | null };
  band?: BandResponse & {
    binsD: Float32Array;
    psdD: Float32Array[];
    baseD: Float32Array | null;
    raw: Float32Array;
    filt: Float32Array;
    timesD?: Float32Array;
  };
  features?: FeaturesResponse;
  transform?: TransformResponse & { beforeD: Float32Array; afterD: Float32Array };
  evaluate?: EvaluateResponse & {
    Z: Float32Array;
    F: Float32Array;
    scatterD: Float32Array;
    pca2D: Float32Array;
    tsneD: Float32Array | null;
    stripD: Float32Array;
    corrD: Float32Array;
  };
  export?: ExportResponse;
  ae?: AeStatus & { jobId?: string };
}

export type Endpoint =
  'dataset' | 'window' | 'channels' | 'band' | 'features' | 'transform' | 'evaluate' | 'export' | 'ae';

export interface AppState {
  page: number;
  paradigms: ParadigmsResponse | null;
  data: Data | null;
  settings: Settings;
  ui: Ui;
  results: Results;
  status: Record<Endpoint, { loading: boolean; error: string | null }>;
  offline: boolean;
  limited: boolean;
  visited: number[];
  touched: {
    window: boolean;
    channels: boolean;
    band: boolean;
    features: boolean;
    channelsChangedByUser: boolean;
  };
  presetTag: string | null;
  csvForm: { sfreq: string; tmin: string; b0: string; b1: string; montage: string; interpret: string };
  sampleChoice: string;
  ripple: { from: number; seq: number };
  fpsNote: string | null;
  shownTrialsLimit: number;
}

export const DEFAULT_SELECTION: SelectionSettings = {
  variance: { on: false, threshold: 0 },
  correlation: { on: false, threshold: 0.95 },
  ranking: { on: false, method: 'fisher', topK: 20 },
  projection: { method: 'none', components: 2 },
};

export function emptyPreset(): Preset {
  return {
    id: 'custom',
    name: 'Custom',
    classNames: null,
    eventLabel: 'event',
    baseline: null,
    zone: null,
    defaultWindow: { start: 0, end: 1 },
    defaultBand: { low: 1, high: 40, order: 4 },
    windowPresets: [{ label: 'Full epoch', full: true }],
    bandPresets: [],
    channelPresets: [],
    probe: {
      x: { channel: '', type: 'log_band_power', band: [1, 40], followBand: true },
      y: { channel: '', type: 'log_band_power', band: [1, 40], followBand: true },
    },
    mapMetric: { metric: 'separability_bandpower', band: null, mapClass: 0 },
    keyBands: [],
    stimulusFrequencies: null,
    defaultFeature: { family: 'band_power', settings: {} },
    recommendedFamilies: [],
    waveletRange: [4, 30],
    hints: null,
    facts: null,
  };
}

export function defaultSettings(data: Data | null, prev?: Settings): Settings {
  const p = data?.preset ?? emptyPreset();
  const K = data?.classNames.length ?? 2;
  const def = data?.electrodePresets.find((e) => e.isDefault);
  return {
    paradigm: data?.paradigm ?? 'custom',
    montage: data?.montage ?? prev?.montage ?? 'standard_1005',
    timing: { sfreq: data?.sfreq ?? 250, tmin: data?.tmin ?? 0, baseline: data?.baseline ?? null },
    window: { ...p.defaultWindow },
    channels: def ? [...def.channels] : [...(data?.channels ?? [])],
    band: { ...p.defaultBand },
    showClasses: Array.from({ length: K }, (_, i) => i),
    probe: { x: { ...p.probe.x }, y: { ...p.probe.y } },
    probeClasses: Array.from({ length: K }, (_, i) => i),
    baselineVisible: true,
    map: {
      metric: p.mapMetric.metric,
      band: p.mapMetric.band,
      frequency: null,
      mapClass: p.mapMetric.mapClass,
      pair: { a: K - 1, b: 0 },
      visible: true,
      opacity: 70,
    },
    features: [],
    featureSettings: {},
    selectionSettings: structuredClone(DEFAULT_SELECTION),
    transform: 'none',
    normalise: 'none',
    classifier: 'lda',
    cvFolds: 5,
    leakageGuard: true,
    view: 'matrix',
    xFeature: null,
    yFeature: null,
    exportMode: 'exploratory',
    upstream: data?.upstream ?? null,
    exampleTrial: 0,
    exampleChannel: null,
    inspectFeature: null,
    showPreSelection: false,
    showAllBands: false,
  };
}

export function decodeDataset(r: DatasetResponse, version: number): Data {
  return {
    status: 'loaded',
    version,
    id: r.id,
    source: r.source,
    sampleId: r.sampleId,
    paradigm: r.paradigm,
    preset: r.preset,
    sfreq: r.sfreq,
    tmin: r.tmin,
    times: decodeF32(r.times),
    labels: Int32Array.from(r.labels),
    classNames: r.classNames,
    classCounts: r.classCounts,
    channels: r.channels,
    positions: r.positions,
    regions: r.regions,
    baseline: r.baseline,
    montage: r.montage,
    layout: r.layout,
    electrodePresets: r.electrodePresets,
    pairs: r.asymmetryPairs,
    provenance: r.provenance,
    upstream: r.upstream,
    warnings: r.warnings,
    shape: r.shape,
    display: {
      trials: r.display.trials,
      points: r.display.points,
      ribbons: decodeF32(r.display.ribbons),
      env: decodeF32(r.display.env),
    },
  };
}

const status0 = (): AppState['status'] => ({
  dataset: { loading: false, error: null },
  window: { loading: false, error: null },
  channels: { loading: false, error: null },
  band: { loading: false, error: null },
  features: { loading: false, error: null },
  transform: { loading: false, error: null },
  evaluate: { loading: false, error: null },
  export: { loading: false, error: null },
  ae: { loading: false, error: null },
});

const reducedPref =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

export const store = createStore<AppState>(() => ({
  page: 1,
  paradigms: null,
  data: null,
  settings: defaultSettings(null),
  ui: {
    scrollY: 0,
    categoryFilter: 'All',
    search: '',
    columnOffset: 0,
    exportPhase: 'chips-left',
    reduceMotion: reducedPref,
    ambientPaused: false,
    focusChannel: null,
    hoverTrial: null,
    hoverRow: null,
    draggingWindow: false,
    panelOpen: true,
    loadAnim: 'none',
    leakFlipped: false,
    matrixScroll: 0,
    focusFamily: null,
    expandFamily: null,
    panelHold: false,
    computingSpin: false,
    spinPhase: 0,
    basketSize: { w: 290, h: 400 },
  },
  results: {},
  status: status0(),
  offline: false,
  limited: false,
  visited: [1],
  touched: { window: false, channels: false, band: false, features: false, channelsChangedByUser: false },
  presetTag: null,
  csvForm: { sfreq: '250', tmin: '0', b0: '', b1: '', montage: 'standard_1005', interpret: 'custom' },
  sampleChoice: 'motor_imagery',
  ripple: { from: 0, seq: 0 },
  fpsNote: null,
  shownTrialsLimit: 200,
}));

export function useStore<T>(selector: (s: AppState) => T): T {
  return useZustand(store, selector);
}

export const get = store.getState;
export const set = store.setState;

// ---------------------------------------------------------------------------------------------
// Actions
/** Which page a settings key belongs to (for the change ripple). */
const PAGE_OF: Partial<Record<keyof Settings, number>> = {
  timing: 1,
  montage: 1,
  paradigm: 1,
  window: 2,
  probe: 2,
  channels: 3,
  map: 3,
  showClasses: 3,
  band: 4,
  baselineVisible: 4,
  exampleTrial: 4,
  exampleChannel: 4,
  showAllBands: 4,
  features: 5,
  featureSettings: 5,
  transform: 6,
  normalise: 6,
  inspectFeature: 6,
  selectionSettings: 7,
  classifier: 7,
  cvFolds: 7,
  leakageGuard: 7,
  view: 7,
  xFeature: 7,
  yFeature: 7,
  showPreSelection: 7,
  exportMode: 8,
};

export function selectChannelGroup(
  channelOrder: string[],
  current: string[],
  group: string[],
  action: 'add' | 'remove' | 'toggle' = 'toggle',
): string[] {
  const selected = new Set(current);
  const remove = action === 'remove' || (action === 'toggle' && group.every((channel) => selected.has(channel)));
  for (const channel of group) {
    if (remove) selected.delete(channel);
    else selected.add(channel);
  }
  return channelOrder.filter((channel) => selected.has(channel));
}

export function updateSettings(patch: Partial<Settings>): void {
  const s = get();
  const keys = Object.keys(patch) as (keyof Settings)[];
  const pages = keys.map((k) => PAGE_OF[k] ?? s.page);
  const from = Math.min(...pages);
  const touched = { ...s.touched };
  if ('window' in patch) touched.window = true;
  if ('channels' in patch) {
    touched.channels = true;
    touched.channelsChangedByUser = true;
  }
  if ('band' in patch) touched.band = true;
  if ('features' in patch) touched.features = true;
  set({
    settings: { ...s.settings, ...patch },
    touched,
    ripple: { from, seq: s.ripple.seq + 1 },
  });
}

export function updateUi(patch: Partial<Ui>): void {
  set({ ui: { ...get().ui, ...patch } });
}

export function setStatus(ep: Endpoint, loading: boolean, error: string | null = null): void {
  const s = get();
  set({ status: { ...s.status, [ep]: { loading, error } } });
}

export function setResult<K extends keyof Results>(k: K, v: Results[K]): void {
  set({ results: { ...get().results, [k]: v } });
}

export function navigate(page: number): void {
  const s = get();
  const p = s.data ? Math.max(1, Math.min(8, page)) : 1;
  if (p === s.page) return;
  const visited = s.visited.includes(p) ? s.visited : [...s.visited, p];
  let ui = p === 8 || s.page === 8 ? { ...s.ui, exportPhase: 'chips-left' as const } : s.ui;
  ui = { ...ui, expandFamily: null, focusChannel: null, panelHold: s.page === 5 && p === 6 };
  set({ page: p, visited, ui });
  if (ui.panelHold)
    setTimeout(() => get().ui.panelHold && set({ ui: { ...get().ui, panelHold: false } }), 2300);
}
