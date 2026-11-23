# BUILD SPEC v5.1 — GENERAL EEG FEATURE-ENGINEERING APP (v4 generalized: any dataset, any paradigm, motor imagery as one preset)

> Document status: this is the single source of truth. Sections 3.4 (paradigm presets), 5.3a and 5.7 (transition choreography) and 6A (feature extraction, selection, reduction, export) are normative. Where an older page-level paragraph and one of those sections describe the same thing differently, the normative section wins. All other requirements remain in force.

> **v5.1 change (Page 3 only):** (1) the head map now shows ONLY the electrodes of the loaded dataset, so a 32-channel dataset shows a 32-electrode head and a 64-channel dataset a 64-electrode head, with no placeholder or extra positions (the old "other standard positions as hollow dots" are removed); (2) Page 3 gets a richer set of electrode presets (named collections of electrodes). Everything else is unchanged. The new normative block is "Electrode layout and presets (normative)" inside PAGE 3.

# ROLE
You are a senior creative front-end engineer and a signal-processing / EEG engineer. Build the app described below exactly as specified. This document is the single source of truth.

# HOW TO READ THIS SPEC (anti-hallucination rules)
1. Build only what is written here. Do not add pages, features, libraries, or visual styles that are not listed. Do not drop or simplify anything that is listed.
2. If something is genuinely unspecified AND expensive to change later, ask me before coding. If it is cheap to change, pick the default given in this document, or the simplest option, and list it under "Assumptions" in the README.
3. Never fake results. Every number, curve, score, shape badge and animation target shown to the user must come from a real computation on the real data array. No hard-coded accuracies, no hand-drawn "expected" curves.
4. Never invent EEG facts. The app is general: it teaches the pipeline and makes no physiological claim about a user's own data. The only physiological statements allowed anywhere in the UI are the "facts" strings in the paradigm presets (section 3.4), which are limited to: (a) motor imagery causes event-related desynchronization (ERD, a drop in mu 8-12 Hz and beta 13-30 Hz power) over the sensorimotor cortex CONTRALATERAL to the imagined hand, so left-hand imagery is strongest at C4 and right-hand imagery at C3; (b) rare target stimuli evoke a positive deflection about 300 to 500 ms after onset (P300), largest over midline central and parietal sites (Cz, Pz); (c) a flickering visual stimulus at frequency f evokes a response at f and its harmonics over occipital sites. Custom data shows no such statement.
5. Where this spec says "exactly", match it exactly. Where it says "default", it is the initial value and the user can change it.
6. Never guess a library's API from memory. For PixiJS v8, MNE, pyRiemann, PyWavelets, scikit-learn and Radix, read the installed package's type definitions or official docs before using a function. PixiJS v8 differs from v7 (async `await app.init()`, `new Mesh({ geometry, shader })`, `geometry.topology` instead of `drawMode`, only Containers have children). Do not write v7-style code.
7. Before writing code: (a) restate your plan in under 300 words, (b) list assumptions, (c) ask only the expensive-to-change questions. Then build in the stages listed at the end and report after each stage.

# 1. PRODUCT SUMMARY
An interactive, animated teaching and demo web app for EEG feature engineering on event-locked epochs (trials x channels x samples) with two or more classes. It is paradigm-agnostic: any dataset can be loaded, and three built-in presets (motor imagery, P300/ERP, SSVEP) provide ready-made sample data, sensible defaults and short hints. The user walks through 8 pages: Load data, Time window, Channels, Frequency band, Choose features, Transform and normalize, Feature matrix, Export. Audience: people who know little about EEG. They should SEE what windowing, channel selection, band-pass filtering, feature extraction, normalization, feature selection and data leakage do to the data.

CORE IDEA (most important architectural rule): there is ONE persistent "data object" that is never replaced. It is made of "pieces" (samples, channels, trials, features, histogram grains). Every page is only a different ARRANGEMENT of the same pieces. A page transition is the pieces physically travelling from the previous arrangement to the next, following the choreography in Section 5.7. No page draws its own separate chart out of nothing. Nothing is destroyed and recreated between pages.

# 2. TECH STACK (fixed, do not substitute)

## 2.0 Version policy
- Use the latest stable release of each package at install time (check with `npm view <pkg> version` and `pip index versions <pkg>`). Pin exact versions in `package.json` and `requirements.txt`, and commit lockfiles. Record the chosen versions in the README.
- PixiJS: the latest stable 8.x release.
- Python 3.11 or newer. Node 20 or newer.

## 2.1 Frontend
- Language and build: TypeScript (strict mode), Vite, `@vitejs/plugin-react`.
- UI layer: React 19 for the DOM UI ONLY (controls panel, top bar, page header and caption, tooltips, shape badge, accessibility overlay, dialogs and drawers). React never draws or owns the stage.
- State: Zustand, using its vanilla store (`createStore`) so the engine can read and subscribe to it outside React, plus the `useStore` hook for React components.
- Stage: PixiJS v8 (one `Application`, one canvas), renderer preference `webgl`. Canvas is an experimental last-resort fallback only; show a small tag "limited rendering mode" if it is ever used.
- Controls: Radix UI primitives (`@radix-ui/react-slider`, `-select`, `-switch`, `-tooltip`, `-toggle-group`) for accessible, keyboard-operable controls, styled with plain CSS. No other component library.
- Styling: plain CSS with CSS variables (CSS Modules allowed). Design tokens live in one file, `src/design/tokens.css`.
- Fonts: self-hosted through `@fontsource` packages (Fraunces, Inter, JetBrains Mono). No CDN font links, so the app works offline.
- Animation: a custom spring solver written by you (about 60 lines of TypeScript for the core). It is the ONLY animation engine.
- Code display on Page 8: a plain `<pre>` with the typing effect. No syntax-highlighting library.

## 2.2 Backend
- Python 3.11+, FastAPI, uvicorn, python-multipart (required for CSV and NPZ upload), orjson (fast JSON responses), numpy, scipy, scikit-learn (includes PCA, LDA, feature selection and TSNE), MNE-Python, pandas, PyWavelets (`pywt`), pyRiemann (`pyriemann`).
- Standalone web app: frontend on localhost:5173 talks to FastAPI on localhost:8000 over JSON.
- Fallback: if the backend is unreachable, load a bundled pre-computed result JSON per preset (generated by `scripts/make_fallback.py`) so the demo still runs, and show a small "offline sample results" tag. Offline mode supports only the three built-in sample datasets.
- Array transport: large numeric arrays are sent as `{ "dtype": "f32", "shape": [...], "b64": "<base64 of little-endian float32>" }`, never as nested JSON lists. Provide matching `encodeF32` (Python) and `decodeF32` (TypeScript) helpers, with a round-trip test.
- Paradigm presets (section 3.4) live in ONE file, `backend/app/paradigms.json`, served by `GET /paradigms`; the frontend reads them from the API (and from the offline fallback). Presets are never duplicated in frontend code.

## 2.3 Rendering rules (how each kind of piece is drawn)
- Performance target: 60 fps on a mid-range laptop. The registry holds about 14,000 pieces in total (pools, section 5.1), but at most about 5,000 are visible at once. Pieces that are fully settled AND invisible (alpha below 0.01 or scale near 0) are skipped by both the spring solver and the renderer (`visible = false`).
- Spring state is stored in structure-of-arrays form: one `Float32Array` per property (position, velocity, target) indexed by piece number. No per-piece objects in the hot loop. Settled pieces are skipped.
- `ribbon` pieces: one PixiJS `Mesh` each (custom geometry, `triangle-strip` topology, built ONCE per dataset in unit space from at most 200 decimated points covering the FULL epoch). Animate only through x, y, scaleX, scaleY, alpha, tint and two spring-driven shader uniforms `uWinStart` and `uWinEnd` (0..1) that hide fragments outside the Page 2 window, so dragging the window crops smoothly with no geometry rebuild. Rebuild geometry only when the dataset changes, never per frame. Do not use stroked `Graphics` for ribbons.
- `env`, `wave` pieces: same Mesh approach as ribbons.
- `strip`, `dot`, `sine` (spectrum bars), `val` (grains and cells): PixiJS `ParticleContainer` with `Particle` objects. All particles in one container share one base texture, so use a single small texture atlas that contains a 1x1 white pixel (rects and bars), and pre-rendered class markers (circle, square, triangle, diamond, cross, star). Declare position, vertex (for width and height), rotation and color as dynamic properties; call `update()` after changing static properties or the particle list. Particles have no children and no events, so hit areas come from the accessibility overlay (section 10) or from canvas pointer maths.
- Static artwork (head outline, nose, ears, cap, meridian arcs, axes, ticks, gauge frames, prism, basket outline, correlation heat map, scree plot, box and density plots, decision-region shading): `Graphics` objects built once and redrawn only when stage size or data changes. These are "decor" items (section 5.1) and carry springs for alpha and reveal.
- Low-count pieces (`electrode`, `spark`, `card`, `chip`, `rail`): `Container`s built once. Text labels use `BitmapText` or DOM overlays; avoid creating or changing `Text` objects per frame. A `spark` container holds one class-mean trace mesh per class (up to 6).
- Effect-map heat overlay: a 64 x 64 backend grid converted to a texture (bilinear filtering), shown as a `Sprite` masked by the head circle.
- Level of detail: pieces smaller than 3 px are drawn as plain quads (no marker texture, no label).
- Fallback for slow machines: if the measured frame rate on the default sample dataset is below 50 fps, reduce the ribbon display subset to 40 stratified trials, show the tag "showing 40 of N trials", and report this in the README.
- No piece is created or destroyed after startup. Use object pooling only for transient effects (pulse trails).

## 2.4 React boundary rules (important)
- The engine (pieces, springs, camera, layouts, transitions, Pixi stage) lives in `src/engine` and does NOT import React. It is created once as a module-level singleton with an idempotent `mount(canvas)` and `unmount()`. `unmount()` only detaches the canvas and listeners; it never destroys pieces. This must survive React StrictMode double-mounting in development.
- React never re-renders per frame. Per-frame values (live counters, odometer, tooltips following the pointer, overlay positions) are written directly to the DOM through refs and a subscription to the engine ticker, not through React state.
- React re-renders only when settings or backend results change (store updates).
- The engine reads settings through the vanilla Zustand store, calls layouts, and retargets springs. Layout functions stay pure and framework-free.
- Use `React.memo` and selector-based `useStore` calls so a settings change re-renders only the components that use it.

## 2.5 NOT allowed
- No Streamlit, Dash, Gradio, Flask, Django, or any Python UI framework.
- No Vue, Svelte, Angular, Next.js, or any UI framework other than React 19.
- No Redux, MobX, Recoil, or any state library other than Zustand.
- No Tailwind, Bootstrap, MUI, Chakra, Ant Design, shadcn bundles, or any CSS or component framework other than the Radix primitives listed above.
- No GSAP, Framer Motion, React Spring, anime.js, or any animation library.
- No D3, Chart.js, Plotly, ECharts, Recharts, or any chart library. All visuals are pieces or decor on the PixiJS stage.
- No Three.js or other 3D engines. The camera "tilt" is a 2D matrix transform.
- No PyTorch, TensorFlow, JAX or any deep-learning framework. The autoencoder is implemented with NumPy and SciPy as defined in section 6A.
- No `scipy.signal.cwt` or `scipy.signal.morlet` (removed from SciPy). Use PyWavelets.
- No private MNE functions (anything starting with an underscore).
- No hard-coded channel names, class names, frequency bands or time values in engine, layout or feature code. They come from the loaded data and the paradigm preset (section 3.4).
- No extra dependencies beyond those listed. If another dependency is truly needed, ask first.

## 2.6 Tooling
- Package manager: npm. Frontend unit tests: Vitest. Frontend end-to-end tests: Playwright. Backend tests: pytest.
- Formatting and linting: Prettier and `tsc --noEmit` (strict) for the frontend; ruff for the backend.

## 2.7 Repository layout
```
/frontend
  /src/engine        pieces, decor, springs, stagger, waypoints, transitions table, camera, stage (no React)
  /src/layouts       one pure layout function per page (page1.ts ... page8.ts)
  /src/store         Zustand vanilla store and selectors
  /src/api           typed backend client, decodeF32, offline fallback loader
  /src/ui            React components (TopBar, PageHeader, ControlsPanel, per-page panels, A11yOverlay)
  /src/design        tokens.css, fonts import
  /tests             Vitest unit tests and Playwright e2e tests
/backend
  /app               main.py, paradigms.json, electrode_presets.json, paradigms.py (loading, validation and synthetic generators), dataset.py, contract.py, window.py, channels.py, band.py, transform.py, selection.py, evaluate.py, export.py, montage.py, autoencoder_jobs.py
  /app/features      time_stats.py, window_means.py, spectral.py, tf_regions.py, asymmetry.py, complexity.py, autoencoder.py, classic.py (band power, CSP, Hjorth, wavelet, covariance), composite.py
  /tests             pytest tests
/sample              example_motor_imagery.csv, example_erp.csv, example_ssvep.csv
/scripts             make_fallback.py
/docs                pages.md, transitions.md, paradigms.md, demo-script.md
```

## 2.8 Optional design source
- If a `design/` folder exists (tokens exported from Figma as CSS or JSON, plus SVG assets), use it as the source of truth for colours, type, spacing and artwork. Where it disagrees with this spec on look, follow the design folder. Where it disagrees on behaviour, follow this spec. If the folder does not exist, use section 4.

# 3. DATA MODEL

## 3.0 General data model
- Tensor X: shape (n_trials, n_channels, n_samples), in microvolts, with sampling rate `sfreq` (Hz) and a `times` vector (one value per sample, in seconds, relative to the event onset, so the event is at t = 0 and the first sample is at `tmin`, which is negative when the epoch includes a pre-event baseline). The backend ALWAYS keeps the full uncropped epoch; the Page 2 window is applied as a downstream crop.
- Labels y: integers 0..K-1 with `class_names` (K = 2 to 6 classes; classes may be imbalanced). Class order is the natural (numeric-aware alphabetical) sort of the label strings, or numeric ascending when all labels are numbers. The same class order is used everywhere (top to bottom in stacked bands, in legends, in colour assignment).
- Channels: any list of channel names (1 to 128). Channels whose names exist in the chosen montage get a head position; the others are "unpositioned" and are shown in a tray (Page 3). The Page 3 head map draws exactly the dataset's own channels (32 channels give a 32-electrode head, 64 give a 64-electrode head) and never any other site.
- Optional baseline interval [b0, b1] in seconds relative to the event (default: `tmin` to 0 when `tmin` < 0, otherwise none). Features and maps that need a baseline are disabled with an explanation when none exists.
- Limits (validate and show friendly errors): at most 2,000 trials, 128 channels, 10,000 samples per epoch (and epoch length at most 20 s), 6 classes, at least 2 classes with at least 2 trials each. Stratified CV folds are reduced to the smallest class count (minimum 2) with a visible message.
- Class colours and markers (used everywhere, in this order): class 0 muted terracotta #C4623D with a circle; class 1 deep teal #1F6F78 with a square; class 2 ochre #B58B2A with a triangle; class 3 plum #7A4E7E with a diamond; class 4 olive #6B7A3A with a cross; class 5 rose #A8586B with a star. Selection accent = ink-blue #2B4C8C. Everything else cream and ink tones (section 4). Classes are never distinguished by colour alone.
- Chance level everywhere = the majority-class rate (equals 1/K for balanced classes).

## 3.1 Time-axis rules (all pages)
- The time axis spans `times[0]` to `times[-1]`. Tick step = the smallest value in {0.1, 0.2, 0.5, 1, 2, 5} seconds giving at most 10 ticks. The event marker (labelled with the preset's `eventLabel`, default "event") is drawn at t = 0 only if t = 0 lies inside the epoch.
- Window snap = 0.05 s if the epoch is 1.5 s or shorter, otherwise 0.1 s. Minimum window width = 0.5 s if the epoch is 2.5 s or longer, otherwise 0.2 s.
- Frequency axes run from 1 Hz to min(45, 0.9 x Nyquist). Band edges are clamped to that range.

## 3.2 CSV upload
- Accept a CSV in WIDE format: columns `trial, label, channel, s0, s1, ..., s{N-1}`. One row per (trial, channel). `label` is any string or number (K = 2 to 6 distinct values). `channel` is any name. Sample times are `tmin + i / sfreq`.
- Fields next to the upload: sampling rate (default 250 Hz), "time of first sample relative to the event, tmin (s)" (default 0), optional baseline start and end (s, relative to the event; empty = none unless tmin is negative), montage (a dropdown of the built-in montages from the public MNE function that lists them; default `standard_1005`), and "Interpret as" (Custom, Motor imagery, P300 / ERP, SSVEP; default Custom). "Interpret as" applies that preset's defaults, hints, probe and recommendations to the loaded data (section 3.4); channels the preset needs but the data lacks are dropped with a warning.
- Document the format in the README and provide the three `sample/example_*.csv` files and a "Download example CSV" link for the selected sample in the UI.
- Validate and show friendly inline errors for: missing columns, non-numeric samples, unequal trial lengths, a trial with missing channels, duplicate (trial, channel) rows, fewer than 2 or more than 6 classes, classes with fewer than 2 trials, and any limit in section 3.0. Unknown channel names are allowed (they are unpositioned); the same name set must appear in every trial.
- The shape badge (e.g. "100 x 22 x 750") is always computed from the real parsed array, in the format trials x channels x samples.

## 3.3 Upstream NPZ input (optional embedded mode)
Standalone CSV and sample modes always work. In addition, accept a versioned NPZ file through `POST /dataset/upload-npz` (button "Load upstream NPZ" on Page 1). Required keys: `X` (float32, epochs x channels x samples, microvolts), `y` (int labels), `sfreq` (float scalar), `ch_names` (string array), `times` (float, one value per sample, seconds relative to the event), `meta_json` (a JSON string with at least `{"version": "1", "units": "uV"}` plus optional `event_id`, `artifact_provenance` (list of step names and parameters) and `upstream_settings` (for example the band already applied)). Optional keys: `class_names` (string array), `ch_pos` (channels x 2 array of head-map positions normalized so the head circle has radius 1; overrides the montage), `baseline_X` (epochs x channels x samples_b) with `baseline_times`; `tfr` (epochs x channels x freqs x times, power) with `tfr_freqs` and `tfr_times`; `X_spatial` (spatially filtered signals, epochs x components x samples). Validate shapes, finite values, units equal to "uV", the limits in section 3.0, and channel names; return friendly errors otherwise. Upstream data is immutable: all Page 2 to Page 4 operations are downstream copies. Page 1 shows an "Input provenance" readout (source: sample preset, csv or upstream npz; units; artifact steps from `meta_json`). Pages 2 to 4 show an "Upstream settings inherited" badge when `upstream_settings` exist, and any new filter on Page 4 is labelled "feature-specific filter (additional to upstream)". When no upstream object is loaded, none of this appears.

## 3.4 Paradigm presets (`paradigms.json`, normative)
A preset is a JSON object with these fields. Every field except `id`, `name` and `synthetic` is optional and falls back to the "custom" behaviour in the last bullet.
- `id`, `name`, `classNames`, `eventLabel`, `sfreq`, `epoch {tmin, n_samples}`, `channels` (ordered list), `baseline {start, end}` or null.
- `zone {start, end, label}` or null: the "expected response zone" drawn on Page 2.
- `defaultWindow {start, end}`, `defaultBand {low, high, order}`.
- `windowPresets`, `bandPresets`, `channelPresets` (lists of `{label, ...}`; a channel preset button is shown only when all its channels exist in the data).
- `probe {x, y}`: the two scalar features for the Page 2 mini-plot. Each is `{channel, type, band}` where `type` is `log_band_power` (with `band [low, high]` in Hz, over the current window) or `mean_amplitude` (over the current window).
- `mapMetric`: the default Page 3 effect-map metric and its parameters (section 6, Page 3).
- `keyBands`: named bands highlighted on Page 4; `stimulusFrequencies`: per-class frequencies (SSVEP).
- `defaultFeature`: the family and settings used while the user has chosen nothing; `recommendedFamilies`: cards that get a "recommended" tag (never auto-selected); `waveletRange [low, high]`.
- `hints {page2, page3, page4}`: one short sentence each, shown in small secondary text under the page caption.
- `facts`: the one allowed physiological statement from rule 4 (shown in an info popover on Page 1).
- `synthetic`: the id of the generator below.
- **Custom** (no preset, the default for uploaded data): `probe` = log band power of the Page 4 band at the first two channels (user-editable dropdowns for channel, type and band); `mapMetric` = class separability of band power in the Page 4 band; `defaultWindow` = the full epoch; `defaultBand` = 1 to 40 Hz, order 4; `defaultFeature` = `band_power` with the theta (4-8), alpha (8-13) and beta (13-30) bands; `waveletRange` = 4 to 30 Hz clamped to Nyquist; no zone, no hints, no facts; window presets = "Full epoch" plus, when a baseline exists, "Baseline only (control)".

Switching the "Interpret as" or sample preset applies that preset's defaults to window, band, channel selection, probe, map metric and default feature, and shows the tag "defaults from {preset name}". It does not change the loaded data.

### 3.4.1 Preset `motor_imagery` (synthetic generator `make_motor_imagery()`, seed 7)
- Classes: "left hand", "right hand" (balanced, 100 trials, 50 per class). Event label "cue". sfreq 250 Hz; epoch from tmin -0.5 s, 750 samples (to +2.496 s). Baseline -0.5 to 0 s. Zone 0.5 to 2.0 s, label "typical imagery zone". Default window 0.0 to 2.0 s (500 samples). Default band 8 to 30 Hz, order 4.
- Channels (22, in this order): Fz, FC3, FC1, FCz, FC2, FC4, C5, C3, C1, Cz, C2, C4, C6, CP3, CP1, CPz, CP2, CP4, P1, Pz, P2, POz.
- Window presets: "Full epoch", "Imagery 0 to 2 s (default)", "Late 1 to 2.5 s", "Before cue -0.5 to 0 s (control)". Band presets: "Mu only 8-12", "Beta only 13-30", "Mu + beta 8-30 (default)", "Wide 4-40", "Delta/theta 1-7 (control)". Channel presets: "Motor strip (C3, Cz, C4)", "Central ring (C5, C3, C1, Cz, C2, C4, C6, CP3, CPz, CP4, FC3, FCz, FC4)".
- Probe: x = C3 log band power 8-12 Hz; y = C4 log band power 8-12 Hz. Map metric: band-power change vs baseline, band 8-12 Hz, class map for class 0. Key bands: mu 8-12, beta 13-30. Default feature: `band_power` with mu and beta. Recommended: `csp`, `band_power`, `tf_regions`, `asymmetry`, `covariance`. Wavelet range 8 to 30 Hz.
- Hints: page 2 "Motor imagery effects usually start about 0.5 s after the cue."; page 3 "Motor imagery lives over the motor strip (C3, Cz, C4)."; page 4 "Mu (8-12 Hz) and beta (13-30 Hz) power drop during imagery."
- Facts: rule 4 (a).
- Generator: for each trial and channel the signal is the sum of:
  - Background: pink (1/f) noise, amplitude about 10 uV RMS.
  - Occipital alpha: 10 Hz sinusoid with random phase, amplitude strongest at POz, Pz, P1, P2 (about 8 uV), weaker elsewhere (about 2 uV), present throughout the epoch and NOT task-modulated.
  - Motor rhythms: mu component (random frequency per trial between 9.5 and 11.5 Hz) and beta component (random frequency between 18 and 24 Hz), each present before the cue at full amplitude (mu about 6 uV, beta about 3 uV) at central channels (C3, C1, Cz, C2, C4, CP3, CP1, CPz, CP2, CP4, FC3, FC1, FCz, FC2, FC4, C5, C6) and weak elsewhere.
  - ERD: starting 0.5 s after the cue (t = +0.5 s) with a smooth 0.3 s ramp, multiply the motor mu amplitude by (1 - d) and beta by (1 - 0.5 d), where d is the ERD depth. d is drawn per trial from a normal distribution (mean 0.55 contralateral, 0.15 ipsilateral, sd 0.2, clipped to 0..0.9). Spatial spread: full effect at the contralateral C-channel (C4 for left hand, C3 for right hand), 0.6x at neighbouring channels (C2/CP4/FC4 for C4; C1/CP3/FC3 for C3), 0.25x at Cz, 0 elsewhere. ERD lasts until the end of the epoch.
  - Artifacts: on 8% of trials, add an eye-blink-like pulse (150 ms Gaussian, 80 uV) to frontal channels Fz, FC1, FCz, FC2 only.
  - Trial-to-trial variability (random mu amplitude 0.6x to 1.4x) so that a bad window or bad channel choice visibly lowers separability.
- Target: with the default pipeline (window 0 to 2 s, motor-strip channels, band 8 to 30 Hz, CSP, LDA) 5-fold CV accuracy lands between 0.70 and 0.90. If it does not, tune the generator, not the display.

### 3.4.2 Preset `erp_p300` (synthetic generator `make_erp_p300()`, seed 7)
- Classes: "non-target", "target" (balanced for simplicity, 200 trials, 100 per class; the README notes that real oddball data is imbalanced). Event label "stimulus". sfreq 250 Hz; epoch from tmin -0.2 s, 250 samples (to +0.796 s). Baseline -0.2 to 0 s. Zone 0.25 to 0.6 s, label "typical P300 zone". Default window 0.1 to 0.6 s. Default band 1 to 12 Hz, order 4.
- Channels (8): Fz, Cz, Pz, Oz, P3, P4, PO7, PO8.
- Window presets: "Full epoch", "P300 window 0.25 to 0.6 s", "Early 0 to 0.25 s (control)", "Baseline -0.2 to 0 s (control)". Band presets: "ERP band 1-12 (default)", "Delta/theta 1-7", "Alpha 8-13 (control)", "Broad 1-30". Channel presets: "Midline (Fz, Cz, Pz)", "Parietal-occipital (Pz, P3, P4, PO7, PO8, Oz)".
- Probe: x = Cz mean amplitude; y = Pz mean amplitude (over the current window). Map metric: class separability of mean amplitude. Key bands: none. Default feature: `window_means` (50 ms bins, baseline correction on). Recommended: `window_means`, `time_stats`, `covariance`. Wavelet range 2 to 12 Hz.
- Hints: page 2 "The P300 response peaks about 0.3 to 0.5 s after the stimulus."; page 3 "Midline central and parietal sites (Cz, Pz) carry the P300."; page 4 "Most ERP energy is below about 12 Hz."
- Facts: rule 4 (b).
- Generator: pink noise about 10 uV RMS; occipital alpha 10 Hz with random phase, about 6 uV at Oz, PO7, PO8, P3, P4 and about 2 uV elsewhere (not time-locked); an early visual response in every trial (a negative Gaussian at 0.17 s, sigma 0.03 s, -3 uV at Oz, PO7, PO8 and -1 uV elsewhere); for target trials only, a positive Gaussian P300 with centre drawn per trial uniformly between 0.30 and 0.45 s, sigma 0.06 s, amplitude 6 uV at Pz, 5 at Cz, 4 at P3 and P4, 3 at Fz, 1.5 at Oz, PO7, PO8, multiplied by a random per-trial factor between 0.5 and 1.5; eye-blink pulses (150 ms Gaussian, 80 uV) on Fz only in 8% of trials.
- Target: with the default pipeline (window 0.1 to 0.6 s, all 8 channels, band 1 to 12 Hz, `window_means`, LDA) 5-fold CV accuracy lands between 0.70 and 0.90.

### 3.4.3 Preset `ssvep` (synthetic generator `make_ssvep()`, seed 7)
- Classes (K = 4): "8 Hz", "10 Hz", "12 Hz", "15 Hz" with `stimulusFrequencies` [8, 10, 12, 15]; balanced, 160 trials, 40 per class. Event label "stimulus onset". sfreq 250 Hz; epoch from tmin 0 s, 500 samples (to 1.996 s). No baseline. Zone 0.5 to 2.0 s, label "steady-state zone". Default window 0.5 to 2.0 s. Default band 6 to 40 Hz, order 4.
- Channels (8): O1, Oz, O2, POz, PO3, PO4, PO7, PO8.
- Window presets: "Full epoch 0 to 2 s", "Steady state 0.5 to 2 s (default)", "Early 0 to 0.5 s (control)", "Late 1 to 2 s". Band presets: "Stimulus range 6-40 (default)", "Low 6-20", "Alpha 8-13 (control)", "Wide 4-40". Channel presets: "Occipital (O1, Oz, O2)", "Parieto-occipital (POz, PO3, PO4, PO7, PO8)".
- Probe: x = Oz log band power 7.5-8.5 Hz; y = Oz log band power 11.5-12.5 Hz. Map metric: spectral SNR at the stimulus frequency, class map for class 0. Key bands: none (the stimulus frequencies and their second harmonics are marked on the Page 4 axis). Default feature: `band_power` with, for every class frequency f, the bands [f - 0.5, f + 0.5] and [2f - 0.5, 2f + 0.5]. Recommended: `band_power`, `spectral_features`, `covariance`. Wavelet range 6 to 30 Hz.
- Hints: page 2 "The response builds up over the first few hundred milliseconds."; page 3 "Occipital sites (O1, Oz, O2) carry the response."; page 4 "Look for peaks at the stimulus frequency and its second harmonic."
- Facts: rule 4 (c).
- Generator: pink noise about 10 uV RMS; occipital alpha 10 Hz with random phase, 3 uV at Oz, O1, O2 and 1.5 uV elsewhere (the same in every class); for a trial of class k with frequency f_k and each channel, a response A_ch x s x ramp(t) x [sin(2 pi f_k t + phi1) + 0.4 sin(2 pi 2 f_k t + phi2)] with A_ch = 4 uV at Oz, 3 at O1, O2, POz, 2.5 at PO3, PO4, 2 at PO7, PO8; s drawn per trial uniformly between 0.5 and 1.5; phi1 and phi2 random per trial; ramp(t) a smooth rise from 0 to 1 over the first 0.15 s. No artifacts.
- Target: with the default pipeline (window 0.5 to 2 s, occipital channels, band 6 to 40 Hz, default feature, LDA) 5-fold CV accuracy lands between 0.75 and 0.97 (chance 0.25).

# 4. VISUAL DESIGN SYSTEM
- Background cream #F6F1E7. Panel surfaces #FBF8F1. Ink (text, lines) #1F1B16. Secondary text warm grey #7A7266. Hairlines 1 px #D9D1C0. Soft shadow only on floating panels: 0 6px 24px rgba(31,27,22,0.08).
- Fonts: headings in a refined serif (Fraunces, fallback Georgia). Labels, numbers and badges in a monospace (JetBrains Mono). Body in a clean sans (Inter). All self-hosted (section 2.1).
- One accent colour per class (section 3.0), one selection accent. No other saturated colours. No gradients except the heat overlays (which use a single-hue ramp from cream to the relevant class colour or to ink-blue).
- Only the thing that matters on the current page moves with intent. Ambient motion (idle drift of pieces by +-1.5 px, 8 s period) is very slow and low contrast, and can be paused.
- Every page shows, top-left, a page title (serif, 28 px) and a one-line plain-English caption (sans, 15 px) saying WHAT the step does and WHY it matters. Exact captions:
  1 "Load your EEG recording: trials x channels x samples."
  2 "Choose the time window where the brain's response lives."
  3 "Choose which electrodes to keep. Different tasks live at different scalp sites."
  4 "Keep only the frequency band that carries the effect."
  5 "Pick how to turn each trial into numbers a classifier can use."
  6 "Reshape the numbers so features are comparable and well-behaved."
  7 "The final table the classifier sees: one row per trial, one column per feature."
  8 "Your whole pipeline as a script you can run."
  Under the caption of pages 2, 3 and 4, show the active preset's one-sentence hint (section 3.4) in small secondary text, if there is one.
- Layout: ONE PixiJS canvas fills the window except a 320 px right-hand controls panel (collapsible). The bottom 56 px of that canvas is the pipeline rail zone (section 8); the rest is the stage. Min supported width 1280 px; at narrower widths the controls panel becomes a bottom drawer.
- Layer order on the canvas (back to front): decor-back, ribbon and env, strip and dot, val and sine and wave, electrode and spark, card and chip and rail, decor-front (prism, tooltips). Moving pieces never change layer during a transition.

# 5. THE ENGINE (the heart of the app, implement first and test with dummy layouts)

## 5.1 Piece registry
- A `Piece` has: `id` (string, permanent), `kind` (see below), `group keys` (trial index, channel index, feature index, class), and a visual state: x, y, w, h, rotation, scaleX, scaleY, alpha, colour (RGB), cornerRadius, and `shape` in {line, ribbon, rect, circle, dot}. Internally the state is stored per section 2.3 (typed arrays indexed by piece number); `id` maps to the index.
- Pools. Because datasets differ in size, pieces are allocated ONCE at startup as fixed pools with permanent slot IDs, and a deterministic mapping table (part of `ctx`) assigns slots to (trial, channel, feature, ...) whenever data or settings change. Unassigned slots are parked. Loading a different dataset reuses the same pools (no creation or destruction).
  - `ribbon:{slot}` : pool of 2,400, assigned to (trial, channel). Displayed trials = min(n_trials, floor(2400 / n_channels), 200), chosen as a stratified subsample by class and kept in original order. If displayed trials < n_trials, show the tag "showing M of N trials". The backend always uses all trials.
  - `env:{slot}` : pool of 200, one mean-across-channels absolute-amplitude envelope ribbon per displayed trial (Page 2 only; parked elsewhere).
  - `strip:{slot}` : pool of 4,800, two per displayed ribbon (left and right outside-window strips; Page 2). Simple tinted quads.
  - `dot:{slot}` : pool of 200, one marker per displayed trial, used for the Page 2 probe scatter.
  - `electrode:{slot}` and `spark:{slot}` : pools of 128, assigned to channels.
  - `sine:{k}` : spectrum components (k = 0..n_bins-1; 0.5 Hz bins from 1 Hz to the frequency-axis maximum; at most 90 pieces) used on Pages 3-5.
  - `wave:raw` and `wave:filtered` : two ribbon meshes for the example waveform on Page 4 and the hovered-trial strip on Page 7.
  - `card:{family}` : the 12 feature-family cards (Page 5). Family IDs: `band_power`, `csp`, `hjorth`, `wavelet`, `covariance`, `time_stats`, `window_means`, `spectral_features`, `tf_regions`, `asymmetry`, `complexity`, `autoencoder`.
  - `val:{slot}` : grains (Page 6) and matrix cells (Page 7) are the SAME pieces under different layouts. Pool of 4,000. A deterministic table maps (trial, feature) to a slot with index = feature * trials_shown + trial_rank, where trials_shown = min(n_trials, floor(4000 / n_features)). When there are more cells than 4,000, subsample trials (stratified by class), never features. The complete matrix always stays on the backend.
  - `chip:{page}` : the 8 settings chips (Page 8).
  - `rail:{node}` : the miniature object in the pipeline rail (section 8).
  - `decor:{page}:{name}` : stage artwork that is not data (axes, head, basket, gauges and so on). Each decor item has springs for `alpha` and `reveal` (0..1, how much of its stroke is drawn). Registered decor names: page 1 `droptext`; page 2 `axis`, `cue`, `zone`, `frame`, `minimap`; page 3 `head`, `nose`, `ears`, `cap`, `mesh`, `scalp`, `heat`, `links`, `legend`, `tray`; page 4 `axes`, `bands`, `gate`, `fill`, `handles`, `wavepanel`, `prism`; page 5 `basket`, `odometer`; page 6 `histaxis`, `guides`, `ghost`, `meanticks`; page 7 `rowstrip`, `colheads`, `brackets`, `gauge`, `race`, `leak`, `views`; page 8 `codepanel`.
- Pieces and decor not needed on a page are not destroyed: by default they shrink to scale 0.0, alpha 0 and park at a "holding point" (the nearest edge of the stage) with their last colour kept, so they can come back by springing out. A layout may override the parking position (`parkAt`) to give the exit a meaning, as Section 5.7 does.

## 5.2 Layout functions
- Each page is exported as a pure function `layout(ctx) => Map<pieceId, TargetState>` where `ctx = {data, paradigm, settings, ui, stageSize, backendResults, slots}`. `ui` holds ephemeral view state that is not part of the hashed settings (card grid scroll offset, card category filter and search text, Page 7 view tab and column offset, Page 8 export phase). `slots` holds the pool mapping tables. The function must NOT read the previous page or the current piece positions. It must return a target for EVERY piece id and decor id (write a unit test that checks this for all 8 pages with default settings, for every preset and for a custom dataset).
- Because layouts are pure, navigation is free: Load -> Export directly must work. Pieces simply spring from wherever they currently are.

## 5.3 Springs (not timelines)
- Each animated property of each piece (x, y, w, h, rotation, scaleX, scaleY, alpha, colour channels, plus `reveal` for decor and `uWinStart` and `uWinEnd` for ribbons) has its own spring: `position, velocity, target`. Integrate with semi-implicit Euler at a fixed 1/120 s substep.
- Default spring ("standard"): stiffness 170, damping 22 (slightly under-damped, about 1 percent overshoot), mass 1. Other flavors are defined in 5.3a.
- If the user clicks another page mid-transition, only `target` values are replaced. Velocity and position are kept. No restart, no jump, no reset of delays: a piece that is still waiting on its stagger delay simply gets the new target when its delay ends.
- Alpha, colour and `reveal` use a critically damped spring (damping = 2*sqrt(stiffness)) so they never overshoot out of range. Clamp alpha and reveal to 0..1.
- A piece is "settled" when |velocity| < 0.01 and |position - target| < 0.05 for 10 consecutive substeps. Stop updating settled pieces. The ticker pauses entirely when all pieces are settled and ambient motion is paused.
- There are no fixed-duration tweens anywhere in the app. Every timed-looking effect (stroke draw-on, fade, pop) is a spring on `reveal`, `alpha` or `scale`.

## 5.3a Spring flavors and waypoints
Flavors (stiffness, damping): `standard` (170, 22); `soft` (110, 19) for large sweeping moves; `snappy` (260, 29) for small UI-like moves, dragging and in-page changes; `fall` (55, 7) for gravity-like tumbling with one small bounce; `reveal` (90, critically damped) for decor draw-on. A transition table (section 5.7) assigns a flavor per piece kind.

Waypoints (a "via" pose): a transition may give a pure function `via(ctx, piece) => TargetState | null` for some piece kinds. The piece first springs toward its via pose, and the engine switches its target to the final pose when EITHER the piece has covered 70 percent of the distance to the via pose in every property the via pose sets, OR `viaMaxMs` (default 260 ms) has passed since the piece's own delay ended, whichever comes first. A via entry may also set `viaMinHoldMs` (used for the prism) so a decor item stays in its via pose for at least that long. If the user navigates again before a piece has switched, its via pose is dropped and it heads straight for the new final pose, keeping its velocity. Waypoints are used for forward adjacent transitions only; they are skipped for backward moves, non-adjacent jumps, in-page changes and reduced motion.

## 5.4 Stagger by meaning
Each transition declares a stagger plan: `groupBy` (channel | trial | feature | class | frequency), `order` (ascending | by-electrode-posterior-to-anterior | by-effect-strength | by-feature-rank), `delayPerGroupMs` (default 18 ms), `maxTotalDelayMs` (default 700 ms). Delay for a piece = rank(group) * delayPerGroupMs + the per-kind `offsetMs` from Section 5.7, with the rank part clamped to maxTotalDelayMs. Unpositioned channels rank after all positioned channels, in tray order. Exact stagger plans:
- 1->2: groupBy trial, ascending, 8 ms.
- 2->3: groupBy channel, order by-electrode-posterior-to-anterior, 30 ms.
- 3->4: groupBy channel, ascending, 12 ms, then sine pieces by frequency ascending, 6 ms.
- 4->5: groupBy feature (card), ascending, 60 ms (with 12 cards the rank part is 720 ms before clamping to 700).
- 5->6: groupBy feature then trial, 40 ms per feature, 3 ms per trial.
- 6->7: groupBy trial, ascending, 4 ms.
- 7->8: groupBy trial, ascending, 3 ms, maxTotalDelay 500 ms.
- Any other jump (non-adjacent): groupBy class then trial, 4 ms per trial, maxTotalDelay 500 ms.
- Backward transitions use the same plan reversed.

## 5.5 Slow camera
- A single camera container wraps the stage: scale, rotationX (fake tilt via a skew/perspective matrix, max 4 degrees), translate. During a transition the camera zooms to 1.06 and tilts 2.5 degrees over the first 40% of the longest group delay and eases back to 1.0 / 0 degrees via its own critically damped spring (stiffness 40). Direction of the tilt: forward navigation tilts away from the viewer top-first, backward reverses. Camera does nothing while the user is dragging a control and does nothing for in-page changes.

## 5.6 Reduced motion
- Honour `prefers-reduced-motion: reduce` on load, and provide a toggle "Reduce motion" in settings. When on: stiffness 400, damping 40 (fast), delayPerGroupMs 0, per-kind offsets 0, waypoints skipped, camera disabled, ambient drift disabled, continuous effects (rising gate, odometer, typing code, draw-on) replaced by instant updates with a 150 ms alpha crossfade.

## 5.7 Page transition choreography (normative)

### 5.7.1 How a transition runs
1. Navigation to page B computes `layout_B(ctx)` (final poses for every piece and decor item) and looks up the transition definition for (A, B) in `src/engine/transitions.ts`. That table is separate from the layouts so layouts stay pure.
2. Each piece gets a delay = group rank x the stagger rate + its kind offset (the "offset" below, in ms from the moment of navigation, added to the stagger delay of its group). Until its delay ends a piece keeps its current targets.
3. When the delay ends, the piece takes its flavor, its optional via pose, and then its final pose (rule in 5.3a). Alpha, colour and reveal always use critically damped springs.
4. The camera pulse (5.5) starts at navigation time.
5. Every transition should look complete within about 1.8 s of navigation. The tables below are the design budget; if a build takes visibly longer, shorten the per-kind offsets, not the springs.
6. A page's own in-page animations (dragging the window, toggling an electrode, choosing a transform) use the `snappy` flavor with no stagger, no via and no camera.

### 5.7.2 Forward transitions (adjacent pages)
Notation: "offset" is in ms. "Final" is the page layout pose. Unlisted pieces keep default parking. Class colours always stay on trial-specific pieces.

**1 -> 2 (Load -> Window): "fan out and line up"**
- `ribbon` (flavor soft): via = fan pose: each trial's ribbons keep their stack position but rotate about their own centre by (rank - median rank) x 0.1 degrees, clamped to +-5 degrees. Final = the Page 2 band: all channel ribbons of a trial overlap in the trial's band row (rows sorted by class order, class 0 on top) at alpha 0.05, scaleY set so traces fill the band, rotation 0. Because trials are re-sorted by class, ribbons visibly cross each other as they take their rows.
- `env` (flavor standard, offset 180): start parked inside their band with scaleY 0 and alpha 0; final alpha 0.9, scaleY 1, growing in place.
- `strip` (flavor standard, offset 150): start at the band edges with alpha 0; final = 4 px strips at each band edge (alpha 0.4, desaturated).
- `dot` (flavor standard, offset 400, extra 3 ms per trial): start parked at the bottom-right corner of the stage with scale 0; final = their probe positions inside the 160 x 160 mini-plot, 4 px markers.
- `decor`: `axis` reveal 0 to 1 (offset 0, drawn left to right), `cue` reveal (offset 200, drawn top to bottom, dashed; only if t = 0 is inside the epoch), `zone` alpha 0 to 0.18 (offset 250; only if the preset has a zone), `frame` alpha and scaleY from 0 to 1 (offset 300, handles fade in at offset 450), `minimap` frame and labels alpha (offset 350). `droptext` alpha to 0 (offset 0, snappy).
- All other pieces stay parked.

**2 -> 3 (Window -> Channels): "peel off and land on the head"** (stagger by channel, posterior to anterior)
- `decor` of Page 2 (`axis`, `cue`, `zone`, `frame`, `minimap`) and all `dot`, `env`: alpha 0 and scale 0 at once (flavor snappy, offset 0); dots shrink toward the mini-plot corner.
- `ribbon` of channel c (flavor soft): via = peel pose: the ribbons of that channel (one per displayed trial) move up 16 px and drop to alpha 0.5; final = collapse onto the position of electrode c (or its tray slot if unpositioned) at scale 0 and alpha 0. Because all ribbons of a channel share one stagger group, each channel's bundle peels off together, back of the head first.
- `strip` (flavor soft, no via): converge to the position of their channel's electrode and fade to alpha 0.
- `electrode` (flavor standard, offset 220 after the channel's delay): start at their final position with scale 0; pop to full size (a slight overshoot is expected). Included and excluded states take effect immediately in the final pose.
- `spark` (flavor standard, offset 300 after the channel's delay): included channels only; start at scaleX 0 anchored left, alpha 0; final scaleX 1, alpha 1.
- `decor`: `head` reveal (offset 150, the circle is drawn clockwise from the top), `scalp` alpha (offset 300), `cap` reveal (offset 400), `nose` and `ears` pop by alpha and scale (offset 450), `mesh` reveal (offset 520), `heat` alpha to the opacity setting (offset 600), `links` alpha (offset 700), `legend` alpha (offset 700), `tray` alpha (offset 450; only if there are unpositioned channels).

**3 -> 4 (Channels -> Frequency): "waveforms merge, pass through a prism, split into sines"** (stagger by channel 12 ms, then sine pieces by frequency 6 ms)
- `electrode` and Page 3 decor (`head`, `nose`, `ears`, `cap`, `mesh`, `scalp`, `heat`, `links`, `legend`, `tray`): shrink and fade at once (flavor snappy, offset 0; reveal values unwind).
- `spark` of included channels (flavor soft): via = waveform pose: stretch horizontally to 60 percent of the stage width, stacked in rows 14 px apart around the stage centre (compressed to fit if there are many channels), alpha 1. Final = merged stream: every spark collapses onto the centre line at the prism entrance, at alpha 0, so the stretched waveforms are seen converging into one stream.
- `decor:4:prism`: via = reveal 1 and alpha 1 (offset 260, `viaMinHoldMs` 400); final = alpha 0. The prism is a small outlined triangle at the stage centre.
- `sine` (flavor soft for position, standard for scaleY; offset 520 plus 6 ms per frequency rank): start parked at the prism exit with scaleY 0; spread outward to their x positions on the landscape while their heights rise to the PSD values. Bars are ink-coloured; there is no rainbow.
- `decor`: `axes` reveal (offset 600), `bands` alpha (offset 750), `fill` alpha (offset 850), `gate`, `handles`, `wavepanel` alpha (offset 900). `wave:raw` and `wave:filtered` grow from scaleY 0 (offset 950).

**4 -> 5 (Frequency -> Features): "the raised band lifts off and splits into the feature cards"** (stagger by card, 60 ms)
- `sine` outside the selected band (flavor snappy, offset 0): flatten to scaleY 0 and alpha 0 in place.
- `sine` inside the band (flavor soft): via = lift pose: up 36 px, alpha 1. Final = fly to the slot of an assigned card (bar i of the band, sorted by frequency, goes to visible card i mod number of visible cards) at scale 0 and alpha 0.
- `decor` and `wave` of Page 4 (`axes`, `bands`, `gate`, `fill`, `handles`, `wavepanel`, `wave:raw`, `wave:filtered`): alpha 0 and scaleY 0 (flavor snappy, offset 0).
- `card` (flavor soft, offset 120 plus rank x 60): start parked at the centre of the lifted band at scale 0.3 and alpha 0; final = grid slot (or the basket slot if already selected).
- `decor:5:basket` slides in from 80 px to the right with alpha 0 to 1 (offset 400); `odometer` alpha (offset 600).

**5 -> 6 (Features -> Transform): "tiles tumble and pile up like sand"** (stagger by feature 40 ms, then by trial 3 ms)
- On Page 5, the `val` pieces of selected features rest inside the basket as tiny tiles (scale 0.15, ink at alpha 0.6, loosely stacked). If no feature is chosen the preset's default feature is used.
- `val` (flavor fall): via = lift and spread: up 48 px with a deterministic jitter taken from a hash of the slot index, over the first 40 percent of the fall. Final for the inspected feature = histogram grain position (x from the bin, y from the stack height) in class colour, alpha 0.7. Final for the other features = fall to the baseline below the histogram, then alpha 0 and scale 0 (they dissolve on landing).
- `card` not in the basket (flavor snappy, offset 0): shrink to scale 0 at their slot. `card` in the basket: shrink to scale 0 inside the basket (flavor snappy, offset 150).
- `decor`: `basket` and `odometer` alpha 0 (flavor snappy, offset 150); `histaxis` reveal (offset 300); `guides` alpha (offset 500); `meanticks` alpha (offset 700); `ghost` stays at alpha 0 until a transform is applied.

**6 -> 7 (Transform -> Matrix): "piles collapse into rows of a table"** (stagger by trial, 4 ms)
- `val` of the inspected feature (flavor soft): move from grain positions to their cell positions in the row of their trial (rows sorted by class order), colour spring from class colour to the heat ramp value, alpha 1.
- `val` of the other features (flavor standard, offset 150 plus 6 ms per column): start at their own cell position at scale 0; pop to cell size, so the matrix unrolls from left to right.
- `decor`: `histaxis`, `guides`, `meanticks`, `ghost` alpha 0 (flavor snappy, offset 0); `rowstrip` reveal along the left edge (offset 300); `colheads` alpha (offset 350 plus 6 ms per column); `brackets` reveal (offset 500); right-panel instruments `gauge` (offset 450), `race` (offset 550), `leak` (offset 650) and `views` (offset 450) slide 24 px in from the right while fading in.

**7 -> 8 (Matrix -> Export): "every row dissolves into the settings chips"** (stagger by trial, 3 ms, max 500 ms)
- `val` (flavor soft): via = row collapse: the cells of one row converge horizontally to the row's centre (scaleX to 0.1, alpha 0.8). Final = travel to the chip assigned to that row (chip index = trial rank mod 8) at scale 0 and alpha 0.
- `decor` of Page 7 (`rowstrip`, `colheads`, `brackets`, `gauge`, `race`, `leak`, `views`): alpha 0 (flavor snappy, offset 0). Any secondary view (correlation, scree, density, PCA scatter) fades with `views`.
- `chip` (flavor standard, offset 260 plus 70 ms x page index): start parked at the matrix centre at scale 0.2 and alpha 0; final = left-column slot, scale 1, alpha 1 (a slight overshoot is expected).
- `decor:8:codepanel` reveal (offset 700).
- Page 8 has two settled states controlled by `ui.exportPhase`: `chips-left` (on arrival) and `chips-in-panel`. The app switches to `chips-in-panel` 400 ms after the chips settle; the chips then fly into the code panel (flavor soft, 120 ms stagger by page order) and the typing starts when the last chip arrives. Leaving and returning to Page 8 resets the phase to `chips-left`.

### 5.7.3 Backward and non-adjacent navigation
- Backward (B < A): use the forward definition of (B, A) in reverse: stagger order reversed, all per-kind offsets mirrored (decor that appeared last disappears first), flavor `soft` for all pieces, no via poses, and the camera tilt reversed.
- Non-adjacent (for example 1 -> 6): no via poses, flavor `soft`, group by class then trial at 4 ms per trial (max 500 ms), decor and unused pieces fade with `snappy` at offset 0, and entering decor appears at offset 300.
- Initial app load shows Page 1 in its empty state without a transition (all pieces start at their Page 1 targets).

### 5.7.4 Page 1 internal states (empty -> loaded, loaded -> loaded)
- Triggered by the dataset becoming loaded or being replaced; the page layout depends on `data.status` (empty or loaded).
- CSV drop or NPZ load: the flat line of collapsed ribbons draws itself left to right (`reveal`-style spring, about 600 ms), then the ribbons thicken (spring to height) from the line pose into the stack (flavor soft, stagger by trial 8 ms). The shape badge fades in when the last trial settles.
- "Pour sample data": ribbons start above the stage top edge; via = above the stage; final = the stack; flavor fall; stagger by trial 8 ms. The badge appears when settled.
- Replacing a loaded dataset: the old stack lifts off the stage top (flavor soft) while the new one pours in as above; pools are reused, no pieces are created or destroyed.

### 5.7.5 Interruption and consistency rules
- Navigating mid-transition only replaces targets; positions, velocities and pending delays are kept (5.3). Via poses are dropped (5.3a).
- After everything settles, the positions must equal the layout of the final page within 0.5 px regardless of the route taken (direct jump, step-by-step, or interrupted route). This is tested (section 11).
- No piece may leave the stage by more than 5 percent of the stage size during a transition other than when it is parking off-stage on purpose.

# 6. THE PAGES

General rules for all pages: the stage shows the pieces; the right controls panel (React) holds sliders/buttons/toggles; all controls are keyboard-operable. Whenever a control changes a setting, call the backend (debounced 120 ms, cancel in-flight stale requests with AbortController, cache by settings hash) and the pieces spring to the new layout. The shape badge (mono font, pill, top-right of stage) always shows the real current shape of the data object at that page, in the form `trials x channels x samples` or `trials x features`. A paradigm tag in the top bar shows the active preset name or "Custom".

## PAGE 1: LOAD DATA
Empty state:
- A single flat horizontal line (ink, 1 px, 60% of stage width, vertically centred) with the text "Drop a CSV here, or pour the sample data" beneath. The line is made of the ribbon pieces collapsed to zero height and laid end to end.
- Buttons and controls: "Choose file...", "Pour sample data" with a dropdown "Sample: Motor imagery / P300 (ERP) / SSVEP", "Download example CSV" (for the selected sample), "Load upstream NPZ", and the fields from section 3.2 (sampling rate, tmin, baseline start and end, montage, "Interpret as").
Behaviour on CSV drop, NPZ load and "Pour sample data": see Section 5.7.4.
- The stack is about 520 px tall and 70% wide. A shape badge appears, for example `100 x 22 x 750` (computed).
Visual rule on this page: each trial ribbon is tinted by its class colour at 35% alpha with the trace in ink. Hovering a ribbon highlights it and shows a tooltip such as "Trial 12, left hand" (the class name from the data).
Panel: dataset summary (n trials, n channels, sfreq, epoch length, tmin, baseline, class names with colour swatches and counts), Input provenance readout (section 3.3), an info popover with the preset's `facts` string (only for presets), and the editable fields above.
Leaves for Page 2: transition 1 -> 2 in Section 5.7.2.

## PAGE 2: TIME WINDOW
Layout:
- Trials stacked as thin horizontal bands (one per displayed trial, class-coloured at 35%, sorted by class order with class 0 on top and a thin gap between class groups). Each band shows its trial's `env` piece (the mean-across-channels absolute-amplitude envelope, smoothed, display only) at alpha 0.9, with the trial's channel ribbons overlaid faintly (alpha 0.05) behind it. A shared time axis along the bottom follows the rules in section 3.1.
- An event marker: vertical dashed line at t = 0 labelled with the preset's `eventLabel` (default "event"), drawn only if t = 0 lies inside the epoch.
- A response-zone band (only if the preset defines a `zone`): a translucent selection-accent rectangle spanning the zone, labelled with its `label` in small caps. This is a static guide taken from the preset, not a computed result.
- A draggable window frame (the selection). Default = the preset's `defaultWindow` (the full epoch for custom data). Draggable by both edges (resize) and by its body (move). Snap and minimum width per section 3.1. Also two numeric inputs in the panel: start (s) and end (s), synced with the frame.
Effect of the window:
- Samples OUTSIDE the frame are hidden from the ribbons (shader window uniforms) and compress horizontally into thin `strip` quads (width = 4 px each side, alpha 0.4, desaturated) at the left and right edges of each band. Samples INSIDE brighten (alpha 0.9) and widen to fill the free space. Nothing disappears from the data.
- Shape badge updates live, for example 100 x 22 x 750 -> 100 x 22 x 500 (the real cropped array shape).
Probe mini-plot (bottom-right, 160 x 160 px):
- A tiny scatter of each displayed trial as a `dot` (class colour and class marker). The x and y axes are the two probe features of the preset (section 3.4; for custom data the first two selected channels' log band power in the Page 4 band), computed by the backend for the current window. Dropdowns in the panel let the user change each probe feature's channel, type (log band power or mean amplitude) and band. A dotted diagonal line y = x is drawn. When the window is good the classes separate into clouds; when the window contains no class information the clouds merge.
- Beside it a number: "separability" = cross-validated accuracy of LDA on those two features, shown as a percent with the chance level. Computed by the backend on every window or probe change.
Panel: window presets from the preset (plus "Full epoch" and, when a baseline exists, "Baseline only (control)"). Button "Reset window".
Leaves for Page 3: transition 2 -> 3 in Section 5.7.2.

## PAGE 3: CHANNELS (specified in detail)
Stage layout: a large top-down head map centred on the stage, about 440 px diameter (380 px when a tray is shown), nose pointing UP.
The head drawing (all vector, ink 1.5 px lines on cream, drawn in code, no image files unless a `design/` folder supplies SVGs per section 2.8):
1. Head outline: a circle.
2. Nose: a small triangle at the top (12 px wide, 14 px tall).
3. Ears: two small half-ellipses on the left and right sides (10 x 28 px), at the vertical middle of the head.
4. An EEG CAP: draw the cap as a second slightly larger (about 4 px outside) circle in a soft taupe (#CBBFA6, 3 px), plus a thin chin-strap hint at the bottom and a faint mesh of two plain geometric curves (the nose-to-back midline arc and the ear-to-ear arc, drawn as thin taupe curves 1 px, alpha 0.5, with no markers and no labels, so they cannot be mistaken for electrodes). The goal is that it looks like a head wearing an electrode cap, viewed from above.
5. Scalp is filled with cream-white (#FFFDF7) and a very subtle radial fade, no gradients that fight the cream.
Electrode positions (computed by the backend in `montage.py`, sent to the frontend as `positions`, never hand-typed):
- Get the 3-D positions from the PUBLIC MNE API: `mne.channels.make_standard_montage(<chosen montage>)` and `montage.get_positions()['ch_pos']`. Do NOT call any private MNE function (anything starting with an underscore). If the NPZ supplies `ch_pos`, use it instead.
- Project to 2-D yourself with an azimuthal-equidistant projection: take each position as a vector v from the head centre (use the origin of the montage's head coordinate frame, or the centre of a sphere fitted to all montage points), let `r = arccos(v_z / |v|) / (pi / 2)` and `phi = atan2(v_y, v_x)`, then `pos = (r cos(phi), r sin(phi))`. In MNE head coordinates +x points to the right ear and +y to the nose, so the nose is +y and the left hemisphere is on the left of the screen. Scale so the head circle radius is 1.
- Write a pytest sanity check with tolerance 0.1 (for the `standard_1005` montage): Cz about (0, 0); Fz about (0, +0.5); Pz about (0, -0.5); C3 about (-0.4, 0); C4 about (+0.4, 0).
- Draw every dataset channel that has a position as a selectable circle (radius 15 px, shrinking to radius 11 px when there are more than 40 channels, with the channel name in mono 10 px just inside or below; labels are hidden below 3 px per rule in 2.3 and shown on hover). Channels without a position are drawn as selectable chips in a tray row (`decor:3:tray`) under the head, in data order. Nothing else is drawn as an electrode: see "Electrode layout and presets (normative)" below.
Interaction:
- Clicking an electrode (or tray chip) toggles it included / excluded. Keyboard: Tab moves between electrodes in posterior-to-anterior then left-to-right order (tray chips last, in tray order), Space or Enter toggles. A tooltip on hover shows: name, region, included status, and its map value with unit (see effect map). Region is derived from the channel name prefix: Fp, AF, F -> frontal; FC, C, CP -> central; FT, T, TP -> temporal; P, PO -> parietal; O -> occipital; anything else -> other.
- Excluded electrode: shrinks to radius 7, drains colour (fills grey #CFC8B8, label alpha 0.4), its sparkline fades out.
- Included electrode: glows (soft ring in the selection accent, 6 px, alpha 0.5), full radius, and draws thin selection-accent link lines (1 px, alpha 0.5) to its nearest included neighbours (k = 2 nearest by head distance), so selected electrodes visibly form a connected net.
- Marquee selection: drag on empty scalp area to draw a rectangle that selects all electrodes inside it (hold Shift to add, Alt to remove).
- Counter in the panel: "{n} of {N} channels selected", and the shape badge updates live (e.g. 100 x 3 x 500). At least one channel must stay selected; clearing everything shows an inline message and blocks downstream pages.
Sparklines:
- Inside / beside each INCLUDED electrode, a live sparkline (60 x 20 px) of that channel's signal: one thin trace per shown class, in class colour, each the mean over the trials of that class within the chosen window. Control "Show classes" is a set of toggle chips (one per class, all on by default). Excluded electrodes show no sparkline.
Effect map (heat overlay):
- A smooth interpolated heat map across the scalp (use the positioned channels' 2-D positions, interpolate with scipy `griddata` or RBF to a 64 x 64 grid computed by the backend, then drawn as a texture clipped to the head circle) of one per-channel metric chosen by the control "Map metric" (default from the preset). Channels without a position appear in the tooltip and tray but not in the interpolation. The map is under the electrodes and can be toggled ("Show effect map", default on, opacity slider 0..100, default 70). Each metric shows a small colour-bar legend with its name and unit. Metrics:
  1. **Band-power change vs baseline (%)** (available only when a baseline exists): for the chosen band (default from the preset, otherwise the Page 4 band), 100 x (P_window - P_baseline) / P_baseline, averaged over the trials of the chosen class. A negative value means a decrease (ERD) and a positive value an increase (ERS). The map shows the strength of the decrease (increases are clipped to 0, and the legend says so). Ramp: cream to that class's colour.
  2. **Class separability of band power**: per channel, the one-vs-rest macro average of |AUC - 0.5| x 2 of log band power in the chosen band over the window (0 to 1). Ramp: cream to the selection accent.
  3. **Class separability of mean amplitude**: the same score computed on the mean amplitude over the window.
  4. **Spectral SNR at a frequency (dB)**: per channel, 10 log10 of the PSD at the target frequency divided by the mean PSD of the bins 1 to 2 Hz away on each side (Welch with 0.5 Hz bin spacing, over the window), averaged over the trials of the chosen class. The target frequency is the class's stimulus frequency (preset) or a number entered by the user. Ramp: cream to that class's colour.
  Control "Map for": each class name, or "Difference (A minus B)" with two class dropdowns (default A = last class, B = first class). It applies to metrics 1 and 4; for metrics 2 and 3 it is disabled with an explanation. For differences use a diverging ramp from class B's colour to class A's colour through cream.
- The point of the map is that the user can SEE which channels carry the effect, for whatever metric they choose.
Electrode layout and presets (normative):
- **The head shows only the dataset's own electrodes.** The number of electrode circles on the head plus chips in the tray is always exactly N, the number of channels in the loaded data. There are no hollow or placeholder circles, no unused 10-20 or 10-10 sites, and no sites taken from the montage that the dataset does not contain. A 32-channel dataset therefore shows a 32-electrode head, a 64-channel dataset a 64-electrode head, and any other N shows N electrodes. Electrode positions still come from the chosen montage by channel name (section above); the montage only supplies coordinates, never extra electrodes.
- **Layout tag:** a small mono tag under the head and in the panel reads "32-channel layout", "64-channel layout" or "{N}-channel layout". When some channels are unpositioned it adds "{p} on head, {u} in tray" (p + u = N).
- **Density (the head must stay readable at 64):** electrode radius = the base radius (15 px for N <= 40, otherwise 11 px) reduced if needed so that no two circles overlap (radius = min(base, 0.45 x the smallest centre-to-centre distance), never below 9 px). Name labels are mono 10 px for N <= 40 and 8 px for N > 40, and are hover-only whenever the radius is below 9 px. For N > 40 the head diameter may grow to 520 px if the stage height allows (the tray, if any, wraps onto several rows and scrolls inside a 90 px high area). When more than 16 electrodes are included, sparklines are drawn only for the hovered or keyboard-focused electrode (`ui.focusChannel`); the `spark` pieces of all other electrodes rest at alpha 0. Links (k = 2) and the effect map are unchanged.
- **Electrode presets** are buttons in a group labelled "Electrode presets". Each is a named collection of electrodes that replaces the current selection when clicked (Shift-click adds, Alt-click removes, the same convention as the marquee). The preset whose set equals the current selection exactly is shown as active. A preset never selects a channel that is not in the dataset. Selecting one updates the counter, the shape badge, sparklines, links and effect map exactly like manual toggles, with the `snappy` in-page flavor (no stagger, no via). The group has these rows:
  1. Basic: "All channels", "Clear", "Random (k)" with k = min(8, N).
  2. For the active paradigm preset: its `channelPresets` (section 3.4, shown only when all their channels exist), labelled "For {preset name}".
  3. Generic sets, defined in ONE file `backend/app/electrode_presets.json` (names only, never positions) and served by `GET /electrode-presets`, never duplicated in frontend code: "Standard 10-20 (19 sites)" = Fp1, Fp2, F7, F3, Fz, F4, F8, T7, C3, Cz, C4, T8, P7, P3, Pz, P4, P8, O1, O2; "Midline" = Fpz, Fz, FCz, Cz, CPz, Pz, POz, Oz. Name matching is case-insensitive and accepts the old names T3 = T7, T4 = T8, T5 = P7, T6 = P8. A generic set is shown when at least 3 of its channels exist in the data; it selects the channels that exist, and its button reads "(n of m)" when n < m.
  4. Computed sets (backend, `channels.py`, from the 2-D positions of the positioned channels only): "Left hemisphere" (x < -0.05) and "Right hemisphere" (x > +0.05), each shown when it has at least 3 channels; and "Evenly spread 8", "Evenly spread 16", "Evenly spread 32", each shown only when k < the number of positioned channels. Evenly spread uses deterministic farthest-point sampling: start from the positioned channel closest to the head centre, then repeatedly add the positioned channel whose distance to the already chosen set is largest (ties broken by data order). So a 32-channel dataset offers Evenly spread 8 and 16, and a 64-channel dataset offers 8, 16 and 32.
  5. Regions: the existing region quick-select buttons (one per region with at least two channels).
  Preset labels and tooltips are positional only (a list of sites and a count). They make no physiological claim (rule 4); only paradigm presets carry their own hint text.
- The dataset response includes `layout` {id, n_channels, label, n_on_head, n_in_tray} and `electrodePresets` [{id, label, row, channels, present, total}] already resolved against the loaded data by `channels.py`; the frontend only renders them.
Default selection on first visit: the preset's channel preset named by its default (otherwise "All channels"), with a small tag "using all channels" while all channels are selected and the user has not changed it.
Leaves for Page 4: transition 3 -> 4 in Section 5.7.2.

## PAGE 4: FREQUENCY BAND
Layout:
- A spectrum landscape: x axis frequency per section 3.1 (ticks every 5 Hz), y axis power (log, dB). The `sine` pieces are thin vertical bars (one per 0.5 Hz bin) whose heights form the power spectral density (Welch, `nperseg` = min(round(sfreq), n_samples), 50 percent overlap, `nfft` = 2 x `nperseg` so bins are 0.5 Hz apart; the real resolution is still set by the window length and the note "resolution limited by window length" is shown) averaged over the selected channels and the trials of the class shown, in the selected window. Draw one TASK curve per shown class (class colours; control "Show classes" as in Page 3) and, only if a baseline exists, a REFERENCE curve from the baseline interval in ink at alpha 0.5 (toggle "Show baseline", default on when a baseline exists). Where a class curve is below the reference curve, the gap is filled with that class's colour at 35% alpha.
- Named band regions (delta 0.5-4, theta 4-8, alpha 8-13, mu 8-12, beta 13-30, gamma 30-45, clamped to the axis) are available as light labelled bands; by default only the preset's `keyBands` are shown, with a toggle "Show all named bands". For presets with `stimulusFrequencies`, draw a thin vertical tick at each stimulus frequency and its second harmonic, labelled with the class name.
- Draggable band edges (two handles) define the band-pass. Default = the preset's `defaultBand`. Handles snap to 0.5 Hz. Min width 2 Hz. Numeric inputs for low and high in the panel. Filter order control (default 4, options 2 to 8). Filter type: Butterworth zero-phase (scipy `sosfiltfilt`), fixed. Show a one-line note "zero-phase Butterworth". If the window is too short for the filter padding, show an inline warning.
- Selected band: the bars inside it rise ("gate" effect): scaleY animated up 1.15x, full alpha. Bars outside flatten to 0.35x scaleY and alpha 0.35.
- Below the landscape (bottom 30% of stage): a live filtered waveform (`wave:filtered`) of one example trial and channel, with the raw waveform (`wave:raw`) behind it in grey at alpha 0.4. Controls "Example trial" (number stepper) and "Example channel" (dropdown limited to the selected channels, default the first selected channel). When the band edges move, the filtered waveform morphs in real time (backend filter call, debounced 60 ms, or compute in the browser with a precomputed biquad if latency requires, but results must equal the backend within 1e-3).
- Shape badge: same shape as before (filtering does not change shape), for example `100 x 3 x 500`.
Presets: the preset's band presets plus the always-available "Broad 1-40", "Wide 4-40" and "Delta/theta 1-7" (duplicates removed).
Leaves for Page 5: transition 4 -> 5 in Section 5.7.2.

## PAGE 5: CHOOSE FEATURES
Layout:
- A keyboard-accessible grid of 12 feature-family cards (3 columns at desktop widths), each 200 x 170 px, plus the basket on the right (about 260 x 360 px, outlined, labelled "Feature basket") with a counter. The grid area is clipped by a rectangle and scrolls vertically inside it (the scroll offset is `ui.scrollY`, an input to the layout); card pieces outside the visible area keep their targets but are masked. The card browser has category filters **All / Time / Frequency / Time-frequency / Spatial / Learned** and a search field. Category membership: Time = `time_stats`, `window_means`, `hjorth`, `complexity`; Frequency = `band_power`, `spectral_features`; Time-frequency = `wavelet`, `tf_regions`; Spatial = `csp`, `covariance`, `asymmetry`; Learned = `autoencoder`. Cards that do not match the filter or search leave the grid (they shrink to scale 0 at their slot, flavor snappy) and the remaining cards reflow by springing to new slots. Selected cards stay in the basket regardless of the filter. Cards listed in the preset's `recommendedFamilies` carry a small tag "recommended for {preset}".
- Every feature family is a scikit-learn compatible transformer (custom ones in `app/features`). Each accepts `(trials, channels, samples)` and returns `(trials, features)`, and the selected families are concatenated in a fixed order (the order of the list above). Every card shows per-feature names, units, calculation interval, output column count, a live preview from the actual data, and a short formula disclosure.
- Cards (ID, title, live mini-preview, exact behaviour):
  1. `band_power` "Band power": preview is a glass of liquid; the fill level equals the normalised mean log band power of the selected band across trials for the class shown (classes alternate every 2 s), animating up and down. Settings: bands chosen from the named bands (delta, theta, alpha, mu, beta, gamma), the preset's key bands, and custom bands (low and high in Hz, any number of them); uses channels from Page 3. Feature count = n_channels x n_bands.
  2. `csp` "CSP (spatial filters)": for two classes, implemented with `mne.decoding.CSP(n_components=m, reg=None or "ledoit_wolf", log=True, component_order="alternate")` so it uses the first and last filters. For more than two classes, one-vs-rest CSP: one binary CSP per class (that class against all others), each with m components, concatenated (feature count = K x m). Preview is two ellipses (class covariance projections for the two classes, or the first class against the rest) that rotate slowly to the optimal CSP angle and separate; each ellipse in its class colour. Settings: number of components (default 4, options 2, 4, 6, 8; uses the m/2 first and m/2 last filters), regularisation (shrinkage "ledoit_wolf", default off), log-variance output. Fit rules: fit on TRAINING FOLDS ONLY (see section 6A.3).
  3. `hjorth` "Hjorth parameters": preview is three small gauges (activity, mobility, complexity) with needles showing the mean value. Implemented in numpy. Feature count = 3 x n_channels.
  4. `wavelet` "Wavelet energy": implemented with PyWavelets (`pywt.cwt` with the complex Morlet wavelet `cmor`, scales derived from target frequencies with `pywt.frequency2scale`), energy = mean squared magnitude over the window. Preview is a small time-frequency heat-map over the preset's `waveletRange` (clamped to Nyquist) of the mean over trials. Settings: wavelet (morlet default), n_frequencies (default 8), frequency range (default from the preset). Feature count = n_frequencies x n_channels.
  5. `covariance` "Covariance (Riemannian)": implemented with pyRiemann (`pyriemann.estimation.Covariances`, `pyriemann.tangentspace.TangentSpace`). Preview is a n x n grid of squares coloured by the mean covariance matrix entries (use up to 8 x 8). Settings: estimator (OAS default, scm), tangent-space projection (on by default). Feature count = n_channels (n_channels + 1) / 2 after tangent-space projection.
  6 to 12: `time_stats`, `window_means`, `spectral_features`, `tf_regions`, `asymmetry`, `complexity`, `autoencoder`, specified in section 6A.1.
- Each card shows its title, a one-line plain-English explanation, its mini-preview, and a live badge "N features". The count always comes from the backend and includes duplicate-name deduplication.
- Click a card (or press Enter): it flies into the basket (spring path, 400 ms feel) and a settings drawer opens in the controls panel. Click again to remove it from the basket (flies back).
- The basket shows a feature-vector counter that ticks up like an odometer (digits roll) with the TOTAL features across all basket items, plus a stack of mini chips of the selected feature types.
- Default selection on first visit: none; the page tag reads "no features chosen: using {the preset's default feature}" and the pipeline uses that default so downstream pages still work.
- If CSP, covariance, or the autoencoder is chosen, show a small note in ink: "fit inside cross-validation to avoid leakage".
Leaves for Page 6: transition 5 -> 6 in Section 5.7.2.

## PAGE 6: TRANSFORM AND NORMALIZE
Layout:
- One selected feature at a time (dropdown "Feature to inspect", default: the highest-ranked by separability), shown as a pile of grains (`val` pieces for that feature) forming a histogram: x = feature value, y = stacked grains, 40 bins. One overlaid pile per class (class colours at 70% alpha) so overlap/separation is visible. Class means marked with a small vertical tick.
- The raw pile is often skewed with a long right tail (band power is heavy-tailed). That is real, not drawn.
- Buttons (choose one transform at a time, plus a normalise): Transform: "none (default)", "log", "signed log (sign(x) times log1p of abs(x))". Normalise: "none", "z-score", "robust scale (median/IQR)", "min-max". Order of operations is fixed: transform first, then normalise.
- Log policy (section 6A.3): plain "log" is applied only to columns that are strictly positive in the data used for the fit; all other columns pass through unchanged and the panel states "log skipped for N non-positive columns". "signed log" is valid for any column.
- Pressing "log": the tail compresses (grains animate along x to the new positions) and the pile levels out. Pressing "z-score": the pile slides so the mean is at 0 and rescales to unit width; show vertical guides at -1, 0, +1.
- A faint ghost (alpha 0.15, outline only) of the "before" histogram stays behind during the change.
- Show numbers (mono): skewness and kurtosis before and after, mean and standard deviation per class.
- Normaliser statistics (mean, std, median, IQR) are fit on TRAINING FOLDS ONLY in the evaluation; the display here uses all data for visualisation and states that in a footnote: "display only; evaluation fits on training folds".
Leaves for Page 7: transition 6 -> 7 in Section 5.7.2.

## PAGE 7: FEATURE MATRIX
Layout:
- Left 60% of stage: a view area with a tab strip `views`: **Matrix** (default) / **Correlation** / **Class distribution** / **Scatter (2 features)** / **PCA 2-D** / **t-SNE (optional, display only)**. The tab strip is part of the stage, with keyboard access through the accessibility overlay.
  - **Matrix**: heat-map grid of trials (rows) x features (columns), the same `val` pieces as cells, coloured by value (diverging ramp after normalisation, or single-hue if none), rows sorted by class order with a thin divider and class colour strip on the left edge. Column headers (rotated) with feature names, grouped by feature type with a bracket. When there are more columns than fit, show a horizontally scrollable window of columns (offset in `ui`), and a tag "showing columns a to b of N".
  - **Scatter (2 features)**, **PCA 2-D**, **t-SNE**: the grid pulls itself into a scatter plot. For each trial, all cells of its row fly to the trial's (x, y) point; the cell in the X column stays as the visible dot (class colour and class marker) and the row's other cells shrink and fade, so exactly one dot per trial remains. Stagger by trial. "Back to table" reverses it. For two features an optional decision overlay from a 2-feature LDA is drawn, with accuracy: for two classes a boundary line; for more than two classes a coarse 40 x 40 grid of decision regions shaded in the class colours at alpha 0.1.
  - **Correlation**: a correlation heat map of the selected/projected features (absolute Pearson), limited to the 60 highest-ranked features, drawn as one decor Graphics texture.
  - **Class distribution**: for the chosen feature, class-wise histogram, box plot and violin-style density, drawn as decor Graphics.
  The Correlation and Class distribution views fade in over the matrix (the matrix cells dim to alpha 0.15 and stay in place). They are secondary instruments, not part of the data object.
- Hover a row: its source trial lights up on a signal strip along the bottom (`wave:filtered` set to the mean-across-channels filtered trace of that trial, drawn in class colour) with the text "Trial n, class name".
- Pick two features (two dropdowns "X feature", "Y feature", or Shift-click two columns) to use the Scatter view.
- Right 40% panel (cards):
  a) Separability meter: a semicircular gauge showing stratified CV accuracy of the current pipeline (classifier LDA default; options: LDA, logistic regression, linear SVM; all handle more than two classes). Needle animates with a spring. Display number as percent with +-std over folds. The chance level (majority-class rate) is marked with a tick.
  b) Feature race: horizontal bars, one per feature, ranked by univariate discriminability: the mean over classes of |AUC_one-vs-rest - 0.5| x 2, scaled 0 to 1 (for two classes this is |AUC - 0.5| x 2), computed by the backend per feature. Bars race into position (stagger by rank, 30 ms). Click a bar to set it as the X feature.
  c) Leakage toggle: a switch "Learned steps fitted on: training folds only (correct) / all data (leaky)". Learned steps are CSP, the covariance reference, the autoencoder, selection, projection and the scaler. Both accuracies are always computed by the backend and shown side by side as two bars after the toggle is first flipped: correct vs leaky; the gap is highlighted with a bracket whose label uses the measured sign, for example "leaky fit changed accuracy by +X points" or "by -X points". The gauge follows the toggle. The UI never claims that a leaky fit always raises accuracy. If no learned step is selected, the panel says "no learned steps selected: only the scaler could leak". With the motor-imagery sample and CSP selected, the leaky accuracy must be visibly higher than the correct one (see acceptance criteria); if the effect is not visible, increase the number of CSP components or reduce trial count in the demo generator until it is, but never fake it.
  d) "Select & reduce" drawer (section 6A.2): variance threshold, correlation pruning, Fisher score, mutual information, top-K, PCA, optional supervised LDA projection.
- The Matrix and the shape badge show the final selected/projected matrix, with a toggle "Show pre-selection matrix".
Leaves for Page 8: transition 7 -> 8 in Section 5.7.2.

## PAGE 8: EXPORT
Layout:
- Eight small chips, one per page, each holding its settings in text (mono 11 px), for example: "Window: 0.0 to 2.0 s", "Channels: C3, Cz, C4", "Band: 8 to 30 Hz, order 4", "Features: CSP (4)", "Transform: log", "Normalise: z-score", "Classifier: LDA, 5-fold", "Leakage guard: on". Chip texts come from the real settings. Chips sit left, one under another, each tagged with its page number.
- Chips fly (spring path, staggered by page order) into a code panel on the right (see `exportPhase` in section 5.7.2), and the code types itself out (about 60 characters per second; instant under reduced motion). The script is a complete runnable Python file using MNE, scikit-learn (plus `pywt` and `pyriemann` only when those features are selected): a header comment lists the exact `pip install` line, then it loads data from a CSV path variable with variables for `sfreq` and `tmin`, crops the epoch by time, picks channels by name, applies the MNE band-pass `filter(l_freq, h_freq, method="iir", iir_params={...})` matching the zero-phase Butterworth used in the app, extracts features, applies the selected selection and projection steps, and builds a scikit-learn `Pipeline` with the scaler, CSP, autoencoder, selection and projection inside cross-validation, evaluated with `cross_val_score` and `StratifiedKFold` (folds as used in the app, `shuffle=True, random_state=7`). Comments explain each step.
- Control: "Matrix export mode" with two options, "Exploratory (all-data fit)" (default) and "Out-of-fold (per fold)". The label under it states which one the download uses.
- Buttons: "Copy as Python", "Download .py", "Download settings JSON", "Download feature matrix CSV", "Download feature matrix NPZ". The JSON contains every setting, the preset id, class names and the app version.
- A line under the buttons: "Reproduces the accuracy shown on page 7 within normal CV variance".
- The exported script must actually run on the matching example CSV. Unit test: for each of the three samples, execute the exported script in a subprocess against `sample/example_*.csv` and check it exits 0 and prints an accuracy within +-0.05 of the app's value.

# 6A. FEATURE EXTRACTION COMPLETENESS EXTENSION (normative; supplements section 6)

This section is part of the required build, not an optional wishlist. Preserve the eight-page architecture and persistent-piece transitions. Pages 1-4 are *feature-specific configuration* when this app is embedded after upstream modules: consume existing artifact-cleaned, epoched EEG, time-frequency outputs, channel metadata and labels when supplied (section 3.3); do not silently refilter or re-epoch the upstream data. Standalone CSV/sample mode remains fully supported. Show the source and inherited settings, and explicitly distinguish a new optional feature-specific filter from upstream preprocessing. No additional pages or plotting libraries. All feature families work for any number of classes, channels and samples that satisfy the limits in section 3.0.

## 6A.1 Feature-family cards (families 6 to 12 on Page 5)
All feature cards expose per-feature names, units, calculation interval, number of output columns, preview from actual data, and a brief formula/help disclosure. Each transformer accepts `(trials, channels, samples)` and returns `(trials, features)`; concatenate selected families in a deterministic order. Disable invalid controls with an explanation rather than fabricating values. Default feature-specific interval is the selected Page 2 window. Calculations must use physical signal units consistently (EEG microvolts for amplitudes; PSD units documented). Any fitted transformer follows the fold-isolation rule in 6A.3. All families operate on the signal after the Page 2 crop, the Page 3 channel choice and the Page 4 band-pass, except `tf_regions` (below).

6. `time_stats` **Time-domain statistics**: toggles for mean, variance, standard deviation, RMS, peak-to-peak, skewness, excess kurtosis, line length, and Higuchi fractal dimension (default mean, variance, RMS, peak-to-peak). One value per chosen statistic per channel. `variance` uses population variance (`ddof=0`); RMS = sqrt(mean(x^2)); line length = sum(abs(diff(x))) (not divided by sample count); excess kurtosis uses scipy convention (Gaussian = 0); Higuchi fractal dimension has adjustable `kmax` (default 8, bounded by epoch length). Handle constant signals and short epochs deterministically, return documented finite values or a clear validation error. Preview: waveform plus responsive statistic meters, with an optional synthetic amplitude/frequency/noise playground explicitly tagged "simulated", separate from uploaded data.

7. `window_means` **Windowed means (ERP-style)**: split the selected window into consecutive equal bins and take the mean amplitude of each bin for each channel. Settings: bin width in ms (default 50, bounded so there are at least 2 bins), and baseline correction (subtract each channel's mean over the baseline interval from the trial before binning; available only when a baseline exists; default on for the P300 preset and off otherwise). The last partial bin is dropped and the number of dropped samples is shown. Feature count = n_bins x n_channels. Feature names include the channel and the bin's start time. Preview: the example trial's waveform with the bins drawn as steps.

8. `spectral_features` **Spectral descriptors**: toggles for absolute band power, relative band power, peak frequency, spectral entropy, spectral centroid and ratios of chosen bands. Default relative power in the preset's key bands (the named alpha and beta bands for custom data). Use Welch PSD with explicitly displayed `nperseg=min(round(sfreq), n_samples)` and 50% overlap where possible. Integrate PSD using trapezoidal integration over actual frequency bins; document that frequency resolution is limited by window length. Relative power = selected-band power / reference-band power (default 1-40 Hz intersected with Nyquist and the selected Page 4 passband, with effective bounds displayed); entropy = -sum(p log(p)) / log(number of positive-power bins) on normalized spectral bins, defined as 0 for one valid bin. Centroid = sum(f*PSD) / sum(PSD). Peak = argmax PSD in the reference range. Ratio = numerator/denominator band powers, with a small documented epsilon and a warning for zero denominators. Provide named delta (0.5-4), theta (4-8), alpha (8-13), mu (8-12), beta (13-30), gamma (30-45) presets; clamp to Nyquist and the current band, and disable bands without adequate bins. Preview: real PSD with shaded selected integration regions and a band-power comparison chart.

9. `tf_regions` **Time-frequency regions and band-power change**: optional precomputed STFT/CWT power tensor from upstream (section 3.3, `tfr`), or calculate with supported scipy STFT or `pywt.cwt` if absent. Select a time interval and frequency range on a heat map, returning mean power, max power, integrated region energy, wavelet coefficient mean/variance/energy, and percent change vs baseline. Percent change = 100*(task_power - baseline_power)/baseline_power, using a separately defined baseline from the *original* full epoch (the backend always keeps it), not the Page 2 cropped signal; default baseline = the preset or data baseline interval, and default task interval = the preset zone (otherwise the Page 2 window), clipped only when the source recording permits. For this card the Page 4 zero-phase band-pass is applied to the FULL epoch first and the baseline and task windows are cropped afterwards (this avoids edge effects); frequency ranges outside the Page 4 passband are attenuated, so show a warning when the selected range extends beyond it. If no baseline exists or it is near-zero, disable the percent-change outputs with a clear explanation. Show the selected rectangle and both baseline/task values. Distinguish power (squared magnitude) from amplitude. A negative percent means a power decrease (ERD) and a positive percent an increase (ERS).

10. `asymmetry` **Hemispheric asymmetry**: matched left/right channel pairs are detected automatically from the dataset: same name prefix with odd and even numeric endings (for example C3/C4, F3/F4, PO7/PO8), confirmed by mirrored x positions when positions exist; the user can also pick any two channels manually. Select pairs (default: the first detected pair), band (default: the preset's first key band, otherwise the Page 4 band), and representation (difference `P_left - P_right` or normalized `(P_left - P_right)/(P_left + P_right + eps)`). Feature count = pairs x bands x selected representations. Requires both channels; if a required channel is excluded, show an actionable message; if no pair is detected, disable the card with an explanation. Preview: two channel band-power bars with signed difference and clear left/right labels.

11. `complexity` **Signal complexity**: line length and Higuchi fractal dimension can also be exposed here as an advanced guided lesson (the computations are shared with `time_stats` and are never double-counted if both cards select the same named channel/feature). Provide a kmax control and compare the same signal under different noise levels using real recomputation. Feature count = unique selected complexity features x channels.

12. `autoencoder` **Learned latent features (advanced)**: a compact deterministic CPU-compatible undercomplete autoencoder trained on training folds only. Implement with NumPy and scipy (no new dependencies): decimate each channel with `scipy.signal.decimate` so it has at most 125 samples (documented, to bound CPU cost), flatten each trial's selected channels and samples, standardize inputs with training-only statistics, use a one-hidden-layer encoder with tanh, a linear decoder, and minibatch gradient descent on MSE with explicit analytical gradients, seeded initialization (seed 7). Settings: latent dimension (default 8; options 2, 4, 8, 16, capped below the input dimension), epochs (default 50), learning rate (default 0.01, range 0.0005 to 0.1), batch size (default 16). Use a fixed stratified validation subset (20 percent of each training fold) for early stopping with patience 5, never the held-out test fold. Transform outputs the latent code; the decoder is used only for the reconstruction preview. Acceptance for the defaults: on each sample dataset the training loss must fall by at least 20 percent; if it does not, tune the defaults within the stated ranges and document the final values. Preview: original vs reconstructed selected trial, real training/validation loss, and a 2-D PCA projection of latent codes (the projection itself is display-only). Expose a training progress indicator and allow cancel; warn about CPU cost. In offline fallback, show only genuinely precomputed latent results with an offline tag. For exported scripts, include the same implementation and seed so results are reproducible within the stated tolerance.

Page 5 feature counts always come from backend-computed output dimensionality, including duplicate-name deduplication. If the selected feature count exceeds the 4,000-piece `val` pool, use stratified trial subsampling for rendering while retaining the complete backend feature matrix.

## 6A.2 Page 7 selection, reduction and visualizations
Add a collapsible **Select & reduce** drawer with a deterministic ordered pipeline: (1) remove near-constant columns by a training-fitted variance threshold; (2) optionally prune highly correlated columns using an absolute Pearson correlation threshold (default 0.95; deterministic keep-first tie-breaking); (3) optionally rank and select the top K by Fisher score or mutual information; (4) optionally project with PCA or supervised LDA. The user may turn each step on or off. Do not silently perform selection by default. For Fisher score with K classes use F = sum_k n_k (mean_k - mean)^2 / (sum_k n_k var_k + epsilon) (class means and population variances; display the formula); mutual information uses `sklearn.feature_selection.mutual_info_classif(random_state=7)`. PCA uses `sklearn.decomposition.PCA` with chosen components bounded by training sample and feature counts, and shows a scree plot, explained variance ratio and cumulative variance. Supervised LDA projection uses `LinearDiscriminantAnalysis(n_components=c)` with c at most min(K - 1, n_features) (one dimension for two classes); explain that it is different from choosing LDA as the final classifier. For any projected components, feature names are `PC1...` or `LD1...`; keep source-column provenance metadata.

Provide a correlation heat map, Fisher/MI rank bars, a class-wise feature histogram/boxplot/violin-style density display, a two-feature scatter, and a 2-D PCA scatter (the Page 7 views above and the right-panel race bars). t-SNE is an *optional display-only* view (sklearn TSNE with fixed seed and perplexity below the number of trials), never a classifier input or an exported feature projection. All plots use the existing Pixi pieces and decor Graphics, not a new charting library. Clearly label when a view is fitted on all available data for teaching; CV scores must not reuse those all-data fits.

The Page 7 heatmap and shape badge show the final **selected/projected** matrix, with a toggle to inspect the pre-selection matrix. Feature ranking uses only training data within each fold when ranking influences model evaluation. The separability gauge and leakage comparison recompute when feature choices, selection, or projection change. If selection produces zero features or invalid PCA dimensions, block evaluation and show an informative error.

## 6A.3 Data leakage and evaluation contract
All operations that learn from multiple trials (CSP, covariance tangent-space reference, autoencoder, normalization, variance/correlation selection, Fisher/MI ranking, PCA, supervised LDA projection, classifier) are fit **inside each training fold** of stratified CV. Unsupervised feature calculations performed independently per trial (Hjorth, band power, window means, fixed wavelet transforms, percent change against each trial's own baseline) may run before splitting. A training-only fit may be used to show the selected model's transformed test fold, but never to train on it. Build a scikit-learn compatible composite feature union with stable feature names; no implicit labels used in unsupervised feature transforms. Transformations that require positive values (`log`) use this policy: plain log is applied only to columns that are strictly positive in the training fit and other columns pass through unchanged with a visible note; signed log is available for any column; neither is applied silently to signed, zero or negative features. Standardization is normally applied before PCA, Fisher/MI selection and the classifier; if the UI shows another order, explicitly document the distinction. Any global preview fit is tagged `exploratory only - all-data fit` and is not the basis of the CV accuracy.

## 6A.4 Integration and exports
Input contract: section 3.3. Validate shape and units and preserve immutable upstream data; feature-specific settings are downstream overrides. If no upstream object exists, preserve the original standalone CSV/sample flow.

Page 8 exports: (a) runnable Python script, (b) settings JSON, (c) CSV with `trial_id`, `label` (the class name) and one column per final feature, and (d) compressed NPZ containing `X_features`, `y`, `class_names`, `feature_names`, `trial_ids`, and JSON metadata. In **Exploratory** mode the matrix is a clearly labeled all-data fitted representation. In **Out-of-fold** mode, because selected features and learned projections (PCA, LDA, CSP, autoencoder) differ between folds and their columns are not comparable across folds, the export is always per fold: the CSV download is a ZIP with one CSV per fold plus a `schemas.json` listing each fold's feature names and source-column provenance, and the NPZ stores `fold{k}_X_val`, `fold{k}_y_val`, `fold{k}_trial_ids` and `fold{k}_feature_names` for every fold. Exported scripts must reproduce the *correct* CV score (never the deliberately leaky variant) and all selected features, transformations and selection methods. Do not embed private uploaded EEG data in exported code. Ensure settings JSON includes provenance, preset id, class names, band boundaries, feature configuration, selection/projection configuration, seeds and dependency versions.

## 6A.5 Additional endpoints and tests
Extend `POST /features` to return per-family names, units, formulas/metadata and the real preview arrays; extend `POST /evaluate` to return pre/post-selection shapes, selection rankings, PCA diagnostics, correlation data, feature provenance, CV fold diagnostics, chance level, class counts and projected scatter arrays. Add `POST /feature-preview` for selected epoch/channel, feature formula and actual recomputed output; `POST /autoencoder/train` (returns a `job_id`), `GET /autoencoder/status/{job_id}` (progress and losses, polled by the UI) and `POST /autoencoder/cancel` for bounded CPU training; `GET /export/features.csv` and `GET /export/features.npz` with settings-hash scoped download tokens. These are additional endpoints, not replacements for existing ones.

Add pytest checks for: numerical time-statistic reference values; window means (bin edges, dropped samples, baseline correction); Welch band integration and relative power; spectral entropy on constant-spectrum and single-bin edge cases; percent-change sign and baseline availability; asymmetry pair detection and sign; Higuchi stability; autoencoder reconstruction loss and fold isolation; selection dimensions and deterministic tie-breaking; PCA variance ratios; LDA projection dimension for 2 and 4 classes; one-vs-rest CSP feature count for 4 classes; no training fold sees test samples in any fitted stage; CSV/NPZ round trip (both export modes); exported script reproducibility for representative feature-family combinations on each sample; NPZ upload validation.

## 6A.6 Updated teaching objective
For each selected feature: **input waveform/PSD/TFR -> formula -> live computed number -> per-trial feature vector -> selected feature matrix -> classifier**. Display units and missing/invalid-data explanations. Maintain the original page captions and the spring-based persistent-piece experience.

---

# 7. NAVIGATION AND STATE
- Free navigation: any page from any other; browser Back/Forward move between pages (hash routing `#/1` to `#/8`, implemented by hand, no router library); keyboard 1..8 and Left/Right arrows (when no control is focused).
- Single global Zustand store with these keys and defaults (all are part of the hashed settings unless marked ephemeral):
  - `paradigm` (preset id or "custom") and `montage` (default `standard_1005`)
  - `timing` {sfreq, tmin, baseline {start, end} or null} (from the data, editable on Page 1)
  - `window` {start, end} (default from the preset)
  - `channels` (list of selected channel names, default from the preset)
  - `band` {low, high, order} (default from the preset)
  - `showClasses` (list of class indices shown, default all); `probe` {x, y} (default from the preset); `baselineVisible` {true}
  - `map` {metric, band, frequency, mapClass, pair {a, b}, visible true, opacity 70} (defaults from the preset)
  - `features` (list of selected family ids, empty by default); `featureSettings` (per-family settings)
  - `selectionSettings` {variance {on false, threshold 0}, correlation {on false, threshold 0.95}, ranking {on false, method fisher, topK 20}, projection {method none, components 2}}
  - `transform` {none}; `normalise` {none}
  - `classifier` {lda}; `cvFolds` {5}; `leakageGuard` {true}
  - `view` {matrix}; `xFeature`, `yFeature`; `exportMode` {exploratory}
  - `upstream` (provenance and inherited settings, empty when standalone)
  - ephemeral (not hashed): `ui` {scrollY, categoryFilter all, search "", columnOffset, exportPhase chips-left, reduceMotion, ambientPaused}
- All derived backend results are keyed by a hash of the relevant upstream settings. Loading or replacing a dataset resets every key above to the defaults of the active preset (or to the custom defaults) and drops stale backend results.
- Free mode: if a page's upstream step was never visited the app uses defaults and shows a small tag on the page: "using all channels", "using full band", "using default window", "no features chosen: using {default feature}".

# 8. THE PIPELINE RAIL (always visible, bottom 56 px of the canvas)
- One node per page (8 nodes), connected by a thin line. Each node holds a miniature of the data object: a tiny rectangle whose width and height reflect trials x channels x samples (log-scaled, sized within a 36 x 28 px box), plus a monospace shape label under it: 100x22x750 -> 100x22x500 -> 100x3x500 -> 100x3x500 (filtered) -> 100xN (features) -> 100xN (transformed) -> 100xK (selected/projected matrix) -> script icon. Shapes are the REAL shapes returned by the backend for the current settings.
- Clicking a node navigates to that page (each node has an invisible focusable React button overlay). The active node is highlighted with the selection accent ring.
- The miniature in the rail is a `rail:{node}` piece morphing in sync with the main view: when a page transition is running, the miniature of the target node scales up and the one for the source node settles.
- Change ripple: when a user changes a setting on page N, a pulse (accent-coloured dot with a fading trail) travels along the rail from node N to every downstream node (staggered 120 ms per node); each affected node briefly flashes and its shape label updates. Pages downstream recompute lazily when visited, but their rail node updates immediately.

# 9. BACKEND API (FastAPI, JSON via orjson, CORS for localhost:5173)
All responses include `shape` (the true array shape after that step) and `hash`. Arrays use the f32 base64 format from section 2.2. Downsample arrays for display (to at most 200 points per ribbon) using decimation with an anti-alias filter, but all maths use full-resolution data.
- GET /paradigms -> the presets from `paradigms.json` (section 3.4)
- GET /electrode-presets -> the generic electrode sets from `electrode_presets.json` (Page 3). Dataset responses carry them already resolved as `electrodePresets`, plus `layout`.
- POST /dataset/synthetic {paradigm} -> dataset + metadata (class names, times, channels, baseline) + electrode `positions` (2-D, from `montage.py`)
- POST /dataset/upload (multipart CSV with the form fields from section 3.2) -> parsed dataset or `{errors: [...]}`
- POST /dataset/upload-npz (multipart NPZ, section 3.3) -> parsed dataset with provenance, or `{errors: [...]}`
- POST /dataset/interpret {paradigm} -> the preset defaults applied to the loaded data (with warnings for missing channels)
- POST /window {start, end, probe} -> shape, per-trial envelopes, probe scatter values and CV accuracy
- POST /channels {channels, show_classes, map} -> shape, per-channel sparkline arrays (one per class), effect-map grid (64x64 values) + per-channel map values and units
- POST /band {low, high, order, example_trial, example_channel, show_classes} -> shape, PSD per class and baseline (Welch), filtered and raw example waveforms
- POST /features {selection, settings} -> feature matrix shape, feature names, per-family names, units, formulas, per-feature live-preview data
- POST /feature-preview -> actual recomputed output for one epoch and channel
- POST /autoencoder/train, GET /autoencoder/status/{job_id}, POST /autoencoder/cancel
- POST /transform {transform, normalise, feature} -> histogram bins per class before and after, skew and kurtosis, summary stats, number of columns where log was skipped
- POST /evaluate {all settings, classifier, folds, leakage_guard} -> accuracy mean and std per fold, BOTH correct and leaky accuracies, chance level and class counts, feature ranking (AUC, Fisher, MI), pre- and post-selection shapes, PCA diagnostics, correlation data, feature provenance, CV fold diagnostics, final feature matrix (rounded to 4 decimals) for Page 7, scatter data for any two features and for PCA/t-SNE views
- POST /export {all settings, export_mode} -> script text, settings JSON, and download tokens
- GET /export/features.csv and GET /export/features.npz (token scoped to the settings hash)
- GET /health
Rules: CSP, scalers, covariance estimators, the autoencoder, selection and projection must be fit inside each CV training fold using scikit-learn `Pipeline`; the "leaky" variant fits on all data before splitting (and is labelled leaky in code). Seeds fixed to 7. Cache results in memory by hash. Return HTTP 422 with human-readable messages for invalid settings and for dataset limit violations (section 3.0).

# 10. ACCESSIBILITY AND ROBUSTNESS
- Everything operable by keyboard; visible focus ring (2 px selection accent). Canvas items that must be focusable (electrodes, tray chips, feature cards, card filters, rail nodes, window handles, band handles, matrix columns, Page 7 view tabs) get real DOM elements in a transparent `A11yOverlay` layer positioned over the canvas, each with an ARIA label (for example "C3, included, map value 41 percent"). Overlay positions are updated by writing styles directly from the engine ticker, never through React state per frame. With up to 128 channels the overlay must stay responsive (reuse DOM nodes, no per-frame creation).
- Panel controls use the Radix primitives, which provide keyboard and ARIA behaviour; do not re-implement them.
- Pause-ambient-motion button always visible in the top bar. Text contrast at least 4.5:1 on cream.
- Loading, empty and error states for each backend call (small inline text, not blocking dialogs). Never show a blank stage.
- No colour-only encoding: classes also differ by marker (circle, square, triangle, diamond, cross, star) and by label.
- Handle window resize without losing state (re-run layouts with the new stage size, springs retarget).

# 11. DELIVERABLES
1. Full project (frontend + backend) in the layout from section 2.7, with a README: install and run commands (`cd frontend && npm i && npm run dev`, `cd backend && pip install -r requirements.txt && uvicorn app.main:app`), CSV and NPZ formats, how to add a paradigm preset, chosen package versions, architecture explanation of the persistent-piece + pure-layout-function + spring system, of the pools, of the React/engine boundary and of the transition table, and a list of Assumptions.
2. `/docs/pages.md`: for each page: the layout function, piece groups used, stagger plan, backend calls, and settings keys. `/docs/transitions.md`: for each transition, the final table of flavor, offsets and via poses as implemented, and the measured settle time. `/docs/paradigms.md`: the preset schema and the three built-in presets.
3. Tests:
   - Backend (pytest): filter correctness against a scipy reference; CSP fitted on training folds only (assert no test-fold data touches the fit); leakage toggle changes reported accuracy; export script runs for each sample; electrode-position sanity check; electrode-layout check (a 32-channel dataset gives exactly 32 drawn electrodes and a 64-channel dataset exactly 64, with no extra markers, including when some channels are unpositioned); electrode-preset resolution (case-insensitive names, T3/T4/T5/T6 aliases, intersection with the dataset, hemisphere sets, deterministic Evenly spread k); f32 base64 round trip; synthetic-generator effect checks (motor imagery: power decrease strongest at the contralateral channel; P300: target mean amplitude at Pz larger than non-target in 0.3 to 0.5 s; SSVEP: PSD peak at the class frequency); CSV parsing for arbitrary channel names, 2 to 6 classes, imbalanced classes and limit violations; plus every check listed in section 6A.5.
   - Frontend unit (Vitest): every layout function returns a target for every piece id and decor id for each preset and for a custom dataset with unpositioned channels; springs retarget mid-flight without resetting velocity; stagger delays match section 5.4; via poses switch at 70 percent or `viaMaxMs` and are dropped on interruption; `decodeF32` round trip; the pool mapping tables are deterministic; time-axis tick, snap and minimum-width rules (section 3.1).
   - Frontend end-to-end (Playwright): jumping between pages mid-transition leaves no piece created or destroyed and no console errors; for every route (direct, step-by-step, interrupted) the settled positions equal the target layout within 0.5 px; loading a second dataset (a different preset) reuses the pools; toggling an electrode by keyboard changes the shape badge; choosing an electrode preset changes the selection, the counter and the shape badge, and a 32-channel and a 64-channel dataset each render exactly their own number of electrodes; reduced-motion mode removes stagger, via poses and camera; app still loads with the backend offline (fallback tag visible); the engine survives React StrictMode double-mounting; scrolling, searching and filtering feature cards; the Page 7 selection drawer; inherited-data mode; both matrix download buttons; switching "Interpret as" changes the defaults.
4. `/docs/demo-script.md`: a 3-minute click-by-click walkthrough (motor imagery) plus a one-minute variant for each of the other two samples.
5. `scripts/make_fallback.py` that produces the offline sample results JSON for the three samples.

# 12. ACCEPTANCE CRITERIA (check each one and report)
- Jumping between any two pages, including mid-transition, never flickers, breaks or resets pieces; no piece is created or destroyed after startup, including when a different dataset is loaded.
- Every forward transition follows its choreography in section 5.7.2 (waypoints, offsets, flavors, decor draw-on) and visually completes within about 1.8 s; backward and non-adjacent moves follow section 5.7.3; the end state is identical for any route (within 0.5 px).
- The app is general: a CSV with arbitrary channel names, 2 to 6 classes, any sampling rate and any tmin loads, runs through all eight pages and exports a script that reproduces its accuracy; no code path assumes a particular channel, class name, band or time value outside the preset file.
- Page 3 shows a head with nose, ears and a cap drawing, all positioned channels selectable by click, keyboard and marquee, unpositioned channels selectable in the tray, no other electrode sites drawn (a 32-channel dataset shows exactly 32 electrodes, a 64-channel dataset exactly 64, and any other N exactly N, counting tray chips), the electrode preset rows from "Electrode layout and presets (normative)" working by click and keyboard, and an effect map for the chosen metric. On the samples: motor imagery with metric 1 highlights C4 for the left-hand class and C3 for the right-hand class; P300 with metric 3 peaks at Pz or Cz; SSVEP with metric 4 peaks at Oz, O1 or O2.
- Changing the window, channels, or band changes the real downstream shape badges and numbers, and the rail ripple fires.
- For a preset or dataset with a baseline, choosing a window entirely inside the baseline visibly collapses the Page 2 separability to near chance.
- With the motor-imagery sample and CSP selected, the leakage toggle shows a clearly higher accuracy for the leaky setting, and the UI labels the gap with its measured sign. On other data the gap is shown with whatever sign is measured.
- All 12 feature families compute real values, report units and counts from the backend, and the autoencoder training loss falls by at least 20 percent on each sample.
- Default-pipeline accuracies meet the targets in section 3.4 for each of the three samples.
- Selection and projection steps change the final matrix shape, the Page 7 views and the CV score, with no fit touching held-out data. Four-class data works in CSP (one-vs-rest), LDA projection, the feature race and the decision-region view.
- The exported Python reproduces the correct (non-leaky) displayed accuracy within +-0.05 for supported feature combinations; CSV and NPZ downloads work in both export modes.
- Reduced-motion mode works and removes camera, stagger, via poses and ambient motion.
- React never re-renders per frame (verify with the React profiler during a page transition and report).
- 60 fps with the default dataset on a mid-range laptop; if not met, apply the documented level-of-detail and 40-trial subset rules and report the measured fps, with and without the autoencoder.

# BUILD ORDER (stop and report after each stage)
1. Repo scaffold, piece and decor pools with typed-array springs, flavors, stagger, via poses, camera, the transitions table, and the React/engine boundary (singleton engine, StrictMode-safe), with two dummy layouts and tests proving mid-flight retargeting and via-pose dropping.
2. Backend + `paradigms.json` and the three synthetic generators + CSV and NPZ validation + montage positions + unit tests.
3. Pages 1 to 4 with the rail, the accessibility overlay, the preset system and transitions 1->2, 2->3, 3->4.
4. Pages 5 to 8, including all section 6A extensions, feature selection, multiclass handling, matrix downloads and transitions 4->5, 5->6, 6->7, 7->8.
5. Backward and non-adjacent transitions, interruption consistency tests, free mode, tags, change ripple, accessibility, reduced motion.
6. Polish, performance pass, Playwright tests, docs, demo scripts.

Start now with the plan, assumptions and any expensive-to-change questions.
