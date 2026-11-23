"""Evaluation contract: accuracy targets, leakage, selection, projection, fold isolation, exports."""

import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np
import pytest
from conftest import default_settings

from app import evaluate as ev
from app import export as ex
from app import window as wmod
from app.contract import ValidationError, decode_f32
from app.selection import CorrelationStep, ProjectStep, RankStep, VarianceStep, fisher_score

ROOT = Path(__file__).resolve().parents[2]


def mi_default(ds, **o):
    base = dict(window={"start": 0.0, "end": 2.0}, channels=["C3", "Cz", "C4"], band={"low": 8, "high": 30, "order": 4}, features=["csp"])
    return default_settings(ds, **{**base, **o})


def p300_default(ds, **o):
    base = dict(features=["window_means"], featureSettings={"window_means": {"binMs": 50, "baseline": True}})
    return default_settings(ds, **{**base, **o})


def ssvep_default(ds, **o):
    return default_settings(ds, **{**dict(channels=["O1", "Oz", "O2"], features=[]), **o})


def test_default_pipeline_targets(samples):
    mi = ev.evaluate_response(samples["motor_imagery"], mi_default(samples["motor_imagery"]))["correct"]["mean"]
    p3 = ev.evaluate_response(samples["erp_p300"], p300_default(samples["erp_p300"]))["correct"]["mean"]
    ss = ev.evaluate_response(samples["ssvep"], ssvep_default(samples["ssvep"]))["correct"]["mean"]
    assert 0.70 <= mi <= 0.90, mi
    assert 0.70 <= p3 <= 0.90, p3
    assert 0.75 <= ss <= 0.97, ss


def test_csp_fitted_on_training_folds_only(samples):
    ds = samples["motor_imagery"]
    s = mi_default(ds)
    bank, _ = ev.build_bank(ds, s)
    spec, _ = ev.family_spec(s, ds.preset())
    res = ev.run_cv(ds, s, spec, bank)
    assert res["foldIsolation"] is True
    cv, _, _ = ev._cv(ds.counts, 5)
    splits = list(cv.split(np.zeros(len(ds.y)), ds.y))
    log = [seen for fam, seen in bank.fit_log if fam == "csp"]
    # 5 cross-validation fits, then the deliberately leaky all-data fit (labelled leaky) as the 6th.
    assert len(log) == 6 and len(log[5]) == len(ds.y)
    log = log[:5]
    for seen, (tr, te) in zip(log, splits, strict=False):
        assert set(seen) == set(tr) and not set(seen) & set(te)


def test_no_fitted_stage_sees_test_samples(samples):
    ds = samples["motor_imagery"]
    s = mi_default(
        ds,
        features=["csp", "covariance", "autoencoder"],
        normalise="zscore",
        selectionSettings={
            "variance": {"on": True, "threshold": 0},
            "ranking": {"on": True, "method": "mi", "topK": 4},
            "projection": {"method": "pca", "components": 2},
        },
    )
    r = ev.evaluate_response(ds, s)
    assert r["foldIsolation"] is True
    assert r["shape"] == [100, 2]


def test_leakage_toggle_changes_accuracy_and_mi_csp_is_leaky_higher(samples):
    ds = samples["motor_imagery"]
    s = mi_default(ds)
    a = ev.evaluate_response(ds, s)
    b = ev.evaluate_response(ds, {**s, "leakageGuard": False})
    assert a["accuracy"] == a["correct"] and b["accuracy"] == b["leaky"]
    assert b["leaky"]["mean"] > a["correct"]["mean"]
    assert a["gapPoints"] == pytest.approx(100 * (a["leaky"]["mean"] - a["correct"]["mean"]))


def test_window_inside_baseline_collapses_separability(samples):
    ds = samples["motor_imagery"]
    s = default_settings(ds, window={"start": -0.5, "end": 0.0})
    r = wmod.window_response(ds, s, {"probe": ds.preset()["probe"]})
    good = wmod.window_response(ds, default_settings(ds, window={"start": 0.5, "end": 2.5}), {"probe": ds.preset()["probe"]})
    assert r["separability"]["accuracy"] < 0.62
    assert good["separability"]["accuracy"] > r["separability"]["accuracy"] + 0.1
    assert r["shape"] == [100, 22, 125]


def test_window_compares_only_selected_classes(samples):
    ds = samples["ssvep"]
    settings = default_settings(ds)
    full = wmod.window_response(ds, settings, {})
    selected = wmod.window_response(ds, {**settings, "probeClasses": [0, 2]}, {})

    assert selected["probeClasses"] == [0, 2]
    assert full["separability"]["chance"] == pytest.approx(0.25)
    assert selected["separability"]["chance"] == pytest.approx(0.5)
    for axis in ("x", "y"):
        np.testing.assert_array_equal(
            decode_f32(full["probe"][axis]), decode_f32(selected["probe"][axis])
        )
    with pytest.raises(ValidationError, match="at least two"):
        wmod.window_response(ds, {**settings, "probeClasses": [2]}, {})


def test_selection_dimensions_and_tie_breaking():
    X = np.c_[np.arange(10.0), np.arange(10.0), np.ones(10), np.arange(10.0) ** 2]
    y = np.array([0] * 5 + [1] * 5)
    assert VarianceStep(True, 0.0).fit(X).mask_.tolist() == [True, True, False, True]
    # col1 duplicates col0 (r = 1) and col3 = col0^2 (r = 0.96): both dropped, keep-first; constant col2 kept.
    assert CorrelationStep(True, 0.95).fit(X).mask_.tolist() == [True, False, True, False]
    r = RankStep(True, "fisher", 1).fit(X, y)
    assert r.mask_.tolist() == [True, False, False, False]  # equal scores: keep the first column
    assert fisher_score(X, y)[0] == pytest.approx(fisher_score(X, y)[1])


def test_pca_variance_ratios_and_lda_projection_dims():
    rng = np.random.default_rng(0)
    X = rng.standard_normal((60, 6)) @ np.diag([5, 3, 1, 0.5, 0.2, 0.1])
    p = ProjectStep("pca", 3).fit(X)
    evr = p.model_.explained_variance_ratio_
    assert len(evr) == 3 and np.all(np.diff(evr) <= 0) and evr.sum() < 1
    y2 = np.array([0, 1] * 30)
    y4 = np.array([0, 1, 2, 3] * 15)
    assert ProjectStep("lda", 5).fit(X, y2).transform(X).shape == (60, 1)
    assert ProjectStep("lda", 5).fit(X, y4).transform(X).shape == (60, 3)


def test_four_class_lda_projection_and_decision_regions(samples):
    ds = samples["ssvep"]
    s = ssvep_default(ds, selectionSettings={"projection": {"method": "lda", "components": 3}})
    r = ev.evaluate_response(ds, s)
    assert r["shape"] == [160, 3] and r["names"] == ["LD1", "LD2", "LD3"]
    assert len(r["scatter"]["regions"]) == 40 and len(r["ranking"]["auc"]) == 3


def test_zero_features_blocked(samples):
    ds = samples["erp_p300"]
    s = p300_default(ds, selectionSettings={"variance": {"on": True, "threshold": 1e12}})
    from app.contract import ValidationError

    with pytest.raises(ValidationError):
        ev.evaluate_response(ds, s)


def _decode(obj):
    from app.contract import decode_f32

    return decode_f32(obj)


def test_csv_npz_roundtrip_both_modes(samples):
    ds = samples["erp_p300"]
    s = p300_default(ds, normalise="zscore", selectionSettings={"ranking": {"on": True, "method": "fisher", "topK": 10}})
    for mode in ("exploratory", "oof"):
        r = ex.export_response(ds, s, mode)
        csv_b, name, _ = ex.download(r["token"], "csv")
        npz_b, _, _ = ex.download(r["token"], "npz")
        z = np.load(io.BytesIO(npz_b))
        if mode == "exploratory":
            import pandas as pd

            df = pd.read_csv(io.BytesIO(csv_b))
            assert list(df.columns[:2]) == ["trial_id", "label"] and df.shape == (200, 12)
            assert np.allclose(df.iloc[:, 2:].values, z["X_features"], atol=1e-4)
            assert list(z["feature_names"]) == list(df.columns[2:])
            assert set(df["label"]) == set(ds.class_names)
        else:
            zf = zipfile.ZipFile(io.BytesIO(csv_b))
            assert "schemas.json" in zf.namelist() and "fold1.csv" in zf.namelist()
            sch = json.loads(zf.read("schemas.json"))
            assert len(sch["folds"]) == 5
            total = sum(len(z[f"fold{k}_y_val"]) for k in range(1, 6))
            assert total == 200
            assert z["fold1_X_val"].shape[1] == len(z["fold1_feature_names"]) == 10


EXPORT_CASES = [
    ("motor_imagery", "example_motor_imagery.csv", lambda ds: mi_default(ds)),
    (
        "motor_imagery",
        "example_motor_imagery.csv",
        lambda ds: mi_default(ds, features=["band_power", "hjorth"], transform="log", normalise="zscore"),
    ),
    ("erp_p300", "example_erp.csv", lambda ds: p300_default(ds)),
    (
        "erp_p300",
        "example_erp.csv",
        lambda ds: p300_default(
            ds,
            features=["time_stats", "covariance"],
            normalise="zscore",
            selectionSettings={"ranking": {"on": True, "method": "fisher", "topK": 12}},
        ),
    ),
    ("ssvep", "example_ssvep.csv", lambda ds: ssvep_default(ds)),
    (
        "ssvep",
        "example_ssvep.csv",
        lambda ds: ssvep_default(
            ds,
            features=["spectral_features", "wavelet"],
            normalise="zscore",
            selectionSettings={"projection": {"method": "pca", "components": 6}},
        ),
    ),
]


@pytest.mark.parametrize("pid,csv,mk", EXPORT_CASES)
def test_exported_script_runs_and_reproduces(samples, tmp_path, pid, csv, mk):
    ds = samples[pid]
    s = mk(ds)
    r = ex.export_response(ds, s, "exploratory")
    script = tmp_path / "pipeline.py"
    script.write_text(r["script"], encoding="utf-8")
    src = ROOT / "sample" / csv
    assert src.exists(), "run scripts/make_fallback.py first"
    (tmp_path / csv).write_bytes(src.read_bytes())
    p = subprocess.run([sys.executable, str(script)], cwd=tmp_path, capture_output=True, text=True, timeout=600)
    assert p.returncode == 0, p.stderr[-3000:]
    line = [ln for ln in p.stdout.splitlines() if ln.startswith("accuracy:")][0]
    acc = float(line.split()[1])
    assert abs(acc - r["accuracy"]) <= 0.05, (acc, r["accuracy"])
    assert "pip install" in r["script"].splitlines()[2]
    assert ("pyriemann" in r["script"].splitlines()[2]) == ("covariance" in json.dumps(s.get("features")))
