"""Validate images and group near-duplicates.

Open oral-image datasets frequently contain the same photograph several times
(re-uploaded, flipped, rotated, recoloured, or pre-augmented). If copies land
in both train and test, the reported accuracy is fake. We therefore:
  1. drop unreadable / tiny files,
  2. group exact copies (MD5),
  3. group flipped/rotated copies (pHash over all 8 dihedral transforms),
  4. group crops / colour shifts (cosine similarity of pretrained embeddings),
and use the groups for splitting. Only one image per group is kept for evaluation.
"""
from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
from PIL import Image

from .imaging import letterbox, load_rgb, to_tensor_array
from .utils import LOG


class UnionFind:
    def __init__(self, n: int):
        self.p = np.arange(n)

    def find(self, a: int) -> int:
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)

    def groups(self) -> np.ndarray:
        return np.array([self.find(i) for i in range(len(self.p))])


def _dihedral(a: np.ndarray, t: int) -> np.ndarray:
    """t in 0..7: optional horizontal flip, then k*90 degree rotation."""
    if t >= 4:
        a = a[:, ::-1]
    return np.rot90(a, k=t % 4)


def _dihedral_phashes(img: np.ndarray) -> tuple[list[int], np.ndarray]:
    """pHash of all 8 flips/rotations + a 32x32 zero-mean thumbnail for pixel confirmation."""
    import imagehash

    pil = Image.fromarray(img).convert("L").resize((256, 256))
    base = np.asarray(pil)
    out = [int(str(imagehash.phash(Image.fromarray(np.ascontiguousarray(_dihedral(base, t))))), 16)
           for t in range(8)]
    thumb = np.asarray(pil.resize((32, 32)), dtype=np.float32)
    thumb = (thumb - thumb.mean()) / (thumb.std() + 1e-6)
    return out, thumb


def _inspect(path: str, min_side: int) -> dict:
    try:
        with open(path, "rb") as f:
            raw = f.read()
        md5 = hashlib.md5(raw).hexdigest()
        img = load_rgb(path)
        h, w = img.shape[:2]
        if min(h, w) < min_side:
            return {"ok": False, "why": f"too small ({w}x{h})"}
        if img.std() < 2.0:
            return {"ok": False, "why": "blank image"}
        ph, thumb = _dihedral_phashes(img)
        return {"ok": True, "md5": md5, "w": w, "h": h, "phashes": ph, "thumb": thumb}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "why": f"unreadable ({type(e).__name__})"}


def inspect_images(df: pd.DataFrame, min_side: int, workers: int = 8) -> pd.DataFrame:
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda p: _inspect(p, min_side), df["path"].tolist()))
    df = df.copy()
    df["ok"] = [r["ok"] for r in res]
    df["drop_reason"] = [r.get("why", "") for r in res]
    df["md5"] = [r.get("md5") for r in res]
    df["width"] = [r.get("w") for r in res]
    df["height"] = [r.get("h") for r in res]
    df["phashes"] = [r.get("phashes") for r in res]
    df["thumb"] = [r.get("thumb") for r in res]
    bad = (~df["ok"]).sum()
    if bad:
        LOG.info("Dropped %d unusable images: %s", bad,
                 df.loc[~df["ok"], "drop_reason"].value_counts().to_dict())
    return df[df["ok"]].drop(columns=["ok"]).reset_index(drop=True)


_POP8 = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def _hamming_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """a: (n,) uint64, b: (m,) uint64 -> (n,m) Hamming distances."""
    x = np.bitwise_xor(a[:, None], b[None, :])
    return _POP8[x.view(np.uint8).reshape(x.shape[0], x.shape[1], 8)].sum(-1)


def phash_pairs(phashes: list[list[int]], thumbs: list[np.ndarray], max_dist: int,
                min_corr: float = 0.90, chunk: int = 256):
    """Pairs (i, j) whose pHash is within max_dist under some flip/rotation AND whose
    32x32 thumbnails correlate >= min_corr under that same transform (pixel confirmation
    removes false matches between different-but-similar-looking photos)."""
    canon = np.array([p[0] for p in phashes], dtype=np.uint64)          # (n,)
    allh = np.array(phashes, dtype=np.uint64)                           # (n, 8)
    n = len(canon)
    pairs, rejected = [], 0
    for s in range(0, n, chunk):
        a = canon[s:s + chunk]
        dists = np.stack([_hamming_matrix(a, allh[:, t]).astype(np.uint8) for t in range(8)], axis=-1)  # (c, n, 8)
        best_t = dists.argmin(-1)
        best = dists.min(-1)
        ii, jj = np.nonzero(best <= max_dist)
        for i_local, j in zip(ii, jj):
            i = int(i_local + s)
            if i >= j:
                continue
            # phash of transform t of image j matches image i  =>  i ≈ dihedral(j, t)
            t = int(best_t[i_local, j])
            corr = float((thumbs[i] * _dihedral(thumbs[j], t)).mean())
            if corr >= min_corr:
                pairs.append((i, int(j)))
            else:
                rejected += 1
    return pairs, rejected


def embedding_pairs(paths: list[str], cfg: dict, device, threshold: float, batch: int = 64):
    """Pairs with cosine similarity above `threshold` using a pretrained backbone (flip-averaged)."""
    import timm
    import torch

    model = timm.create_model(cfg["dedupe"]["embedding_model"], pretrained=cfg["dedupe"].get("pretrained", True),
                              num_classes=0).to(device).eval()
    size = 224
    feats = []
    with torch.no_grad():
        for s in range(0, len(paths), batch):
            arr = np.stack([to_tensor_array(letterbox(load_rgb(p), size)) for p in paths[s:s + batch]])
            x = torch.from_numpy(arr).to(device)
            f = model(x) + model(torch.flip(x, dims=[3]))
            feats.append(torch.nn.functional.normalize(f.float(), dim=1).cpu())
    feats = torch.cat(feats)
    pairs = []
    for s in range(0, len(feats), 1024):
        sim = feats[s:s + 1024] @ feats.T
        ii, jj = torch.nonzero(sim >= threshold, as_tuple=True)
        for i, j in zip((ii + s).tolist(), jj.tolist()):
            if i < j:
                pairs.append((i, j))
    del model
    return pairs


def group_duplicates(df: pd.DataFrame, cfg: dict, device) -> pd.DataFrame:
    dcfg = cfg["dedupe"]
    n = len(df)
    uf = UnionFind(n)
    counts = {}
    if dcfg.get("exact_md5", True):
        first = {}
        c = 0
        for i, h in enumerate(df["md5"]):
            if h in first:
                uf.union(first[h], i)
                c += 1
            else:
                first[h] = i
        counts["md5"] = c
    if dcfg.get("phash_dihedral", True):
        pairs, rejected = phash_pairs(df["phashes"].tolist(), df["thumb"].tolist(),
                                      int(dcfg.get("phash_hamming", 6)), float(dcfg.get("pixel_corr", 0.90)))
        for i, j in pairs:
            uf.union(i, j)
        counts["phash_pairs_confirmed"] = len(pairs)
        counts["phash_pairs_rejected_by_pixel_check"] = rejected
    if dcfg.get("embedding", True):
        try:
            pairs = embedding_pairs(df["path"].tolist(), cfg, device, float(dcfg.get("embedding_cosine", 0.955)))
            for i, j in pairs:
                uf.union(i, j)
            counts["embedding_pairs"] = len(pairs)
        except Exception as e:  # noqa: BLE001
            LOG.warning("Embedding dedupe skipped (%s)", e)
    df = df.copy()
    df["group"] = uf.groups()
    # A group whose members disagree on the label cannot be trusted.
    lab_per_group = df.groupby("group")["label"].nunique()
    conflicted = set(lab_per_group[lab_per_group > 1].index)
    df["label_conflict"] = df["group"].isin(conflicted)
    counts.update({"images": n, "groups": df["group"].nunique(),
                   "conflicting_groups": len(conflicted),
                   "images_in_conflicting_groups": int(df["label_conflict"].sum())})
    LOG.info("Duplicate grouping: %s", counts)
    if conflicted:
        LOG.warning("%d groups contain the same photo with BOTH labels — these images are removed.", len(conflicted))
        df = df[~df["label_conflict"]].reset_index(drop=True)
    df.attrs["dedupe_stats"] = counts
    return df


def build_cache(df: pd.DataFrame, cache_dir, max_side: int, workers: int = 8) -> pd.DataFrame:
    """Decode + resize every image ONCE (EXIF-corrected, RGB) so training epochs are fast.
    The original path is kept in `orig_path` for provenance."""
    from pathlib import Path

    from .imaging import make_thumbnail, save_jpeg

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    def one(args):
        i, p = args
        out = cache_dir / f"img_{i:06d}.jpg"
        if not out.exists():
            save_jpeg(make_thumbnail(load_rgb(p), max_side), out, 95)
        return str(out)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        cached = list(ex.map(one, list(enumerate(df["path"].tolist()))))
    df = df.copy()
    df["orig_path"] = df["path"]
    df["path"] = cached
    return df


def choose_representatives(df: pd.DataFrame) -> pd.Series:
    """True for one image per group (the largest-resolution copy)."""
    area = df["width"].fillna(0) * df["height"].fillna(0)
    rep = pd.Series(False, index=df.index)
    rep.loc[area.groupby(df["group"]).idxmax().values] = True
    return rep
