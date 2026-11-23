"""Time-frequency regions and band-power change (family 9).

The Page 4 zero-phase band-pass is applied to the FULL epoch first; baseline and task windows are cropped
afterwards (avoids edge effects). Power = squared magnitude; amplitude = magnitude.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt, stft

from . import Family, FeatureError
from .classic import cwt_power

OUTPUTS = ["mean_power", "max_power", "energy", "coef_mean", "coef_var", "coef_energy", "pct_change"]
LABEL = {
    "mean_power": "mean power",
    "max_power": "max power",
    "energy": "region energy",
    "coef_mean": "|coef| mean",
    "coef_var": "|coef| variance",
    "coef_energy": "coef energy",
    "pct_change": "% change vs baseline",
}
UNIT = {
    "mean_power": "uV^2",
    "max_power": "uV^2",
    "energy": "uV^2 s Hz",
    "coef_mean": "uV",
    "coef_var": "uV^2",
    "coef_energy": "uV^2",
    "pct_change": "%",
}


class TFRegions(Family):
    id = "tf_regions"
    title = "Time-frequency regions"
    explanation = "Power inside a chosen time and frequency rectangle, and its change from baseline."
    formula = (
        "P(f,t) = |CWT(x_bandpassed_full_epoch)|^2; mean/max/energy over the rectangle; % change = 100 (P_task - P_baseline) / P_baseline"
    )

    # Settings ---------------------------------------------------------------------------------
    def source(self) -> str:
        s = self.s.get("source")
        if s:
            return s
        return "upstream" if "tfr" in self.bank.upstream else "cwt"

    def freq_range(self):
        r = self.s.get("freqs")
        if r:
            return float(r[0]), float(r[1])
        kb = self.bank.preset.get("keyBands") or []
        if kb:
            return float(kb[0]["low"]), float(kb[0]["high"])
        return float(self.bank.band["low"]), float(self.bank.band["high"])

    def task(self):
        t = self.s.get("task")
        if t:
            a, b = float(t[0]), float(t[1])
        else:
            z = self.bank.preset.get("zone")
            if z:
                a, b = float(z["start"]), float(z["end"])
            else:
                a, b = float(self.bank.times_w[0]), float(self.bank.times_w[-1] + 1 / self.bank.sfreq)
        tf = self.bank.times_full
        return max(a, float(tf[0])), min(b, float(tf[-1]) + 1 / self.bank.sfreq)

    def baseline(self):
        b = self.s.get("baselineInterval")
        if b:
            return float(b[0]), float(b[1])
        if self.bank.baseline:
            return float(self.bank.baseline["start"]), float(self.bank.baseline["end"])
        return None

    def outputs(self):
        sel = self.s.get("outputs") or (["mean_power", "pct_change"] if self.baseline() else ["mean_power"])
        return [o for o in OUTPUTS if o in sel]

    def warnings(self) -> list[str]:
        lo, hi = self.freq_range()
        w = []
        if lo < self.bank.band["low"] - 1e-9 or hi > self.bank.band["high"] + 1e-9:
            w.append("The frequency range extends beyond the Page 4 passband, so it is attenuated by the filter.")
        return w

    def check(self):
        if "pct_change" in self.outputs():
            if not self.baseline():
                raise FeatureError("Percent change needs a baseline interval; this dataset has none.")
        lo, hi = self.freq_range()
        if not (0 < lo < hi < self.bank.sfreq / 2):
            raise FeatureError("The frequency range must lie between 0 and Nyquist.")
        a, b = self.task()
        if b - a < 2 / self.bank.sfreq:
            raise FeatureError("The task interval is too short.")
        if not self.outputs():
            raise FeatureError("Choose at least one output.")

    # TFR --------------------------------------------------------------------------------------
    def tfr(self):
        """(trials, channels, freqs, times) complex coefficients (or power for upstream), freqs, times."""
        key = ("tfr", self.source(), self.freq_range(), repr(self.bank.band))
        hit = self.bank.cache.get(key)
        if hit is not None:
            return hit
        lo, hi = self.freq_range()
        if self.source() == "upstream":
            up = self.bank.upstream
            P = up["tfr"][:, self.bank.upstream_ch_idx]
            f = up["tfr_freqs"]
            m = (f >= lo) & (f <= hi)
            out = (np.sqrt(P[:, :, m]), f[m], up["tfr_times"], True)
        else:
            sf = self.bank.sfreq
            b = self.bank.band
            sos = butter(int(b["order"]), [b["low"], b["high"]], btype="bandpass", fs=sf, output="sos")
            Xf = sosfiltfilt(sos, self.bank.Xfull.astype(np.float64), axis=-1)
            if self.source() == "stft":
                nper = int(min(round(sf / 2), Xf.shape[-1]))
                f, t, Z = stft(Xf, fs=sf, nperseg=nper, noverlap=nper - max(1, nper // 8), axis=-1)
                m = (f >= lo) & (f <= hi)
                if m.sum() == 0:
                    raise FeatureError("No STFT bins inside the frequency range.")
                out = (Z[:, :, m, :], f[m], t + self.bank.times_full[0], False)
            else:
                freqs = np.linspace(lo, hi, 8)
                C = cwt_power(Xf, freqs, sf, "morlet")  # (n, ch, freqs, samples)
                out = (C, freqs, self.bank.times_full, False)
        self.bank.cache[key] = out
        return out

    def names(self):
        return [f"{ch} TF {LABEL[o]}" for ch in self.bank.ch_names for o in self.outputs()]

    def units(self):
        return [UNIT[o] for _ in self.bank.ch_names for o in self.outputs()]

    def interval(self):
        a, b = self.task()
        lo, hi = self.freq_range()
        bl = self.baseline()
        s = f"task {a:.3f} to {b:.3f} s, {lo:g}-{hi:g} Hz"
        if bl:
            s += f"; baseline {bl[0]:.3f} to {bl[1]:.3f} s (original full epoch)"
        return s

    def compute(self, X, idx):
        C, f, t, _ = self.tfr()
        A = np.abs(C[idx])  # amplitude
        P = A**2  # power
        a, b = self.task()
        tm = (t >= a - 1e-9) & (t < b - 1e-9)
        if tm.sum() < 1:
            raise FeatureError("The task interval contains no TFR time points.")
        df = float(f[1] - f[0]) if len(f) > 1 else 1.0
        dt = float(t[1] - t[0]) if len(t) > 1 else 1.0 / self.bank.sfreq
        cols = []
        for o in self.outputs():
            if o == "mean_power":
                cols.append(P[..., tm].mean(axis=(-1, -2)))
            elif o == "max_power":
                cols.append(P[..., tm].max(axis=(-1, -2)))
            elif o == "energy":
                cols.append(P[..., tm].sum(axis=(-1, -2)) * dt * df)
            elif o == "coef_mean":
                cols.append(A[..., tm].mean(axis=(-1, -2)))
            elif o == "coef_var":
                cols.append(A[..., tm].var(axis=(-1, -2)))
            elif o == "coef_energy":
                cols.append(P[..., tm].sum(axis=(-1, -2)))
            elif o == "pct_change":
                b0, b1 = self.baseline()
                bm = (t >= b0 - 1e-9) & (t < b1 - 1e-9)
                pb = P[..., bm].mean(axis=(-1, -2))
                if np.any(pb < 1e-12):
                    raise FeatureError("Baseline power is near zero; percent change is disabled.")
                cols.append(100.0 * (P[..., tm].mean(axis=(-1, -2)) - pb) / pb)
        return np.stack(cols, axis=-1).reshape(len(idx), -1)

    def meta(self):
        d = super().meta()
        d["warnings"] = self.warnings()
        d["task"] = list(self.task())
        d["freqs"] = list(self.freq_range())
        d["baselineInterval"] = list(self.baseline()) if self.baseline() else None
        d["source"] = self.source()
        return d

    def preview(self):
        C, f, t, _ = self.tfr()
        P = (np.abs(C) ** 2).mean(axis=(0, 1))
        step = max(1, P.shape[1] // 60)
        a, b = self.task()
        vals = {}
        tm = (t >= a) & (t < b)
        vals["task"] = float(P[:, tm].mean())
        if self.baseline():
            b0, b1 = self.baseline()
            bm = (t >= b0) & (t < b1)
            vals["baseline"] = float(P[:, bm].mean()) if bm.any() else None
        return {
            "kind": "tfrect",
            "freqs": [float(x) for x in f],
            "times": [float(x) for x in t[::step]],
            "map": np.log10(P[:, ::step] + 1e-12).tolist(),
            "task": [a, b],
            "freqRange": list(self.freq_range()),
            "baseline": list(self.baseline()) if self.baseline() else None,
            "values": vals,
            "warnings": self.warnings(),
        }
