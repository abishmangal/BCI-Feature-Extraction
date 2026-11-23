"""Channels (Page 3): regions, layout tag, electrode presets, asymmetry pairs, sparklines and effect map."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.interpolate import RBFInterpolator
from sklearn.metrics import roc_auc_score

from .contract import SEED, ValidationError, encode_f32

HERE = Path(__file__).parent
REGION_ORDER = ["frontal", "central", "temporal", "parietal", "occipital", "other"]


def region_of(name: str) -> str:
    """Region from the channel name prefix (letters before the first digit or z)."""
    m = re.match(r"^([A-Za-z]+?)(?:\d|z|Z|$)", name.strip())
    pre = (m.group(1) if m else name).upper()
    if pre.endswith("Z"):
        pre = pre[:-1]
    table = [
        (("FP", "AF", "F"), "frontal"),
        (("FC", "C", "CP"), "central"),
        (("FT", "T", "TP"), "temporal"),
        (("P", "PO"), "parietal"),
        (("O",), "occipital"),
    ]
    for prefixes, region in table:
        if pre in prefixes:
            return region
    return "other"


def layout_info(names: list[str], pos: list) -> dict:
    n = len(names)
    on = sum(1 for p in pos if p is not None)
    label = f"{n}-channel layout"
    return {"id": f"{n}ch", "n_channels": n, "label": label, "n_on_head": on, "n_in_tray": n - on}


@lru_cache(maxsize=1)
def generic_sets() -> dict:
    return json.loads((HERE / "electrode_presets.json").read_text(encoding="utf-8"))


def _match(names: list[str], wanted: list[str], aliases: dict) -> list[str]:
    """Case-insensitive match with old-name aliases (T3=T7, T4=T8, T5=P7, T6=P8)."""
    lower = {c.lower(): c for c in names}
    inv = {}
    for old, new in aliases.items():
        inv.setdefault(new.lower(), []).append(old.lower())
        inv.setdefault(old.lower(), []).append(new.lower())
    out = []
    for w in wanted:
        cands = [w.lower()] + inv.get(w.lower(), [])
        hit = next((lower[c] for c in cands if c in lower), None)
        if hit is not None and hit not in out:
            out.append(hit)
    return out


def farthest_point(names: list[str], pos: list, k: int) -> list[str]:
    """Deterministic farthest-point sampling over positioned channels (ties broken by data order)."""
    idx = [i for i, p in enumerate(pos) if p is not None]
    P = np.array([pos[i] for i in idx], dtype=float)
    d0 = np.hypot(P[:, 0], P[:, 1])
    first = int(np.argmin(d0))  # argmin returns the first index on ties (data order)
    chosen = [first]
    dist = np.hypot(P[:, 0] - P[first, 0], P[:, 1] - P[first, 1])
    while len(chosen) < k:
        nxt = int(np.argmax(dist))
        chosen.append(nxt)
        dist = np.minimum(dist, np.hypot(P[:, 0] - P[nxt, 0], P[:, 1] - P[nxt, 1]))
    return [names[idx[c]] for c in sorted(chosen)]


def resolve_presets(names: list[str], pos: list, preset: dict) -> list[dict]:
    n = len(names)
    out: list[dict] = []

    def add(pid, label, row, chans, total=None):
        out.append(
            {
                "id": pid,
                "label": label,
                "row": row,
                "channels": chans,
                "present": len(chans),
                "total": total if total is not None else len(chans),
            }
        )

    # Row 1: basic.
    add("all", "All channels", "basic", list(names))
    add("clear", "Clear", "basic", [])
    k = min(8, n)
    rng = np.random.default_rng(SEED)
    pick = sorted(rng.choice(n, size=k, replace=False).tolist())
    add("random", f"Random ({k})", "basic", [names[i] for i in pick])
    # Row 2: paradigm channel presets (only when all channels exist).
    lower = {c.lower(): c for c in names}
    for j, cp in enumerate(preset.get("channelPresets") or []):
        if all(c.lower() in lower for c in cp["channels"]):
            add(
                f"paradigm{j}",
                cp["label"],
                "paradigm",
                [lower[c.lower()] for c in cp["channels"]],
            )
            out[-1]["isDefault"] = bool(cp.get("default"))
            out[-1]["group"] = f"For {preset['name']}"
    # Row 3: generic sets (shown when at least 3 of their channels exist).
    g = generic_sets()
    for s in g["sets"]:
        hit = _match(names, s["channels"], g["aliases"])
        m = len(s["channels"])
        if len(hit) >= 3:
            label = s["label"] if len(hit) == m else f"{s['label']} ({len(hit)} of {m})"
            add(s["id"], label, "generic", hit, m)
    # Row 4: computed sets from 2-D positions of positioned channels only.
    positioned = [(nm, p) for nm, p in zip(names, pos, strict=False) if p is not None]
    left = [nm for nm, p in positioned if p[0] < -0.05]
    right = [nm for nm, p in positioned if p[0] > 0.05]
    if len(left) >= 3:
        add("left", "Left hemisphere", "computed", left)
    if len(right) >= 3:
        add("right", "Right hemisphere", "computed", right)
    for kk in (8, 16, 32):
        if kk < len(positioned):
            add(f"spread{kk}", f"Evenly spread {kk}", "computed", farthest_point(names, pos, kk))
    # Row 5: regions with at least two channels.
    for r in REGION_ORDER:
        members = [nm for nm in names if region_of(nm) == r]
        if len(members) >= 2:
            add(f"region:{r}", r.capitalize(), "region", members)
    return out


def detect_pairs(names: list[str], pos: list) -> list[dict]:
    """Left/right pairs: same prefix, odd/even numeric endings, mirrored x when positions exist."""
    pairs = []
    parsed = {}
    for i, nm in enumerate(names):
        m = re.match(r"^([A-Za-z]+)(\d+)$", nm.strip())
        if m:
            parsed[i] = (m.group(1).upper(), int(m.group(2)))
    for i, (pre, num) in parsed.items():
        if num % 2 == 0:
            continue
        for j, (pre2, num2) in parsed.items():
            if pre2 == pre and num2 == num + 1:
                pi, pj = pos[i], pos[j]
                if pi is not None and pj is not None:
                    if not (pi[0] < 0 < pj[0] and abs(pi[0] + pj[0]) < 0.15 and abs(pi[1] - pj[1]) < 0.15):
                        continue
                pairs.append({"left": names[i], "right": names[j]})
    pairs.sort(key=lambda p: names.index(p["left"]))
    return pairs


# ------------------------------------------------------------------------------------------------
def auc_sep(v: np.ndarray, y: np.ndarray, n_classes: int) -> float:
    """One-vs-rest macro average of |AUC - 0.5| x 2 (0..1)."""
    vals = []
    for k in range(n_classes):
        t = (y == k).astype(int)
        if t.min() == t.max():
            continue
        if np.allclose(v, v[0]):
            vals.append(0.0)
            continue
        vals.append(abs(roc_auc_score(t, v) - 0.5) * 2)
    if n_classes == 2:
        return float(vals[0]) if vals else 0.0
    return float(np.mean(vals)) if vals else 0.0


def interpolate_grid(pos: list, values: np.ndarray, n: int = 64) -> np.ndarray:
    idx = [i for i, p in enumerate(pos) if p is not None and np.isfinite(values[i])]
    g = np.linspace(-1, 1, n)
    gx, gy = np.meshgrid(g, -g)  # row 0 = top (nose)
    pts = np.c_[gx.ravel(), gy.ravel()]
    out = np.full(n * n, np.nan)
    inside = np.hypot(pts[:, 0], pts[:, 1]) <= 1.0
    if not idx:
        return out.reshape(n, n)
    P = np.array([pos[i] for i in idx], dtype=float)
    V = values[idx]
    if len(idx) < 3:
        d = np.hypot(pts[:, None, 0] - P[None, :, 0], pts[:, None, 1] - P[None, :, 1])
        out[inside] = V[np.argmin(d[inside], axis=1)]
    else:
        rbf = RBFInterpolator(P, V, kernel="thin_plate_spline", smoothing=1e-3, degree=1)
        est = rbf(pts[inside])
        lo, hi = float(np.min(V)), float(np.max(V))
        out[inside] = np.clip(est, lo, hi)
    return out.reshape(n, n)


def channel_metric(ds, sel: dict, m: dict) -> dict:
    """Per-channel values (ALL dataset channels) for one effect-map metric."""
    from . import band as bmod
    from . import window as wmod

    metric = m.get("metric") or sel["preset"]["mapMetric"]["metric"]
    n_classes = len(ds.class_names)
    mband = m.get("band") or sel["preset"]["mapMetric"].get("band") or [sel["band"]["low"], sel["band"]["high"]]
    lo, hi = float(mband[0]), float(mband[1])
    mclass = m.get("mapClass", 0)
    pair = m.get("pair") or {"a": n_classes - 1, "b": 0}
    w0, w1 = sel["window"]["start"], sel["window"]["end"]
    Xw, _ = wmod.crop(ds, w0, w1)
    diverging = False
    legend_note = None

    def per_class(v_trials: np.ndarray) -> tuple[np.ndarray, bool]:
        """Average over trials of the chosen class, or the difference A minus B."""
        if mclass == "diff":
            a = v_trials[ds.y == int(pair["a"])].mean(axis=0)
            b = v_trials[ds.y == int(pair["b"])].mean(axis=0)
            return a - b, True
        return v_trials[ds.y == int(mclass)].mean(axis=0), False

    if metric == "bandpower_change":
        if ds.baseline is None:
            raise ValidationError("Band-power change needs a baseline interval; this dataset has none.")
        # Band-pass the FULL epoch first, then take mean power in the window and the baseline.
        filt, _ = bmod.bandpass(ds.X, ds.sfreq, lo, min(hi, ds.sfreq / 2 * 0.99), 4)
        wi = wmod.crop_idx(ds.times, w0, w1)
        bi = wmod.crop_idx(ds.times, ds.baseline["start"], ds.baseline["end"])
        pw = (filt[:, :, wi] ** 2).mean(axis=-1)
        pb = (filt[:, :, bi] ** 2).mean(axis=-1)
        change = 100.0 * (pw - pb) / (pb + 1e-12)  # (trials, channels)
        vals, diverging = per_class(change)
        unit = "%"
        name = f"Band-power change vs baseline, {lo:g}-{hi:g} Hz"
        if diverging:
            shown = vals
            legend_note = "difference of percent change (A minus B)"
        else:
            shown = np.clip(-vals, 0, None)  # strength of the decrease; increases clipped to 0
            legend_note = "shows the strength of the decrease (increases are clipped to 0)"
    elif metric in ("separability_bandpower", "separability_amplitude"):
        if metric == "separability_bandpower":
            f, P = bmod.psd(Xw.astype(np.float64), ds.sfreq)
            feat = np.log10(bmod.integrate(f, P, lo, hi) + 1e-12)
            name = f"Class separability of band power, {lo:g}-{hi:g} Hz"
        else:
            feat = Xw.astype(np.float64).mean(axis=-1)
            name = "Class separability of mean amplitude"
        vals = np.array([auc_sep(feat[:, c], ds.y, n_classes) for c in range(ds.X.shape[1])])
        shown = vals
        unit = "0-1"
    elif metric == "snr":
        f, P = bmod.psd(Xw.astype(np.float64), ds.sfreq)
        sf = sel["preset"].get("stimulusFrequencies")

        def snr_at(freq: float) -> np.ndarray:
            k = int(np.argmin(np.abs(f - freq)))
            side = (np.abs(f - freq) >= 1.0 - 1e-9) & (np.abs(f - freq) <= 2.0 + 1e-9)
            return 10 * np.log10(P[..., k] / (P[..., side].mean(axis=-1) + 1e-12) + 1e-12)

        if mclass == "diff":
            fa = float(m.get("frequency") or (sf[int(pair["a"])] if sf else 10.0))
            fb = float(m.get("frequency") or (sf[int(pair["b"])] if sf else 10.0))
            va = snr_at(fa)[ds.y == int(pair["a"])].mean(axis=0)
            vb = snr_at(fb)[ds.y == int(pair["b"])].mean(axis=0)
            vals, diverging = va - vb, True
            freq_label = f"{fa:g} / {fb:g} Hz"
        else:
            fq = m.get("frequency")
            if fq is None:
                if not sf:
                    raise ValidationError("Enter a target frequency for the spectral SNR map.")
                fq = sf[int(mclass)]
            vals = snr_at(float(fq))[ds.y == int(mclass)].mean(axis=0)
            freq_label = f"{float(fq):g} Hz"
        shown = vals
        unit = "dB"
        name = f"Spectral SNR at {freq_label}"
    else:
        raise ValidationError(f"Unknown map metric {metric!r}.")
    return {
        "metric": metric,
        "name": name,
        "unit": unit,
        "values": [float(v) for v in vals],
        "shown": np.asarray(shown, dtype=float),
        "diverging": diverging,
        "note": legend_note,
        "mapClass": mclass,
        "pair": pair,
    }


def channels_response(ds, settings: dict, body: dict) -> dict:
    from . import window as wmod

    sel = wmod.resolve(ds, settings)
    Xw, tw = wmod.crop(ds, sel["window"]["start"], sel["window"]["end"])
    n_classes = len(ds.class_names)
    show = body.get("show_classes")
    if show is None:
        show = list(range(n_classes))
    # Sparklines: per included channel, class means within the window (demeaned), decimated.
    from .dataset import to_points

    spark = np.zeros((len(ds.ch_names), n_classes, 60), dtype=np.float32)
    Xd = Xw.astype(np.float64)
    for k in range(n_classes):
        mk = Xd[ds.y == k].mean(axis=0)
        mk = mk - mk.mean(axis=-1, keepdims=True)
        spark[:, k, :] = to_points(mk, 60)
    sc = float(np.percentile(np.abs(spark), 99)) or 1.0
    spark = np.clip(spark / (2.2 * sc), -0.5, 0.5)
    pos = ds.positions()
    m = body.get("map") or settings.get("map") or {}
    try:
        cm = channel_metric(ds, sel, m)
        shown = cm.pop("shown")
        grid = interpolate_grid(pos, shown)
        finite = shown[np.isfinite(shown)]
        if cm["diverging"]:
            lim = float(np.max(np.abs(finite))) if finite.size else 1.0
            vmin, vmax = -lim, lim
        else:
            vmin = 0.0 if cm["metric"] != "snr" else float(min(0.0, finite.min())) if finite.size else 0.0
            vmax = float(finite.max()) if finite.size else 1.0
            if vmax <= vmin:
                vmax = vmin + 1e-6
        cm.update(
            {
                "grid": encode_f32(np.nan_to_num(grid, nan=np.nan)),
                "vmin": vmin,
                "vmax": vmax,
                "shownValues": [float(v) for v in shown],
                "error": None,
            }
        )
    except ValidationError as e:
        cm = {"error": "; ".join(e.errors), "metric": m.get("metric")}
    return {
        "shape": [int(Xw.shape[0]), len(sel["ch_idx"]), int(Xw.shape[2])],
        "channels": sel["channels"],
        "sparklines": encode_f32(spark),
        "map": cm,
    }
