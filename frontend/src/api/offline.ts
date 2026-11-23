// Offline fallback: bundled, genuinely pre-computed results per built-in sample (scripts/make_fallback.py).
// Offline mode supports only the three built-in samples and their default settings.
import type { DatasetResponse } from './types';

type Bundle = Record<string, unknown> & { dataset: DatasetResponse };

const ROUTES: Record<string, string> = {
  '/paradigms': 'paradigms',
  '/window': 'window',
  '/channels': 'channels',
  '/band': 'band',
  '/features': 'features',
  '/transform': 'transform',
  '/evaluate': 'evaluate',
  '/export': 'export',
};

class Offline {
  active = false;
  currentPreset = 'motor_imagery';
  private bundles = new Map<string, Bundle>();

  async load(preset: string): Promise<Bundle> {
    const hit = this.bundles.get(preset);
    if (hit) return hit;
    const r = await fetch(`${import.meta.env?.BASE_URL ?? '/'}fallback/${preset}.json`);
    if (!r.ok) throw new Error('offline results are missing');
    const b = (await r.json()) as Bundle;
    this.bundles.set(preset, b);
    return b;
  }

  async dataset(preset: string): Promise<DatasetResponse> {
    this.currentPreset = preset;
    const b = await this.load(preset);
    return b.dataset;
  }

  async answer<T>(path: string, _body: unknown): Promise<T> {
    const b = await this.load(this.currentPreset);
    const key = ROUTES[path];
    if (!key || !(key in b)) throw new Error(`no offline result for ${path}`);
    return b[key] as T;
  }
}

export const offline = new Offline();
