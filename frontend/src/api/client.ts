// Typed backend client: debounced (120 ms default), stale in-flight requests cancelled with AbortController,
// results cached by a hash of the request body. Falls back to bundled offline results (offline.ts).
import type {
  AeStatus,
  BandResponse,
  ChannelsResponse,
  DatasetResponse,
  EvaluateResponse,
  ExportResponse,
  FeaturesResponse,
  ParadigmsResponse,
  TransformResponse,
  WindowResponse,
} from './types';
import { offline } from './offline';

export const API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000';

export class ApiFailure extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join('; '));
    this.errors = errors;
  }
}

export function hashKey(s: string): string {
  // FNV-1a 32-bit over the JSON text.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const cache = new Map<string, unknown>();
const inflight = new Map<string, AbortController>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Requests in flight by request hash: an identical request (e.g. a prefetch) is shared, not restarted. */
const shared = new Map<string, Promise<unknown>>();

/** Resolve/reject like p, but stay pending if p was aborted (superseded). */
function quiet<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    p.then(resolve, (e: Error) => {
      if (e?.name !== 'AbortError') reject(e);
    });
  });
}

async function raw<T>(path: string, init: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API_BASE + path, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiFailure(['The backend is unreachable.']);
  }
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiFailure([`Unexpected response (${r.status}).`]);
  }
  if (!r.ok) {
    const errs = (data as { errors?: string[]; detail?: unknown })?.errors;
    throw new ApiFailure(errs ?? [`Request failed (${r.status}).`]);
  }
  return data as T;
}

/** A keyed, debounced, cancellable, cached POST. Only the latest call per key resolves. */
export function post<T>(key: string, path: string, body: unknown, debounceMs = 120): Promise<T> {
  const json = JSON.stringify(body);
  const ck = path + ':' + hashKey(json);
  if (offline.active) return offline.answer<T>(path, body);
  if (cache.has(ck)) {
    inflight.get(key)?.abort();
    inflight.delete(key);
    const t = timers.get(key);
    if (t) clearTimeout(t);
    return Promise.resolve(cache.get(ck) as T);
  }
  const running = shared.get(ck);
  if (running) {
    // The same request is already in flight (for example the prefetch made on the previous page): join it.
    const t = timers.get(key);
    if (t) clearTimeout(t);
    inflight.get(key)?.abort();
    inflight.delete(key);
    return quiet(running as Promise<T>);
  }
  return new Promise<T>((resolve, reject) => {
    const old = timers.get(key);
    if (old) clearTimeout(old);
    const run = (): void => {
      inflight.get(key)?.abort();
      const again = shared.get(ck);
      if (again) {
        quiet(again as Promise<T>).then(resolve, reject);
        return;
      }
      const ac = new AbortController();
      inflight.set(key, ac);
      const req = raw<T>(path, {
        method: 'POST',
        body: json,
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
      }).then((d) => {
        if (inflight.get(key) === ac) inflight.delete(key);
        cache.set(ck, d);
        if (cache.size > 200) cache.delete(cache.keys().next().value as string);
        return d;
      });
      shared.set(ck, req);
      req.finally(() => shared.get(ck) === req && shared.delete(ck)).catch(() => undefined);
      quiet(req).then(resolve, reject); // superseded (aborted) requests never resolve
    };
    if (debounceMs > 0) timers.set(key, setTimeout(run, debounceMs));
    else run();
  });
}

export const api = {
  async health(): Promise<boolean> {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2500);
      const r = await fetch(API_BASE + '/health', { signal: ac.signal });
      clearTimeout(t);
      return r.ok;
    } catch {
      return false;
    }
  },
  paradigms: (): Promise<ParadigmsResponse> =>
    offline.active ? offline.answer('/paradigms', {}) : raw('/paradigms', { method: 'GET' }),
  synthetic: (paradigm: string): Promise<DatasetResponse> =>
    offline.active
      ? offline.dataset(paradigm)
      : raw('/dataset/synthetic', {
          method: 'POST',
          body: JSON.stringify({ paradigm }),
          headers: { 'Content-Type': 'application/json' },
        }),
  uploadCsv(
    file: File,
    f: { sfreq: string; tmin: string; b0: string; b1: string; montage: string; interpret: string },
  ): Promise<DatasetResponse> {
    if (offline.active)
      return Promise.reject(new ApiFailure(['Offline mode supports only the built-in sample datasets.']));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('sfreq', f.sfreq);
    fd.append('tmin', f.tmin);
    fd.append('baseline_start', f.b0);
    fd.append('baseline_end', f.b1);
    fd.append('montage', f.montage);
    fd.append('interpret', f.interpret);
    return raw('/dataset/upload', { method: 'POST', body: fd });
  },
  uploadNpz(file: File, f: { montage: string; interpret: string }): Promise<DatasetResponse> {
    if (offline.active)
      return Promise.reject(new ApiFailure(['Offline mode supports only the built-in sample datasets.']));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('montage', f.montage);
    fd.append('interpret', f.interpret);
    return raw('/dataset/upload-npz', { method: 'POST', body: fd });
  },
  interpret: (dataset_id: string, paradigm: string): Promise<DatasetResponse> =>
    offline.active
      ? offline.dataset(offline.currentPreset)
      : post('interpret', '/dataset/interpret', { dataset_id, paradigm }, 0),
  montage: (dataset_id: string, montage: string): Promise<DatasetResponse> =>
    offline.active
      ? offline.dataset(offline.currentPreset)
      : post('montage', '/dataset/montage', { dataset_id, montage }, 0),
  window: (body: unknown, d = 120, key = 'window'): Promise<WindowResponse> => post(key, '/window', body, d),
  channels: (body: unknown, d = 120, key = 'channels'): Promise<ChannelsResponse> =>
    post(key, '/channels', body, d),
  band: (body: unknown, d = 60, key = 'band'): Promise<BandResponse> => post(key, '/band', body, d),
  features: (body: unknown, d = 120, key = 'features'): Promise<FeaturesResponse> =>
    post(key, '/features', body, d),
  featurePreview: (body: unknown): Promise<Record<string, unknown>> =>
    post('fpreview', '/feature-preview', body, 120),
  transform: (body: unknown, d = 120, key = 'transform'): Promise<TransformResponse> =>
    post(key, '/transform', body, d),
  evaluate: (body: unknown, d = 120, key = 'evaluate'): Promise<EvaluateResponse> =>
    post(key, '/evaluate', body, d),
  export: (body: unknown, d = 120, key = 'export'): Promise<ExportResponse> => post(key, '/export', body, d),
  aeTrain: (body: unknown): Promise<{ job_id: string }> =>
    offline.active
      ? Promise.reject(new ApiFailure(['Training needs the backend.']))
      : post('aetrain', '/autoencoder/train', body, 0),
  aeStatus: (id: string): Promise<AeStatus> => raw(`/autoencoder/status/${id}`, { method: 'GET' }),
  aeCancel: (id: string): Promise<AeStatus> => post('aecancel', '/autoencoder/cancel', { job_id: id }, 0),
  exportUrl: (token: string, kind: 'csv' | 'npz'): string =>
    `${API_BASE}/export/features.${kind}?token=${token}`,
};
