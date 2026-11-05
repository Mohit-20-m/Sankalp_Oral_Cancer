"""Recognise medicines from OCR text and flag ones that can MASK oral symptoms.

Starter list of common products used for mouth pain/sores in India. It must be reviewed and extended
by a pharmacist before real use; matching is fuzzy so OCR errors are tolerated.
The system RECORDS medicines — it never recommends or judges a prescription.
"""
from __future__ import annotations

import re

from rapidfuzz import fuzz, process

# name -> (generic, category, masks_symptoms)
MEDICINES: dict[str, tuple[str, str, bool]] = {
    # topical anaesthetics / analgesic gels — numb pain, can hide a worsening lesion
    "lignocaine": ("lignocaine (lidocaine) gel", "topical_anaesthetic", True),
    "lidocaine": ("lignocaine (lidocaine) gel", "topical_anaesthetic", True),
    "xylocaine": ("lignocaine (lidocaine) gel", "topical_anaesthetic", True),
    "benzocaine": ("benzocaine gel", "topical_anaesthetic", True),
    "mucopain": ("benzocaine gel", "topical_anaesthetic", True),
    "orajel": ("benzocaine gel", "topical_anaesthetic", True),
    "choline salicylate": ("choline salicylate gel", "topical_analgesic", True),
    "dologel": ("choline salicylate + lignocaine gel", "topical_analgesic", True),
    "zytee": ("choline salicylate gel", "topical_analgesic", True),
    "bonjela": ("choline salicylate gel", "topical_analgesic", True),
    # corticosteroids — reduce inflammation/ulcer pain, can mask
    "triamcinolone": ("triamcinolone acetonide oral paste", "topical_steroid", True),
    "kenacort": ("triamcinolone acetonide oral paste", "topical_steroid", True),
    "betamethasone": ("betamethasone", "steroid", True),
    "dexamethasone": ("dexamethasone", "steroid", True),
    "prednisolone": ("prednisolone", "steroid", True),
    # systemic painkillers — mask pain
    "paracetamol": ("paracetamol", "analgesic", True),
    "ibuprofen": ("ibuprofen", "analgesic", True),
    "diclofenac": ("diclofenac", "analgesic", True),
    # do not mask symptoms
    "clotrimazole": ("clotrimazole mouth paint", "antifungal", False),
    "candid": ("clotrimazole mouth paint", "antifungal", False),
    "nystatin": ("nystatin", "antifungal", False),
    "fluconazole": ("fluconazole", "antifungal", False),
    "chlorhexidine": ("chlorhexidine mouthwash", "antiseptic", False),
    "hexidine": ("chlorhexidine mouthwash", "antiseptic", False),
    "povidone": ("povidone-iodine gargle", "antiseptic", False),
    "betadine": ("povidone-iodine gargle", "antiseptic", False),
    "b complex": ("vitamin B complex", "vitamin", False),
    "becosules": ("vitamin B complex", "vitamin", False),
    "multivitamin": ("multivitamin", "vitamin", False),
}


def match_medicine(text: str, min_score: int = 80) -> dict | None:
    clean = re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower())
    clean = re.sub(r"\s+", " ", clean).strip()
    if not clean:
        return None
    best = None
    for name in MEDICINES:
        if name in clean:
            score = 100.0
        else:
            score = max(fuzz.partial_ratio(name, clean), max((fuzz.ratio(name, tok) for tok in clean.split()),
                                                              default=0))
        if score >= min_score and (best is None or score > best[1] or (score == best[1] and len(name) > len(best[0]))):
            best = (name, score)
    if not best:
        return None
    generic, category, masks = MEDICINES[best[0]]
    return {"matched_term": best[0], "name": generic, "category": category, "masks_symptoms": masks,
            "score": round(best[1], 1)}


_ocr = None


def ocr_image(data: bytes) -> str:
    """RapidOCR = PaddleOCR detection/recognition models running on ONNX Runtime (no PaddlePaddle)."""
    global _ocr
    import io

    import numpy as np
    from PIL import Image, ImageOps

    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR

        _ocr = RapidOCR()
    img = np.asarray(ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB"))
    result, _ = _ocr(img)
    return " ".join(r[1] for r in (result or []))


def suggestions(prefix: str, limit: int = 8) -> list[str]:
    return [m[0] for m in process.extract(prefix.lower(), list(MEDICINES), scorer=fuzz.WRatio, limit=limit)]
