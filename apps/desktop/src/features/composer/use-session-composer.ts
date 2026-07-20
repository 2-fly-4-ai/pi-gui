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

  const composerAttachments = attachmentsClearedOnSubmit ? [] : (snapshot?.composerAttachments ?? []);
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
    onRecordSubmittedSkillUsage(previousDraft, selectedRuntime);
    setComposerDraftState({ dirty: false, sessionKey: selectedSessionKey, value: "" });
    setAttachmentsClearedOnSubmit(true);
    void (async () => {
      await api.submitComposer(
        previousDraft,
        selectedSession.status === "running" ? { deliverAs: options.deliverAs ?? "steer" } : undefined,
      );
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
    })().catch(() => {
      setComposerDraft(previousDraft);
      setAttachmentsClearedOnSubmit(false);
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
