"""Frequency band (Page 4): zero-phase Butterworth band-pass and Welch PSD helpers."""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt, welch

from .contract import ValidationError, encode_f32
from .paradigms import freq_max


def design(low: float, high: float, order: int, sfreq: float) -> np.ndarray:
    nyq = sfreq / 2.0
    if not (0 < low < high < nyq):
        raise ValidationError(f"Band {low:g} to {high:g} Hz must lie between 0 and Nyquist ({nyq:g} Hz).")
    if not (2 <= int(order) <= 8):
        raise ValidationError("Filter order must be between 2 and 8.")
    return butter(int(order), [low, high], btype="bandpass", fs=sfreq, output="sos")


def padlen(sos: np.ndarray) -> int:
    """scipy.signal.sosfiltfilt default pad length."""
    n = sos.shape[0]
    return 3 * (2 * n + 1 - min(int((sos[:, 2] == 0).sum()), int((sos[:, 5] == 0).sum())))


def bandpass(X: np.ndarray, sfreq: float, low: float, high: float, order: int) -> tuple[np.ndarray, list[str]]:
    """Zero-phase Butterworth (scipy sosfiltfilt) along the last axis. Returns (filtered, warnings)."""
    sos = design(low, high, order, sfreq)
    n = X.shape[-1]
    pl = padlen(sos)
    warns: list[str] = []
    if n <= pl:
        warns.append(f"The window ({n} samples) is too short for the filter padding ({pl} samples); padding was reduced.")
        pl = max(0, n - 1)
    return sosfiltfilt(sos, np.asarray(X, dtype=np.float64), axis=-1, padlen=pl), warns


def welch_params(sfreq: float, n_samples: int) -> dict:
    nperseg = int(min(round(sfreq), n_samples))
    return {"nperseg": nperseg, "noverlap": nperseg // 2, "nfft": 2 * nperseg}


def psd(X: np.ndarray, sfreq: float) -> tuple[np.ndarray, np.ndarray]:
    """Welch PSD (uV^2/Hz) along the last axis: nperseg=min(round(sfreq), n), 50 % overlap, nfft=2*nperseg."""
    p = welch_params(sfreq, X.shape[-1])
    f, P = welch(np.asarray(X, dtype=np.float64), fs=sfreq, axis=-1, **p)
    return f, P


def integrate(f: np.ndarray, P: np.ndarray, low: float, high: float) -> np.ndarray:
    """Trapezoidal integration of the PSD over the bins inside [low, high] (uV^2)."""
    m = (f >= low - 1e-9) & (f <= high + 1e-9)
    if m.sum() < 2:
        # One bin: rectangle with the bin width.
        df = f[1] - f[0] if len(f) > 1 else 1.0
        return P[..., m].sum(axis=-1) * df
    return np.trapezoid(P[..., m], f[m], axis=-1)


def axis_bins(sfreq: float) -> np.ndarray:
    """Spectrum bins (0.5 Hz) from 1 Hz to the frequency-axis maximum; at most 90."""
    fmax = freq_max(sfreq)
    b = np.arange(1.0, fmax + 1e-9, 0.5)
    return b[:90]


def spectrum_on_bins(f: np.ndarray, P: np.ndarray, bins: np.ndarray) -> np.ndarray:
    return np.interp(bins, f, P)


def band_response(ds, sel, body: dict) -> dict:
    """POST /band: PSD per class and baseline (Welch), filtered and raw example waveforms."""
    from . import window as wmod

    low = float(body["low"])
    high = float(body["high"])
    order = int(body.get("order", 4))
    Xw, tw = wmod.crop(ds, sel["window"]["start"], sel["window"]["end"])
    chi = sel["ch_idx"]
    Xc = Xw[:, chi, :].astype(np.float64)
    bins = axis_bins(ds.sfreq)
    f, P = psd(Xc, ds.sfreq)
    Pm = P.mean(axis=1)  # mean over selected channels -> (trials, freqs)
    show = body.get("show_classes") or list(range(len(ds.class_names)))
    curves = []
    for k in range(len(ds.class_names)):
        m = ds.y == k
        spec = spectrum_on_bins(f, Pm[m].mean(axis=0), bins)
        curves.append({"class": k, "shown": k in show, "psd": encode_f32(10 * np.log10(spec + 1e-12))})
    base = None
    if ds.baseline is not None:
        Xb, _ = wmod.crop(ds, ds.baseline["start"], ds.baseline["end"])
        fb, Pb = psd(Xb[:, chi, :].astype(np.float64), ds.sfreq)
        sb = spectrum_on_bins(fb, Pb.mean(axis=1).mean(axis=0), bins)
        base = encode_f32(10 * np.log10(sb + 1e-12))
    filt, warns = bandpass(Xc, ds.sfreq, low, high, order)
    tr = int(np.clip(int(body.get("example_trial", 0)), 0, ds.X.shape[0] - 1))
    ex_ch = body.get("example_channel")
    names = [ds.ch_names[i] for i in chi]
    ci = names.index(ex_ch) if ex_ch in names else 0
    raw = Xc[tr, ci]
    flt = filt[tr, ci]
    res_hz = ds.sfreq / welch_params(ds.sfreq, Xc.shape[-1])["nperseg"]
    return {
        "shape": [int(Xc.shape[0]), int(Xc.shape[1]), int(Xc.shape[2])],
        "bins": encode_f32(bins),
        "curves": curves,
        "baseline": base,
        "example": {
            "trial": tr,
            "channel": names[ci],
            "raw": encode_f32(raw),
            "filtered": encode_f32(flt),
            "times": encode_f32(tw),
        },
        "welch": welch_params(ds.sfreq, Xc.shape[-1]),
        "resolutionHz": res_hz,
        "warnings": warns,
        "sos": encode_f32(design(low, high, order, ds.sfreq)),
    }
