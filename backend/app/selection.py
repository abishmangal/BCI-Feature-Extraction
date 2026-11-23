"""Select & reduce (section 6A.2): variance threshold, correlation pruning, Fisher / MI top-K, PCA / LDA."""

from __future__ import annotations

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.decomposition import PCA
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.feature_selection import mutual_info_classif

from .contract import SEED

EPS = 1e-12


def fisher_score(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    """F = sum_k n_k (mean_k - mean)^2 / (sum_k n_k var_k + eps), population variances."""
    X = np.asarray(X, dtype=np.float64)
    mu = X.mean(axis=0)
    num = np.zeros(X.shape[1])
    den = np.zeros(X.shape[1])
    for k in np.unique(y):
        Xk = X[y == k]
        nk = len(Xk)
        num += nk * (Xk.mean(axis=0) - mu) ** 2
        den += nk * Xk.var(axis=0)
    return num / (den + EPS)


class VarianceStep(BaseEstimator, TransformerMixin):
    def __init__(self, on: bool = False, threshold: float = 0.0):
        self.on = on
        self.threshold = threshold

    def fit(self, X, y=None):
        X = np.asarray(X, dtype=np.float64)
        self.mask_ = X.var(axis=0) > self.threshold if self.on else np.ones(X.shape[1], dtype=bool)
        return self

    def transform(self, X):
        return np.asarray(X)[:, self.mask_]


class CorrelationStep(BaseEstimator, TransformerMixin):
    """Drop a column when |r| with an earlier kept column exceeds the threshold (keep-first)."""

    def __init__(self, on: bool = False, threshold: float = 0.95):
        self.on = on
        self.threshold = threshold

    def fit(self, X, y=None):
        X = np.asarray(X, dtype=np.float64)
        n = X.shape[1]
        mask = np.ones(n, dtype=bool)
        if self.on and n > 1:
            with np.errstate(all="ignore"):
                R = np.abs(np.corrcoef(X, rowvar=False))
            R = np.nan_to_num(R, nan=0.0)
            for j in range(n):
                if not mask[j]:
                    continue
                later = np.arange(j + 1, n)
                drop = later[(R[j, later] > self.threshold) & mask[later]]
                mask[drop] = False
        self.mask_ = mask
        return self

    def transform(self, X):
        return np.asarray(X)[:, self.mask_]


class RankStep(BaseEstimator, TransformerMixin):
    """Top-K by Fisher score or mutual information (ties broken by column order)."""

    def __init__(self, on: bool = False, method: str = "fisher", top_k: int = 20):
        self.on = on
        self.method = method
        self.top_k = top_k

    def fit(self, X, y=None):
        X = np.asarray(X, dtype=np.float64)
        n = X.shape[1]
        if not self.on:
            self.mask_ = np.ones(n, dtype=bool)
            self.scores_ = None
            return self
        if self.method == "mi":
            s = mutual_info_classif(X, y, random_state=SEED)
        else:
            s = fisher_score(X, np.asarray(y))
        self.scores_ = s
        k = int(min(max(1, self.top_k), n))
        order = np.lexsort((np.arange(n), -s))  # descending score, then column order
        mask = np.zeros(n, dtype=bool)
        mask[order[:k]] = True
        self.mask_ = mask
        return self

    def transform(self, X):
        return np.asarray(X)[:, self.mask_]


class ProjectStep(BaseEstimator, TransformerMixin):
    def __init__(self, method: str = "none", components: int = 2):
        self.method = method
        self.components = components

    def n_components(self, n_samples: int, n_features: int, n_classes: int) -> int:
        if self.method == "pca":
            return int(max(1, min(self.components, n_samples, n_features)))
        if self.method == "lda":
            return int(max(1, min(self.components, n_classes - 1, n_features)))
        return n_features

    def fit(self, X, y=None):
        X = np.asarray(X, dtype=np.float64)
        k = len(np.unique(y)) if y is not None else 2
        c = self.n_components(X.shape[0], X.shape[1], k)
        if self.method == "pca":
            self.model_ = PCA(n_components=c, random_state=SEED).fit(X)
        elif self.method == "lda":
            self.model_ = LinearDiscriminantAnalysis(n_components=c).fit(X, y)
        else:
            self.model_ = None
        self.c_ = c
        return self

    def transform(self, X):
        if self.model_ is None:
            return np.asarray(X)
        return self.model_.transform(np.asarray(X, dtype=np.float64))


def selection_steps(s: dict) -> list[tuple[str, object]]:
    s = s or {}
    v = s.get("variance") or {}
    c = s.get("correlation") or {}
    r = s.get("ranking") or {}
    p = s.get("projection") or {}
    return [
        ("variance", VarianceStep(bool(v.get("on", False)), float(v.get("threshold", 0.0)))),
        ("correlation", CorrelationStep(bool(c.get("on", False)), float(c.get("threshold", 0.95)))),
        ("ranking", RankStep(bool(r.get("on", False)), r.get("method", "fisher"), int(r.get("topK", 20)))),
        ("projection", ProjectStep(p.get("method", "none"), int(p.get("components", 2)))),
    ]


def any_selection(s: dict) -> bool:
    s = s or {}
    return bool(
        (s.get("variance") or {}).get("on")
        or (s.get("correlation") or {}).get("on")
        or (s.get("ranking") or {}).get("on")
        or (s.get("projection") or {}).get("method", "none") != "none"
    )
