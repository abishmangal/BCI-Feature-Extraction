"""Signal complexity (family 11): line length and Higuchi FD, shared with time_stats (never double-counted)."""

from __future__ import annotations

import numpy as np

from . import Family, FeatureError
from .time_stats import higuchi_fd, kmax_bound, line_length

ITEMS = ["line_length", "higuchi"]


class Complexity(Family):
    id = "complexity"
    title = "Signal complexity"
    explanation = "How jagged and self-similar the signal is (line length, Higuchi fractal dimension)."
    formula = "line length = sum|diff(x)|; Higuchi FD = slope of log L(k) vs log(1/k), k = 1..kmax"

    def items(self):
        return [s for s in ITEMS if s in (self.s.get("items") or ITEMS)]

    def check(self):
        if not self.items():
            raise FeatureError("Choose line length, Higuchi FD or both.")
        if self.bank.Xw.shape[-1] < 8 and "higuchi" in self.items():
            raise FeatureError("Higuchi fractal dimension needs at least 8 samples.")

    # Same names as time_stats so the composite de-duplicates shared features.
    def names(self):
        return [f"{ch} {s}" for ch in self.bank.ch_names for s in self.items()]

    def units(self):
        return [("uV" if s == "line_length" else "1") for _ in self.bank.ch_names for s in self.items()]

    def compute(self, X, idx):
        Xi = X[idx].astype(np.float64)
        cols = []
        for s in self.items():
            cols.append(line_length(Xi) if s == "line_length" else higuchi_fd(Xi, int(self.s.get("kmax", 8))))
        return np.stack(cols, axis=-1).reshape(len(idx), -1)

    def preview(self):
        """Same signal under different noise levels, with real recomputation (seed 7)."""
        tr = int(self.s.get("example_trial", 0)) % self.bank.n
        x = self.bank.Xw[tr, 0].astype(np.float64)
        rng = np.random.default_rng(7)
        noise = rng.standard_normal(len(x)) * (x.std() or 1.0)
        levels = [0.0, 0.25, 0.5, 1.0, 2.0]
        km = kmax_bound(len(x), int(self.s.get("kmax", 8)))
        rows = []
        for lv in levels:
            xs = x + lv * noise
            rows.append(
                {
                    "noise": lv,
                    "line_length": float(line_length(xs[None])[0]),
                    "higuchi": float(higuchi_fd(xs[None], km)[0]) if len(xs) >= 8 else None,
                }
            )
        return {"kind": "noise", "channel": self.bank.ch_names[0], "trial": tr, "kmax": km, "rows": rows}
