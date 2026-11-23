// Top bar, page header (title, caption, hint, tags) and the shape badge. DOM only.
import { memo } from 'react';
import { navigate, updateUi, useStore, type AppState } from '../store/store';
import { CAPTIONS, PAGE_TITLES } from './meta';
import { Switch } from './controls';

export const TopBar = memo(function TopBar() {
  const tag = useStore((s) =>
    s.data ? (s.data.paradigm === 'custom' ? 'Custom' : s.data.preset.name) : 'Custom',
  );
  const offline = useStore((s) => s.offline);
  const limited = useStore((s) => s.limited);
  const paused = useStore((s) => s.ui.ambientPaused);
  const reduced = useStore((s) => s.ui.reduceMotion);
  const fpsNote = useStore((s) => s.fpsNote);
  return (
    <header className="topbar">
      <span className="brand">EEG feature engineering</span>
      <span className="tag" data-testid="paradigm-tag">
        {tag}
      </span>
      {offline ? (
        <span className="tag tag-warn" data-testid="offline-tag">
          offline sample results
        </span>
      ) : null}
      {limited ? <span className="tag tag-warn">limited rendering mode</span> : null}
      {fpsNote ? <span className="tag">{fpsNote}</span> : null}
      <span className="spacer" />
      <button
        className="btn ghost"
        data-testid="pause-ambient"
        aria-pressed={paused}
        onClick={() => updateUi({ ambientPaused: !paused })}
      >
        {paused ? 'Resume ambient motion' : 'Pause ambient motion'}
      </button>
      <Switch checked={reduced} onChange={(v) => updateUi({ reduceMotion: v })} label="Reduce motion" />
    </header>
  );
});

/** Page navigation at the right end of the pipeline rail. */
export const RailNav = memo(function RailNav() {
  const page = useStore((s) => s.page);
  return (
    <div className="rail-nav" role="navigation" aria-label="Page navigation">
      <button
        className="btn ghost nav-btn"
        onClick={() => navigate(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        &lsaquo; Back
      </button>
      <span className="mono small page-of">{page} / 8</span>
      <button
        className="btn primary nav-btn"
        onClick={() => navigate(page + 1)}
        disabled={page >= 8}
        aria-label="Next page"
      >
        Next &rsaquo;
      </button>
    </div>
  );
});

export function freeTags(s: AppState): string[] {
  const p = s.page;
  const tags: string[] = [];
  if (!s.data) return tags;
  if (p > 2 && !s.visited.includes(2)) tags.push('using default window');
  const allCh = s.settings.channels.length === s.data.channels.length;
  if ((p === 3 && allCh && !s.touched.channelsChangedByUser) || (p > 3 && !s.visited.includes(3) && allCh))
    tags.push('using all channels');
  if (p > 4 && !s.visited.includes(4)) tags.push('using full band');
  if (p >= 5 && s.settings.features.length === 0)
    tags.push(`no features chosen: using ${s.data.preset.defaultFeature.family}`);
  return tags;
}

export const PageHeader = memo(function PageHeader() {
  const page = useStore((s) => s.page);
  const data = useStore((s) => s.data);
  const hint = useStore((s) => {
    const h = s.data?.preset.hints;
    if (!h) return null;
    return page === 2 ? h.page2 : page === 3 ? h.page3 : page === 4 ? h.page4 : null;
  });
  const tags = useStore((s) => freeTags(s).join('|'));
  const presetTag = useStore((s) => s.presetTag);
  const upstream = useStore((s) =>
    s.data?.upstream?.settings ? JSON.stringify(s.data.upstream.settings) : null,
  );
  return (
    <div className="page-header">
      <h1>{PAGE_TITLES[page - 1]}</h1>
      <p className="caption">{CAPTIONS[page - 1]}</p>
      {hint ? <p className="hint">{hint}</p> : null}
      {data && page <= 3 ? (
        <p className="hint">
          {data.shape[0]} trials · {data.shape[1]} recorded channels · {data.sfreq} Hz
        </p>
      ) : null}
      <div className="tags">
        {presetTag ? <span className="tag">{presetTag}</span> : null}
        {upstream && page >= 2 && page <= 4 ? (
          <span className="tag" title={upstream}>
            Upstream settings inherited
          </span>
        ) : null}
        {tags
          .split('|')
          .filter(Boolean)
          .map((t) => (
            <span key={t} className="tag" data-testid="free-tag">
              {t}
            </span>
          ))}
      </div>
    </div>
  );
});

export function localWindowSamples(s: AppState): number {
  const d = s.data;
  if (!d) return 0;
  const { start, end } = s.settings.window;
  let n = 0;
  for (let i = 0; i < d.times.length; i++) if (d.times[i] >= start - 1e-9 && d.times[i] < end - 1e-9) n++;
  return n;
}

export function shapeFor(s: AppState): string {
  const d = s.data;
  if (!d) return 'no data';
  const n = d.shape[0];
  const ns = localWindowSamples(s);
  const nc = s.settings.channels.length;
  const r = s.results;
  switch (s.page) {
    case 1:
      return d.shape.join(' x ');
    case 2:
      return `${n} x ${d.shape[1]} x ${ns}`;
    case 3:
    case 4:
      return `${n} x ${nc} x ${ns}`;
    case 5:
    case 6:
      return r.features?.shape ? r.features.shape.join(' x ') : `${n} x ...`;
    default:
      return r.evaluate
        ? (s.settings.showPreSelection ? r.evaluate.preShape : r.evaluate.shape).join(' x ')
        : `${n} x ...`;
  }
}

export const ShapeBadge = memo(function ShapeBadge() {
  const text = useStore(shapeFor);
  const shown = useStore((s) => (s.data ? s.data.display.trials.length : 0));
  const total = useStore((s) => (s.data ? s.data.shape[0] : 0));
  const lim = useStore((s) => s.shownTrialsLimit);
  const m = Math.min(shown, lim);
  return (
    <div className="badge-wrap">
      <span className="shape-badge" data-testid="shape-badge" aria-live="polite">
        {text}
      </span>
      {total && m < total ? (
        <span className="tag">
          showing {m} of {total} trials
        </span>
      ) : null}
    </div>
  );
});
