"""Export (Page 8): runnable Python script, settings JSON, feature matrix CSV / NPZ (both export modes)."""

from __future__ import annotations

import inspect
import io
import json
import re
import uuid
import zipfile
from importlib import metadata

import numpy as np

from . import evaluate as evmod
from . import selection as selmod
from . import transform as trmod
from .contract import APP_VERSION, SEED, ValidationError, settings_hash
from .features import (
    FAMILY_ORDER,
    FeatureError,
    asymmetry,
    autoencoder,
    classic,
    complexity,
    composite,
    spectral,
    tf_regions,
    time_stats,
    window_means,
)

DOWNLOADS: dict[str, dict] = {}

MODULE_OF = {
    "band_power": [classic],
    "csp": [classic],
    "hjorth": [classic],
    "wavelet": [classic],
    "covariance": [classic],
    "time_stats": [time_stats],
    "window_means": [window_means],
    "spectral_features": [spectral],
    "tf_regions": [classic, tf_regions],
    "asymmetry": [asymmetry],
    "complexity": [time_stats, complexity],
    "autoencoder": [autoencoder],
}
CLASS_NAME = {fid: cls.__name__ for fid, cls in composite.CLASSES.items()}


def versions() -> dict:
    out = {}
    for pkg in ["numpy", "scipy", "scikit-learn", "mne", "pandas", "PyWavelets", "pyriemann", "fastapi"]:
        try:
            out[pkg] = metadata.version(pkg)
        except metadata.PackageNotFoundError:
            out[pkg] = None
    return out


def _strip_relative(src: str) -> str:
    """Remove relative imports and the module docstring header so modules can be concatenated."""
    lines = []
    skip_paren = False
    for ln in src.splitlines():
        if skip_paren:
            if ")" in ln:
                skip_paren = False
            continue
        if re.match(r"^from \.", ln) or re.match(r"^from \.\w* import \($", ln):
            if ln.rstrip().endswith("("):
                skip_paren = True
            continue
        if ln.startswith("from __future__"):
            continue
        lines.append(ln)
    return "\n".join(lines)


def _family_source(fids: list[str]) -> str:
    import app.features as base

    mods = []
    for f in fids:
        for m in MODULE_OF[f]:
            if m not in mods:
                mods.append(m)
    parts = [_strip_relative(inspect.getsource(base))]
    for m in mods:
        parts.append(_strip_relative(inspect.getsource(m)))
    comp = _strip_relative(inspect.getsource(composite.CompositeFeatures))
    classes = ",\n    ".join(f'"{f}": {CLASS_NAME[f]}' for f in fids)
    parts.append(f"CLASSES = {{\n    {classes},\n}}\n\n\ndef make_family(fid, settings, bank):\n    return CLASSES[fid](settings, bank)\n")
    parts.append(comp)
    return "\n\n".join(parts)


def _pipeline_source() -> str:
    lp = _strip_relative(inspect.getsource(trmod.LogPolicy))
    ms = _strip_relative(inspect.getsource(trmod.make_scaler))
    sel = "\n\n".join(
        _strip_relative(inspect.getsource(o))
        for o in (
            selmod.fisher_score,
            selmod.VarianceStep,
            selmod.CorrelationStep,
            selmod.RankStep,
            selmod.ProjectStep,
            selmod.selection_steps,
        )
    )
    clf = _strip_relative(inspect.getsource(evmod.make_classifier))
    return f"EPS = 1e-12\nSEED = {SEED}\n\n{lp}\n\n{ms}\n\n{sel}\n\n{clf}"


def build_script(ds, settings: dict, acc: float | None) -> str:
    bank, sel = evmod.build_bank(ds, settings)
    spec, used_default = evmod.family_spec(settings, sel["preset"])
    fam = json.loads(spec)
    fids = [f for f, _ in fam]
    pkgs = ["mne", "numpy", "scipy", "scikit-learn", "pandas"]
    if any(f in ("wavelet", "tf_regions") for f in fids):
        pkgs.append("PyWavelets")
    if "covariance" in fids:
        pkgs.append("pyriemann")
    preset = dict(sel["preset"])
    preset["_class_names"] = ds.class_names
    w = sel["window"]
    b = sel["band"]
    k, _ = __import__("app.contract", fromlist=["cv_folds"]).cv_folds(ds.counts, int(settings.get("cvFolds", 5)))
    sample = f"example_{ {'motor_imagery': 'motor_imagery', 'erp_p300': 'erp', 'ssvep': 'ssvep'}.get(ds.sample_id or '', 'data') }.csv"
    needs_full = "tf_regions" in fids
    needs_base = "window_means" in fids and ds.baseline is not None
    lines = []
    A = lines.append
    A('"""EEG feature-engineering pipeline exported from the EEG Feature Engineering app.')
    A("")
    A(f"pip install {' '.join(pkgs)}")
    A("")
    A(f"App version {APP_VERSION}. Preset: {ds.paradigm}. Accuracy shown in the app (correct, non-leaky CV):")
    A(f"{acc:.4f}" if acc is not None else "n/a")
    A('"""')
    A("")
    A("from __future__ import annotations")
    A("")
    A("import json")
    A("import numpy as np")
    A("import pandas as pd")
    A("import mne")
    A("from sklearn.base import BaseEstimator, TransformerMixin")
    A("from sklearn.pipeline import Pipeline")
    A("from sklearn.model_selection import StratifiedKFold, cross_val_score")
    A("from sklearn.preprocessing import StandardScaler, RobustScaler, MinMaxScaler")
    A("from sklearn.decomposition import PCA")
    A("from sklearn.discriminant_analysis import LinearDiscriminantAnalysis")
    A("from sklearn.linear_model import LogisticRegression")
    A("from sklearn.svm import LinearSVC")
    A("from sklearn.feature_selection import mutual_info_classif")
    A("")
    A("# ---------------------------------------------------------------- settings")
    A(f'CSV_PATH = "{sample}"  # wide CSV: trial, label, channel, s0, s1, ..., s{{N-1}}')
    A(f"sfreq = {ds.sfreq!r}  # sampling rate (Hz)")
    A(f"tmin = {float(ds.times[0])!r}  # time of the first sample relative to the event (s)")
    A(f"WINDOW = ({w['start']!r}, {w['end']!r})  # Page 2 time window (s), end excluded")
    A(f"CHANNELS = {sel['channels']!r}  # Page 3 channel selection")
    A(f"BAND = ({b['low']!r}, {b['high']!r}); ORDER = {b['order']}  # Page 4 zero-phase Butterworth band-pass")
    A(f"BASELINE = {(ds.baseline['start'], ds.baseline['end']) if ds.baseline else None!r}")
    A(f"FAMILIES = json.loads({spec!r})  # Page 5 feature families and their settings")
    A(f"TRANSFORM = {settings.get('transform', 'none')!r}; NORMALISE = {settings.get('normalise', 'none')!r}  # Page 6")
    A(f"SELECTION = json.loads({json.dumps(settings.get('selectionSettings') or {}, sort_keys=True)!r})  # Page 7")
    A(f"CLASSIFIER = {settings.get('classifier', 'lda')!r}; FOLDS = {k}  # Page 7 evaluation")
    A(f"PRESET = json.loads({json.dumps(preset, sort_keys=True, default=float)!r})")
    A(f"PAIRS = {bank.pairs!r}")
    A("")
    A("# ---------------------------------------------------------------- feature code (same as the app)")
    A(_family_source(fids))
    A("")
    A("# ---------------------------------------------------------------- transform, selection, classifier")
    A(_pipeline_source())
    A("")
    A("# ---------------------------------------------------------------- load the CSV")
    A(_load_source())
    A("")
    A("")
    A("def main():")
    A("    X, y, class_names, ch_names = load_csv(CSV_PATH)")
    A("    info = mne.create_info(ch_names, sfreq, ch_types='eeg')")
    A("    # MNE works in volts; the CSV is in microvolts.")
    A("    epochs = mne.EpochsArray(X * 1e-6, info, tmin=tmin, baseline=None, verbose=False)")
    A("    iir = dict(order=ORDER, ftype='butter', output='sos')")
    A("    # Crop the epoch by time (end excluded), pick channels by name, then band-pass (zero-phase IIR).")
    A("    ep = epochs.copy().crop(WINDOW[0], WINDOW[1], include_tmax=False).pick(CHANNELS)")
    A("    ep.filter(BAND[0], BAND[1], method='iir', iir_params=iir, phase='zero', verbose=False)")
    A("    Xw = ep.get_data() * 1e6")
    A("    times_w = ep.times")
    A("    Xbase = None")
    if needs_base:
        A("    # Each trial's own baseline segment, filtered the same way (window means baseline correction).")
        A("    eb = epochs.copy().crop(BASELINE[0], BASELINE[1], include_tmax=False).pick(CHANNELS)")
        A("    eb.filter(BAND[0], BAND[1], method='iir', iir_params=iir, phase='zero', verbose=False)")
        A("    Xbase = eb.get_data() * 1e6")
    A("    Xfull = epochs.copy().pick(CHANNELS).get_data() * 1e6  # full epoch (tf_regions filters it itself)")
    A("    bank = DataBank(")
    A("        Xw=Xw, times_w=times_w, Xfull=Xfull, times_full=epochs.times, sfreq=sfreq, ch_names=list(CHANNELS),")
    A("        band={'low': BAND[0], 'high': BAND[1], 'order': ORDER},")
    A("        baseline={'start': BASELINE[0], 'end': BASELINE[1]} if BASELINE else None,")
    A("        Xbase=Xbase, preset=PRESET, all_ch_names=ch_names, pairs=PAIRS, y=y,")
    A("    )")
    A("    # Feature extraction, transform, scaler, selection and projection are all inside the Pipeline,")
    A("    # so every learned step (CSP, covariance reference, autoencoder, scaler, selection, projection)")
    A("    # is fitted on the training folds only.")
    A("    pipe = Pipeline([")
    A("        ('features', CompositeFeatures(json.dumps(FAMILIES, sort_keys=True), bank)),")
    A("        ('log', LogPolicy(TRANSFORM)),")
    A("        ('scale', make_scaler(NORMALISE)),")
    A("        *selection_steps(SELECTION),")
    A("        ('clf', make_classifier(CLASSIFIER)),")
    A("    ])")
    A("    idx = np.arange(len(y))[:, None]  # the pipeline input is the trial index")
    A(f"    cv = StratifiedKFold(n_splits=FOLDS, shuffle=True, random_state={SEED})")
    A("    scores = cross_val_score(pipe, idx, y, cv=cv)")
    A("    print('fold accuracies:', np.round(scores, 4))")
    A("    print(f'accuracy: {scores.mean():.4f} +- {scores.std():.4f}')")
    A("")
    A("")
    A('if __name__ == "__main__":')
    A("    main()")
    _ = needs_full
    return "\n".join(lines) + "\n"


def _load_source() -> str:
    return """
def _natural_key(s):
    import re
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\\d+)", s)]


def class_order(labels):
    uniq = sorted({str(x) for x in labels})
    try:
        nums = [float(u) for u in uniq]
        return [u for _, u in sorted(zip(nums, uniq))]
    except ValueError:
        return sorted(uniq, key=_natural_key)


def load_csv(path):
    df = pd.read_csv(path, dtype={"label": str, "channel": str})
    df["trial"] = df["trial"].astype(str).str.strip()
    df["channel"] = df["channel"].astype(str).str.strip()
    df["label"] = df["label"].astype(str).str.strip()
    scols = sorted([c for c in df.columns if c.startswith("s") and c[1:].isdigit()], key=lambda c: int(c[1:]))
    ch_names = list(dict.fromkeys(df["channel"]))
    trials = list(dict.fromkeys(df["trial"]))
    order = class_order(df["label"].unique().tolist())
    X = np.zeros((len(trials), len(ch_names), len(scols)), dtype=np.float64)
    ti = df["trial"].map({t: i for i, t in enumerate(trials)}).values
    ci = df["channel"].map({c: i for i, c in enumerate(ch_names)}).values
    X[ti, ci, :] = df[scols].values.astype(np.float64)
    lab = df.groupby("trial", sort=False)["label"].first()
    y = np.array([order.index(lab[t]) for t in trials], dtype=int)
    return X, y, order, ch_names
"""


def settings_json(ds, settings: dict, mode: str) -> dict:
    bank, sel = evmod.build_bank(ds, settings)
    spec, used_default = evmod.family_spec(settings, sel["preset"])
    return {
        "appVersion": APP_VERSION,
        "presetId": ds.paradigm,
        "classNames": ds.class_names,
        "provenance": ds.provenance,
        "upstream": ds.upstream,
        "settings": settings,
        "resolved": {
            "window": sel["window"],
            "channels": sel["channels"],
            "band": sel["band"],
            "features": json.loads(spec),
            "usingDefaultFeature": used_default,
            "selection": settings.get("selectionSettings"),
            "transform": settings.get("transform", "none"),
            "normalise": settings.get("normalise", "none"),
        },
        "exportMode": mode,
        "seeds": {"cv": SEED, "mutual_info": SEED, "autoencoder": SEED, "pca": SEED, "tsne": SEED},
        "dependencies": versions(),
    }


def export_response(ds, settings: dict, mode: str) -> dict:
    ev = evmod.evaluate_response(ds, settings)
    acc = ev["correct"]["mean"]  # exported scripts reproduce the CORRECT score, never the leaky one
    script = build_script(ds, settings, acc)
    sj = settings_json(ds, settings, mode)
    h = settings_hash(sj["resolved"], mode, ds.id)
    token = uuid.uuid4().hex
    DOWNLOADS[token] = {"ds": ds, "settings": settings, "mode": mode, "hash": h}
    while len(DOWNLOADS) > 32:
        DOWNLOADS.pop(next(iter(DOWNLOADS)))
    return {
        "shape": ev["shape"],
        "hash": h,
        "script": script,
        "settingsJson": sj,
        "token": token,
        "mode": mode,
        "modeLabel": "The downloads use the exploratory all-data fit."
        if mode == "exploratory"
        else "The downloads are out-of-fold: one validation matrix per fold.",
        "accuracy": acc,
    }


def _trial_ids(ds) -> list[str]:
    tid = getattr(ds, "trial_ids", None)
    return [str(t) for t in tid] if tid is not None else [str(i) for i in range(len(ds.y))]


def download(token: str, kind: str):
    d = DOWNLOADS.get(token)
    if d is None:
        raise ValidationError("The download link has expired; export again.")
    ds, settings, mode = d["ds"], d["settings"], d["mode"]
    tids = _trial_ids(ds)
    y = ds.y
    meta = {"mode": mode, "settingsHash": d["hash"], "appVersion": APP_VERSION, "preset": ds.paradigm}
    if mode == "exploratory":
        ev = evmod.evaluate_response(ds, settings)
        from .contract import decode_f32

        Z = decode_f32(ev["matrix"]).astype(np.float64)
        names = ev["names"]
        meta["tag"] = "exploratory only - all-data fit"
        meta["provenance"] = ev["provenance"]
        if kind == "csv":
            buf = io.StringIO()
            import csv

            wtr = csv.writer(buf)
            wtr.writerow(["trial_id", "label", *names])
            for i in range(len(y)):
                wtr.writerow([tids[i], ds.class_names[y[i]], *[f"{v:.6g}" for v in Z[i]]])
            return buf.getvalue().encode("utf-8"), "features_exploratory.csv", "text/csv"
        b = io.BytesIO()
        np.savez_compressed(
            b,
            X_features=Z.astype(np.float32),
            y=y.astype(np.int64),
            class_names=np.array(ds.class_names),
            feature_names=np.array(names),
            trial_ids=np.array(tids),
            meta_json=np.array(json.dumps(meta)),
        )
        return b.getvalue(), "features_exploratory.npz", "application/octet-stream"
    # Out-of-fold: per fold, fit on the training fold and transform the held-out fold.
    folds = oof_folds(ds, settings)
    if kind == "csv":
        zb = io.BytesIO()
        with zipfile.ZipFile(zb, "w", zipfile.ZIP_DEFLATED) as z:
            schemas = []
            for f in folds:
                buf = io.StringIO()
                import csv

                wtr = csv.writer(buf)
                wtr.writerow(["trial_id", "label", *f["names"]])
                for r, i in enumerate(f["test"]):
                    wtr.writerow([tids[i], ds.class_names[y[i]], *[f"{v:.6g}" for v in f["X"][r]]])
                z.writestr(f"fold{f['k']}.csv", buf.getvalue())
                schemas.append({"fold": f["k"], "feature_names": f["names"], "provenance": f["provenance"]})
            z.writestr("schemas.json", json.dumps({"meta": meta, "folds": schemas}, indent=2))
        return zb.getvalue(), "features_out_of_fold.zip", "application/zip"
    b = io.BytesIO()
    arrs = {}
    for f in folds:
        k = f["k"]
        arrs[f"fold{k}_X_val"] = f["X"].astype(np.float32)
        arrs[f"fold{k}_y_val"] = y[f["test"]].astype(np.int64)
        arrs[f"fold{k}_trial_ids"] = np.array([tids[i] for i in f["test"]])
        arrs[f"fold{k}_feature_names"] = np.array(f["names"])
    np.savez_compressed(b, class_names=np.array(ds.class_names), meta_json=np.array(json.dumps(meta)), **arrs)
    return b.getvalue(), "features_out_of_fold.npz", "application/octet-stream"


def oof_folds(ds, settings: dict) -> list[dict]:
    bank, sel = evmod.build_bank(ds, settings)
    spec, _ = evmod.family_spec(settings, sel["preset"])
    cv, k, _ = evmod._cv(ds.counts, int(settings.get("cvFolds", 5)))
    idx = np.arange(len(ds.y))[:, None]
    out = []
    for j, (tr, te) in enumerate(cv.split(idx, ds.y)):
        prep = evmod.make_pipeline(spec, bank, settings, with_clf=False)
        prep.fit(idx[tr], ds.y[tr])
        Xv = prep.transform(idx[te])
        comp = prep.named_steps["features"]
        names = list(comp.names_)
        cols = np.arange(len(names))
        for nm in ("variance", "correlation", "ranking"):
            cols = cols[prep.named_steps[nm].mask_]
        proj = prep.named_steps["projection"]
        if proj.model_ is not None:
            pre = "PC" if proj.method == "pca" else "LD"
            fn = [f"{pre}{i + 1}" for i in range(Xv.shape[1])]
            prov = [{"name": n, "sources": [names[c] for c in cols]} for n in fn]
        else:
            fn = [names[c] for c in cols]
            prov = [{"name": n, "sources": [n]} for n in fn]
        out.append({"k": j + 1, "test": te.tolist(), "X": np.asarray(Xv, dtype=np.float64), "names": fn, "provenance": prov})
    return out


def feature_preview(ds, settings: dict, body: dict) -> dict:
    """Actual recomputed output of one family for one epoch and channel (or a simulated playground)."""
    from .features.composite import make_family

    fid = body.get("family")
    if fid not in FAMILY_ORDER:
        raise ValidationError(f"Unknown feature family {fid!r}.")
    bank, sel = evmod.build_bank(ds, settings)
    fs = (settings.get("featureSettings") or {}).get(fid, {})
    sim = body.get("synthetic")
    if sim:
        # Simulated playground (time statistics): clearly tagged, separate from uploaded data.
        n = bank.Xw.shape[-1]
        t = np.arange(n) / bank.sfreq
        rng = np.random.default_rng(SEED)
        x = float(sim.get("amplitude", 10)) * np.sin(2 * np.pi * float(sim.get("frequency", 10)) * t) + float(
            sim.get("noise", 2)
        ) * rng.standard_normal(n)
        stats = (fs.get("stats") if fs else None) or time_stats.DEFAULT_STATS
        vals = time_stats.compute_stats(x[None, None], [s for s in time_stats.STATS if s in stats], int(fs.get("kmax", 8)))[0, 0]
        return {
            "simulated": True,
            "tag": "simulated",
            "wave": x.tolist(),
            "stats": [s for s in time_stats.STATS if s in stats],
            "values": vals.tolist(),
            "shape": [1, 1, n],
            "hash": settings_hash(sim),
        }
    tr = int(np.clip(int(body.get("trial", 0)), 0, bank.n - 1))
    ch = body.get("channel") or bank.ch_names[0]
    if ch not in bank.ch_names:
        raise ValidationError(f"Channel {ch} is not selected.")
    fam = make_family(fid, fs, bank)
    try:
        fam.check()
        if fam.stateless:
            vals = fam.transform(np.array([tr]))[0]
        else:
            fam.fit(np.arange(bank.n), ds.y)  # display only: all-data fit
            vals = fam.transform(np.array([tr]))[0]
    except FeatureError as e:
        return {"error": str(e), "shape": None, "hash": ""}
    names = fam.names()
    keep = [
        i
        for i, n in enumerate(names)
        if n.startswith(ch + " ") or n.startswith(ch + "-") or fam.id in ("csp", "covariance", "autoencoder", "asymmetry")
    ]
    ci = bank.ch_names.index(ch)
    return {
        "family": fid,
        "trial": tr,
        "channel": ch,
        "input": bank.Xw[tr, ci].tolist(),
        "names": [names[i] for i in keep],
        "values": [float(vals[i]) for i in keep],
        "units": [fam.units()[i] for i in keep],
        "formula": fam.formula,
        "exploratory": not fam.stateless,
        "shape": [1, len(keep)],
        "hash": settings_hash(fid, tr, ch, fs),
    }
