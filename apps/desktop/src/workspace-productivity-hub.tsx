import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionRecord, WorktreeRecord, WorkspaceRecord } from "./desktop-state";
import type { ProjectActionRecord } from "./project-actions";
import { activeDecisions } from "./product-experience/project-knowledge";
import {
  buildWorkspaceHandoff,
  deriveWorktreeLifecycle,
  indexWorkspaceArtifacts,
  normalizeShortcut,
  readWorkspaceShortcuts,
  saveWorkspaceShortcuts,
  validateWorkspaceShortcut,
  type WorkspaceArtifactReference,
  type WorkspaceShortcutAssignment,
} from "./product-experience/workspace-productivity";
import type { TaskEvidenceRecord } from "./product-experience/task-evidence";
import type { SubagentRunRecord } from "./subagent-workflows";
import { LoadingState } from "./loading-state";

type HubTab = "artifacts" | "worktree" | "handoff" | "shortcuts";

export function WorkspaceProductivityHub({
  workspace,
  session,
  worktree,
  projectActions,
  onClose,
  onOpenFile,
  onAttachFile,
  onOpenChanges,
  onOpenBranches,
}: {
  readonly workspace: WorkspaceRecord;
  readonly session: SessionRecord | undefined;
  readonly worktree: WorktreeRecord | undefined;
  readonly projectActions: readonly ProjectActionRecord[];
  readonly onClose: () => void;
  readonly onOpenFile: (path: string) => void;
  readonly onAttachFile: (path: string) => void;
  readonly onOpenChanges: () => void;
  readonly onOpenBranches: () => void;
}) {
  const [tab, setTab] = useState<HubTab>("artifacts");
  const [workspacePaths, setWorkspacePaths] = useState<readonly string[]>([]);
  const [changedPaths, setChangedPaths] = useState<readonly string[]>([]);
  const [evidence, setEvidence] = useState<readonly TaskEvidenceRecord[]>([]);
  const [subagentRuns, setSubagentRuns] = useState<readonly SubagentRunRecord[]>([]);
  const [includedArtifactIds, setIncludedArtifactIds] = useState<ReadonlySet<string>>(new Set());
  const [includedDecisionIds, setIncludedDecisionIds] = useState<ReadonlySet<string>>(new Set());
  const [narrative, setNarrative] = useState("");
  const [notice, setNotice] = useState("");
  const [manualArtifactPath, setManualArtifactPath] = useState("");
  const [manualArtifacts, setManualArtifacts] = useState<readonly WorkspaceArtifactReference[]>([]);
  const [shortcuts, setShortcuts] = useState<readonly WorkspaceShortcutAssignment[]>(() => readWorkspaceShortcuts(workspace.id));
  const [shortcutCommandId, setShortcutCommandId] = useState("toggle-changes");
  const [shortcutKeys, setShortcutKeys] = useState("");
  const [loadNonce, setLoadNonce] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "error" | "populated">("loading");
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    void Promise.all([
      window.piApp?.listWorkspaceFiles(workspace.id) ?? Promise.resolve([]),
      window.piApp?.getChangedFiles(workspace.id) ?? Promise.resolve([]),
      window.piApp?.listTaskEvidence({ workspaceId: workspace.id, limit: 2_000 }) ?? Promise.resolve({ records: [] }),
      window.piApp?.listSubagentRuns(workspace.id) ?? Promise.resolve([]),
    ]).then(([paths, changed, evidencePage, runs]) => {
      if (!active) return;
      setWorkspacePaths(paths);
      setChangedPaths(changed.map((entry) => entry.path));
      setEvidence(evidencePage.records);
      setSubagentRuns(runs);
      setLoadState("populated");
    }).catch(() => {
      if (active) setLoadState("error");
    });
    return () => {
      active = false;
    };
  }, [loadNonce, workspace.id]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape, true);
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    setShortcuts(readWorkspaceShortcuts(workspace.id));
  }, [workspace.id]);

  const artifacts = useMemo(() => [
    ...indexWorkspaceArtifacts({ workspacePaths, evidence, subagentRuns }),
    ...manualArtifacts,
  ], [evidence, manualArtifacts, subagentRuns, workspacePaths]);
  const artifactGroups = useMemo(() => {
    const groups = new Map<string, WorkspaceArtifactReference[]>();
    for (const artifact of artifacts) {
      const owner = artifact.runId
        ? `Run ${artifact.runId}`
        : artifact.sessionId
          ? `Thread ${artifact.sessionId}`
          : "Workspace";
      const key = `${owner} · ${artifact.type}`;
      groups.set(key, [...(groups.get(key) ?? []), artifact]);
    }
    return [...groups.entries()];
  }, [artifacts]);
  const decisions = activeDecisions({
    workspaceId: workspace.id,
    ...(session ? { sessionId: session.id } : {}),
  });
  const runningTaskCount = workspace.sessions.filter((candidate) => candidate.status === "running").length;
  const lifecycle = deriveWorktreeLifecycle(workspace, worktree, changedPaths.length, runningTaskCount);
  const handoff = useMemo(() => buildWorkspaceHandoff({
    workspace,
    decisions: decisions.filter((decision) => includedDecisionIds.has(decision.id)),
    changedPaths,
    evidence,
    artifacts,
    includedArtifactIds,
    narrative,
  }), [artifacts, changedPaths, decisions, evidence, includedArtifactIds, includedDecisionIds, narrative, workspace]);
  const shortcutTargets = [
    { id: "toggle-changes", label: "Toggle Changes", significant: false },
    { id: "open-settings", label: "Open Settings", significant: false },
    { id: "open-workspace-hub", label: "Open workspace hub", significant: false },
    ...projectActions.map((action) => ({
      id: `project-action:${action.id}`,
      label: action.name,
      significant: true,
    })),
  ];

  const saveHandoff = async (attach: boolean) => {
    const path = await window.piApp?.saveWorkspaceHandoff(workspace.id, handoff);
    if (!path) return;
    setNotice(`Saved ${path}`);
    if (attach) onAttachFile(path);
  };

  return (
    <div className="workspace-hub-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        aria-label="Workspace hub"
        aria-modal="true"
        className="workspace-hub"
        role="dialog"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
          ) ?? []);
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Workspace hub</span>
            <h1>{workspace.name}</h1>
          </div>
          <button className="button button--secondary" type="button" onClick={onClose}>Close</button>
        </header>
        <nav aria-label="Workspace hub sections">
          {(["artifacts", "worktree", "handoff", "shortcuts"] as const).map((id) => (
            <button aria-current={tab === id ? "page" : undefined} key={id} type="button" onClick={() => setTab(id)}>
              {id[0]?.toUpperCase()}{id.slice(1)}
            </button>
          ))}
        </nav>

        {tab === "artifacts" ? (
          <div className="workspace-hub__content" data-testid="artifact-shelf">
            <div className="workspace-hub__section-heading">
              <div><h2>Artifact shelf</h2><p>References only—nothing is copied or committed automatically.</p></div>
              <form onSubmit={(event) => {
                event.preventDefault();
                const path = manualArtifactPath.trim().replace(/^\.\/+/, "");
                if (!path) return;
                const available = workspacePaths.includes(path);
                setManualArtifacts((current) => [...current.filter((artifact) => artifact.path !== path), {
                  id: `artifact:manual:${path}`,
                  path,
                  type: "file",
                  source: "workspace",
                  state: available ? "available" : "missing",
                  sensitivity: /(?:secret|private|\.env|\.log$)/i.test(path) ? "private" : "normal",
                }]);
                setManualArtifactPath("");
              }}>
                <input aria-label="Add artifact path" placeholder="Add workspace file reference…" value={manualArtifactPath} onChange={(event) => setManualArtifactPath(event.currentTarget.value)} />
                <button type="submit">Add reference</button>
              </form>
            </div>
            {loadState === "loading" ? (
              <LoadingState compact label="Loading artifact references" detail="Indexing workspace files…" />
            ) : null}
            {loadState === "error" ? (
              <div role="alert">
                <p>Artifact references could not be refreshed. Existing references may be stale.</p>
                <button type="button" onClick={() => setLoadNonce((current) => current + 1)}>Retry</button>
              </div>
            ) : null}
            {loadState === "populated" && artifactGroups.length ? artifactGroups.map(([group, groupedArtifacts]) => (
              <section className="workspace-hub__artifact-group" key={group}>
                <h3>{group}</h3>
                {groupedArtifacts.map((artifact) => (
              <article className="workspace-hub__artifact" key={artifact.id}>
                <div>
                  <strong>{artifact.path}</strong>
                  <span>{artifact.type} · {artifact.source} · {artifact.state}</span>
                  <small>{artifact.runId ? `run ${artifact.runId}` : "no run"}{artifact.sessionId ? ` · thread ${artifact.sessionId}` : ""}</small>
                </div>
                <div>
                  <button disabled={artifact.state !== "available" && artifact.state !== "export-excluded"} type="button" onClick={() => onOpenFile(artifact.path)}>Open</button>
                  <button disabled={artifact.state !== "available" && artifact.state !== "export-excluded"} type="button" onClick={() => void window.piApp?.revealWorkspacePath(workspace.id, artifact.path)}>Reveal</button>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(artifact.path)}>Copy path</button>
                  <button disabled={artifact.state !== "available" && artifact.state !== "export-excluded"} type="button" onClick={() => onAttachFile(artifact.path)}>Attach next</button>
                  <label>
                    <input
                      checked={includedArtifactIds.has(artifact.id)}
                      disabled={artifact.state !== "available" || artifact.sensitivity === "private" || artifact.type === "log"}
                      type="checkbox"
                      onChange={() => {
                        const next = new Set(includedArtifactIds);
                        if (next.has(artifact.id)) next.delete(artifact.id);
                        else next.add(artifact.id);
                        setIncludedArtifactIds(next);
                      }}
                    />
                    Include in handoff
                  </label>
                </div>
              </article>
                ))}
              </section>
            )) : loadState === "populated" ? <p>No plan, screenshot, report, asset, log, or selected file references observed yet.</p> : null}
          </div>
        ) : null}

        {tab === "worktree" ? (
          <div className="workspace-hub__content" data-testid="worktree-lifecycle-card">
            <h2>Worktree lifecycle</h2>
            <dl>
              <dt>Purpose</dt><dd>{session?.title ?? workspace.name}</dd>
              <dt>Status</dt><dd>{lifecycle.status}</dd>
              <dt>Branch</dt><dd>{workspace.branchName ?? worktree?.branchName ?? "unknown"}</dd>
              <dt>Source branch</dt><dd>{worktree ? "root workspace branch (not recorded)" : "primary workspace"}</dd>
              <dt>Path</dt><dd><code>{workspace.path}</code></dd>
              <dt>Owning thread</dt><dd>{session?.title ?? "none selected"}</dd>
              <dt>Dirty</dt><dd>{lifecycle.dirty ? `${changedPaths.length} changed path(s)` : "clean"}</dd>
              <dt>Running tasks</dt><dd>{runningTaskCount}</dd>
              <dt>Creation time</dt><dd>{worktree?.updatedAt ?? "not recorded"}</dd>
            </dl>
            <p>{lifecycle.cleanupAdvisory}</p>
            <div>
              <button type="button" disabled={!session} onClick={onOpenBranches}>Open related branches</button>
              <button type="button" onClick={onOpenChanges}>Open related changes</button>
              <button
                type="button"
                disabled={!evidence.some((record) => record.kind === "checkpoint")}
                onClick={() => {
                  onClose();
                  window.requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>("[data-testid='checkpoint-recovery']")?.scrollIntoView({
                      block: "center",
                    });
                  });
                }}
              >
                Open checkpoints
              </button>
              <button type="button" onClick={() => setTab("artifacts")}>Open artifacts</button>
              <button type="button" onClick={() => setTab("handoff")}>Open handoff</button>
            </div>
            <small>Cleanup is advisory only. This surface never deletes a worktree.</small>
          </div>
        ) : null}

        {tab === "handoff" ? (
          <div className="workspace-hub__content workspace-hub__handoff" data-testid="workspace-handoff">
            <div>
              <h2>Workspace handoff</h2>
              <label>
                Narrative summary (optional)
                <textarea value={narrative} onChange={(event) => setNarrative(event.currentTarget.value)} />
              </label>
              <fieldset>
                <legend>Decisions to include</legend>
                {decisions.length ? decisions.map((decision) => (
                  <label key={decision.id}>
                    <input
                      checked={includedDecisionIds.has(decision.id)}
                      type="checkbox"
                      onChange={() => {
                        const next = new Set(includedDecisionIds);
                        if (next.has(decision.id)) next.delete(decision.id);
                        else next.add(decision.id);
                        setIncludedDecisionIds(next);
                      }}
                    />
                    {decision.text}
                  </label>
                )) : <span>No active decisions observed.</span>}
              </fieldset>
              <p>{includedDecisionIds.size} selected decision(s), {changedPaths.length} changed path(s), {includedArtifactIds.size} selected artifact(s).</p>
              <div>
                <button type="button" onClick={() => void navigator.clipboard.writeText(handoff).then(() => setNotice("Copied handoff."))}>Copy</button>
                <button type="button" onClick={() => void saveHandoff(false)}>Save to workspace</button>
                <button type="button" onClick={() => void saveHandoff(true)}>Save and attach to next message</button>
              </div>
              {notice ? <p role="status">{notice}</p> : null}
            </div>
            <pre><code>{handoff}</code></pre>
          </div>
        ) : null}

        {tab === "shortcuts" ? (
          <div className="workspace-hub__content" data-testid="workspace-shortcuts">
            <h2>Workspace shortcuts</h2>
            <p>Safe navigation runs directly. Project actions retain command preview.</p>
            {shortcuts.map((assignment) => (
              <article key={assignment.id}>
                <strong>{assignment.label}</strong>
                <kbd>{assignment.keys}</kbd>
                <label>
                  <input
                    checked={assignment.enabled}
                    type="checkbox"
                    onChange={() => {
                      const next = shortcuts.map((entry) => entry.id === assignment.id ? { ...entry, enabled: !entry.enabled } : entry);
                      setShortcuts(next);
                      saveWorkspaceShortcuts(workspace.id, next);
                    }}
                  />
                  Enabled
                </label>
                <button type="button" onClick={() => {
                  setShortcutCommandId(assignment.commandId);
                  setShortcutKeys(assignment.keys);
                  const next = shortcuts.filter((entry) => entry.id !== assignment.id);
                  setShortcuts(next);
                  saveWorkspaceShortcuts(workspace.id, next);
                }}>Edit</button>
              </article>
            ))}
            <form onSubmit={(event) => {
              event.preventDefault();
              const target = shortcutTargets.find((candidate) => candidate.id === shortcutCommandId);
              if (!target) return;
              const id = `shortcut:${shortcutCommandId}`;
              const error = validateWorkspaceShortcut(shortcutKeys, shortcuts, id);
              if (error) {
                setNotice(error);
                return;
              }
              const next = [...shortcuts.filter((entry) => entry.id !== id), {
                id,
                commandId: target.id,
                label: target.label,
                keys: normalizeShortcut(shortcutKeys),
                enabled: true,
                significant: target.significant,
              }];
              setShortcuts(next);
              saveWorkspaceShortcuts(workspace.id, next);
              setShortcutKeys("");
              setNotice("Shortcut saved.");
            }}>
              <select aria-label="Shortcut command" value={shortcutCommandId} onChange={(event) => setShortcutCommandId(event.currentTarget.value)}>
                {shortcutTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
              </select>
              <input aria-label="Shortcut keys" placeholder="Cmd+Shift+1" value={shortcutKeys} onChange={(event) => setShortcutKeys(event.currentTarget.value)} />
              <button type="submit">Assign</button>
              <button type="button" onClick={() => {
                setShortcuts([]);
                saveWorkspaceShortcuts(workspace.id, []);
                setNotice("Workspace shortcuts reset.");
              }}>Reset all</button>
            </form>
            {notice ? <p role="status">{notice}</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
