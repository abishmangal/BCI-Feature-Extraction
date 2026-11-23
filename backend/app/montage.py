"""Electrode positions (Page 3). Public MNE API only; 2-D projection computed here."""

from __future__ import annotations

import warnings
from functools import lru_cache

import mne
import numpy as np

SPEC_DEFAULT = "standard_1005"


def builtin_montages() -> list[str]:
    """MNE's public list of built-in montages. MNE 1.13 no longer lists "standard_1005" (a deprecated alias
    of colin27_1005) but still accepts it; it is the spec default, so it is kept first when accepted."""
    names = list(mne.channels.get_builtin_montages())
    if SPEC_DEFAULT not in names:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", FutureWarning)
                mne.channels.make_standard_montage(SPEC_DEFAULT)
            names.insert(0, SPEC_DEFAULT)
        except ValueError:
            pass
    return names


def _fit_sphere(points: np.ndarray) -> np.ndarray:
    """Least-squares sphere centre: |p - c|^2 = r^2  ->  2 p.c + (r^2 - |c|^2) = |p|^2."""
    A = np.c_[2 * points, np.ones(len(points))]
    b = (points**2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    return sol[:3]


@lru_cache(maxsize=16)
def _montage_positions(name: str) -> tuple[dict, np.ndarray]:
    with warnings.catch_warnings():
        # MNE 1.13 marks the name "standard_1005" as deprecated (alias of colin27_1005); it is the spec default.
        warnings.simplefilter("ignore", FutureWarning)
        mont = mne.channels.make_standard_montage(name)
    pos = mont.get_positions()["ch_pos"]
    pts = np.array([v for v in pos.values() if v is not None and np.all(np.isfinite(v))])
    centre = _fit_sphere(pts) if len(pts) >= 4 else np.zeros(3)
    return dict(pos), centre


def project(v: np.ndarray) -> tuple[float, float]:
    """Azimuthal-equidistant projection; head circle radius 1, nose +y, left hemisphere on the left."""
    n = float(np.linalg.norm(v))
    if n == 0:
        return 0.0, 0.0
    r = float(np.arccos(np.clip(v[2] / n, -1.0, 1.0)) / (np.pi / 2))
    phi = float(np.arctan2(v[1], v[0]))
    return r * np.cos(phi), r * np.sin(phi)


def positions_for(channels: list[str], montage: str = "standard_1005") -> list[list[float] | None]:
    """2-D positions per channel (by case-insensitive name), or None when the montage lacks the name."""
    pos, centre = _montage_positions(montage)
    lower = {k.lower(): k for k in pos}
    out: list[list[float] | None] = []
    for ch in channels:
        key = lower.get(ch.strip().lower())
        if key is None:
            out.append(None)
            continue
        v = np.asarray(pos[key], dtype=float) - centre
        x, y = project(v)
        out.append([round(x, 5), round(y, 5)])
    return out
