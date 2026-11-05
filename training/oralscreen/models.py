"""ScreenNet: any timm backbone + one binary head, with a uniform interface:

    logit, embedding = net(x)            # training / inference
    cam_features     = net.cam_features(x)   # (N, D, h, w) features aligned with the head

The head is a single linear layer on the pooled embedding, so a heat map is
    CAM(x) = ReLU( sum_d  w_d * cam_features_d )
which is exactly what the phone and backend compute (no gradients needed).
The same split lets the backend retrain only the head (fast) on cached embeddings.
"""
from __future__ import annotations

import timm
import torch
import torch.nn as nn


class ScreenNet(nn.Module):
    def __init__(self, timm_name: str, pretrained: bool = True, drop_path: float = 0.0,
                 img_size: int = 224, head_dropout: float = 0.2):
        super().__init__()
        kwargs = {"pretrained": pretrained, "num_classes": 0}
        if drop_path:
            kwargs["drop_path_rate"] = drop_path
        self.is_vit = "vit" in timm_name or "dinov2" in timm_name
        if self.is_vit:
            kwargs["img_size"] = img_size
            kwargs["dynamic_img_size"] = False
        self.backbone = timm.create_model(timm_name, **kwargs)
        self.timm_name = timm_name
        self.embed_dim = self.backbone.num_features
        self.dropout = nn.Dropout(head_dropout)
        self.head = nn.Linear(self.embed_dim, 1)
        nn.init.zeros_(self.head.bias)
        nn.init.normal_(self.head.weight, std=0.01)

    # ---- core ----------------------------------------------------------
    def embed(self, x: torch.Tensor) -> torch.Tensor:
        feats = self.backbone.forward_features(x)
        return self.backbone.forward_head(feats, pre_logits=True)

    def forward(self, x: torch.Tensor):
        emb = self.embed(x)
        logit = self.head(self.dropout(emb)).squeeze(1)
        return logit, emb

    # ---- explainability --------------------------------------------------
    def cam_features(self, x: torch.Tensor) -> torch.Tensor:
        """Per-location features in the same space as the pooled embedding."""
        feats = self.backbone.forward_features(x)
        if self.is_vit:
            n_prefix = getattr(self.backbone, "num_prefix_tokens", 1)
            tokens = feats[:, n_prefix:, :]                      # (N, L, D) — already normed
            gh, gw = self.backbone.patch_embed.grid_size         # static ints: safe for ONNX tracing
            return tokens.transpose(1, 2).reshape(tokens.shape[0], self.embed_dim, gh, gw)
        # CNNs: apply the head's normalisation per location when the head has one (ConvNeXt)
        head = getattr(self.backbone, "head", None)
        norm = getattr(head, "norm", None) if head is not None else None
        if isinstance(norm, nn.Module) and not isinstance(norm, nn.Identity):
            try:
                feats = norm(feats)
            except Exception:  # noqa: BLE001 — shape-incompatible norm, use raw features
                pass
        return feats

    def cam(self, x: torch.Tensor) -> torch.Tensor:
        f = self.cam_features(x)
        w = self.head.weight.view(1, -1, 1, 1)
        c = torch.relu((f * w).sum(1))
        return c / (c.flatten(1).amax(1).view(-1, 1, 1) + 1e-6)

    # ---- param groups for discriminative learning rates -----------------
    def param_groups(self, lr_backbone: float, lr_head: float, wd: float):
        decay, no_decay = [], []
        for n, p in self.backbone.named_parameters():
            (no_decay if p.ndim <= 1 or n.endswith(".bias") or "pos_embed" in n or "cls_token" in n
             else decay).append(p)
        return [
            {"params": decay, "lr": lr_backbone, "weight_decay": wd, "name": "backbone"},
            {"params": no_decay, "lr": lr_backbone, "weight_decay": 0.0, "name": "backbone_nd"},
            {"params": list(self.head.parameters()), "lr": lr_head, "weight_decay": 1e-4, "name": "head"},
        ]

    def set_backbone_trainable(self, flag: bool) -> None:
        for p in self.backbone.parameters():
            p.requires_grad = flag


class ModelEMA:
    """Exponential moving average of weights (smoother, usually better on small data)."""

    def __init__(self, model: nn.Module, decay: float):
        import copy

        self.module = copy.deepcopy(model).eval()
        self.decay = decay
        self.updates = 0
        for p in self.module.parameters():
            p.requires_grad_(False)

    @torch.no_grad()
    def update(self, model: nn.Module) -> None:
        # warm-up: early on the average follows the live weights closely, then slows down
        self.updates += 1
        d = min(self.decay, (1 + self.updates) / (10 + self.updates))
        msd = model.state_dict()
        for k, v in self.module.state_dict().items():
            if v.dtype.is_floating_point:
                v.mul_(d).add_(msd[k].detach(), alpha=1 - d)
            else:
                v.copy_(msd[k])
