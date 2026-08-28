import { useMemo, useState, type ReactNode } from "react";
import type { DesktopAppState, WorkspaceSessionTarget } from "../../desktop-state";
import type { PromptShelfEntrySummary, PromptShelfRestorePreview } from "../../prompt-shelf-types";
import { SecondarySurface } from "../../secondary-surface";

interface PromptShelfViewProps {
  readonly commandPalette: ReactNode;
  readonly entries: readonly PromptShelfEntrySummary[];
  readonly error?: string;
  readonly notice?: string;
  readonly snapshot: DesktopAppState;
  readonly selectedTarget?: WorkspaceSessionTarget;
  readonly onBack: () => void;
  readonly onDelete: (entryId: string) => Promise<void> | void;
  readonly onPreviewRestore: (entryId: string) => Promise<PromptShelfRestorePreview>;
  readonly onRename: (entryId: string, label: string) => Promise<void> | void;
  readonly onReorder: (orderedIds: readonly string[]) => Promise<void> | void;
  readonly onRestore: (preview: PromptShelfRestorePreview, target: WorkspaceSessionTarget, mode: "copy" | "move") => Promise<boolean>;
}

export function PromptShelfView({ commandPalette, entries, error, notice, snapshot, selectedTarget, onBack, onDelete, onPreviewRestore, onRename, onReorder, onRestore }: PromptShelfViewProps) {
  const [deleteId, setDeleteId] = useState<string>();
  const [renameId, setRenameId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [preview, setPreview] = useState<PromptShelfRestorePreview>();
  const [previewError, setPreviewError] = useState<string>();
  const [destination, setDestination] = useState(() => selectedTarget ? targetKey(selectedTarget) : "");
  const taskOptions = useMemo(() => snapshot.workspaces.flatMap((workspace) => workspace.sessions.filter((session) => !session.archivedAt).map((session) => ({ key: targetKey({ workspaceId: workspace.id, sessionId: session.id }), label: `${workspace.name} / ${session.title}`, target: { workspaceId: workspace.id, sessionId: session.id } }))), [snapshot.workspaces]);
  const destinationTarget = taskOptions.find((option) => option.key === destination)?.target;

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const ordered = [...entries];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    void onReorder(ordered.map((entry) => entry.id));
  };
  const openRestore = async (entryId: string) => {
    setPreviewError(undefined);
    try { setPreview(await onPreviewRestore(entryId)); }
    catch (cause) { setPreviewError(errorMessage(cause)); }
  };

  return <>
    {commandPalette}
    <SecondarySurface onBack={onBack} testId="prompt-shelf-surface" title="Prompt Shelf">
      <div className="prompt-shelf-intro"><div><span className="eyebrow">Provider neutral</span><h2>Put a prompt aside without losing it</h2><p>The Shelf stores text and safe attachment snapshots only. It never changes a task’s model, provider, access, execution boundary, branch, or workspace.</p></div><span className="prompt-shelf-count">{entries.length} / 20</span></div>
      {error || previewError ? <div className="inline-error" role="alert">{error ?? previewError}</div> : null}
      {notice ? <div className="project-actions-notice" role="status">{notice}</div> : null}
      {entries.length ? <div className="prompt-shelf-list">
        {entries.map((entry, index) => <article className="prompt-shelf-card" key={entry.id}>
          <div className="prompt-shelf-card__top"><div><span>{entry.label || "Untitled prompt"}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div><span>{entry.attachmentCount ? `${entry.attachmentCount} attachment(s)` : "Text only"}</span></div>
          <p>{entry.preview}</p>
          {renameId === entry.id ? <form className="prompt-shelf-card__rename" onSubmit={(event) => { event.preventDefault(); void onRename(entry.id, renameValue); setRenameId(undefined); }}><label><span className="sr-only">Prompt label</span><input autoFocus maxLength={120} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label><button type="submit">Save</button><button type="button" onClick={() => setRenameId(undefined)}>Cancel</button></form> : null}
          <div className="prompt-shelf-card__actions">
            <button className="button button--primary" type="button" onClick={() => void openRestore(entry.id)}>Restore…</button>
            <button type="button" onClick={() => { setRenameId(entry.id); setRenameValue(entry.label ?? ""); }}>Rename</button>
            <button aria-label={`Move ${entry.label || "prompt"} up`} disabled={index === 0} type="button" onClick={() => move(index, -1)}>↑</button>
            <button aria-label={`Move ${entry.label || "prompt"} down`} disabled={index === entries.length - 1} type="button" onClick={() => move(index, 1)}>↓</button>
            <button className="danger-text" type="button" onClick={() => setDeleteId(entry.id)}>Delete</button>
          </div>
          {deleteId === entry.id ? <div className="project-action-card__confirm" role="alertdialog" aria-label="Delete stashed prompt"><span>Delete this prompt and its stored attachments?</span><button type="button" onClick={() => setDeleteId(undefined)}>Cancel</button><button className="button--danger" type="button" onClick={() => { void onDelete(entry.id); setDeleteId(undefined); }}>Delete</button></div> : null}
        </article>)}
      </div> : <div className="project-actions-empty"><h3>The Shelf is empty</h3><p>Use “Stash prompt” from a task composer or the command palette. The composer is cleared only after the Shelf write succeeds.</p></div>}

      {preview ? <div className="surface-modal-backdrop"><section className="surface-confirm-dialog prompt-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-prompt-title"><span className="eyebrow">Restore preview</span><h2 id="restore-prompt-title">Choose an explicit destination</h2><p className="prompt-restore-dialog__preview">{preview.text || "Attachment-only prompt"}</p><dl><div><dt>Attachments</dt><dd>{preview.attachments.length}</dd></div><div><dt>Missing or expired</dt><dd>{preview.missingAttachments.length ? preview.missingAttachments.join(", ") : "None"}</dd></div></dl><label><span>Workspace / task</span><select value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Choose a task…</option>{taskOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><p>Copy keeps this Shelf entry. Move removes it only after the destination draft and available attachments are durably updated.</p><div className="surface-confirm-dialog__actions"><button type="button" onClick={() => setPreview(undefined)}>Cancel</button><button disabled={!destinationTarget} type="button" onClick={() => destinationTarget && void onRestore(preview, destinationTarget, "copy").then((ok) => { if (ok) setPreview(undefined); })}>Copy into task</button><button className="button button--primary" disabled={!destinationTarget} type="button" onClick={() => destinationTarget && void onRestore(preview, destinationTarget, "move").then((ok) => { if (ok) setPreview(undefined); })}>Move into task</button></div></section></div> : null}
    </SecondarySurface>
  </>;
}

function targetKey(target: WorkspaceSessionTarget): string { return `${target.workspaceId}\u0000${target.sessionId}`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
