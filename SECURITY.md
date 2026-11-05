# Security policy

Sankalp handles health information, so we take security and privacy reports seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
**Security → Report a vulnerability** on this repository
([direct link](https://github.com/Mohit-20-m/Sankalp_Oral_Cancer/security/advisories/new)).

Please include:

- what is affected (component, version or commit) and the impact,
- steps to reproduce or a proof of concept,
- any suggested fix.

You can expect an acknowledgement within **3 working days** and an assessment within **10 working days**. We will
keep you informed, credit you in the advisory if you wish, and coordinate disclosure once a fix is available.

## Scope

In scope: code in this repository and the released model artefacts (for example, a crafted image that crashes the
inference code, or a way to bypass checksum verification in `scripts/fetch-model.sh`).

Out of scope: the third-party datasets and pretrained backbones, and the clinical accuracy of the model — please
report accuracy problems as a regular issue.

## Supported versions

Only the latest release receives security fixes.

## Patient data

If you find patient-identifiable information anywhere in this repository or its releases, report it privately as
above; it will be removed and the history rewritten.
