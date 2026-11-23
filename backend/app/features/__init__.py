"""Feature families (Page 5, sections 6 and 6A.1).

Every family is used through the scikit-learn compatible composite in ``composite.py``. Each family
accepts (trials, channels, samples) data held in a shared ``DataBank`` and returns (trials, features).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FAMILY_ORDER = [
    "band_power",
    "csp",
    "hjorth",
    "wavelet",
    "covariance",
    "time_stats",
    "window_means",
    "spectral_features",
    "tf_regions",
    "asymmetry",
    "complexity",
    "autoencoder",
]

CATEGORIES = {
    "time_stats": "Time",
    "window_means": "Time",
    "hjorth": "Time",
    "complexity": "Time",
    "band_power": "Frequency",
    "spectral_features": "Frequency",
    "wavelet": "Time-frequency",
    "tf_regions": "Time-frequency",
    "csp": "Spatial",
    "covariance": "Spatial",
    "asymmetry": "Spatial",
    "autoencoder": "Learned",
}

NAMED_BANDS = {
    "delta": (0.5, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "mu": (8.0, 12.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 45.0),
}


class FeatureError(Exception):
    """A family cannot run with the current data or settings (shown as an explanation, never faked)."""


@dataclass
class DataBank:
    """Arrays shared by all families for one settings hash. Never deep-copied by sklearn clone()."""

    Xw: np.ndarray  # cropped, picked, band-passed window (trials, channels, samples), uV
    times_w: np.ndarray
    Xfull: np.ndarray  # full epoch, picked channels, unfiltered (trials, channels, samples), uV
    times_full: np.ndarray
    sfreq: float
    ch_names: list[str]
    band: dict
    baseline: dict | None
    Xbase: np.ndarray | None  # baseline segment, picked, band-passed separately (trials, ch, samples_b)
    preset: dict
    all_ch_names: list[str] = field(default_factory=list)
    positions: list = field(default_factory=list)
    pairs: list = field(default_factory=list)
    upstream: dict = field(default_factory=dict)  # tfr, tfr_freqs, tfr_times (all channels)
    upstream_ch_idx: list[int] = field(default_factory=list)
    y: np.ndarray | None = None
    cache: dict = field(default_factory=dict)
    fit_log: list = field(default_factory=list)  # (family, train indices) for fold-isolation tests

    def __deepcopy__(self, memo):
        return self

    @property
    def n(self) -> int:
        return int(self.Xw.shape[0])


class Family:
    id = ""
    title = ""
    explanation = ""
    stateless = True
    formula = ""

    def __init__(self, settings: dict, bank: DataBank):
        self.s = dict(settings or {})
        self.bank = bank

    # Metadata -------------------------------------------------------------------------------
    def names(self) -> list[str]:
        raise NotImplementedError

    def units(self) -> list[str]:
        raise NotImplementedError

    def interval(self) -> str:
        b = self.bank
        return f"{b.times_w[0]:.3f} to {b.times_w[-1] + 1 / b.sfreq:.3f} s (Page 2 window)"

    def check(self) -> None:
        """Raise FeatureError with an explanation when the family cannot run."""

    # Computation ------------------------------------------------------------------------------
    def compute(self, X: np.ndarray, idx: np.ndarray) -> np.ndarray:
        """Stateless per-trial computation on rows idx."""
        raise NotImplementedError

    def fit(self, idx: np.ndarray, y: np.ndarray) -> Family:
        return self

    def transform(self, idx: np.ndarray) -> np.ndarray:
        if self.stateless:
            key = (self.id, repr(sorted(self.s.items())))
            full = self.bank.cache.get(key)
            if full is None:
                full = self.compute(self.bank.Xw, np.arange(self.bank.n))
                self.bank.cache[key] = full
            return full[idx]
        raise NotImplementedError

    def preview(self) -> dict:
        return {}

    def meta(self) -> dict:
        names = self.names()
        return {
            "id": self.id,
            "title": self.title,
            "names": names,
            "units": self.units(),
            "count": len(names),
            "interval": self.interval(),
            "formula": self.formula,
            "category": CATEGORIES[self.id],
            "learned": not self.stateless,
        }


def clamp_band(lo: float, hi: float, band: dict, sfreq: float) -> tuple[float, float] | None:
    fmax = min(45.0, 0.9 * sfreq / 2)
    lo2 = max(lo, band["low"], 0.0)
    hi2 = min(hi, band["high"], fmax)
    if hi2 <= lo2:
        return None
    return lo2, hi2


def welch_psd(X: np.ndarray, sfreq: float):
    from scipy.signal import welch

    nper = int(min(round(sfreq), X.shape[-1]))
    return welch(np.asarray(X, dtype=np.float64), fs=sfreq, nperseg=nper, noverlap=nper // 2, nfft=2 * nper, axis=-1)


def band_integral(f: np.ndarray, P: np.ndarray, lo: float, hi: float) -> np.ndarray:
    m = (f >= lo - 1e-9) & (f <= hi + 1e-9)
    if m.sum() == 0:
        raise FeatureError(f"No PSD bins between {lo:g} and {hi:g} Hz.")
    if m.sum() == 1:
        df = f[1] - f[0]
        return P[..., m].sum(axis=-1) * df
    return np.trapezoid(P[..., m], f[m], axis=-1)
