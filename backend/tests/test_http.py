"""Live HTTP smoke test: real uvicorn server, multipart CSV upload, 422 errors, CORS."""

import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from conftest import make_csv

ROOT = Path(__file__).resolve().parents[1]


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture(scope="module")
def server():
    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/health", timeout=1)
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    yield base
    proc.terminate()
    proc.wait(10)


def _post(base, path, body):
    req = urllib.request.Request(
        base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read()), dict(r.headers)


def _multipart(base, path, fields, file_bytes, filename):
    bnd = "----testboundary7"
    parts = []
    for k, v in fields.items():
        parts.append(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(
        f'--{bnd}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
        + file_bytes
        + b"\r\n"
    )
    parts.append(f"--{bnd}--\r\n".encode())
    req = urllib.request.Request(base + path, data=b"".join(parts), headers={"Content-Type": f"multipart/form-data; boundary={bnd}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_endpoints(server):
    with urllib.request.urlopen(server + "/paradigms") as r:
        p = json.loads(r.read())
    assert [x["id"] for x in p["presets"]] == ["motor_imagery", "erp_p300", "ssvep"] and "standard_1005" in p["montages"]
    ds, headers = _post(server, "/dataset/synthetic", {"paradigm": "motor_imagery"})
    assert ds["shape"] == [100, 22, 750] and headers.get("access-control-allow-origin") == "http://localhost:5173"
    s = {"window": {"start": 0, "end": 2}, "channels": ["C3", "Cz", "C4"], "band": {"low": 8, "high": 30, "order": 4}}
    w, _ = _post(server, "/window", {"dataset_id": ds["id"], "settings": s, "probe": ds["preset"]["probe"]})
    assert w["shape"] == [100, 22, 500] and "hash" in w
    c, _ = _post(
        server, "/channels", {"dataset_id": ds["id"], "settings": s, "map": {"metric": "bandpower_change", "band": [8, 12], "mapClass": 0}}
    )
    assert c["shape"] == [100, 3, 500] and c["map"]["grid"]["shape"] == [64, 64]
    assert c["window"] == s["window"]
    vals = dict(zip(ds["channels"], c["map"]["shownValues"], strict=True))
    assert max(vals, key=vals.get) == "C4"  # left hand: strongest decrease at C4
    c1, _ = _post(
        server, "/channels", {"dataset_id": ds["id"], "settings": s, "map": {"metric": "bandpower_change", "band": [8, 12], "mapClass": 1}}
    )
    vals1 = dict(zip(ds["channels"], c1["map"]["shownValues"], strict=True))
    assert max(vals1, key=vals1.get) == "C3"


def test_effect_maps_other_presets(server):
    p3, _ = _post(server, "/dataset/synthetic", {"paradigm": "erp_p300"})
    s = {"window": {"start": 0.1, "end": 0.6}}
    c, _ = _post(server, "/channels", {"dataset_id": p3["id"], "settings": s, "map": {"metric": "separability_amplitude"}})
    v = dict(zip(p3["channels"], c["map"]["shownValues"], strict=True))
    assert max(v, key=v.get) in ("Pz", "Cz")
    amplitudes = []
    for cls in (0, 1):
        result, _ = _post(server, "/channels", {
            "dataset_id": p3["id"], "settings": s, "map": {"metric": "mean_amplitude", "mapClass": cls},
        })
        amplitudes.append(result["map"]["values"])
        assert result["map"]["unit"] == "µV"
    difference, _ = _post(server, "/channels", {
        "dataset_id": p3["id"], "settings": s,
        "map": {"metric": "mean_amplitude", "mapClass": "diff", "pair": {"a": 1, "b": 0}},
    })
    expected = [target - background for background, target in zip(*amplitudes, strict=True)]
    assert difference["map"]["values"] == pytest.approx(expected)
    ss, _ = _post(server, "/dataset/synthetic", {"paradigm": "ssvep"})
    c, _ = _post(
        server,
        "/channels",
        {"dataset_id": ss["id"], "settings": {"window": {"start": 0.5, "end": 2.0}}, "map": {"metric": "snr", "mapClass": 0}},
    )
    v = dict(zip(ss["channels"], c["map"]["shownValues"], strict=True))
    assert max(v, key=v.get) in ("Oz", "O1", "O2")


def test_p300_probe_accepts_one_class(server):
    ds, _ = _post(server, "/dataset/synthetic", {"paradigm": "erp_p300"})
    single, _ = _post(server, "/window", {"dataset_id": ds["id"], "settings": {"probeClasses": [1]}})
    assert single["probeClasses"] == [1]
    assert single["separability"] is None


def test_csv_upload_and_errors(server):
    st, ds = _multipart(
        server,
        "/dataset/upload",
        {"sfreq": "200", "tmin": "-0.1", "montage": "standard_1005", "interpret": "custom"},
        make_csv(n_trials=12, channels=("Fz", "zzz", "Pz"), n_samples=60),
        "x.csv",
    )
    assert st == 200 and ds["shape"] == [12, 3, 60] and ds["layout"]["n_in_tray"] == 1
    st, err = _multipart(server, "/dataset/upload", {"sfreq": "200"}, b"trial,label\n1,a\n", "bad.csv")
    assert st == 422 and err["errors"] and "Missing column" in err["errors"][0]
