# Side Browser Panel Design

## Goal

Add a Codex-style browser panel to the desktop app so web links can open inside the app, beside the active thread, instead of always leaving to the system browser. The panel should feel like the existing VS Code side panel: persistent, resizable, closeable, and useful while the user keeps chatting.

## Non-goals

- Do not bundle a separate Chromium or Chrome binary. Electron already provides Chromium.
- Do not build a full browser replacement with tabs, bookmarks, extensions, downloads, or password management in the first slice.
- Do not remove the existing system-browser fallback.
- Do not route non-HTTP(S) URLs into the panel.

## Recommended approach

Use Electron's `<webview>` tag for the first implementation.

Rationale:

- Regular `iframe` is too limited. Many real sites block embedding with CSP or `X-Frame-Options`.
- `<webview>` can load normal websites in Electron's Chromium engine and supports browser-like navigation events.
- The app already enables `webviewTag: true` in the main window, so this fits the current architecture.
- It can reuse the existing side-panel layout patterns used by the VS Code panel.

A future hardening pass can move to `WebContentsView` if `<webview>` becomes limiting, but that is a larger main-process layout integration.

## User experience

### Opening links

When the user clicks an HTTP(S) link in the app, the app opens the browser side panel and navigates it to that URL.

Primary link sources:

- Markdown links in assistant/user transcript content.
- Terminal hyperlinks handled by the xterm web-links addon.
- Preview/open-browser actions in display mode.
- Auth URLs can remain system-browser first unless explicitly opted into the side browser, because provider auth flows may rely on the user's normal browser.

Each link surface should retain an explicit fallback path: open in system browser.

### Panel layout

The panel appears on the right side of the thread surface, similar to the VS Code panel.

Panel controls:

- URL display/input.
- Back.
- Forward.
- Reload / Stop.
- Open in system browser.
- Close.

The panel should be resizable and should preserve its width using the existing side-panel width pattern.

### Navigation behavior

- Initial empty state says something like: `Click a link to open it here.`
- Clicking a link navigates the existing side browser, not a new app window.
- New-window requests from websites should be intercepted and loaded in the same side browser for HTTP(S) URLs, with external fallback for unsupported schemes.
- The browser should show basic loading/error states.

## Architecture

### Renderer

Add a `BrowserPanel` component under `apps/desktop/src/`.

Responsibilities:

- Render toolbar and `<webview>`.
- Track current URL, title, loading state, and navigation capabilities.
- Expose callbacks for close/open-external/navigation controls.
- Attach webview event listeners for `did-start-loading`, `did-stop-loading`, `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `did-fail-load`, and `new-window`/equivalent Electron webview events.

Add app-level state in `App.tsx`:

- `sideBrowserOpen: boolean`
- `sideBrowserUrl?: string`
- `sideBrowserWidth: number`

Add a central URL-opening callback:

- `openUrl(url, options?)`
- For HTTP(S), route to side browser by default.
- For unsupported protocols, call existing `api.openExternal(url)`.
- Include a way for controls to force system browser.

### Preload / IPC

Keep renderer privileges narrow.

Existing `openExternal(url)` can remain for fallback. The webview itself loads the URL, so no broad browser IPC is needed for the first slice.

If later using `WebContentsView`, add narrow IPC such as `sideBrowserNavigate`, `sideBrowserBack`, and `sideBrowserSetBounds` owned by main process.

### Main process security

Harden webview behavior:

- Only allow HTTP(S) top-level navigations from app-controlled link clicks.
- Intercept unsupported protocols and route through existing external-open validation.
- Disable Node integration inside the webview.
- Use a named persistent partition only if we intentionally want browser cookies/session to persist.

Recommended first partition:

- Use a persistent side-browser partition so sites like YouTube/GitHub can keep login state.
- Name it app-specific, for example `persist:pi-side-browser`.

This matches the requested workflow: use the side browser as a working browser inside the app.

## Interaction with VS Code panel

The first slice should avoid showing VS Code and browser panels at the same time in the same thread surface unless the current grid already handles multiple right-side panels cleanly.

Recommended behavior:

- Side panel slot can show either VS Code or Browser.
- Opening a browser link switches that slot to Browser.
- Toggling VS Code switches it back to VS Code.
- Width can be shared initially, or split into `vscode:sidePanelWidth` and `browser:sidePanelWidth` later.

This keeps the first slice simpler and avoids squeezing the transcript with multiple side panels.

## Testing

### Unit/static checks

- Desktop typecheck.
- Desktop build.

### Core Electron tests

Add a core Playwright spec that:

1. Starts the desktop app.
2. Creates or loads a thread containing an HTTP link.
3. Clicks the link.
4. Verifies the browser side panel appears.
5. Verifies the webview receives the target URL.
6. Verifies close hides the panel.
7. Verifies `Open in system browser` calls the existing external-open path or test hook.

Use a local HTTP fixture server or a `data:`-free local route when possible. For webview navigation, prefer an HTTP URL so it exercises real Chromium navigation without external network dependency.

### Manual/product check

Run the desktop app and click a real link from the transcript. Confirm the panel loads beside the thread and that the system-browser fallback still works.

## Risks and mitigations

- Some sites may block automation or login inside Electron. Keep `Open in system browser` visible.
- Webview APIs differ slightly across Electron versions. Keep the first slice narrow and test in the actual Electron app.
- A persistent browser partition stores cookies. This is useful, but should be documented and later exposed as a privacy/reset control.
- Auth flows may need special handling. Keep auth URLs external initially unless the user explicitly wants side-browser auth.

## First implementation slice

1. Add `BrowserPanel` with toolbar and webview.
2. Add side-browser state and right-side layout slot in `App.tsx`.
3. Route transcript markdown links and terminal links through the side-browser opener.
4. Keep unsupported URLs and forced fallback on `api.openExternal`.
5. Add core Playwright coverage for click-link-opens-panel.
6. Verify with desktop typecheck, build, targeted core test, and a real Electron dev/manual smoke.
