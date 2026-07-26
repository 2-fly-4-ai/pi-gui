import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ToolAccessSelection } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  applySessionConfigPatch,
  appendComposerAttachments,
  beginQueuedComposerMessageEdit,
  cancelQueuedComposerMessageEdit,
  type ComposerAttachment,
  type DesktopAppState,
  type SessionRecord,
  type WorkspaceRecord,
  removeComposerAttachmentFromState,
  setQueuedComposerMessageMode,
} from "../../desktop-state";
import { parseTreeComposerCommand } from "../../composer-commands";
import { readComposerAttachmentsFromFiles } from "../../composer-attachments";
import {
  buildContextManifest,
  extractFileMentions,
  resolveProjectMemory,
} from "../../product-experience/context-manifest";
import {
  activeDecisions,
  clearTemporaryMemoryExclusions,
  resolveInjectableMemory,
} from "../../product-experience/project-knowledge";

interface UseSessionComposerOptions {
  readonly api: typeof window.piApp;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly modelSelectionRequired: boolean;
  readonly selectedRuntime: RuntimeSnapshot | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly showThinking: boolean;
  readonly snapshot: DesktopAppState | null;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly onOpenTreeModal: () => void;
  readonly onRecordSubmittedSkillUsage: (text: string, runtime: RuntimeSnapshot | undefined) => void;
}

export function useSessionComposer({
  api,
  composerRef,
  modelSelectionRequired,
  selectedRuntime,
  selectedSession,
  selectedSessionKey,
  selectedWorkspace,
  showThinking,
  snapshot,
  setSnapshot,
  onOpenTreeModal,
  onRecordSubmittedSkillUsage,
}: UseSessionComposerOptions) {
  const [composerDraftState, setComposerDraftState] = useState({ dirty: false, sessionKey: "", value: "" });
  const composerDraft = composerDraftState.value;
  const setComposerDraft = useCallback(
    (next: SetStateAction<string>) => {
      setComposerDraftState((current) => ({
        dirty: true,
        sessionKey: selectedSessionKey,
        value: typeof next === "function" ? next(current.value) : next,
      }));
    },
    [selectedSessionKey],
  );
  const [attachmentsClearedOnSubmit, setAttachmentsClearedOnSubmit] = useState(false);
  const hydratedComposerSessionKeyRef = useRef("");
  const handledComposerSyncNonceRef = useRef(0);
  const showThinkingRequestRef = useRef(showThinking);
  const queuedEditRestoreRef = useRef<{
    readonly messageId: string;
    readonly draft: string;
    readonly attachments: readonly ComposerAttachment[];
  } | null>(null);
  showThinkingRequestRef.current = showThinking;

  const composerAttachments = (attachmentsClearedOnSubmit ? [] : (snapshot?.composerAttachments ?? [])).map((attachment) => (
    attachment.kind === "file"
    && attachment.artifactReference
    && attachment.artifactReference.workspaceId !== selectedWorkspace?.id
      ? {
          ...attachment,
          status: "missing" as const,
          error: "This artifact belongs to another workspace. Switch back or remove it.",
        }
      : attachment
  ));
  const queuedComposerMessages = snapshot?.queuedComposerMessages ?? [];
  const editingQueuedMessageId = snapshot?.editingQueuedMessageId;
  const persistedComposerDraft = snapshot?.composerDraft ?? "";

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (hydratedComposerSessionKeyRef.current !== selectedSessionKey) {
      hydratedComposerSessionKeyRef.current = selectedSessionKey;
      handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
      setComposerDraftState({ dirty: false, sessionKey: selectedSessionKey, value: snapshot.composerDraft });
      return;
    }

    if (snapshot.composerDraftSyncNonce === handledComposerSyncNonceRef.current) {
      return;
    }

    handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
    if (snapshot.composerDraftSyncSource === "persist" || snapshot.composerDraftSyncSource === "state") {
      return;
    }

    setComposerDraftState({ dirty: false, sessionKey: selectedSessionKey, value: snapshot.composerDraft });
  }, [selectedSessionKey, snapshot]);

  useEffect(() => {
    if (
      !api ||
      !selectedWorkspace ||
      !selectedSession ||
      !composerDraftState.dirty ||
      composerDraftState.sessionKey !== selectedSessionKey ||
      composerDraft === persistedComposerDraft
    ) {
      return undefined;
    }

    void api.updateComposerDraft({ workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }, composerDraft);
    return undefined;
  }, [api, composerDraft, composerDraftState, persistedComposerDraft, selectedSession, selectedSessionKey, selectedWorkspace]);

  const submitComposerDraft = (options: { readonly deliverAs?: "steer" | "followUp" } = {}) => {
    if (!api || !selectedSession) {
      return;
    }

    const hasComposerInput = composerDraft.trim().length > 0 || composerAttachments.length > 0;
    if (selectedSession.status === "running" && !hasComposerInput) {
      void api.cancelCurrentRun();
      return;
    }

    if (!hasComposerInput) {
      return;
    }
    if (modelSelectionRequired) {
      return;
    }
    const unavailableAttachment = composerAttachments.find((attachment) => (
      attachment.status === "missing" || attachment.status === "failed"
    ));
    if (unavailableAttachment) {
      setSnapshot((current) => current ? {
        ...current,
        lastError: unavailableAttachment.error ?? `Attachment ${unavailableAttachment.name} is unavailable.`,
      } : current);
      return;
    }

    const treeCommand = parseTreeComposerCommand(composerDraft);
    if (treeCommand?.type === "error") {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              lastError: treeCommand.message,
            }
          : current,
      );
      return;
    }
    if (treeCommand?.type === "tree") {
      onOpenTreeModal();
      return;
    }

    const previousDraft = composerDraft;
    void (async () => {
      const workspaceId = selectedWorkspace?.id;
      for (const attachment of composerAttachments) {
        if (attachment.kind !== "file" || !attachment.artifactReference || !workspaceId) continue;
        if (attachment.artifactReference.workspaceId !== workspaceId) {
          throw new Error(`Artifact ${attachment.name} belongs to another workspace.`);
        }
        const currentVersion = await api.inspectWorkspaceArtifact(
          workspaceId,
          attachment.artifactReference.relativePath,
        ).catch(() => undefined);
        const intendedVersion = attachment.artifactReference.version;
        if (!currentVersion) {
          throw new Error(`Artifact ${attachment.name} is missing. Remove it or attach it again.`);
        }
        if (
          intendedVersion
          && (
            currentVersion.sizeBytes !== intendedVersion.sizeBytes
            || currentVersion.modifiedAt !== intendedVersion.modifiedAt
          )
        ) {
          throw new Error(`Artifact ${attachment.name} changed after it was attached. Remove it and attach the intended version again.`);
        }
      }
      const boundaryPreflight = workspaceId
        ? await api.preflightExecutionBoundary(workspaceId, selectedSession.id, previousDraft).catch(() => undefined)
        : undefined;
      const denied = boundaryPreflight?.violations.filter((violation) => violation.mode === "deny") ?? [];
      if (denied.length > 0) {
        setSnapshot((current) => current ? {
          ...current,
          lastError: `Execution boundary blocked this submission: ${denied.map((violation) => violation.label).join("; ")}`,
        } : current);
        return;
      }
      const approvalViolations = boundaryPreflight?.violations.filter(
        (violation) => violation.mode === "approval",
      ) ?? [];
      if (
        approvalViolations.length > 0
        && !window.confirm([
          "This request crosses the active execution boundary:",
          ...approvalViolations.map((violation) => `• ${violation.label}`),
          "",
          "Approve this submission once?",
        ].join("\n"))
      ) {
        return;
      }
      if (workspaceId && approvalViolations.length > 0) {
        await api.recordExecutionBoundaryException(
          workspaceId,
          selectedSession.id,
          approvalViolations.map((violation) => violation.id),
        );
      }
      onRecordSubmittedSkillUsage(previousDraft, selectedRuntime);
      setComposerDraftState({ dirty: false, sessionKey: selectedSessionKey, value: "" });
      setAttachmentsClearedOnSubmit(true);
      const activeProfile = selectedRuntime?.skillProfiles.find((profile) =>
        profile.id === selectedRuntime.activeSkillProfileId);
      const checkout = selectedWorkspace
        ? await api.getCurrentBranch(selectedWorkspace.id).catch(() => undefined)
        : undefined;
      const injectableMemory = selectedWorkspace ? resolveProjectMemory(resolveInjectableMemory({
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      }), {
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      }) : [];
      const applicableDecisions = selectedWorkspace ? activeDecisions({
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      }) : [];
      const contextSnapshot = selectedWorkspace
        ? await api.snapshotContextManifest(buildContextManifest({
            workspaceId: selectedWorkspace.id,
            sessionId: selectedSession.id,
            provider: selectedSession.config?.provider ?? selectedRuntime?.settings.defaultProvider,
            model: selectedSession.config?.modelId ?? selectedRuntime?.settings.defaultModelId,
            ...(checkout ? { checkout } : {}),
            generatedAt: new Date().toISOString(),
            attachments: composerAttachments.map((attachment) => ({
              id: attachment.id,
              label: attachment.name,
              availability: attachment.status === "missing"
                ? "missing"
                : attachment.status === "failed"
                  ? "stale"
                  : "available",
            })),
            fileMentions: extractFileMentions(previousDraft),
            desktopInstructionsEnabled: snapshot?.desktopCustomInstructions.enabled,
            ...(activeProfile ? { activeSkillProfile: activeProfile.name } : {}),
            projectMemory: injectableMemory,
            decisions: applicableDecisions,
          })).catch(() => undefined)
        : undefined;
      const messageMetadata = contextSnapshot || boundaryPreflight?.boundary.enabled ? {
        ...(contextSnapshot ? {
          contextManifestSnapshotId: contextSnapshot.id,
          contextManifestSchemaVersion: contextSnapshot.manifest.schemaVersion,
          projectMemoryCount: injectableMemory.length,
          activeDecisionCount: applicableDecisions.length,
          ...(injectableMemory.length > 0 || applicableDecisions.length > 0 ? {
            providerContextPreamble: buildProjectKnowledgePreamble(injectableMemory, applicableDecisions),
          } : {}),
        } : {}),
        ...(boundaryPreflight?.boundary.enabled ? {
          executionBoundaryRevision: boundaryPreflight.boundary.revision,
          executionBoundarySchemaVersion: boundaryPreflight.boundary.schemaVersion,
          executionBoundaryExceptionIds: approvalViolations.map((violation) => violation.id),
        } : {}),
      } : undefined;
      await api.submitComposer(
        previousDraft,
        selectedSession.status === "running"
          ? {
              deliverAs: options.deliverAs ?? "steer",
              ...(messageMetadata ? { messageMetadata } : {}),
            }
          : messageMetadata
            ? { messageMetadata }
            : undefined,
      );
      clearTemporaryMemoryExclusions();
      const nextState = await api.getState();
      setSnapshot(nextState);
      setComposerDraftState({
        dirty: false,
        sessionKey:
          nextState.selectedWorkspaceId && nextState.selectedSessionId
            ? `${nextState.selectedWorkspaceId}:${nextState.selectedSessionId}`
            : "",
        value: nextState.composerDraft,
      });
      setAttachmentsClearedOnSubmit(false);
    })().catch((error) => {
      setComposerDraft(previousDraft);
      setAttachmentsClearedOnSubmit(false);
      setSnapshot((current) => current ? {
        ...current,
        lastError: error instanceof Error ? error.message : String(error),
      } : current);
    });
  };

  const handlePickAttachments = () => {
    if (!api) {
      return;
    }
    void api.pickComposerAttachments().then(() => api.getState()).then(setSnapshot);
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    if (!api) {
      return;
    }
    setSnapshot((current) => current ? removeComposerAttachmentFromState(current, attachmentId) : current);
    void api.removeComposerAttachment(attachmentId);
  };

  const handleEditQueuedMessage = (messageId: string) => {
    if (!api) {
      return;
    }
    const message = queuedComposerMessages.find((entry) => entry.id === messageId);
    if (!message) {
      return;
    }
    queuedEditRestoreRef.current = {
      messageId,
      draft: composerDraft,
      attachments: composerAttachments,
    };
    setComposerDraft(message.text);
    setSnapshot((current) => current ? beginQueuedComposerMessageEdit(current, messageId) : current);
    void api.editQueuedComposerMessage(messageId, composerDraft).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleCancelQueuedEdit = () => {
    if (!api) {
      return;
    }
    const restore = queuedEditRestoreRef.current;
    if (restore) {
      setComposerDraft(restore.draft);
      setSnapshot((current) => current ? cancelQueuedComposerMessageEdit(current, restore) : current);
      queuedEditRestoreRef.current = null;
    }
    void api.cancelQueuedComposerEdit().then(() => {
      composerRef.current?.focus();
    });
  };

  const handleRemoveQueuedMessage = (messageId: string) => {
    if (!api) {
      return;
    }
    void api.removeQueuedComposerMessage(messageId);
  };

  const handleSteerQueuedMessage = (messageId: string) => {
    if (!api) {
      return;
    }
    setSnapshot((current) => current ? setQueuedComposerMessageMode(current, messageId, "steer") : current);
    void api.steerQueuedComposerMessage(messageId);
  };

  const handleQueueQueuedMessage = (messageId: string) => {
    if (!api) return;
    setSnapshot((current) => current ? setQueuedComposerMessageMode(current, messageId, "followUp") : current);
    void api.setQueuedComposerMessageDelivery(messageId, "followUp");
  };

  const handleMoveQueuedMessage = (messageId: string, direction: "up" | "down") => {
    if (!api) return;
    void api.moveQueuedComposerMessage(messageId, direction);
  };

  const handleSendNextQueuedMessage = (messageId: string) => {
    if (!api) return;
    void api.sendNextQueuedComposerMessage(messageId);
  };

  const addAttachmentsToSessionComposer = async (files: File[]) => {
    if (!api) {
      return;
    }
    const valid = await readComposerAttachmentsFromFiles(files);
    if (valid.length === 0) {
      return;
    }
    setSnapshot((current) => current ? appendComposerAttachments(current, valid) : current);
    void api.addComposerAttachments(valid);
  };

  const handleSetSessionModel = (provider: string, modelId: string) => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }
    const workspaceId = selectedWorkspace.id;
    const sessionId = selectedSession.id;
    setSnapshot((current) => current ? applySessionConfigPatch(current, workspaceId, sessionId, { provider, modelId }) : current);
    void api.setSessionModel(workspaceId, sessionId, provider, modelId);
  };

  const handleSetSessionThinking = (level: string) => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }
    const thinkingLevel = level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>;
    const workspaceId = selectedWorkspace.id;
    const sessionId = selectedSession.id;
    setSnapshot((current) => current ? applySessionConfigPatch(current, workspaceId, sessionId, { thinkingLevel }) : current);
    void api.setSessionThinkingLevel(workspaceId, sessionId, thinkingLevel);
  };

  const handleToggleShowThinking = () => {
    if (!api) {
      return;
    }
    const nextShowThinking = !showThinkingRequestRef.current;
    showThinkingRequestRef.current = nextShowThinking;
    setSnapshot((current) => current ? { ...current, showThinking: nextShowThinking } : current);
    void api.setShowThinking(nextShowThinking);
  };

  const handleSetSessionToolAccess = (selection: ToolAccessSelection) => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }
    const workspaceId = selectedWorkspace.id;
    const sessionId = selectedSession.id;
    setSnapshot((current) => current ? applySessionConfigPatch(current, workspaceId, sessionId, { toolAccess: selection }) : current);
    void api.setSessionToolAccess(workspaceId, sessionId, selection);
  };

  const handleSetFastMode = (mode: "auto" | "on" | "off") => {
    if (!api) {
      return;
    }
    const enabled = mode === "on";
    setSnapshot((current) =>
      current
        ? {
            ...current,
            fastMode: {
              ...current.fastMode,
              enabled,
            },
            lastError: undefined,
          }
        : current,
    );
    void api.setFastMode(enabled);
  };

  return {
    addAttachmentsToSessionComposer,
    composerAttachments: composerAttachments as readonly ComposerAttachment[],
    composerDraft,
    editingQueuedMessageId,
    handleCancelQueuedEdit,
    handleEditQueuedMessage,
    handlePickAttachments,
    handleRemoveAttachment,
    handleRemoveQueuedMessage,
    handleMoveQueuedMessage,
    handleQueueQueuedMessage,
    handleSendNextQueuedMessage,
    handleSetFastMode,
    handleSetSessionModel,
    handleSetSessionThinking,
    handleSetSessionToolAccess,
    handleSteerQueuedMessage,
    handleToggleShowThinking,
    queuedComposerMessages,
    setComposerDraft,
    submitComposerDraft,
  };
}

function buildProjectKnowledgePreamble(
  memory: readonly { readonly key: string; readonly text: string; readonly scope: string }[],
  decisions: readonly { readonly kind: string; readonly text: string; readonly affectedScope: string }[],
): string {
  return [
    "The user explicitly configured the following Pi GUI project context for this request.",
    ...memory.map((entry) => `Memory (${entry.scope}) ${entry.key}: ${entry.text}`),
    ...decisions.map((entry) => `${entry.kind} (${entry.affectedScope}): ${entry.text}`),
  ].join("\n");
}
