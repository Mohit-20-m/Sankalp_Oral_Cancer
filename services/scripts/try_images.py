"""Run the live AI model on your own photos.

  docker compose cp ~/Desktop/test_images worker:/tmp/test_images
  docker compose exec worker python scripts/try_images.py /tmp/test_images
  docker compose cp worker:/tmp/test_results ~/Desktop/test_results

Folder layout (labels are optional):
  test_images/refer/*.jpg       (suspicious / pre-cancer / cancer)
  test_images/no_refer/*.jpg    (normal / benign)
  test_images/*.jpg             (unknown — just shows the AI's opinion)
Writes test_results/results.csv and a heat-map image per photo.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import httpx

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0])
from app.config import get_settings  # noqa: E402
from app.services.pipeline import render_heatmap  # noqa: E402

REFER = {"refer", "cancer", "oscc", "opmd", "leukoplakia", "osmf", "suspicious", "positive", "malignant", "lesion"}
NO_REFER = {"no_refer", "normal", "healthy", "benign", "negative", "non_cancer", "noncancer", "non-cancer"}
EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def label_of(p: Path, root: Path) -> str | None:
    for part in p.relative_to(root).parts[:-1]:
        k = part.lower().replace(" ", "_")
        if k in NO_REFER:
            return "no_refer"
        if k in REFER:
            return "refer"
    return None


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/test_images")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/test_results")
    (out / "heatmaps").mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in root.rglob("*") if p.suffix.lower() in EXT)
    if not files:
        print(f"no images found in {root}")
        return 1
    url = f"{get_settings().inference_url}/v1/predict"
    rows, thr, version = [], None, None
    for i in range(0, len(files), 8):
        batch = files[i:i + 8]
        blobs = [p.read_bytes() for p in batch]
        r = httpx.post(url, files=[("files", (p.name, b, "image/jpeg")) for p, b in zip(batch, blobs)],
                       data={"ids": ",".join(str(j) for j in range(len(batch)))}, timeout=120)
        r.raise_for_status()
        js = r.json()
        thr, version = js["thresholds"]["screening"], js["model_version"]
        for p, b, res in zip(batch, blobs, js["results"]):
            if "error" in res:
                rows.append({"file": str(p.relative_to(root)), "truth": label_of(p, root), "prob": "",
                             "ai_says": "ERROR", "correct": "", "note": res["error"]})
                continue
            prob = res["prob"]
            ai = "refer" if prob >= thr else "no_refer"
            truth = label_of(p, root)
            try:
                png, area = render_heatmap(b, res["cam"], res["letterbox"], res["input_size"])
                (out / "heatmaps" / (p.stem + "_heat.png")).write_bytes(png)
            except Exception:  # noqa: BLE001
                pass
            rows.append({"file": str(p.relative_to(root)), "truth": truth or "?", "prob": round(prob, 3),
                         "ai_says": ai, "correct": "" if truth is None else ("yes" if truth == ai else "NO"),
                         "note": "unusual photo (out of distribution)" if res.get("out_of_distribution") else ""})
    with open(out / "results.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    print(f"\nmodel {version} · refer if p ≥ {thr:.2f}\n")
    print(f"{'file':45s} {'truth':9s} {'p(refer)':>8s}  {'AI says':9s} ok?  note")
    for r in rows:
        print(f"{r['file'][:45]:45s} {r['truth']:9s} {str(r['prob']):>8s}  {r['ai_says']:9s} {r['correct']:4s} {r['note']}")
    lab = [r for r in rows if r["truth"] in ("refer", "no_refer") and r["ai_says"] != "ERROR"]
    if lab:
        tp = sum(r["truth"] == "refer" and r["ai_says"] == "refer" for r in lab)
        fn = sum(r["truth"] == "refer" and r["ai_says"] == "no_refer" for r in lab)
        tn = sum(r["truth"] == "no_refer" and r["ai_says"] == "no_refer" for r in lab)
        fp = sum(r["truth"] == "no_refer" and r["ai_says"] == "refer" for r in lab)
        print(f"\nlabelled photos: {len(lab)}  ·  accuracy {(tp + tn) / len(lab):.1%}")
        if tp + fn:
            print(f"sensitivity (suspicious caught): {tp}/{tp + fn} = {tp / (tp + fn):.1%}")
        if tn + fp:
            print(f"specificity (normal cleared):   {tn}/{tn + fp} = {tn / (tn + fp):.1%}")
    print(f"\nresults: {out}/results.csv · heat maps: {out}/heatmaps/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
