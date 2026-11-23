"""Spectral descriptors (family 8)."""

from __future__ import annotations

import numpy as np

from . import NAMED_BANDS, Family, FeatureError, welch_psd

ITEMS = ["abs_power", "rel_power", "peak_freq", "entropy", "centroid", "ratios"]
EPS = 1e-12


def spectral_entropy(P: np.ndarray) -> np.ndarray:
    """-sum(p log p) / log(n_pos) over positive-power bins; 0 when only one bin has power."""
    P = np.clip(np.asarray(P, dtype=np.float64), 0, None)
    pos = P > 0
    npos = pos.sum(axis=-1)
    tot = P.sum(axis=-1, keepdims=True)
    p = np.where(tot > 0, P / np.where(tot > 0, tot, 1), 0)
    with np.errstate(divide="ignore", invalid="ignore"):
        h = -np.where(pos, p * np.log(np.where(pos, p, 1)), 0).sum(axis=-1)
        out = np.where(npos > 1, h / np.log(np.maximum(npos, 2)), 0.0)
    return out


def trapz_band(f, P, lo, hi):
    m = (f >= lo - 1e-9) & (f <= hi + 1e-9)
    if m.sum() < 2:
        raise FeatureError(f"Band {lo:g}-{hi:g} Hz has fewer than 2 PSD bins.")
    return np.trapezoid(P[..., m], f[m], axis=-1)


class Spectral(Family):
    id = "spectral_features"
    title = "Spectral descriptors"
    explanation = "Shape of the power spectrum: band powers, peak, centroid and entropy."
    formula = (
        "Welch PSD, nperseg = min(round(sfreq), n_samples), 50% overlap; band power = trapezoid integral; "
        "relative = band / reference band; entropy = -sum(p log p)/log(n_pos); centroid = sum(f P)/sum(P); "
        "peak = argmax P in the reference band; ratio = P_num / (P_den + 1e-12)"
    )

    def items(self):
        return [i for i in ITEMS if i in (self.s.get("items") or ["rel_power"])]

    def reference(self):
        fmax = self.bank.sfreq / 2
        lo = max(1.0, self.bank.band["low"])
        hi = min(40.0, fmax, self.bank.band["high"])
        return lo, hi

    def bands(self):
        spec = self.s.get("bands")
        if not spec:
            kb = self.bank.preset.get("keyBands") or []
            spec = [{"name": b["name"], "low": b["low"], "high": b["high"]} for b in kb] or [
                {"name": "alpha", "low": 8.0, "high": 13.0},
                {"name": "beta", "low": 13.0, "high": 30.0},
            ]
        out = []
        f = self.freqs()
        rlo, rhi = self.reference()
        for b in spec:
            if isinstance(b, str):
                b = {"name": b, "low": NAMED_BANDS[b][0], "high": NAMED_BANDS[b][1]}
            lo, hi = max(float(b["low"]), rlo), min(float(b["high"]), rhi)
            nbins = int(((f >= lo - 1e-9) & (f <= hi + 1e-9)).sum()) if hi > lo else 0
            out.append({"name": b["name"], "low": lo, "high": hi, "enabled": nbins >= 2, "bins": nbins})
        return out

    def active_bands(self):
        return [b for b in self.bands() if b["enabled"]]

    def ratios(self):
        return [r for r in (self.s.get("ratios") or []) if len(r) == 2]

    def freqs(self):
        nper = int(min(round(self.bank.sfreq), self.bank.Xw.shape[-1]))
        nfft = 2 * nper
        return np.arange(nfft // 2 + 1) * self.bank.sfreq / nfft

    def check(self):
        if not self.items():
            raise FeatureError("Choose at least one spectral descriptor.")
        if any(i in self.items() for i in ("abs_power", "rel_power")) and not self.active_bands():
            raise FeatureError("No selected band has at least 2 PSD bins inside the current passband.")
        if "ratios" in self.items() and not self.ratios():
            raise FeatureError("Add at least one band ratio (numerator and denominator).")

    def _cols(self):
        cols = []
        for it in self.items():
            if it in ("abs_power", "rel_power"):
                for b in self.active_bands():
                    cols.append((it, b["name"], "uV^2" if it == "abs_power" else "1"))
            elif it == "peak_freq":
                cols.append((it, "", "Hz"))
            elif it == "entropy":
                cols.append((it, "", "1"))
            elif it == "centroid":
                cols.append((it, "", "Hz"))
            elif it == "ratios":
                for num, den in self.ratios():
                    cols.append((it, f"{num}/{den}", "1"))
        return cols

    def names(self):
        lab = {
            "abs_power": "abs power",
            "rel_power": "rel power",
            "peak_freq": "peak freq",
            "entropy": "spectral entropy",
            "centroid": "spectral centroid",
            "ratios": "ratio",
        }
        return [f"{ch} {lab[c[0]]}{(' ' + c[1]) if c[1] else ''}" for ch in self.bank.ch_names for c in self._cols()]

    def units(self):
        return [c[2] for _ in self.bank.ch_names for c in self._cols()]

    def compute(self, X, idx):
        f, P = welch_psd(X[idx], self.bank.sfreq)
        rlo, rhi = self.reference()
        ref = trapz_band(f, P, rlo, rhi)
        rm = (f >= rlo - 1e-9) & (f <= rhi + 1e-9)
        out = []
        bands = {b["name"]: b for b in self.bands()}
        for it, name, _ in self._cols():
            if it == "abs_power":
                b = bands[name]
                out.append(trapz_band(f, P, b["low"], b["high"]))
            elif it == "rel_power":
                b = bands[name]
                out.append(trapz_band(f, P, b["low"], b["high"]) / (ref + EPS))
            elif it == "peak_freq":
                out.append(f[rm][np.argmax(P[..., rm], axis=-1)])
            elif it == "entropy":
                out.append(spectral_entropy(P[..., rm]))
            elif it == "centroid":
                out.append((f[rm] * P[..., rm]).sum(axis=-1) / (P[..., rm].sum(axis=-1) + EPS))
            elif it == "ratios":
                num, den = name.split("/")
                bn = self._named(num)
                bd = self._named(den)
                out.append(trapz_band(f, P, *bn) / (trapz_band(f, P, *bd) + EPS))
        return np.stack(out, axis=-1).reshape(len(idx), -1)

    def _named(self, nm):
        for b in self.bands():
            if b["name"] == nm:
                return b["low"], b["high"]
        lo, hi = NAMED_BANDS[nm]
        rlo, rhi = self.reference()
        return max(lo, rlo), min(hi, rhi)

    def meta(self):
        d = super().meta()
        nper = int(min(round(self.bank.sfreq), self.bank.Xw.shape[-1]))
        d["welch"] = {"nperseg": nper, "noverlap": nper // 2, "nfft": 2 * nper}
        d["reference"] = list(self.reference())
        d["bands"] = self.bands()
        d["note"] = "frequency resolution is limited by the window length"
        warn = []
        if "ratios" in self.items():
            try:
                f, P = welch_psd(self.bank.Xw, self.bank.sfreq)
                for _num, den in self.ratios():
                    if np.any(trapz_band(f, P, *self._named(den)) <= 0):
                        warn.append(f"zero denominator power in {den} for some trials (epsilon 1e-12 used)")
            except FeatureError:
                pass
        d["warnings"] = warn
        return d

    def preview(self):
        f, P = welch_psd(self.bank.Xw, self.bank.sfreq)
        rlo, rhi = self.reference()
        m = (f >= 1) & (f <= min(45, self.bank.sfreq * 0.45))
        Pm = P.mean(axis=(0, 1))
        y = self.bank.y
        comp = []
        for b in self.active_bands():
            comp.append(
                {
                    "band": b["name"],
                    "perClass": [float(trapz_band(f, P[y == k].mean(axis=(0, 1)), b["low"], b["high"])) for k in range(int(y.max()) + 1)],
                }
            )
        return {
            "kind": "psd",
            "f": f[m].tolist(),
            "psd": np.log10(Pm[m] + 1e-12).tolist(),
            "regions": [[b["low"], b["high"]] for b in self.active_bands()],
            "reference": [rlo, rhi],
            "comparison": comp,
        }
