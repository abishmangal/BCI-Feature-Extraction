"""Classic families: band power, CSP, Hjorth, wavelet energy, covariance (Riemannian)."""

from __future__ import annotations

import numpy as np

from . import NAMED_BANDS, DataBank, Family, FeatureError, band_integral, welch_psd


def resolve_bands(spec, bank: DataBank) -> list[dict]:
    """Bands from settings: list of {name, low, high}, the string "stimulus" (SSVEP) or names."""
    if spec == "stimulus":
        sf = bank.preset.get("stimulusFrequencies") or []
        out = []
        for f in sf:
            out.append({"name": f"{f:g} Hz", "low": f - 0.5, "high": f + 0.5})
        for f in sf:
            out.append({"name": f"{2 * f:g} Hz (2f)", "low": 2 * f - 0.5, "high": 2 * f + 0.5})
        return out
    out = []
    for b in spec or []:
        if isinstance(b, str):
            lo, hi = NAMED_BANDS[b]
            out.append({"name": b, "low": lo, "high": hi})
        else:
            out.append({"name": b.get("name") or f"{b['low']:g}-{b['high']:g} Hz", "low": float(b["low"]), "high": float(b["high"])})
    return out


# ------------------------------------------------------------------------------------------------
class BandPower(Family):
    id = "band_power"
    title = "Band power"
    explanation = "How much signal energy each channel has inside chosen frequency bands."
    formula = "P = integral of the Welch PSD over [f_lo, f_hi] (trapezoid), uV^2"

    def bands(self) -> list[dict]:
        spec = self.s.get("bands")
        if spec is None:
            spec = (
                self.bank.preset["defaultFeature"]["settings"].get("bands")
                if self.bank.preset["defaultFeature"]["family"] == "band_power"
                else None
            )
        if spec is None:
            spec = [{"name": b["name"], "low": b["low"], "high": b["high"]} for b in self.bank.preset.get("keyBands") or []] or [
                "theta",
                "alpha",
                "beta",
            ]
        return resolve_bands(spec, self.bank)

    def check(self) -> None:
        if not self.bands():
            raise FeatureError("Choose at least one band.")
        fmax = self.bank.sfreq / 2
        for b in self.bands():
            if b["high"] >= fmax:
                raise FeatureError(f"Band {b['name']} reaches Nyquist ({fmax:g} Hz).")

    def names(self) -> list[str]:
        return [f"{ch} {b['name']} power" for ch in self.bank.ch_names for b in self.bands()]

    def units(self) -> list[str]:
        return ["uV^2"] * len(self.names())

    def compute(self, X, idx):
        f, P = welch_psd(X[idx], self.bank.sfreq)
        cols = [band_integral(f, P, b["low"], b["high"]) for b in self.bands()]  # each (n, ch)
        return np.stack(cols, axis=-1).reshape(len(idx), -1)  # channel-major, bands inner

    def preview(self) -> dict:
        b = self.bands()[0]
        f, P = welch_psd(self.bank.Xw, self.bank.sfreq)
        lp = np.log10(band_integral(f, P, b["low"], b["high"]).mean(axis=1) + 1e-12)
        lo, hi = float(lp.min()), float(lp.max())
        y = self.bank.y
        levels = [float((lp[y == k].mean() - lo) / (hi - lo + 1e-12)) for k in range(int(y.max()) + 1)]
        return {"kind": "glass", "band": b, "levels": levels}


# ------------------------------------------------------------------------------------------------
class CSPFamily(Family):
    id = "csp"
    title = "CSP (spatial filters)"
    explanation = "Learned channel mixtures whose variance differs most between classes."
    stateless = False
    formula = "w = argmax (w' C_a w) / (w' C_b w); feature = log(var(w' x)), fitted on training folds only"

    def m(self) -> int:
        m = int(self.s.get("n_components", 4))
        nch = len(self.bank.ch_names)
        m = min(m, nch if nch % 2 == 0 else nch - 1)
        return max(2, m)

    def k(self) -> int:
        return int(self.bank.y.max()) + 1

    def check(self) -> None:
        if len(self.bank.ch_names) < 2:
            raise FeatureError("CSP needs at least two channels.")

    def names(self) -> list[str]:
        m = self.m()
        if self.k() == 2:
            return [f"CSP{j + 1}" for j in range(m)]
        cn = self.bank.preset.get("_class_names") or [str(i) for i in range(self.k())]
        return [f"CSP {cn[c]} vs rest {j + 1}" for c in range(self.k()) for j in range(m)]

    def units(self) -> list[str]:
        return ["log(uV^2)"] * len(self.names())

    def _make(self):
        from mne.decoding import CSP

        reg = "ledoit_wolf" if self.s.get("shrinkage") else None
        return CSP(n_components=self.m(), reg=reg, log=True, component_order="alternate")

    def fit(self, idx, y):
        self.bank.fit_log.append(("csp", np.asarray(idx).copy()))
        X = self.bank.Xw[idx].astype(np.float64)
        yy = np.asarray(y)
        if self.k() == 2:
            self.models = [self._make().fit(X, yy)]
        else:
            self.models = [self._make().fit(X, (yy == c).astype(int)) for c in range(self.k())]
        return self

    def transform(self, idx):
        X = self.bank.Xw[idx].astype(np.float64)
        return np.concatenate([m.transform(X) for m in self.models], axis=1)

    def preview(self) -> dict:
        """Two class covariance ellipses in the plane of the first two channels and the CSP angle."""
        X = self.bank.Xw[:, :2, :].astype(np.float64)
        y = self.bank.y
        a = 0
        Ca = np.mean([np.cov(x) for x in X[y == a]], axis=0)
        Cb = np.mean([np.cov(x) for x in X[y != a]], axis=0)
        from scipy.linalg import eigh

        w, V = eigh(Ca, Ca + Cb)
        v = V[:, -1]
        angle = float(np.arctan2(v[1], v[0]))

        def ell(C):
            ev, evec = np.linalg.eigh(C)
            return {"rx": float(np.sqrt(ev[1])), "ry": float(np.sqrt(ev[0])), "angle": float(np.arctan2(evec[1, 1], evec[0, 1]))}

        s = float(np.sqrt(max(np.linalg.eigvalsh(Ca).max(), np.linalg.eigvalsh(Cb).max())))
        return {
            "kind": "ellipses",
            "channels": self.bank.ch_names[:2],
            "a": ell(Ca / s**2),
            "b": ell(Cb / s**2),
            "cspAngle": angle,
            "labelB": "rest" if int(y.max()) > 1 else None,
            "exploratory": True,
        }


# ------------------------------------------------------------------------------------------------
def hjorth(X: np.ndarray) -> np.ndarray:
    """Returns (..., 3): activity (uV^2), mobility, complexity. Constant signals give 0 mobility/complexity."""
    dx = np.diff(X, axis=-1)
    ddx = np.diff(dx, axis=-1)
    v0 = X.var(axis=-1)
    v1 = dx.var(axis=-1)
    v2 = ddx.var(axis=-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        mob = np.where(v0 > 0, np.sqrt(v1 / v0), 0.0)
        mob_d = np.where(v1 > 0, np.sqrt(v2 / v1), 0.0)
        comp = np.where(mob > 0, mob_d / mob, 0.0)
    return np.stack([v0, mob, comp], axis=-1)


class Hjorth(Family):
    id = "hjorth"
    title = "Hjorth parameters"
    explanation = "Activity, mobility and complexity: variance and how fast the signal changes."
    formula = "activity = var(x); mobility = sqrt(var(x')/var(x)); complexity = mobility(x')/mobility(x)"

    def check(self):
        if self.bank.Xw.shape[-1] < 3:
            raise FeatureError("Hjorth parameters need at least 3 samples.")

    def names(self):
        return [f"{ch} {p}" for ch in self.bank.ch_names for p in ("activity", "mobility", "complexity")]

    def units(self):
        return [u for _ in self.bank.ch_names for u in ("uV^2", "1", "1")]

    def compute(self, X, idx):
        return hjorth(X[idx].astype(np.float64)).reshape(len(idx), -1)

    def preview(self):
        H = hjorth(self.bank.Xw.astype(np.float64)).reshape(-1, 3)
        return {
            "kind": "gauges",
            "labels": ["activity", "mobility", "complexity"],
            "mean": [float(v) for v in H.mean(axis=0)],
            "min": [float(v) for v in H.min(axis=0)],
            "max": [float(v) for v in H.max(axis=0)],
            "log": [True, False, False],
        }


# ------------------------------------------------------------------------------------------------
WAVELETS = {"morlet": "cmor1.5-1.0"}


def wavelet_freqs(rng, n, sfreq):
    lo, hi = float(rng[0]), float(min(rng[1], 0.45 * sfreq))
    return np.geomspace(lo, hi, int(n))


def cwt_power(X: np.ndarray, freqs: np.ndarray, sfreq: float, wavelet: str) -> np.ndarray:
    """|CWT|^2 with PyWavelets (complex Morlet). Returns (..., freqs, samples)."""
    import pywt

    w = WAVELETS.get(wavelet, wavelet)
    scales = pywt.frequency2scale(w, freqs / sfreq)
    coef, _ = pywt.cwt(X, scales, w, sampling_period=1.0 / sfreq, axis=-1)
    # coef: (freqs, ..., samples) -> move freqs next to samples
    coef = np.moveaxis(coef, 0, -2)
    return coef


class Wavelet(Family):
    id = "wavelet"
    title = "Wavelet energy"
    explanation = "Energy at several frequencies from a complex Morlet wavelet transform."
    formula = "E(f) = mean over the window of |CWT_morlet(x)(f, t)|^2 (pywt.cwt, cmor), uV^2"

    def freqs(self):
        rng = self.s.get("range") or self.bank.preset["waveletRange"]
        return wavelet_freqs(rng, int(self.s.get("n_freqs", 8)), self.bank.sfreq)

    def check(self):
        rng = self.s.get("range") or self.bank.preset["waveletRange"]
        if not (0 < rng[0] < rng[1]):
            raise FeatureError("The wavelet frequency range must have low < high.")

    def names(self):
        return [f"{ch} {f:.1f} Hz wavelet energy" for ch in self.bank.ch_names for f in self.freqs()]

    def units(self):
        return ["uV^2"] * len(self.names())

    def compute(self, X, idx):
        c = cwt_power(X[idx].astype(np.float64), self.freqs(), self.bank.sfreq, self.s.get("wavelet", "morlet"))
        e = (np.abs(c) ** 2).mean(axis=-1)  # (n, ch, freqs)
        return e.reshape(len(idx), -1)

    def preview(self):
        X = self.bank.Xw.astype(np.float64)
        sub = X[:: max(1, len(X) // 40)]
        c = cwt_power(sub, self.freqs(), self.bank.sfreq, self.s.get("wavelet", "morlet"))
        p = (np.abs(c) ** 2).mean(axis=(0, 1))  # (freqs, samples)
        step = max(1, p.shape[1] // 40)
        p = p[:, ::step]
        return {"kind": "tfmap", "freqs": [float(f) for f in self.freqs()], "map": np.log10(p + 1e-12).tolist()}


# ------------------------------------------------------------------------------------------------
class Covariance(Family):
    id = "covariance"
    title = "Covariance (Riemannian)"
    explanation = "How channels vary together, mapped to a flat tangent space for linear classifiers."
    stateless = False
    formula = "C = cov(x) (OAS or SCM, pyriemann Covariances); s = TangentSpace(C) about the training-fold mean"

    def n(self):
        return len(self.bank.ch_names)

    def names(self):
        ch = self.bank.ch_names
        out = []
        for i in range(self.n()):
            for j in range(i, self.n()):
                out.append(f"cov {ch[i]}-{ch[j]}" if not self.s.get("tangent", True) else f"TS {ch[i]}-{ch[j]}")
        return out

    def units(self):
        return ["uV^2" if not self.s.get("tangent", True) else "1"] * len(self.names())

    def _covs(self, idx):
        from pyriemann.estimation import Covariances

        est = self.s.get("estimator", "oas")
        return Covariances(estimator=est).fit_transform(self.bank.Xw[idx].astype(np.float64))

    def fit(self, idx, y):
        self.bank.fit_log.append(("covariance", np.asarray(idx).copy()))
        if self.s.get("tangent", True):
            from pyriemann.tangentspace import TangentSpace

            self.ts = TangentSpace(metric="riemann").fit(self._covs(idx))
        return self

    def transform(self, idx):
        C = self._covs(idx)
        if self.s.get("tangent", True):
            return self.ts.transform(C)
        iu = np.triu_indices(self.n())
        return C[:, iu[0], iu[1]]

    def preview(self):
        k = min(8, self.n())
        C = self._covs(np.arange(self.bank.n))[:, :k, :k].mean(axis=0)
        return {"kind": "matrix", "channels": self.bank.ch_names[:k], "matrix": C.tolist()}
