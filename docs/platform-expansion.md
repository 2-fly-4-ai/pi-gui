# Platform Expansion Decision

Date: 2026-07-09

This note records the Phase 5 platform expansion decision for the Electron desktop app. It is based on the current packaging, release, runtime, and verification surfaces in this checkout.

## Decision

| Platform | Decision | Why |
| --- | --- | --- |
| macOS arm64 | Supported path | `electron-builder.yml`, release CI, packaged-runtime verification, release zip smoke, and Homebrew sync are all built around this artifact today. |
| Linux AppImage | Supported path | Release CI packages and publishes AppImage output, and packaged-runtime dependency verification has a Linux mode. |
| macOS x64 | Go for a packaging spike; do not mark shipped yet | The main app is Electron/Node and should be close, but packaging, native helper, runtime dependency verification, release assets, update metadata, and Homebrew policy are arm64-specific today. |
| Windows | No-go for Phase 5 direct ship; split into a dedicated plan | There is no Windows package/release path, runtime process-tree features intentionally return empty on `win32`, terminal and node-pty/ConPTY behavior need real Windows coverage, and release/update/install UX differs from the current Homebrew/GitHub DMG flow. |

## Evidence

- `apps/desktop/electron-builder.yml` targets macOS `dmg` and `zip` for `arch: arm64`, includes the macOS notification helper in the app bundle, and has a Linux AppImage target. It has no Windows target config.
- `.github/workflows/release.yml` has macOS and Linux release jobs. The macOS job runs `electron-builder --mac`, publishes DMG/zip/update metadata, and syncs Homebrew with `pi-gui-<version>-arm64.dmg`.
- `scripts/homebrew-tap-utils.mjs` renders the cask with `depends_on arch: :arm64`.
- `scripts/verify-homebrew-flow.mjs` packages DMGs named `pi-gui-<version>-arm64.dmg` and verifies install/upgrade through Homebrew.
- `apps/desktop/scripts/assert-packaged-runtime-deps.mjs` resolves Darwin package output under `release/mac-arm64/pi-gui.app`, checks the macOS notification helper there, and has no Windows package target.
- `apps/desktop/scripts/build-notification-status-helper.mjs` builds the Swift helper only on macOS.
- `packages/pi-sdk-driver/src/runtime-process-inspector.ts` disables process group signaling and process tree snapshots on `win32`.
- `apps/desktop/electron/terminal-service.ts` has Windows branches for shell/executable handling, but still needs packaged Windows validation for `node-pty`, ConPTY behavior, cleanup, shell defaults, and path handling.

## macOS x64 Spike

Acceptance checklist:

- Add an explicit x64 packaging command or CI matrix entry, for example an `electron-builder --mac --x64` path that produces `pi-gui-<version>-x64.dmg` and zip/update metadata.
- Decide whether the notification helper is built separately per arch or as a universal binary, then verify it is present and executable in the packaged x64 app.
- Update `assert-packaged-runtime-deps.mjs` so Darwin verification can target both `mac-arm64` and `mac`/`mac-x64` output directories instead of assuming arm64.
- Run packaged smoke coverage on x64 hardware or an explicit Rosetta-backed setup; do not infer x64 readiness from arm64 CI alone.
- Decide Homebrew behavior before publishing: keep the current arm64-only cask, publish a separate x64 artifact path, or move to a universal/multi-arch strategy.
- Verify update metadata and release asset names for both architectures before enabling auto-update for x64.

Estimated effort: small to medium. The likely implementation is mostly release/config/test work, with risk concentrated in native helper packaging and availability of reliable x64 smoke coverage.

## Windows Plan Boundary

Windows should become its own plan only after a spike proves the runtime, terminal, packaging, and product UX are viable. That plan should cover:

- Electron Builder `win` target configuration, signing, artifact naming, update metadata, and CI runner setup.
- Packaged-runtime dependency verification for Windows app output, including `node-pty` native files.
- ConPTY behavior, shell defaults, process cleanup, cancellation, and process tree visibility.
- Windows notification behavior and settings affordances instead of the macOS Swift helper path.
- Menu, shortcut, file-picker, path, and workspace-open conventions.
- Installer/update strategy, since Homebrew is not part of the Windows path.
- Real Windows production smoke tests before any public release.

Estimated effort: large. Treat this as a separate platform project, not a Phase 5 closeout task.
