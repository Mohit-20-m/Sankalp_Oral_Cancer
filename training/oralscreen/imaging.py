"""Image loading and the deployment preprocessing (letterbox) shared by training,
evaluation and export, so the backend / the phone app can reproduce it exactly."""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageOps

# ImageNet statistics (all candidate backbones were pretrained with these).
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
PAD_RGB = tuple(int(round(m * 255)) for m in MEAN)  # (124, 116, 104): pads become 0 after normalisation


def load_rgb(path: str) -> np.ndarray:
    """Read any image as uint8 RGB HxWx3, honouring EXIF rotation."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        return np.asarray(im, dtype=np.uint8).copy()


def letterbox(img: np.ndarray, size: int) -> np.ndarray:
    """Resize the longest side to `size` and pad to a square with the ImageNet mean colour.
    The whole photo is kept (no centre crop), so off-centre lesions are never cut away."""
    h, w = img.shape[:2]
    scale = size / max(h, w)
    nh, nw = max(1, round(h * scale)), max(1, round(w * scale))
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    resized = cv2.resize(img, (nw, nh), interpolation=interp)
    out = np.empty((size, size, 3), dtype=np.uint8)
    out[:] = PAD_RGB
    top, left = (size - nh) // 2, (size - nw) // 2
    out[top:top + nh, left:left + nw] = resized
    return out


def to_tensor_array(img: np.ndarray) -> np.ndarray:
    """uint8 HxWx3 RGB -> float32 3xHxW normalised (the model's input format)."""
    x = img.astype(np.float32) / 255.0
    x = (x - MEAN) / STD
    return np.ascontiguousarray(x.transpose(2, 0, 1))


def preprocess_for_model(path_or_img, size: int) -> np.ndarray:
    img = load_rgb(path_or_img) if isinstance(path_or_img, str) else path_or_img
    return to_tensor_array(letterbox(img, size))


def make_thumbnail(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = min(1.0, max_side / max(h, w))
    if s < 1.0:
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return img


def save_jpeg(img: np.ndarray, path, quality: int = 90) -> None:
    Image.fromarray(img).save(path, format="JPEG", quality=quality)
