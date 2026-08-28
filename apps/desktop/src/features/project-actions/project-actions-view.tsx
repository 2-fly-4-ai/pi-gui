import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WorkspaceRecord } from "../../desktop-state";
import type { ProjectActionIcon, ProjectActionRecord, SaveProjectActionInput } from "../../project-actions";
import { SecondarySurface } from "../../secondary-surface";

interface ProjectActionsViewProps {
  readonly api: NonNullable<typeof window.piApp>;
  readonly commandPalette: ReactNode;
  readonly workspaceOptions: readonly WorkspaceRecord[];
  readonly initialWorkspaceId?: string;
  readonly onBack: () => void;
  readonly onActionsChanged: (workspaceId: string, actions: readonly ProjectActionRecord[]) => void;
  readonly onRun: (action: ProjectActionRecord) => void;
}

const EMPTY_FORM = {
  name: "",
  command: "",
  keybinding: "",
  runOnWorktreeCreation: false,
  icon: "play" as ProjectActionIcon,
  previewUrl: "",
  autoOpenPreview: false,
  primary: false,
};

export function ProjectActionsView({ api, commandPalette, workspaceOptions, initialWorkspaceId, onBack, onActionsChanged, onRun }: ProjectActionsViewProps) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId ?? workspaceOptions[0]?.id ?? "");
  const [actions, setActions] = useState<readonly ProjectActionRecord[]>([]);
  const [candidates, setCandidates] = useState<readonly ProjectActionRecord[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string>();
  const [deleteId, setDeleteId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [exportPending, setExportPending] = useState(false);
  const workspace = workspaceOptions.find((candidate) => candidate.id === workspaceId);

  const replaceActions = useCallback((next: readonly ProjectActionRecord[]) => {
    setActions(next);
    onActionsChanged(workspaceId, next);
  }, [onActionsChanged, workspaceId]);

  useEffect(() => {
    let active = true;
    setCandidates([]);
    setError(undefined);
    if (!workspaceId) return () => { active = false; };
    void api.listProjectActions(workspaceId).then((next) => {
      if (active) replaceActions(next);
    }).catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [api, replaceActions, workspaceId]);

  const resetForm = () => {
    setEditingId(undefined);
    setForm(EMPTY_FORM);
  };
  const edit = (action: ProjectActionRecord) => {
    setEditingId(action.id);
    setForm({
      name: action.name,
      command: action.command,
      keybinding: action.keybinding ?? "",
      runOnWorktreeCreation: action.runOnWorktreeCreation,
      icon: action.icon,
      previewUrl: action.previewUrl ?? "",
      autoOpenPreview: action.autoOpenPreview,
      primary: action.primary,
    });
  };
  const reviewCandidate = (action: ProjectActionRecord) => {
    setEditingId(undefined);
    setForm({
      name: action.name,
      command: action.command,
      keybinding: action.keybinding ?? "",
      runOnWorktreeCreation: action.runOnWorktreeCreation,
      icon: action.icon,
      previewUrl: action.previewUrl ?? "",
      autoOpenPreview: action.autoOpenPreview,
      primary: action.primary,
    });
    document.querySelector<HTMLElement>("[data-project-action-editor]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const save = async () => {
    if (!workspaceId || !form.name.trim() || !form.command.trim()) return;
    setError(undefined);
    try {
      const input: SaveProjectActionInput = {
        ...(editingId ? { id: editingId } : {}),
        workspaceId,
        name: form.name,
        command: form.command,
        ...(form.keybinding.trim() ? { keybinding: form.keybinding } : {}),
        runOnWorktreeCreation: form.runOnWorktreeCreation,
        icon: form.icon,
        ...(form.previewUrl.trim() ? { previewUrl: form.previewUrl } : {}),
        autoOpenPreview: form.autoOpenPreview,
        primary: form.primary,
      };
      replaceActions(await api.saveProjectAction(input));
      setMessage(editingId ? "Action updated." : "Action saved and trusted.");
      resetForm();
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= actions.length) return;
    const ordered = [...actions];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    try { replaceActions(await api.reorderProjectActions(workspaceId, ordered.map((action) => action.id))); }
    catch (cause) { setError(errorMessage(cause)); }
  };
  const discover = async () => {
    setError(undefined);
    try {
      const next = await api.discoverProjectActions(workspaceId);
      setCandidates(next);
      setMessage(next.length ? `${next.length} package script(s) found. Review before saving.` : "No package scripts were found.");
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const importRepositoryFile = async () => {
    setError(undefined);
    try {
      const preview = await api.previewProjectActionsImport(workspaceId);
      setCandidates(preview.actions);
      setMessage(`${preview.actions.length} untrusted action(s) read from ${preview.relativePath}. Review each before saving.`);
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const exportSummary = useMemo(() => actions.length === 1 ? "1 saved action" : `${actions.length} saved actions`, [actions.length]);

  return (
    <>
      {commandPalette}
      <SecondarySurface onBack={onBack} testId="project-actions-surface" title="Project actions">
        <div className="surface-toolbar project-actions-toolbar">
          <label className="surface-toolbar__field">
            <span>Workspace</span>
            <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
              {workspaceOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <div className="project-actions-toolbar__buttons">
            <button className="button button--secondary" type="button" onClick={() => void discover()}>Discover scripts</button>
            <button className="button button--secondary" type="button" onClick={() => void importRepositoryFile()}>Import .pi/actions.json</button>
            <button className="button button--secondary" disabled={!actions.length} type="button" onClick={() => setExportPending(true)}>Export</button>
          </div>
        </div>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}
        {message ? <div className="project-actions-notice" role="status">{message}</div> : null}

        <div className="project-actions-layout">
          <section className="project-actions-panel" aria-labelledby="saved-actions-heading">
            <div className="project-actions-panel__header">
              <div><span className="eyebrow">Saved</span><h2 id="saved-actions-heading">Trusted actions</h2></div>
              <span>{exportSummary}</span>
            </div>
            {actions.length ? <div className="project-actions-list">
              {actions.map((action, index) => (
                <article className="project-action-card" key={action.id}>
                  <div className="project-action-card__main">
                    <span className="project-action-card__icon" aria-hidden="true">{iconGlyph(action.icon)}</span>
                    <div><h3>{action.name}{action.primary ? <span className="project-action-card__primary">Primary</span> : null}</h3><code>{action.command}</code></div>
                  </div>
                  <div className="project-action-card__meta">
                    <span>{action.source.replaceAll("-", " ")}</span>
                    {action.previewUrl ? <span>{action.previewUrl}</span> : null}
                    {action.runOnWorktreeCreation ? <span>Runs for new worktrees</span> : null}
                  </div>
                  <div className="project-action-card__buttons">
                    <button type="button" onClick={() => onRun(action)} disabled={workspace?.id !== initialWorkspaceId}>Run</button>
                    <button type="button" onClick={() => edit(action)}>Edit</button>
                    <button type="button" aria-label={`Move ${action.name} up`} disabled={index === 0} onClick={() => void move(index, -1)}>↑</button>
                    <button type="button" aria-label={`Move ${action.name} down`} disabled={index === actions.length - 1} onClick={() => void move(index, 1)}>↓</button>
                    <button className="danger-text" type="button" onClick={() => setDeleteId(action.id)}>Delete</button>
                  </div>
                  {deleteId === action.id ? <div className="project-action-card__confirm" role="alertdialog" aria-label={`Delete ${action.name}`}>
                    <span>Delete this saved action?</span>
                    <button type="button" onClick={() => setDeleteId(undefined)}>Cancel</button>
                    <button className="button--danger" type="button" onClick={() => void api.deleteProjectAction(workspaceId, action.id).then((next) => { replaceActions(next); setDeleteId(undefined); }).catch((cause) => setError(errorMessage(cause)))}>Delete</button>
                  </div> : null}
                </article>
              ))}
            </div> : <div className="project-actions-empty"><h3>No saved actions</h3><p>Discover package scripts or define a command below. Nothing runs until you explicitly save and activate it.</p></div>}
          </section>

          <section className="project-actions-panel" data-project-action-editor aria-labelledby="action-editor-heading">
            <div className="project-actions-panel__header"><div><span className="eyebrow">{editingId ? "Edit" : "Create"}</span><h2 id="action-editor-heading">Action definition</h2></div>{editingId ? <button type="button" onClick={resetForm}>Cancel edit</button> : null}</div>
            <ActionForm form={form} setForm={setForm} />
            <button className="button button--primary" disabled={!form.name.trim() || !form.command.trim()} type="button" onClick={() => void save()}>{editingId ? "Update action" : "Save as trusted action"}</button>
          </section>
        </div>

        {candidates.length ? <section className="project-actions-panel project-actions-candidates" aria-labelledby="candidate-actions-heading">
          <div className="project-actions-panel__header"><div><span className="eyebrow">Read only</span><h2 id="candidate-actions-heading">Review candidates</h2></div><button type="button" onClick={() => setCandidates([])}>Clear</button></div>
          <p>These commands are untrusted previews. Select one to inspect and explicitly save it.</p>
          <div className="project-actions-list">{candidates.map((action) => <article className="project-action-card" key={`${action.source}:${action.id}`}><div className="project-action-card__main"><span className="project-action-card__icon">{iconGlyph(action.icon)}</span><div><h3>{action.name}</h3><code>{action.command}</code></div></div><button type="button" onClick={() => reviewCandidate(action)}>Review and save…</button></article>)}</div>
        </section> : null}

        {exportPending ? <div className="surface-modal-backdrop"><section className="surface-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="export-actions-title"><h2 id="export-actions-title">Export project actions?</h2><p>Previewing the repository file first. Existing <code>.pi/actions.json</code> is never overwritten without this confirmation.</p><ExportConfirmation api={api} workspaceId={workspaceId} onCancel={() => setExportPending(false)} onComplete={(path) => { setExportPending(false); setMessage(`Exported ${path}`); }} onError={setError} /></section></div> : null}
      </SecondarySurface>
    </>
  );
}

function ActionForm({ form, setForm }: { readonly form: typeof EMPTY_FORM; readonly setForm: (form: typeof EMPTY_FORM) => void }) {
  return <div className="project-action-form">
    <label><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
    <label><span>Command</span><textarea value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} /></label>
    <label><span>Keybinding</span><input value={form.keybinding} onChange={(event) => setForm({ ...form, keybinding: event.target.value })} /></label>
    <label><span>Icon</span><select value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value as ProjectActionIcon })}>{["play", "test", "build", "deploy", "preview", "terminal"].map((icon) => <option key={icon}>{icon}</option>)}</select></label>
    <label><span>Preview URL</span><input placeholder="http://localhost:3000" value={form.previewUrl} onChange={(event) => setForm({ ...form, previewUrl: event.target.value })} /></label>
    <label className="project-action-form__check"><input type="checkbox" checked={form.primary} onChange={(event) => setForm({ ...form, primary: event.target.checked })} /><span>Primary action</span></label>
    <label className="project-action-form__check"><input type="checkbox" checked={form.runOnWorktreeCreation} onChange={(event) => setForm({ ...form, runOnWorktreeCreation: event.target.checked })} /><span>Run for newly created worktrees</span></label>
    <label className="project-action-form__check"><input type="checkbox" disabled={!form.previewUrl.trim()} checked={form.autoOpenPreview} onChange={(event) => setForm({ ...form, autoOpenPreview: event.target.checked })} /><span>Open preview after start</span></label>
  </div>;
}

function ExportConfirmation({ api, workspaceId, onCancel, onComplete, onError }: { readonly api: NonNullable<typeof window.piApp>; readonly workspaceId: string; readonly onCancel: () => void; readonly onComplete: (path: string) => void; readonly onError: (error: string) => void }) {
  const [preview, setPreview] = useState<{ relativePath: string; actionCount: number; bytes: number; overwritesExistingFile: boolean }>();
  useEffect(() => {
    let active = true;
    void api.previewProjectActionsExport(workspaceId).then((value) => {
      if (active) setPreview(value);
    }).catch((cause) => {
      if (!active) return;
      onError(errorMessage(cause));
      onCancel();
    });
    return () => { active = false; };
    // The confirmation owns one immutable export preview. Parent callback identities
    // may change while the modal is open and must not restart the filesystem read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, workspaceId]);
  return <>{preview ? <p><strong>{preview.actionCount}</strong> action(s), {preview.bytes.toLocaleString()} bytes → <code>{preview.relativePath}</code>{preview.overwritesExistingFile ? ". This replaces the existing file." : "."}</p> : <p>Loading export preview…</p>}<div className="surface-confirm-dialog__actions"><button type="button" onClick={onCancel}>Cancel</button><button className="button button--primary" disabled={!preview} type="button" onClick={() => void api.exportProjectActions(workspaceId).then(onComplete).catch((cause) => onError(errorMessage(cause)))}>Confirm export</button></div></>;
}

function iconGlyph(icon: ProjectActionIcon): string { return { play: "▶", test: "✓", build: "◆", deploy: "↑", preview: "◉", terminal: ">_" }[icon]; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
