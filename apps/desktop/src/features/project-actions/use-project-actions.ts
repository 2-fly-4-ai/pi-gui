import { useCallback, useMemo, useState } from "react";
import type { AppView, SessionRecord, WorkspaceRecord } from "../../desktop-state";
import {
  createProjectAction,
  loadProjectActions,
  saveProjectActions,
  type ProjectActionRecord,
  type ProjectActionsByWorkspace,
} from "../../project-actions";

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

  const runProjectAction = useCallback((action: ProjectActionRecord) => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    onOpenTerminalForSession(selectedSessionKey);
    void api.ensureTerminalPanel(selectedWorkspace.id, selectedSession.id, { cols: 80, rows: 24 }).then((panel) => {
      const terminalId = panel.activeSessionId;
      if (terminalId) {
        void api.writeTerminal(terminalId, `${action.command.trim()}\n`);
      }
    });
  }, [api, onOpenTerminalForSession, selectedSession, selectedSessionKey, selectedWorkspace]);

  return useMemo(() => ({
    addActionDialogOpen,
    closeAddActionDialog,
    openAddActionDialog,
    runProjectAction,
    saveProjectAction,
    topbarProjectActions,
  }), [
    addActionDialogOpen,
    closeAddActionDialog,
    openAddActionDialog,
    runProjectAction,
    saveProjectAction,
    topbarProjectActions,
  ]);
}
