"""Report figures (saved as PNG)."""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import roc_curve

from .imaging import letterbox, load_rgb


def roc_plot(y, p, path, title="ROC — held-out test"):
    fpr, tpr, _ = roc_curve(y, p)
    plt.figure(figsize=(4.5, 4.5))
    plt.plot(fpr, tpr, lw=2)
    plt.plot([0, 1], [0, 1], "--", color="grey")
    plt.xlabel("False positive rate (1 − specificity)")
    plt.ylabel("Sensitivity")
    plt.title(title)
    plt.grid(alpha=.3)
    plt.tight_layout()
    plt.savefig(path, dpi=150)
    plt.close()


def confusion_plot(m: dict, path, title):
    cm = np.array([[m["tn"], m["fp"]], [m["fn"], m["tp"]]])
    plt.figure(figsize=(4, 3.6))
    plt.imshow(cm, cmap="Blues")
    for i in range(2):
        for j in range(2):
            plt.text(j, i, cm[i, j], ha="center", va="center", fontsize=14,
                     color="white" if cm[i, j] > cm.max() / 2 else "black")
    plt.xticks([0, 1], ["no refer", "refer"])
    plt.yticks([0, 1], ["no refer", "refer"])
    plt.xlabel("Predicted")
    plt.ylabel("True")
    plt.title(title, fontsize=10)
    plt.tight_layout()
    plt.savefig(path, dpi=150)
    plt.close()


def calibration_plot(y, p, path, bins=10):
    y, p = np.asarray(y), np.asarray(p)
    edges = np.linspace(0, 1, bins + 1)
    xs, ys = [], []
    for a, b in zip(edges[:-1], edges[1:]):
        m = (p >= a) & (p <= b)
        if m.sum() >= 3:
            xs.append(p[m].mean())
            ys.append(y[m].mean())
    plt.figure(figsize=(4.5, 4.5))
    plt.plot([0, 1], [0, 1], "--", color="grey")
    plt.plot(xs, ys, "o-")
    plt.xlabel("Predicted probability")
    plt.ylabel("Observed fraction 'refer'")
    plt.title("Calibration — held-out test")
    plt.grid(alpha=.3)
    plt.tight_layout()
    plt.savefig(path, dpi=150)
    plt.close()


def history_plot(history: list[dict], path, title):
    ep = [h["epoch"] for h in history if "val_auc" in h]
    if not ep:
        return
    plt.figure(figsize=(6, 3.5))
    plt.plot(ep, [h["val_auc"] for h in history if "val_auc" in h], label="val AUC")
    plt.plot(ep, [h["loss"] for h in history if "val_auc" in h], label="train loss")
    plt.xlabel("epoch")
    plt.legend()
    plt.grid(alpha=.3)
    plt.title(title)
    plt.tight_layout()
    plt.savefig(path, dpi=150)
    plt.close()


def cam_grid(paths, labels, probs, cams, size, path, ncol=4):
    """Overlay heat maps on letterboxed images."""
    import cv2

    n = len(paths)
    nrow = int(np.ceil(n / ncol))
    plt.figure(figsize=(3 * ncol, 3.2 * nrow))
    for k in range(n):
        img = letterbox(load_rgb(paths[k]), size)
        cam = cv2.resize(cams[k].astype(np.float32), (size, size), interpolation=cv2.INTER_CUBIC)
        heat = plt.cm.jet(np.clip(cam, 0, 1))[..., :3]
        over = (0.6 * img / 255.0 + 0.4 * heat)
        plt.subplot(nrow, ncol, k + 1)
        plt.imshow(np.clip(over, 0, 1))
        plt.axis("off")
        plt.title(f"true: {labels[k]}\np(refer)={probs[k]:.2f}", fontsize=9)
    plt.tight_layout()
    plt.savefig(path, dpi=120)
    plt.close()
