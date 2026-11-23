"""Composite feature union (section 6A.3) with stable feature names and duplicate-name de-duplication.

The pipeline input is a column of trial indices. Stateless per-trial families are computed once for all
trials (allowed before splitting); learned families (CSP, covariance tangent space, autoencoder) are fitted
only on the training indices passed to ``fit``.
"""

from __future__ import annotations

import json

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin

from . import FAMILY_ORDER, DataBank, FeatureError
from .asymmetry import Asymmetry
from .autoencoder import Autoencoder
from .classic import BandPower, Covariance, CSPFamily, Hjorth, Wavelet
from .complexity import Complexity
from .spectral import Spectral
from .tf_regions import TFRegions
from .time_stats import TimeStats
from .window_means import WindowMeans

CLASSES = {
    "band_power": BandPower,
    "csp": CSPFamily,
    "hjorth": Hjorth,
    "wavelet": Wavelet,
    "covariance": Covariance,
    "time_stats": TimeStats,
    "window_means": WindowMeans,
    "spectral_features": Spectral,
    "tf_regions": TFRegions,
    "asymmetry": Asymmetry,
    "complexity": Complexity,
    "autoencoder": Autoencoder,
}
LEARNED = {"csp", "covariance", "autoencoder"}


def make_family(fid: str, settings: dict, bank: DataBank):
    return CLASSES[fid](settings, bank)


def ordered(selection: list[str]) -> list[str]:
    return [f for f in FAMILY_ORDER if f in selection]


class CompositeFeatures(BaseEstimator, TransformerMixin):
    """X is an (n, 1) array of trial indices into the bank."""

    def __init__(self, families: str = "[]", bank: DataBank | None = None):
        self.families = families  # JSON list of [family_id, settings]
        self.bank = bank

    def _instances(self):
        spec = json.loads(self.families)
        return [make_family(fid, s, self.bank) for fid, s in spec]

    def plan(self):
        """Feature names, units, family of each column and the de-duplication mask."""
        fams = self._instances()
        names, units, fam_of, keep = [], [], [], []
        seen = set()
        for f in fams:
            f.check()
            for n, u in zip(f.names(), f.units(), strict=False):
                dup = n in seen
                seen.add(n)
                names.append(n)
                units.append(u)
                fam_of.append(f.id)
                keep.append(not dup)
        return fams, names, units, fam_of, np.array(keep, dtype=bool)

    def fit(self, X, y=None):
        idx = np.asarray(X).ravel().astype(int)
        fams, names, units, fam_of, keep = self.plan()
        for f in fams:
            if not f.stateless:
                f.fit(idx, np.asarray(y))
        self.fams_ = fams
        self.keep_ = keep
        self.names_ = [n for n, k in zip(names, keep, strict=False) if k]
        self.units_ = [u for u, k in zip(units, keep, strict=False) if k]
        self.family_of_ = [a for a, k in zip(fam_of, keep, strict=False) if k]
        return self

    def transform(self, X):
        idx = np.asarray(X).ravel().astype(int)
        blocks = [np.asarray(f.transform(idx), dtype=np.float64).reshape(len(idx), -1) for f in self.fams_]
        F = np.concatenate(blocks, axis=1) if blocks else np.zeros((len(idx), 0))
        return F[:, self.keep_]

    def get_feature_names_out(self, input_features=None):
        return np.array(self.names_, dtype=object)


def describe(families_json: str, bank: DataBank) -> dict:
    """Per-family metadata (names, units, formula, interval, counts) and previews; errors per family."""
    spec = json.loads(families_json)
    out = []
    seen = set()
    total = 0
    for fid, s in spec:
        f = make_family(fid, s, bank)
        try:
            f.check()
            meta = f.meta()
            uniq = [n for n in meta["names"] if n not in seen]
            seen.update(meta["names"])
            meta["count"] = len(uniq)
            meta["duplicates"] = len(meta["names"]) - len(uniq)
            total += len(uniq)
            try:
                meta["preview"] = f.preview()
            except FeatureError as e:
                meta["preview"] = {"error": str(e)}
            meta["error"] = None
        except FeatureError as e:
            meta = {"id": fid, "title": f.title, "error": str(e), "count": 0, "names": [], "units": []}
        meta["explanation"] = f.explanation
        out.append(meta)
    return {"families": out, "total": total}
