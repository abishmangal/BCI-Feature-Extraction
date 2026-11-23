"""Bounded CPU autoencoder training jobs for the Page 5 preview (train / status / cancel)."""

from __future__ import annotations

import threading
import uuid

import numpy as np
from sklearn.decomposition import PCA

from .contract import SEED, encode_f32
from .features.autoencoder import DEFAULTS, TinyAE, decimate_to

JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()
MAX_JOBS = 2


def start(bank, settings: dict, example_trial: int = 0) -> str:
    with _LOCK:
        running = [j for j in JOBS.values() if j["state"] == "running"]
        if len(running) >= MAX_JOBS:
            for j in running:
                j["ae"].cancelled = True
        jid = uuid.uuid4().hex[:10]
        p = {k: settings.get(k, v) for k, v in DEFAULTS.items()}
        ae = TinyAE(p["latent"], p["epochs"], p["lr"], p["batch"])
        job = {"id": jid, "state": "running", "progress": 0.0, "history": [], "ae": ae, "result": None, "error": None}
        JOBS[jid] = job

    def run():
        try:
            D = decimate_to(bank.Xw).reshape(bank.n, -1)
            y = bank.y

            def prog(ep, total, hist):
                job["progress"] = ep / total
                job["history"] = list(hist)

            ae.fit(D, y, progress=prog)
            if ae.cancelled:
                job["state"] = "cancelled"
                return
            tr = int(example_trial) % bank.n
            rec = ae.reconstruct(D[tr : tr + 1])[0]
            codes = ae.encode(D)
            p2 = PCA(n_components=min(2, codes.shape[1]), random_state=SEED).fit_transform(codes)
            if p2.shape[1] == 1:
                p2 = np.c_[p2, np.zeros(len(p2))]
            nch = bank.Xw.shape[1]
            job["result"] = {
                "trial": tr,
                "original": encode_f32(D[tr].reshape(nch, -1)),
                "reconstructed": encode_f32(rec.reshape(nch, -1)),
                "latentPca": encode_f32(p2),
                "labels": [int(v) for v in y],
                "lossDrop": ae.loss_drop(),
                "history": ae.history,
                "note": "fitted on all trials for the preview only (display); evaluation trains inside each training fold",
            }
            job["history"] = ae.history
            job["progress"] = 1.0
            job["state"] = "done"
        except Exception as e:  # noqa: BLE001
            job["state"] = "error"
            job["error"] = str(e)

    threading.Thread(target=run, daemon=True).start()
    return jid


def status(jid: str) -> dict:
    j = JOBS.get(jid)
    if j is None:
        return {"state": "unknown", "error": "No such job."}
    return {
        "id": jid,
        "state": j["state"],
        "progress": j["progress"],
        "history": j["history"],
        "result": j["result"],
        "error": j["error"],
    }


def cancel(jid: str) -> dict:
    j = JOBS.get(jid)
    if j is not None and j["state"] == "running":
        j["ae"].cancelled = True
        j["state"] = "cancelled"
    return {"id": jid, "state": j["state"] if j else "unknown"}
