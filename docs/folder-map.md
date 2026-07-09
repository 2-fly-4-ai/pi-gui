# Folder Map

## Root

- `AGENTS.md` - compact repo map and agent rules.
- `CLAUDE.md` - symlink to `AGENTS.md`; keep it that way.
- `README.md` - project overview and user-facing orientation.
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` - workspace and package-manager source of truth.
- `.github/workflows/` - CI and release workflows.
- `.agents/` - repo-local skills and agent support files.

## Apps

- `apps/desktop/` - Electron desktop app and its package-owned tests.
- `apps/website/` - website/demo surface.

## Packages

- `packages/pi-sdk-driver/` - compatibility layer over `pi-mono`; keep it thin.
- `packages/session-driver/` - session-driver package.
- `packages/catalogs/` - model/catalog metadata package.

## Docs And Plans

- `docs/` - durable repo-local knowledge base.
- `docs/security/` - credential rotation and secret-scanning procedures.
- `docs/superpowers/specs/` - specs for major desktop/product capabilities.
- `docs/superpowers/plans/` - historical and active-ish product capability plans.
- `docs/readme/` - imported/readme-style pi documentation and media assets.
- `plans/active/` - current remediation roadmap and phase plans.
- `plans/` - archived or standalone execution plans.

## Tooling

- `scripts/` - release, install, and verification helper scripts.
- `patches/` - package patches.
- `public/`, `video/` - static/media surfaces used by the app or docs.

## Local/Private

- `.worktrees/` - local worktrees; do not prune without explicit approval.
- `node_modules/` - installed dependencies.
- `agentlog.txt` - local log artifact; do not commit.
- `.env*` - secrets; do not commit or print values.
