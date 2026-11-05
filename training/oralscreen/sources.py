"""Discover images from every attached dataset and map them to refer / no_refer.

Works without knowing each dataset's folder layout in advance: labels come
from the folder path using the ordered rules in config.yaml. Everything that
cannot be mapped confidently is reported, never guessed.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pandas as pd

from .utils import LOG

LABEL_REFER = "refer"
LABEL_NO_REFER = "no_refer"
LABEL_EXCLUDED = "excluded"
LABEL_UNKNOWN = "unknown"

# Folder names that hold data but never name a class.
CONTAINER_WORDS = ["dataset", "datasets", "data", "images", "image", "imgs", "train", "training",
                   "test", "testing", "val", "valid", "validation", "original", "augmented", "all"]


def _norm(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[_\-\.&]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _contains(haystack: str, needle: str) -> bool:
    """Whole-word(ish) containment so 'oc' does not match 'doctor'."""
    needle = _norm(needle)
    return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", haystack) is not None


def _is_container(comp: str) -> bool:
    """'oral cancer dataset' or 'train' are containers; 'cancer images' is a class folder."""
    words = comp.split()
    if any(w in ("dataset", "datasets") for w in words):
        return True
    return all(w in CONTAINER_WORDS or w.isdigit() for w in words)


def map_label(rel_dirs: list[str], source: str, label_cfg: dict) -> tuple[str, str]:
    """Return (label, reason) for an image given its folder components."""
    src_n = _norm(source)
    for kw in label_cfg.get("exclude_sources", []):
        if _contains(src_n, kw):
            return LABEL_EXCLUDED, f"excluded source '{kw}'"

    comps = [_norm(c) for c in rel_dirs if c]
    joined = " / ".join(comps)

    for kw in label_cfg.get("exclude_keywords", []):
        if _contains(joined, kw):
            return LABEL_EXCLUDED, f"exclude keyword '{kw}'"

    exact = {k.lower(): v for k, v in (label_cfg.get("exact_folder_tokens") or {}).items()}
    # deepest folder wins (class folders are usually the last component)
    for comp in reversed(comps):
        if comp in exact:
            return exact[comp], f"exact folder '{comp}'"

    for comp in reversed(comps):
        # container folders like "Oral Cancer Dataset" or "train" are not class folders
        if _is_container(comp):
            continue
        for kw in label_cfg.get("no_refer_keywords", []):
            if _contains(comp, kw):
                return LABEL_NO_REFER, f"no_refer keyword '{kw}' in '{comp}'"
        for kw in label_cfg.get("refer_keywords", []):
            if _contains(comp, kw):
                return LABEL_REFER, f"refer keyword '{kw}' in '{comp}'"
    return LABEL_UNKNOWN, "no rule matched"


def scan_folder_sources(cfg: dict) -> pd.DataFrame:
    """Walk every input root; one row per image file."""
    exts = {e.lower() for e in cfg["data"]["image_extensions"]}
    code_names = {n.lower() for n in cfg["paths"].get("code_dataset_names", [])}
    rows = []
    for root in cfg["paths"]["input_roots"]:
        root = Path(root)
        if not root.exists():
            LOG.warning("Input root %s does not exist — skipped", root)
            continue
        for dirpath, _dirs, files in os.walk(root):
            rel = Path(dirpath).relative_to(root)
            parts = list(rel.parts)
            if not parts:
                continue
            # Kaggle layout: /kaggle/input/<dataset-slug>/...  (newer Kaggle: /kaggle/input/datasets/<owner>/<slug>/...)
            if parts[0].lower() in {"datasets", "competitions"} and len(parts) >= 3:
                source, inner = f"{parts[1]}/{parts[2]}", parts[3:]
            else:
                source, inner = parts[0], parts[1:]
            if source.split("/")[-1].lower() in code_names:
                continue
            for fn in files:
                if Path(fn).suffix.lower() not in exts:
                    continue
                rows.append({"path": str(Path(dirpath) / fn), "source": source,
                             "rel_dirs": list(inner)})
    df = pd.DataFrame(rows, columns=["path", "source", "rel_dirs"])
    if df.empty:
        return df.assign(label=[], reason=[], folder=[])
    labels = [map_label(r.rel_dirs, r.source, cfg["labels"]) for r in df.itertuples()]
    df["label"] = [l for l, _ in labels]
    df["reason"] = [r for _, r in labels]
    df["folder"] = ["/".join(r) if r else "." for r in df["rel_dirs"]]
    return df.drop(columns=["rel_dirs"])


def fetch_roboflow(cfg: dict) -> pd.DataFrame:
    """Download configured Roboflow projects. Returns rows with a fixed label per project."""
    rcfg = cfg.get("roboflow") or {}
    cols = ["path", "source", "label", "reason", "folder"]
    if not rcfg.get("enabled"):
        return pd.DataFrame(columns=cols)
    key = os.environ.get(rcfg.get("api_key_secret", "ROBOFLOW_API_KEY"))
    if not key:
        try:
            from kaggle_secrets import UserSecretsClient  # type: ignore

            key = UserSecretsClient().get_secret(rcfg.get("api_key_secret", "ROBOFLOW_API_KEY"))
        except Exception:  # noqa: BLE001
            key = None
    if not key:
        LOG.warning("Roboflow API key not found — Roboflow sources skipped (training continues without them).")
        return pd.DataFrame(columns=cols)
    try:
        from roboflow import Roboflow  # type: ignore
    except ImportError:
        LOG.warning("`roboflow` package not installed — run `pip install roboflow`. Skipping.")
        return pd.DataFrame(columns=cols)

    exts = {e.lower() for e in cfg["data"]["image_extensions"]}
    rf = Roboflow(api_key=key)
    out_root = Path(rcfg.get("download_dir", "/kaggle/working/roboflow"))
    rows = []
    for p in rcfg.get("projects", []):
        name = f"roboflow:{p['workspace']}/{p['project']}"
        target = out_root / f"{p['workspace']}__{p['project']}"
        try:
            if not (target.exists() and any(target.rglob("*.*"))):
                proj = rf.workspace(p["workspace"]).project(p["project"])
                versions = proj.versions()
                if not versions:
                    raise RuntimeError("project has no versions")
                ver = proj.version(p["version"]) if p.get("version") else versions[0]
                last_err = None
                for fmt in ("folder", "yolov8", "coco"):
                    try:
                        ver.download(fmt, location=str(target), overwrite=True)
                        last_err = None
                        break
                    except Exception as e:  # noqa: BLE001
                        last_err = e
                if last_err:
                    raise last_err
            n = 0
            for f in target.rglob("*"):
                if f.suffix.lower() in exts and f.is_file():
                    rows.append({"path": str(f), "source": name, "label": p["label"],
                                 "reason": f"roboflow project label ({p.get('note', '')})",
                                 "folder": str(f.parent.relative_to(target))})
                    n += 1
            LOG.info("Roboflow %s: %d images", name, n)
        except Exception as e:  # noqa: BLE001
            LOG.warning("Roboflow %s failed (%s) — skipped", name, e)
    return pd.DataFrame(rows, columns=cols)


def discover(cfg: dict) -> pd.DataFrame:
    folder_df = scan_folder_sources(cfg)
    rf_df = fetch_roboflow(cfg)
    df = pd.concat([folder_df, rf_df], ignore_index=True)
    df = df.drop_duplicates(subset="path").reset_index(drop=True)
    return df


def scan_report(df: pd.DataFrame) -> pd.DataFrame:
    """Folder-level summary the user should eyeball before training."""
    if df.empty:
        return pd.DataFrame(columns=["source", "folder", "label", "reason", "images"])
    return (df.groupby(["source", "folder", "label", "reason"]).size()
              .rename("images").reset_index()
              .sort_values(["source", "folder"]).reset_index(drop=True))
