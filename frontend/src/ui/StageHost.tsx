// Stage host: the one canvas (owned by the engine singleton), the accessibility overlay and DOM overlays.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { engine, matrixRowAt, poseOf, stackTrialAt, buildCtx, chipsArrived } from '../engine/wiring';
import { get, navigate, selectChannelGroup, set, updateSettings, updateUi, useStore } from '../store/store';
import { loadCsv, loadNpz } from '../store/effects';
import { hideTip, registerTooltip, showTip } from './tooltip';
import { PageHeader, RailNav, ShapeBadge } from './Shell';
import { BandControls, CardPane, TimeWindowControls } from './Panels';
import { railNodes, epochSpan, windowSnap, minWindow, freqMax } from '../layouts/common';
import { p2Geo } from '../layouts/page2';
import { p3Geo, channelXY } from '../layouts/page3';
import { p4Geo } from '../layouts/page4';
import { p5Geo, maxScroll, TITLES } from '../layouts/page5';
import { p7Geo, VIEW_TABS, matrixInfo, RACE_TOP } from '../layouts/page7';
import { p8Geo } from '../layouts/page8';
import { FAMILY_IDS } from '../engine/registry';
import { CLASS_HEX } from '../engine/colors';
import type { FamilyId } from '../store/store';

type Rect = { x: number; y: number; w: number; h: number; visible: boolean };
type PosFn = () => Rect;
const positions = new Map<string, PosFn>();

function setPos(key: string, fn: PosFn | null): void {
  if (fn) positions.set(key, fn);
  else positions.delete(key);
}

/** Absolutely positioned focusable element; its position is written by the per-frame writer. */
const OverlayButton = memo(function OverlayButton(props: {
  id: string;
  pos: PosFn;
  label: string;
  onActivate?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onHover?: (on: boolean, e?: React.PointerEvent) => void;
  className?: string;
  pressed?: boolean;
  testid?: string;
  children?: ReactNode;
}) {
  const { id, pos } = props;
  useEffect(() => {
    setPos(id, pos);
    return () => setPos(id, null);
  }, [id, pos]);
  return (
    <button
      data-ov={id}
      data-testid={props.testid}
      className={`ov ${props.className ?? ''}`}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={(e) => props.onActivate?.(e)}
      onKeyDown={(e) => {
        props.onKeyDown?.(e);
      }}
      onPointerDown={props.onPointerDown}
      onPointerEnter={(e) => props.onHover?.(true, e)}
      onPointerMove={(e) => props.onHover?.(true, e)}
      onPointerLeave={() => props.onHover?.(false)}
      onFocus={() => props.onHover?.(true)}
      onBlur={() => props.onHover?.(false)}
    >
      {props.children}
    </button>
  );
});

function piecePos(id: string, wOverride?: number, hOverride?: number): Rect {
  const p = poseOf(id);
  if (!p) return { x: 0, y: 0, w: 0, h: 0, visible: false };
  const w = (wOverride ?? p.w) * Math.abs(p.sx);
  const h = (hOverride ?? p.h) * Math.abs(p.sy);
  return { x: p.x - w / 2, y: p.y - h / 2, w, h, visible: p.alpha > 0.05 && w > 1 && h > 1 };
}

// -------------------------------------------------------------------------------------------
function toggleChannel(name: string): void {
  const s = get();
  const cur = s.settings.channels;
  const has = cur.some((c) => c.toLowerCase() === name.toLowerCase());
  if (has && cur.length === 1) {
    set({
      status: {
        ...s.status,
        channels: { loading: false, error: 'At least one channel must stay selected.' },
      },
    });
    return;
  }
  const next = has
    ? cur.filter((c) => c.toLowerCase() !== name.toLowerCase())
    : s.data!.channels.filter((c) => c === name || cur.includes(c));
  updateSettings({ channels: next });
}

function ElectrodeOverlay() {
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const data = useStore((s) => s.data);
  const chans = useStore((s) => s.settings.channels);
  const values = useStore((s) => s.results.channels?.map.values ?? null);
  const unit = useStore((s) => s.results.channels?.map.unit ?? '');
  const order = useMemo(() => (data ? p3Geo(buildCtx()).order : []), [data]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const keepPreview = () => clearTimeout(closeTimer.current);
  const closePreview = () => {
    keepPreview();
    closeTimer.current = setTimeout(() => updateUi({ focusChannel: null }), 300);
  };
  if (!data) return null;
  const sel = new Set(chans.map((c) => c.toLowerCase()));
  return (
    <>
      {order.map((i) => {
        const name = data.channels[i];
        const inc = sel.has(name.toLowerCase());
        const val = values ? values[i] : null;
        const label = `${name}, ${inc ? 'included' : 'excluded'}${val !== null && val !== undefined ? `, map value ${val.toFixed(2)} ${unit}` : ''}`;
        return (
          <OverlayButton
            key={name}
            id={`el:${name}`}
            testid={`electrode-${name}`}
            pos={elPos(`electrode:${i}`)}
            label={label}
            pressed={inc}
            className="ov-round"
            onActivate={() => toggleChannel(name)}
            onHover={(on) => {
              if (on) {
                keepPreview();
                if (get().ui.focusChannel !== name) updateUi({ focusChannel: name });
              } else {
                closePreview();
              }
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown') return;
              const legendButton = e.currentTarget.closest('.overlay')
                ?.querySelector<HTMLButtonElement>('.electrode-preview-legend button');
              if (legendButton) {
                e.preventDefault();
                legendButton.focus();
              }
            }}
          />
        );
      })}
      <ElectrodePreview onEnter={keepPreview} onLeave={closePreview} />
    </>
  );
}
const elPos =
  (id: string): PosFn =>
  () => {
    const r = piecePos(id);
    return { ...r, visible: r.w > 1 };
  };

function ElectrodePreview({ onEnter, onLeave }: { onEnter: () => void; onLeave: () => void }) {
  const preview = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState<number[]>([]);
  const data = useStore((s) => s.data);
  const channel = useStore((s) => s.ui.focusChannel);
  const result = useStore((s) => s.results.channels);
  const included = useStore((s) => channel !== null && s.settings.channels.includes(channel));
  const shown = useStore((s) => s.settings.showClasses);
  const offline = useStore((s) => s.offline);
  const selectedWindow = useStore((s) => s.settings.window);
  const status = useStore((s) => s.status.channels);
  const index = data && channel ? data.channels.indexOf(channel) : -1;
  useLayoutEffect(() => {
    const card = preview.current;
    const stage = card?.parentElement;
    if (!card || !stage) return;

    const place = () => {
      const electrode = piecePos(`electrode:${index}`);
      const margin = 8;
      const gap = 12;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const right = electrode.x + electrode.w + gap;
      const left = electrode.x - gap - width;
      const maxX = stage.clientWidth - width - margin;
      const maxY = stage.clientHeight - height - margin;
      let x = right;
      let y = electrode.y + (electrode.h - height) / 2;
      if (right > maxX) {
        x = left;
        if (left < margin) {
          x = electrode.x + (electrode.w - width) / 2;
          y = electrode.y + electrode.h + gap;
          if (y > maxY) y = electrode.y - gap - height;
        }
      }
      card.style.transform = `translate(${Math.max(margin, Math.min(x, maxX))}px, ${Math.max(margin, Math.min(y, maxY))}px)`;
      card.style.visibility = electrode.visible ? 'visible' : 'hidden';
    };
    place();
    const stop = engine.onFrame(place);
    const resize = new ResizeObserver(place);
    resize.observe(stage);
    resize.observe(card);
    return () => {
      stop();
      resize.disconnect();
    };
  }, [index]);
  if (!data || !channel || index < 0) return null;
  const spark = result?.spark;
  const value = result?.map.values?.[index];
  const { t0, len } = epochSpan(data);
  const window = result?.window ?? (offline ? data.preset.defaultWindow : selectedWindow);
  const start = Math.max(t0, window.start);
  const end = Math.min(t0 + len, window.end);
  const traces = data.classNames.flatMap((name, k) => {
    if (!spark || !shown.includes(k)) return [];
    const offset = (index * data.classNames.length + k) * 60;
    const points = spark.subarray(offset, offset + 60);
    return [{ k, name, color: CLASS_HEX[k % CLASS_HEX.length], points }];
  });

  return (
    <section
      ref={preview}
      className="electrode-preview"
      aria-label={`${channel} waveform preview`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onLeave();
      }}
    >
      <strong>{channel}</strong>
      <div className="small">
        {data.regions[index]} · {included ? 'Included' : 'Excluded'}
        {typeof value === 'number' ? ` · ${value.toFixed(2)} ${result?.map.unit ?? ''}` : ''}
      </div>
      <div className="small">{offline ? 'Default sample window' : 'Selected time window'} · Class means</div>
      {status.error ? <p className="small">{status.error}</p> : status.loading || !spark ? (
        <p className="small">Loading waveform…</p>
      ) : traces.length ? (
        <>
          <svg viewBox="0 0 280 100" role="img" aria-label={`${channel} scaled EEG amplitude over time`}>
            <line x1="0" x2="280" y1="50" y2="50" stroke="var(--hairline)" />
            {traces.filter(({ k }) => !hidden.includes(k)).map(({ k, color, points }) => (
              <polyline
                key={k}
                points={Array.from(points, (value, i) => `${(280 * i) / 59},${50 - 94 * value}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth="2"
              />
            ))}
          </svg>
          <div className="electrode-preview-axis small">
            <span>{Number(start.toFixed(3))} s</span>
            <span>{Number(end.toFixed(3))} s</span>
          </div>
          <ul className="electrode-preview-legend small">
            {traces.map(({ k, name, color }) => (
              <li key={k}>
                <button
                  type="button"
                  aria-pressed={!hidden.includes(k)}
                  onClick={() => setHidden((current) =>
                    current.includes(k) ? current.filter((id) => id !== k) : [...current, k],
                  )}
                >
                  <span className="sw" style={{ background: color }} />
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="small">Select a class to show its waveform.</p>}
    </section>
  );
}

function WindowHandles() {
  const has = useStore((s) => !!s.data);
  if (!has) return null;
  const geo = (): ReturnType<typeof p2Geo> => p2Geo(buildCtx());
  const xRange = (): { x0: number; x1: number; y0: number; y1: number } => {
    const g = geo();
    const w = get().settings.window;
    return { x0: g.xOf(w.start), x1: g.xOf(w.end), y0: g.by0, y1: g.by1 };
  };
  const drag = (which: 'start' | 'end' | 'body') => (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const d = get().data!;
    const { t0, len } = epochSpan(d);
    const snap = windowSnap(len);
    const minW = minWindow(len);
    updateUi({ draggingWindow: true });
    const g = p2Geo({ ...buildCtx(), ui: { ...get().ui, draggingWindow: true } });
    const start0 = get().settings.window;
    const x0 = e.clientX;
    const toT = (dx: number): number => (dx / (g.bx1 - g.bx0)) * len;
    const move = (ev: PointerEvent): void => {
      const dt = toT(ev.clientX - x0);
      let { start, end } = start0;
      const q = (v: number): number => Math.round(v / snap) * snap;
      const tEnd = t0 + len;
      if (which === 'start') start = Math.min(q(start0.start + dt), end - minW);
      else if (which === 'end') end = Math.max(q(start0.end + dt), start + minW);
      else {
        const wdt = end - start;
        start = q(Math.max(t0, Math.min(tEnd - wdt, start0.start + dt)));
        end = start + wdt;
      }
      start = Math.max(t0, +start.toFixed(3));
      end = Math.min(tEnd, +end.toFixed(3));
      if (start !== get().settings.window.start || end !== get().settings.window.end)
        updateSettings({ window: { start, end } });
    };
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      updateUi({ draggingWindow: false });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const key = (which: 'start' | 'end' | 'body') => (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const d = get().data!;
    const { t0, len } = epochSpan(d);
    const step = windowSnap(len) * (e.key === 'ArrowLeft' ? -1 : 1);
    let { start, end } = get().settings.window;
    const minW = minWindow(len);
    if (which === 'start') start = Math.min(Math.max(t0, start + step), end - minW);
    else if (which === 'end') end = Math.max(Math.min(t0 + len, end + step), start + minW);
    else if (start + step >= t0 - 1e-9 && end + step <= t0 + len + 1e-9) {
      start += step;
      end += step;
    }
    updateSettings({ window: { start: +start.toFixed(3), end: +end.toFixed(3) } });
  };
  const pos =
    (which: 'start' | 'end' | 'body'): PosFn =>
    () => {
      const r = xRange();
      const cy = (r.y0 + r.y1) / 2;
      if (which === 'body')
        return { x: r.x0 + 8, y: r.y0, w: Math.max(4, r.x1 - r.x0 - 16), h: r.y1 - r.y0, visible: true };
      const x = which === 'start' ? r.x0 : r.x1;
      return { x: x - 7, y: cy - 20, w: 14, h: 40, visible: true };
    };
  const w = get().settings.window;
  return (
    <>
      <OverlayButton
        id="win:body"
        testid="window-body"
        pos={pos('body')}
        label={`Window ${w.start} to ${w.end} s, move`}
        className="ov-body"
        onPointerDown={drag('body')}
        onKeyDown={key('body')}
      />
      <OverlayButton
        id="win:start"
        testid="window-start"
        pos={pos('start')}
        label="Window start handle"
        className="ov-handle"
        onPointerDown={drag('start')}
        onKeyDown={key('start')}
      />
      <OverlayButton
        id="win:end"
        testid="window-end"
        pos={pos('end')}
        label="Window end handle"
        className="ov-handle"
        onPointerDown={drag('end')}
        onKeyDown={key('end')}
      />
    </>
  );
}

function BandHandles() {
  const has = useStore((s) => !!s.data);
  if (!has) return null;
  const setEdge = (which: 'low' | 'high', f: number): void => {
    const s = get();
    const fm = freqMax(s.data!.sfreq);
    const b = { ...s.settings.band };
    const q = Math.round(f * 2) / 2;
    if (which === 'low') b.low = Math.max(1, Math.min(q, b.high - 2));
    else b.high = Math.min(fm, Math.max(q, b.low + 2));
    if (b.low !== s.settings.band.low || b.high !== s.settings.band.high) updateSettings({ band: b });
  };
  const drag = (which: 'low' | 'high') => (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const g = p4Geo(buildCtx());
    const host = hostOffset();
    const move = (ev: PointerEvent): void => {
      const x = ev.clientX - host.x;
      setEdge(which, 1 + ((x - g.x0) / (g.x1 - g.x0)) * (g.fmax - 1));
    };
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const pos =
    (which: 'low' | 'high'): PosFn =>
    () => {
      const c = buildCtx();
      const g = p4Geo(c);
      const f = which === 'low' ? c.settings.band.low : c.settings.band.high;
      return { x: g.fx(f) - 8, y: g.y0 - 16, w: 16, h: g.y1 - g.y0 + 20, visible: true };
    };
  const key = (which: 'low' | 'high') => (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const b = get().settings.band;
    setEdge(which, (which === 'low' ? b.low : b.high) + (e.key === 'ArrowLeft' ? -0.5 : 0.5));
  };
  return (
    <>
      <OverlayButton
        id="band:low"
        testid="band-low"
        pos={pos('low')}
        label="Band low edge"
        className="ov-handle"
        onPointerDown={drag('low')}
        onKeyDown={key('low')}
      />
      <OverlayButton
        id="band:high"
        testid="band-high"
        pos={pos('high')}
        label="Band high edge"
        className="ov-handle"
        onPointerDown={drag('high')}
        onKeyDown={key('high')}
      />
    </>
  );
}

function toggleCard(f: FamilyId): void {
  const cur = get().settings.features;
  const next = cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f];
  updateSettings({ features: next });
  updateUi({ focusFamily: f });
}

/** Screen rect of a card piece. Grid cards are anchored on their 200-wide base area and widen rightwards. */
function cardRect(f: FamilyId): Rect {
  const p = poseOf(`card:${f}`);
  if (!p) return { x: 0, y: 0, w: 0, h: 0, visible: false };
  const sx = Math.abs(p.sx);
  const sy = Math.abs(p.sy);
  const chip = get().settings.features.includes(f);
  const w = p.w * sx;
  const h = p.h * sy;
  const paneLeft = !chip && get().ui.expandFamily === f && p5Geo(buildCtx()).paneLeft;
  const x = chip ? p.x - w / 2 : paneLeft ? p.x + 100 * sx - w : p.x - 100 * sx;
  return { x, y: p.y - h / 2, w, h, visible: p.alpha > 0.05 && w > 1 && h > 1 };
}

// Hover expansion: expand after a short pause; collapse shortly after the cursor leaves card and pane.
let expandTimer: ReturnType<typeof setTimeout> | null = null;
let collapseTimer: ReturnType<typeof setTimeout> | null = null;
function hoverCard(f: FamilyId, on: boolean): void {
  if (on) {
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = null;
    updateUi({ focusFamily: f });
    if (get().settings.features.includes(f)) return; // basket chips do not expand
    if (get().ui.expandFamily === f) return;
    if (expandTimer) clearTimeout(expandTimer);
    expandTimer = setTimeout(() => updateUi({ expandFamily: f }), get().ui.expandFamily ? 120 : 380);
  } else {
    if (expandTimer) clearTimeout(expandTimer);
    expandTimer = null;
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      // keep it open while one of its dropdowns (rendered in a portal) is open
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      if (get().ui.expandFamily) updateUi({ expandFamily: null });
    }, 260);
  }
}

function CardOverlay() {
  const expanded = useStore((s) => s.ui.expandFamily) as FamilyId | null;
  return (
    <>
      {FAMILY_IDS.map((f) => (
        <OverlayButton
          key={f}
          id={`card:${f}`}
          testid={`card-${f}`}
          pos={() => {
            const r = cardRect(f);
            const g = p5Geo(buildCtx());
            const inGrid = r.y + r.h > g.gy0 && r.y < g.gy0 + g.gh;
            const inBasket = r.x > g.basket.x - 10;
            // an expanded card's button covers only its base area; the settings pane covers the rest
            const exp = f === expanded && !get().settings.features.includes(f);
            const w = exp ? Math.min(r.w, 200 * g.s) : r.w;
            const x = exp && g.paneLeft ? r.x + r.w - w : r.x;
            return { ...r, x, w, visible: r.visible && (inGrid || inBasket) };
          }}
          label={`${TITLES[f]}${get().settings.features.includes(f) ? ', in the basket (click to remove)' : ', click to add'}`}
          pressed={get().settings.features.includes(f)}
          onActivate={() => toggleCard(f)}
          onHover={(on) => hoverCard(f, on)}
        />
      ))}
      {expanded ? <CardPaneOverlay f={expanded} /> : null}
    </>
  );
}

/** The expanded card's settings pane: a real DOM area over the widened part of the card. */
function CardPaneOverlay({ f }: { f: FamilyId }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = (): void => {
      const r = cardRect(f);
      const g = p5Geo(buildCtx());
      const x0 = g.paneLeft ? r.x + 8 : r.x + 204 * g.s + 6;
      const w = g.paneLeft ? r.w - 204 * g.s - 14 : r.x + r.w - 8 - x0;
      el.style.transform = `translate(${Math.round(x0)}px, ${Math.round(r.y + 10)}px)`;
      el.style.width = `${Math.max(0, Math.round(w))}px`;
      el.style.height = `${Math.max(0, Math.round(r.h - 20))}px`;
      el.style.opacity = w > 120 * g.s ? '1' : '0';
    };
    write();
    const off = engine.onFrame(write);
    const t = setInterval(write, 200);
    return () => {
      off();
      clearInterval(t);
    };
  }, [f]);
  return (
    <div
      ref={ref}
      className="card-pane"
      data-testid="card-pane"
      onPointerEnter={() => hoverCard(f, true)}
      onPointerLeave={() => hoverCard(f, false)}
    >
      <CardPane f={f} />
    </div>
  );
}

function CardToolbar() {
  const cat = useStore((s) => s.ui.categoryFilter);
  const q = useStore((s) => s.ui.search);
  const total = useStore((s) => s.results.features?.selected.total ?? 0);
  const usingDefault = useStore((s) => s.results.features?.usingDefault ?? true);
  const def = useStore((s) => s.results.features?.defaultFeature ?? '');
  const cats = ['All', 'Time', 'Frequency', 'Time-frequency', 'Spatial', 'Learned'] as const;
  return (
    <div className="card-toolbar" role="toolbar" aria-label="Feature card filters">
      {cats.map((c) => (
        <button
          key={c}
          className={`chipbtn ${c === cat ? 'on' : ''}`}
          aria-pressed={c === cat}
          onClick={() => updateUi({ categoryFilter: c, scrollY: 0 })}
          data-testid={`filter-${c}`}
        >
          {c}
        </button>
      ))}
      <input
        className="search"
        placeholder="Search feature families"
        aria-label="Search feature families"
        value={q}
        onChange={(e) => updateUi({ search: e.target.value, scrollY: 0 })}
        data-testid="card-search"
      />
      <span className="readout" data-testid="feature-total">
        {total} features{usingDefault ? ` (no features chosen: using ${def})` : ''}
      </span>
    </div>
  );
}

function MatrixOverlay() {
  const ev = useStore((s) => s.results.evaluate);
  const view = useStore((s) => s.settings.view);
  const offset = useStore((s) => s.ui.columnOffset);
  const pre = useStore((s) => s.settings.showPreSelection);
  const xf = useStore((s) => s.settings.xFeature);
  const shift = useRef<string | null>(null);
  if (!ev) return null;
  const c = buildCtx();
  const g = p7Geo(c);
  const names = matrixInfo(c).names;
  const cols = view === 'matrix' ? names.slice(g.offset, g.offset + g.visibleCols) : [];
  void offset;
  void pre;
  let tx = g.vx0;
  const tabs = VIEW_TABS.map((t) => {
    const w = t.label.length * 6.2 + 16;
    const r = { x: tx, y: g.vy0, w: w - 6, h: 20 };
    tx += w;
    return { ...t, r };
  });
  const rank = ev.ranking.auc
    .map((v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, 14);
  const bh = Math.min(
    16,
    (c.stageSize.stageHeight - 170 - (132 + RACE_TOP) - 24) / Math.max(1, rank.length) - 3,
  );
  return (
    <>
      {tabs.map((t) => (
        <OverlayButton
          key={t.id}
          id={`tab:${t.id}`}
          testid={`view-${t.id}`}
          pos={() => ({ ...t.r, visible: true })}
          label={`${t.label} view`}
          pressed={view === t.id}
          onActivate={() => updateSettings({ view: t.id as never })}
        />
      ))}
      {cols.map((n, k) => (
        <OverlayButton
          key={n}
          id={`col:${n}`}
          pos={() => ({
            x: g.vx0 + k * g.cellW,
            y: g.my0 - 48,
            w: Math.max(4, g.cellW),
            h: 46,
            visible: true,
          })}
          label={`Column ${n}`}
          pressed={xf === n}
          onActivate={(e) => {
            if ((e as React.MouseEvent).shiftKey) {
              if (shift.current && shift.current !== n) {
                updateSettings({ xFeature: shift.current, yFeature: n, view: 'scatter' });
                shift.current = null;
              } else shift.current = n;
            } else updateSettings({ xFeature: n });
          }}
        />
      ))}
      {rank.map((o, k) => (
        <OverlayButton
          key={`bar${o.i}`}
          id={`bar:${o.i}`}
          pos={() => ({
            x: g.px0,
            y: 132 + RACE_TOP + 20 + k * (bh + 3),
            w: g.px1 - g.px0,
            h: bh,
            visible: true,
          })}
          label={`Feature ${ev.names[o.i]}, separability ${o.v.toFixed(2)}, set as X feature`}
          onActivate={() => updateSettings({ xFeature: ev.names[o.i] })}
        />
      ))}
      {view === 'matrix' && names.length > g.visibleCols ? (
        <div className="col-scroll" style={{ left: g.vx0, top: g.vy1 + 2, width: g.vx1 - g.vx0 }}>
          <input
            type="range"
            min={0}
            max={names.length - g.visibleCols}
            value={g.offset}
            aria-label="Scroll matrix columns"
            onChange={(e) => updateUi({ columnOffset: +e.target.value })}
          />
        </div>
      ) : null}
    </>
  );
}

function RailOverlay() {
  return (
    <>
      {Array.from({ length: 8 }, (_, k) => (
        <OverlayButton
          key={k}
          id={`rail:${k + 1}`}
          testid={`rail-${k + 1}`}
          pos={() => {
            const n = railNodes(buildCtx())[k];
            return { x: n.x - 26, y: n.y - 22, w: 52, h: 46, visible: true };
          }}
          label={`Go to page ${k + 1}`}
          pressed={get().page === k + 1}
          onActivate={() => navigate(k + 1)}
        />
      ))}
    </>
  );
}

function CodePanel() {
  const script = useStore((s) => s.results.export?.script ?? '');
  const reduced = useStore((s) => s.ui.reduceMotion);
  const phase = useStore((s) => s.ui.exportPhase);
  const pre = useRef<HTMLPreElement>(null);
  const [rect, setRect] = useState(() => p8Geo(buildCtx()).panel);
  useEffect(() => {
    setRect(p8Geo(buildCtx()).panel);
    const el = pre.current;
    if (!el) return;
    el.textContent = '';
    if (!script) return;
    let n = 0;
    let raf = 0;
    let last = 0;
    let typing = false;
    const tick = (t: number): void => {
      if (!typing) {
        if (reduced || chipsArrived()) {
          typing = true;
          last = t;
        }
      } else {
        // about 60 characters per second; instant under reduced motion
        // the whole script appears in about 1.2 s (instant under reduced motion)
        n = reduced
          ? script.length
          : Math.min(script.length, n + ((t - last) / 1000) * Math.max(600, script.length / 1.2));
        last = t;
        el.textContent = script.slice(0, Math.floor(n));
        if (n >= script.length) return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [script, reduced, phase]);
  return (
    <pre
      ref={pre}
      className="code"
      data-testid="code"
      style={{
        left: rect.x0 + 12,
        top: rect.y0 + 14,
        width: rect.x1 - rect.x0 - 24,
        height: rect.y1 - rect.y0 - 26,
      }}
    />
  );
}

/** Page 7: shown while the matrix / evaluation is being computed (arrival or a settings change). */
function ComputingBanner() {
  const loading = useStore((s) => s.status.evaluate.loading);
  return (
    <div className={`computing ${loading ? 'on' : ''}`} aria-live="polite" data-testid="computing">
      {loading ? 'COMPUTING...' : ''}
    </div>
  );
}

let hostEl: HTMLDivElement | null = null;
function hostOffset(): { x: number; y: number } {
  const r = hostEl?.getBoundingClientRect();
  return { x: r?.left ?? 0, y: r?.top ?? 0 };
}

// -------------------------------------------------------------------------------------------
export function StageHost() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const marq = useRef<HTMLDivElement>(null);
  const page = useStore((s) => s.page);
  const hasData = useStore((s) => !!s.data);
  const nChannels = useStore((s) => s.data?.channels.length ?? 0);
  const dataVersion = useStore((s) => s.data?.version ?? 0);

  useEffect(() => {
    hostEl = host.current;
    registerTooltip(tip.current);
    void engine.mount(canvas.current!).then(() => set({ limited: !!engine.stage?.limited }));
    // Per-frame overlay writer (positions written directly to the DOM).
    const off = engine.onFrame(() => writeOverlay(overlay.current));
    const raf = setInterval(() => writeOverlay(overlay.current), 250); // also while the ticker is paused
    return () => {
      off();
      clearInterval(raf);
      engine.unmount();
    };
  }, []);

  // Pointer hover (page 1 stack tooltip, page 7 row strip) and marquee selection (page 3).
  const onMove = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('.ov')) return;
    const o = hostOffset();
    const x = e.clientX - o.x;
    const y = e.clientY - o.y;
    const s = get();
    if (s.page === 1 && s.data) {
      const t = stackTrialAt(x, y);
      if (t !== s.ui.hoverTrial) updateUi({ hoverTrial: t });
      if (t !== null) showTip(x, y, `Trial ${t + 1}, ${s.data.classNames[s.data.labels[t]]}`);
      else hideTip();
    } else if (s.page === 7 && s.data) {
      const t = matrixRowAt(x, y);
      if (t !== s.ui.hoverRow) updateUi({ hoverRow: t });
      if (t !== null) showTip(x, y, `Trial ${t + 1}, ${s.data.classNames[s.data.labels[t]]}`);
      else hideTip();
    }
  };
  const onDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('.ov,.electrode-preview,.card-toolbar,.code')) return;
    const s = get();
    if (s.page !== 3 || !s.data) return;
    const o = hostOffset();
    const x0 = e.clientX - o.x;
    const y0 = e.clientY - o.y;
    const g = p3Geo(buildCtx());
    if (Math.hypot(x0 - g.cx, y0 - g.cy) > g.R) return;
    const m = marq.current!;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const mode = e.altKey && !e.shiftKey ? 'remove' : 'add';
    const move = (ev: PointerEvent): void => {
      const x1 = ev.clientX - o.x;
      const y1 = ev.clientY - o.y;
      m.style.display = 'block';
      m.style.left = `${Math.min(x0, x1)}px`;
      m.style.top = `${Math.min(y0, y1)}px`;
      m.style.width = `${Math.abs(x1 - x0)}px`;
      m.style.height = `${Math.abs(y1 - y0)}px`;
    };
    const up = (ev: PointerEvent): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      m.style.display = 'none';
      const x1 = ev.clientX - o.x;
      const y1 = ev.clientY - o.y;
      if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) return;
      const c = buildCtx();
      const d = c.data!;
      const inside = d.channels.filter((_, i) => {
        if (d.positions[i] === null) return false;
        const p = channelXY(g, c, i);
        return (
          p.x >= Math.min(x0, x1) &&
          p.x <= Math.max(x0, x1) &&
          p.y >= Math.min(y0, y1) &&
          p.y <= Math.max(y0, y1)
        );
      });
      if (!inside.length) return;
      const list = selectChannelGroup(d.channels, c.settings.channels, inside, mode);
      if (!list.length) {
        set({
          status: {
            ...get().status,
            channels: { loading: false, error: 'At least one channel must stay selected.' },
          },
        });
        return;
      }
      updateSettings({ channels: list });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const onWheel = (e: React.WheelEvent): void => {
    const s = get();
    if (s.page === 5) {
      const max = maxScroll(buildCtx());
      updateUi({ scrollY: Math.max(0, Math.min(max, s.ui.scrollY + e.deltaY)) });
    }
  };
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.npz')) void loadNpz(f);
    else void loadCsv(f);
  };

  return (
    <div
      className="stage-host"
      ref={host}
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerLeave={() => {
        hideTip();
        if (get().ui.hoverTrial !== null || get().ui.hoverRow !== null)
          updateUi({ hoverTrial: null, hoverRow: null });
      }}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="stage"
    >
      <canvas ref={canvas} className="stage-canvas" data-testid="canvas" />
      <RailNav />
      <PageHeader />
      <ShapeBadge />
      <div className="overlay" ref={overlay} key={`ov${dataVersion}:${nChannels}`}>
        {hasData && page === 2 ? <WindowHandles /> : null}
        {hasData && page === 3 ? <ElectrodeOverlay /> : null}
        {hasData && page === 4 ? <BandHandles /> : null}
        {hasData && page === 5 ? <CardOverlay /> : null}
        {hasData && page === 7 ? <MatrixOverlay /> : null}
        <RailOverlay />
      </div>
      {page === 2 ? <TimeWindowControls /> : null}
      {hasData && page === 4 ? <BandControls /> : null}
      {(page === 3 || page === 4) && !hasData ? <div className="window-empty">Load data on page 1 first.</div> : null}
      {hasData && page === 5 ? <CardToolbar /> : null}
      {hasData && page === 8 ? <CodePanel /> : null}
      {hasData && page === 7 ? <ComputingBanner /> : null}
      <div className="marquee" ref={marq} />
      <div className="tooltip" ref={tip} role="tooltip" />
    </div>
  );
}

function writeOverlay(root: HTMLDivElement | null): void {
  if (!root) return;
  const els = root.querySelectorAll<HTMLElement>('[data-ov]');
  els.forEach((el) => {
    const fn = positions.get(el.dataset.ov!);
    if (!fn) return;
    const r = fn();
    el.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
    el.style.width = `${Math.max(0, Math.round(r.w))}px`;
    el.style.height = `${Math.max(0, Math.round(r.h))}px`;
    el.style.visibility = r.visible ? 'visible' : 'hidden';
  });
}
