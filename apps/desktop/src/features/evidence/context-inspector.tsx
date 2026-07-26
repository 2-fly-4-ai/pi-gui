import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ComposerAttachment } from "../../desktop-state";
import type { PiDesktopApi } from "../../ipc";
import {
  buildContextManifest,
  extractFileMentions,
  type ContextEntry,
  type ContextManifest,
  type ContextManifestSnapshot,
} from "../../product-experience/context-manifest";
import { formatExactLocalTime } from "../../string-utils";
import {
  PROJECT_KNOWLEDGE_CHANGED_EVENT,
  activeDecisions,
  resolveInjectableMemory,
} from "../../product-experience/project-knowledge";
import { ProjectKnowledgePanel } from "./project-knowledge-panel";
import { LoadingState } from "../../loading-state";

interface ContextInspectorProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly attachments: readonly ComposerAttachment[];
  readonly onRemoveAttachment: (attachmentId: string) => void;
}

export function ContextInspector({
  api,
  workspaceId,
  sessionId,
  provider,
  model,
  composerDraft,
  setComposerDraft,
  attachments,
  onRemoveAttachment,
}: ContextInspectorProps) {
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState<ContextManifest>();
  const [activeProfile, setActiveProfile] = useState<{
    readonly id: string;
    readonly fallbackId?: string;
  }>();
  const [submitted, setSubmitted] = useState<readonly ContextManifestSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [knownWorkspaceIds, setKnownWorkspaceIds] = useState<ReadonlySet<string>>(new Set());
  const [knowledgeRevision, setKnowledgeRevision] = useState(0);
  const mentions = useMemo(() => extractFileMentions(composerDraft), [composerDraft]);

  useEffect(() => {
    const refresh = () => setKnowledgeRevision((value) => value + 1);
    window.addEventListener(PROJECT_KNOWLEDGE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROJECT_KNOWLEDGE_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      api.getState(),
      api.getCurrentBranch(workspaceId).catch(() => undefined),
      api.listContextManifests(workspaceId, sessionId).catch(() => []),
    ]).then(([state, branch, snapshots]) => {
      if (!active) return;
      setSubmitted(snapshots);
      const runtime = state.runtimeByWorkspace[workspaceId];
      const profile = runtime?.skillProfiles.find((candidate) =>
        candidate.id === runtime.activeSkillProfileId);
      const fallback = runtime?.skillProfiles.find((candidate) =>
        candidate.id !== runtime.activeSkillProfileId);
      setKnownWorkspaceIds(new Set(state.workspaces.map((workspace) => workspace.id)));
      setActiveProfile(profile ? { id: profile.id, ...(fallback ? { fallbackId: fallback.id } : {}) } : undefined);
      setManifest(buildContextManifest({
        workspaceId,
        sessionId,
        provider,
        model,
        ...(branch ? { checkout: branch } : {}),
        generatedAt: new Date().toISOString(),
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          label: attachment.name,
          availability: attachment.status === "missing"
            ? "missing"
            : attachment.status === "failed"
              ? "stale"
              : "available",
        })),
        fileMentions: mentions,
        desktopInstructionsEnabled: state.desktopCustomInstructions.enabled,
        ...(profile ? { activeSkillProfile: profile.name } : {}),
        projectMemory: resolveInjectableMemory({ workspaceId, sessionId }),
        decisions: activeDecisions({ workspaceId, sessionId }),
      }));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, attachments, knowledgeRevision, mentions, model, open, provider, sessionId, workspaceId]);

  const removeEntry = async (entry: ContextEntry) => {
    if (!entry.removable) return;
    if (entry.source === "attachment") {
      onRemoveAttachment(entry.id.slice("attachment:".length));
    } else if (entry.source === "file-mention") {
      const path = entry.path ?? entry.label;
      setComposerDraft((current) => removeFileMention(current, path));
    } else if (entry.source === "desktop-instruction") {
      await api.setDesktopCustomInstructions({ enabled: false });
    } else if (entry.source === "skill" && activeProfile?.fallbackId) {
      await api.setActiveSkillProfile(workspaceId, activeProfile.fallbackId);
    }
    setManifest((current) => current ? {
      ...current,
      entries: current.entries.filter((candidate) => candidate.id !== entry.id),
    } : current);
  };

  return (
    <div className="context-inspector-control">
      <button
        aria-expanded={open}
        className="context-inspector-control__trigger"
        data-testid="context-inspector-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        Context
      </button>
      {open ? (
        <section
          aria-label="Context for next message"
          className="context-inspector"
          data-testid="context-inspector"
          role="dialog"
        >
          <div className="context-inspector__header">
            <div>
              <span>Next message manifest</span>
              <strong>{provider ?? "Provider not selected"} · {model ?? "Model not selected"}</strong>
              <small>{manifest?.checkout ? `Checkout ${manifest.checkout}` : "Checkout unavailable"}</small>
            </div>
            <button type="button" aria-label="Close context inspector" onClick={() => setOpen(false)}>×</button>
          </div>
          {loading ? (
            <LoadingState compact label="Inspecting context" detail="Resolving the next-message manifest…" />
          ) : null}
          {error ? <p className="context-inspector__error" role="alert">{error}</p> : null}
          {manifest ? (
            <>
              <div className="context-inspector__entries">
                {manifest.entries.map((entry) => (
                  <article className="context-inspector__entry" key={entry.id}>
                    <div>
                      <strong>{entry.label}</strong>
                      <span>{entry.reason}</span>
                      <small>
                        {entry.providerVisible ? "Sent externally" : "Local only"}
                        {" · "}
                        {entry.contentAccess === "opaque" ? "Details unavailable" : entry.contentAccess}
                        {" · "}
                        {entry.scope}
                        {entry.availability !== "available" ? ` · ${entry.availability}` : ""}
                      </small>
                    </div>
                    {entry.removable && (entry.source !== "skill" || activeProfile?.fallbackId) ? (
                      <button type="button" onClick={() => void removeEntry(entry)}>Remove</button>
                    ) : (
                      <span className="context-inspector__readonly">Read-only</span>
                    )}
                  </article>
                ))}
              </div>
              {!manifest.entries.some((entry) => entry.source === "project-memory") ? (
                <p className="context-inspector__empty-memory">Project memory · none configured for this submission</p>
              ) : null}
            </>
          ) : null}
          {submitted.length > 0 ? (
            <details className="context-inspector__submitted">
              <summary>{submitted.length} submitted manifest{submitted.length === 1 ? "" : "s"}</summary>
              {submitted.slice(0, 5).map((snapshot) => (
                <article key={snapshot.id}>
                  <strong>{formatExactLocalTime(snapshot.submittedAt)}</strong>
                  <span>
                    {snapshot.manifest.provider} · {snapshot.manifest.model} · {snapshot.manifest.entries.length} entries
                  </span>
                </article>
              ))}
            </details>
          ) : null}
          <ProjectKnowledgePanel
            knownWorkspaceIds={knownWorkspaceIds}
            sessionId={sessionId}
            workspaceId={workspaceId}
          />
          <p className="context-inspector__notice">
            Runtime-managed and provider-side system context cannot be inspected or removed by Pi GUI.
            Hidden prompts and secret values are never displayed here.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function removeFileMention(value: string, path: string): string {
  return value
    .replace(new RegExp(`(^|\\s)@${escapeRegExp(path)}(?=\\s|$)`, "g"), "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trimStart();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
