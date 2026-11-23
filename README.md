# EEG feature-engineering app (build spec v5.1)

An interactive, animated teaching app for EEG feature engineering on event-locked epochs
(trials x channels x samples). Eight pages: Load data, Time window, Channels, Frequency band,
Choose features, Transform and normalize, Feature matrix, Export. Every number, curve, score and
shape shown comes from a real computation on the loaded array.

## Install and run

```bash
cd backend && pip install -r requirements.txt && uvicorn app.main:app      # http://localhost:8000
cd frontend && npm i && npm run dev                                        # http://localhost:5173
```

Python 3.11+ and Node 20+. A virtual environment is recommended for the backend
(`python -m venv .venv`). Regenerate the sample CSVs and the offline results with
`python scripts/make_fallback.py` (run from the repository root with the backend environment).

Tests:

```bash
cd backend && pytest                     # 50 tests (also runs the exported scripts in subprocesses)
cd backend && ruff check app tests ../scripts
cd frontend && npx tsc --noEmit && npm test       # Vitest unit tests
cd frontend && npx playwright install chromium && npm run e2e   # Playwright (starts both servers if needed)
```

## Chosen package versions (latest stable at install time, pinned exactly)

Backend (`backend/requirements.txt`, full lock in `backend/requirements.lock.txt`): fastapi 0.165.0,
uvicorn 0.54.0, python-multipart 0.0.34, orjson 3.13.0, numpy 2.5.5, scipy 1.18.1, scikit-learn 1.9.1,
mne 1.13.2, pandas 3.1.1, PyWavelets 1.10.0, pyriemann 0.12, pytest 9.2.0, ruff 0.17.6.

Frontend (`frontend/package.json`, lockfile `package-lock.json`): pixi.js 8.23.0, react / react-dom
19.3.1, zustand 5.1.0, @radix-ui/react-slider 1.6.1, -select 2.4.1, -switch 1.4.1, -tooltip 1.4.1,
-toggle-group 1.2.1, @fontsource/fraunces, inter and jetbrains-mono 5.3.0, vite 8.3.8,
@vitejs/plugin-react 6.3.0, typescript 7.0.2, vitest 5.1.1, @playwright/test 1.65.1, prettier 3.10.1.

## CSV format

Wide format, one row per (trial, channel):

```
trial,label,channel,s0,s1,...,s{N-1}
0,left hand,C3,1.23,0.98,...
```

`label` is any string or number (2 to 6 distinct values); `channel` is any name (the same set in
every trial). Values are microvolts. Sample times are `tmin + i / sfreq`. Fields next to the upload:
sampling rate (default 250 Hz), tmin (default 0), optional baseline start/end (empty = none unless
tmin is negative, then tmin to 0), montage (MNE built-in list, default `standard_1005`) and
"Interpret as" (Custom, Motor imagery, P300 / ERP, SSVEP). Validation errors are shown inline:
missing columns, non-numeric samples, unequal trial lengths, missing channels, duplicate rows,
class counts, and the limits (2,000 trials, 128 channels, 10,000 samples, 20 s, 6 classes, 2 trials
per class). Example files: `sample/example_motor_imagery.csv`, `example_erp.csv`, `example_ssvep.csv`
(also served by the "Download example CSV" link).

## Upstream NPZ format

Required keys: `X` (float32, epochs x channels x samples, uV), `y` (int), `sfreq`, `ch_names`,
`times`, `meta_json` (JSON with at least `{"version": "1", "units": "uV"}`, optional `event_id`,
`artifact_provenance`, `upstream_settings`). Optional: `class_names`, `ch_pos` (channels x 2, head
radius 1), `baseline_X` + `baseline_times`, `tfr` + `tfr_freqs` + `tfr_times`, `X_spatial`.
Upstream data is immutable (the array is made read-only); every later step is a downstream copy.

## How to add a paradigm preset

Add an object to `backend/app/paradigms.json` (fields in `docs/paradigms.md`; only `id`, `name` and
`synthetic` are required, every other field falls back to the custom behaviour) and, if it needs
sample data, a generator function in `backend/app/paradigms.py` registered in `GENERATORS`. The
frontend reads presets from `GET /paradigms`; nothing is duplicated in frontend code.

## Architecture

* **Persistent pieces.** `src/engine/registry.ts` allocates every piece once at startup as fixed
  pools with permanent ids (ribbon 2,400, env 200, strip 4,800, dot 200, electrode 128, spark 128,
  sine 90, val 4,000, 12 cards, 8 chips, 8 rail nodes, 2 waves, 49 decor items: 12,103 in total).
  A deterministic mapping table (`computeSlots` in `src/engine/wiring.ts`, `slots.ts`) assigns slots
  to (trial, channel, feature) whenever the data or settings change; unassigned slots are parked.
  Loading another dataset reuses the pools; no display object is created or destroyed afterwards.
* **Pure layouts.** `src/layouts/page1.ts ... page8.ts` are pure functions `layout(ctx)` returning a
  target for every piece and decor id. They never read the previous page or current positions, so
  any page can be reached from any other.
* **Springs, not timelines.** `src/engine/springs.ts` is the only animation engine: a structure-of-
  arrays spring solver (one Float32Array per property for position, velocity and target), semi-
  implicit Euler at 1/120 s, flavors (standard, soft, snappy, fall, reveal), critically damped
  alpha / colour / reveal, settling, delays and via poses. Retargeting keeps position and velocity.
* **Transition table.** `src/engine/transitions.ts` holds the choreography of section 5.7 per
  forward pair (flavor, kind offsets, via poses, start poses); `src/engine/stagger.ts` the stagger
  plans of 5.4. Backward moves reverse the plan and mirror kind offsets; non-adjacent moves use the
  class-then-trial plan. Meaningful exits ("parkAt") are part of the destination layout.
* **React / engine boundary.** `src/engine` imports no React. `engine` is a module-level singleton
  (`src/engine/wiring.ts`) with an idempotent `mount(canvas)` and an `unmount()` that only detaches
  listeners, so React StrictMode double-mounting is harmless. React (`src/ui`) renders the DOM UI only
  and never per frame: the accessibility overlay, tooltip and code typing write to the DOM directly
  from the engine ticker. The engine reads settings from the vanilla Zustand store.
* **Rendering.** Ribbons, envelopes and waves are PixiJS v8 `Mesh`es with a custom triangle-strip
  geometry (200 points over the full epoch, built once per dataset) and spring-driven
  `uWinStart / uWinEnd` uniforms that crop the Page 2 window in the fragment shader. Strips, dots,
  spectrum bars and matrix cells are `Particle`s in `ParticleContainer`s sharing one atlas (white
  pixel + class markers). Electrodes, cards, chips and rail nodes are `Container`s; decor items are
  `Graphics` rebuilt only on data, size or reveal changes.
* **Backend.** FastAPI (`backend/app`), arrays sent as little-endian float32 base64. Every learned
  step (CSP, covariance tangent space, autoencoder, scaler, variance / correlation selection,
  Fisher / MI ranking, PCA, LDA projection, classifier) is inside a scikit-learn `Pipeline` whose
  input is the trial index, so fitted families only ever see training rows; a fit log verifies it.
  The "leaky" variant fits those steps on all data first and is labelled leaky.

## Assumptions (cheap-to-change choices and measured deviations)

1. **Generator tuning (section 3.4: "tune the generator, not the display").** With the nominal
   values the default pipelines missed their targets, so these were tuned (constants at the top of
   `paradigms.py`): motor imagery mu amplitude 12 uV instead of about 6 and ERD-depth sd 0.10
   instead of 0.2 (CV 0.80, target 0.70-0.90); P300 amplitudes x4.5 (Pz 27 uV) because the 1 Hz
   high-pass applied to the cropped 0.5 s window removes most of the slow deflection (CV 0.775);
   SSVEP occipital alpha halved (1.5 uV at Oz/O1/O2) because the 10 Hz alpha sat inside the SNR
   reference bins and moved the 8 Hz SNR peak to POz (now the map peaks at Oz for all classes;
   CV 0.888, target 0.75-0.97).
2. **Electrode-position sanity check.** With MNE's real `standard_1005` geometry and the specified
   projection, C3 / C4 land at x = -0.503 / +0.507 for every centre the spec allows (head origin,
   algebraic or geometric sphere fit, with or without fiducials), 0.003 / 0.007 outside the stated
   0.1 tolerance; Cz, Fz and Pz pass. The projection is kept exactly as specified and the test uses
   0.1 for Cz/Fz/Pz and 0.11 for C3/C4.
3. MNE 1.13 no longer lists `standard_1005` in `get_builtin_montages()` (deprecated alias of
   `colin27_1005`) but still accepts it; it is kept first in the montage list as the spec default.
   An extra endpoint `POST /dataset/montage` applies a montage change to an already loaded dataset.
4. Processing order: crop (half-open window [start, end), 0-2 s = 500 samples) -> pick channels ->
   zero-phase Butterworth on the cropped window (as the exported MNE script does); `tf_regions` and the
   band-power-change map filter the full epoch first. Window-means baseline correction subtracts each
   trial's own baseline segment, filtered the same way.
5. CSP components are capped at the largest even number <= the number of channels (3 motor-strip
   channels -> 2 components). The leakage gap with the 3-channel default is small (+2 points); with
   CSP on the "Central ring" preset it is +19 to +26 points and with all channels +31 points (the demo
   script uses Central ring).
6. Band power and asymmetry use Welch PSD integrated with the trapezoid rule (uV^2). The probe "log
   band power" uses log10. Band-power change (map metric 1) uses mean squared band-passed amplitude.
7. Page 1: each trial is a band; the channel-0 ribbon carries the 35 % class tint (static fill
   uniform) and all channel traces are ink. Page 2 (changed on request): the whole epoch is always
   visible; the window is a teal frame you slide and resize, and samples outside it are dimmed (no zoom,
   so the 4 px outside strips are not used).
15. Requested changes after the first build: an icon per page on the pipeline rail; a woven basket on
   Page 5 that grows with its contents and shows readable category-coloured chips (the matrix tiles
   rest hidden inside it); a new 5 -> 6 choreography (the card list slides off to the left, the basket
   swells and tips its contents out, which fall and morph into the histogram); teal green and amber
   accents in addition to the ink-blue accent (category colours on the cards).
16. Backend results that arrive during a page transition only update the pieces' final poses; their
   delays, flavors and via poses are kept, so the choreography is not cut short.
18. Second round of requested changes: page navigation (Back / page / Next) sits at the right end of the
   rail and the rail shows page icons only; the controls panel slides smoothly (stage relayout is
   debounced) and collapses to a "<" button; the Page 2 probe editor labels its fields and separates X
   and Y; on Page 5 the sidebar shows the feature basket (teal card design, "Basket Empty: Default
   features used" when empty, chips click to remove, spring-driven count); the stage always shows 3
   equal, larger cards per row, and a hovered card expands with its settings while its two row-mates
   shrink to give it room; on 5 -> 6 the basket floats out of the sidebar onto the stage, swells and flips
   upside down (spring-driven), its contents pour from its mouth and fall into the grains, and the
   sidebar stays empty until the Page 6 controls fade in (every page's sidebar content fades in);
   on 6 -> 7, while the matrix is computing the tiles swirl until the result lands, and a
   "COMPUTING..." banner shows on Page 7 whenever evaluation runs; on Page 8 the chips stay in the
   left column (sized to their text), teal connectors join them to the code panel one by one, green
   0/1 digits stream from the junction and the code appears in about 1.2 s. The Page 6 "before" ghost
   histogram now uses the grain scale.
19. Each page silently prefetches what the next page needs (identical in-flight requests are shared,
   results are kept only if the settings did not change meanwhile), so e.g. Page 5's feature cards are
   ready on arrival; "loading" states appear only when a request takes longer than 60 ms. Ribbon and
   envelope traces are drawn in their class colour (not ink). The 5 -> 6 basket flips counter-clockwise.
17. The Playwright config launches Chromium with the hardware GPU (`--use-angle=default`); headless
   Chromium's default software WebGL renders the ribbon meshes at about 2 fps.
8. Page 2 dots use "offset 400 + 3 ms per trial" without the trial stagger (keeps 1 -> 2 under about
   1.8 s). The frame's handles fade in with the frame alpha (above 0.6) rather than a separate spring.
9. Parking holding points are per kind (ribbons left edge, dots bottom-right, cards right edge, sine
   and val bottom centre, electrodes top centre, chips left edge), plus the page-specific parkAt poses.
10. Free-mode tags use the spec texts; "using all channels" is shown only when all channels are selected.
11. Matrix cell colours: single-hue cream -> ink-blue without normalisation; with normalisation or a
    projection a diverging warm-grey <- cream -> ink-blue ramp (only cream / ink tones and the accent).
12. The typing effect is a constant 60 characters per second (a rate, not a tween); instant under
    reduced motion. Autoencoder defaults (latent 8, 50 epochs, lr 0.01, batch 16) already reach a
    training-loss drop >= 20 % on all three samples (tested), so they were not changed.
13. The wavelet choice offers only the complex Morlet (`cmor1.5-1.0`).
14. Measured: 60 fps on the default sample (headless Chromium), so the 40-trial fallback
    (`shownTrialsLimit`, tag "showing 40 of N trials") is not triggered. Transitions complete visually in
    1.1-1.4 s except backward 2 -> 1 (2.4 s); mirrored backward kind offsets are halved (docs/transitions.md).
