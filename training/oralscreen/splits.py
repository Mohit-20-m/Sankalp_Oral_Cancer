
"""Group-aware stratified splits with MOD train-only protection."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

from .utils import LOG


def _strat_key(df: pd.DataFrame) -> np.ndarray:
    key = df["label"].astype(str) + "|" + df["source"].astype(str)
    vc = key.value_counts()
    rare = key.map(vc) < 10
    key = key.where(~rare, df["label"].astype(str))
    return key.values


def _holdout(df: pd.DataFrame, frac: float, seed: int) -> np.ndarray:
    n_splits = max(2, int(round(1.0 / frac)))
    sgkf = StratifiedGroupKFold(
        n_splits=n_splits, shuffle=True, random_state=seed
    )
    _, hold_idx = next(
        sgkf.split(df, _strat_key(df), groups=df["group"].values)
    )
    mask = np.zeros(len(df), dtype=bool)
    mask[hold_idx] = True
    return mask


def train_only_mask(df: pd.DataFrame, cfg: dict) -> np.ndarray:
    patterns = [
        str(x).lower()
        for x in cfg["split"].get("train_only_sources", [])
    ]

    source = df["source"].fillna("").astype(str).str.lower()
    matched = source.map(
        lambda s: any(pattern in s for pattern in patterns)
    ).to_numpy()

    # If any image in a duplicate group belongs to MOD,
    # keep the entire group out of evaluation.
    mod_groups = set(df.loc[matched, "group"])
    return df["group"].isin(mod_groups).to_numpy()


def make_splits(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    seed = cfg["project"]["seed"]
    scfg = cfg["split"]

    df = df.copy().reset_index(drop=True)
    df["split"] = "dev"
    df["fold"] = -1

    train_only = train_only_mask(df, cfg)

    # Only eligible images can enter test or calibration.
    eligible = df.loc[~train_only].copy()

    test_mask = _holdout(
        eligible, scfg["test_fraction"], seed
    )
    df.loc[eligible.index[test_mask], "split"] = "test"

    dev = df.loc[
        (df["split"] == "dev") & (~train_only)
    ].copy()

    calib_mask = _holdout(
        dev, scfg["calib_fraction"], seed + 1
    )
    df.loc[dev.index[calib_mask], "split"] = "calib"

    # Train-only images remain dev with fold=-1.
    # CV validation folds contain only eligible images.
    pool = df.loc[
        df["split"].isin(["dev", "calib"]) & (~train_only)
    ].copy()

    sgkf = StratifiedGroupKFold(
        n_splits=scfg["n_folds"],
        shuffle=True,
        random_state=seed + 2,
    )

    for k, (_, val_idx) in enumerate(
        sgkf.split(pool, _strat_key(pool), groups=pool["group"].values)
    ):
        df.loc[pool.index[val_idx], "fold"] = k

    g_test = set(df.loc[df["split"] == "test", "group"])
    g_rest = set(df.loc[df["split"] != "test", "group"])

    assert not (g_test & g_rest), "Group leakage between test and dev"
    assert not df.loc[train_only, "split"].isin(
        ["test", "calib"]
    ).any(), "Train-only images entered evaluation"

    LOG.info(
        "Train-only images: %d",
        int(train_only.sum())
    )
    LOG.info(
        "Split sizes: %s",
        df["split"].value_counts().to_dict()
    )
    LOG.info(
        "Label balance per split:\n%s",
        pd.crosstab(df["split"], df["label"])
    )

    return df
