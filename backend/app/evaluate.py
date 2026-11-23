"""Evaluation (Page 7) and shared pipeline construction (section 6A.3).

Every operation that learns from several trials is fitted inside each training fold through a scikit-learn
Pipeline. The "leaky" variant (labelled leaky) fits those steps on ALL data before splitting.
"""

from __future__ import annotations

import json

import numpy as np
from sklearn.decomposition import PCA
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

from . import band as bmod
from . import window as wmod
from .channels import auc_sep
from .contract import SEED, ValidationError, chance_level, cv_folds, encode_f32, settings_hash
from .features import DataBank, FeatureError
from .features.composite import LEARNED, CompositeFeatures, describe, ordered
from .selection import any_selection, fisher_score, selection_steps
from .transform import LogPolicy, make_scaler

BANKS: dict[str, DataBank] = {}
RESULTS: dict[str, dict] = {}


def build_bank(ds, settings: dict) -> tuple[DataBank, dict]:
    sel = wmod.resolve(ds, settings)
    key = settings_hash(ds.id, sel["window"], sel["channels"], sel["band"], ds.paradigm)
    if key in BANKS:
        return BANKS[key], sel
    Xw, tw = wmod.crop(ds, sel["window"]["start"], sel["window"]["end"])
    chi = sel["ch_idx"]
    b = sel["band"]
    Xf, warns = bmod.bandpass(Xw[:, chi, :], ds.sfreq, b["low"], b["high"], b["order"])
    Xbase = None
    if ds.baseline is not None:
        Xb, _ = wmod.crop(ds, ds.baseline["start"], ds.baseline["end"])
        Xbase, _ = bmod.bandpass(Xb[:, chi, :], ds.sfreq, b["low"], b["high"], b["order"])
    preset = dict(sel["preset"])
    preset["_class_names"] = ds.class_names
    from .channels import detect_pairs

    pos = ds.positions()
    up = {}
    for k in ("tfr", "tfr_freqs", "tfr_times"):
        if k in ds.extras:
            up[k] = ds.extras[k]
    bank = DataBank(
        Xw=Xf,
        times_w=tw,
        Xfull=ds.X[:, chi, :].astype(np.float64),
        times_full=ds.times,
        sfreq=ds.sfreq,
        ch_names=sel["channels"],
        band=b,
        baseline=ds.baseline,
        Xbase=Xbase,
        preset=preset,
        all_ch_names=ds.ch_names,
        positions=pos,
        pairs=detect_pairs(ds.ch_names, pos),
        upstream=up,
        upstream_ch_idx=chi,
        y=ds.y,
    )
    bank.cache["filter_warnings"] = warns
    while len(BANKS) >= 6:
        BANKS.pop(next(iter(BANKS)))
    BANKS[key] = bank
    return bank, sel


def family_spec(settings: dict, preset: dict) -> tuple[str, bool]:
    """JSON [[family, settings], ...] in the fixed family order. Empty selection -> preset default feature."""
    chosen = settings.get("features") or []
    fs = settings.get("featureSettings") or {}
    if not chosen:
        d = preset["defaultFeature"]
        return json.dumps([[d["family"], {**d.get("settings", {}), **fs.get(d["family"], {})}]], sort_keys=True), True
    return json.dumps([[f, fs.get(f, {})] for f in ordered(chosen)], sort_keys=True), False


def make_classifier(name: str):
    if name == "logreg":
        return LogisticRegression(max_iter=2000)
    if name == "svm":
        return LinearSVC(max_iter=20000, dual="auto")
    return LinearDiscriminantAnalysis()


def make_pipeline(spec: str, bank: DataBank, settings: dict, with_clf: bool = True) -> Pipeline:
    steps = [
        ("features", CompositeFeatures(spec, bank)),
        ("log", LogPolicy(settings.get("transform", "none"))),
        ("scale", make_scaler(settings.get("normalise", "none"))),
        *selection_steps(settings.get("selectionSettings") or {}),
    ]
    if with_clf:
        steps.append(("clf", make_classifier(settings.get("classifier", "lda"))))
    return Pipeline(steps)


def feature_matrix(ds, settings: dict):
    """All-data feature matrix (exploratory display only) with names, units and family per column."""
    bank, sel = build_bank(ds, settings)
    spec, used_default = family_spec(settings, sel["preset"])
    key = settings_hash("F", spec, id(bank))
    hit = bank.cache.get(key)
    if hit is None:
        comp = CompositeFeatures(spec, bank)
        idx = np.arange(bank.n)[:, None]
        try:
            F = comp.fit(idx, ds.y).transform(idx)
        except FeatureError as e:
            raise ValidationError(str(e)) from e
        hit = (F, comp.names_, comp.units_, comp.family_of_)
        bank.cache[key] = hit
    return (*hit, spec, used_default, bank, sel)


def features_response(ds, settings: dict) -> dict:
    bank, sel = build_bank(ds, settings)
    spec, used_default = family_spec(settings, sel["preset"])
    desc = describe(spec, bank)
    # Card counts for every family (so each card's "N features" badge is real even when not chosen).
    fs = settings.get("featureSettings") or {}
    from .features import FAMILY_ORDER

    cards = {}
    for fid in FAMILY_ORDER:
        one = describe(json.dumps([[fid, fs.get(fid, _default_settings(fid, sel["preset"]))]]), bank)["families"][0]
        cards[fid] = one
    shape = None
    errors = [f["error"] for f in desc["families"] if f.get("error")]
    if not errors:
        F, names, *_ = feature_matrix(ds, settings)
        shape = [int(F.shape[0]), int(F.shape[1])]
    return {
        "shape": shape,
        "hash": settings_hash(spec, sel["window"], sel["channels"], sel["band"]),
        "usingDefault": used_default,
        "defaultFeature": sel["preset"]["defaultFeature"]["family"],
        "selected": desc,
        "cards": cards,
        "errors": errors,
        "learnedSelected": sorted(set(json.loads(spec)[i][0] for i in range(len(json.loads(spec)))) & LEARNED),
        "filterWarnings": bank.cache.get("filter_warnings", []),
    }


def _default_settings(fid: str, preset: dict) -> dict:
    d = preset["defaultFeature"]
    return dict(d.get("settings", {})) if d["family"] == fid else {}


def ranking(F: np.ndarray, y: np.ndarray, k: int) -> dict:
    auc = np.array([auc_sep(F[:, j], y, k) for j in range(F.shape[1])]) if F.shape[1] else np.zeros(0)
    fis = fisher_score(F, y) if F.shape[1] else np.zeros(0)
    from sklearn.feature_selection import mutual_info_classif

    mi = mutual_info_classif(F, y, random_state=SEED) if F.shape[1] else np.zeros(0)
    return {"auc": auc.tolist(), "fisher": fis.tolist(), "mi": mi.tolist()}


def _cv(n_counts: list[int], folds: int):
    k, msg = cv_folds(n_counts, folds)
    return StratifiedKFold(n_splits=k, shuffle=True, random_state=SEED), k, msg


def run_cv(ds, settings: dict, spec: str, bank: DataBank) -> dict:
    y = ds.y
    idx = np.arange(len(y))[:, None]
    cv, k, msg = _cv(ds.counts, int(settings.get("cvFolds", 5)))
    # Correct: every learned step inside each training fold.
    pipe = make_pipeline(spec, bank, settings)
    bank.fit_log.clear()
    try:
        correct = cross_val_score(pipe, idx, y, cv=cv, error_score="raise")
    except FeatureError as e:
        raise ValidationError(str(e)) from e
    except ValueError as e:
        raise ValidationError(f"Evaluation failed: {e}") from e
    # Fold isolation check: no fitted stage saw a test-fold trial.
    splits = list(cv.split(idx, y))
    isolation = True
    for _fam, seen in list(bank.fit_log):
        s = set(seen.tolist())
        # Each fitted stage must have seen exactly one fold's training rows and none of its test rows.
        if not any(s == set(tr.tolist()) and not (s & set(te.tolist())) for tr, te in splits):
            isolation = False
    # Leaky (labelled leaky): learned steps fitted on ALL data, then only the classifier is cross-validated.
    prep = make_pipeline(spec, bank, settings, with_clf=False)
    Z = prep.fit_transform(idx, y)
    leaky = cross_val_score(make_classifier(settings.get("classifier", "lda")), Z, y, cv=cv)
    folds = []
    for j, (tr, te) in enumerate(splits):
        folds.append({"fold": j + 1, "train": int(len(tr)), "test": int(len(te)), "accuracy": float(correct[j]), "leaky": float(leaky[j])})
    return {
        "correct": {"mean": float(correct.mean()), "std": float(correct.std()), "perFold": correct.tolist()},
        "leaky": {"mean": float(leaky.mean()), "std": float(leaky.std()), "perFold": leaky.tolist()},
        "folds": k,
        "foldMessage": msg,
        "foldDiagnostics": folds,
        "foldIsolation": isolation,
        "prep": prep,
        "Z": Z,
    }


def evaluate_response(ds, settings: dict, body: dict | None = None) -> dict:
    body = body or {}
    F, names, units, fam_of, spec, used_default, bank, sel = feature_matrix(ds, settings)
    y = ds.y
    K = len(ds.class_names)
    if F.shape[1] == 0:
        raise ValidationError("The feature matrix has no columns.")
    rkey = settings_hash(
        "EV",
        spec,
        sel["window"],
        sel["channels"],
        sel["band"],
        {k: settings.get(k) for k in ("transform", "normalise", "selectionSettings", "classifier", "cvFolds")},
        ds.id,
    )
    cached = RESULTS.get(rkey)
    if cached is None:
        cv = run_cv(ds, settings, spec, bank)
        prep = cv.pop("prep")
        Z = cv.pop("Z")
        # Exploratory final matrix: all-data fit (labelled exploratory only).
        sel_steps = [s for s in prep.steps if s[0] in ("variance", "correlation", "ranking", "projection")]
        cols = np.arange(F.shape[1])
        for _name, st in sel_steps:
            if hasattr(st, "mask_"):
                cols = cols[st.mask_]
        proj = prep.named_steps["projection"]
        if proj.model_ is not None:
            pre = "PC" if proj.method == "pca" else "LD"
            final_names = [f"{pre}{j + 1}" for j in range(Z.shape[1])]
            provenance = [{"name": n, "sources": [names[c] for c in cols]} for n in final_names]
        else:
            final_names = [names[c] for c in cols]
            provenance = [{"name": names[c], "sources": [names[c]]} for c in cols]
        if Z.shape[1] == 0:
            raise ValidationError("Selection produced zero features; relax the selection settings.")
        rank_final = ranking(Z, y, K)
        rank_pre = ranking(F, y, K)
        pca_diag = None
        if proj.model_ is not None and proj.method == "pca":
            evr = proj.model_.explained_variance_ratio_
            pca_diag = {"explainedVarianceRatio": evr.tolist(), "cumulative": np.cumsum(evr).tolist(), "exploratory": True}
        # Correlation of the 60 highest-ranked final features.
        order = np.argsort(-np.array(rank_final["auc"]), kind="stable")[:60]
        with np.errstate(all="ignore"):
            R = np.abs(np.corrcoef(Z[:, order], rowvar=False)) if len(order) > 1 else np.ones((1, 1))
        R = np.nan_to_num(np.atleast_2d(R), nan=0.0)
        # PCA 2-D of the final matrix (display only, all-data fit).
        p2 = PCA(n_components=min(2, Z.shape[1], Z.shape[0]), random_state=SEED).fit_transform(Z)
        if p2.shape[1] == 1:
            p2 = np.c_[p2, np.zeros(len(p2))]
        Fr = ranking(F, y, K)
        cached = {
            "cv": cv,
            "Z": Z,
            "finalNames": final_names,
            "provenance": provenance,
            "rankFinal": rank_final,
            "rankPre": rank_pre,
            "pca": pca_diag,
            "corr": {"order": order.tolist(), "names": [final_names[i] for i in order], "matrix": encode_f32(R)},
            "pca2": p2,
            "rankF": Fr,
        }
        RESULTS[rkey] = cached
        while len(RESULTS) > 24:
            RESULTS.pop(next(iter(RESULTS)))
    Z = cached["Z"]
    cvres = cached["cv"]
    guard = settings.get("leakageGuard", True)
    xf = settings.get("xFeature")
    yf = settings.get("yFeature")
    fn = cached["finalNames"]
    xi = fn.index(xf) if xf in fn else int(np.argsort(-np.array(cached["rankFinal"]["auc"]), kind="stable")[0])
    yi = fn.index(yf) if yf in fn else (int(np.argsort(-np.array(cached["rankFinal"]["auc"]), kind="stable")[min(1, len(fn) - 1)]))
    scatter = scatter_view(Z[:, [xi, yi]], y, K, ds.counts, int(settings.get("cvFolds", 5)))
    tsne = None
    if (settings.get("view") == "tsne") or body.get("tsne"):
        from sklearn.manifold import TSNE

        perp = float(min(30.0, max(2.0, (len(y) - 1) / 3.0)))
        tsne = TSNE(n_components=2, perplexity=perp, random_state=SEED, init="pca").fit_transform(Z)
    # Row strip: mean-across-channels filtered trace per trial (100 points).
    from .dataset import to_points

    strip = to_points(bank.Xw.mean(axis=1), 100)
    learned = sorted(set(f for f, _ in json.loads(spec)) & LEARNED)
    any_learned = bool(learned) or any_selection(settings.get("selectionSettings")) or settings.get("normalise", "none") != "none"
    return {
        "shape": [int(Z.shape[0]), int(Z.shape[1])],
        "preShape": [int(F.shape[0]), int(F.shape[1])],
        "hash": settings_hash(spec, settings.get("selectionSettings"), settings.get("transform"), settings.get("normalise")),
        "accuracy": cvres["correct"] if guard else cvres["leaky"],
        "correct": cvres["correct"],
        "leaky": cvres["leaky"],
        "gapPoints": 100.0 * (cvres["leaky"]["mean"] - cvres["correct"]["mean"]),
        "folds": cvres["folds"],
        "foldMessage": cvres["foldMessage"],
        "foldDiagnostics": cvres["foldDiagnostics"],
        "foldIsolation": cvres["foldIsolation"],
        "chance": chance_level(ds.counts),
        "classCounts": ds.counts,
        "learnedSteps": learned,
        "anyLearned": any_learned,
        "names": fn,
        "preNames": names,
        "units": units,
        "familyOf": fam_of,
        "provenance": cached["provenance"],
        "ranking": cached["rankFinal"],
        "preRanking": cached["rankPre"],
        "pca": cached["pca"],
        "correlation": cached["corr"],
        "matrix": encode_f32(np.round(Z, 4)),
        "preMatrix": encode_f32(np.round(F, 4)),
        "scatter": {"x": fn[xi], "y": fn[yi], **scatter},
        "pca2": encode_f32(cached["pca2"]),
        "tsne": encode_f32(tsne) if tsne is not None else None,
        "rowStrip": encode_f32(strip),
        "exploratoryTag": "exploratory only - all-data fit",
        "classifier": settings.get("classifier", "lda"),
    }


def scatter_view(F2: np.ndarray, y: np.ndarray, K: int, counts: list[int], folds: int) -> dict:
    cv, k, _ = _cv(counts, folds)
    acc = cross_val_score(LinearDiscriminantAnalysis(), F2, y, cv=cv)
    lda = LinearDiscriminantAnalysis().fit(F2, y)
    out = {"values": encode_f32(F2), "accuracy": float(acc.mean()), "std": float(acc.std())}
    lo = F2.min(axis=0)
    hi = F2.max(axis=0)
    pad = (hi - lo) * 0.05 + 1e-9
    lo, hi = lo - pad, hi + pad
    out["extent"] = [float(lo[0]), float(hi[0]), float(lo[1]), float(hi[1])]
    if K == 2:
        w = lda.coef_[0]
        b = float(lda.intercept_[0])
        out["boundary"] = {"w": [float(w[0]), float(w[1])], "b": b}
    else:
        gx = np.linspace(lo[0], hi[0], 40)
        gy = np.linspace(lo[1], hi[1], 40)
        G = np.array([[x, yv] for yv in gy for x in gx])
        out["regions"] = lda.predict(G).reshape(40, 40).tolist()
    return out
