"""Produce the offline sample results JSON (one per preset) and the sample CSV files.

Run from the repository root:  python scripts/make_fallback.py
Writes frontend/public/fallback/{preset}.json, sample/example_*.csv and frontend/public/sample/example_*.csv.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
import orjson

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import dataset as dsmod  # noqa: E402
from app import main as api  # noqa: E402
from app import paradigms as pmod  # noqa: E402

SAMPLE_FILES = {"motor_imagery": "example_motor_imagery.csv", "erp_p300": "example_erp.csv", "ssvep": "example_ssvep.csv"}


def write_csv(pid: str, path: Path) -> None:
    X, y, t, sf, ch, cn = pmod.generate(pid)
    n, c, s = X.shape
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write("trial,label,channel," + ",".join(f"s{i}" for i in range(s)) + "\n")
        for k in range(n):
            for j in range(c):
                f.write(f"{k},{cn[y[k]]},{ch[j]}," + ",".join(f"{v:.4f}" for v in X[k, j]) + "\n")


def default_settings(resp: dict) -> dict:
    p = resp["preset"]
    chans = next((e["channels"] for e in resp["electrodePresets"] if e.get("isDefault")), resp["channels"])
    return {
        "paradigm": resp["paradigm"],
        "window": p["defaultWindow"],
        "channels": chans,
        "band": p["defaultBand"],
        "probe": p["probe"],
        "map": {**p["mapMetric"], "visible": True, "opacity": 70},
        "features": [],
        "featureSettings": {},
        "selectionSettings": {
            "variance": {"on": False, "threshold": 0},
            "correlation": {"on": False, "threshold": 0.95},
            "ranking": {"on": False, "method": "fisher", "topK": 20},
            "projection": {"method": "none", "components": 2},
        },
        "transform": "none",
        "normalise": "none",
        "classifier": "lda",
        "cvFolds": 5,
        "leakageGuard": True,
        "exportMode": "exploratory",
    }


def main() -> None:
    (ROOT / "sample").mkdir(exist_ok=True)
    pub = ROOT / "frontend" / "public"
    (pub / "sample").mkdir(parents=True, exist_ok=True)
    (pub / "fallback").mkdir(parents=True, exist_ok=True)
    for pid, fname in SAMPLE_FILES.items():
        out = ROOT / "sample" / fname
        write_csv(pid, out)
        shutil.copyfile(out, pub / "sample" / fname)
        resp = api.synthetic({"paradigm": pid})
        ds = dsmod.get(resp["id"])
        s = default_settings(resp)
        body = {"dataset_id": ds.id, "settings": s}
        bundle = {
            "paradigms": api.paradigms(),
            "electrodePresets": api.electrode_presets(),
            "dataset": resp,
            "settings": s,
            "window": api.window({**body, "probe": s["probe"]}),
            "channels": api.channels({**body, "map": s["map"]}),
            "band": api.band({**body, **s["band"], "example_trial": 0, "example_channel": s["channels"][0]}),
            "features": api.features(body),
            "transform": api.transform({**body, "transform": "none", "normalise": "none"}),
            "evaluate": api.evaluate(body),
            "export": api.export({**body, "export_mode": "exploratory"}),
        }
        (pub / "fallback" / f"{pid}.json").write_bytes(orjson.dumps(bundle, option=orjson.OPT_SERIALIZE_NUMPY))
        print(pid, "ok", out.name, f"accuracy {bundle['evaluate']['correct']['mean']:.3f}")
    _ = np


if __name__ == "__main__":
    main()
