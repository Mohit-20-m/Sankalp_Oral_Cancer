"""Medicine matching (masking flag) and the model contract shared with the training pipeline."""
import io
import json

import numpy as np

from app.domain.medicines import match_medicine
from app.ml.bundle import ModelBundle
from app.ml.placeholder import generate, synthetic_mouth


def test_masking_medicines_are_flagged():
    m = match_medicine("MUCOPAIN GEL Benzocaine 20% w/w")
    assert m and m["masks_symptoms"]
    assert match_medicine("qwertyuiop") is None


def test_placeholder_contract_and_inference(tmp_path):
    out = generate(tmp_path / "current", n_train=60, n_bench=20)
    c = json.loads((out / "model_contract.json").read_text())
    assert c["placeholder"] is True and "backbone_fp32" in c["files"]
    (tmp_path / "heads").mkdir()
    b = ModelBundle(tmp_path)
    rng = np.random.default_rng(0)
    imgs = []
    for refer in (True, False):
        buf = io.BytesIO()
        synthetic_mouth(rng, refer).save(buf, "JPEG")
        imgs.append(buf.getvalue())
    res = b.run(np.stack([b.preprocess(x) for x in imgs]))
    prob = np.asarray(res["prob"])
    assert prob.shape == (2,) and prob[0] > prob[1]           # white patch scores above red spot
    assert np.asarray(res["embedding"]).shape[0] == 2
