// Backend effects: whenever a control changes a setting, call the backend (debounced, cancellable, cached)
// for what the current page needs. Downstream pages recompute lazily when visited.
import { api, ApiFailure } from '../api/client';
import { offline } from '../api/offline';
import { decodeF32 } from '../api/f32';
import type { DatasetResponse } from '../api/types';
import {
  decodeDataset,
  defaultSettings,
  get,
  set,
  setResult,
  setStatus,
  store,
  type AppState,
  type Endpoint,
} from './store';

const errText = (e: unknown): string =>
  e instanceof ApiFailure ? e.errors.join(' ') : ((e as Error)?.message ?? String(e));

function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const s = get();
  return { dataset_id: s.data?.id, settings: s.settings, ...extra };
}

/** While true, the fetch functions run as a silent background prefetch for the next page. */
let prefetching = false;
const K = (name: string): string => (prefetching ? `pre:${name}` : name);
const D = (ms: number): number => (prefetching ? 350 : ms);

async function run<T>(ep: Endpoint, p: Promise<T>, onOk: (v: T) => void): Promise<void> {
  if (prefetching) {
    // Silent: no loading or error state; keep the result only if the settings are still the same.
    const snap = get().settings;
    const data = get().data;
    try {
      const v = await p;
      if (get().settings === snap && get().data === data) onOk(v);
    } catch {
      /* the page's own request will report errors */
    }
    return;
  }
  // Only show "loading" if the answer is not already there (cached or prefetched results show at once).
  let done = false;
  const t = setTimeout(() => !done && setStatus(ep, true, null), 60);
  try {
    const v = await p;
    done = true;
    clearTimeout(t);
    onOk(v);
    setStatus(ep, false, null);
  } catch (e) {
    done = true;
    clearTimeout(t);
    setStatus(ep, false, errText(e));
  }
}

export function fetchWindow(debounce = 120): void {
  const s = get();
  if (!s.data) return;
  void run('window', api.window(body({ probe: s.settings.probe }), D(debounce), K('window')), (r) =>
    setResult('window', { ...r, px: decodeF32(r.probe.x), py: decodeF32(r.probe.y), envD: decodeF32(r.env) }),
  );
}
export function fetchChannels(): void {
  const s = get();
  if (!s.data || !s.settings.channels.length) return;
  void run(
    'channels',
    api.channels(body({ show_classes: s.settings.showClasses, map: s.settings.map }), D(120), K('channels')),
    (r) => {
      if (get().data !== s.data || get().settings.map !== s.settings.map) return;
      setResult('channels', {
        ...r,
        spark: decodeF32(r.sparklines),
        grid: r.map.grid ? decodeF32(r.map.grid) : null,
      });
    },
  );
}
export function fetchBand(debounce = 60): void {
  const s = get();
  if (!s.data || !s.settings.channels.length) return;
  const ex =
    s.settings.exampleChannel && s.settings.channels.includes(s.settings.exampleChannel)
      ? s.settings.exampleChannel
      : s.settings.channels[0];
  void run(
    'band',
    api.band(
      body({
        ...s.settings.band,
        example_trial: s.settings.exampleTrial,
        example_channel: ex,
        show_classes: s.settings.showClasses,
      }),
      D(debounce),
      K('band'),
    ),
    (r) =>
      setResult('band', {
        ...r,
        binsD: decodeF32(r.bins),
        psdD: r.curves.map((c) => decodeF32(c.psd)),
        baseD: r.baseline ? decodeF32(r.baseline) : null,
        raw: decodeF32(r.example.raw),
        filt: decodeF32(r.example.filtered),
        timesD: decodeF32(r.example.times),
      }),
  );
}
export function fetchFeatures(): void {
  if (!get().data || !get().settings.channels.length) return;
  void run('features', api.features(body(), D(120), K('features')), (r) => setResult('features', r));
}
export function fetchTransform(): void {
  const s = get();
  if (!s.data || !s.settings.channels.length) return;
  void run(
    'transform',
    api.transform(
      body({
        transform: s.settings.transform,
        normalise: s.settings.normalise,
        feature: s.settings.inspectFeature,
      }),
      D(120),
      K('transform'),
    ),
    (r) =>
      setResult('transform', {
        ...r,
        beforeD: decodeF32(r.before.values),
        afterD: decodeF32(r.after.values),
      }),
  );
}
let spinTimer: ReturnType<typeof setInterval> | null = null;
function stopSpin(): void {
  if (spinTimer) clearInterval(spinTimer);
  spinTimer = null;
  if (get().ui.computingSpin) set({ ui: { ...get().ui, computingSpin: false } });
}
/** Arriving on Page 7 while the matrix is still computing: the tiles swirl until the result lands. */
export function startSpinIfComputing(): void {
  setTimeout(() => {
    const s = get();
    if (s.page !== 7 || !s.status.evaluate.loading || s.ui.reduceMotion) return;
    set({ ui: { ...s.ui, computingSpin: true } });
    if (spinTimer) clearInterval(spinTimer);
    spinTimer = setInterval(() => {
      const st = get();
      if (st.page !== 7 || !st.status.evaluate.loading) return stopSpin();
      set({ ui: { ...st.ui, spinPhase: st.ui.spinPhase + 1 } });
    }, 220);
  }, 140);
}

export function fetchEvaluate(): void {
  const s = get();
  if (!s.data || !s.settings.channels.length) return;
  void run('evaluate', api.evaluate(body(), D(120), K('evaluate')), (r) =>
    setResult('evaluate', {
      ...r,
      Z: decodeF32(r.matrix),
      F: decodeF32(r.preMatrix),
      scatterD: decodeF32(r.scatter.values),
      pca2D: decodeF32(r.pca2),
      tsneD: r.tsne ? decodeF32(r.tsne) : null,
      stripD: decodeF32(r.rowStrip),
      corrD: decodeF32(r.correlation.matrix),
    }),
  );
}
export function fetchExport(): void {
  const s = get();
  if (!s.data || !s.settings.channels.length) return;
  void run('export', api.export(body({ export_mode: s.settings.exportMode }), D(120), K('export')), (r) =>
    setResult('export', r),
  );
}

/** Background prefetch of what the NEXT page needs, so it is ready on arrival (no computing wait). */
export function prefetchNext(page = get().page): void {
  if (!get().data || offline.active) return;
  prefetching = true;
  try {
    if (page === 1) fetchWindow();
    if (page === 2) fetchChannels();
    if (page === 3) fetchBand();
    if (page === 3 || page === 4) fetchFeatures(); // page 5 needs the feature cards and counts
    if (page === 5) fetchTransform();
    if (page === 6) fetchEvaluate();
    if (page === 7) fetchExport();
  } finally {
    prefetching = false;
  }
}

/** What each page needs from the backend. */
export function refreshPage(page = get().page): void {
  const s = get();
  if (!s.data) return;
  if (page === 2) fetchWindow();
  if (page === 3) fetchChannels();
  if (page === 4) fetchBand();
  if (page === 5 || page === 6) fetchFeatures();
  if (page === 6) fetchTransform();
  if (page === 7 || page === 8) {
    fetchFeatures();
    fetchEvaluate();
  }
  if (page === 8) fetchExport();
}

// -------------------------------------------------------------------------------------------
let version = 0;

export function applyDataset(r: DatasetResponse, anim: AppState['ui']['loadAnim']): void {
  const prev = get().data;
  version += 1;
  const data = decodeDataset(r, version);
  const s = get();
  set({
    data,
    settings: defaultSettings(data, s.settings),
    results: {},
    touched: { window: false, channels: false, band: false, features: false, channelsChangedByUser: false },
    presetTag: data.paradigm !== 'custom' ? `defaults from ${data.preset.name}` : null,
    ui: {
      ...s.ui,
      loadAnim: prev ? 'replace' : anim,
      scrollY: 0,
      columnOffset: 0,
      focusChannel: null,
      hoverTrial: null,
      hoverRow: null,
      leakFlipped: false,
    },
    csvForm: { ...s.csvForm, montage: data.montage },
  });
  refreshPage();
  prefetchNext();
}

export async function loadSample(pid: string): Promise<void> {
  setStatus('dataset', true, null);
  try {
    const r = await api.synthetic(pid);
    applyDataset(r, 'pour');
    setStatus('dataset', false, null);
  } catch (e) {
    setStatus('dataset', false, errText(e));
  }
}

export async function loadCsv(file: File): Promise<void> {
  setStatus('dataset', true, null);
  try {
    const r = await api.uploadCsv(file, get().csvForm);
    applyDataset(r, 'drop');
    setStatus('dataset', false, null);
  } catch (e) {
    setStatus('dataset', false, errText(e));
  }
}

export async function loadNpz(file: File): Promise<void> {
  setStatus('dataset', true, null);
  try {
    const r = await api.uploadNpz(file, get().csvForm);
    applyDataset(r, 'drop');
    setStatus('dataset', false, null);
  } catch (e) {
    setStatus('dataset', false, errText(e));
  }
}

/** "Interpret as": applies that preset's defaults; the loaded data does not change. */
export async function interpretAs(pid: string): Promise<void> {
  const d = get().data;
  set({ csvForm: { ...get().csvForm, interpret: pid } });
  if (!d) return;
  try {
    const r = await api.interpret(d.id, pid);
    const data = decodeDataset(r, d.version);
    set({
      data,
      settings: defaultSettings(data, get().settings),
      results: {},
      presetTag: pid !== 'custom' ? `defaults from ${data.preset.name}` : null,
      touched: { window: false, channels: false, band: false, features: false, channelsChangedByUser: false },
    });
    refreshPage();
  } catch (e) {
    setStatus('dataset', false, errText(e));
  }
}

export async function changeMontage(m: string): Promise<void> {
  const d = get().data;
  set({ csvForm: { ...get().csvForm, montage: m } });
  if (!d) return;
  try {
    const r = await api.montage(d.id, m);
    const data = decodeDataset(r, d.version + 0.5);
    set({ data, settings: { ...get().settings, montage: m } });
  } catch (e) {
    setStatus('dataset', false, errText(e));
  }
}

// -------------------------------------------------------------------------------------------
// Autoencoder preview training: progress indicator, cancel.
let aeTimer: ReturnType<typeof setTimeout> | null = null;
export async function trainAutoencoder(): Promise<void> {
  try {
    setStatus('ae', true, null);
    const { job_id } = await api.aeTrain(body({ example_trial: get().settings.exampleTrial }));
    setResult('ae', { state: 'running', jobId: job_id, progress: 0 });
    const poll = async (): Promise<void> => {
      const st = await api.aeStatus(job_id);
      setResult('ae', { ...st, jobId: job_id });
      if (st.state === 'running') aeTimer = setTimeout(() => void poll(), 300);
      else setStatus('ae', false, st.error ?? null);
    };
    void poll();
  } catch (e) {
    setStatus('ae', false, errText(e));
  }
}
export async function cancelAutoencoder(): Promise<void> {
  const id = get().results.ae?.jobId;
  if (aeTimer) clearTimeout(aeTimer);
  if (id) await api.aeCancel(id);
  setResult('ae', { ...(get().results.ae ?? { state: 'cancelled' }), state: 'cancelled' });
  setStatus('ae', false, null);
}

// -------------------------------------------------------------------------------------------
let started = false;
export async function startApp(): Promise<void> {
  if (started) return;
  started = true;
  const ok = await api.health();
  if (!ok) {
    offline.active = true;
    set({ offline: true });
  }
  try {
    const p = await api.paradigms();
    set({ paradigms: p });
  } catch (e) {
    setStatus('dataset', false, errText(e));
  }
  // Re-fetch on settings changes (debounced in the client).
  store.subscribe((s, prev) => {
    if (!s.data) return;
    if (s.page !== prev.page) {
      refreshPage(s.page);
      prefetchNext(s.page);
      if (s.page === 7) startSpinIfComputing();
      return;
    }
    if (prev.status.evaluate.loading && !s.status.evaluate.loading) stopSpin();
    if (s.settings !== prev.settings) {
      refreshPage(s.page);
      prefetchNext(s.page);
    }
  });
}
