"""Windowed means, ERP-style (family 7)."""

from __future__ import annotations

import numpy as np

from . import Family, FeatureError


class WindowMeans(Family):
    id = "window_means"
    title = "Windowed means (ERP-style)"
    explanation = "Average amplitude in consecutive short time bins of the window."
    formula = "m_j = mean of x over bin j (bin width w ms); optional baseline: x - mean(x over baseline)"

    def bin_samples(self) -> int:
        ms = float(self.s.get("binMs", 50))
        return max(1, int(round(ms / 1000.0 * self.bank.sfreq)))

    def n_bins(self) -> int:
        return self.bank.Xw.shape[-1] // self.bin_samples()

    def dropped(self) -> int:
        return self.bank.Xw.shape[-1] - self.n_bins() * self.bin_samples()

    def use_baseline(self) -> bool:
        b = self.s.get("baseline")
        if b is None:
            b = self.bank.preset.get("id") == "erp_p300"
        return bool(b) and self.bank.Xbase is not None

    def check(self):
        if self.n_bins() < 2:
            raise FeatureError("The bin width is too large: at least 2 bins must fit in the window.")
        if self.s.get("baseline") and self.bank.Xbase is None:
            raise FeatureError("Baseline correction needs a baseline interval; this dataset has none.")

    def starts(self) -> list[float]:
        b = self.bin_samples()
        return [float(self.bank.times_w[0] + j * b / self.bank.sfreq) for j in range(self.n_bins())]

    def names(self):
        return [f"{ch} {t * 1000:.0f} ms mean" for ch in self.bank.ch_names for t in self.starts()]

    def units(self):
        return ["uV"] * len(self.names())

    def _signal(self, X, idx):
        Xi = X[idx].astype(np.float64)
        if self.use_baseline():
            Xi = Xi - self.bank.Xbase[idx].astype(np.float64).mean(axis=-1, keepdims=True)
        return Xi

    def compute(self, X, idx):
        Xi = self._signal(X, idx)
        b, nb = self.bin_samples(), self.n_bins()
        Xi = Xi[..., : nb * b].reshape(Xi.shape[0], Xi.shape[1], nb, b).mean(axis=-1)
        return Xi.reshape(len(idx), -1)

    def meta(self):
        d = super().meta()
        d["droppedSamples"] = self.dropped()
        d["baselineCorrected"] = self.use_baseline()
        return d

    def preview(self):
        tr = int(self.s.get("example_trial", 0)) % self.bank.n
        x = self._signal(self.bank.Xw, np.array([tr]))[0, 0]
        steps = self.compute(self.bank.Xw, np.array([tr]))[0][: self.n_bins()]
        return {
            "kind": "steps",
            "channel": self.bank.ch_names[0],
            "trial": tr,
            "wave": x.tolist(),
            "binSamples": self.bin_samples(),
            "steps": [float(v) for v in steps],
            "dropped": self.dropped(),
        }
