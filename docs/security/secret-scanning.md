# Secret Scanning

This repo uses Gitleaks in CI and can use the same scanner locally before commits.

## CI

`.github/workflows/ci.yml` runs `gitleaks/gitleaks-action@v3` before typecheck, desktop core tests, or Linux packaging. The checkout uses full history so local-only cleanup work can verify that no secret commit is still reachable from pushed refs.

## GitHub Push Protection

GitHub secret scanning and push protection are enabled for the public repository. This was verified through the GitHub repository API on 2026-07-20. CI catches leaked secrets after a push or pull request; push protection blocks many leaks before they land on the remote.

## Local Hook

Install the repo hook path once per clone:

```bash
pnpm hooks:install
```

The hook runs:

```bash
gitleaks protect --staged --redact
```

It also refuses to commit `.env`, `.env.*`, or `agentlog.txt` anywhere in the tree, even if a scanner rule does not match the contents.

Install Gitleaks before enabling the hook. The hook fails closed when `gitleaks` is unavailable.

## Manual Full-History Check

Use this before closing secret-remediation work:

```bash
gitleaks detect --source . --log-opts="--all" --redact
```

Do not paste unredacted findings into docs, issues, logs, or chat.
