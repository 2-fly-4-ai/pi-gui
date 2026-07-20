# Phase 1 — Electron Security Hardening

## Goal

Bring the shell up to standard Electron security posture before webview-based surfaces (side browser, VS Code embed) grow further. Baseline is already good (contextIsolation, sandbox, no nodeIntegration, typed preload, http/https-validated `openExternal`); this phase closes the remaining gaps.

## Findings being fixed

- No `setWindowOpenHandler`, `will-navigate`, or `will-attach-webview` handlers anywhere, while `webviewTag: true` and `browser-panel.tsx` load arbitrary web content.
- No `session.setPermissionRequestHandler` — webview pages can request camera/mic/geolocation.
- No CSP on the renderer HTML.
- ~120 `ipcMain.handle` channels perform no sender validation; privileged channels (terminal write, git actions, file access) trust any frame.
- `readClipboardImage` uses blocking `ipcRenderer.sendSync`.

## Constraints

- Must not break the side browser panel, transcript link routing, VS Code embed plan, or the OAuth login flow (`createRuntimeLoginCallbacks` opens external URLs).
- Keep the renderer/main/preload boundary tight (root AGENTS.md); guards live in main, not the renderer.
- All flows re-verified on the real Electron surface, not just tests.
- Split security behavior from cleanup where needed: land the sender-validation guard and async clipboard fix first, then collapse IPC boilerplate only if the diff stays reviewable.

## Steps

1. **Window-open policy.** `mainWindow.webContents.setWindowOpenHandler`: always `{ action: "deny" }`; validated http/https URLs are routed to `shell.openExternal`. Apply the same handler to webview contents via `did-attach-webview`.
2. **Navigation policy.** `will-navigate` on the main window: allow only the dev-server URL (dev) / app `file://` index (prod); deny + log everything else. Webview contents keep free navigation (it's a browser panel) but stay inside the webview.
3. **Webview attach guard.** `will-attach-webview`: delete any `preload`/`preloadURL` from webPreferences, force `nodeIntegration: false` and `contextIsolation: true`, and verify the initial `src` is http/https (or the VS Code serve-web origin).
4. **Permission handler.** `session.setPermissionRequestHandler`: deny by default; allow only what the app actually needs (currently: notifications for the main frame; clipboard-read if required by the webview UX — decide during implementation and document).
5. **CSP.** Add a strict `Content-Security-Policy` meta tag to the renderer `index.html` (self-only script/style/img with the data:/blob: allowances the timeline attachments need). Confirm vite dev mode still works (dev-only relaxation via `onHeadersReceived` if needed).
6. **IPC sender validation.** Small helper `assertSenderIsMainFrame(event)` (checks `event.senderFrame === mainWindow.webContents.mainFrame`); apply to every handler. Prefer a tiny wrapper around `ipcMain.handle` as the first checkpoint. A table-driven registration refactor of `main.ts` IPC setup (channel → store method map) can follow as a cleanup checkpoint, but should not be required for the security fix to land.
7. **Async clipboard.** Replace `readClipboardImage` sendSync with `invoke`; update the renderer call sites and the paste flow.

## Success Criteria

- `window.open()` and `target="_blank"` from a page in the browser panel open in the system browser (validated URLs) or do nothing (others) — never a new Electron window.
- A webview page attempting to inject a preload or turn on nodeIntegration is neutralized (assert via a test page).
- Renderer devtools console shows no CSP violations during normal use (composer, timeline, terminal, diff, browser panel, settings).
- IPC handlers reject calls originating from webview frames (unit-testable via the helper; e2e via a test page attempting `ipcRenderer` access — should be impossible anyway with sandbox, so validate the helper directly).
- Paste-image flow works with async clipboard path.
- All existing core e2e specs pass unchanged (or with intentional updates only).

## Verification

- New e2e spec `tests/core/security-policies.spec.ts`: loads a local fixture page in the browser panel exercising `window.open`, `target=_blank`, nav redirects, and a permission request; asserts observed behavior.
- Manual pass on real Electron: OAuth provider login round-trip, transcript external links, side browser navigation, VS Code embed (if landed), image paste.

## Verification Notes

- 2026-07-08: Implemented the main-window navigation guard, window-open denial/external routing, webview attach hardening, default-deny permission handler, CSP meta tag, main-frame IPC wrapper, and async `readClipboardImage` IPC.
- 2026-07-08: Added `apps/desktop/tests/core/security-policies.spec.ts`; targeted run passed: `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/security-policies.spec.ts`.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run typecheck` passed.
- 2026-07-08: `pnpm --filter @pi-gui/desktop run build` passed.
- 2026-07-08: Adjacent targeted specs passed: `side-browser-panel.spec.ts`, `agent-settings.spec.ts -g "settings subagents submits"`, `composer-controls.spec.ts -g "host slash command failures"`, `model-scope-toggle.spec.ts`, `mentions-diff.spec.ts -g "shows workspace file mentions"`, `new-thread-auto-title.spec.ts -g "reopen heals"`, `subagent-timeline-card.spec.ts -g "timeline renders"`, and `timeline-pinning.spec.ts -g "mid-thread viewport"`.
- 2026-07-08: Earlier full `test:e2e:core` attempts improved to 128/131 while exposing a full-lane timing cluster: `composer-controls.spec.ts -g "host slash command failures"`, `mentions-diff.spec.ts -g "shows workspace file mentions"`, and `new-thread-auto-title.spec.ts -g "reopen heals"`. The mentions timeout also produced a worker teardown timeout.
- 2026-07-08: Stabilized the remaining full-core blockers and fixed a slash-command failure regression where the main store saved a failed `/compact` draft internally but emitted `lastError` without the restored `composerDraft`, leaving the renderer empty.
- 2026-07-08: Strongest automated lane passed after rebuild: `pnpm --filter @pi-gui/desktop run test:e2e:core` (131/131), including `security-policies.spec.ts`, side-browser coverage, async IPC coverage, and the timeline/composer regression cluster.
- 2026-07-08: Targeted native paste verification could not prove the async clipboard path because `apps/desktop/tests/native/paste.spec.ts` failed before paste on the foreground focus gate in two clean attempts (`BrowserWindow.isFocused()` stayed false).
- 2026-07-20: The foreground focus gate and native async clipboard path both passed on the real Electron surface: `apps/desktop/tests/native/paste.spec.ts` (2/2). The earlier native-proof blocker is resolved.
