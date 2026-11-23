"""FastAPI backend (section 9). JSON via orjson, CORS for localhost:5173."""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, Response

from . import autoencoder_jobs as aej
from . import band as bmod
from . import channels as chmod
from . import dataset as dsmod
from . import evaluate as evmod
from . import export as exmod
from . import montage as mmod
from . import paradigms as pmod
from . import transform as trmod
from . import window as wmod
from .contract import APP_VERSION, ValidationError, settings_hash

app = FastAPI(title="EEG feature engineering", version=APP_VERSION, default_response_class=ORJSONResponse)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ValidationError)
async def _validation(_: Request, exc: ValidationError):
    return ORJSONResponse(status_code=422, content={"errors": exc.errors})


def _body_ds(body: dict):
    ds = dsmod.get(body.get("dataset_id", ""))
    return ds, body.get("settings") or {}


def _with_hash(d: dict, *parts) -> dict:
    d.setdefault("hash", settings_hash(*parts))
    return d


@app.get("/health")
def health():
    return {"status": "ok", "version": APP_VERSION, "shape": None, "hash": APP_VERSION}


@app.get("/paradigms")
def paradigms():
    data = pmod.load_paradigms()
    return {
        "version": data["version"],
        "presets": data["presets"],
        "montages": mmod.builtin_montages(),
        "namedBands": pmod.NAMED_BANDS,
        "shape": None,
        "hash": settings_hash(data),
    }


@app.get("/electrode-presets")
def electrode_presets():
    g = chmod.generic_sets()
    return {**g, "shape": None, "hash": settings_hash(g)}


@app.post("/dataset/synthetic")
def synthetic(body: dict):
    pid = body.get("paradigm")
    try:
        ds = dsmod.load_sample(pid)
    except KeyError as e:
        raise ValidationError(f"Unknown sample {pid!r}.") from e
    return dsmod.dataset_response(ds)


def _f(v, default=None):
    if v is None or str(v).strip() == "":
        return default
    try:
        return float(v)
    except ValueError as e:
        raise ValidationError(f"{v!r} is not a number.") from e


@app.post("/dataset/upload")
async def upload_csv(
    file: UploadFile = File(...),
    sfreq: str = Form("250"),
    tmin: str = Form("0"),
    baseline_start: str = Form(""),
    baseline_end: str = Form(""),
    montage: str = Form("standard_1005"),
    interpret: str = Form("custom"),
):
    raw = await file.read()
    sf = _f(sfreq, 250.0)
    t0 = _f(tmin, 0.0)
    b0, b1 = _f(baseline_start), _f(baseline_end)
    if (b0 is None) != (b1 is None):
        raise ValidationError("Enter both baseline start and end, or leave both empty.")
    baseline = {"start": b0, "end": b1} if b0 is not None else None
    if montage not in mmod.builtin_montages():
        raise ValidationError(f"Unknown montage {montage!r}.")
    ds = dsmod.parse_csv(raw, sf, t0, baseline, montage, interpret)
    return dsmod.dataset_response(ds)


@app.post("/dataset/upload-npz")
async def upload_npz(
    file: UploadFile = File(...),
    montage: str = Form("standard_1005"),
    interpret: str = Form("custom"),
):
    raw = await file.read()
    if montage not in mmod.builtin_montages():
        raise ValidationError(f"Unknown montage {montage!r}.")
    ds = dsmod.parse_npz(raw, montage, interpret)
    return dsmod.dataset_response(ds)


@app.post("/dataset/interpret")
def interpret(body: dict):
    ds = dsmod.get(body.get("dataset_id", ""))
    pid = body.get("paradigm") or "custom"
    try:
        dsmod.apply_interpret(ds, pid)
    except KeyError as e:
        raise ValidationError(f"Unknown preset {pid!r}.") from e
    return dsmod.dataset_response(ds)


@app.post("/dataset/montage")
def set_montage(body: dict):
    ds = dsmod.get(body.get("dataset_id", ""))
    m = body.get("montage") or "standard_1005"
    if m not in mmod.builtin_montages():
        raise ValidationError(f"Unknown montage {m!r}.")
    ds.montage = m
    return dsmod.dataset_response(ds)


@app.post("/window")
def window(body: dict):
    ds, s = _body_ds(body)
    if "start" in body and "end" in body:
        s = {**s, "window": {"start": body["start"], "end": body["end"]}}
    return _with_hash(wmod.window_response(ds, s, body), ds.id, s.get("window"), body.get("probe"))


@app.post("/channels")
def channels(body: dict):
    ds, s = _body_ds(body)
    if "channels" in body:
        s = {**s, "channels": body["channels"]}
    return _with_hash(chmod.channels_response(ds, s, body), ds.id, s.get("window"), s.get("channels"), body.get("map"))


@app.post("/band")
def band(body: dict):
    ds, s = _body_ds(body)
    sel = wmod.resolve(ds, s)
    return _with_hash(bmod.band_response(ds, sel, body), ds.id, s.get("window"), s.get("channels"), body)


@app.post("/features")
def features(body: dict):
    ds, s = _body_ds(body)
    return evmod.features_response(ds, s)


@app.post("/feature-preview")
def feature_preview(body: dict):
    ds, s = _body_ds(body)
    return exmod.feature_preview(ds, s, body)


@app.post("/autoencoder/train")
def ae_train(body: dict):
    ds, s = _body_ds(body)
    bank, _ = evmod.build_bank(ds, s)
    fs = (s.get("featureSettings") or {}).get("autoencoder") or {}
    jid = aej.start(bank, fs, int(body.get("example_trial", 0)))
    return {"job_id": jid, "shape": None, "hash": jid}


@app.get("/autoencoder/status/{job_id}")
def ae_status(job_id: str):
    return {**aej.status(job_id), "shape": None, "hash": job_id}


@app.post("/autoencoder/cancel")
def ae_cancel(body: dict):
    return {**aej.cancel(body.get("job_id", "")), "shape": None, "hash": body.get("job_id", "")}


@app.post("/transform")
def transform(body: dict):
    ds, s = _body_ds(body)
    F, names, *_ = evmod.feature_matrix(ds, s)
    out = trmod.transform_response(
        F,
        names,
        ds.y,
        len(ds.class_names),
        {
            **body,
            "transform": body.get("transform", s.get("transform", "none")),
            "normalise": body.get("normalise", s.get("normalise", "none")),
        },
    )
    if body.get("feature") is None:
        r = evmod.ranking(F, ds.y, len(ds.class_names))["auc"]
        out["defaultFeature"] = names[int(np.argmax(r))]
    return _with_hash(out, ds.id, s, body.get("feature"))


@app.post("/evaluate")
def evaluate(body: dict):
    ds, s = _body_ds(body)
    return evmod.evaluate_response(ds, s, body)


@app.post("/export")
def export(body: dict):
    ds, s = _body_ds(body)
    return exmod.export_response(ds, s, body.get("export_mode", s.get("exportMode", "exploratory")))


@app.get("/export/features.csv")
def export_csv(token: str):
    data, name, mime = exmod.download(token, "csv")
    return Response(content=data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/export/features.npz")
def export_npz(token: str):
    data, name, mime = exmod.download(token, "npz")
    return Response(content=data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})
