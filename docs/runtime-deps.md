# Runtime Dependencies

The desktop app packages the upstream `pi` runtime inside Electron. Some packages that look transitive in local development must stay explicit in `apps/desktop/package.json` because `electron-builder` can omit hoisted pnpm dependencies from `app.asar`.

## Guard Scripts

- `apps/desktop/scripts/assert-electron-runtime.mjs` executes the installed Electron binary in Node mode and verifies both the Electron pin and Pi's minimum embedded Node version.
- `apps/desktop/scripts/assert-runtime-model-registry.mjs` verifies the installed `@earendil-works/pi-coding-agent` exposes the model metadata the app expects.
- `apps/desktop/scripts/assert-packaged-runtime-deps.mjs` extracts the packaged `app.asar`, checks required packages exist, imports representative runtime modules, verifies `node-pty` native unpacking, and rechecks the packaged `pi` model registry.
- `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps` runs the full runtime check set for macOS package output.
- `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps:linux` runs the full runtime check set for Linux package output.

## Explicit Runtime Pins

- `electron`: pinned to `43.2.0`. Its embedded Node runtime is checked against Pi's `>=22.19.0` requirement rather than relying on the build-shell Node version.
- `electron-builder` and `electron-builder-squirrel-windows`: pinned together at `26.15.3`; root `node-abi` is pinned to `4.33.0` so native dependencies can resolve Electron 43's ABI.
- `@earendil-works/pi-coding-agent`: primary runtime, pinned to `0.82.1`. Root pnpm overrides keep `pi-agent-core`, `pi-ai`, `pi-coding-agent`, and `pi-tui` on the same `0.82.1` release.
- The runtime-model checks require Pi's discovered `openai-codex` GPT-5.6 family to expose reasoning, image input, and `max` reasoning metadata. The app does not inject model entries; Pi remains the catalog source of truth.
- `node-pty`: integrated terminal runtime dependency. The packaged check verifies the native `.node` module and macOS `spawn-helper` are unpacked.
- `@xterm/*`: terminal UI and clipboard/link/fit addons used by the desktop terminal panel.
- `@aws-sdk/token-providers`, `@smithy/*`: provider/runtime auth dependencies used by the bundled `pi` provider stack.
- `proxy-agent`, `retry`, `data-uri-to-buffer`, `mime-types`, `strip-ansi`, `ansi-regex`, `chalk`, `cli-highlight`, `supports-color` compatibility packages: imported by the runtime/provider stack and kept explicit because electron-builder can prune hoisted transitive dependencies.
- `glob`, `minimatch`, `brace-expansion`, `balanced-match`, `hosted-git-info`, `lru-cache`: filesystem/package-resolution dependencies needed by the runtime resource and package loaders.
- `parse5`, `parse5-htmlparser2-tree-adapter`, `yargs`: runtime/parser/CLI compatibility dependencies matching the versions required by the bundled `cli-highlight` path. Do not independently replace them with incompatible majors; upgrade them with the upstream runtime dependency chain.

## Current Follow-Ups

- Pi `0.82.1` replaced the split `AuthStorage`/`ModelRegistry` SDK surface with the async `ModelRuntime`. The desktop driver now shares that canonical runtime across session creation, provider auth, runtime discovery, and title generation.
- Desktop `ModelRuntime` instances start in Pi's supported offline/cache-first catalog mode. This prevents provider login and API-key setup from waiting on a remote catalog refresh, while normal model requests remain online. Explicit runtime refresh recreates the shared runtime so externally changed credentials are discovered.
- `@legendapp/list` was upgraded from `3.0.0-beta.44` to stable `3.3.3` on 2026-07-21. The removed per-row estimate API was replaced by stable-list sizing, and explicit `scrollToOffset` restoration preserves off-bottom session switching. Long-transcript/native-scroll/thread-return/Display Mode Electron coverage, packaged smoke, packaged runtime verification, and release-zip smoke passed.
- `parse5` and `yargs` have newer majors, but the bundled `pi` runtime reaches the current compatibility versions through `cli-highlight@2.1.11`. They are not imported by repo source, and upgrading the app-level compatibility copies alone would not upgrade that upstream path. Re-evaluate when `@earendil-works/pi-coding-agent` upgrades the parser/CLI dependency chain.
- `@dnd-kit/*` is used by runtime renderer code (`sidebar.tsx`, `display-mode-view.tsx`) and therefore belongs in `dependencies`, not `devDependencies`.

## Upgrade Gates

- Renderer virtualization packages: run `pnpm --filter @pi-gui/desktop run typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm --filter @pi-gui/desktop run build`, full timeline-native-scroll/thread-return/timeline-pinning Electron specs, and full core e2e before landing.
- Packaged runtime parser/CLI packages: run `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps`, `pnpm --filter @pi-gui/desktop run test:prod:packaged-smoke`, and the release zip smoke path before landing. For Linux-specific packaging changes, also run `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps:linux` after a Linux package.
