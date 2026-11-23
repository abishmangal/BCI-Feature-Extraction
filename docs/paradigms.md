# Paradigm presets

Presets live in one file, `backend/app/paradigms.json`, served by `GET /paradigms`. The frontend
never duplicates them. Only `id`, `name` and `synthetic` are required; every other field falls back
to the custom behaviour (`custom_defaults` in `backend/app/paradigms.py`).

## Schema

| field | meaning |
|---|---|
| `id`, `name` | identifier and display name |
| `synthetic` | generator id (`make_motor_imagery`, `make_erp_p300`, `make_ssvep`) |
| `classNames`, `eventLabel` | class labels of the sample, label of the t = 0 marker |
| `sfreq`, `epoch {tmin, n_samples}`, `channels` | sample data geometry |
| `baseline {start, end}` or null | baseline interval |
| `zone {start, end, label}` or null | Page 2 "expected response zone" (static guide) |
| `defaultWindow`, `defaultBand {low, high, order}` | defaults |
| `windowPresets`, `bandPresets`, `channelPresets` | `{label, ...}` lists; a channel preset is shown only when all its channels exist; `default: true` marks the first-visit selection |
| `probe {x, y}` | Page 2 probe features `{channel, type: log_band_power or mean_amplitude, band}` |
| `mapMetric {metric, band, mapClass}` | default Page 3 effect map (`bandpower_change`, `separability_bandpower`, `separability_amplitude`, `snr`) |
| `keyBands`, `stimulusFrequencies` | Page 4 highlighted bands; SSVEP stimulus frequencies |
| `defaultFeature {family, settings}` | used while no feature is chosen |
| `recommendedFamilies` | cards tagged "recommended for {preset}" (never auto-selected) |
| `waveletRange [low, high]` | wavelet card range (clamped to Nyquist) |
| `hints {page2, page3, page4}` | one sentence each, under the page caption |
| `facts` | the one allowed physiological statement (Page 1 info popover) |

Custom (uploaded data without a preset): probe = log band power of the Page 4 band at the first two
channels; map = separability of band power; window = full epoch; band 1-40 Hz order 4; default
feature band power theta / alpha / beta; wavelet range 4-30 Hz; no zone, hints or facts; window
presets "Full epoch" and, with a baseline, "Baseline only (control)".

## Built-in presets

### `motor_imagery` (100 trials, 22 channels, 250 Hz, -0.5 to 2.496 s)
Classes "left hand", "right hand". Baseline -0.5 to 0 s, zone 0.5-2.0 s, default window 0-2 s,
band 8-30 Hz, default channels "Motor strip (C3, Cz, C4)". Probe C3 vs C4 log power 8-12 Hz. Map:
band-power change vs baseline 8-12 Hz for class 0. Generator: pink noise 10 uV RMS, occipital alpha,
mu (9.5-11.5 Hz) and beta (18-24 Hz) at central channels with contralateral ERD from +0.5 s
(0.3 s ramp), blinks on 8 % of trials. Tuned values: mu 12 uV, ERD-depth sd 0.10 (README).
Default pipeline (CSP, LDA): 5-fold CV 0.80.

### `erp_p300` (200 trials, 8 channels, 250 Hz, -0.2 to 0.796 s)
Classes "non-target", "target". Baseline -0.2 to 0 s, zone 0.25-0.6 s, window 0.1-0.6 s, band
1-12 Hz, all channels. Probe Cz vs Pz mean amplitude. Map: separability of mean amplitude. Default
feature window means (50 ms bins, baseline correction on). Generator: pink noise, occipital alpha,
early visual response at 0.17 s, target-only P300 (centre 0.30-0.45 s, sigma 0.06 s), blinks on Fz.
Tuned value: P300 amplitudes x4.5. Default pipeline: 5-fold CV 0.775.

### `ssvep` (160 trials, 8 channels, 250 Hz, 0 to 1.996 s)
Classes "8 Hz", "10 Hz", "12 Hz", "15 Hz". No baseline, zone 0.5-2.0 s, window 0.5-2.0 s, band
6-40 Hz, default channels "Occipital (O1, Oz, O2)". Probe Oz log power 7.5-8.5 vs 11.5-12.5 Hz.
Map: SNR at the class stimulus frequency. Default feature: band power at f +- 0.5 and 2f +- 0.5 Hz
for every class frequency. Tuned value: occipital alpha halved. Default pipeline: 5-fold CV 0.888
(chance 0.25).
