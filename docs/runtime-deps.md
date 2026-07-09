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
- `parse5`, `parse5-htmlparser2-tree-adapter`, `yargs`: legacy runtime/parser/CLI dependencies kept explicit until packaged-runtime verification proves newer majors are safe.

## Current Follow-Ups

- `@legendapp/list` is pinned to `3.0.0-beta.44`; npm reported `3.3.2` on 2026-07-09. It is imported directly by `apps/desktop/src/conversation-timeline.tsx`, so upgrade it only with long-transcript, native-scroll, thread-return, and Display Mode Electron coverage.
- `parse5` currently has a newer major (`8.0.1`) and `yargs` currently has a newer major (`18.0.0`) as of 2026-07-09. They are explicit packaged-runtime dependencies and are not imported directly by repo source. Upgrade only with `verify:packaged-runtime-deps`, packaged smoke coverage, and a check that the bundled `pi` runtime still imports its parser/CLI paths correctly.
- `@dnd-kit/*` is used by runtime renderer code (`sidebar.tsx`, `display-mode-view.tsx`) and therefore belongs in `dependencies`, not `devDependencies`.

## Upgrade Gates

- Renderer virtualization packages: run `pnpm --filter @pi-gui/desktop run typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm --filter @pi-gui/desktop run build`, full timeline-native-scroll/thread-return/timeline-pinning Electron specs, and full core e2e before landing.
- Packaged runtime parser/CLI packages: run `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps`, `pnpm --filter @pi-gui/desktop run test:prod:packaged-smoke`, and the release zip smoke path before landing. For Linux-specific packaging changes, also run `pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps:linux` after a Linux package.
