"""Learned latent features (family 12): a compact, deterministic NumPy/SciPy undercomplete autoencoder.

decimate each channel (scipy.signal.decimate) to at most 125 samples -> flatten -> standardize with
training-only statistics -> encoder h = tanh(W1 x + b1) -> linear decoder x_hat = W2 h + b2 -> minibatch
gradient descent on MSE with analytical gradients, seed 7. Early stopping on a fixed stratified validation
subset (20 percent of the training fold), patience 5. Transform returns the latent code h.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import decimate

from . import Family, FeatureError

MAX_SAMPLES = 125
DEFAULTS = {"latent": 8, "epochs": 50, "lr": 0.01, "batch": 16}


def decimate_to(X: np.ndarray, max_samples: int = MAX_SAMPLES) -> np.ndarray:
    """Decimate along the last axis (anti-aliased, zero-phase) in stages of at most 10."""
    X = np.asarray(X, dtype=np.float64)
    while X.shape[-1] > max_samples:
        q = int(np.ceil(X.shape[-1] / max_samples))
        q = min(q, 10)
        if q < 2:
            break
        X = decimate(X, q, axis=-1, zero_phase=True)
    return X


def stratified_split(y: np.ndarray, frac: float, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    tr, va = [], []
    for k in np.unique(y):
        idx = np.flatnonzero(y == k)
        idx = idx[rng.permutation(len(idx))]
        nv = int(round(frac * len(idx)))
        nv = min(max(nv, 1 if len(idx) > 1 else 0), len(idx) - 1)
        va.extend(idx[:nv])
        tr.extend(idx[nv:])
    return np.sort(np.array(tr, dtype=int)), np.sort(np.array(va, dtype=int))


class TinyAE:
    def __init__(self, latent=8, epochs=50, lr=0.01, batch=16, seed=7, patience=5):
        self.latent, self.epochs, self.lr, self.batch = int(latent), int(epochs), float(lr), int(batch)
        self.seed, self.patience = seed, patience
        self.history: list[dict] = []
        self.cancelled = False

    def _forward(self, Z):
        H = np.tanh(Z @ self.W1 + self.b1)
        return H, H @ self.W2 + self.b2

    def fit(self, X: np.ndarray, y: np.ndarray, progress=None) -> TinyAE:
        X = np.asarray(X, dtype=np.float64)
        tr, va = stratified_split(y, 0.2, self.seed)
        self.mu = X[tr].mean(axis=0)
        self.sd = X[tr].std(axis=0) + 1e-8
        Z = (X - self.mu) / self.sd
        Zt, Zv = Z[tr], Z[va]
        d = Z.shape[1]
        k = min(self.latent, d - 1)
        rng = np.random.default_rng(self.seed)
        self.W1 = rng.standard_normal((d, k)) / np.sqrt(d)
        self.b1 = np.zeros(k)
        self.W2 = rng.standard_normal((k, d)) / np.sqrt(k)
        self.b2 = np.zeros(d)

        def loss(Zs):
            _, R = self._forward(Zs)
            return float(((R - Zs) ** 2).mean())

        best = (np.inf, None)
        bad = 0
        self.history = [{"epoch": 0, "train": loss(Zt), "val": loss(Zv) if len(Zv) else None}]
        n = len(Zt)
        for ep in range(1, self.epochs + 1):
            if self.cancelled:
                break
            order = rng.permutation(n)
            for s in range(0, n, self.batch):
                B = Zt[order[s : s + self.batch]]
                m = len(B)
                H, R = self._forward(B)
                G = 2.0 * (R - B) / (m * d)  # dL/dR for mean squared error
                gW2 = H.T @ G
                gb2 = G.sum(axis=0)
                GH = (G @ self.W2.T) * (1 - H**2)
                gW1 = B.T @ GH
                gb1 = GH.sum(axis=0)
                self.W1 -= self.lr * gW1
                self.b1 -= self.lr * gb1
                self.W2 -= self.lr * gW2
                self.b2 -= self.lr * gb2
            lt = loss(Zt)
            lv = loss(Zv) if len(Zv) else lt
            self.history.append({"epoch": ep, "train": lt, "val": lv})
            if progress:
                progress(ep, self.epochs, self.history)
            if lv < best[0] - 1e-9:
                best = (lv, (self.W1.copy(), self.b1.copy(), self.W2.copy(), self.b2.copy()))
                bad = 0
            else:
                bad += 1
                if bad >= self.patience:
                    break
        if best[1] is not None:
            self.W1, self.b1, self.W2, self.b2 = best[1]
        return self

    def encode(self, X):
        Z = (np.asarray(X, dtype=np.float64) - self.mu) / self.sd
        return np.tanh(Z @ self.W1 + self.b1)

    def reconstruct(self, X):
        Z = (np.asarray(X, dtype=np.float64) - self.mu) / self.sd
        _, R = self._forward(Z)
        return R * self.sd + self.mu

    def loss_drop(self) -> float:
        t0 = self.history[0]["train"]
        t1 = min(h["train"] for h in self.history)
        return float((t0 - t1) / t0) if t0 > 0 else 0.0


class Autoencoder(Family):
    id = "autoencoder"
    title = "Learned latent features (advanced)"
    explanation = "A tiny network learns a compressed code of each trial (trained on training folds only)."
    stateless = False
    formula = "h = tanh(W1 z + b1), z = standardized decimated trial; x_hat = W2 h + b2; minimize mean (x_hat - z)^2"

    def params(self):
        p = {k: self.s.get(k, v) for k, v in DEFAULTS.items()}
        return p

    def inputs(self, idx):
        key = ("ae_dec",)
        D = self.bank.cache.get(key)
        if D is None:
            D = decimate_to(self.bank.Xw).reshape(self.bank.n, -1)
            self.bank.cache[key] = D
        return D[idx]

    def latent(self):
        d = self.inputs(np.array([0])).shape[1]
        return int(min(int(self.params()["latent"]), d - 1))

    def check(self):
        if self.inputs(np.array([0])).shape[1] < 3:
            raise FeatureError("The input is too small for an autoencoder.")
        lr = float(self.params()["lr"])
        if not (0.0005 <= lr <= 0.1):
            raise FeatureError("Learning rate must be between 0.0005 and 0.1.")

    def names(self):
        return [f"AE latent {j + 1}" for j in range(self.latent())]

    def units(self):
        return ["1"] * self.latent()

    def fit(self, idx, y):
        self.bank.fit_log.append(("autoencoder", np.asarray(idx).copy()))
        p = self.params()
        self.ae = TinyAE(p["latent"], p["epochs"], p["lr"], p["batch"]).fit(self.inputs(idx), np.asarray(y))
        return self

    def transform(self, idx):
        return self.ae.encode(self.inputs(idx))

    def preview(self):
        return {"kind": "autoencoder", "train": "POST /autoencoder/train"}
