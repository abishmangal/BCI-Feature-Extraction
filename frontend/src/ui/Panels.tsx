// Right-hand controls panel (320 px, collapsible; a bottom drawer below 1280 px). One panel per page.
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  get,
  selectChannelGroup,
  set,
  updateSettings,
  updateUi,
  useStore,
  defaultSettings,
  type FamilyId,
  type Settings,
} from '../store/store';
import {
  cancelAutoencoder,
  changeMontage,
  interpretAs,
  loadCsv,
  loadNpz,
  loadSample,
  trainAutoencoder,
} from '../store/effects';
import { api } from '../api/client';
import { decodeF32 } from '../api/f32';
import { Field, Info, Msg, MultiToggle, NumberInput, Select, Switch, Toggle } from './controls';
import { CLASS_HEX } from '../engine/colors';
import { engine } from '../engine/wiring';
import { formatFeatureUnit, TITLES } from '../layouts/page5';
import { Basket } from './Basket';
import { FeatureEquations, FisherEquation, SignedLogEquation } from './Equations';
import { Scalar } from '../engine/scalar';
import { NAMED, p4Geo } from '../layouts/page4';
import { epochSpan, freqMax } from '../layouts/common';

const NONE: never[] = [];
const PROBE_CHART = engine.core.reg.index.get('decor:2:minimap')!;
const NO_SETTINGS: Record<string, unknown> = {};
const DEFAULT_MONTAGES = ['standard_1005'];

const SAMPLES = [
  { value: 'motor_imagery', label: 'Motor imagery' },
  { value: 'erp_p300', label: 'P300 (ERP)' },
  { value: 'ssvep', label: 'SSVEP' },
];
const SAMPLE_FILE: Record<string, string> = {
  motor_imagery: 'example_motor_imagery.csv',
  erp_p300: 'example_erp.csv',
  ssvep: 'example_ssvep.csv',
};

function Section({ title, children, ref }: { title: string; children: ReactNode; ref?: Ref<HTMLElement> }) {
  return (
    <section className="psec" ref={ref}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Status({
  ep,
}: {
  ep: 'dataset' | 'window' | 'channels' | 'band' | 'features' | 'transform' | 'evaluate' | 'export' | 'ae';
}) {
  const st = useStore((s) => s.status[ep]);
  if (st.error) return <Msg kind="error">{st.error}</Msg>;
  if (st.loading)
    return (
      <p className="side-computing" role="status" data-testid={`computing-${ep}`}>
        COMPUTING...
      </p>
    );
  return null;
}

function ClassChips() {
  const names = useStore((s) => s.data?.classNames ?? NONE);
  const show = useStore((s) => s.settings.showClasses);
  return (
    <Field label="Show classes">
      <MultiToggle
        label="Show classes"
        values={show.map(String)}
        options={names.map((n, k) => ({ value: String(k), label: n, color: CLASS_HEX[k % 6] }))}
        onChange={(v) => v.length && updateSettings({ showClasses: v.map(Number).sort() })}
      />
    </Field>
  );
}

// ------------------------------------------------------------------------------------- page 1
export const LoadControls = memo(function LoadControls() {
  const form = useStore((s) => s.csvForm);
  const sample = useStore((s) => s.sampleChoice);
  const montages = useStore((s) => s.paradigms?.montages ?? DEFAULT_MONTAGES);
  const offline = useStore((s) => s.offline);
  const fileRef = useRef<HTMLInputElement>(null);
  const npzRef = useRef<HTMLInputElement>(null);
  const setForm = (p: Partial<typeof form>): void => set({ csvForm: { ...get().csvForm, ...p } });
  return (
    <div className="workspace-tools load-tools">
      <Section title="Upload EEG data">
        <div
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (offline) return;
            const file = e.dataTransfer.files[0];
            if (file?.name.toLowerCase().endsWith('.npz')) void loadNpz(file);
            else if (file) void loadCsv(file);
          }}
        >
          <p>Drop a CSV or upstream NPZ file here</p>
          <div className="row">
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={offline}>
              Choose CSV file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              data-testid="csv-input"
              onChange={(e) => e.target.files?.[0] && void loadCsv(e.target.files[0])}
            />
            <button className="btn" onClick={() => npzRef.current?.click()} disabled={offline}>
              Load upstream NPZ
            </button>
            <input
              ref={npzRef}
              type="file"
              accept=".npz"
              hidden
              data-testid="npz-input"
              onChange={(e) => e.target.files?.[0] && void loadNpz(e.target.files[0])}
            />
          </div>
        </div>
        <Field label="Sample">
          <Select
            label="Sample"
            value={sample}
            options={SAMPLES}
            onChange={(v) => set({ sampleChoice: v })}
          />
        </Field>
        <div className="row">
          <button className="btn primary" data-testid="pour" onClick={() => void loadSample(sample)}>
            Pour sample data
          </button>
          <a className="btn ghost" href={`${import.meta.env.BASE_URL}sample/${SAMPLE_FILE[sample]}`} download>
            Download example CSV
          </a>
        </div>
        <Status ep="dataset" />
      </Section>
      <Section title="CSV settings">
        <div className="csv-settings">
          <Field label="Sampling rate (Hz)">
            <input
              className="num"
              value={form.sfreq}
              onChange={(e) => setForm({ sfreq: e.target.value })}
              aria-label="Sampling rate"
            />
          </Field>
          <Field label="Epoch start, tmin (s)">
            <input
              className="num"
              value={form.tmin}
              onChange={(e) => setForm({ tmin: e.target.value })}
              aria-label="tmin"
            />
          </Field>
          <Field label="Baseline start (s)">
            <input
              className="num"
              value={form.b0}
              onChange={(e) => setForm({ b0: e.target.value })}
              aria-label="Baseline start"
              placeholder="none"
            />
          </Field>
          <Field label="Baseline end (s)">
            <input
              className="num"
              value={form.b1}
              onChange={(e) => setForm({ b1: e.target.value })}
              aria-label="Baseline end"
              placeholder="none"
            />
          </Field>
          <Field label="Montage">
            <Select
              label="Montage"
              value={form.montage}
              options={montages.map((m) => ({ value: m, label: m }))}
              onChange={(m) => void changeMontage(m)}
            />
          </Field>
          <Field label="Interpret as">
            <Select
              label="Interpret as"
              value={form.interpret}
              options={[
                { value: 'custom', label: 'Custom' },
                { value: 'motor_imagery', label: 'Motor imagery' },
                { value: 'erp_p300', label: 'P300 / ERP' },
                { value: 'ssvep', label: 'SSVEP' },
              ]}
              onChange={(v) => void interpretAs(v)}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
});

export const DatasetCards = memo(function DatasetCards() {
  const data = useStore((s) => s.data);
  if (!data) return null;
  const prov = data.provenance;
  return (
    <div className="workspace-tools dataset-cards">
      <Section title="Dataset">
        <dl className="kv dataset-summary" data-testid="summary">
          <dt>trials</dt>
          <dd>{data.shape[0]}</dd>
          <dt>channels</dt>
          <dd>{data.shape[1]}</dd>
          <dt>sfreq</dt>
          <dd>{data.sfreq} Hz</dd>
          <dt>epoch</dt>
          <dd>{epochSpan(data).len.toFixed(3)} s</dd>
          <dt>tmin</dt>
          <dd>{data.tmin} s</dd>
          <dt>baseline</dt>
          <dd>{data.baseline ? `${data.baseline.start} to ${data.baseline.end} s` : 'none'}</dd>
        </dl>
        <ul className="classes">
          {data.classNames.map((n, k) => (
            <li key={n}>
              <span className="sw" style={{ background: CLASS_HEX[k % 6] }} />
              {n} <span className="mono">({data.classCounts[k]})</span>
            </li>
          ))}
        </ul>
        {data.preset.facts ? (
          <Info text={data.preset.facts}>
            <button className="btn ghost small">About this paradigm (i)</button>
          </Info>
        ) : null}
        {data.warnings.map((w) => (
          <Msg key={w} kind="warn">
            {w}
          </Msg>
        ))}
      </Section>
      <Section title="Input provenance">
        <dl className="kv">
          <dt>source</dt>
          <dd>{prov?.source}</dd>
          <dt>units</dt>
          <dd>{prov?.units ?? 'uV'}</dd>
          <dt>artifact steps</dt>
          <dd>{prov?.artifact_steps?.length ? JSON.stringify(prov.artifact_steps) : 'none'}</dd>
        </dl>
      </Section>
    </div>
  );
});

// ------------------------------------------------------------------------------------- page 2
function ProbeEditor({ axis }: { axis: 'x' | 'y' }) {
  const probe = useStore((s) => s.settings.probe[axis]);
  const chans = useStore((s) => s.data?.channels ?? NONE);
  const setP = (p: Partial<typeof probe>): void => {
    const cur = get().settings.probe;
    updateSettings({ probe: { ...cur, [axis]: { ...cur[axis], ...p } } });
  };
  return (
    <fieldset className={`probe-card probe-${axis}`}>
      <legend>{axis === 'x' ? 'X axis feature (horizontal)' : 'Y axis feature (vertical)'}</legend>
      <div className="row">
        <Field label="Channel">
          <Select
            label={`Probe ${axis} channel`}
            value={probe.channel}
            options={chans.map((c) => ({ value: c, label: c }))}
            onChange={(v) => setP({ channel: v })}
          />
        </Field>
        <Field label="Measure">
          <Select
            label={`Probe ${axis} type`}
            value={probe.type}
            options={[
              { value: 'log_band_power', label: 'log band power' },
              { value: 'mean_amplitude', label: 'mean amplitude' },
            ]}
            onChange={(v) => setP({ type: v as never })}
          />
        </Field>
      </div>
      {probe.type === 'log_band_power' ? (
        <div className="row">
          <Field label="Band low (Hz)">
            <NumberInput
              label={`Probe ${axis} band low (Hz)`}
              value={probe.band?.[0] ?? get().settings.band.low}
              onCommit={(v) =>
                setP({ band: [v, probe.band?.[1] ?? get().settings.band.high], followBand: false })
              }
            />
          </Field>
          <Field label="Band high (Hz)">
            <NumberInput
              label={`Probe ${axis} band high (Hz)`}
              value={probe.band?.[1] ?? get().settings.band.high}
              onCommit={(v) =>
                setP({ band: [probe.band?.[0] ?? get().settings.band.low, v], followBand: false })
              }
            />
          </Field>
        </div>
      ) : (
        <p className="small">Mean amplitude over the window (uV); no band needed.</p>
      )}
    </fieldset>
  );
}

export const TimeWindowControls = memo(function TimeWindowControls() {
  const w = useStore((s) => s.settings.window);
  const data = useStore((s) => s.data);
  const classes = useStore((s) => s.settings.probeClasses);
  const offline = useStore((s) => s.offline);
  const reduced = useStore((s) => s.ui.reduceMotion);
  const sep = useStore((s) => s.results.window?.separability);
  const [probeReady, setProbeReady] = useState(false);
  const hasData = !!data;
  const probeVisible = hasData && (reduced || probeReady);
  const probePanel = usePanelFade<HTMLElement>(probeVisible, 0.8);
  useEffect(() => {
    if (!hasData || reduced || probeReady) return;
    const stop = engine.onFrame(() => {
      if (!engine.core.isVisible(PROBE_CHART)) return;
      stop();
      setProbeReady(true);
    });
    engine.wake();
    return stop;
  }, [hasData, probeReady, reduced]);
  if (!data) return <div className="window-empty"><Msg>Load data on page 1 first.</Msg></div>;
  const { t0, len } = epochSpan(data);
  const presets = data.preset.windowPresets.map((p) => (p.full ? { ...p, start: t0, end: t0 + len } : p));
  if (data.baseline && !presets.some((p) => p.label.startsWith('Baseline')))
    presets.push({ label: 'Baseline only (control)', start: data.baseline.start, end: data.baseline.end });
  const setW = (start: number, end: number): void =>
    updateSettings({ window: { start: Math.max(t0, start), end: Math.min(t0 + len, end) } });
  return (
    <div className="window-workspace" data-probe-ready={probeVisible}>
      <Section title="Time window settings">
        <div className="row">
          <Field label="start (s)">
            <NumberInput label="Window start" value={w.start} step={0.05} onCommit={(v) => setW(v, w.end)} />
          </Field>
          <Field label="end (s)">
            <NumberInput label="Window end" value={w.end} step={0.05} onCommit={(v) => setW(w.start, v)} />
          </Field>
        </div>
        <div className="presets">
          {presets.map((p) => (
            <button key={p.label} className="chipbtn" onClick={() => setW(p.start!, p.end!)}>
              {p.label}
            </button>
          ))}
        </div>
        <button
          className="btn ghost"
          onClick={() => updateSettings({ window: { ...data.preset.defaultWindow } })}
        >
          Reset window
        </button>
        {sep ? (
          <p className="readout" data-testid="separability">
            Class separability {(sep.accuracy * 100).toFixed(1)}% (chance {(sep.chance * 100).toFixed(0)}%),{' '}
            {sep.folds}-fold LDA
            {sep.foldMessage ? <span className="small"> {sep.foldMessage}</span> : null}
          </p>
        ) : null}
      </Section>
      <Section title="Probe settings" ref={probePanel}>
        <div className="probe-blocks">
          <div className="probe-comparison">
            <fieldset className="probe-classes">
              <legend>Classes to compare</legend>
              <div className="row">
                {data.classNames.map((name, k) => {
                  const checked = classes.includes(k);
                  return (
                    <button
                      type="button"
                      key={k}
                      className={`chipbtn probe-class ${checked ? 'on' : ''}`}
                      aria-pressed={checked}
                      disabled={offline || (checked && classes.length <= 2)}
                      onClick={() => updateSettings({
                        probeClasses: checked ? classes.filter((c) => c !== k) : [...classes, k].sort((a, b) => a - b),
                      })}
                    >
                      <span className="sw" style={{ background: CLASS_HEX[k % CLASS_HEX.length] }} />
                      {name}
                    </button>
                  );
                })}
              </div>
              <div className="field-hint">
                {offline ? 'Class comparison requires the backend.' : 'Keep at least two classes selected.'}
              </div>
            </fieldset>
            <Status ep="window" />
          </div>
          <ProbeEditor axis="x" />
          <ProbeEditor axis="y" />
        </div>
      </Section>
    </div>
  );
});

// ------------------------------------------------------------------------------------- page 3
export const ChannelsControls = memo(function ChannelsControls() {
  const data = useStore((s) => s.data);
  const chans = useStore((s) => s.settings.channels);
  const map = useStore((s) => s.settings.map);
  const err = useStore((s) => s.results.channels?.map.error ?? null);
  const focus = useStore((s) => s.ui.focusChannel);
  if (!data) return null;
  const cur = new Set(chans);
  const selected = (list: string[]): boolean => list.length > 0 && list.every((c) => cur.has(c));
  const apply = (id: string, list: string[], e: React.MouseEvent): void => {
    const action = e.shiftKey ? 'add' : e.altKey ? 'remove' : id === 'all' ? 'add' : 'toggle';
    const next = id === 'clear' ? [] : selectChannelGroup(data.channels, get().settings.channels, list, action);
    if (!next.length) {
      set({
        status: {
          ...get().status,
          channels: { loading: false, error: 'At least one channel must stay selected.' },
        },
      });
      updateSettings({ channels: [] });
      return;
    }
    updateSettings({ channels: next });
  };
  const rows: { key: string; title: string }[] = [
    { key: 'basic', title: 'Basic' },
    { key: 'paradigm', title: `For ${data.preset.name}` },
    { key: 'generic', title: 'Generic sets' },
    { key: 'computed', title: 'Computed sets' },
    { key: 'region', title: 'Regions' },
  ];
  const metricOpts = [
    { value: 'bandpower_change', label: 'Band-power change vs baseline (%)', disabled: !data.baseline },
    { value: 'separability_bandpower', label: 'Class separability of band power' },
    { value: 'separability_amplitude', label: 'Class separability of mean amplitude' },
    { value: 'snr', label: 'Spectral SNR at a frequency (dB)' },
  ].filter((o) => !o.disabled);
  const forDisabled = map.metric === 'separability_bandpower' || map.metric === 'separability_amplitude';
  const setMap = (p: Partial<typeof map>): void => updateSettings({ map: { ...get().settings.map, ...p } });
  const lay = data.layout;
  return (
    <>
      <aside className="workspace-tools channel-tools-right" aria-label="Electrode selection">
        <Section title="Selection">
          <p className="readout" data-testid="counter">
            {chans.length} of {data.channels.length} channels selected
          </p>
          <p className="mono small" data-testid="layout-tag">
            {lay.label}
            {lay.n_in_tray ? `, ${lay.n_on_head} on head, ${lay.n_in_tray} in tray` : ''}
          </p>
          {chans.length === 0 ? (
            <Msg kind="error">At least one channel must stay selected. Downstream pages are blocked.</Msg>
          ) : null}
          {focus ? <p className="small">Focused electrode {focus}</p> : null}
        </Section>
        <Section title="Electrode presets">
          <div role="group" aria-label="Electrode presets">
            {rows.map((r) => {
              const items = data.electrodePresets.filter((p) => p.row === r.key);
              if (!items.length) return null;
              return (
                <div key={r.key} className="preset-row">
                  <span className="small">{r.title}</span>
                  <div className="presets">
                    {items.map((p) => (
                      <button
                        key={p.id}
                        data-testid={`preset-${p.id}`}
                        className={`chipbtn ${selected(p.channels) ? 'on' : ''}`}
                        aria-pressed={p.id === 'clear' ? undefined : selected(p.channels)}
                        title={`${p.channels.join(', ')} (${p.present} sites)`}
                        onClick={(e) => apply(p.id, p.channels, e)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="small">Click a group to add its electrodes. Click a highlighted group to remove them, or use Clear to start over.</p>
          </div>
        </Section>
      </aside>
      <aside className="workspace-tools channel-tools-left" aria-label="Map and waveform controls">
        <Section title="Effect map">
          <Switch checked={map.visible} onChange={(v) => setMap({ visible: v })} label="Show effect map" />
          <Field label={`Opacity ${map.opacity}`}>
            <input
              type="range"
              min={0}
              max={100}
              value={map.opacity}
              onChange={(e) => setMap({ opacity: +e.target.value })}
              aria-label="Effect map opacity"
            />
          </Field>
          <Field label="Map metric">
            <Select
              label="Map metric"
              value={map.metric}
              options={metricOpts}
              onChange={(v) => setMap({ metric: v as never })}
            />
          </Field>
          {map.metric === 'bandpower_change' || map.metric === 'separability_bandpower' ? (
            <div className="row">
              <Field label="band low">
                <NumberInput
                  label="Map band low"
                  value={map.band?.[0] ?? get().settings.band.low}
                  onCommit={(v) => setMap({ band: [v, map.band?.[1] ?? get().settings.band.high] })}
                />
              </Field>
              <Field label="band high">
                <NumberInput
                  label="Map band high"
                  value={map.band?.[1] ?? get().settings.band.high}
                  onCommit={(v) => setMap({ band: [map.band?.[0] ?? get().settings.band.low, v] })}
                />
              </Field>
            </div>
          ) : null}
          {map.metric === 'snr' ? (
            <Field label="Target frequency (Hz, empty = class stimulus frequency)">
              <input
                className="num"
                defaultValue={map.frequency ?? ''}
                aria-label="Target frequency"
                onBlur={(e) => setMap({ frequency: e.target.value ? +e.target.value : null })}
              />
            </Field>
          ) : null}
          <Field
            label="Map for"
            hint={
              forDisabled
                ? 'Separability compares all classes at once, so "Map for" does not apply.'
                : undefined
            }
          >
            <Select
              label="Map for"
              disabled={forDisabled}
              value={String(map.mapClass)}
              options={[
                ...data.classNames.map((n, k) => ({ value: String(k), label: n })),
                { value: 'diff', label: 'Difference (A minus B)' },
              ]}
              onChange={(v) => setMap({ mapClass: v === 'diff' ? 'diff' : +v })}
            />
          </Field>
          {map.mapClass === 'diff' && !forDisabled ? (
            <div className="row">
              <Select
                label="Class A"
                value={String(map.pair.a)}
                options={data.classNames.map((n, k) => ({ value: String(k), label: `A: ${n}` }))}
                onChange={(v) => setMap({ pair: { ...map.pair, a: +v } })}
              />
              <Select
                label="Class B"
                value={String(map.pair.b)}
                options={data.classNames.map((n, k) => ({ value: String(k), label: `B: ${n}` }))}
                onChange={(v) => setMap({ pair: { ...map.pair, b: +v } })}
              />
            </div>
          ) : null}
          {err ? <Msg kind="warn">{err}</Msg> : null}
          <Status ep="channels" />
        </Section>
        <Section title="Sparklines">
          <ClassChips />
          {chans.length > 16 ? (
            <p className="small">
              More than 16 electrodes are included: the sparkline is shown for the hovered or focused electrode.
            </p>
          ) : null}
        </Section>
      </aside>
    </>
  );
});

// ------------------------------------------------------------------------------------- page 4
export const BandControls = memo(function BandControls() {
  const data = useStore((s) => s.data);
  const band = useStore((s) => s.settings.band);
  const s = useStore((st) => st.settings);
  const res = useStore((st) => st.results.band);
  const deck = useRef<HTMLDivElement>(null);
  const spectrum = useRef<HTMLElement>(null);
  const example = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = deck.current;
    const upper = spectrum.current;
    const lower = example.current;
    if (!el || !upper || !lower) return;
    const align = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const { controlRects } = p4Geo({ data, stageSize: { width, height, stageHeight: height } });
      for (const [panel, rect] of [[upper, controlRects.spectrum], [lower, controlRects.example]] as const) {
        Object.assign(panel.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: rect.height === undefined ? '' : `${rect.height}px`,
        });
      }
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(el);
    return () => observer.disconnect();
  }, [data]);
  if (!data) return null;
  const fm = freqMax(data.sfreq);
  const setB = (p: Partial<typeof band>): void => {
    const b = { ...get().settings.band, ...p };
    b.low = Math.max(1, Math.round(b.low * 2) / 2);
    b.high = Math.min(fm, Math.round(b.high * 2) / 2);
    if (b.high - b.low < 2) return;
    updateSettings({ band: b });
  };
  const extra = [
    { label: 'Broad 1-40', low: 1, high: 40 },
    { label: 'Wide 4-40', low: 4, high: 40 },
    { label: 'Delta/theta 1-7', low: 1, high: 7 },
  ];
  const all = [...data.preset.bandPresets];
  for (const e of extra) if (!all.some((p) => p.low === e.low && p.high === e.high)) all.push(e);
  return (
    <div className="band-control-deck" ref={deck}>
      <aside className="workspace-tools band-tools-upper" ref={spectrum} aria-label="Spectrum controls">
        <Section title="Band-pass">
          <div className="row">
            <Field label="low (Hz)">
              <NumberInput label="Band low" value={band.low} step={0.5} onCommit={(v) => setB({ low: v })} />
            </Field>
            <Field label="high (Hz)">
              <NumberInput label="Band high" value={band.high} step={0.5} onCommit={(v) => setB({ high: v })} />
            </Field>
            <Field label="order">
              <Select
                label="Filter order"
                value={String(band.order)}
                options={[2, 3, 4, 5, 6, 7, 8].map((o) => ({ value: String(o), label: String(o) }))}
                onChange={(v) => setB({ order: +v })}
              />
            </Field>
          </div>
          <p className="small">
            zero-phase Butterworth{data.upstream ? ' - feature-specific filter (additional to upstream)' : ''}
          </p>
          <div className="presets">
            {all.map((p) => (
              <button
                key={p.label}
                className="chipbtn"
                onClick={() => setB({ low: p.low, high: Math.min(fm, p.high) })}
              >
                {p.label}
              </button>
            ))}
          </div>
          {res?.warnings.map((w) => (
            <Msg key={w} kind="warn">
              {w}
            </Msg>
          ))}
          {res ? (
            <p className="small">
              Welch nperseg {res.welch.nperseg}, 50% overlap, nfft {res.welch.nfft}; resolution limited by
              window length ({res.resolutionHz.toFixed(2)} Hz)
            </p>
          ) : null}
        </Section>
        <Section title="Display">
          <ClassChips />
          {data.baseline ? (
            <Switch
              checked={s.baselineVisible}
              onChange={(v) => updateSettings({ baselineVisible: v })}
              label="Show baseline"
            />
          ) : null}
          <Switch
            checked={s.showAllBands}
            onChange={(v) => updateSettings({ showAllBands: v })}
            label="Show all named bands"
          />
          <p className="small">{NAMED.map((b) => `${b.name} ${b.low}-${b.high}`).join(', ')}</p>
        </Section>
      </aside>
      <aside className="workspace-tools band-tools-example" ref={example} aria-label="Example waveform selection">
        <Section title="Example waveform">
          <div className="band-example-fields">
            <Field label="Trial">
              <NumberInput
                label="Example trial"
                value={s.exampleTrial + 1}
                min={1}
                max={data.shape[0]}
                onCommit={(v) =>
                  updateSettings({ exampleTrial: Math.max(0, Math.min(data.shape[0] - 1, Math.round(v) - 1)) })
                }
              />
            </Field>
            <Field label="Channel">
              <Select
                label="Example channel"
                value={
                  s.exampleChannel && s.channels.includes(s.exampleChannel)
                    ? s.exampleChannel
                    : (s.channels[0] ?? '')
                }
                options={s.channels.map((c) => ({ value: c, label: c }))}
                onChange={(v) => updateSettings({ exampleChannel: v })}
              />
            </Field>
          </div>
          <Status ep="band" />
        </Section>
      </aside>
    </div>
  );
});

// ------------------------------------------------------------------------------------- page 5
function FamilySettings({ f }: { f: FamilyId }) {
  const fs = useStore((s) => s.settings.featureSettings[f] ?? NO_SETTINGS);
  const data = useStore((s) => s.data)!;
  const chans = useStore((s) => s.settings.channels);
  const setF = (p: Record<string, unknown>): void => {
    const all = get().settings.featureSettings;
    updateSettings({ featureSettings: { ...all, [f]: { ...(all[f] ?? {}), ...p } } });
  };
  const ae = useStore((s) => s.results.ae);
  const bandsList = (key: string, defaults: string[]) => {
    const cur = (fs[key] as (string | { name: string; low: number; high: number })[] | undefined) ?? defaults;
    const names = cur.map((b) => (typeof b === 'string' ? b : b.name));
    const opts = [...NAMED.map((b) => b.name), ...data.preset.keyBands.map((b) => b.name)].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    return (
      <Field label="Bands">
        <MultiToggle
          label="Bands"
          values={names.filter((n) => opts.includes(n))}
          options={opts.map((o) => ({ value: o, label: o }))}
          onChange={(v) =>
            setF({
              [key]: v.map(
                (n) => NAMED.find((b) => b.name === n) ?? data.preset.keyBands.find((b) => b.name === n),
              ),
            })
          }
        />
        <CustomBand
          onAdd={(b) =>
            setF({
              [key]: [...cur.map((x) => (typeof x === 'string' ? NAMED.find((n) => n.name === x)! : x)), b],
            })
          }
        />
      </Field>
    );
  };
  switch (f) {
    case 'band_power':
      return bandsList(
        'bands',
        data.preset.defaultFeature.family === 'band_power' &&
          Array.isArray(data.preset.defaultFeature.settings.bands)
          ? (data.preset.defaultFeature.settings.bands as { name: string }[]).map((b) => b.name)
          : ['theta', 'alpha', 'beta'],
      );
    case 'csp':
      return (
        <>
          <Field label="Components">
            <Select
              label="CSP components"
              value={String(fs.n_components ?? 4)}
              options={[2, 4, 6, 8].map((v) => ({ value: String(v), label: String(v) }))}
              onChange={(v) => setF({ n_components: +v })}
            />
          </Field>
          <Switch
            checked={!!fs.shrinkage}
            onChange={(v) => setF({ shrinkage: v })}
            label='Regularisation (shrinkage "ledoit_wolf")'
          />
          <p className="small">
            log-variance output;{' '}
            {data.classNames.length > 2
              ? 'one-vs-rest CSP for more than two classes'
              : 'uses the m/2 first and m/2 last filters'}
          </p>
        </>
      );
    case 'wavelet':
      return (
        <>
          <Field label="Wavelet">
            <Select
              label="Wavelet"
              value="morlet"
              options={[{ value: 'morlet', label: 'morlet (complex Morlet, cmor)' }]}
              onChange={() => undefined}
            />
          </Field>
          <Field label="Frequencies">
            <NumberInput
              label="Number of frequencies"
              value={(fs.n_freqs as number) ?? 8}
              min={2}
              max={32}
              onCommit={(v) => setF({ n_freqs: Math.round(v) })}
            />
          </Field>
          <div className="row">
            <NumberInput
              label="Wavelet range low"
              value={((fs.range as number[]) ?? data.preset.waveletRange)[0]}
              onCommit={(v) => setF({ range: [v, ((fs.range as number[]) ?? data.preset.waveletRange)[1]] })}
            />
            <NumberInput
              label="Wavelet range high"
              value={((fs.range as number[]) ?? data.preset.waveletRange)[1]}
              onCommit={(v) => setF({ range: [((fs.range as number[]) ?? data.preset.waveletRange)[0], v] })}
            />
          </div>
        </>
      );
    case 'covariance':
      return (
        <>
          <Field label="Estimator">
            <Select
              label="Covariance estimator"
              value={(fs.estimator as string) ?? 'oas'}
              options={[
                { value: 'oas', label: 'OAS' },
                { value: 'scm', label: 'scm' },
              ]}
              onChange={(v) => setF({ estimator: v })}
            />
          </Field>
          <Switch
            checked={(fs.tangent as boolean) ?? true}
            onChange={(v) => setF({ tangent: v })}
            label="Tangent-space projection"
          />
        </>
      );
    case 'time_stats': {
      const all = ['mean', 'variance', 'std', 'rms', 'ptp', 'skewness', 'kurtosis', 'line_length', 'higuchi'];
      return (
        <>
          <MultiToggle
            label="Statistics"
            values={(fs.stats as string[]) ?? ['mean', 'variance', 'rms', 'ptp']}
            options={all.map((a) => ({ value: a, label: a }))}
            onChange={(v) => v.length && setF({ stats: v })}
          />
          <Field label="Higuchi kmax">
            <NumberInput
              label="kmax"
              value={(fs.kmax as number) ?? 8}
              min={2}
              onCommit={(v) => setF({ kmax: Math.round(v) })}
            />
          </Field>
          <Playground />
        </>
      );
    }
    case 'window_means':
      return (
        <>
          <Field label="Bin width (ms)">
            <NumberInput
              label="Bin width"
              value={(fs.binMs as number) ?? 50}
              min={4}
              onCommit={(v) => setF({ binMs: v })}
            />
          </Field>
          <Switch
            checked={(fs.baseline as boolean) ?? data.paradigm === 'erp_p300'}
            disabled={!data.baseline}
            onChange={(v) => setF({ baseline: v })}
            label={
              data.baseline ? 'Baseline correction' : 'Baseline correction (no baseline in this dataset)'
            }
          />
        </>
      );
    case 'spectral_features': {
      const items = ['abs_power', 'rel_power', 'peak_freq', 'entropy', 'centroid', 'ratios'];
      return (
        <>
          <MultiToggle
            label="Descriptors"
            values={(fs.items as string[]) ?? ['rel_power']}
            options={items.map((a) => ({ value: a, label: a.replace('_', ' ') }))}
            onChange={(v) => v.length && setF({ items: v })}
          />
          {bandsList(
            'bands',
            data.preset.keyBands.length ? data.preset.keyBands.map((b) => b.name) : ['alpha', 'beta'],
          )}
          <Field label="Ratio (numerator / denominator)">
            <RatioPicker
              onAdd={(r) =>
                setF({
                  ratios: [...((fs.ratios as string[][]) ?? []), r],
                  items: Array.from(new Set([...((fs.items as string[]) ?? ['rel_power']), 'ratios'])),
                })
              }
            />
          </Field>
        </>
      );
    }
    case 'tf_regions': {
      const outs = [
        'mean_power',
        'max_power',
        'energy',
        'coef_mean',
        'coef_var',
        'coef_energy',
        'pct_change',
      ];
      return (
        <>
          <MultiToggle
            label="Outputs"
            values={
              (fs.outputs as string[]) ?? (data.baseline ? ['mean_power', 'pct_change'] : ['mean_power'])
            }
            options={outs
              .filter((o) => o !== 'pct_change' || data.baseline)
              .map((o) => ({ value: o, label: o.replace('_', ' ') }))}
            onChange={(v) => v.length && setF({ outputs: v })}
          />
          {!data.baseline ? (
            <p className="small">Percent change is disabled: this dataset has no baseline.</p>
          ) : null}
          <Field label="Source">
            <Select
              label="TF source"
              value={(fs.source as string) ?? 'cwt'}
              options={[
                { value: 'cwt', label: 'pywt.cwt (Morlet)' },
                { value: 'stft', label: 'scipy STFT' },
              ]}
              onChange={(v) => setF({ source: v })}
            />
          </Field>
          <div className="row">
            <NumberInput
              label="Task start (s)"
              value={
                ((fs.task as number[]) ?? [data.preset.zone?.start ?? get().settings.window.start, 0])[0]
              }
              onCommit={(v) =>
                setF({
                  task: [
                    v,
                    ((fs.task as number[]) ?? [0, data.preset.zone?.end ?? get().settings.window.end])[1],
                  ],
                })
              }
            />
            <NumberInput
              label="Task end (s)"
              value={((fs.task as number[]) ?? [0, data.preset.zone?.end ?? get().settings.window.end])[1]}
              onCommit={(v) =>
                setF({
                  task: [
                    ((fs.task as number[]) ?? [data.preset.zone?.start ?? get().settings.window.start, 0])[0],
                    v,
                  ],
                })
              }
            />
          </div>
          <div className="row">
            <NumberInput
              label="Freq low (Hz)"
              value={
                ((fs.freqs as number[]) ?? [data.preset.keyBands[0]?.low ?? get().settings.band.low, 0])[0]
              }
              onCommit={(v) =>
                setF({
                  freqs: [
                    v,
                    ((fs.freqs as number[]) ?? [
                      0,
                      data.preset.keyBands[0]?.high ?? get().settings.band.high,
                    ])[1],
                  ],
                })
              }
            />
            <NumberInput
              label="Freq high (Hz)"
              value={
                ((fs.freqs as number[]) ?? [0, data.preset.keyBands[0]?.high ?? get().settings.band.high])[1]
              }
              onCommit={(v) =>
                setF({
                  freqs: [
                    ((fs.freqs as number[]) ?? [
                      data.preset.keyBands[0]?.low ?? get().settings.band.low,
                      0,
                    ])[0],
                    v,
                  ],
                })
              }
            />
          </div>
        </>
      );
    }
    case 'asymmetry':
      return (
        <>
          <p className="small">
            Detected pairs: {data.pairs.map((p) => `${p.left}/${p.right}`).join(', ') || 'none'}
          </p>
          <Field label="Pair">
            <Select
              label="Asymmetry pair"
              value={
                ((fs.pairs as { left: string; right: string }[]) ??
                  (data.pairs[0] ? [data.pairs[0]] : [{ left: '', right: '' }]))[0].left
              }
              options={data.pairs.map((p) => ({ value: p.left, label: `${p.left} / ${p.right}` }))}
              onChange={(v) => setF({ pairs: [data.pairs.find((p) => p.left === v)!] })}
            />
          </Field>
          <ManualPair channels={chans} onPick={(a, b) => setF({ pairs: [{ left: a, right: b }] })} />
          <MultiToggle
            label="Representation"
            values={(fs.representations as string[]) ?? ['difference']}
            options={[
              { value: 'difference', label: 'difference' },
              { value: 'normalized', label: 'normalized' },
            ]}
            onChange={(v) => v.length && setF({ representations: v })}
          />
        </>
      );
    case 'complexity':
      return (
        <>
          <MultiToggle
            label="Items"
            values={(fs.items as string[]) ?? ['line_length', 'higuchi']}
            options={[
              { value: 'line_length', label: 'line length' },
              { value: 'higuchi', label: 'Higuchi FD' },
            ]}
            onChange={(v) => v.length && setF({ items: v })}
          />
          <Field label="kmax">
            <NumberInput
              label="Complexity kmax"
              value={(fs.kmax as number) ?? 8}
              min={2}
              onCommit={(v) => setF({ kmax: Math.round(v) })}
            />
          </Field>
        </>
      );
    case 'autoencoder':
      return (
        <>
          <Field label="Latent dimension">
            <Select
              label="Latent dimension"
              value={String(fs.latent ?? 8)}
              options={[2, 4, 8, 16].map((v) => ({ value: String(v), label: String(v) }))}
              onChange={(v) => setF({ latent: +v })}
            />
          </Field>
          <div className="row">
            <Field label="epochs">
              <NumberInput
                label="Epochs"
                value={(fs.epochs as number) ?? 50}
                min={1}
                onCommit={(v) => setF({ epochs: Math.round(v) })}
              />
            </Field>
            <Field label="learning rate">
              <NumberInput
                label="Learning rate"
                value={(fs.lr as number) ?? 0.01}
                min={0.0005}
                max={0.1}
                step={0.0005}
                onCommit={(v) => setF({ lr: Math.max(0.0005, Math.min(0.1, v)) })}
              />
            </Field>
            <Field label="batch">
              <NumberInput
                label="Batch size"
                value={(fs.batch as number) ?? 16}
                min={1}
                onCommit={(v) => setF({ batch: Math.round(v) })}
              />
            </Field>
          </div>
          <Msg kind="warn">Training runs on the CPU; evaluation trains one autoencoder per CV fold.</Msg>
          <div className="row">
            <button
              className="btn"
              onClick={() => void trainAutoencoder()}
              disabled={ae?.state === 'running'}
            >
              Train preview
            </button>
            <button
              className="btn ghost"
              onClick={() => void cancelAutoencoder()}
              disabled={ae?.state !== 'running'}
            >
              Cancel
            </button>
          </div>
          {ae ? <AePreview /> : null}
          <Status ep="ae" />
        </>
      );
    default:
      return <p className="small">Uses the channels from page 3.</p>;
  }
}

function CustomBand({ onAdd }: { onAdd: (b: { name: string; low: number; high: number }) => void }) {
  const lo = useRef<HTMLInputElement>(null);
  const hi = useRef<HTMLInputElement>(null);
  return (
    <span className="row">
      <input ref={lo} className="num" placeholder="low" aria-label="Custom band low" />
      <input ref={hi} className="num" placeholder="high" aria-label="Custom band high" />
      <button
        className="btn ghost small"
        onClick={() => {
          const a = +lo.current!.value;
          const b = +hi.current!.value;
          if (b > a && a > 0) onAdd({ name: `${a}-${b} Hz`, low: a, high: b });
        }}
      >
        add band
      </button>
    </span>
  );
}

function RatioPicker({ onAdd }: { onAdd: (r: string[]) => void }) {
  const names = NAMED.map((b) => ({ value: b.name, label: b.name }));
  const num = useRef('alpha');
  const den = useRef('beta');
  return (
    <span className="row">
      <Select label="Ratio numerator" value="alpha" options={names} onChange={(v) => (num.current = v)} />
      <Select label="Ratio denominator" value="beta" options={names} onChange={(v) => (den.current = v)} />
      <button className="btn ghost small" onClick={() => onAdd([num.current, den.current])}>
        add ratio
      </button>
    </span>
  );
}

function ManualPair({ channels, onPick }: { channels: string[]; onPick: (a: string, b: string) => void }) {
  const a = useRef(channels[0] ?? '');
  const b = useRef(channels[1] ?? '');
  return (
    <span className="row">
      <Select
        label="Manual left channel"
        value={a.current}
        options={channels.map((c) => ({ value: c, label: c }))}
        onChange={(v) => (a.current = v)}
      />
      <Select
        label="Manual right channel"
        value={b.current}
        options={channels.map((c) => ({ value: c, label: c }))}
        onChange={(v) => (b.current = v)}
      />
      <button className="btn ghost small" onClick={() => onPick(a.current, b.current)}>
        use pair
      </button>
    </span>
  );
}

function Playground() {
  const out = useRef<HTMLPreElement>(null);
  const amp = useRef(10);
  const freq = useRef(10);
  const noise = useRef(2);
  const run = async (): Promise<void> => {
    const r = await api.featurePreview({
      dataset_id: get().data?.id,
      settings: get().settings,
      family: 'time_stats',
      synthetic: { amplitude: amp.current, frequency: freq.current, noise: noise.current },
    });
    const st = r.stats as string[];
    const vals = r.values as number[];
    if (out.current) out.current.textContent = st.map((s, i) => `${s}: ${vals[i].toFixed(3)}`).join('\n');
  };
  return (
    <div className="playground">
      <span className="tag">simulated</span>
      <div className="row">
        <NumberInput
          label="Simulated amplitude"
          value={10}
          onCommit={(v) => ((amp.current = v), void run())}
        />
        <NumberInput
          label="Simulated frequency"
          value={10}
          onCommit={(v) => ((freq.current = v), void run())}
        />
        <NumberInput label="Simulated noise" value={2} onCommit={(v) => ((noise.current = v), void run())} />
      </div>
      <button className="btn ghost small" onClick={() => void run()}>
        recompute
      </button>
      <pre className="mono small" ref={out} />
    </div>
  );
}

function AePreview() {
  const ae = useStore((s) => s.results.ae)!;
  const h = ae.history ?? [];
  const last = h[h.length - 1];
  return (
    <div className="small" data-testid="ae-status">
      <progress max={1} value={ae.progress ?? 0} /> {ae.state}
      {last ? (
        <p>
          epoch {last.epoch}: train loss {last.train.toFixed(4)}
          {last.val !== null ? `, validation loss ${last.val.toFixed(4)}` : ''}
        </p>
      ) : null}
      {ae.result ? (
        <p>
          training loss fell by {(ae.result.lossDrop * 100).toFixed(1)}%; trial {ae.result.trial + 1}{' '}
          reconstructed ({decodeF32(ae.result.original).length} values). {ae.result.note}
        </p>
      ) : null}
    </div>
  );
}

const Page5 = memo(function Page5() {
  const data = useStore((s) => s.data);
  const fr = useStore((s) => s.results.features);
  if (!data) return <Msg>Load data on page 1 first.</Msg>;
  return (
    <>
      <Basket />
      {fr?.errors.map((e) => (
        <Msg key={e} kind="error">
          {e}
        </Msg>
      ))}
      <Status ep="features" />
      <p className="small">Hover a feature card to open its settings; click it to add it to the basket.</p>
    </>
  );
});

/** Use the same reveal spring for sidebar and in-page controls. */
function usePanelFade<T extends HTMLElement>(visible = true, from = 0) {
  const ref = useRef<T>(null);
  const reduced = useStore((s) => s.ui.reduceMotion);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    if (reduced) {
      el.style.opacity = '1';
      return;
    }
    const a = new Scalar(from, 'reveal');
    a.t = 1;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number): void => {
      const m = a.step(t - last);
      last = t;
      el.style.opacity = String(Math.max(0, Math.min(1, a.x)));
      if (m) raf = requestAnimationFrame(tick);
    };
    el.style.opacity = String(from);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, reduced, visible]);
  return ref;
}

function FadeIn({ children }: { children: ReactNode }) {
  const ref = usePanelFade<HTMLDivElement>();
  return <div ref={ref}>{children}</div>;
}

/** Settings pane shown inside an expanded feature card on Page 5 (replaces the sidebar there). */
export const CardPane = memo(function CardPane({ f }: { f: FamilyId }) {
  const fr = useStore((s) => s.results.features);
  const inBasket = useStore((s) => s.settings.features.includes(f));
  const meta = fr?.cards[f];
  const selMeta = fr?.selected.families.find((x) => x.id === f) ?? meta;
  return (
    <div className="card-pane-inner">
      <div className="card-pane-head">
        <strong>{TITLES[f]}</strong>
        <button
          className={`btn small ${inBasket ? 'ghost' : 'primary'}`}
          onClick={() => {
            const cur = get().settings.features;
            updateSettings({ features: inBasket ? cur.filter((x) => x !== f) : [...cur, f] });
          }}
        >
          {inBasket ? 'Remove from basket' : 'Add to basket'}
        </button>
      </div>
      <FamilySettings f={f} />
      {selMeta && !selMeta.error ? (
        <details className="small">
          <summary>
            {selMeta.count} features, units {Array.from(new Set(selMeta.units.map(formatFeatureUnit))).join(', ')}; formula
          </summary>
          <FeatureEquations family={f} />
          <p>interval: {selMeta.interval}</p>
          {selMeta.droppedSamples ? (
            <p>dropped samples in the last partial bin: {selMeta.droppedSamples}</p>
          ) : null}
          {(selMeta.warnings as string[] | undefined)?.map((w) => (
            <Msg key={w} kind="warn">
              {w}
            </Msg>
          ))}
          <p className="mono">
            {selMeta.names.slice(0, 40).join(', ')}
            {selMeta.names.length > 40 ? ' ...' : ''}
          </p>
        </details>
      ) : selMeta?.error ? (
        <Msg kind="warn">{selMeta.error}</Msg>
      ) : null}
    </div>
  );
});

// ------------------------------------------------------------------------------------- page 6
export const TransformControls = memo(function TransformControls() {
  const s = useStore((st) => st.settings);
  const hold = useStore((st) => st.ui.panelHold);
  const tr = useStore((st) => st.results.transform);
  const fr = useStore((st) => st.results.features);
  const names = useStore((st) => st.data?.classNames ?? NONE);
  const featNames = fr?.selected.families.flatMap((f) => f.names) ?? [];
  const uniq = Array.from(new Set(featNames));
  if (hold) return <Basket flipping />;
  return (
    <aside className="workspace-tools transform-tools" aria-label="Transform and normalize controls">
      <Section title="Feature to inspect">
        <Select
          label="Feature to inspect"
          value={s.inspectFeature ?? tr?.feature ?? uniq[0] ?? ''}
          options={uniq.map((n) => ({ value: n, label: n }))}
          onChange={(v) => updateSettings({ inspectFeature: v })}
        />
      </Section>
      <Section title="Transform (applied first)">
        <Toggle
          label="Transform"
          value={s.transform}
          options={[
            { value: 'none', label: 'none (default)' },
            { value: 'log', label: 'log' },
            { value: 'signed_log', label: 'signed log' },
          ]}
          onChange={(v) => updateSettings({ transform: v as Settings['transform'] })}
        />
        <SignedLogEquation />
        {s.transform === 'log' && tr ? (
          <p className="note">log skipped for {tr.logSkipped} non-positive columns</p>
        ) : null}
      </Section>
      <Section title="Normalise (applied second)">
        <Toggle
          label="Normalise"
          value={s.normalise}
          options={[
            { value: 'none', label: 'none' },
            { value: 'zscore', label: 'z-score' },
            { value: 'robust', label: 'robust scale (median/IQR)' },
            { value: 'minmax', label: 'min-max' },
          ]}
          onChange={(v) => updateSettings({ normalise: v as Settings['normalise'] })}
        />
      </Section>
      {tr ? (
        <Section title="Numbers">
          <table className="nums mono">
            <tbody>
              <tr>
                <th />
                <th>before</th>
                <th>after</th>
              </tr>
              <tr>
                <td>skewness</td>
                <td>{tr.before.skew.toFixed(3)}</td>
                <td>{tr.after.skew.toFixed(3)}</td>
              </tr>
              <tr>
                <td>kurtosis</td>
                <td>{tr.before.kurtosis.toFixed(3)}</td>
                <td>{tr.after.kurtosis.toFixed(3)}</td>
              </tr>
              {names.map((n, k) => (
                <tr key={n}>
                  <td>{n} mean / std</td>
                  <td>
                    {tr.before.perClass[k]?.mean.toPrecision(3)} / {tr.before.perClass[k]?.std.toPrecision(3)}
                  </td>
                  <td>
                    {tr.after.perClass[k]?.mean.toPrecision(3)} / {tr.after.perClass[k]?.std.toPrecision(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">{tr.footnote}</p>
        </Section>
      ) : null}
      <Status ep="transform" />
    </aside>
  );
});

// ------------------------------------------------------------------------------------- page 7
export const MatrixControls = memo(function MatrixControls() {
  const s = useStore((st) => st.settings);
  const ev = useStore((st) => st.results.evaluate);
  const ss = s.selectionSettings;
  const setSel = (p: Partial<typeof ss>): void =>
    updateSettings({ selectionSettings: { ...get().settings.selectionSettings, ...p } });
  const names = ev?.names ?? [];
  return (
    <div className="workspace-tools matrix-tools" aria-label="Feature matrix controls" role="group">
      <Section title="Classifier">
        <Field label="Classifier">
          <Select
            label="Classifier"
            value={s.classifier}
            options={[
              { value: 'lda', label: 'LDA' },
              { value: 'logreg', label: 'logistic regression' },
              { value: 'svm', label: 'linear SVM' },
            ]}
            onChange={(v) => updateSettings({ classifier: v as Settings['classifier'] })}
          />
        </Field>
        <Field label="CV folds">
          <Select
            label="CV folds"
            value={String(s.cvFolds)}
            options={[2, 3, 4, 5, 10].map((v) => ({ value: String(v), label: String(v) }))}
            onChange={(v) => updateSettings({ cvFolds: +v })}
          />
        </Field>
        {ev?.foldMessage ? <Msg kind="warn">{ev.foldMessage}</Msg> : null}
        {ev ? (
          <p className="readout" data-testid="accuracy">
            accuracy {(ev.accuracy.mean * 100).toFixed(1)}% +- {(ev.accuracy.std * 100).toFixed(1)} (chance{' '}
            {(ev.chance * 100).toFixed(0)}%)
          </p>
        ) : null}
        <Status ep="evaluate" />
        <Switch
          checked={!s.leakageGuard}
          onChange={(v) => {
            updateUi({ leakFlipped: true });
            updateSettings({ leakageGuard: !v });
          }}
          label={
            s.leakageGuard
              ? 'Learned steps fitted on: training folds only (correct)'
              : 'Learned steps fitted on: all data (leaky)'
          }
        />
        {ev ? (
          <p className="small" data-testid="leak-readout">
            correct {(ev.correct.mean * 100).toFixed(1)}%, leaky {(ev.leaky.mean * 100).toFixed(1)}%: leaky
            fit changed accuracy by {ev.gapPoints >= 0 ? '+' : '-'}
            {Math.abs(ev.gapPoints).toFixed(1)} points
          </p>
        ) : null}
      </Section>
      <Section title="Scatter features">
        <Field label="X feature">
          <Select
            label="X feature"
            value={s.xFeature ?? ev?.scatter.x ?? ''}
            options={names.map((n) => ({ value: n, label: n }))}
            onChange={(v) => updateSettings({ xFeature: v })}
          />
        </Field>
        <Field label="Y feature">
          <Select
            label="Y feature"
            value={s.yFeature ?? ev?.scatter.y ?? ''}
            options={names.map((n) => ({ value: n, label: n }))}
            onChange={(v) => updateSettings({ yFeature: v })}
          />
        </Field>
        <Switch
          checked={s.showPreSelection}
          onChange={(v) => updateSettings({ showPreSelection: v })}
          label="Show pre-selection matrix"
        />
      </Section>
      <section className="psec matrix-selection" aria-labelledby="matrix-selection-title">
        <h3 id="matrix-selection-title">Select &amp; reduce</h3>
        <div className="matrix-selection-grid">
          <div>
            <Switch
              checked={ss.variance.on}
              onChange={(v) => setSel({ variance: { ...ss.variance, on: v } })}
              label="1. Variance threshold"
            />
            <NumberInput
              label="Variance threshold"
              value={ss.variance.threshold}
              step={0.001}
              onCommit={(v) => setSel({ variance: { ...ss.variance, threshold: v } })}
            />
          </div>
          <div>
            <Switch
              checked={ss.correlation.on}
              onChange={(v) => setSel({ correlation: { ...ss.correlation, on: v } })}
              label="2. Correlation pruning (|r|)"
            />
            <NumberInput
              label="Correlation threshold"
              value={ss.correlation.threshold}
              step={0.01}
              onCommit={(v) => setSel({ correlation: { ...ss.correlation, threshold: v } })}
            />
          </div>
          <div>
            <Switch
              checked={ss.ranking.on}
              onChange={(v) => setSel({ ranking: { ...ss.ranking, on: v } })}
              label="3. Rank and keep top K"
            />
            <div className="row">
              <Select
                label="Ranking method"
                value={ss.ranking.method}
                options={[
                  { value: 'fisher', label: 'Fisher score' },
                  { value: 'mi', label: 'mutual information' },
                ]}
                onChange={(v) => setSel({ ranking: { ...ss.ranking, method: v as 'fisher' | 'mi' } })}
              />
              <NumberInput
                label="Top K"
                value={ss.ranking.topK}
                min={1}
                onCommit={(v) => setSel({ ranking: { ...ss.ranking, topK: Math.max(1, Math.round(v)) } })}
              />
            </div>
            <FisherEquation />
          </div>
          <div>
            <Field label="4. Projection">
              <Select
                label="Projection"
                value={ss.projection.method}
                options={[
                  { value: 'none', label: 'none' },
                  { value: 'pca', label: 'PCA' },
                  { value: 'lda', label: 'supervised LDA projection' },
                ]}
                onChange={(v) =>
                  setSel({ projection: { ...ss.projection, method: v as 'none' | 'pca' | 'lda' } })
                }
              />
            </Field>
            <NumberInput
              label="Components"
              value={ss.projection.components}
              min={1}
              onCommit={(v) =>
                setSel({ projection: { ...ss.projection, components: Math.max(1, Math.round(v)) } })
              }
            />
          </div>
        </div>
        {ss.projection.method === 'lda' ? (
          <p className="small">
            An LDA projection reduces the features to at most K-1 dimensions; it is not the same as choosing
            LDA as the final classifier.
          </p>
        ) : null}
        {ev?.pca ? <Scree evr={ev.pca.explainedVarianceRatio} cum={ev.pca.cumulative} /> : null}
        {ev ? (
          <p className="small mono">
            pre-selection {ev.preShape.join(' x ')} to final {ev.shape.join(' x ')}; fold isolation{' '}
            {ev.foldIsolation ? 'verified' : 'FAILED'}
          </p>
        ) : null}
      </section>
    </div>
  );
});

function Scree({ evr, cum }: { evr: number[]; cum: number[] }) {
  const w = 260;
  const h = 70;
  return (
    <figure className="scree" aria-label="Scree plot">
      <svg width={w} height={h + 14} viewBox={`0 0 ${w} ${h + 14}`} role="img" aria-label="Explained variance by principal component">
        {evr.map((v, i) => (
          <rect
            key={i}
            x={4 + (i * (w - 8)) / evr.length}
            y={h - v * h}
            width={(w - 8) / evr.length - 2}
            height={v * h}
            fill="#2b4c8c"
          />
        ))}
        <polyline
          fill="none"
          stroke="#1f1b16"
          points={cum.map((v, i) => `${4 + ((i + 0.5) * (w - 8)) / cum.length},${h - v * h}`).join(' ')}
        />
      </svg>
      <figcaption>
        <strong>Explained variance by component</strong>
        <span>Bars {evr.map((v) => v.toFixed(2)).join(', ')}</span>
        <span>Cumulative line {cum[cum.length - 1]?.toFixed(2)} (exploratory, all-data fit)</span>
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------------------------- page 8
const Page8 = memo(function Page8() {
  const s = useStore((st) => st.settings);
  const ex = useStore((st) => st.results.export);
  const download = (name: string, text: string, type = 'text/plain'): void => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
  };
  return (
    <>
      <Section title="Matrix export mode">
        <Toggle
          label="Matrix export mode"
          value={s.exportMode}
          options={[
            { value: 'exploratory', label: 'Exploratory (all-data fit)' },
            { value: 'oof', label: 'Out-of-fold (per fold)' },
          ]}
          onChange={(v) => updateSettings({ exportMode: v as Settings['exportMode'] })}
        />
        <p className="small">{ex?.modeLabel ?? ''}</p>
      </Section>
      <Section title="Downloads">
        <div className="col">
          <button
            className="btn"
            disabled={!ex}
            onClick={() => ex && void navigator.clipboard?.writeText(ex.script)}
          >
            Copy as Python
          </button>
          <button
            className="btn"
            disabled={!ex}
            onClick={() => ex && download('eeg_pipeline.py', ex.script, 'text/x-python')}
          >
            Download .py
          </button>
          <button
            className="btn"
            disabled={!ex}
            onClick={() =>
              ex && download('settings.json', JSON.stringify(ex.settingsJson, null, 2), 'application/json')
            }
          >
            Download settings JSON
          </button>
          <a
            className={`btn ${ex ? '' : 'disabled'}`}
            data-testid="dl-csv"
            href={ex ? api.exportUrl(ex.token, 'csv') : undefined}
            download
          >
            Download feature matrix CSV
          </a>
          <a
            className={`btn ${ex ? '' : 'disabled'}`}
            data-testid="dl-npz"
            href={ex ? api.exportUrl(ex.token, 'npz') : undefined}
            download
          >
            Download feature matrix NPZ
          </a>
        </div>
        <p className="small">Reproduces the accuracy shown on page 7 within normal CV variance</p>
        <Status ep="export" />
      </Section>
    </>
  );
});

const PANELS = [null, null, null, null, Page5, null, null, Page8];

export const ControlsPanel = memo(function ControlsPanel() {
  const page = useStore((s) => s.page);
  const open = useStore((s) => s.ui.panelOpen);
  const P = PANELS[page - 1];
  if (!P) return null;
  return (
    <aside className={`panel ${open ? '' : 'closed'}`} aria-label="Controls">
      <button
        className="btn ghost panel-toggle"
        onClick={() => updateUi({ panelOpen: !open })}
        aria-expanded={open}
        aria-label={open ? 'Hide controls' : 'Show controls'}
        title={open ? 'Hide controls' : 'Show controls'}
      >
        {open ? 'Hide controls ›' : '‹'}
      </button>
      <div className="panel-body">
        <FadeIn key={page}>
          <P />
        </FadeIn>
      </div>
      {void defaultSettings}
    </aside>
  );
});
