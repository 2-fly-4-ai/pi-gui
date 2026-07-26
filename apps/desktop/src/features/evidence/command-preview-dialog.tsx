import type { CommandPreview } from "../../product-experience/command-preview";

export function CommandPreviewDialog({
  preview,
  onCancel,
  onConfirm,
}: {
  readonly preview: CommandPreview;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="command-preview-backdrop">
      <section
        aria-label="Command preview"
        className="command-preview-dialog"
        data-testid="command-preview-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>{preview.originLabel}</span>
            <strong>Review {preview.risk} command</strong>
          </div>
          <span className={`command-preview-dialog__risk command-preview-dialog__risk--${preview.risk}`}>
            {preview.risk}
          </span>
        </header>
        <div className="command-preview-dialog__field">
          <span>Exact command</span>
          <pre>{preview.displayCommand}</pre>
        </div>
        <div className="command-preview-dialog__field">
          <span>Working directory</span>
          <code>{preview.cwd}</code>
        </div>
        <div className="command-preview-dialog__field">
          <span>Environment</span>
          {preview.environment.length > 0 ? (
            <ul>
              {preview.environment.map((entry) => (
                <li key={entry.name}><code>{entry.name}={entry.value}</code></li>
              ))}
            </ul>
          ) : (
            <p>No inline environment overrides detected.</p>
          )}
        </div>
        <p className="command-preview-dialog__notice">
          Secret-like values are redacted in this preview and in evidence records.
          Agent-proposed commands are identified in the tool timeline; commands typed directly into the terminal remain user-entered.
        </p>
        <footer>
          <button type="button" onClick={onCancel}>Deny</button>
          <button type="button" onClick={onConfirm}>Run once</button>
        </footer>
      </section>
    </div>
  );
}
