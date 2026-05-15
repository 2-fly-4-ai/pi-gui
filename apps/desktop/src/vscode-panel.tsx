import { useEffect, useState } from "react";
import type { PiDesktopApi } from "./ipc";

interface VSCodePanelProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly folderPath: string;
}

export function VSCodePanel({ api, workspaceId, folderPath }: VSCodePanelProps) {
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
    <aside className="thread-vscode-panel" data-testid="thread-vscode-panel">
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
        <iframe
          className="display-mode-vscode__webview"
          src={`http://localhost:${port}/`}
          title="VS Code"
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="display-mode-vscode__loading">Open a workspace to start VS Code.</div>
      )}
    </aside>
  );
}
