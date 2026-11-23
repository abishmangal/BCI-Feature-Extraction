// Offline fallback: bundled, genuinely pre-computed results per built-in sample (scripts/make_fallback.py).
// Offline mode supports only the three built-in samples and their default settings.
import type { ChannelsResponse, DatasetResponse } from './types';

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
  private amplitudeMaps?: Record<string, ChannelsResponse['map']>;
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

  async answer<T>(path: string, body: unknown): Promise<T> {
    const b = await this.load(this.currentPreset);
    const key = ROUTES[path];
    if (!key || !(key in b)) throw new Error(`no offline result for ${path}`);
    const map = (body as { map?: { metric?: string; mapClass?: number | 'diff'; pair?: { a: number; b: number } } }).map;
    if (path === '/channels' && this.currentPreset === 'erp_p300' && map?.metric === 'mean_amplitude') {
      if (!this.amplitudeMaps) {
        const r = await fetch(`${import.meta.env.BASE_URL}fallback/erp_p300_amplitude_maps.json`);
        if (!r.ok) throw new Error('Offline P300 amplitude maps are missing.');
        this.amplitudeMaps = await r.json() as Record<string, ChannelsResponse['map']>;
      }
      const selection = map.mapClass === 'diff' && map.pair ? `${map.pair.a}-${map.pair.b}` : String(map.mapClass ?? 0);
      const selected = this.amplitudeMaps[selection];
      if (selected) return { ...(b.channels as ChannelsResponse), map: selected } as T;
    }
    return b[key] as T;
  }
}

export const offline = new Offline();
