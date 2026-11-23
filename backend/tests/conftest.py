import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session")
def samples():
    from app import dataset as d

    return {pid: d.load_sample(pid) for pid in ("motor_imagery", "erp_p300", "ssvep")}


def make_csv(n_trials=20, channels=("A1x", "foo", "Cz", "C3"), classes=("b", "a"), n_samples=50, counts=None, seed=0):
    rng = np.random.default_rng(seed)
    rows = ["trial,label,channel," + ",".join(f"s{i}" for i in range(n_samples))]
    labels = []
    if counts is None:
        counts = [n_trials // len(classes)] * len(classes)
    for ci, c in enumerate(classes):
        labels += [c] * counts[ci]
    for t, lab in enumerate(labels):
        for ch in channels:
            rows.append(f"{t},{lab},{ch}," + ",".join(f"{v:.3f}" for v in rng.standard_normal(n_samples)))
    return ("\n".join(rows) + "\n").encode()


def default_settings(ds, **over):
    p = ds.preset()
    s = {
        "window": p["defaultWindow"],
        "channels": list(ds.ch_names),
        "band": p["defaultBand"],
        "features": [],
        "featureSettings": {},
        "selectionSettings": {},
        "transform": "none",
        "normalise": "none",
        "classifier": "lda",
        "cvFolds": 5,
        "leakageGuard": True,
    }
    s.update(over)
    return s
