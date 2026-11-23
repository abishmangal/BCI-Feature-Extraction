"""Paradigm presets (section 3.4): loading, validation, custom defaults and synthetic generators."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from .contract import SEED

HERE = Path(__file__).parent
NAMED_BANDS = [
    {"name": "delta", "low": 0.5, "high": 4.0},
    {"name": "theta", "low": 4.0, "high": 8.0},
    {"name": "alpha", "low": 8.0, "high": 13.0},
    {"name": "mu", "low": 8.0, "high": 12.0},
    {"name": "beta", "low": 13.0, "high": 30.0},
    {"name": "gamma", "low": 30.0, "high": 45.0},
]
REQUIRED = ("id", "name", "synthetic")


@lru_cache(maxsize=1)
def load_paradigms() -> dict:
    data = json.loads((HERE / "paradigms.json").read_text(encoding="utf-8"))
    for p in data["presets"]:
        for k in REQUIRED:
            if k not in p:
                raise ValueError(f"preset is missing required field {k!r}")
        if p["synthetic"] not in GENERATORS:
            raise ValueError(f"unknown synthetic generator {p['synthetic']!r}")
    return data


def get_preset(pid: str | None) -> dict | None:
    if not pid or pid == "custom":
        return None
    for p in load_paradigms()["presets"]:
        if p["id"] == pid:
            return p
    raise KeyError(pid)


def freq_max(sfreq: float) -> float:
    return float(min(45.0, 0.9 * sfreq / 2.0))


def custom_defaults(times: np.ndarray, channels: list[str], sfreq: float, baseline) -> dict:
    """The "custom" behaviour (last bullet of section 3.4)."""
    fmax = freq_max(sfreq)
    lo_w, hi_w = 4.0, min(30.0, fmax)
    wp = [{"label": "Full epoch", "full": True}]
    if baseline is not None:
        wp.append({"label": "Baseline only (control)", "start": baseline["start"], "end": baseline["end"]})
    first_two = channels[:2] if len(channels) >= 2 else channels * 2
    band = [1.0, min(40.0, fmax)]
    return {
        "id": "custom",
        "name": "Custom",
        "classNames": None,
        "eventLabel": "event",
        "baseline": baseline,
        "zone": None,
        "defaultWindow": {"start": float(times[0]), "end": float(times[-1])},
        "defaultBand": {"low": 1.0, "high": float(min(40.0, fmax)), "order": 4},
        "windowPresets": wp,
        "bandPresets": [],
        "channelPresets": [],
        "probe": {
            "x": {"channel": first_two[0], "type": "log_band_power", "band": band, "followBand": True},
            "y": {"channel": first_two[1], "type": "log_band_power", "band": band, "followBand": True},
        },
        "mapMetric": {"metric": "separability_bandpower", "band": None, "mapClass": 0},
        "keyBands": [],
        "stimulusFrequencies": None,
        "defaultFeature": {
            "family": "band_power",
            "settings": {
                "bands": [
                    {"name": "theta", "low": 4.0, "high": 8.0},
                    {"name": "alpha", "low": 8.0, "high": 13.0},
                    {"name": "beta", "low": 13.0, "high": 30.0},
                ]
            },
        },
        "recommendedFamilies": [],
        "waveletRange": [lo_w, hi_w],
        "hints": None,
        "facts": None,
    }


def resolve_preset(pid: str | None, times, channels, sfreq, baseline) -> dict:
    """Preset merged over the custom behaviour (every optional field falls back to custom)."""
    base = custom_defaults(times, channels, sfreq, baseline)
    p = get_preset(pid)
    if p is None:
        return base
    out = dict(base)
    for k, v in p.items():
        out[k] = v
    # Window presets of a preset already include "Full epoch"; add the baseline control when it exists.
    fmax = freq_max(sfreq)
    lo, hi = p.get("waveletRange", base["waveletRange"])
    out["waveletRange"] = [float(lo), float(min(hi, fmax))]
    return out


# ------------------------------------------------------------------------------------------------
# Synthetic generators
# ------------------------------------------------------------------------------------------------


def pink_noise(rng: np.random.Generator, shape: tuple, sfreq: float, rms: float = 10.0) -> np.ndarray:
    """1/f noise via spectral shaping, scaled to the given RMS (uV) per series."""
    n = shape[-1]
    white = rng.standard_normal(shape)
    spec = np.fft.rfft(white, axis=-1)
    f = np.fft.rfftfreq(n, 1.0 / sfreq)
    f[0] = f[1]
    spec = spec / np.sqrt(f)
    x = np.fft.irfft(spec, n=n, axis=-1)
    x = x - x.mean(axis=-1, keepdims=True)
    x = x / (x.std(axis=-1, keepdims=True) + 1e-12) * rms
    return x


def smooth_step(t: np.ndarray, t0: float, ramp: float) -> np.ndarray:
    """Smooth 0 -> 1 rise starting at t0 over `ramp` seconds (raised cosine)."""
    u = np.clip((t - t0) / ramp, 0.0, 1.0)
    return 0.5 - 0.5 * np.cos(np.pi * u)


def _blink(t: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    # 150 ms Gaussian pulse (150 ms = +-2 sigma), 80 uV, at a random time inside the epoch.
    c = rng.uniform(t[0] + 0.1, t[-1] - 0.1)
    sigma = 0.150 / 4.0
    return 80.0 * np.exp(-0.5 * ((t - c) / sigma) ** 2)


# Generator tuning (section 3.4.1: "tune the generator, not the display"). With the spec's nominal values the
# default pipelines landed below their accuracy targets; these are the documented tuned values (README).
MI_MU_GAIN = 2.0  # mu amplitude at central channels 12 uV instead of about 6 uV
MI_ERD_SD = 0.10  # ERD depth spread (sd) 0.10 instead of 0.2
P300_GAIN = 4.5  # P300 amplitudes x4.5 (Pz 27 uV): the 1 Hz high-pass on the cropped window removes most of it
SSVEP_ALPHA_GAIN = 0.5  # occipital alpha 1.5 uV at Oz/O1/O2 (0.75 elsewhere): it sits in the SNR reference bins


def make_motor_imagery(seed: int = SEED, mu_gain: float = MI_MU_GAIN, erd_sd: float = MI_ERD_SD, alpha_on: bool = True):
    p = get_preset("motor_imagery")
    rng = np.random.default_rng(seed)
    sf = float(p["sfreq"])
    ns = p["epoch"]["n_samples"]
    t = p["epoch"]["tmin"] + np.arange(ns) / sf
    ch = p["channels"]
    nch = len(ch)
    n_trials = 100
    y = np.repeat([0, 1], n_trials // 2)
    rng.shuffle(y)
    idx = {c: i for i, c in enumerate(ch)}
    central = ["C3", "C1", "Cz", "C2", "C4", "CP3", "CP1", "CPz", "CP2", "CP4", "FC3", "FC1", "FCz", "FC2", "FC4", "C5", "C6"]
    occ_strong = ["POz", "Pz", "P1", "P2"]
    g_mu = np.full(nch, 1.0)
    g_mu[[idx[c] for c in central]] = 6.0
    g_beta = np.full(nch, 0.5)
    g_beta[[idx[c] for c in central]] = 3.0
    g_alpha = np.full(nch, 2.0)
    g_alpha[[idx[c] for c in occ_strong]] = 8.0
    # Spatial spread of ERD around each hemisphere's C-channel.
    spread = {
        "C4": {"C4": 1.0, "C2": 0.6, "CP4": 0.6, "FC4": 0.6, "Cz": 0.25},
        "C3": {"C3": 1.0, "C1": 0.6, "CP3": 0.6, "FC3": 0.6, "Cz": 0.25},
    }
    frontal = [idx[c] for c in ["Fz", "FC1", "FCz", "FC2"]]
    erd_env = smooth_step(t, 0.5, 0.3)  # starts at +0.5 s, 0.3 s ramp, lasts to the end
    X = pink_noise(rng, (n_trials, nch, ns), sf, 10.0)
    for k in range(n_trials):
        contra, ipsi = ("C4", "C3") if y[k] == 0 else ("C3", "C4")  # left hand -> C4, right hand -> C3
        d_c = float(np.clip(rng.normal(0.55, erd_sd), 0.0, 0.9))
        d_i = float(np.clip(rng.normal(0.15, erd_sd), 0.0, 0.9))
        att = np.zeros(nch)
        for name, gsp in spread[contra].items():
            att[idx[name]] = max(att[idx[name]], d_c * gsp)
        for name, gsp in spread[ipsi].items():
            att[idx[name]] = max(att[idx[name]], d_i * gsp)
        f_mu = rng.uniform(9.5, 11.5)
        f_beta = rng.uniform(18.0, 24.0)
        amp = rng.uniform(0.6, 1.4)  # trial-to-trial mu amplitude variability
        ph_a = rng.uniform(0, 2 * np.pi)
        alpha = np.sin(2 * np.pi * 10.0 * t + ph_a)
        for c in range(nch):
            ph_m, ph_b = rng.uniform(0, 2 * np.pi, 2)
            mu = mu_gain * amp * g_mu[c] * np.sin(2 * np.pi * f_mu * t + ph_m) * (1.0 - att[c] * erd_env)
            beta = g_beta[c] * np.sin(2 * np.pi * f_beta * t + ph_b) * (1.0 - 0.5 * att[c] * erd_env)
            X[k, c] += mu + beta + (g_alpha[c] * alpha if alpha_on else 0.0)
        if rng.random() < 0.08:
            b = _blink(t, rng)
            for c in frontal:
                X[k, c] += b
    return X.astype(np.float32), y.astype(int), t, sf, ch, list(p["classNames"])


def make_erp_p300(seed: int = SEED, p300_gain: float = P300_GAIN):
    p = get_preset("erp_p300")
    rng = np.random.default_rng(seed)
    sf = float(p["sfreq"])
    ns = p["epoch"]["n_samples"]
    t = p["epoch"]["tmin"] + np.arange(ns) / sf
    ch = p["channels"]
    nch = len(ch)
    n_trials = 200
    y = np.repeat([0, 1], n_trials // 2)
    rng.shuffle(y)
    idx = {c: i for i, c in enumerate(ch)}
    g_alpha = np.full(nch, 2.0)
    for c in ["Oz", "PO7", "PO8", "P3", "P4"]:
        g_alpha[idx[c]] = 6.0
    g_vis = np.full(nch, -1.0)
    for c in ["Oz", "PO7", "PO8"]:
        g_vis[idx[c]] = -3.0
    g_p3 = np.zeros(nch)
    for c, a in {"Pz": 6.0, "Cz": 5.0, "P3": 4.0, "P4": 4.0, "Fz": 3.0, "Oz": 1.5, "PO7": 1.5, "PO8": 1.5}.items():
        g_p3[idx[c]] = a
    vis = np.exp(-0.5 * ((t - 0.17) / 0.03) ** 2)
    X = pink_noise(rng, (n_trials, nch, ns), sf, 10.0)
    for k in range(n_trials):
        ph = rng.uniform(0, 2 * np.pi)
        X[k] += g_alpha[:, None] * np.sin(2 * np.pi * 10.0 * t + ph)[None, :]
        X[k] += g_vis[:, None] * vis[None, :]
        if y[k] == 1:
            c0 = rng.uniform(0.30, 0.45)
            fac = rng.uniform(0.5, 1.5)
            p3 = np.exp(-0.5 * ((t - c0) / 0.06) ** 2)
            X[k] += p300_gain * fac * g_p3[:, None] * p3[None, :]
        if rng.random() < 0.08:
            X[k, idx["Fz"]] += _blink(t, rng)
    return X.astype(np.float32), y.astype(int), t, sf, ch, list(p["classNames"])


def make_ssvep(seed: int = SEED, alpha_gain: float = SSVEP_ALPHA_GAIN):
    p = get_preset("ssvep")
    rng = np.random.default_rng(seed)
    sf = float(p["sfreq"])
    ns = p["epoch"]["n_samples"]
    t = p["epoch"]["tmin"] + np.arange(ns) / sf
    ch = p["channels"]
    nch = len(ch)
    freqs = p["stimulusFrequencies"]
    n_trials = 160
    y = np.repeat(np.arange(4), n_trials // 4)
    rng.shuffle(y)
    idx = {c: i for i, c in enumerate(ch)}
    g_alpha = np.full(nch, 1.5)
    for c in ["Oz", "O1", "O2"]:
        g_alpha[idx[c]] = 3.0
    A = np.zeros(nch)
    for c, a in {"Oz": 4.0, "O1": 3.0, "O2": 3.0, "POz": 3.0, "PO3": 2.5, "PO4": 2.5, "PO7": 2.0, "PO8": 2.0}.items():
        A[idx[c]] = a
    ramp = smooth_step(t, 0.0, 0.15)
    X = pink_noise(rng, (n_trials, nch, ns), sf, 10.0)
    for k in range(n_trials):
        f = freqs[y[k]]
        s = rng.uniform(0.5, 1.5)
        ph1, ph2, ph_a = rng.uniform(0, 2 * np.pi, 3)
        resp = ramp * (np.sin(2 * np.pi * f * t + ph1) + 0.4 * np.sin(2 * np.pi * 2 * f * t + ph2))
        X[k] += (A * s)[:, None] * resp[None, :]
        X[k] += alpha_gain * g_alpha[:, None] * np.sin(2 * np.pi * 10.0 * t + ph_a)[None, :]
    return X.astype(np.float32), y.astype(int), t, sf, ch, list(p["classNames"])


GENERATORS = {
    "make_motor_imagery": make_motor_imagery,
    "make_erp_p300": make_erp_p300,
    "make_ssvep": make_ssvep,
}


def generate(pid: str):
    p = get_preset(pid)
    if p is None:
        raise KeyError(pid)
    return GENERATORS[p["synthetic"]](SEED)
