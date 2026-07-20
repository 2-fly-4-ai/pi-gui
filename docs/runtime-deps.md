# Runtime Dependencies

The desktop app packages the upstream `pi` runtime inside Electron. Some packages that look transitive in local development must stay explicit in `apps/desktop/package.json` because `electron-builder` can omit hoisted pnpm dependencies from `app.asar`.

## Guard Scripts

- `apps/desktop/scripts/assert-runtime-model-registry.mjs` verifies the installed `@earendil-works/pi-coding-agent` exposes the model metadata the app expects.
- `apps/desktop/scripts/assert-packaged-runtime-deps.mjs` extracts the packaged `app.asar`, checks required packages exist, imports representative runtime modules, verifies `node-pty` native unpacking, and rechecks the packaged `pi` model registry.
- `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps` runs both checks for macOS package output.
- `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps:linux` runs both checks for Linux package output.

## Explicit Runtime Pins

- `@earendil-works/pi-coding-agent`: primary runtime. `assert-packaged-runtime-deps.mjs` pins the packaged version to `0.74.0` and verifies `openai-codex/gpt-5.5` metadata.
- `node-pty`: integrated terminal runtime dependency. The packaged check verifies the native `.node` module and macOS `spawn-helper` are unpacked.
- `@xterm/*`: terminal UI and clipboard/link/fit addons used by the desktop terminal panel.
- `@aws-sdk/token-providers`, `@smithy/*`: provider/runtime auth dependencies used by the bundled `pi` provider stack.
- `proxy-agent`, `retry`, `data-uri-to-buffer`, `mime-types`, `strip-ansi`, `ansi-regex`, `chalk`, `cli-highlight` transitive family packages: imported by the runtime/provider stack and packaging-sensitive under pnpm hoisting.
- `glob`, `minimatch`, `brace-expansion`, `balanced-match`, `hosted-git-info`, `lru-cache`: filesystem/package-resolution dependencies needed by the runtime resource and package loaders.
- `parse5`, `parse5-htmlparser2-tree-adapter`, `yargs`: runtime/parser/CLI compatibility dependencies matching the versions required by the bundled `cli-highlight` path. Do not independently replace them with incompatible majors; upgrade them with the upstream runtime dependency chain.

## Current Follow-Ups

- `@legendapp/list` was upgraded from `3.0.0-beta.44` to stable `3.3.3` on 2026-07-21. The removed per-row estimate API was replaced by stable-list sizing, and explicit `scrollToOffset` restoration preserves off-bottom session switching. Long-transcript/native-scroll/thread-return/Display Mode Electron coverage, packaged smoke, packaged runtime verification, and release-zip smoke passed.
- `parse5` and `yargs` have newer majors, but the bundled `pi` runtime reaches the current compatibility versions through `cli-highlight@2.1.11`. They are not imported by repo source, and upgrading the app-level compatibility copies alone would not upgrade that upstream path. Re-evaluate when `@earendil-works/pi-coding-agent` upgrades the parser/CLI dependency chain.
- `@dnd-kit/*` is used by runtime renderer code (`sidebar.tsx`, `display-mode-view.tsx`) and therefore belongs in `dependencies`, not `devDependencies`.

## Upgrade Gates

- Renderer virtualization packages: run `pnpm --filter @pi-gui/desktop run typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm --filter @pi-gui/desktop run build`, full timeline-native-scroll/thread-return/timeline-pinning Electron specs, and full core e2e before landing.
- Packaged runtime parser/CLI packages: run `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps`, `pnpm --filter @pi-gui/desktop run test:prod:packaged-smoke`, and the release zip smoke path before landing. For Linux-specific packaging changes, also run `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps:linux` after a Linux package.
