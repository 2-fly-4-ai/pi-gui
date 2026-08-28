import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { PiDesktopApi } from "./ipc";
import { VSCODE_WEBVIEW_PARTITION } from "./vscode-constants";

export { VSCODE_WEBVIEW_PARTITION } from "./vscode-constants";

interface VSCodePanelProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly folderPath: string;
  readonly className?: string;
  readonly testId?: string;
  readonly style?: CSSProperties;
}

interface ResolvedVSCodeServer {
  readonly port: number;
  readonly workspaceId: string;
  readonly folderPath: string;
}

type VSCodeWebviewElement = HTMLElement & {
  reload(): void;
};

type WebviewFailLoadEvent = Event & {
  readonly errorCode?: number;
  readonly errorDescription?: string;
};

type WebviewRenderProcessGoneEvent = Event & {
  readonly reason?: string;
};

export function VSCodePanel({
  api,
  workspaceId,
  folderPath,
  className = "thread-vscode-panel",
  testId = "thread-vscode-panel",
  style,
}: VSCodePanelProps) {
  const [resolvedServer, setResolvedServer] = useState<ResolvedVSCodeServer | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const webviewRef = useRef<VSCodeWebviewElement | null>(null);
  const paletteIdRef = useRef(document.documentElement.dataset.paletteId);

  useLayoutEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFrameLoaded(false);
    setError(null);
    setResolvedServer(null);

    void api.ensureVSCodeServer(workspaceId)
      .then((nextPort) => {
        if (!cancelled) {
          setResolvedServer({ port: nextPort, workspaceId, folderPath });
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, folderPath, reloadNonce]);

  useEffect(() => () => {
    void api.killVSCodeServer(workspaceId).catch(() => undefined);
  }, [api, workspaceId]);

  useEffect(() => {
    const reloadForPalette = (event: Event) => {
      const themeId = (event as CustomEvent<{ readonly themeId?: string }>).detail?.themeId;
      if (!themeId || paletteIdRef.current === themeId) return;
      paletteIdRef.current = themeId;
      setFrameLoaded(false);
      webviewRef.current?.reload();
    };
    window.addEventListener("pi-gui:theme-palette-changed", reloadForPalette);
    return () => window.removeEventListener("pi-gui:theme-palette-changed", reloadForPalette);
  }, []);

  const resolvedServerMatchesTarget =
    resolvedServer?.workspaceId === workspaceId && resolvedServer.folderPath === folderPath;
  const iframePort = resolvedServerMatchesTarget ? resolvedServer.port : null;
  const hasStaleResolvedServer = resolvedServer !== null && !resolvedServerMatchesTarget;
  const setWebviewRef = useCallback((node: HTMLElement | null) => {
    webviewRef.current = node as VSCodeWebviewElement | null;
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || iframePort === null) {
      return undefined;
    }

    const handleStart = () => {
      setFrameLoaded(false);
    };
    const handleStop = () => {
      setFrameLoaded(true);
    };
    const handleFailLoad = (event: WebviewFailLoadEvent) => {
      if (event.errorCode === -3) return;
      setFrameLoaded(false);
      setError(event.errorDescription || "The VS Code workspace could not be loaded.");
    };
    const handleRenderProcessGone = (event: WebviewRenderProcessGoneEvent) => {
      setFrameLoaded(false);
      setError(
        `VS Code stopped unexpectedly${event.reason ? ` (${event.reason})` : ""}. The chat is still safe; reopen the editor to retry.`,
      );
    };

    webview.addEventListener("did-start-loading", handleStart);
    webview.addEventListener("did-stop-loading", handleStop);
    webview.addEventListener("did-fail-load", handleFailLoad as EventListener);
    webview.addEventListener("render-process-gone", handleRenderProcessGone as EventListener);
    return () => {
      webview.removeEventListener("did-start-loading", handleStart);
      webview.removeEventListener("did-stop-loading", handleStop);
      webview.removeEventListener("did-fail-load", handleFailLoad as EventListener);
      webview.removeEventListener("render-process-gone", handleRenderProcessGone as EventListener);
    };
  }, [iframePort, reloadNonce]);

  const retry = () => {
    setError(null);
    setFrameLoaded(false);
    setReloadNonce((current) => current + 1);
  };

  return (
    <aside
      className={className}
      data-testid={testId}
      data-vscode-workspace-id={workspaceId}
      data-vscode-folder-path={folderPath}
      data-vscode-port={iframePort ?? undefined}
      style={style}
    >
      <div className="vscode-panel__body">
        {loading ? (
          <div className="display-mode-vscode__loading">
            <span className="display-mode-vscode__spinner" aria-hidden="true" />
            Starting VS Code…
          </div>
        ) : error ? (
          <div className="display-mode-vscode__error">
            <strong>Could not start VS Code</strong>
            <p>{error}</p>
            <button className="button button--secondary button--small" type="button" onClick={retry}>
              Retry
            </button>
          </div>
        ) : hasStaleResolvedServer ? (
          <div className="display-mode-vscode__loading">
            <span className="display-mode-vscode__spinner" aria-hidden="true" />
            Starting VS Code…
          </div>
        ) : iframePort !== null ? (
          <>
            {!frameLoaded ? (
              <div className="display-mode-vscode__loading">
                <span className="display-mode-vscode__spinner" aria-hidden="true" />
                Loading VS Code…
              </div>
            ) : null}
            <webview
              key={`${workspaceId}:${iframePort}:${reloadNonce}`}
              ref={setWebviewRef}
              className="display-mode-vscode__webview"
              src={`http://localhost:${iframePort}/`}
              title="VS Code"
              partition={VSCODE_WEBVIEW_PARTITION}
              style={frameLoaded ? undefined : { opacity: 0 }}
            />
          </>
        ) : (
          <div className="display-mode-vscode__loading">Open a workspace to start VS Code.</div>
        )}
      </div>
    </aside>
  );
}
