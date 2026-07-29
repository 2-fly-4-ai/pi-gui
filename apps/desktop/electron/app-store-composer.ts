import { randomUUID } from "node:crypto";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionConfig, SessionRef, ToolAccessSelection } from "@pi-gui/session-driver";
import type { ComposerAttachment, DesktopAppState, QueuedComposerMessage, TranscriptMessage, WorkspaceSessionTarget } from "../src/desktop-state";
import { toSessionRef } from "./app-store-utils";
import {
  formatSessionConfigStatus,
  hasRuntimeSlashCommand,
  incompleteComposerCommandMessage,
  parseComposerCommand,
  resolveRuntimeSlashCommand,
} from "../src/composer-commands";
import { appendUserMessage, clearActiveAssistantMessage } from "./app-store-timeline";
import {
  cloneComposerAttachments,
  makeActivityItem,
  previewFromTranscript,
  toSessionAttachments,
  toSessionQueuedMessages,
  toProviderMessageText,
  toTranscriptAttachments,
} from "./app-store-utils";
import type { AppStoreInternals } from "./app-store-internals";
import { updateSessionRecord } from "./app-store-session-state";
import { appendAgentActivity } from "./observability-service";

/* ── Public methods ─────────────────────────────────────── */

export async function updateComposerDraft(
  store: AppStoreInternals,
  target: WorkspaceSessionTarget,
  composerDraft: string,
  options?: { readonly syncToEditor?: boolean },
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = toSessionRef(target);
  const key = sessionKey(sessionRef);
  if (composerDraft) {
    store.sessionState.composerDraftsBySession.set(key, composerDraft);
  } else {
    store.sessionState.composerDraftsBySession.delete(key);
  }
  store.schedulePersistUiState();

  const selectedSessionRef = store.selectedSessionRef();
  if (!selectedSessionRef || sessionKey(selectedSessionRef) !== key) {
    return store.state;
  }
  store.state = {
    ...store.state,
    composerDraft,
    composerDraftSyncSource: options?.syncToEditor ? "command" : "persist",
    composerDraftSyncNonce: store.state.composerDraftSyncNonce + 1,
    revision: store.state.revision + 1,
  };
  return store.emit();
}

export async function addComposerAttachments(
  store: AppStoreInternals,
  attachments: readonly ComposerAttachment[],
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef || attachments.length === 0) {
    return store.emit();
  }

  const key = sessionKey(sessionRef);
  const existing = store.sessionState.composerAttachmentsBySession.get(key) ?? [];
  const next = [...existing, ...attachments];
  store.sessionState.composerAttachmentsBySession.set(key, next);
  store.state = {
    ...store.state,
    composerAttachments: cloneComposerAttachments(next),
    revision: store.state.revision + 1,
  };
  await store.persistComposerAttachments(key, next);
  return store.emit();
}

export async function removeComposerAttachment(
  store: AppStoreInternals,
  attachmentId: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  const key = sessionKey(sessionRef);
  const existing = store.sessionState.composerAttachmentsBySession.get(key) ?? [];
  const next = existing.filter((attachment) => attachment.id !== attachmentId);
  if (next.length > 0) {
    store.sessionState.composerAttachmentsBySession.set(key, next);
  } else {
    store.sessionState.composerAttachmentsBySession.delete(key);
  }
  store.state = {
    ...store.state,
    composerAttachments: cloneComposerAttachments(next),
    revision: store.state.revision + 1,
  };
  await store.persistComposerAttachments(key, next);
  return store.emit();
}

export async function editQueuedComposerMessage(
  store: AppStoreInternals,
  messageId: string,
  currentDraft = "",
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  const key = sessionKey(sessionRef);
  const message = store.getQueuedComposerMessages(sessionRef).find((entry) => entry.id === messageId);
  if (!message) {
    return store.emit();
  }

  store.setQueuedComposerEditState(sessionRef, {
    messageId,
    restoreDraft: currentDraft || store.sessionState.composerDraftsBySession.get(key) || "",
    restoreAttachments: cloneComposerAttachments(store.sessionState.composerAttachmentsBySession.get(key) ?? []),
  });
  store.sessionState.composerDraftsBySession.set(key, message.text);
  store.sessionState.composerAttachmentsBySession.set(key, cloneComposerAttachments(message.attachments));
  await store.persistComposerAttachments(key, message.attachments);

  return store.refreshState({
    composerDraft: message.text,
    composerDraftSyncSource: "queued-message-edit",
    clearLastError: true,
    markSelectedSessionViewed: false,
  });
}

export async function cancelQueuedComposerEdit(
  store: AppStoreInternals,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  const editState = store.getQueuedComposerEditState(sessionRef);
  if (!editState) {
    return store.emit();
  }

  const key = sessionKey(sessionRef);
  store.setQueuedComposerEditState(sessionRef, undefined);
  if (editState.restoreDraft) {
    store.sessionState.composerDraftsBySession.set(key, editState.restoreDraft);
  } else {
    store.sessionState.composerDraftsBySession.delete(key);
  }
  if (editState.restoreAttachments.length > 0) {
    store.sessionState.composerAttachmentsBySession.set(key, cloneComposerAttachments(editState.restoreAttachments));
  } else {
    store.sessionState.composerAttachmentsBySession.delete(key);
  }
  await store.persistComposerAttachments(key, editState.restoreAttachments);

  return store.refreshState({
    composerDraft: editState.restoreDraft,
    composerDraftSyncSource: "queued-message-edit",
    clearLastError: true,
    markSelectedSessionViewed: false,
  });
}

export async function removeQueuedComposerMessage(
  store: AppStoreInternals,
  messageId: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  const current = store.getQueuedComposerMessages(sessionRef);
  const next = current.filter((message) => message.id !== messageId);
  const editState = store.getQueuedComposerEditState(sessionRef);
  const key = sessionKey(sessionRef);

  if (editState?.messageId === messageId) {
    store.setQueuedComposerEditState(sessionRef, undefined);
    if (editState.restoreDraft) {
      store.sessionState.composerDraftsBySession.set(key, editState.restoreDraft);
    } else {
      store.sessionState.composerDraftsBySession.delete(key);
    }
    if (editState.restoreAttachments.length > 0) {
      store.sessionState.composerAttachmentsBySession.set(key, cloneComposerAttachments(editState.restoreAttachments));
    } else {
      store.sessionState.composerAttachmentsBySession.delete(key);
    }
    await store.persistComposerAttachments(key, editState.restoreAttachments);
  }

  if (next.length > 0) {
    store.sessionState.queuedComposerMessagesBySession.set(key, [...next]);
  } else {
    store.sessionState.queuedComposerMessagesBySession.delete(key);
  }
  const selectedSession = store.sessionFromState(sessionRef);
  if (selectedSession?.status === "running") {
    await store.driver.replaceQueuedMessages(sessionRef, toSessionQueuedMessages(next));
  } else {
    await store.persistQueuedComposerMessages(sessionRef);
  }
  return store.refreshState({
    ...(editState?.messageId === messageId
      ? {
          composerDraft: editState.restoreDraft,
          composerDraftSyncSource: "queued-message-edit" as const,
        }
      : {}),
    clearLastError: true,
    markSelectedSessionViewed: false,
  });
}

export async function steerQueuedComposerMessage(
  store: AppStoreInternals,
  messageId: string,
): Promise<DesktopAppState> {
  return setQueuedComposerMessageDelivery(store, messageId, "steer");
}

export async function setQueuedComposerMessageDelivery(
  store: AppStoreInternals,
  messageId: string,
  mode: "steer" | "followUp",
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  const current = store.getQueuedComposerMessages(sessionRef);
  const queuedMessage = current.find((message) => message.id === messageId);
  if (!queuedMessage) {
    return store.emit();
  }

  const updatedMessage = {
    ...queuedMessage,
    mode,
    updatedAt: new Date().toISOString(),
  };
  const next = current.map((message) => (message.id === messageId ? updatedMessage : message));
  if (queuedMessage.recoveryState) {
    store.sessionState.queuedComposerMessagesBySession.set(sessionKey(sessionRef), next);
    await store.persistQueuedComposerMessages(sessionRef);
    return store.refreshState({ clearLastError: true, markSelectedSessionViewed: false });
  }
  const nextSessionQueuedMessages = toSessionQueuedMessages(next);

  try {
    await store.driver.replaceQueuedMessages(sessionRef, nextSessionQueuedMessages);
    return store.refreshState({
      clearLastError: true,
      markSelectedSessionViewed: false,
    });
  } catch (error) {
    return store.withError(error);
  }
}

export async function moveQueuedComposerMessage(
  store: AppStoreInternals,
  messageId: string,
  direction: "up" | "down",
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) return store.emit();
  const current = [...store.getQueuedComposerMessages(sessionRef)];
  const index = current.findIndex((message) => message.id === messageId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= current.length) return store.emit();
  [current[index], current[target]] = [current[target]!, current[index]!];
  store.sessionState.queuedComposerMessagesBySession.set(sessionKey(sessionRef), current);

  const selectedSession = store.sessionFromState(sessionRef);
  if (selectedSession?.status === "running") {
    await store.driver.replaceQueuedMessages(sessionRef, toSessionQueuedMessages(current));
  } else {
    await store.persistQueuedComposerMessages(sessionRef);
  }
  return store.refreshState({ clearLastError: true, markSelectedSessionViewed: false });
}

export async function sendNextQueuedComposerMessage(
  store: AppStoreInternals,
  messageId: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) return store.emit();
  const current = [...store.getQueuedComposerMessages(sessionRef)];
  const index = current.findIndex((message) => message.id === messageId);
  if (index < 0) return store.emit();
  const selected = current[index]!;
  if (!selected.text.trim() && selected.attachments.length === 0) {
    return store.withError("Edit this recovered queue item before sending it.");
  }
  if (selected.attachments.some((attachment) => attachment.status === "missing" || attachment.status === "failed")) {
    return store.withError("Repair or remove unavailable attachments before sending this recovered queue item.");
  }

  const selectedSession = store.sessionFromState(sessionRef);
  if (selectedSession?.status === "running") {
    const ready = {
      ...selected,
      mode: "followUp" as const,
      recoveryState: undefined,
      recoveryReason: undefined,
      updatedAt: new Date().toISOString(),
    };
    const reordered = [ready, ...current.filter((message) => message.id !== messageId)];
    store.sessionState.queuedComposerMessagesBySession.set(sessionKey(sessionRef), reordered);
    await store.driver.replaceQueuedMessages(sessionRef, toSessionQueuedMessages(reordered));
    return store.refreshState({ clearLastError: true, markSelectedSessionViewed: false });
  }

  await sendMessageToSession(store, sessionRef, selected.text, selected.attachments, {
    messageMetadata: selected.metadata,
  });
  const remaining = current.filter((message) => message.id !== messageId);
  if (remaining.length > 0) {
    store.sessionState.queuedComposerMessagesBySession.set(sessionKey(sessionRef), remaining);
  } else {
    store.sessionState.queuedComposerMessagesBySession.delete(sessionKey(sessionRef));
  }
  await store.persistQueuedComposerMessages(sessionRef);
  applyMessageMetadataToLatestUserMessage(store, sessionRef, selected.text, selected.metadata);
  return store.refreshState({ clearLastError: true, markSelectedSessionViewed: false });
}

export async function submitComposer(
  store: AppStoreInternals,
  textInput: string,
  options: {
    readonly deliverAs?: "steer" | "followUp";
    readonly messageMetadata?: unknown;
  } = {},
): Promise<DesktopAppState> {
  await store.initialize();
  const text = textInput.trim();
  const sessionRef = store.selectedSessionRef();
  const attachments = sessionRef
    ? store.sessionState.composerAttachmentsBySession.get(sessionKey(sessionRef)) ?? []
    : [];
  if (!text && attachments.length === 0) {
    return store.emit();
  }
  if (!sessionRef) {
    return store.withError("Create or select a session before sending a message.");
  }

  const runtime = store.runtimeByWorkspace.get(sessionRef.workspaceId);
  const sessionCommands = store.sessionState.sessionCommandsBySession.get(sessionKey(sessionRef)) ?? [];
  const runtimeSlashCommand = hasRuntimeSlashCommand(text, runtime, sessionCommands);
  const resolvedRuntimeSlashCommand = runtimeSlashCommand
    ? resolveRuntimeSlashCommand(text, runtime, sessionCommands)
    : undefined;

  const key = sessionKey(sessionRef);
  const unavailableAttachment = attachments.find((attachment) => (attachment.status ?? "ready") !== "ready");
  if (unavailableAttachment) {
    const status = unavailableAttachment.status === "pending"
      ? "still processing"
      : unavailableAttachment.status === "missing"
        ? "is missing"
        : "failed to process";
    return store.withError(`Attachment “${unavailableAttachment.name}” ${status}. Remove it or attach the file again.`);
  }
  const selectedSession = store.sessionFromState(sessionRef);
  const isRunning = selectedSession?.status === "running";
  const editingState = store.getQueuedComposerEditState(sessionRef);
  try {
    if (text.startsWith("/") && !runtimeSlashCommand) {
      const handled = await runComposerCommand(store, sessionRef, text);
      if (handled) {
        return handled;
      }
    }

    if (resolvedRuntimeSlashCommand) {
      const learnedCompatibility = store.getLearnedRuntimeCommandCompatibility(sessionRef.workspaceId, resolvedRuntimeSlashCommand);
      if (learnedCompatibility?.status === "terminal-only") {
        store.sessionState.composerDraftsBySession.set(key, textInput);
        if (attachments.length > 0) {
          store.sessionState.composerAttachmentsBySession.set(key, cloneComposerAttachments(attachments));
          await store.persistComposerAttachments(key, attachments);
        }
        store.state = {
          ...store.state,
          composerDraft: textInput,
          composerDraftSyncSource: "command",
          composerDraftSyncNonce: store.state.composerDraftSyncNonce + 1,
          composerAttachments: cloneComposerAttachments(attachments),
          revision: store.state.revision + 1,
        };
        return store.withError(learnedCompatibility.message);
      }

      store.beginRuntimeCommandExecution(sessionRef, resolvedRuntimeSlashCommand);
    }

    if (isRunning && !resolvedRuntimeSlashCommand) {
      const deliverAs = options.deliverAs ?? "steer";
      const existingQueuedMessage = editingState
        ? store.getQueuedComposerMessages(sessionRef).find((message) => message.id === editingState.messageId)
        : undefined;
      const nextMessage = buildQueuedComposerMessage({
        existing: existingQueuedMessage,
        text,
        attachments,
        mode: deliverAs,
        metadata: options.messageMetadata ?? existingQueuedMessage?.metadata,
      });
      const nextQueuedMessages = editingState
        ? replaceQueuedComposerMessage(
            store.getQueuedComposerMessages(sessionRef),
            editingState.messageId,
            nextMessage,
          )
        : [
            ...store.getQueuedComposerMessages(sessionRef),
            nextMessage,
          ];

      store.sessionState.composerDraftsBySession.delete(key);
      store.sessionState.composerAttachmentsBySession.delete(key);
      store.setQueuedComposerEditState(sessionRef, undefined);
      await store.persistComposerAttachments(key, []);
      const nextSessionQueuedMessages = toSessionQueuedMessages(nextQueuedMessages);
      await store.driver.replaceQueuedMessages(sessionRef, nextSessionQueuedMessages);
      return store.refreshState({
        clearLastError: true,
        markSelectedSessionViewed: false,
      });
    }

    if (editingState && !resolvedRuntimeSlashCommand) {
      const existingQueuedMessage = store.getQueuedComposerMessages(sessionRef)
        .find((message) => message.id === editingState.messageId);
      if (existingQueuedMessage) {
        const replacement = {
          ...buildQueuedComposerMessage({
            existing: existingQueuedMessage,
            text,
            attachments,
            mode: existingQueuedMessage.mode,
            metadata: options.messageMetadata ?? existingQueuedMessage.metadata,
          }),
          recoveryState: "stale" as const,
          recoveryReason: "Recovered after the previous app session ended. Review or send it again.",
        };
        const next = replaceQueuedComposerMessage(
          store.getQueuedComposerMessages(sessionRef),
          editingState.messageId,
          replacement,
        );
        store.sessionState.queuedComposerMessagesBySession.set(key, next);
        store.sessionState.composerDraftsBySession.delete(key);
        store.sessionState.composerAttachmentsBySession.delete(key);
        store.setQueuedComposerEditState(sessionRef, undefined);
        await store.persistComposerAttachments(key, []);
        await store.persistQueuedComposerMessages(sessionRef);
        return store.refreshState({ clearLastError: true, markSelectedSessionViewed: false });
      }
    }

    await sendMessageToSession(store, sessionRef, text, attachments, { messageMetadata: options.messageMetadata });
    const runtimeCommandOutcome = resolvedRuntimeSlashCommand
      ? store.finishRuntimeCommandExecution(sessionRef)
      : undefined;
    if (runtimeSlashCommand) {
      await store.refreshSessionCommandsFor(sessionRef);
    }
    const nextState = await store.refreshState({
      clearLastError: !runtimeCommandOutcome?.blockedMessage,
      markSelectedSessionViewed: false,
    });
    applyMessageMetadataToLatestUserMessage(store, sessionRef, text, options.messageMetadata);
    return nextState;
  } catch (error) {
    if (text.startsWith("/")) {
      void appendAgentActivity({
        severity: "error",
        category: "slash-command",
        event: "slash_command_failed",
        title: "Slash command failed",
        message: error instanceof Error ? error.message : String(error),
        workspaceId: sessionRef.workspaceId,
        sessionId: sessionRef.sessionId,
      });
    }
    if (resolvedRuntimeSlashCommand) {
      store.finishRuntimeCommandExecution(sessionRef);
    }
    if (textInput) {
      store.sessionState.composerDraftsBySession.set(key, textInput);
    }
    if (attachments.length > 0) {
      store.sessionState.composerAttachmentsBySession.set(key, cloneComposerAttachments(attachments));
      await store.persistComposerAttachments(key, attachments);
    }
    if (editingState) {
      store.setQueuedComposerEditState(sessionRef, editingState);
    }
    store.state = {
      ...store.state,
      composerDraft: textInput,
      composerDraftSyncSource: "command",
      composerDraftSyncNonce: store.state.composerDraftSyncNonce + 1,
      composerAttachments: attachments.length > 0 ? cloneComposerAttachments(attachments) : [],
      revision: store.state.revision + 1,
    };
    return store.withError(error);
  }
}

export async function setSessionModel(
  store: AppStoreInternals,
  target: WorkspaceSessionTarget,
  provider: string,
  modelId: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = toSessionRef(target);
  const key = sessionKey(sessionRef);

  return store.withErrorHandling(async () => {
    await store.driver.setSessionModel(sessionRef, { provider, modelId });
    syncSessionConfig(store, key, { provider, modelId });
    return finishComposerCommand(store, sessionRef, key, `Model set to ${provider}:${modelId}`);
  });
}

export async function setSessionThinkingLevel(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  thinkingLevel: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const key = sessionKey(sessionRef);
  return store.withErrorHandling(async () => {
    await store.driver.setSessionThinkingLevel(sessionRef, thinkingLevel);
    syncSessionConfig(store, key, { thinkingLevel });
    return finishComposerCommand(store, sessionRef, key, `Thinking set to ${thinkingLevel}`);
  });
}

export async function setSessionToolAccess(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  toolAccess: ToolAccessSelection,
): Promise<DesktopAppState> {
  await store.initialize();
  const key = sessionKey(sessionRef);
  return store.withErrorHandling(async () => {
    await store.driver.setSessionToolAccess(sessionRef, toolAccess);
    syncSessionConfig(store, key, { toolAccess });
    return finishComposerCommand(store, sessionRef, key, `Tool access set to ${toolAccess.mode}`);
  });
}

export async function submitComposerToSession(
  store: AppStoreInternals,
  target: WorkspaceSessionTarget,
  textInput: string,
  options: {
    readonly attachments?: readonly ComposerAttachment[];
    readonly deliverAs?: "steer" | "followUp";
    readonly messageMetadata?: unknown;
  } = {},
): Promise<DesktopAppState> {
  await store.initialize();
  const text = textInput.trim();
  const attachments = options.attachments ?? [];
  if (!text && attachments.length === 0) {
    return store.emit();
  }

  const sessionRef = toSessionRef(target);
  const selectedSession = store.sessionFromState(sessionRef);
  if (!selectedSession) {
    return store.withError("Select an existing thread before sending a message.");
  }

  const key = sessionKey(sessionRef);
  const unavailableAttachment = attachments.find((attachment) => (attachment.status ?? "ready") !== "ready");
  if (unavailableAttachment) {
    const status = unavailableAttachment.status === "pending"
      ? "still processing"
      : unavailableAttachment.status === "missing"
        ? "is missing"
        : "failed to process";
    return store.withError(`Attachment “${unavailableAttachment.name}” ${status}. Remove it or attach the file again.`);
  }
  await store.ensureRuntimeLoaded(sessionRef.workspaceId);
  const runtime = store.runtimeByWorkspace.get(sessionRef.workspaceId);
  const sessionCommands = store.sessionState.sessionCommandsBySession.get(key) ?? [];
  const runtimeSlashCommand = hasRuntimeSlashCommand(text, runtime, sessionCommands);

  if (text.startsWith("/") && !runtimeSlashCommand) {
    const handled = await runComposerCommand(store, sessionRef, text);
    if (handled) {
      return handled;
    }
  }

  const isRunning = selectedSession.status === "running";
  try {
    if (isRunning) {
      const deliverAs = options.deliverAs ?? "steer";
      const nextMessage = buildQueuedComposerMessage({
        text,
        attachments,
        mode: deliverAs,
        metadata: options.messageMetadata,
      });
      const nextQueuedMessages = [
        ...store.getQueuedComposerMessages(sessionRef),
        nextMessage,
      ];
      const nextSessionQueuedMessages = toSessionQueuedMessages(nextQueuedMessages);
      await store.driver.replaceQueuedMessages(sessionRef, nextSessionQueuedMessages);
      store.sessionState.composerDraftsBySession.delete(key);
      store.sessionState.composerAttachmentsBySession.delete(key);
      await store.persistComposerAttachments(key, []);
      return store.refreshState({
        clearLastError: true,
        markSelectedSessionViewed: false,
      });
    }

    await sendMessageToSession(store, sessionRef, text, attachments, { messageMetadata: options.messageMetadata });
    const nextState = await store.refreshState({
      clearLastError: true,
      markSelectedSessionViewed: false,
    });
    applyMessageMetadataToLatestUserMessage(store, sessionRef, text, options.messageMetadata);
    return nextState;
  } catch (error) {
    store.sessionState.sessionErrorsBySession.set(key, error instanceof Error ? error.message : String(error));
    return store.withError(error);
  }
}

export async function cancelCurrentRun(store: AppStoreInternals): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  return cancelSessionRun(store, sessionRef);
}

export async function cancelSessionRun(store: AppStoreInternals, target: WorkspaceSessionTarget): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = toSessionRef(target);
  if (!store.sessionFromState(sessionRef)) {
    return store.emit();
  }

  return store.withErrorHandling(async () => {
    await store.driver.cancelCurrentRun(sessionRef);
    clearActiveAssistantMessage(store.sessionState.activeAssistantMessageBySession, sessionRef);
    store.sessionState.sessionErrorsBySession.delete(sessionKey(sessionRef));
    store.state = {
      ...store.state,
      lastError: undefined,
      revision: store.state.revision + 1,
    };
    store.schedulePersistUiState();
    return store.emit();
  });
}

/* ── Internal helpers ───────────────────────────────────── */

export async function sendMessageToSession(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  text: string,
  attachments: readonly ComposerAttachment[],
  options: {
    readonly rollbackOptimisticMessageOnError?: boolean;
    readonly messageMetadata?: unknown;
  } = {},
): Promise<void> {
  const key = sessionKey(sessionRef);
  const rollbackOptimisticMessageOnError = options.rollbackOptimisticMessageOnError ?? true;
  const previousDraft = store.sessionState.composerDraftsBySession.get(key) ?? text;
  const previousAttachments = cloneComposerAttachments(
    store.sessionState.composerAttachmentsBySession.get(key) ?? attachments,
  );
  if (!store.sessionState.loadedTranscriptKeys.has(key)) {
    await store.ensureSessionReady(sessionRef);
  }
  if (store.sessionFromState(sessionRef)?.archivedAt) {
    await store.driver.unarchiveSession(sessionRef);
  }
  appendUserMessage(
    store.sessionState.transcriptCache,
    sessionRef,
    text,
    toTranscriptAttachments(attachments),
    options.messageMetadata,
  );
  markSessionOptimisticallyRunning(store, sessionRef);
  store.publishSelectedTranscriptFor(sessionRef);
  store.persistTranscriptCacheForSession(sessionRef);
  store.schedulePersistUiState();
  store.emit();
  clearActiveAssistantMessage(store.sessionState.activeAssistantMessageBySession, sessionRef);
  store.sessionState.sessionErrorsBySession.delete(key);
  try {
    await store.driver.sendUserMessage(sessionRef, {
      text: toProviderMessageText(text, options.messageMetadata),
      attachments: toSessionAttachments(attachments),
      ...(options.messageMetadata !== undefined ? { metadata: options.messageMetadata } : {}),
    });
    store.sessionState.composerDraftsBySession.delete(key);
    store.sessionState.composerAttachmentsBySession.delete(key);
    await store.persistComposerAttachments(key, []);
  } catch (error) {
    if (previousDraft) {
      store.sessionState.composerDraftsBySession.set(key, previousDraft);
    }
    if (previousAttachments.length > 0) {
      store.sessionState.composerAttachmentsBySession.set(key, previousAttachments);
    }
    await store.persistComposerAttachments(key, previousAttachments);
    if (rollbackOptimisticMessageOnError) {
      const transcript = store.sessionState.transcriptCache.get(key) ?? [];
      store.sessionState.transcriptCache.set(key, transcript.slice(0, -1));
      clearOptimisticRunningState(store, sessionRef);
      store.publishSelectedTranscriptFor(sessionRef);
      store.persistTranscriptCacheForSession(sessionRef);
      store.schedulePersistUiState();
      store.emit();
    }
    throw error;
  }
}

function markSessionOptimisticallyRunning(store: AppStoreInternals, sessionRef: SessionRef): void {
  const key = sessionKey(sessionRef);
  const timestamp = new Date().toISOString();
  const transcript = (store.sessionState.transcriptCache.get(key) ?? []) as readonly TranscriptMessage[];
  const preview = previewFromTranscript(transcript);
  store.sessionState.runningSinceBySession.set(key, timestamp);
  store.state = {
    ...store.state,
    workspaces: store.state.workspaces.map((workspace) => workspace.id === sessionRef.workspaceId
      ? {
          ...workspace,
          sessions: workspace.sessions.map((session) => session.id === sessionRef.sessionId
            ? updateSessionRecord(session, {
                status: "running",
                snapshot: { updatedAt: timestamp },
                transcript,
                preview,
                runningSince: timestamp,
                lastViewedAt: store.sessionState.lastViewedAtBySession.get(key),
              })
            : session),
        }
      : workspace),
    revision: store.state.revision + 1,
  };
}

function clearOptimisticRunningState(store: AppStoreInternals, sessionRef: SessionRef): void {
  const key = sessionKey(sessionRef);
  store.sessionState.runningSinceBySession.delete(key);
  const transcript = (store.sessionState.transcriptCache.get(key) ?? []) as readonly TranscriptMessage[];
  const preview = previewFromTranscript(transcript);
  store.state = {
    ...store.state,
    workspaces: store.state.workspaces.map((workspace) => workspace.id === sessionRef.workspaceId
      ? {
          ...workspace,
          sessions: workspace.sessions.map((session) => session.id === sessionRef.sessionId
            ? updateSessionRecord(session, {
                status: "idle",
                transcript,
                preview,
                runningSince: undefined,
                lastViewedAt: store.sessionState.lastViewedAtBySession.get(key),
              })
            : session),
        }
      : workspace),
    revision: store.state.revision + 1,
  };
}

function buildQueuedComposerMessage(options: {
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly mode: "steer" | "followUp";
  readonly metadata?: unknown;
  readonly existing?: QueuedComposerMessage;
}): QueuedComposerMessage {
  const timestamp = new Date().toISOString();
  return {
    id: options.existing?.id ?? randomUUID(),
    text: options.text,
    mode: options.mode,
    attachments: cloneComposerAttachments(options.attachments),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    createdAt: options.existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function applyMessageMetadataToLatestUserMessage(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  text: string,
  metadata: unknown,
): void {
  if (metadata === undefined) {
    return;
  }
  const key = sessionKey(sessionRef);
  const transcript = store.sessionState.transcriptCache.get(key);
  if (!transcript) {
    return;
  }
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind !== "message" || item.role !== "user" || item.text !== text) {
      continue;
    }
    if (item.metadata !== undefined) {
      return;
    }
    transcript[index] = { ...item, metadata };
    store.sessionState.transcriptCache.set(key, transcript);
    store.publishSelectedTranscriptFor(sessionRef);
    store.persistTranscriptCacheForSession(sessionRef);
    return;
  }
}

function replaceQueuedComposerMessage(
  messages: readonly QueuedComposerMessage[],
  messageId: string,
  replacement: QueuedComposerMessage,
): QueuedComposerMessage[] {
  return messages.map((message) => (message.id === messageId ? replacement : message));
}

/** Eagerly merge config fields so finishComposerCommand sees them before the async sessionUpdated event arrives. */
function syncSessionConfig(store: AppStoreInternals, key: string, patch: Partial<SessionConfig>): void {
  const current = store.sessionState.sessionConfigBySession.get(key) ?? {};
  store.sessionState.sessionConfigBySession.set(key, { ...current, ...patch });
}

async function runComposerCommand(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  commandText: string,
): Promise<DesktopAppState | undefined> {
  const parsed = parseComposerCommand(commandText);
  if (!parsed) {
    const message = incompleteComposerCommandMessage(commandText);
    if (message) {
      return store.withError(message);
    }
    return undefined;
  }

  const key = sessionKey(sessionRef);

  if (parsed.type === "model") {
    await store.driver.setSessionModel(sessionRef, {
      provider: parsed.provider,
      modelId: parsed.modelId,
    });
    syncSessionConfig(store, key, { provider: parsed.provider, modelId: parsed.modelId });
    return finishComposerCommand(store, sessionRef, key, `Model set to ${parsed.provider}:${parsed.modelId}`);
  }

  if (parsed.type === "thinking") {
    await store.driver.setSessionThinkingLevel(sessionRef, parsed.thinkingLevel);
    syncSessionConfig(store, key, { thinkingLevel: parsed.thinkingLevel });
    return finishComposerCommand(store, sessionRef, key, `Thinking set to ${parsed.thinkingLevel}`);
  }

  if (parsed.type === "status") {
    return finishComposerCommand(
      store,
      sessionRef,
      key,
      formatSessionConfigStatus(store.sessionState.sessionConfigBySession.get(key)),
    );
  }

  if (parsed.type === "session") {
    const workspace = store.state.workspaces.find((entry) => entry.id === sessionRef.workspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === sessionRef.sessionId);
    const parts = [
      `Session ${session?.title ?? sessionRef.sessionId}`,
      `ID ${sessionRef.sessionId}`,
      workspace ? `Workspace ${workspace.name}` : undefined,
      session ? `Status ${session.status}` : undefined,
    ].filter(Boolean);
    return finishComposerCommand(store, sessionRef, key, parts.join(" · "));
  }

  if (parsed.type === "name") {
    store.clearPendingAutoTitle(sessionRef);
    await store.driver.renameSession(sessionRef, parsed.title);
    return finishComposerCommand(store, sessionRef, key, `Session renamed to ${parsed.title}`);
  }

  if (parsed.type === "compact") {
    await store.driver.compactSession(sessionRef, parsed.customInstructions);
    await store.reloadTranscriptFromDriver(sessionRef);
    return finishComposerCommand(store, sessionRef, key, "Compacted session context");
  }

  if (parsed.type === "reload") {
    store.clearExtensionUiForSession(sessionRef);
    await store.driver.reloadSession(sessionRef);
    await store.refreshSessionCommandsFor(sessionRef);
    return finishComposerCommand(store, sessionRef, key, "Reloaded session resources");
  }

  if (parsed.type === "review") {
    store.sessionState.composerDraftsBySession.delete(key);
    store.sessionState.composerAttachmentsBySession.delete(key);
    store.state = {
      ...store.state,
      activeView: "review",
      reviewRequest: { base: parsed.base, agent: parsed.agent, nonce: Date.now() },
      composerDraft: "",
      composerDraftSyncSource: "command",
      composerDraftSyncNonce: store.state.composerDraftSyncNonce + 1,
      composerAttachments: [],
      lastError: undefined,
      revision: store.state.revision + 1,
    };
    store.schedulePersistUiState();
    return store.emit();
  }

  return store.withError(`Unsupported slash command: ${commandText}`);
}

function appendLocalActivity(store: AppStoreInternals, sessionRef: SessionRef, label: string): void {
  const key = sessionKey(sessionRef);
  const transcript = [...(store.sessionState.transcriptCache.get(key) ?? [])];
  transcript.push(makeActivityItem(label));
  store.sessionState.transcriptCache.set(key, transcript);
  store.persistTranscriptCacheForSession(sessionRef);
}

function finishComposerCommand(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  key: string,
  label: string,
): DesktopAppState {
  store.sessionState.composerDraftsBySession.delete(key);
  store.sessionState.composerAttachmentsBySession.delete(key);
  appendLocalActivity(store, sessionRef, label);
  const transcript = store.sessionState.transcriptCache.get(key) ?? [];
  const preview = previewFromTranscript(transcript);
  store.state = {
    ...store.state,
    workspaces: store.state.workspaces.map((workspace) =>
      workspace.id === sessionRef.workspaceId
        ? {
            ...workspace,
            sessions: workspace.sessions.map((session) =>
              session.id === sessionRef.sessionId
                ? {
                    ...session,
                    preview: preview ?? session.preview,
                    config: store.sessionState.sessionConfigBySession.get(key),
                  }
                : session,
            ),
          }
        : workspace,
    ),
    composerDraft: "",
    composerDraftSyncSource: "command",
    composerDraftSyncNonce: store.state.composerDraftSyncNonce + 1,
    composerAttachments: [],
    lastError: undefined,
    revision: store.state.revision + 1,
  };
  store.schedulePersistUiState();
  const snapshot = store.emit();
  store.publishSelectedTranscriptFor(sessionRef);
  return snapshot;
}
