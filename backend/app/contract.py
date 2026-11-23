"""Array transport, limits and error helpers (sections 2.2, 3.0, 9)."""

from __future__ import annotations

import base64
import hashlib
from typing import Any

import numpy as np
import orjson

APP_VERSION = "5.1.0"
SEED = 7

LIMITS = {
    "max_trials": 2000,
    "max_channels": 128,
    "max_samples": 10000,
    "max_epoch_s": 20.0,
    "max_classes": 6,
    "min_classes": 2,
    "min_trials_per_class": 2,
}


class ValidationError(Exception):
    """Raised for invalid input. Carries a list of human-readable messages (HTTP 422)."""

    def __init__(self, errors: list[str] | str):
        if isinstance(errors, str):
            errors = [errors]
        super().__init__("; ".join(errors))
        self.errors = errors


def encode_f32(a: Any) -> dict:
    """Encode an array as {dtype: f32, shape, b64} with little-endian float32 bytes."""
    arr = np.asarray(a, dtype="<f4")
    arr = np.ascontiguousarray(arr)
    return {
        "dtype": "f32",
        "shape": list(arr.shape),
        "b64": base64.b64encode(arr.tobytes()).decode("ascii"),
    }


# Name used in the spec.
encodeF32 = encode_f32


def decode_f32(obj: dict) -> np.ndarray:
    if obj.get("dtype") != "f32":
        raise ValueError("expected dtype f32")
    raw = base64.b64decode(obj["b64"])
    return np.frombuffer(raw, dtype="<f4").reshape(obj["shape"]).astype(np.float32)


def settings_hash(*parts: Any) -> str:
    h = hashlib.sha1()
    for p in parts:
        h.update(orjson.dumps(p, option=orjson.OPT_SORT_KEYS | orjson.OPT_SERIALIZE_NUMPY))
    return h.hexdigest()[:16]


def validate_limits(n_trials: int, n_channels: int, n_samples: int, sfreq: float, counts: list[int]) -> None:
    errs: list[str] = []
    if n_trials > LIMITS["max_trials"]:
        errs.append(f"Too many trials: {n_trials} (at most {LIMITS['max_trials']}).")
    if n_channels < 1:
        errs.append("The data has no channels.")
    if n_channels > LIMITS["max_channels"]:
        errs.append(f"Too many channels: {n_channels} (at most {LIMITS['max_channels']}).")
    if n_samples > LIMITS["max_samples"]:
        errs.append(f"Too many samples per epoch: {n_samples} (at most {LIMITS['max_samples']}).")
    if sfreq <= 0:
        errs.append("The sampling rate must be positive.")
    elif n_samples / sfreq > LIMITS["max_epoch_s"]:
        errs.append(f"The epoch is {n_samples / sfreq:.2f} s long (at most {LIMITS['max_epoch_s']:.0f} s).")
    k = len(counts)
    if k < LIMITS["min_classes"]:
        errs.append(f"Found {k} class; at least {LIMITS['min_classes']} classes are needed.")
    if k > LIMITS["max_classes"]:
        errs.append(f"Found {k} classes; at most {LIMITS['max_classes']} classes are supported.")
    small = [i for i, c in enumerate(counts) if c < LIMITS["min_trials_per_class"]]
    if small:
        errs.append(f"{len(small)} class(es) have fewer than {LIMITS['min_trials_per_class']} trials; each class needs at least 2.")
    if errs:
        raise ValidationError(errs)


def natural_key(s: str):
    import re

    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def class_order(labels: list) -> list[str]:
    """Natural (numeric-aware alphabetical) sort, or numeric ascending when all labels are numbers."""
    uniq = sorted({str(x) for x in labels})
    try:
        nums = [float(u) for u in uniq]
        return [u for _, u in sorted(zip(nums, uniq, strict=False))]
    except ValueError:
        return sorted(uniq, key=natural_key)


def cv_folds(counts: list[int], requested: int) -> tuple[int, str | None]:
    """Stratified folds reduced to the smallest class count (minimum 2), with a message."""
    smallest = min(counts)
    k = max(2, min(requested, smallest))
    msg = None
    if k < requested:
        msg = f"Cross-validation folds reduced from {requested} to {k} (smallest class has {smallest} trials)."
    return k, msg


def chance_level(counts: list[int]) -> float:
    return float(max(counts) / sum(counts))
