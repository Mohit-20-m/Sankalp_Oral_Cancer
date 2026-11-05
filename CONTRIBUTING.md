# Contributing to Sankalp

Thanks for your interest! Sankalp is a health-screening project, so correctness and patient safety come before
speed. Please read this short guide before opening a pull request.

## Ways to help

- **Report a bug** or a confusing result — use the *Bug report* issue template.
- **Propose a feature** — open a *Feature request* first so we can agree on the approach.
- **Improve the model** — new public datasets, better augmentation, evaluation on field photographs.
- **Documentation and translations** — especially Kannada and other Indian languages.

## Development workflow

1. Fork the repository and create a branch from `main`: `feat/<short-name>` or `fix/<short-name>`.
2. Keep changes focused; one logical change per pull request.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, e.g.
   `feat(training): add stain augmentation`, `fix(models): correct INT8 parity check`.
4. Make sure CI passes locally:

   ```bash
   pip install ruff==0.13.3 nbformat==5.10.4
   ruff check training --select E9,F --ignore F401,F841
   python -m compileall -q training
   shellcheck scripts/*.sh
   ```

5. Open a pull request and fill in the template, including how you tested the change.

## Rules that protect patients

- **Never commit patient data** — no photographs, names, phone numbers or identifiers, not even in tests or
  screenshots. Use synthetic or public-dataset examples.
- **Never commit dataset images or model weights.** Weights are published as release assets
  (`scripts/fetch-model.sh`); dataset images stay with their original sources.
- **Model changes need evidence.** A pull request that changes the model, preprocessing or thresholds must report
  held-out test metrics with confidence intervals and per-source results, and must not lower sensitivity.
- **Never present output as a diagnosis** in code, UI text or documentation.

## Code style

- Python 3.12, 4-space indentation, lines ≤ 120 characters, type hints for new public functions.
- Keep preprocessing in one place (`training/oralscreen/imaging.py`); every client must match
  `inference_reference.py`.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE) and that you will
follow the [Code of Conduct](CODE_OF_CONDUCT.md).
