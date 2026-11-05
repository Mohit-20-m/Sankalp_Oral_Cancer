# Training pipeline - lesion triage model

This package trains Sankalp's **refer / no-refer** model for intra-oral photographs and exports everything the
backend needs to run it. It runs end to end on a free Kaggle GPU (2 × T4) with one click (**Run All**), either
through the notebook in [`../notebooks`](../notebooks) or from the command line:

```bash
pip install -r requirements.txt
python -m oralscreen.pipeline --config config.yaml                          # all stages
python -m oralscreen.pipeline --config config.yaml --stage scan,clean,split  # a subset
python -m oralscreen.pipeline --config config.yaml --from-stage final        # resume
```

## Stages

| # | Stage | What it does |
|---|---|---|
| 1 | **scan** | Finds every attached image dataset and maps each folder to `refer`, `no_refer`, `excluded` or `unknown` (keyword + exact-token rules in `config.yaml`). Histopathology, X-ray and dental-only classes are excluded. |
| 2 | **clean** | Drops broken or tiny files and groups duplicates: exact copies (MD5), flipped/rotated copies (dihedral pHash + pixel check) and recoloured/cropped copies (embedding similarity). |
| 3 | **split** | Group-aware, stratified held-out **test** (15 %) and **calibration** sets plus 5-fold CV. Duplicates never cross splits; images from train-only sources stay in training. |
| 4 | **select** | Trains 4 candidates on fold 0 - ConvNeXt-Tiny, EfficientNetV2-S, DINOv2-S (fine-tuned) and DINOv2-S (linear probe) - and keeps the best by validation AUC. |
| 5 | **cv** | 5-fold cross-validation of the winner (mean ± sd). |
| 6 | **final** | Phone-style augmentation, MixUp/CutMix, balanced sampler, EMA weights, warm-up + cosine LR, early stopping; Platt calibration; *screening* (≥ 90 % sensitivity) and *balanced* thresholds chosen on the calibration set. |
| 7 | **evaluate** | Untouched test set: accuracy, balanced accuracy, sensitivity, specificity, AUC, F1 with bootstrap 95 % CIs; per-source results, ROC, confusion matrices, calibration, CAM heat maps. |
| 8 | **export** | ONNX FP32 + INT8 (full model and backbone-only), `head.json`, model contract, model card, out-of-distribution statistics, reference embeddings and a fixed benchmark set. |
| 9 | **verify** | `inference_reference.py` (numpy + onnxruntime only) re-runs every exported form and checks they agree with PyTorch. |
| 10 | **package** | Bundles the artefacts into one zip. |

The selected backbone and its results are documented in [`../models/MODEL_CARD.md`](../models/MODEL_CARD.md).

## Reproducing on Kaggle

1. **Upload the code** - zip this folder and create a private Kaggle Dataset from it named `oralscreen-code`.
2. **Create a notebook** - *File → Import Notebook* →
   [`notebooks/sankalp_training_kaggle.ipynb`](../notebooks/sankalp_training_kaggle.ipynb).
3. **Settings** - Accelerator *GPU T4 × 2*, Internet *on* (pretrained backbones are downloaded from `timm`).
4. **Add the data** (*Add Data* → search):

   | Dataset | Kaggle slug |
   |---|---|
   | Oral Cancer Dataset | `zaidpy/oral-cancer-dataset` |
   | Mouth and Oral Diseases (MOD) | `javedrashid/mouth-and-oral-diseasesmod` |
   | Oral Cancer (Lips and Tongue) images | `shivam17299/oral-cancer-lips-and-tongue-images` |
   | Oral Diseases | `salmansajid05/oral-diseases` |

5. **Optional - Roboflow sets** (≈ 1,100 leukoplakia and aphthous-ulcer images): add a Kaggle secret named
   `ROBOFLOW_API_KEY`. Without it these sources are skipped and the run continues.
6. **Run** - check the scan table after stage 1 (every folder should have a sensible label), then
   *Save Version → Save & Run All*. A full run takes about 2–4 h; `FAST_MODE = True` skips cross-validation.

Configuration lives in [`config.yaml`](config.yaml); every key can be overridden from the notebook.

## Package layout

```
training/
├── config.yaml                 datasets, label rules, training and export settings
├── requirements.txt
└── oralscreen/
    ├── pipeline.py             stages + CLI
    ├── sources.py              dataset discovery, label mapping, Roboflow download
    ├── dedupe.py               validation, MD5 / dihedral pHash / embedding duplicate grouping
    ├── splits.py               group-aware stratified test / calibration / CV splits
    ├── data.py                 augmentation, datasets, balanced sampler, MixUp / CutMix
    ├── models.py               ScreenNet: timm backbone + linear head + CAM, EMA
    ├── engine.py               fine-tuning, linear probe, prediction
    ├── metrics.py              metrics, bootstrap CIs, Platt calibration, thresholds
    ├── plots.py                ROC, confusion, calibration, training-history figures
    ├── export.py               ONNX + INT8 export, parity checks, head.json, model contract
    ├── inference_reference.py  standalone reference inference (the contract every client must match)
    ├── imaging.py              loading + letterbox preprocessing shared with deployment
    └── utils.py
```

## Design notes

- **Honest evaluation.** Duplicates are grouped *before* splitting and augmentation touches training images only;
  results reported on these public datasets without this step are often inflated.
- **Deployable by construction.** Preprocessing (EXIF orientation → letterbox to 224 → ImageNet normalisation) is
  one function shared by training, export and the reference implementation, and is written into the model contract.
- **Cheap to adapt.** The model is exported both as a full network and as backbone + linear head, so the backend can
  retrain only the head on specialist-confirmed cases without a GPU.
- **Limitations.** The open datasets have unclear provenance and licences and labels are taken as provided. They are
  not a substitute for specialist-labelled, prospectively collected data. The model is a screening aid, not a
  diagnostic device.
