"""Hemispheric asymmetry (family 10)."""

from __future__ import annotations

import numpy as np

from . import Family, FeatureError, band_integral, welch_psd

EPS = 1e-12


class Asymmetry(Family):
    id = "asymmetry"
    title = "Hemispheric asymmetry"
    explanation = "Difference in band power between matched left and right channels."
    formula = "diff = P_left - P_right; normalized = (P_left - P_right) / (P_left + P_right + 1e-12)"

    def pairs(self):
        p = self.s.get("pairs")
        if p is None:
            det = self.bank.pairs
            p = [det[0]] if det else []
        return [{"left": a["left"], "right": a["right"]} for a in p]

    def bands(self):
        b = self.s.get("bands")
        if b:
            return [
                {"name": x.get("name") or f"{x['low']:g}-{x['high']:g} Hz", "low": float(x["low"]), "high": float(x["high"])} for x in b
            ]
        kb = self.bank.preset.get("keyBands") or []
        if kb:
            return [{"name": kb[0]["name"], "low": float(kb[0]["low"]), "high": float(kb[0]["high"])}]
        bd = self.bank.band
        return [{"name": f"{bd['low']:g}-{bd['high']:g} Hz", "low": float(bd["low"]), "high": float(bd["high"])}]

    def reps(self):
        r = self.s.get("representations") or ["difference"]
        return [x for x in ("difference", "normalized") if x in r]

    def check(self):
        if not self.bank.pairs and not self.s.get("pairs"):
            raise FeatureError("No left/right channel pair was detected in this dataset (for example C3/C4); pick two channels manually.")
        if not self.pairs():
            raise FeatureError("Choose at least one channel pair.")
        for p in self.pairs():
            missing = [c for c in (p["left"], p["right"]) if c not in self.bank.ch_names]
            if missing:
                raise FeatureError(
                    f"Pair {p['left']}/{p['right']} needs {', '.join(missing)}, which is excluded on Page 3. Include it there or choose another pair."
                )
        if not self.reps():
            raise FeatureError("Choose difference, normalized or both.")

    def names(self):
        return [
            f"{p['left']}-{p['right']} {b['name']} {'diff' if r == 'difference' else 'norm'}"
            for p in self.pairs()
            for b in self.bands()
            for r in self.reps()
        ]

    def units(self):
        return [("uV^2" if r == "difference" else "1") for _ in self.pairs() for _ in self.bands() for r in self.reps()]

    def compute(self, X, idx):
        f, P = welch_psd(X[idx], self.bank.sfreq)
        ch = self.bank.ch_names
        out = []
        for p in self.pairs():
            li, ri = ch.index(p["left"]), ch.index(p["right"])
            for b in self.bands():
                pl = band_integral(f, P[:, li], b["low"], b["high"])
                pr = band_integral(f, P[:, ri], b["low"], b["high"])
                for r in self.reps():
                    out.append(pl - pr if r == "difference" else (pl - pr) / (pl + pr + EPS))
        return np.stack(out, axis=-1)

    def preview(self):
        p = self.pairs()[0]
        b = self.bands()[0]
        f, P = welch_psd(self.bank.Xw, self.bank.sfreq)
        ch = self.bank.ch_names
        y = self.bank.y
        pl = band_integral(f, P[:, ch.index(p["left"])], b["low"], b["high"])
        pr = band_integral(f, P[:, ch.index(p["right"])], b["low"], b["high"])
        return {
            "kind": "pair",
            "left": p["left"],
            "right": p["right"],
            "band": b,
            "perClass": [
                {"left": float(pl[y == k].mean()), "right": float(pr[y == k].mean()), "diff": float((pl - pr)[y == k].mean())}
                for k in range(int(y.max()) + 1)
            ],
        }
