"""Time-domain statistics (family 6)."""

from __future__ import annotations

import numpy as np
from scipy.stats import kurtosis, skew

from . import Family, FeatureError

STATS = ["mean", "variance", "std", "rms", "ptp", "skewness", "kurtosis", "line_length", "higuchi"]
DEFAULT_STATS = ["mean", "variance", "rms", "ptp"]
UNITS = {
    "mean": "uV",
    "variance": "uV^2",
    "std": "uV",
    "rms": "uV",
    "ptp": "uV",
    "skewness": "1",
    "kurtosis": "1",
    "line_length": "uV",
    "higuchi": "1",
}


def kmax_bound(n_samples: int, kmax: int) -> int:
    """kmax is bounded by the epoch length: 2 <= kmax <= floor(n_samples / 4)."""
    return int(max(2, min(int(kmax), n_samples // 4)))


def line_length(X: np.ndarray) -> np.ndarray:
    """sum(|diff(x)|), not divided by the sample count."""
    return np.abs(np.diff(X, axis=-1)).sum(axis=-1)


def higuchi_fd(X: np.ndarray, kmax: int = 8) -> np.ndarray:
    """Higuchi fractal dimension along the last axis. Constant signals return 1.0 (documented)."""
    X = np.asarray(X, dtype=np.float64)
    N = X.shape[-1]
    if N < 8:
        raise FeatureError("Higuchi fractal dimension needs at least 8 samples.")
    km = kmax_bound(N, kmax)
    lk = []
    for k in range(1, km + 1):
        acc = np.zeros(X.shape[:-1])
        cnt = 0
        for m in range(k):
            seg = X[..., m::k]
            nm = seg.shape[-1]
            if nm < 2:
                continue
            lm = np.abs(np.diff(seg, axis=-1)).sum(axis=-1) * (N - 1) / ((nm - 1) * k) / k
            acc += lm
            cnt += 1
        lk.append(acc / max(cnt, 1))
    L = np.stack(lk, axis=-1)  # (..., km)
    x = np.log(1.0 / np.arange(1, km + 1))
    out = np.ones(X.shape[:-1])
    ok = np.all(L > 0, axis=-1)
    if np.any(ok):
        ly = np.log(L[ok])
        xm = x - x.mean()
        slope = (ly - ly.mean(axis=-1, keepdims=True)) @ xm / (xm @ xm)
        out[ok] = slope
    return out


def compute_stats(X: np.ndarray, stats: list[str], kmax: int) -> np.ndarray:
    """Returns (n, channels, len(stats)). Constant signals: skewness and kurtosis are 0 (documented)."""
    X = np.asarray(X, dtype=np.float64)
    if X.shape[-1] < 3:
        raise FeatureError("Time statistics need at least 3 samples.")
    cols = []
    const = np.ptp(X, axis=-1) == 0
    for s in stats:
        if s == "mean":
            v = X.mean(axis=-1)
        elif s == "variance":
            v = X.var(axis=-1, ddof=0)
        elif s == "std":
            v = X.std(axis=-1, ddof=0)
        elif s == "rms":
            v = np.sqrt((X**2).mean(axis=-1))
        elif s == "ptp":
            v = np.ptp(X, axis=-1)
        elif s == "skewness":
            with np.errstate(all="ignore"):
                v = skew(X, axis=-1)
            v = np.where(const, 0.0, v)
        elif s == "kurtosis":
            with np.errstate(all="ignore"):
                v = kurtosis(X, axis=-1, fisher=True)
            v = np.where(const, 0.0, v)
        elif s == "line_length":
            v = line_length(X)
        elif s == "higuchi":
            v = higuchi_fd(X, kmax)
        else:
            raise FeatureError(f"Unknown statistic {s!r}.")
        cols.append(np.nan_to_num(v, nan=0.0))
    return np.stack(cols, axis=-1)


class TimeStats(Family):
    id = "time_stats"
    title = "Time-domain statistics"
    explanation = "Simple numbers per channel: mean, spread, size and shape of the waveform."
    formula = (
        "variance = mean((x - mean)^2) (ddof=0); RMS = sqrt(mean(x^2)); line length = sum|diff(x)|; "
        "kurtosis = excess (Gaussian = 0); Higuchi FD = slope of log L(k) vs log(1/k), k = 1..kmax"
    )

    def stats(self):
        return [s for s in STATS if s in (self.s.get("stats") or DEFAULT_STATS)]

    def check(self):
        if not self.stats():
            raise FeatureError("Choose at least one statistic.")
        if self.bank.Xw.shape[-1] < 8 and "higuchi" in self.stats():
            raise FeatureError("Higuchi fractal dimension needs at least 8 samples.")

    def names(self):
        return [f"{ch} {s}" for ch in self.bank.ch_names for s in self.stats()]

    def units(self):
        return [UNITS[s] for _ in self.bank.ch_names for s in self.stats()]

    def compute(self, X, idx):
        return compute_stats(X[idx], self.stats(), int(self.s.get("kmax", 8))).reshape(len(idx), -1)

    def preview(self):
        tr = int(self.s.get("example_trial", 0)) % self.bank.n
        x = self.bank.Xw[tr, 0].astype(np.float64)
        vals = compute_stats(x[None, None], self.stats(), int(self.s.get("kmax", 8)))[0, 0]
        allv = compute_stats(self.bank.Xw[:, :1].astype(np.float64), self.stats(), int(self.s.get("kmax", 8)))[:, 0]
        return {
            "kind": "meters",
            "channel": self.bank.ch_names[0],
            "trial": tr,
            "wave": x[:: max(1, len(x) // 200)].tolist(),
            "stats": self.stats(),
            "values": [float(v) for v in vals],
            "min": [float(v) for v in allv.min(axis=0)],
            "max": [float(v) for v in allv.max(axis=0)],
            "units": [UNITS[s] for s in self.stats()],
        }
