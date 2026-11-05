"""Training and prediction loops."""
from __future__ import annotations

import math
import time

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import roc_auc_score
from torch.utils.data import DataLoader

from .data import ImageDataset, balanced_sampler, mix_batch
from .models import ModelEMA, ScreenNet
from .utils import LOG


def _autocast(device, enabled: bool):
    if device.type == "cuda" and enabled:
        return torch.autocast(device_type="cuda", dtype=torch.float16)
    return torch.autocast(device_type="cpu", enabled=False)


def _scaler(device, enabled: bool):
    try:
        return torch.amp.GradScaler("cuda", enabled=(device.type == "cuda" and enabled))
    except (AttributeError, TypeError):
        return torch.cuda.amp.GradScaler(enabled=(device.type == "cuda" and enabled))


def make_loader(df, size, train: bool, cfg: dict, shuffle_balanced: bool = False):
    tcfg = cfg["train"]
    ds = ImageDataset(df["path"].values, (df["label"] == "refer").astype(np.float32).values, size, train)
    sampler = balanced_sampler(ds.labels) if (train and shuffle_balanced) else None
    return DataLoader(ds, batch_size=tcfg["batch_size"], shuffle=(train and sampler is None), sampler=sampler,
                      num_workers=tcfg["num_workers"], pin_memory=torch.cuda.is_available(),
                      drop_last=train and len(ds) > tcfg["batch_size"], persistent_workers=False)


@torch.no_grad()
def predict(model: ScreenNet, loader, device, amp: bool = True, tta: bool = False):
    """Returns logits (N,), embeddings (N,D) in dataset order."""
    model.eval()
    logits, embs = [], []
    for x, _y, _i in loader:
        x = x.to(device, non_blocking=True)
        with _autocast(device, amp):
            lg, em = model(x)
            if tta:
                lg2, _ = model(torch.flip(x, dims=[3]))
                lg3, _ = model(torch.flip(x, dims=[2]))
                lg = (lg + lg2 + lg3) / 3
        logits.append(lg.float().cpu())
        embs.append(em.float().cpu())
    return torch.cat(logits).numpy(), torch.cat(embs).numpy()


def _val_score(y, logits) -> float:
    if len(np.unique(y)) < 2:
        return float("nan")
    return float(roc_auc_score(y, logits))


def train_finetune(cand: dict, train_df, val_df, cfg: dict, device, log_prefix: str = ""):
    """Fine-tune one candidate. Returns (best EMA model, history, best_epoch)."""
    tcfg = cfg["train"]
    size = cfg["data"]["image_size"]
    model = ScreenNet(cand["timm"], pretrained=tcfg.get("pretrained", True),
                      drop_path=cand.get("drop_path", 0.0), img_size=size).to(device)
    y_train = (train_df["label"] == "refer").astype(np.float32).values
    use_sampler = tcfg.get("balance", "sampler") == "sampler"
    tl = make_loader(train_df, size, True, cfg, shuffle_balanced=use_sampler)
    vl = make_loader(val_df, size, False, cfg)
    y_val = (val_df["label"] == "refer").astype(int).values

    pos_weight = None
    if tcfg.get("balance") == "pos_weight":
        pos = y_train.sum()
        pos_weight = torch.tensor([(len(y_train) - pos) / max(pos, 1)], device=device)

    opt = torch.optim.AdamW(model.param_groups(cand["lr_backbone"], cand["lr_head"], tcfg["weight_decay"]))
    epochs = tcfg["epochs"]
    steps_per_epoch = max(1, len(tl))
    total = epochs * steps_per_epoch
    warm = steps_per_epoch  # 1 epoch warm-up
    base_lrs = [g["lr"] for g in opt.param_groups]

    def set_lr(step: int):
        if step < warm:
            f = (step + 1) / warm
        else:
            p = (step - warm) / max(1, total - warm)
            f = 0.01 + 0.99 * 0.5 * (1 + math.cos(math.pi * p))
        for g, b in zip(opt.param_groups, base_lrs):
            g["lr"] = b * f

    scaler = _scaler(device, tcfg["amp"])
    ema = ModelEMA(model, tcfg["ema_decay"])
    eps = tcfg.get("label_smoothing", 0.0)
    best, best_epoch, bad, history = -1.0, 0, 0, []
    best_state = None
    step = 0
    for ep in range(epochs):
        t0 = time.time()
        model.train()
        model.set_backbone_trainable(ep >= tcfg.get("freeze_epochs", 0))
        losses = []
        for x, y, _ in tl:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            x, y = mix_batch(x, y, tcfg)
            y = y * (1 - eps) + 0.5 * eps
            set_lr(step)
            with _autocast(device, tcfg["amp"]):
                logit, _ = model(x)
                loss = F.binary_cross_entropy_with_logits(logit.float(), y, pos_weight=pos_weight)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), tcfg["grad_clip"])
            scaler.step(opt)
            scaler.update()
            ema.update(model)
            losses.append(loss.item())
            step += 1
        vlog, _ = predict(ema.module, vl, device, tcfg["amp"])
        auc = _val_score(y_val, vlog)
        vp = 1 / (1 + np.exp(-vlog))
        bacc = float(((vp >= 0.5) & (y_val == 1)).sum() / max(1, (y_val == 1).sum()) / 2 +
                     ((vp < 0.5) & (y_val == 0)).sum() / max(1, (y_val == 0).sum()) / 2)
        history.append({"epoch": ep + 1, "loss": float(np.mean(losses)), "val_auc": auc, "val_bacc@0.5": bacc,
                        "secs": round(time.time() - t0, 1)})
        LOG.info("%s ep %02d/%d  loss %.4f  val AUC %.4f  bAcc@0.5 %.4f  (%.0fs)", log_prefix, ep + 1, epochs,
                 np.mean(losses), auc, bacc, time.time() - t0)
        score = auc if not math.isnan(auc) else -loss.item()
        if score > best + 1e-4:
            best, best_epoch, bad = score, ep + 1, 0
            best_state = {k: v.detach().cpu().clone() for k, v in ema.module.state_dict().items()}
        else:
            bad += 1
            if ep + 1 > tcfg.get("freeze_epochs", 0) + 2 and bad >= tcfg["patience"]:
                LOG.info("%s early stop at epoch %d (best %d)", log_prefix, ep + 1, best_epoch)
                break
    final = ScreenNet(cand["timm"], pretrained=False, drop_path=0.0, img_size=size)
    final.load_state_dict(best_state)
    return final.to(device).eval(), history, best_epoch


def train_probe(cand: dict, train_df, val_df, cfg: dict, device, log_prefix: str = ""):
    """Frozen pretrained backbone + logistic regression on (flip-augmented) embeddings."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import GridSearchCV

    size = cfg["data"]["image_size"]
    model = ScreenNet(cand["timm"], pretrained=cfg["train"].get("pretrained", True), img_size=size).to(device).eval()
    tl = make_loader(train_df, size, False, cfg)

    @torch.no_grad()
    def feats(loader, flip: bool):
        out = []
        for x, _, _ in loader:
            x = x.to(device)
            if flip:
                x = torch.flip(x, dims=[3])
            out.append(model.embed(x).float().cpu())
        return torch.cat(out).numpy()

    Xtr = np.concatenate([feats(tl, False), feats(tl, True)])
    ytr = np.concatenate([(train_df["label"] == "refer").values] * 2).astype(int)
    grid = GridSearchCV(LogisticRegression(max_iter=4000, class_weight="balanced"),
                        {"C": [0.01, 0.03, 0.1, 0.3, 1.0]}, scoring="roc_auc", cv=3, n_jobs=-1)
    grid.fit(Xtr, ytr)
    lr = grid.best_estimator_
    with torch.no_grad():
        model.head.weight.copy_(torch.tensor(lr.coef_, dtype=torch.float32))
        model.head.bias.copy_(torch.tensor(lr.intercept_, dtype=torch.float32))
    LOG.info("%s probe: best C=%s (cv AUC %.4f)", log_prefix, grid.best_params_["C"], grid.best_score_)
    return model.eval(), [{"epoch": 0, "probe_C": grid.best_params_["C"], "cv_auc": float(grid.best_score_)}], 0


def train_candidate(cand, train_df, val_df, cfg, device, log_prefix=""):
    if cand.get("kind") == "probe":
        return train_probe(cand, train_df, val_df, cfg, device, log_prefix)
    return train_finetune(cand, train_df, val_df, cfg, device, log_prefix)
