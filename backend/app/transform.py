"""Transform and normalise (Page 6). Transform first, then normalise. Fitted on training folds only."""

from __future__ import annotations

import numpy as np
from scipy.stats import kurtosis, skew
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.preprocessing import MinMaxScaler, RobustScaler, StandardScaler

from .contract import encode_f32


class LogPolicy(BaseEstimator, TransformerMixin):
    """'log': plain log only on columns strictly positive in the fit data; others pass through.
    'signed_log': sign(x) * log1p(|x|) on every column. 'none': identity."""

    def __init__(self, kind: str = "none"):
        self.kind = kind

    def fit(self, X, y=None):
        X = np.asarray(X, dtype=np.float64)
        if self.kind == "log":
            self.mask_ = np.all(X > 0, axis=0)
        else:
            self.mask_ = np.ones(X.shape[1], dtype=bool)
        self.skipped_ = int((~self.mask_).sum()) if self.kind == "log" else 0
        return self

    def transform(self, X):
        X = np.array(X, dtype=np.float64, copy=True)
        if self.kind == "log":
            m = self.mask_
            # Columns that were positive in the fit data; clip test values so log stays finite.
            X[:, m] = np.log(np.clip(X[:, m], 1e-300, None))
        elif self.kind == "signed_log":
            X = np.sign(X) * np.log1p(np.abs(X))
        return X


def make_scaler(kind: str):
    if kind == "zscore":
        return StandardScaler()
    if kind == "robust":
        return RobustScaler()  # median / IQR
    if kind == "minmax":
        return MinMaxScaler()
    return "passthrough"


def _stats(v: np.ndarray, y: np.ndarray, k: int) -> dict:
    with np.errstate(all="ignore"):
        sk = float(skew(v)) if np.ptp(v) > 0 else 0.0
        ku = float(kurtosis(v)) if np.ptp(v) > 0 else 0.0
    return {
        "skew": sk,
        "kurtosis": ku,
        "perClass": [{"mean": float(v[y == c].mean()), "std": float(v[y == c].std())} for c in range(k)],
    }


def histogram(v: np.ndarray, y: np.ndarray, k: int, bins: int = 40) -> dict:
    lo, hi = float(np.min(v)), float(np.max(v))
    if hi <= lo:
        hi = lo + 1e-9
    edges = np.linspace(lo, hi, bins + 1)
    counts = [np.histogram(v[y == c], bins=edges)[0].tolist() for c in range(k)]
    b = np.clip(np.searchsorted(edges, v, side="right") - 1, 0, bins - 1)
    return {"edges": edges.tolist(), "counts": counts, "bin": b.tolist()}


def transform_response(F: np.ndarray, names: list[str], y: np.ndarray, k: int, body: dict) -> dict:
    """Display-only (all data). Evaluation fits on training folds."""
    feat = body.get("feature")
    j = names.index(feat) if feat in names else int(body.get("feature_index", 0) or 0)
    j = int(np.clip(j, 0, F.shape[1] - 1))
    lp = LogPolicy(body.get("transform", "none")).fit(F)
    T = lp.transform(F)
    sc = make_scaler(body.get("normalise", "none"))
    N = T if sc == "passthrough" else sc.fit_transform(T)
    before = F[:, j]
    after = N[:, j]
    return {
        "shape": [int(F.shape[0]), int(F.shape[1])],
        "feature": names[j],
        "featureIndex": j,
        "before": {"values": encode_f32(before), **histogram(before, y, k), **_stats(before, y, k)},
        "after": {"values": encode_f32(after), **histogram(after, y, k), **_stats(after, y, k)},
        "logSkipped": lp.skipped_,
        "logApplied": bool(lp.mask_[j]) if body.get("transform") == "log" else None,
        "footnote": "display only; evaluation fits on training folds",
    }
