import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_TOOL_ACCESS, type ToolAccessSelection } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  ComposerAttachment,
  ComposerImageAttachment,
  DesktopAppState,
  NewThreadEnvironment,
  StartThreadInput,
  WorkspaceRecord,
} from "../../desktop-state";
import { readComposerAttachmentsFromFiles } from "../../composer-attachments";
import { parseTreeComposerCommand } from "../../composer-commands";
import { resolveRepoWorkspaceId } from "../../workspace-roots";

interface StartNewThreadOptions {
  readonly api: typeof window.piApp;
  readonly modelSelectionRequired: boolean;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly toolAccess: ToolAccessSelection;
  readonly runtime: RuntimeSnapshot | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly onExpandWorkspace: (workspaceId: string) => void;
  readonly onFocusComposer: () => void;
  readonly onRecordSubmittedSkillUsage: (prompt: string, runtime: RuntimeSnapshot | undefined) => void;
}

interface UseNewThreadStateOptions {
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly snapshot: DesktopAppState | null;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
}

export function useNewThreadState({
  rootWorkspace,
  rootWorkspaceOptions,
  snapshot,
  visibleWorkspaces,
}: UseNewThreadStateOptions) {
  const [pendingNewThreadWorkspaceId, setPendingNewThreadWorkspaceId] = useState("");
  const [newThreadRootWorkspaceId, setNewThreadRootWorkspaceId] = useState("");
  const [newThreadEnvironment, setNewThreadEnvironment] = useState<NewThreadEnvironment>("local");
  const [newThreadPrompt, setNewThreadPrompt] = useState("");
  const [newThreadAttachments, setNewThreadAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [newThreadProvider, setNewThreadProvider] = useState<string | undefined>();
  const [newThreadModelId, setNewThreadModelId] = useState<string | undefined>();
  const [newThreadThinkingLevel, setNewThreadThinkingLevel] = useState<string | undefined>();
  const [newThreadToolAccess, setNewThreadToolAccess] = useState<ToolAccessSelection>(DEFAULT_TOOL_ACCESS);
  const [newThreadComposerError, setNewThreadComposerError] = useState<string | undefined>();

  const resetNewThreadSurface = useCallback((workspaceId?: string) => {
    const nextWorkspaceId =
      (workspaceId && (
        rootWorkspaceOptions.find((workspace) => workspace.id === workspaceId)?.id ||
        (snapshot ? resolveRepoWorkspaceId(snapshot.workspaces, workspaceId) : undefined)
      )) ||
      rootWorkspace?.id ||
      visibleWorkspaces[0]?.id ||
      "";
    if (nextWorkspaceId) {
      setNewThreadRootWorkspaceId(nextWorkspaceId);
    }
    setNewThreadEnvironment("local");
    setNewThreadPrompt("");
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadToolAccess(DEFAULT_TOOL_ACCESS);
    setNewThreadComposerError(undefined);
  }, [rootWorkspace?.id, rootWorkspaceOptions, snapshot, visibleWorkspaces]);

  const updateNewThreadPrompt = useCallback((value: SetStateAction<string>) => {
    setNewThreadComposerError(undefined);
    setNewThreadPrompt(value);
  }, []);

  const handleSelectNewThreadWorkspace = useCallback((workspaceId: string) => {
    setPendingNewThreadWorkspaceId("");
    setNewThreadRootWorkspaceId(workspaceId);
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerError(undefined);
  }, []);

  const handleNewThreadAddAttachments = useCallback((files: File[]) => {
    void readComposerAttachmentsFromFiles(files).then((attachments) => {
      if (attachments.length === 0) {
        return;
      }
      setNewThreadAttachments((current) => [...current, ...attachments]);
    });
  }, []);

  const handleNewThreadRemoveAttachment = useCallback((attachmentId: string) => {
    setNewThreadAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const addNewThreadClipboardImage = useCallback((clipboardImage: ComposerImageAttachment) => {
    setNewThreadAttachments((current) => [...current, clipboardImage]);
  }, []);

  const selectLocalNewThreadCheckout = useCallback((workspaceId: string) => {
    setNewThreadRootWorkspaceId(workspaceId);
    setNewThreadEnvironment("local");
  }, []);

  const selectWorktreeNewThreadCheckout = useCallback((workspaceId: string) => {
    setNewThreadRootWorkspaceId(workspaceId);
    setNewThreadEnvironment("worktree");
  }, []);

  const handleStartThread = useCallback(({
    api,
    modelSelectionRequired,
    provider,
    modelId,
    thinkingLevel,
    toolAccess,
    runtime,
    setSnapshot,
    onExpandWorkspace,
    onFocusComposer,
    onRecordSubmittedSkillUsage,
  }: StartNewThreadOptions) => {
    if (!api || !newThreadRootWorkspaceId || (!newThreadPrompt.trim() && newThreadAttachments.length === 0)) {
      return;
    }
    if (modelSelectionRequired) {
      return;
    }
    const treeCommand = parseTreeComposerCommand(newThreadPrompt);
    if (treeCommand?.type === "error") {
      setNewThreadComposerError(treeCommand.message);
      return;
    }
    if (treeCommand?.type === "tree") {
      setNewThreadComposerError("/tree is only available inside an existing session.");
      return;
    }
    onRecordSubmittedSkillUsage(newThreadPrompt, runtime);
    const input: StartThreadInput = {
      rootWorkspaceId: newThreadRootWorkspaceId,
      environment: newThreadEnvironment,
      prompt: newThreadPrompt,
      attachments: newThreadAttachments,
      provider,
      modelId,
      thinkingLevel,
      toolAccess,
    };
    onExpandWorkspace(newThreadRootWorkspaceId);
    void api.startThread(input).then(() => api.getState()).then((state) => {
      setSnapshot(state);
      setNewThreadPrompt("");
      setNewThreadAttachments([]);
      setNewThreadProvider(undefined);
      setNewThreadModelId(undefined);
      setNewThreadThinkingLevel(undefined);
      setNewThreadToolAccess(DEFAULT_TOOL_ACCESS);
      setNewThreadEnvironment("local");
      window.requestAnimationFrame(() => {
        onFocusComposer();
      });
    });
  }, [newThreadAttachments, newThreadEnvironment, newThreadPrompt, newThreadRootWorkspaceId]);

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setPendingNewThreadWorkspaceId("");
      setNewThreadRootWorkspaceId("");
      setNewThreadEnvironment("local");
      setNewThreadAttachments([]);
      return;
    }
    setNewThreadRootWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
  }, [rootWorkspaceOptions]);

  useEffect(() => {
    if (!snapshot || !pendingNewThreadWorkspaceId) {
      return;
    }
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, pendingNewThreadWorkspaceId);
    if (!nextRootWorkspaceId || !rootWorkspaceOptions.some((workspace) => workspace.id === nextRootWorkspaceId)) {
      return;
    }
    setNewThreadRootWorkspaceId(nextRootWorkspaceId);
    setPendingNewThreadWorkspaceId("");
  }, [pendingNewThreadWorkspaceId, rootWorkspaceOptions, snapshot]);

  return {
    addNewThreadClipboardImage,
    handleNewThreadAddAttachments,
    handleNewThreadRemoveAttachment,
    handleSelectNewThreadWorkspace,
    handleStartThread,
    newThreadAttachments,
    newThreadComposerError,
    newThreadEnvironment,
    newThreadModelId,
    newThreadPrompt,
    newThreadProvider,
    newThreadRootWorkspaceId,
    newThreadThinkingLevel,
    newThreadToolAccess,
    resetNewThreadSurface,
    selectLocalNewThreadCheckout,
    selectWorktreeNewThreadCheckout,
    setNewThreadAttachments,
    setNewThreadEnvironment,
    setNewThreadModelId,
    setNewThreadProvider,
    setNewThreadPrompt,
    setNewThreadRootWorkspaceId,
    setNewThreadThinkingLevel,
    setNewThreadToolAccess,
    setPendingNewThreadWorkspaceId,
    updateNewThreadPrompt,
  };
}
