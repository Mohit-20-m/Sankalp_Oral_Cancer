"""Mouth-opening measurement (iris ruler) and the server-side photo quality gate."""
import io

import numpy as np
from PIL import Image

from app.domain.clinical import compute_opening, image_quality
from app.domain.decision import DEFAULT_RULE_SET as R
from app.ml.placeholder import synthetic_mouth

MO = R["mouth_opening"]


def test_iris_ruler_median():
    mm, d = compute_opening({"method": "iris", "readings": [{"iris_px": 46, "tap_px": 122},
                                                              {"iris_px": 46, "tap_px": 130},
                                                              {"iris_px": 46, "tap_px": 118}]}, MO)
    assert abs(mm - 11.7 / 46 * 122) < 0.2 and d["status"] == "ok"


def test_auto_detected_reading_recomputed_by_server():
    # real values from the on-device face landmarks (both irises averaged) on a 1200x1600 phone photo
    raw = {"method": "iris", "source": "auto", "readings": [{"iris_px": 66.75, "tap_px": 257.65}],
           "head_pose": {"yaw": -1.8, "pitch": -20.2, "roll": -2.1}}
    mm, d = compute_opening(raw, MO)
    assert mm == 45.2 and d["source"] == "auto"
    assert d["status"] == "pose_warning" and d["head_pose_ok"] is False      # head tilted back 20° > 12°


def test_implausible_readings_rejected():
    mm, d = compute_opening({"method": "iris", "readings": [{"iris_px": 10, "tap_px": 900}]}, MO)
    assert mm is None and d["status"] == "invalid"


def test_head_pose_warning():
    _, d = compute_opening({"method": "manual", "readings": [{"mm": 40}], "head_pose": {"yaw": 30}}, MO)
    assert d["status"] == "pose_warning"


def _jpeg(img: Image.Image) -> bytes:
    b = io.BytesIO()
    img.save(b, "JPEG", quality=92)
    return b.getvalue()


def test_quality_accepts_mouth_photo():
    q = image_quality(_jpeg(synthetic_mouth(np.random.default_rng(1), True, 640, 480)))
    assert q["ok"], q


def test_quality_rejects_dark_and_non_tissue():
    dark = Image.new("RGB", (640, 480), (10, 10, 10))
    q = image_quality(_jpeg(dark))
    assert not q["ok"] and "too_dark" in q["issues"]
    grey = Image.fromarray(np.random.default_rng(2).integers(90, 140, (480, 640, 3), dtype=np.uint8))
    assert "not_mouth_tissue" in image_quality(_jpeg(grey))["issues"]
