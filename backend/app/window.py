"""Time window (Page 2): crop, probe features and separability. Also shared settings resolution."""

from __future__ import annotations

import numpy as np
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.model_selection import StratifiedKFold, cross_val_score

from . import band as bmod
from .contract import SEED, ValidationError, chance_level, cv_folds, encode_f32


def crop_idx(times: np.ndarray, start: float, end: float) -> np.ndarray:
    """Half-open window [start, end): 0.0 to 2.0 s at 250 Hz gives 500 samples."""
    eps = 1e-9
    return np.flatnonzero((times >= start - eps) & (times < end - eps))


def crop(ds, start: float, end: float) -> tuple[np.ndarray, np.ndarray]:
    idx = crop_idx(ds.times, start, end)
    if len(idx) < 2:
        raise ValidationError(f"The window {start:g} to {end:g} s contains fewer than 2 samples.")
    return ds.X[:, :, idx], ds.times[idx]


def resolve(ds, settings: dict) -> dict:
    """Settings -> concrete selection on this dataset (free mode uses the preset defaults)."""
    preset = ds.preset()
    w = settings.get("window") or preset["defaultWindow"]
    start, end = float(w["start"]), float(w["end"])
    start = max(start, float(ds.times[0]))
    end = min(end, float(ds.times[-1]) + 1.0 / ds.sfreq)
    if end <= start:
        raise ValidationError("The window end must be after its start.")
    chans = settings.get("channels")
    if chans is None:
        chans = list(ds.ch_names)
    lower = {c.lower(): i for i, c in enumerate(ds.ch_names)}
    ch_idx = [lower[c.lower()] for c in chans if c.lower() in lower]
    if not ch_idx:
        raise ValidationError("At least one channel must stay selected.")
    b = settings.get("band") or preset["defaultBand"]
    fmax = bmod.freq_max(ds.sfreq) if hasattr(bmod, "freq_max") else min(45.0, 0.45 * ds.sfreq)
    low = max(float(b["low"]), 0.5)
    high = min(float(b["high"]), fmax)
    return {
        "window": {"start": start, "end": end},
        "ch_idx": ch_idx,
        "channels": [ds.ch_names[i] for i in ch_idx],
        "band": {"low": low, "high": high, "order": int(b.get("order", 4))},
        "preset": preset,
    }


def probe_values(ds, Xw: np.ndarray, probe: dict, band: dict) -> np.ndarray:
    ch = probe.get("channel")
    lower = {c.lower(): i for i, c in enumerate(ds.ch_names)}
    if ch is None or ch.lower() not in lower:
        raise ValidationError(f"Probe channel {ch!r} is not in the data.")
    x = Xw[:, lower[ch.lower()], :].astype(np.float64)
    if probe.get("type") == "mean_amplitude":
        return x.mean(axis=-1)
    bb = probe.get("band")
    if probe.get("followBand") or not bb:
        bb = [band["low"], band["high"]]
    f, P = bmod.psd(x, ds.sfreq)
    bp = bmod.integrate(f, P, float(bb[0]), float(bb[1]))
    return np.log10(bp + 1e-12)


def separability(F: np.ndarray, y: np.ndarray, folds: int) -> dict:
    counts = np.unique(y, return_counts=True)[1].tolist()
    k, msg = cv_folds(counts, folds)
    cv = StratifiedKFold(n_splits=k, shuffle=True, random_state=SEED)
    scores = cross_val_score(LinearDiscriminantAnalysis(), F, y, cv=cv)
    return {
        "accuracy": float(scores.mean()),
        "std": float(scores.std()),
        "chance": chance_level(counts),
        "folds": k,
        "foldMessage": msg,
    }


def window_response(ds, settings: dict, body: dict) -> dict:
    from .dataset import display_trials, envelopes

    sel = resolve(ds, settings)
    Xw, tw = crop(ds, sel["window"]["start"], sel["window"]["end"])
    probe = body.get("probe") or settings.get("probe") or sel["preset"]["probe"]
    px = probe_values(ds, Xw, probe["x"], sel["band"])
    py = probe_values(ds, Xw, probe["y"], sel["band"])
    F = np.c_[px, py]
    n_classes = len(ds.class_names)
    classes = settings.get("probeClasses", list(range(n_classes)))
    if (
        not isinstance(classes, list)
        or any(type(k) is not int or not 0 <= k < n_classes for k in classes)
        or len(set(classes)) != len(classes)
        or not classes
    ):
        raise ValidationError("Choose at least one distinct dataset class for the probe.")
    selected = np.isin(ds.y, classes)
    sep = separability(F[selected], ds.y[selected], int(settings.get("cvFolds", 5))) if len(classes) >= 2 else None
    trials = display_trials(ds)
    return {
        "shape": [int(Xw.shape[0]), int(Xw.shape[1]), int(Xw.shape[2])],
        "window": sel["window"],
        "nSamples": int(Xw.shape[2]),
        "probeClasses": classes,
        "env": encode_f32(envelopes(ds, trials)),
        "probe": {"x": encode_f32(px), "y": encode_f32(py), "spec": probe},
        "separability": sep,
    }
