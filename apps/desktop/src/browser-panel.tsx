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
    try {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      const nextUrl = webview.getURL();
      if (nextUrl) {
        setCurrentUrl(nextUrl);
        setAddressValue(nextUrl);
      }
      const nextTitle = webview.getTitle();
      if (nextTitle) setTitle(nextTitle);
    } catch {
      setCanGoBack(false);
      setCanGoForward(false);
    }
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
  const runWebviewCommand = (command: "goBack" | "goForward" | "reload" | "stop") => {
    try {
      webview?.[command]();
    } catch {
      refreshNavigationState();
    }
  };
  const resolvedTitle = useMemo(() => title || currentUrl || "Browser", [currentUrl, title]);

  const submitAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = normalizeTypedUrl(addressValue);
    if (nextUrl) onNavigate(nextUrl);
  };

  return (
    <aside className={className} data-testid={testId} style={style}>
      <div className="browser-panel__toolbar">
        <button className="icon-button" type="button" aria-label="Back" disabled={!canGoBack} onClick={() => runWebviewCommand("goBack")}>
          ←
        </button>
        <button className="icon-button" type="button" aria-label="Forward" disabled={!canGoForward} onClick={() => runWebviewCommand("goForward")}>
          →
        </button>
        <button className="icon-button" type="button" aria-label={loading ? "Stop" : "Reload"} onClick={() => runWebviewCommand(loading ? "stop" : "reload")}>
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
          onClick={() => (currentUrl ? onOpenExternal(currentUrl) : undefined)}
        >
          ↗
        </button>
        <button className="icon-button" type="button" aria-label="Close browser" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="browser-panel__title" title={resolvedTitle}>
        {resolvedTitle}
      </div>
      <div className="browser-panel__body">
        {loadError ? <div className="browser-panel__error">{loadError}</div> : null}
        {currentUrl ? (
          <webview
            ref={setWebviewRef}
            className="browser-panel__webview"
            data-testid="browser-panel-webview"
            src={currentUrl}
            partition={SIDE_BROWSER_PARTITION}
            allowpopups={false}
          />
        ) : (
          <div className="browser-panel__empty">Click a link to open it here.</div>
        )}
      </div>
    </aside>
  );
}
