# Side Browser Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex-style side browser panel so HTTP(S) links clicked in desktop threads open beside the conversation instead of only in the system browser.

**Architecture:** Implement a renderer-owned Electron `<webview>` panel for the first slice, reusing the existing VS Code side-panel grid shape. App-level state owns the current browser URL, open/closed state, active right-panel mode, and width; link surfaces call one central `openUrl` callback that routes HTTP(S) URLs to the side browser and falls back to existing `api.openExternal` for unsupported protocols or forced external opens.

**Tech Stack:** Electron `<webview>`, React 19, TypeScript, Electron preload IPC for `openExternal`, Playwright Electron core tests.

---

## File structure

- Create `apps/desktop/src/browser-panel.tsx`
  - One responsibility: render side-browser toolbar and Electron webview, track navigation state, and expose close/open-external controls.
- Create `apps/desktop/src/browser-panel-width.ts`
  - One responsibility: store/clamp the browser panel width. Mirrors `apps/desktop/src/vscode-panel-width.ts` without mixing browser and VS Code storage keys.
- Modify `apps/desktop/src/message-markdown.tsx`
  - Add an optional `onOpenUrl` prop and route markdown anchor clicks through it.
- Modify `apps/desktop/src/timeline-item.tsx`
  - Thread `onOpenUrl` into `MessageMarkdown` call sites for visible transcript messages/thinking/summaries.
- Modify `apps/desktop/src/conversation-timeline.tsx`
  - Thread `onOpenUrl` from `App.tsx` to `TimelineItem` in both virtualized and measured render paths.
- Modify `apps/desktop/src/terminal-panel.tsx`
  - Add `onOpenUrl` prop and use it in the xterm web-links addon instead of calling `api.openExternal` directly.
- Modify `apps/desktop/src/App.tsx`
  - Own side-browser state, route link opens, add side-browser panel layout, and switch the right panel between VS Code and Browser.
- Modify `apps/desktop/src/styles/main.css`
  - Add grid classes and panel styles for `.main--with-browser`, `.thread-browser-*`, and `.browser-panel-*`.
- Create `apps/desktop/tests/core/side-browser-panel.spec.ts`
  - Core Electron test for transcript link click, webview navigation, close, and external fallback button.

## Task 1: Add the browser panel component

**Files:**
- Create: `apps/desktop/src/browser-panel.tsx`

- [ ] **Step 1: Create the component with narrow webview typing**

Create `apps/desktop/src/browser-panel.tsx` with this implementation:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const SIDE_BROWSER_PARTITION = "persist:pi-side-browser";

type BrowserNavigationEvent = Event & { readonly url?: string };
type BrowserTitleEvent = Event & { readonly title?: string };
type BrowserFailLoadEvent = Event & {
  readonly errorCode?: number;
  readonly errorDescription?: string;
  readonly validatedURL?: string;
};
type BrowserNewWindowEvent = Event & {
  readonly url?: string;
  preventDefault(): void;
};

type BrowserWebviewElement = HTMLElement & {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  getURL(): string;
  getTitle(): string;
};

export interface BrowserPanelProps {
  readonly url?: string;
  readonly onNavigate: (url: string) => void;
  readonly onClose: () => void;
  readonly onOpenExternal: (url: string) => void;
  readonly className?: string;
  readonly testId?: string;
  readonly style?: React.CSSProperties;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeTypedUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isHttpUrl(trimmed)) return trimmed;
  const withScheme = `https://${trimmed}`;
  return isHttpUrl(withScheme) ? withScheme : undefined;
}

export function BrowserPanel({
  url,
  onNavigate,
  onClose,
  onOpenExternal,
  className = "browser-panel",
  testId = "browser-panel",
  style,
}: BrowserPanelProps) {
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const [addressValue, setAddressValue] = useState(url ?? "");
  const [currentUrl, setCurrentUrl] = useState(url ?? "");
  const [title, setTitle] = useState("Browser");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    if (!url || url === currentUrl) return;
    setCurrentUrl(url);
    setAddressValue(url);
    setLoadError(undefined);
  }, [currentUrl, url]);

  const refreshNavigationState = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    setCanGoBack(webview.canGoBack());
    setCanGoForward(webview.canGoForward());
    const nextUrl = webview.getURL();
    if (nextUrl) {
      setCurrentUrl(nextUrl);
      setAddressValue(nextUrl);
    }
    const nextTitle = webview.getTitle();
    if (nextTitle) setTitle(nextTitle);
  }, []);

  const setWebviewRef = useCallback((node: HTMLElement | null) => {
    webviewRef.current = node as BrowserWebviewElement | null;
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return undefined;

    const handleStart = () => {
      setLoading(true);
      setLoadError(undefined);
      refreshNavigationState();
    };
    const handleStop = () => {
      setLoading(false);
      refreshNavigationState();
    };
    const handleNavigate = (event: BrowserNavigationEvent) => {
      if (event.url && isHttpUrl(event.url)) {
        setCurrentUrl(event.url);
        setAddressValue(event.url);
        onNavigate(event.url);
      }
      refreshNavigationState();
    };
    const handleTitle = (event: BrowserTitleEvent) => {
      if (event.title) setTitle(event.title);
    };
    const handleFailLoad = (event: BrowserFailLoadEvent) => {
      if (event.errorCode === -3) return;
      setLoading(false);
      setLoadError(event.errorDescription || "The page could not be loaded.");
    };
    const handleNewWindow = (event: BrowserNewWindowEvent) => {
      event.preventDefault();
      if (event.url && isHttpUrl(event.url)) {
        onNavigate(event.url);
      } else if (event.url) {
        onOpenExternal(event.url);
      }
    };

    webview.addEventListener("did-start-loading", handleStart);
    webview.addEventListener("did-stop-loading", handleStop);
    webview.addEventListener("did-navigate", handleNavigate as EventListener);
    webview.addEventListener("did-navigate-in-page", handleNavigate as EventListener);
    webview.addEventListener("page-title-updated", handleTitle as EventListener);
    webview.addEventListener("did-fail-load", handleFailLoad as EventListener);
    webview.addEventListener("new-window", handleNewWindow as EventListener);
    refreshNavigationState();

    return () => {
      webview.removeEventListener("did-start-loading", handleStart);
      webview.removeEventListener("did-stop-loading", handleStop);
      webview.removeEventListener("did-navigate", handleNavigate as EventListener);
      webview.removeEventListener("did-navigate-in-page", handleNavigate as EventListener);
      webview.removeEventListener("page-title-updated", handleTitle as EventListener);
      webview.removeEventListener("did-fail-load", handleFailLoad as EventListener);
      webview.removeEventListener("new-window", handleNewWindow as EventListener);
    };
  }, [onNavigate, onOpenExternal, refreshNavigationState]);

  const webview = webviewRef.current;
  const resolvedTitle = useMemo(() => title || currentUrl || "Browser", [currentUrl, title]);

  const submitAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = normalizeTypedUrl(addressValue);
    if (nextUrl) onNavigate(nextUrl);
  };

  return (
    <aside className={className} data-testid={testId} style={style}>
      <div className="browser-panel__toolbar">
        <button className="icon-button" type="button" aria-label="Back" disabled={!canGoBack} onClick={() => webview?.goBack()}>
          ←
        </button>
        <button className="icon-button" type="button" aria-label="Forward" disabled={!canGoForward} onClick={() => webview?.goForward()}>
          →
        </button>
        <button className="icon-button" type="button" aria-label={loading ? "Stop" : "Reload"} onClick={() => loading ? webview?.stop() : webview?.reload()}>
          {loading ? "×" : "↻"}
        </button>
        <form className="browser-panel__address-form" onSubmit={submitAddress}>
          <input
            aria-label="Browser address"
            className="browser-panel__address"
            value={addressValue}
            placeholder="Enter a URL"
            onChange={(event) => setAddressValue(event.target.value)}
          />
        </form>
        <button
          className="icon-button"
          type="button"
          aria-label="Open in system browser"
          disabled={!currentUrl}
          onClick={() => currentUrl ? onOpenExternal(currentUrl) : undefined}
        >
          ↗
        </button>
        <button className="icon-button" type="button" aria-label="Close browser" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="browser-panel__title" title={resolvedTitle}>{resolvedTitle}</div>
      <div className="browser-panel__body">
        {loadError ? <div className="browser-panel__error">{loadError}</div> : null}
        {currentUrl ? (
          <webview
            ref={setWebviewRef}
            className="browser-panel__webview"
            data-testid="browser-panel-webview"
            src={currentUrl}
            partition={SIDE_BROWSER_PARTITION}
            allowpopups="false"
          />
        ) : (
          <div className="browser-panel__empty">Click a link to open it here.</div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Run typecheck and observe the expected JSX webview type failure**

Run:

```bash
pnpm --dir apps/desktop run typecheck
```

Expected: TypeScript fails because JSX does not know the `webview` intrinsic element. This red result proves the new component path is compiled.

- [ ] **Step 3: Add the JSX webview type declaration**

Create `apps/desktop/src/webview-jsx.d.ts`:

```ts
import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
      };
    }
  }
}
```

- [ ] **Step 4: Run typecheck and verify this slice passes**

Run:

```bash
pnpm --dir apps/desktop run typecheck
```

Expected: `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit` exits 0.

- [ ] **Step 5: Commit the panel skeleton**

Run:

```bash
git add apps/desktop/src/browser-panel.tsx apps/desktop/src/webview-jsx.d.ts
git commit -m "feat(desktop): add side browser panel shell"
```

## Task 2: Add width storage for the browser panel

**Files:**
- Create: `apps/desktop/src/browser-panel-width.ts`

- [ ] **Step 1: Create browser panel width helpers**

Create `apps/desktop/src/browser-panel-width.ts`:

```ts
export const BROWSER_SIDE_PANEL_WIDTH_KEY = "browser:sidePanelWidth";

const DEFAULT_BROWSER_SIDE_PANEL_WIDTH = 560;
const MIN_BROWSER_SIDE_PANEL_WIDTH = 360;
const MAX_BROWSER_SIDE_PANEL_WIDTH_RATIO = 0.72;

export function getDefaultBrowserSidePanelWidth(): number {
  const stored = Number(window.localStorage.getItem(BROWSER_SIDE_PANEL_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_BROWSER_SIDE_PANEL_WIDTH;
}

export function getMinBrowserSidePanelWidth(containerWidth: number): number {
  return Math.min(MIN_BROWSER_SIDE_PANEL_WIDTH, Math.max(280, Math.floor(containerWidth * 0.45)));
}

export function getMaxBrowserSidePanelWidth(containerWidth: number): number {
  return Math.max(getMinBrowserSidePanelWidth(containerWidth), Math.floor(containerWidth * MAX_BROWSER_SIDE_PANEL_WIDTH_RATIO));
}

export function clampBrowserSidePanelWidth(width: number, containerWidth: number): number {
  const min = getMinBrowserSidePanelWidth(containerWidth);
  const max = getMaxBrowserSidePanelWidth(containerWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function storeBrowserSidePanelWidth(width: number): void {
  window.localStorage.setItem(BROWSER_SIDE_PANEL_WIDTH_KEY, String(Math.round(width)));
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --dir apps/desktop run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit width helpers**

Run:

```bash
git add apps/desktop/src/browser-panel-width.ts
git commit -m "feat(desktop): add browser panel width helpers"
```

## Task 3: Route markdown links through an app callback

**Files:**
- Modify: `apps/desktop/src/message-markdown.tsx`
- Modify: `apps/desktop/src/timeline-item.tsx`
- Modify: `apps/desktop/src/conversation-timeline.tsx`

- [ ] **Step 1: Update `MessageMarkdown` to accept `onOpenUrl`**

Replace `apps/desktop/src/message-markdown.tsx` with:

```tsx
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

export interface MessageMarkdownProps {
  readonly text: string;
  readonly onOpenUrl?: (url: string) => void;
}

export const MessageMarkdown = memo(function MessageMarkdown({ text, onOpenUrl }: MessageMarkdownProps) {
  const components = useMemo(() => ({
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const language = className?.replace(/^language-/, "");
      const code = String(children).replace(/\n$/, "");
      if (!className) {
        return <code>{code}</code>;
      }
      return (
        <pre data-language={language}>
          <button
            aria-label="Copy code block"
            className="message__code-copy"
            type="button"
            onClick={() => void navigator.clipboard.writeText(code)}
          >
            Copy
          </button>
          <code className={className}>{code}</code>
        </pre>
      );
    },
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a
        href={href}
        rel="noreferrer"
        target="_blank"
        onClick={(event) => {
          if (!href || !onOpenUrl) return;
          event.preventDefault();
          onOpenUrl(href);
        }}
      >
        {children}
      </a>
    ),
  }), [onOpenUrl]);

  return (
    <div className="message__content">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
```

- [ ] **Step 2: Thread `onOpenUrl` through `TimelineItem`**

In `apps/desktop/src/timeline-item.tsx`, add `onOpenUrl` to `TimelineItem` props and pass it into every `MessageMarkdown` call. The top-level signature should become:

```tsx
export const TimelineItem = memo(function TimelineItem({
  item,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
  onOpenUrl,
}: {
  readonly item: TranscriptMessage;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onOpenUrl?: (url: string) => void;
}) {
```

Update the message/thinking/summary calls so they pass `onOpenUrl`:

```tsx
case "message":
  return <TimelineMessage item={item} onOpenUrl={onOpenUrl} />;
case "thinking":
  return <TimelineThinkingItem item={item} onOpenUrl={onOpenUrl} />;
```

Change helper signatures:

```tsx
function TimelineMessage({ item, onOpenUrl }: { readonly item: SessionTranscriptMessage; readonly onOpenUrl?: (url: string) => void })
function TimelineThinkingItem({ item, onOpenUrl }: { readonly item: Extract<TranscriptMessage, { kind: "thinking" }>; readonly onOpenUrl?: (url: string) => void })
function TimelineCompactionSummary({ item, onOpenUrl }: { readonly item: SessionTranscriptMessage; readonly onOpenUrl?: (url: string) => void })
function TimelineSummaryItem({ item, onOpenUrl }: { readonly item: TimelineSummary; readonly onOpenUrl?: (url: string) => void })
```

Every `MessageMarkdown` call in this file should use this shape:

```tsx
<MessageMarkdown text={item.text} onOpenUrl={onOpenUrl} />
```

- [ ] **Step 3: Thread `onOpenUrl` through `ConversationTimeline`**

In `apps/desktop/src/conversation-timeline.tsx`, add to `ConversationTimelineProps`:

```ts
readonly onOpenUrl?: (url: string) => void;
```

Destructure it in `ConversationTimeline`, pass it to both `TimelineItem` call sites, and include it in memo dependencies/comparison types:

```tsx
<TimelineItem
  item={item}
  expandedToolCallIds={expandedToolCallIds}
  onToggleToolCall={onToggleToolCall}
  onViewFileInDiff={onViewFileInDiff}
  onOpenUrl={onOpenUrl}
/>
```

Add `onOpenUrl` to the `renderItem` dependency array and `MeasuredTimelineItem` props/equality inputs.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --dir apps/desktop run typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit markdown routing**

Run:

```bash
git add apps/desktop/src/message-markdown.tsx apps/desktop/src/timeline-item.tsx apps/desktop/src/conversation-timeline.tsx
git commit -m "feat(desktop): route transcript links through app URL handler"
```

## Task 4: Wire App state, layout, and terminal link routing

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/terminal-panel.tsx`
- Modify: `apps/desktop/src/styles/main.css`

- [ ] **Step 1: Import browser panel helpers in `App.tsx`**

Add imports near existing VS Code imports:

```ts
import { BrowserPanel } from "./browser-panel";
import {
  clampBrowserSidePanelWidth,
  getDefaultBrowserSidePanelWidth,
  getMaxBrowserSidePanelWidth,
  getMinBrowserSidePanelWidth,
  storeBrowserSidePanelWidth,
} from "./browser-panel-width";
```

- [ ] **Step 2: Add app-level state in `App.tsx`**

Near VS Code width state, add:

```tsx
const [sideBrowserOpen, setSideBrowserOpen] = useState(false);
const [sideBrowserUrl, setSideBrowserUrl] = useState<string | undefined>();
const [browserPanelWidth, setBrowserPanelWidth] = useState(() => getDefaultBrowserSidePanelWidth());
const browserPanelWidthRef = useRef(browserPanelWidth);
const setBrowserPanelCssWidth = useCallback((width: number) => {
  mainRef.current?.style.setProperty("--thread-browser-width", `${width}px`);
}, []);
```

Add an effect after the existing VS Code width effect:

```tsx
useEffect(() => {
  browserPanelWidthRef.current = browserPanelWidth;
  setBrowserPanelCssWidth(browserPanelWidth);
}, [browserPanelWidth, setBrowserPanelCssWidth]);
```

- [ ] **Step 3: Add central URL routing**

Add this helper inside `App` after `api` is known and before render branching:

```tsx
const openUrl = useCallback((url: string, options?: { readonly external?: boolean }) => {
  if (!api) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (options?.external || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    void api.openExternal(parsed.toString());
    return;
  }
  setSideBrowserUrl(parsed.toString());
  setSideBrowserOpen(true);
  setVsCodeOpen(false);
}, [api]);
```

- [ ] **Step 4: Add browser resize handlers**

Add handlers near the existing VS Code resize handlers:

```tsx
const getThreadBrowserContainerWidth = useCallback(() => mainRef.current?.getBoundingClientRect().width ?? window.innerWidth, []);
const startThreadBrowserResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
  const startX = event.clientX;
  const startWidth = browserPanelWidthRef.current;
  const containerWidth = getThreadBrowserContainerWidth();
  event.currentTarget.setPointerCapture(event.pointerId);

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const delta = startX - moveEvent.clientX;
    const next = clampBrowserSidePanelWidth(startWidth + delta, containerWidth);
    browserPanelWidthRef.current = next;
    setBrowserPanelCssWidth(next);
  };
  const handlePointerUp = () => {
    setBrowserPanelWidth(browserPanelWidthRef.current);
    storeBrowserSidePanelWidth(browserPanelWidthRef.current);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp, { once: true });
}, [getThreadBrowserContainerWidth, setBrowserPanelCssWidth]);

const handleThreadBrowserResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? 1 : -1;
  const next = clampBrowserSidePanelWidth(
    browserPanelWidthRef.current + direction * 24,
    getThreadBrowserContainerWidth(),
  );
  browserPanelWidthRef.current = next;
  setBrowserPanelWidth(next);
  setBrowserPanelCssWidth(next);
  storeBrowserSidePanelWidth(next);
}, [getThreadBrowserContainerWidth, setBrowserPanelCssWidth]);
```

- [ ] **Step 5: Switch the right panel slot between VS Code and Browser**

In `App.tsx`, define:

```tsx
const showThreadBrowserPanel = snapshot.activeView === "threads" && sideBrowserOpen;
const showThreadVsCodePanel = snapshot.activeView === "threads" && !showThreadBrowserPanel && showPersistentVsCodePanel && threadVsCodeTarget !== null;
```

Keep `showPersistentVsCodePanel` as the broader VS Code condition, but only render the persistent VS Code component when `!showThreadBrowserPanel` for threads.

Update `mainClassName` to include:

```tsx
showThreadBrowserPanel ? "main--with-browser" : "",
```

Pass `openUrl` into `ConversationTimeline`:

```tsx
<ConversationTimeline
  ...
  onOpenUrl={openUrl}
/>
```

Pass `openUrl` into `TerminalPanel`:

```tsx
<TerminalPanel
  ...
  onOpenUrl={openUrl}
/>
```

Render the browser panel after the VS Code panel slot:

```tsx
{showThreadBrowserPanel ? (
  <>
    <div
      className="thread-browser-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="Resize browser panel"
      aria-orientation="vertical"
      aria-valuemin={getMinBrowserSidePanelWidth(getThreadBrowserContainerWidth())}
      aria-valuemax={getMaxBrowserSidePanelWidth(getThreadBrowserContainerWidth())}
      aria-valuenow={browserPanelWidth}
      onKeyDown={handleThreadBrowserResizeKeyDown}
      onPointerDown={startThreadBrowserResize}
    />
    <BrowserPanel
      url={sideBrowserUrl}
      onNavigate={(nextUrl) => setSideBrowserUrl(nextUrl)}
      onClose={() => setSideBrowserOpen(false)}
      onOpenExternal={(nextUrl) => openUrl(nextUrl, { external: true })}
      className="thread-browser-panel"
      testId="thread-browser-panel"
      style={{ "--thread-browser-width": `${browserPanelWidth}px` } as React.CSSProperties}
    />
  </>
) : null}
```

- [ ] **Step 6: Update terminal link routing**

In `apps/desktop/src/terminal-panel.tsx`, add prop:

```ts
readonly onOpenUrl?: (url: string) => void;
```

Destructure `onOpenUrl` and replace the web links addon with:

```tsx
const webLinksAddon = new WebLinksAddon((_event, uri) => {
  if (onOpenUrl) {
    onOpenUrl(uri);
    return;
  }
  void api.openExternal(uri);
});
```

Include `onOpenUrl` in the terminal setup effect dependency array.

- [ ] **Step 7: Add CSS for the thread browser panel**

Append near the VS Code panel CSS in `apps/desktop/src/styles/main.css`:

```css
.main--with-browser {
  grid-template-columns: minmax(0, 1fr) 5px var(--thread-browser-width, 560px);
}

.main--with-diff.main--with-browser {
  grid-template-columns: minmax(0, 1fr) 400px 5px var(--thread-browser-width, 560px);
}

.main--with-browser > .topbar,
.main--with-browser > .composer {
  grid-column: 1;
}

.main--with-browser > .thread-browser-resize-handle {
  grid-column: 2;
  grid-row: 2 / -1;
}

.main--with-browser > .thread-browser-panel {
  grid-column: 3;
  grid-row: 2 / -1;
}

.main--with-diff.main--with-browser > .thread-browser-resize-handle {
  grid-column: 3;
}

.main--with-diff.main--with-browser > .thread-browser-panel {
  grid-column: 4;
}

.thread-browser-resize-handle {
  cursor: col-resize;
  background: transparent;
}

.thread-browser-resize-handle:hover {
  background: color-mix(in srgb, var(--accent, #7c3aed) 25%, transparent);
}

.thread-browser-panel,
.browser-panel {
  position: relative;
  min-width: 0;
  height: 100%;
  border-left: 1px solid var(--border-subtle, #333);
  background: var(--panel-background, #0f1117);
  color: var(--text-primary, #f2f4f8);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.browser-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle, #333);
}

.browser-panel__address-form {
  flex: 1;
  min-width: 0;
}

.browser-panel__address {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border-subtle, #333);
  border-radius: 999px;
  background: var(--input-background, #161b22);
  color: inherit;
  padding: 6px 10px;
  font: inherit;
}

.browser-panel__title {
  padding: 5px 10px;
  color: var(--text-muted, #9aa4b2);
  border-bottom: 1px solid var(--border-subtle, #333);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-panel__body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.browser-panel__webview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.browser-panel__empty,
.browser-panel__error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--text-muted, #9aa4b2);
}

.browser-panel__error {
  color: var(--danger, #f85149);
}
```

- [ ] **Step 8: Run typecheck and development build**

Run:

```bash
pnpm --dir apps/desktop run typecheck
pnpm --dir apps/desktop exec electron-vite build --mode development
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit app wiring**

Run:

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/terminal-panel.tsx apps/desktop/src/styles/main.css
git commit -m "feat(desktop): wire side browser panel into thread layout"
```

## Task 5: Add core Playwright coverage

**Files:**
- Create: `apps/desktop/tests/core/side-browser-panel.spec.ts`

- [ ] **Step 1: Add the side browser core spec**

Create `apps/desktop/tests/core/side-browser-panel.spec.ts`:

```ts
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

async function startFixtureServer(): Promise<{ readonly server: Server; readonly url: string }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<html><head><title>Side Browser Fixture</title></head><body><h1>Loaded ${request.url}</h1></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/target` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("opens transcript links in the side browser panel", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("side-browser-workspace");
  const fixture = await startFixtureServer();
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Side browser links");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => `Open [fixture link](${fixture.url}) in the side panel.`,
    });

    await window.getByRole("link", { name: "fixture link" }).click();

    const panel = window.getByTestId("thread-browser-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("Browser address")).toHaveValue(fixture.url);
    await expect(panel.getByTestId("browser-panel-webview")).toHaveAttribute("src", fixture.url);

    await panel.getByRole("button", { name: "Close browser" }).click();
    await expect(window.getByTestId("thread-browser-panel")).toHaveCount(0);
  } finally {
    await harness.close();
    await closeServer(fixture.server);
  }
});
```

- [ ] **Step 2: Run the targeted spec and verify it fails before Task 4 if running independently**

Run:

```bash
pnpm --dir apps/desktop run test:e2e:runner -- apps/desktop/tests/core/side-browser-panel.spec.ts
```

Expected before Task 4: fails because the browser panel does not exist. Expected after Task 4: passes.

- [ ] **Step 3: Run the targeted spec after implementation**

Run:

```bash
pnpm --dir apps/desktop run test:e2e:runner -- apps/desktop/tests/core/side-browser-panel.spec.ts
```

Expected: 1 test passes.

- [ ] **Step 4: Commit the test**

Run:

```bash
git add apps/desktop/tests/core/side-browser-panel.spec.ts
git commit -m "test(desktop): cover side browser link routing"
```

## Task 6: Verify the desktop surface

**Files:**
- No source files changed in this task.

- [ ] **Step 1: Run static verification**

Run:

```bash
pnpm --dir apps/desktop run typecheck
pnpm --dir apps/desktop exec electron-vite build --mode development
```

Expected: both commands exit 0.

- [ ] **Step 2: Run targeted browser panel coverage**

Run:

```bash
pnpm --dir apps/desktop run test:e2e:runner -- apps/desktop/tests/core/side-browser-panel.spec.ts
```

Expected: 1 test passes and verifies link click opens `thread-browser-panel` with a webview pointed at the fixture URL.

- [ ] **Step 3: Run adjacent side-panel regression coverage**

Run:

```bash
pnpm --dir apps/desktop run test:core:runtime-jobs
pnpm --dir apps/desktop run test:core:display-mode
```

Expected: both scripts pass. This verifies the existing runtime-job UI and VS Code side-panel/display-mode lane still work after adding a second right-panel mode.

- [ ] **Step 4: Run the owning core lane before closing**

Run:

```bash
pnpm --dir apps/desktop run test:e2e:core
```

Expected: core lane passes. If this is blocked by local runtime constraints, capture the exact failure and keep the targeted commands above as the minimum proof.

- [ ] **Step 5: Manual Electron smoke**

Run:

```bash
pnpm --dir apps/desktop run dev
```

In the launched Electron app:

1. Open a workspace.
2. Open a thread with a visible HTTP(S) markdown link.
3. Click the link.
4. Confirm the browser panel opens on the right.
5. Confirm Back, Forward, Reload, Close, and Open in system browser controls are visible.
6. Close the panel and confirm the transcript returns to normal width.

- [ ] **Step 6: Final commit if verification-only adjustments were needed**

If verification found small fixes, commit them separately:

```bash
git add apps/desktop/src apps/desktop/tests/core/side-browser-panel.spec.ts
git commit -m "fix(desktop): stabilize side browser panel"
```

If no verification-only fixes were needed, do not create an empty commit.

## Self-review

- Spec coverage: The plan creates a `<webview>` browser panel, routes transcript and terminal HTTP(S) links into it, keeps system-browser fallback, uses a persistent partition, adds a resizable right-side panel, and verifies the Electron surface.
- Scope: The plan intentionally implements only the thread-surface browser side panel. Display-mode preview buttons and auth URLs remain on existing external behavior for this first slice except where `openUrl` is explicitly wired.
- Type consistency: The plan uses `onOpenUrl` consistently across `MessageMarkdown`, `TimelineItem`, `ConversationTimeline`, `TerminalPanel`, and `App.tsx`. Browser state names are consistently `sideBrowserOpen`, `sideBrowserUrl`, and `browserPanelWidth`.
- Placeholder scan: No unresolved placeholders are present.
