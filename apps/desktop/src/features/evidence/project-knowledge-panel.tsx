import { useEffect, useMemo, useState } from "react";
import {
  PROJECT_KNOWLEDGE_CHANGED_EVENT,
  confirmDecision,
  deleteMemory,
  readProjectKnowledge,
  saveDecision,
  saveMemory,
  setMemoryEnabled,
  setMemoryTemporarilyExcluded,
  updateDecisionStatus,
  type DecisionKind,
} from "../../product-experience/project-knowledge";

export function ProjectKnowledgePanel({
  workspaceId,
  sessionId,
  knownWorkspaceIds,
}: {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly knownWorkspaceIds: ReadonlySet<string>;
}) {
  const [knowledge, setKnowledge] = useState(readProjectKnowledge);
  const [mode, setMode] = useState<"decision" | "memory">("decision");
  const [kind, setKind] = useState<DecisionKind>("decision");
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [scope, setScope] = useState<"global" | "workspace" | "thread">("workspace");
  const [affectedScope, setAffectedScope] = useState("Current workspace");
  const [sourceEvidence, setSourceEvidence] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const refresh = () => setKnowledge(readProjectKnowledge());
    window.addEventListener(PROJECT_KNOWLEDGE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROJECT_KNOWLEDGE_CHANGED_EVENT, refresh);
  }, []);

  const decisions = useMemo(() => knowledge.decisions.filter((record) => (
    record.workspaceId === workspaceId && (!record.sessionId || record.sessionId === sessionId)
  )), [knowledge.decisions, sessionId, workspaceId]);
  const memory = knowledge.memory;

  const submit = () => {
    setError(undefined);
    try {
      if (mode === "decision") {
        saveDecision({
          ...(editingId ? { id: editingId } : {}),
          kind,
          text,
          workspaceId,
          sessionId,
          affectedScope,
          ...(sourceEvidence.trim() ? { sourceEvidence } : {}),
          confirmed: true,
        });
      } else {
        saveMemory({
          ...(editingId ? { id: editingId } : {}),
          key,
          text,
          scope,
          ...(scope !== "global" ? { workspaceId } : {}),
          ...(scope === "thread" ? { sessionId } : {}),
          confirmed: true,
        });
      }
      setText("");
      setKey("");
      setSourceEvidence("");
      setEditingId(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <details className="project-knowledge" data-testid="project-knowledge">
      <summary>Decisions &amp; project memory</summary>
      <div className="project-knowledge__tabs">
        <button aria-pressed={mode === "decision"} type="button" onClick={() => setMode("decision")}>Decision</button>
        <button aria-pressed={mode === "memory"} type="button" onClick={() => setMode("memory")}>Memory</button>
      </div>
      <div className="project-knowledge__editor">
        {mode === "decision" ? (
          <>
            <label>Type
              <select value={kind} onChange={(event) => setKind(event.target.value as DecisionKind)}>
                <option value="decision">Decision</option>
                <option value="assumption">Assumption</option>
              </select>
            </label>
            <label>Affected scope
              <input value={affectedScope} onChange={(event) => setAffectedScope(event.target.value)} />
            </label>
            <label>Source evidence (optional)
              <input value={sourceEvidence} onChange={(event) => setSourceEvidence(event.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label>Key
              <input aria-label="Memory key" value={key} onChange={(event) => setKey(event.target.value)} />
            </label>
            <label>Scope
              <select aria-label="Memory scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
                <option value="global">Global</option>
                <option value="workspace">Workspace</option>
                <option value="thread">Thread</option>
              </select>
            </label>
          </>
        )}
        <label className="project-knowledge__text">
          {mode === "decision" ? "Decision or assumption" : "Exact memory to inject"}
          <textarea value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="button" disabled={!text.trim() || (mode === "memory" && !key.trim())} onClick={submit}>
          {editingId ? "Save edit" : mode === "decision" ? "Save decision" : "Save memory"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
        <small>Secret-like credentials are rejected before storage. Transcript content is never imported automatically.</small>
      </div>

      <div className="project-knowledge__records">
        {decisions.map((record) => (
          <article key={record.id}>
            <div>
              <strong>{record.kind} · {record.status}</strong>
              <span>{record.text}</span>
              <small>
                {record.affectedScope}
                {record.sourceMessageId ? ` · source ${record.sourceMessageId}` : ""}
                {record.revisions.length ? ` · ${record.revisions.length} prior revision(s)` : ""}
              </small>
            </div>
            <div>
              {record.createdBy === "assistant-proposal" && !record.confirmedAt ? (
                <button type="button" onClick={() => confirmDecision(record.id)}>Confirm proposal</button>
              ) : null}
              <button type="button" onClick={() => {
                setMode("decision");
                setEditingId(record.id);
                setKind(record.kind);
                setText(record.text);
                setAffectedScope(record.affectedScope);
                setSourceEvidence(record.sourceEvidence ?? "");
              }}>Edit</button>
              <select
                aria-label={`Status for ${record.text}`}
                value={record.status}
                onChange={(event) => updateDecisionStatus(record.id, event.target.value as typeof record.status)}
              >
                <option value="active">Active</option>
                <option value="superseded">Superseded</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>
          </article>
        ))}
        {memory.map((entry) => {
          const missingScope = entry.scope === "workspace"
            && Boolean(entry.workspaceId)
            && !knownWorkspaceIds.has(entry.workspaceId ?? "");
          return (
            <article key={entry.id}>
              <div>
                <strong>{entry.key} · {entry.scope}</strong>
                <span>{entry.text}</span>
                <small>{missingScope ? "Workspace missing or renamed · not injected" : entry.enabled ? "Injected when applicable" : "Disabled"}</small>
              </div>
              <div>
                <button type="button" onClick={() => {
                  setMode("memory");
                  setEditingId(entry.id);
                  setKey(entry.key);
                  setText(entry.text);
                  setScope(entry.scope);
                }}>Edit</button>
                <button type="button" onClick={() => setMemoryEnabled(entry.id, !entry.enabled)}>
                  {entry.enabled ? "Disable" : "Enable"}
                </button>
                <button type="button" onClick={() => setMemoryTemporarilyExcluded(entry.id, true)}>
                  Exclude once
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete memory “${entry.key}”?`)) deleteMemory(entry.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}
