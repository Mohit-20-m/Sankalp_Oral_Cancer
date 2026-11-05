"""Augmentation (training only) and PyTorch datasets.

Augmentations imitate how real phone photos of the mouth differ: framing,
angle, lighting, white balance, focus, motion blur, JPEG compression, noise.
Evaluation images are only letterboxed — never augmented.
"""
from __future__ import annotations

import os

os.environ.setdefault("NO_ALBUMENTATIONS_UPDATE", "1")

import albumentations as A
import cv2
import numpy as np
import torch
from torch.utils.data import Dataset, WeightedRandomSampler

from .imaging import PAD_RGB, letterbox, load_rgb, to_tensor_array


def _make(cls, *variants, **common):
    """Build an albumentations transform trying several argument styles (v1.x vs v2.x)."""
    last = None
    for v in variants or ({},):
        try:
            return cls(**{**v, **common})
        except TypeError as e:  # wrong keyword for this version
            last = e
    raise last  # type: ignore[misc]


def build_train_transform(size: int) -> A.Compose:
    pad = list(PAD_RGB)
    return A.Compose([
        _make(A.RandomResizedCrop, {"size": (size, size)}, {"height": size, "width": size},
              scale=(0.55, 1.0), ratio=(0.8, 1.25), p=1.0),
        A.HorizontalFlip(p=0.5),
        A.VerticalFlip(p=0.15),            # intra-oral photos are taken at many orientations
        _make(A.Affine, {"fill": pad, "border_mode": cv2.BORDER_CONSTANT},
              {"cval": pad, "mode": cv2.BORDER_CONSTANT},
              rotate=(-25, 25), translate_percent=(-0.06, 0.06), scale=(0.9, 1.1), shear=(-6, 6), p=0.6),
        A.OneOf([
            A.RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3),
            A.RandomGamma(gamma_limit=(70, 140)),
            A.CLAHE(clip_limit=2.5),
        ], p=0.8),
        A.HueSaturationValue(hue_shift_limit=6, sat_shift_limit=25, val_shift_limit=15, p=0.5),
        A.RGBShift(r_shift_limit=12, g_shift_limit=8, b_shift_limit=12, p=0.3),   # white-balance drift
        A.OneOf([
            A.GaussianBlur(blur_limit=(3, 5)),
            A.MotionBlur(blur_limit=5),
            A.Defocus(radius=(1, 3)) if hasattr(A, "Defocus") else A.GaussianBlur(blur_limit=(3, 5)),
        ], p=0.3),
        _make(A.GaussNoise, {"std_range": (0.02, 0.06)}, {"var_limit": (10.0, 40.0)}, p=0.2),
        _make(A.ImageCompression, {"quality_range": (55, 95)}, {"quality_lower": 55, "quality_upper": 95}, p=0.3),
    ])


class ImageDataset(Dataset):
    """Returns (tensor CxHxW float32, label float32, index)."""

    def __init__(self, paths, labels, size: int, train: bool, cache_max: int = 0):
        self.paths = list(paths)
        self.labels = np.asarray(labels, dtype=np.float32)
        self.size = size
        self.train = train
        self.tf = build_train_transform(size) if train else None
        # small optional RAM cache of decoded+downsized images (speeds up epochs)
        self._cache: dict[int, np.ndarray] = {}
        self._cache_max = cache_max

    def __len__(self) -> int:
        return len(self.paths)

    def _load(self, i: int) -> np.ndarray:
        if i in self._cache:
            return self._cache[i]
        img = load_rgb(self.paths[i])
        h, w = img.shape[:2]
        cap = self.size * 2
        if max(h, w) > cap:  # keep enough resolution for random crops, save RAM/CPU
            s = cap / max(h, w)
            img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        if len(self._cache) < self._cache_max:
            self._cache[i] = img
        return img

    def __getitem__(self, i: int):
        img = self._load(i)
        if self.train:
            img = letterbox(img, int(self.size * 1.15))   # keep whole photo, then random-crop
            img = self.tf(image=img)["image"]
            if img.shape[0] != self.size or img.shape[1] != self.size:
                img = letterbox(img, self.size)
        else:
            img = letterbox(img, self.size)
        return torch.from_numpy(to_tensor_array(img)), torch.tensor(self.labels[i]), i


def balanced_sampler(labels) -> WeightedRandomSampler:
    labels = np.asarray(labels).astype(int)
    counts = np.bincount(labels, minlength=2).astype(np.float64)
    w = (1.0 / np.maximum(counts, 1))[labels]
    return WeightedRandomSampler(torch.as_tensor(w, dtype=torch.double), num_samples=len(labels), replacement=True)


def mix_batch(x: torch.Tensor, y: torch.Tensor, cfg: dict):
    """MixUp or CutMix on a batch (binary soft targets)."""
    if np.random.rand() > cfg.get("mix_prob", 0.5) or x.size(0) < 2:
        return x, y
    perm = torch.randperm(x.size(0), device=x.device)
    if np.random.rand() < 0.5 and cfg.get("mixup_alpha", 0) > 0:
        lam = float(np.random.beta(cfg["mixup_alpha"], cfg["mixup_alpha"]))
        return lam * x + (1 - lam) * x[perm], lam * y + (1 - lam) * y[perm]
    alpha = cfg.get("cutmix_alpha", 1.0)
    lam = float(np.random.beta(alpha, alpha))
    H, W = x.shape[2], x.shape[3]
    rh, rw = int(H * np.sqrt(1 - lam)), int(W * np.sqrt(1 - lam))
    cy, cx = np.random.randint(H), np.random.randint(W)
    y1, y2 = np.clip(cy - rh // 2, 0, H), np.clip(cy + rh // 2, 0, H)
    x1, x2 = np.clip(cx - rw // 2, 0, W), np.clip(cx + rw // 2, 0, W)
    x = x.clone()
    x[:, :, y1:y2, x1:x2] = x[perm, :, y1:y2, x1:x2]
    lam = 1 - ((y2 - y1) * (x2 - x1) / (H * W))
    return x, lam * y + (1 - lam) * y[perm]
