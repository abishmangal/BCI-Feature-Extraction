"""Feature families (section 6A.5 checks)."""

import json

import numpy as np
import pytest
from conftest import default_settings

from app import evaluate as ev
from app.features import FAMILY_ORDER, DataBank, FeatureError
from app.features.asymmetry import Asymmetry
from app.features.autoencoder import TinyAE, decimate_to
from app.features.composite import CompositeFeatures, describe
from app.features.spectral import Spectral, spectral_entropy
from app.features.tf_regions import TFRegions
from app.features.time_stats import compute_stats, higuchi_fd
from app.features.window_means import WindowMeans


def bank_from(
    X, sfreq=100.0, tmin=0.0, ch=None, baseline=None, Xbase=None, band=None, preset=None, y=None, pairs=None, full=None, tfull=None
):
    n, c, s = X.shape
    ch = ch or [f"C{i}" for i in range(c)]
    return DataBank(
        Xw=X,
        times_w=tmin + np.arange(s) / sfreq,
        Xfull=full if full is not None else X,
        times_full=tfull if tfull is not None else tmin + np.arange(s) / sfreq,
        sfreq=sfreq,
        ch_names=ch,
        band=band or {"low": 1.0, "high": 40.0, "order": 4},
        baseline=baseline,
        Xbase=Xbase,
        preset=preset
        or {
            "id": "custom",
            "keyBands": [],
            "defaultFeature": {"family": "band_power", "settings": {}},
            "zone": None,
            "waveletRange": [4, 30],
        },
        pairs=pairs or [],
        y=y if y is not None else np.zeros(n, dtype=int),
    )


def test_time_stats_reference_values():
    x = np.array([[[1.0, 2.0, 3.0, 4.0, 10.0]]])
    stats = ["mean", "variance", "std", "rms", "ptp", "skewness", "kurtosis", "line_length"]
    v = compute_stats(x, stats, 8)[0, 0]
    assert v[0] == pytest.approx(4.0)
    assert v[1] == pytest.approx(np.var([1, 2, 3, 4, 10]))  # ddof = 0
    assert v[2] == pytest.approx(np.std([1, 2, 3, 4, 10]))
    assert v[3] == pytest.approx(np.sqrt(np.mean(np.square([1, 2, 3, 4, 10]))))
    assert v[4] == pytest.approx(9.0)
    assert v[7] == pytest.approx(1 + 1 + 1 + 6)  # not divided by the sample count
    from scipy.stats import kurtosis, skew

    assert v[5] == pytest.approx(skew([1, 2, 3, 4, 10]))
    assert v[6] == pytest.approx(kurtosis([1, 2, 3, 4, 10], fisher=True))
    c = compute_stats(np.ones((1, 1, 20)), ["skewness", "kurtosis", "higuchi"], 8)[0, 0]
    assert list(c) == [0.0, 0.0, 1.0]  # documented constant-signal values
    with pytest.raises(FeatureError):
        compute_stats(np.ones((1, 1, 2)), ["mean"], 8)


def test_higuchi_stability():
    rng = np.random.default_rng(0)
    white = rng.standard_normal((1, 1000))
    t = np.linspace(0, 1, 1000)
    smooth = np.sin(2 * np.pi * 2 * t)[None]
    fw = higuchi_fd(white, 8)[0]
    fs = higuchi_fd(smooth, 8)[0]
    assert 1.85 < fw < 2.1  # white noise ~ 2
    assert 0.95 < fs < 1.1  # smooth curve ~ 1
    assert higuchi_fd(white, 8)[0] == fw  # deterministic
    assert abs(higuchi_fd(white * 5, 8)[0] - fw) < 1e-9  # amplitude invariant


def test_window_means_bins_dropped_and_baseline():
    sf = 100.0
    X = np.tile(np.arange(23, dtype=float), (2, 1, 1))  # 23 samples, 5-sample bins -> 4 bins, 3 dropped
    base = np.full((2, 1, 10), 2.0)
    b = bank_from(X, sf, tmin=0.1, baseline={"start": -0.1, "end": 0}, Xbase=base)
    wm = WindowMeans({"binMs": 50, "baseline": True}, b)
    assert wm.n_bins() == 4 and wm.dropped() == 3
    assert wm.names()[0] == "C0 100 ms mean" and wm.names()[1] == "C0 150 ms mean"
    F = wm.compute(X, np.arange(2))
    assert np.allclose(F[0], [2 - 2, 7 - 2, 12 - 2, 17 - 2])
    wm2 = WindowMeans({"binMs": 50, "baseline": False}, b)
    assert np.allclose(wm2.compute(X, np.arange(2))[0], [2, 7, 12, 17])
    with pytest.raises(FeatureError):
        WindowMeans({"binMs": 200}, b).check()


def test_welch_band_integration_and_relative_power():
    sf = 250.0
    t = np.arange(500) / sf
    x = (np.sin(2 * np.pi * 10 * t) * 2)[None, None]
    b = bank_from(x, sf)
    sp = Spectral({"items": ["abs_power", "rel_power", "peak_freq", "centroid"], "bands": [{"name": "alpha", "low": 8, "high": 13}]}, b)
    v = sp.compute(x, np.arange(1))[0]
    assert v[0] == pytest.approx(2.0, rel=0.05)  # power of a sine of amplitude A is A^2/2
    assert 0.95 < v[1] <= 1.0
    assert v[2] == pytest.approx(10.0, abs=0.5)
    assert v[3] == pytest.approx(10.0, abs=1.0)
    m = sp.meta()
    assert m["welch"] == {"nperseg": 250, "noverlap": 125, "nfft": 500}


def test_spectral_entropy_edge_cases():
    assert spectral_entropy(np.ones(16)) == pytest.approx(1.0)
    one = np.zeros(16)
    one[3] = 5
    assert spectral_entropy(one) == 0.0


def test_percent_change_sign_and_baseline():
    sf = 250.0
    t = np.arange(-0.5, 1.5, 1 / sf)
    rng = np.random.default_rng(0)
    amp = np.where(t < 0, 2.0, 1.0)  # power decrease after 0
    x = (amp * np.sin(2 * np.pi * 10 * t) + 0.01 * rng.standard_normal(len(t)))[None, None]
    w = (t >= 0) & (t < 1.0)
    b = bank_from(
        x[..., w],
        sf,
        tmin=0.0,
        baseline={"start": -0.5, "end": 0.0},
        band={"low": 4, "high": 30, "order": 4},
        full=x,
        tfull=t,
        preset={
            "id": "custom",
            "keyBands": [{"name": "alpha", "low": 8, "high": 12}],
            "zone": {"start": 0.2, "end": 1.0},
            "defaultFeature": {"family": "x"},
            "waveletRange": [4, 30],
        },
    )
    tf = TFRegions({}, b)
    tf.check()
    assert tf.outputs() == ["mean_power", "pct_change"]
    v = tf.compute(x, np.arange(1))[0]
    assert v[1] < -50  # ERD-like decrease is negative
    b2 = bank_from(x[..., w], sf, full=x, tfull=t)
    tf2 = TFRegions({"outputs": ["pct_change"]}, b2)
    with pytest.raises(FeatureError, match="baseline"):
        tf2.check()


def test_time_frequency_card_preview_does_not_cache_full_dataset():
    X = np.random.default_rng(7).normal(size=(20, 6, 100))
    bank = bank_from(X)
    family = TFRegions({}, bank)
    preview = family.preview()
    assert preview["kind"] == "tfrect"
    assert len(preview["map"]) == len(preview["freqs"])
    assert not bank.cache

    coefficients, *_ = family.tfr()
    assert coefficients.shape[:2] == (20, 6)
    assert bank.cache


def test_asymmetry_pairs_and_sign():
    from app.channels import detect_pairs
    from app.montage import positions_for

    names = ["C3", "C4", "Cz", "F3", "F4", "PO7", "PO8", "T7"]
    pairs = detect_pairs(names, positions_for(names))
    assert {"left": "C3", "right": "C4"} in pairs and {"left": "PO7", "right": "PO8"} in pairs and len(pairs) == 3
    sf = 250.0
    t = np.arange(500) / sf
    x = np.stack([3 * np.sin(2 * np.pi * 10 * t), np.sin(2 * np.pi * 10 * t)])[None]
    b = bank_from(x, sf, ch=["C3", "C4"], pairs=[{"left": "C3", "right": "C4"}])
    a = Asymmetry({"bands": [{"low": 8, "high": 12}], "representations": ["difference", "normalized"]}, b)
    v = a.compute(x, np.arange(1))[0]
    assert v[0] > 0 and 0.7 < v[1] < 0.9  # (9 - 1) / (9 + 1) = 0.8
    with pytest.raises(FeatureError, match="excluded"):
        Asymmetry({"pairs": [{"left": "C3", "right": "C9"}]}, b).check()
    with pytest.raises(FeatureError, match="No left/right"):
        Asymmetry({}, bank_from(x, sf, ch=["C3", "C4"])).check()


def test_autoencoder_loss_falls_and_fold_isolation(samples):
    for pid, ds in samples.items():
        bank, _ = ev.build_bank(ds, default_settings(ds))
        D = decimate_to(bank.Xw).reshape(bank.n, -1)
        assert D.shape[1] <= 125 * bank.Xw.shape[1]
        ae = TinyAE().fit(D, ds.y)
        assert ae.loss_drop() >= 0.20, (pid, ae.loss_drop())
    ds = samples["motor_imagery"]
    s = default_settings(ds, channels=["C3", "Cz", "C4"], features=["autoencoder"])
    r = ev.evaluate_response(ds, s)
    assert r["foldIsolation"] is True


def test_four_class_csp_count(samples):
    ds = samples["ssvep"]
    s = default_settings(ds, features=["csp"], featureSettings={"csp": {"n_components": 4}})
    F, names, *_ = ev.feature_matrix(ds, s)
    assert F.shape == (160, 4 * 4)
    assert names[0].startswith("CSP 8 Hz vs rest")


def test_every_family_runs_with_units(samples):
    ds = samples["motor_imagery"]
    s = default_settings(
        ds,
        channels=["C3", "Cz", "C4", "C1", "C2"],
        features=list(FAMILY_ORDER),
        featureSettings={"asymmetry": {"pairs": [{"left": "C3", "right": "C4"}]}},
    )
    out = ev.features_response(ds, s)
    assert not out["errors"], out["errors"]
    for fam in out["selected"]["families"]:
        assert fam["count"] > 0 and len(fam["units"]) == len(fam["names"]), fam["id"]
        assert fam["formula"] and fam["interval"]
    assert out["shape"][1] == out["selected"]["total"]
    # complexity shares names with time_stats: never double-counted
    s2 = default_settings(
        ds, channels=["C3"], features=["time_stats", "complexity"], featureSettings={"time_stats": {"stats": ["line_length", "mean"]}}
    )
    d2 = ev.features_response(ds, s2)["selected"]
    assert d2["total"] == 3  # mean, line_length (shared) and higuchi


def test_composite_deterministic_order_and_dedup(samples):
    ds = samples["erp_p300"]
    bank, _ = ev.build_bank(ds, default_settings(ds))
    spec = json.dumps([["band_power", {"bands": ["alpha"]}], ["hjorth", {}]])
    c = CompositeFeatures(spec, bank).fit(np.arange(bank.n)[:, None], ds.y)
    assert c.names_[0] == "Fz alpha power" and c.names_[8] == "Fz activity"
    d = describe(spec, bank)
    assert d["total"] == 8 + 24
