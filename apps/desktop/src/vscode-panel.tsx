import { useEffect, useState } from "react";
import type { PiDesktopApi } from "./ipc";

interface VSCodePanelProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly folderPath: string;
  readonly className?: string;
  readonly testId?: string;
  readonly title?: string;
  readonly onHardClose?: () => void;
}

export function VSCodePanel({
  api,
  workspaceId,
  folderPath,
  className = "thread-vscode-panel",
  testId = "thread-vscode-panel",
  title = "VS Code",
  onHardClose,
}: VSCodePanelProps) {
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFrameLoaded(false);
    setError(null);
    setPort(null);

    void api.ensureVSCodeServer(workspaceId, folderPath)
      .then((nextPort) => {
        if (!cancelled) {
          setPort(nextPort);
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
  }, [api, workspaceId, folderPath]);

  return (
    <aside className={className} data-testid={testId}>
      {onHardClose ? (
        <div className="vscode-panel__header">
          <div className="vscode-panel__title">{title}</div>
          <button
            type="button"
            className="button button--ghost vscode-panel__hard-close"
            onClick={onHardClose}
          >
            Hard close
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="display-mode-vscode__loading">
          <span className="display-mode-vscode__spinner" aria-hidden="true" />
          Starting VS Code…
        </div>
      ) : error ? (
        <div className="display-mode-vscode__error">
          <strong>Could not start VS Code</strong>
          <p>{error}</p>
        </div>
      ) : port !== null ? (
        <>
          {!frameLoaded ? (
            <div className="display-mode-vscode__loading">
              <span className="display-mode-vscode__spinner" aria-hidden="true" />
              Loading VS Code…
            </div>
          ) : null}
          <iframe
            className="display-mode-vscode__webview"
            src={`http://localhost:${port}/`}
            title="VS Code"
            allow="clipboard-read; clipboard-write"
            style={frameLoaded ? undefined : { opacity: 0 }}
            onLoad={() => setFrameLoaded(true)}
          />
        </>
      ) : (
        <div className="display-mode-vscode__loading">Open a workspace to start VS Code.</div>
      )}
    </aside>
  );
}
