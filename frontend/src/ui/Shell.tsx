// Top bar, page header (title, caption, hint, tags) and the shape badge. DOM only.
import { memo, useEffect, useMemo, useRef } from 'react';
import { navigate, store, updateUi, useStore, type AppState } from '../store/store';
import { CAPTIONS, PAGE_TITLES } from './meta';
import { Switch } from './controls';
import { shapes } from '../layouts/common';

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
const RAIL_ICONS = [
  'M3 11v5h14v-5 M10 3v9m-4-4 4 4 4-4',
  'M6 3H3v14h3m8-14h3v14h-3 M6 10q2-5 4 0t4 0',
  'M8 5l2-3 2 3 M16.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0 M7 11h.1m2.9 0h.1m2.9 0h.1m-3.1-3h.1',
  'M2 10q2-10 4 0t4 0 4 0 4 0',
  'M3 9h14l-2 8H5z M6 9q4-9 8 0 M4 13h12',
  'M2 16c6 0 4-12 8-12s2 12 8 12',
  'M3 3h14v14H3z M8 3v14m4-14v14 M3 8h14m-14 4h14',
  'm7 5-5 5 5 5m6-10 5 5-5 5 M12 3 8 17',
];
const RAIL_SUFFIXES = ['', '', '', ' (filtered)', ' (features)', ' (transformed)', ' (selected)', ''];

export const PipelineRail = memo(function PipelineRail() {
  const page = useStore((s) => s.page);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const results = useStore((s) => s.results);
  const labels = useMemo(
    () => shapes({ data, settings, backendResults: results })
      .map((shape, k) => shape ? shape.join('x') + RAIL_SUFFIXES[k] : k === 7 ? 'script' : '-'),
    [data, settings, results],
  );
  const steps = useRef<HTMLDivElement>(null);
  useEffect(() => store.subscribe((s, prev) => {
    if (s.ripple.seq === prev.ripple.seq || s.ui.reduceMotion ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    steps.current?.querySelectorAll('.rail-icon').forEach((icon, k) => {
      if (k < s.ripple.from - 1) return;
      icon.animate(
        [{ boxShadow: '0 0 0 3px var(--teal)' }, { boxShadow: '0 0 0 8px transparent' }],
        { duration: 270, delay: (k - s.ripple.from + 1) * 120, easing: 'ease-out' },
      );
    });
  }), []);
  return (
    <nav className="pipeline-rail" aria-label="Page navigation">
      <div className="rail-steps" ref={steps}>
        {RAIL_ICONS.map((path, k) => (
          <button
            key={path}
            className="rail-step"
            data-testid={`rail-${k + 1}`}
            aria-current={page === k + 1 ? 'step' : undefined}
            aria-label={`Go to page ${k + 1}`}
            title={PAGE_TITLES[k]}
            onClick={() => navigate(k + 1)}
          >
            <span className="rail-icon">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d={path} /></svg>
            </span>
            <span className="rail-label">{labels[k]}</span>
          </button>
        ))}
      </div>
      <RailNav page={page} />
    </nav>
  );
});

function RailNav({ page }: { page: number }) {
  return (
    <div className="rail-nav">
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
}

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
      {data && page >= 2 && page <= 3 ? (
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
