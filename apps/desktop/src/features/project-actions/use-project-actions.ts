import { useCallback, useMemo, useState } from "react";
import type { AppView, SessionRecord, WorkspaceRecord } from "../../desktop-state";
import {
  createProjectAction,
  loadProjectActions,
  saveProjectActions,
  type ProjectActionRecord,
  type ProjectActionsByWorkspace,
} from "../../project-actions";
import {
  buildCommandPreview,
  type CommandPreview,
} from "../../product-experience/command-preview";

interface SaveProjectActionInput {
  readonly name: string;
  readonly command: string;
  readonly keybinding?: string;
  readonly runOnWorktreeCreation: boolean;
}

interface UseProjectActionsOptions {
  readonly activeView: AppView | undefined;
  readonly api: NonNullable<typeof window.piApp> | undefined;
  readonly newThreadWorkspace: WorkspaceRecord | undefined;
  readonly onOpenTerminalForSession: (sessionKey: string) => void;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
}

export function useProjectActions({
  activeView,
  api,
  newThreadWorkspace,
  onOpenTerminalForSession,
  selectedSession,
  selectedSessionKey,
  selectedWorkspace,
}: UseProjectActionsOptions) {
  const [projectActionsByWorkspace, setProjectActionsByWorkspace] =
    useState<ProjectActionsByWorkspace>(() => loadProjectActions());
  const [addActionDialogOpen, setAddActionDialogOpen] = useState(false);
  const [pendingCommandPreview, setPendingCommandPreview] = useState<{
    readonly action: ProjectActionRecord;
    readonly preview: CommandPreview;
  }>();

  const selectedProjectActions = selectedWorkspace
    ? projectActionsByWorkspace[selectedWorkspace.rootWorkspaceId || selectedWorkspace.id] ?? []
    : [];
  const newThreadProjectActions = newThreadWorkspace
    ? projectActionsByWorkspace[newThreadWorkspace.rootWorkspaceId || newThreadWorkspace.id] ?? []
    : [];
  const topbarProjectActions = activeView === "new-thread" ? newThreadProjectActions : selectedProjectActions;

  const openAddActionDialog = useCallback(() => {
    setAddActionDialogOpen(true);
  }, []);

  const closeAddActionDialog = useCallback(() => {
    setAddActionDialogOpen(false);
  }, []);

  const saveProjectAction = useCallback((input: SaveProjectActionInput) => {
    const targetWorkspace = activeView === "new-thread" ? newThreadWorkspace : selectedWorkspace;
    const workspaceId = targetWorkspace?.rootWorkspaceId || targetWorkspace?.id;
    if (!workspaceId) {
      return;
    }

    const action = createProjectAction({ workspaceId, ...input });
    setProjectActionsByWorkspace((current) => {
      const next = {
        ...current,
        [workspaceId]: [...(current[workspaceId] ?? []), action],
      };
      saveProjectActions(next);
      return next;
    });
    setAddActionDialogOpen(false);
  }, [activeView, newThreadWorkspace, selectedWorkspace]);

  const executeProjectAction = useCallback((action: ProjectActionRecord) => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    onOpenTerminalForSession(selectedSessionKey);
    void api.ensureTerminalPanel(selectedWorkspace.id, selectedSession.id, { cols: 80, rows: 24 }).then((panel) => {
      const terminalId = panel.activeSessionId;
      if (terminalId) {
        void api.writeTerminal(terminalId, `${action.command.trim()}\n`).then(() =>
          api.recordProjectActionEvidence({
            workspaceId: selectedWorkspace.id,
            sessionId: selectedSession.id,
            actionId: action.id,
            actionName: action.name,
            command: action.command,
          }));
      }
    });
  }, [api, onOpenTerminalForSession, selectedSession, selectedSessionKey, selectedWorkspace]);

  const runProjectAction = useCallback((action: ProjectActionRecord) => {
    if (!selectedWorkspace) return;
    const preview = buildCommandPreview({
      id: action.id,
      origin: "saved-project-action",
      command: action.command,
      cwd: selectedWorkspace.path,
    });
    if (preview.requiresConfirmation) {
      setPendingCommandPreview({ action, preview });
      return;
    }
    executeProjectAction(action);
  }, [executeProjectAction, selectedWorkspace]);

  const previewAgentCommand = useCallback((command: string) => {
    if (!selectedWorkspace || !command.trim()) return;
    const action: ProjectActionRecord = {
      id: `agent-command-${crypto.randomUUID()}`,
      workspaceId: selectedWorkspace.id,
      name: "Assistant shell snippet",
      command: command.trim(),
      runOnWorktreeCreation: false,
    };
    setPendingCommandPreview({
      action,
      preview: buildCommandPreview({
        id: action.id,
        origin: "agent-proposed",
        command: action.command,
        cwd: selectedWorkspace.path,
        confirmationThreshold: "routine",
      }),
    });
  }, [selectedWorkspace]);

  const confirmCommandPreview = useCallback(() => {
    const pending = pendingCommandPreview;
    if (!pending || !api || !selectedWorkspace || !selectedSession) return;
    setPendingCommandPreview(undefined);
    void api.recordCommandPreviewDecision({
      workspaceId: selectedWorkspace.id,
      sessionId: selectedSession.id,
      previewId: pending.preview.id,
      origin: pending.preview.origin,
      risk: pending.preview.risk,
      decision: "approved",
      command: pending.preview.command,
      cwd: pending.preview.cwd,
    }).then(() => executeProjectAction(pending.action));
  }, [api, executeProjectAction, pendingCommandPreview, selectedSession, selectedWorkspace]);

  const denyCommandPreview = useCallback(() => {
    const pending = pendingCommandPreview;
    if (!pending || !api || !selectedWorkspace || !selectedSession) return;
    setPendingCommandPreview(undefined);
    void api.recordCommandPreviewDecision({
      workspaceId: selectedWorkspace.id,
      sessionId: selectedSession.id,
      previewId: pending.preview.id,
      origin: pending.preview.origin,
      risk: pending.preview.risk,
      decision: "denied",
      command: pending.preview.command,
      cwd: pending.preview.cwd,
    });
  }, [api, pendingCommandPreview, selectedSession, selectedWorkspace]);

  return useMemo(() => ({
    addActionDialogOpen,
    closeAddActionDialog,
    confirmCommandPreview,
    denyCommandPreview,
    openAddActionDialog,
    previewAgentCommand,
    runProjectAction,
    saveProjectAction,
    topbarProjectActions,
    pendingCommandPreview: pendingCommandPreview?.preview,
  }), [
    addActionDialogOpen,
    closeAddActionDialog,
    confirmCommandPreview,
    denyCommandPreview,
    openAddActionDialog,
    previewAgentCommand,
    runProjectAction,
    saveProjectAction,
    topbarProjectActions,
    pendingCommandPreview,
  ]);
}
