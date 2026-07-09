# Architecture

This repo is a Codex-style desktop shell for `pi`. The desktop app is the product center; packages under `packages/` keep runtime compatibility thin and reusable.

## Desktop Boundaries

- Electron main (`apps/desktop/electron/`) owns local filesystem access, process control, runtime drivers, persistence, OS integration, webview security policy, permissions, and IPC handlers.
- Preload (`apps/desktop/electron/preload.ts`) exposes a narrow typed bridge. Renderer code should not receive broad Node, filesystem, shell, process, or environment access.
- Renderer (`apps/desktop/src/`) owns presentation and local interaction state. It displays snapshots/events from main and sends explicit commands back through preload.
- Tests under `apps/desktop/tests/` verify the real Electron surface. Core tests are background-safe in-window flows; native tests use foreground macOS OS surfaces; production tests cover packaged or installed app behavior.

## State Flow

The current app-state source of truth is `DesktopAppStore` in Electron main. Main mutates workspace/session/composer/runtime state, persists it, and publishes `desktopIpc.stateChanged` snapshots to the renderer through a coalesced publisher.

Selected transcript hydration is separate: main loads the selected session transcript, caches it by session key, and publishes `desktopIpc.selectedTranscriptChanged`. Renderer materializes the active transcript and timeline, while persistence stays in main.

Phase 4 will replace the full-snapshot transport with typed delta channels. Until then, use the existing store and IPC contracts rather than adding parallel state paths.

## Driver Stack

- `packages/session-driver` defines the desktop-facing session-driver contract and runtime event types.
- `packages/pi-sdk-driver` adapts the upstream `@earendil-works/pi-coding-agent` runtime to that contract. Keep this layer thin; do not fork runtime behavior unless a plan explicitly calls for it.
- Electron main composes the driver with desktop services: catalog stores, terminal service, worktree manager, notifications, logs, subagent run records, and diagnostics.

## Test Tiers

- `core`: deterministic Electron window behavior, including composer, timeline, settings, persistence, worktrees, side panels, security policies, and layout.
- `live`: real provider/runtime behavior, including actual runs, tool events, transcript streaming, and runtime-backed notifications.
- `native`: foreground macOS integration such as real clipboard paste and picker/open-panel flows.
- `production`: packaged or installed app confidence checks, kept out of default lane globs.

Use `apps/desktop/package.json` as the command source of truth. Public lane scripts rebuild first; matching `:run` scripts skip rebuild for faster iteration after a known-current build.
