"""Dataset loading (sample, CSV, NPZ), validation and the dataset response (sections 3.0 to 3.3)."""

from __future__ import annotations

import io
import json
import uuid
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.signal import resample_poly

from . import channels as chmod
from . import montage as mmod
from . import paradigms as pmod
from .contract import (
    ValidationError,
    class_order,
    encode_f32,
    settings_hash,
    validate_limits,
)

RIBBON_POINTS = 200
RIBBON_POOL = 2400
VAL_POOL = 4000


@dataclass
class Dataset:
    id: str
    X: np.ndarray  # (trials, channels, samples), microvolts, FULL uncropped epoch (immutable)
    y: np.ndarray  # int labels 0..K-1
    class_names: list[str]
    ch_names: list[str]
    sfreq: float
    times: np.ndarray
    baseline: dict | None
    source: str  # sample | csv | npz
    paradigm: str  # active preset id or "custom"
    montage: str = "standard_1005"
    ch_pos: np.ndarray | None = None  # NPZ override (channels x 2)
    provenance: dict = field(default_factory=dict)
    upstream: dict | None = None
    extras: dict = field(default_factory=dict)  # baseline_X, tfr, X_spatial (NPZ optional keys)
    warnings: list[str] = field(default_factory=list)
    sample_id: str | None = None
    trial_ids: list[str] | None = None

    @property
    def shape(self) -> list[int]:
        return [int(s) for s in self.X.shape]

    @property
    def counts(self) -> list[int]:
        return [int((self.y == k).sum()) for k in range(len(self.class_names))]

    def positions(self) -> list[list[float] | None]:
        if self.ch_pos is not None:
            return [[float(p[0]), float(p[1])] if np.all(np.isfinite(p)) else None for p in self.ch_pos]
        return mmod.positions_for(self.ch_names, self.montage)

    def preset(self) -> dict:
        return pmod.resolve_preset(self.paradigm, self.times, self.ch_names, self.sfreq, self.baseline)


DATASETS: dict[str, Dataset] = {}


def register(ds: Dataset) -> Dataset:
    # Keep memory bounded: at most 8 datasets.
    while len(DATASETS) >= 8:
        DATASETS.pop(next(iter(DATASETS)))
    DATASETS[ds.id] = ds
    return ds


def get(dataset_id: str) -> Dataset:
    ds = DATASETS.get(dataset_id)
    if ds is None:
        raise ValidationError("The dataset is no longer loaded on the server. Please load it again.")
    return ds


def default_baseline(times: np.ndarray) -> dict | None:
    if times[0] < 0:
        return {"start": float(times[0]), "end": 0.0}
    return None


def _check_baseline(b: dict | None, times: np.ndarray) -> dict | None:
    if b is None:
        return None
    s, e = float(b["start"]), float(b["end"])
    if not (e > s):
        raise ValidationError("Baseline end must be after baseline start.")
    if s < times[0] - 1e-9 or e > times[-1] + 1.0 / max(1, len(times)) + 1e-6:
        raise ValidationError(f"Baseline {s:g} to {e:g} s lies outside the epoch ({times[0]:g} to {times[-1]:g} s).")
    return {"start": s, "end": e}


# ------------------------------------------------------------------------------------------------
def load_sample(pid: str) -> Dataset:
    X, y, t, sf, ch, cn = pmod.generate(pid)
    p = pmod.get_preset(pid)
    ds = Dataset(
        id=uuid.uuid4().hex[:12],
        X=X,
        y=y,
        class_names=cn,
        ch_names=list(ch),
        sfreq=sf,
        times=t.astype(np.float64),
        baseline=p.get("baseline"),
        source="sample",
        paradigm=pid,
        provenance={"source": "sample preset", "preset": pid, "units": "uV", "artifact_steps": []},
        sample_id=pid,
    )
    return register(ds)


def parse_csv(
    raw: bytes,
    sfreq: float,
    tmin: float,
    baseline: dict | None,
    montage: str,
    interpret: str,
) -> Dataset:
    errs: list[str] = []
    try:
        df = pd.read_csv(io.BytesIO(raw), dtype={"label": str, "channel": str})
    except Exception as e:  # noqa: BLE001
        raise ValidationError(f"Could not read the CSV file: {e}") from e
    cols = [str(c).strip() for c in df.columns]
    df.columns = cols
    missing = [c for c in ("trial", "label", "channel") if c not in cols]
    scols = [c for c in cols if c.startswith("s") and c[1:].isdigit()]
    if missing:
        errs.append(f"Missing column(s): {', '.join(missing)}. Expected trial, label, channel, s0, s1, ...")
    if not scols:
        errs.append("No sample columns found (expected s0, s1, ..., s{N-1}).")
    if errs:
        raise ValidationError(errs)
    scols = sorted(scols, key=lambda c: int(c[1:]))
    if [int(c[1:]) for c in scols] != list(range(len(scols))):
        errs.append("Sample columns must be consecutive: s0, s1, ..., s{N-1}.")
    vals = df[scols].apply(pd.to_numeric, errors="coerce")
    bad = vals.isna() & df[scols].notna()
    if bad.values.any():
        r = int(np.argwhere(bad.values)[0][0])
        errs.append(f"Non-numeric sample value(s), first in data row {r + 2}.")
    empty = df[scols].isna().values
    if empty.any():
        rows = np.unique(np.argwhere(empty)[:, 0])
        errs.append(f"Unequal trial lengths: {len(rows)} row(s) have missing sample values (first in data row {int(rows[0]) + 2}).")
    if df["label"].isna().any() or df["channel"].isna().any() or df["trial"].isna().any():
        errs.append("Every row needs a trial, a label and a channel.")
    if errs:
        raise ValidationError(errs)
    df["channel"] = df["channel"].astype(str).str.strip()
    df["label"] = df["label"].astype(str).str.strip()
    df["trial"] = df["trial"].astype(str).str.strip()
    dup = df.duplicated(subset=["trial", "channel"])
    if dup.any():
        r = int(np.flatnonzero(dup.values)[0])
        errs.append(f"Duplicate (trial, channel) rows, first: trial {df['trial'].iloc[r]}, channel {df['channel'].iloc[r]}.")
    # Channel order: order of first appearance.
    ch_names = list(dict.fromkeys(df["channel"].tolist()))
    trials = list(dict.fromkeys(df["trial"].tolist()))
    groups = df.groupby("trial", sort=False)
    for tr, g in groups:
        names = set(g["channel"])
        if names != set(ch_names):
            missing_ch = sorted(set(ch_names) - names)
            errs.append(
                f"Trial {tr} is missing channel(s): {', '.join(missing_ch[:6])}" + ("..." if len(missing_ch) > 6 else "") + "."
                if missing_ch
                else f"Trial {tr} has an inconsistent channel set."
            )
            if len(errs) > 6:
                break
        if g["label"].nunique() != 1:
            errs.append(f"Trial {tr} has more than one label.")
    if errs:
        raise ValidationError(errs)
    n_s = len(scols)
    order = class_order(df["label"].unique().tolist())
    lab_of = {}
    for tr, g in groups:
        lab_of[tr] = g["label"].iloc[0]
    counts = [sum(1 for t in trials if lab_of[t] == c) for c in order]
    validate_limits(len(trials), len(ch_names), n_s, sfreq, counts)
    X = np.zeros((len(trials), len(ch_names)), dtype=object)
    tri = {t: i for i, t in enumerate(trials)}
    chi = {c: i for i, c in enumerate(ch_names)}
    arr = np.zeros((len(trials), len(ch_names), n_s), dtype=np.float32)
    v = vals.values.astype(np.float32)
    ti = df["trial"].map(tri).values
    ci = df["channel"].map(chi).values
    arr[ti, ci, :] = v
    del X
    if not np.all(np.isfinite(arr)):
        raise ValidationError("The CSV contains non-finite sample values.")
    times = tmin + np.arange(n_s) / sfreq
    if baseline is None:
        baseline = default_baseline(times)
    baseline = _check_baseline(baseline, times)
    y = np.array([order.index(lab_of[t]) for t in trials], dtype=int)
    interp = interpret or "custom"
    ds = Dataset(
        id=uuid.uuid4().hex[:12],
        X=arr,
        y=y,
        class_names=order,
        ch_names=ch_names,
        sfreq=float(sfreq),
        times=times,
        baseline=baseline,
        source="csv",
        paradigm="custom",
        montage=montage,
        provenance={"source": "csv", "units": "uV", "artifact_steps": []},
        trial_ids=trials,
    )
    if interp != "custom":
        apply_interpret(ds, interp)
    return register(ds)


def parse_npz(raw: bytes, montage: str, interpret: str) -> Dataset:
    try:
        z = np.load(io.BytesIO(raw), allow_pickle=False)
    except Exception as e:  # noqa: BLE001
        raise ValidationError(f"Could not read the NPZ file: {e}") from e
    errs: list[str] = []
    req = ["X", "y", "sfreq", "ch_names", "times", "meta_json"]
    missing = [k for k in req if k not in z.files]
    if missing:
        raise ValidationError(f"Missing required NPZ key(s): {', '.join(missing)}.")
    X = z["X"]
    if X.ndim != 3:
        errs.append(f"X must be 3-D (epochs x channels x samples); got shape {list(X.shape)}.")
    if X.dtype != np.float32:
        errs.append(f"X must be float32; got {X.dtype}.")
    yv = z["y"]
    if yv.ndim != 1 or not np.issubdtype(yv.dtype, np.integer):
        errs.append("y must be a 1-D integer array.")
    try:
        sfreq = float(np.asarray(z["sfreq"]).reshape(()))
    except Exception:  # noqa: BLE001
        sfreq = -1.0
        errs.append("sfreq must be a float scalar.")
    ch_names = [str(c) for c in np.asarray(z["ch_names"]).tolist()]
    times = np.asarray(z["times"], dtype=np.float64)
    try:
        meta = json.loads(str(np.asarray(z["meta_json"]).reshape(())))
    except Exception:  # noqa: BLE001
        meta = {}
        errs.append("meta_json must be a JSON string.")
    if errs:
        raise ValidationError(errs)
    if meta.get("version") != "1":
        errs.append('meta_json must contain "version": "1".')
    if meta.get("units") != "uV":
        errs.append('meta_json "units" must be "uV".')
    n, c, s = X.shape
    if len(yv) != n:
        errs.append(f"y has {len(yv)} labels but X has {n} epochs.")
    if len(ch_names) != c:
        errs.append(f"ch_names has {len(ch_names)} names but X has {c} channels.")
    if len(set(ch_names)) != len(ch_names):
        errs.append("ch_names contains duplicate names.")
    if any(not nm.strip() for nm in ch_names):
        errs.append("ch_names contains empty names.")
    if times.ndim != 1 or len(times) != s:
        errs.append(f"times must have one value per sample ({s}).")
    if not np.all(np.isfinite(X)):
        errs.append("X contains non-finite values.")
    if errs:
        raise ValidationError(errs)
    if "class_names" in z.files:
        class_names = [str(v) for v in np.asarray(z["class_names"]).tolist()]
        uniq = sorted(set(int(v) for v in yv))
        if uniq and (min(uniq) < 0 or max(uniq) >= len(class_names)):
            raise ValidationError("y contains labels outside the range of class_names.")
        y = yv.astype(int)
    else:
        order = class_order([int(v) for v in yv])
        class_names = order
        y = np.array([order.index(str(int(v))) for v in yv], dtype=int)
    counts = [int((y == k).sum()) for k in range(len(class_names))]
    validate_limits(n, c, s, sfreq, counts)
    ch_pos = None
    if "ch_pos" in z.files:
        cp = np.asarray(z["ch_pos"], dtype=float)
        if cp.shape != (c, 2):
            raise ValidationError(f"ch_pos must be channels x 2; got {list(cp.shape)}.")
        ch_pos = cp
    extras = {}
    if "baseline_X" in z.files:
        bx = z["baseline_X"]
        if bx.ndim != 3 or bx.shape[0] != n or bx.shape[1] != c:
            raise ValidationError("baseline_X must be epochs x channels x samples_b.")
        if "baseline_times" not in z.files:
            raise ValidationError("baseline_X requires baseline_times.")
        extras["baseline_X"] = bx.astype(np.float32)
        extras["baseline_times"] = np.asarray(z["baseline_times"], dtype=float)
    if "tfr" in z.files:
        tfr = z["tfr"]
        if tfr.ndim != 4 or tfr.shape[0] != n or tfr.shape[1] != c:
            raise ValidationError("tfr must be epochs x channels x freqs x times.")
        if "tfr_freqs" not in z.files or "tfr_times" not in z.files:
            raise ValidationError("tfr requires tfr_freqs and tfr_times.")
        extras["tfr"] = tfr.astype(np.float32)
        extras["tfr_freqs"] = np.asarray(z["tfr_freqs"], dtype=float)
        extras["tfr_times"] = np.asarray(z["tfr_times"], dtype=float)
    if "X_spatial" in z.files:
        xs = z["X_spatial"]
        if xs.ndim != 3 or xs.shape[0] != n:
            raise ValidationError("X_spatial must be epochs x components x samples.")
        extras["X_spatial"] = xs.astype(np.float32)
    X = np.array(X, dtype=np.float32)
    X.setflags(write=False)  # upstream data is immutable
    baseline = default_baseline(times)
    steps = meta.get("artifact_provenance") or []
    ds = Dataset(
        id=uuid.uuid4().hex[:12],
        X=X,
        y=y,
        class_names=class_names,
        ch_names=ch_names,
        sfreq=sfreq,
        times=times,
        baseline=baseline,
        source="npz",
        paradigm="custom",
        montage=montage,
        ch_pos=ch_pos,
        provenance={
            "source": "upstream npz",
            "units": meta.get("units"),
            "artifact_steps": steps,
            "event_id": meta.get("event_id"),
        },
        upstream={"settings": meta.get("upstream_settings")} if meta.get("upstream_settings") else None,
        extras=extras,
    )
    if interpret and interpret != "custom":
        apply_interpret(ds, interpret)
    return register(ds)


def apply_interpret(ds: Dataset, pid: str) -> list[str]:
    """Apply a preset's interpretation to loaded data (data itself unchanged)."""
    warnings: list[str] = []
    if pid != "custom":
        p = pmod.get_preset(pid)
        need: set[str] = set()
        for cp in p.get("channelPresets", []):
            need.update(cp["channels"])
        for ax in ("x", "y"):
            need.add(p["probe"][ax]["channel"])
        lower = {c.lower() for c in ds.ch_names}
        lacking = sorted(c for c in need if c.lower() not in lower)
        if lacking:
            warnings.append(f"The data lacks channel(s) used by the {p['name']} preset: {', '.join(lacking)}; those are dropped.")
    ds.paradigm = pid
    ds.warnings = warnings
    return warnings


# ------------------------------------------------------------------------------------------------
def stratified_subset(labels: np.ndarray, k: int, n_classes: int) -> list[int]:
    """Same deterministic algorithm as frontend/src/engine/slots.ts (largest remainder, evenly spaced)."""
    n = len(labels)
    if k >= n:
        return list(range(n))
    by = [list(np.flatnonzero(labels == c)) for c in range(n_classes)]
    quotas = [len(b) * k / n for b in by]
    alloc = [min(len(by[c]), int(np.floor(q))) for c, q in enumerate(quotas)]
    left = k - sum(alloc)
    order = sorted(range(n_classes), key=lambda c: (-(quotas[c] - np.floor(quotas[c])), c))
    j = 0
    while left > 0 and j < 2 * n_classes:
        c = order[j % n_classes]
        if alloc[c] < len(by[c]):
            alloc[c] += 1
            left -= 1
        j += 1
    chosen = []
    for c, members in enumerate(by):
        m = alloc[c]
        for i in range(m):
            chosen.append(int(members[int(np.floor((i + 0.5) * len(members) / m))]))
    return sorted(chosen)


def display_trials(ds: Dataset) -> list[int]:
    n, c, _ = ds.X.shape
    m = max(0, min(n, RIBBON_POOL // max(1, c), 200))
    return stratified_subset(ds.y, m, len(ds.class_names))


def to_points(x: np.ndarray, n: int = RIBBON_POINTS) -> np.ndarray:
    """Downsample the last axis to n points with an anti-alias filter (polyphase), or interpolate up."""
    s = x.shape[-1]
    if s == n:
        return x.astype(np.float32)
    if s > n:
        from math import gcd

        g = gcd(n, s)
        return resample_poly(x, n // g, s // g, axis=-1).astype(np.float32)
    src = np.linspace(0, 1, s)
    dst = np.linspace(0, 1, n)
    return np.apply_along_axis(lambda r: np.interp(dst, src, r), -1, x).astype(np.float32)


def display_payload(ds: Dataset) -> dict:
    trials = display_trials(ds)
    Xd = ds.X[trials].astype(np.float64)
    Xd = Xd - Xd.mean(axis=-1, keepdims=True)
    pts = to_points(Xd)
    scale = float(np.percentile(np.abs(pts), 99)) if pts.size else 1.0
    scale = scale if scale > 0 else 1.0
    ribbons = np.clip(pts / (2.2 * scale), -0.5, 0.5)
    env = envelopes(ds, trials)
    return {
        "trials": trials,
        "points": RIBBON_POINTS,
        "ribbons": encode_f32(ribbons),
        "scale_uv": scale,
        "env": encode_f32(env),
    }


def envelopes(ds: Dataset, trials: list[int]) -> np.ndarray:
    """Mean-across-channels absolute-amplitude envelope per displayed trial, smoothed (display only)."""
    Xd = ds.X[trials].astype(np.float64)
    Xd = Xd - Xd.mean(axis=-1, keepdims=True)
    a = np.abs(Xd).mean(axis=1)
    w = max(1, int(round(0.05 * ds.sfreq)))
    ker = np.ones(w) / w
    sm = np.apply_along_axis(lambda r: np.convolve(r, ker, mode="same"), -1, a)
    pts = to_points(sm)
    top = float(np.percentile(pts, 99)) if pts.size else 1.0
    top = top if top > 0 else 1.0
    return np.clip(pts / top, 0.0, 1.0) - 0.5  # unit space: -0.5 (zero) to +0.5 (max)


def dataset_response(ds: Dataset) -> dict:
    pos = ds.positions()
    preset = ds.preset()
    return {
        "id": ds.id,
        "hash": settings_hash(ds.id, ds.paradigm),
        "shape": ds.shape,
        "source": ds.source,
        "sampleId": ds.sample_id,
        "paradigm": ds.paradigm,
        "preset": preset,
        "sfreq": ds.sfreq,
        "tmin": float(ds.times[0]),
        "times": encode_f32(ds.times),
        "labels": [int(v) for v in ds.y],
        "classNames": ds.class_names,
        "classCounts": ds.counts,
        "channels": ds.ch_names,
        "positions": pos,
        "regions": [chmod.region_of(c) for c in ds.ch_names],
        "baseline": ds.baseline,
        "montage": ds.montage,
        "display": display_payload(ds),
        "layout": chmod.layout_info(ds.ch_names, pos),
        "electrodePresets": chmod.resolve_presets(ds.ch_names, pos, preset),
        "asymmetryPairs": chmod.detect_pairs(ds.ch_names, pos),
        "provenance": ds.provenance,
        "upstream": ds.upstream,
        "hasTfr": "tfr" in ds.extras,
        "warnings": ds.warnings,
    }
