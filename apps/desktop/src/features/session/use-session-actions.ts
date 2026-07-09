import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { DesktopAppState, WorkspaceRecord, WorkspaceSessionTarget } from "../../desktop-state";

interface SessionTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
}

interface UseSessionActionsOptions {
  readonly api: NonNullable<typeof window.piApp> | undefined;
  readonly focusComposer: () => void;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateVsCodeTarget: (workspace: WorkspaceRecord) => void;
  readonly vsCodeOpen: boolean;
  readonly workspaces: readonly WorkspaceRecord[];
}

export function useSessionActions({
  api,
  focusComposer,
  setSnapshot,
  updateVsCodeTarget,
  vsCodeOpen,
  workspaces,
}: UseSessionActionsOptions) {
  const handleOpenSubagentRunTarget = useCallback((target: WorkspaceSessionTarget) => {
    if (!api) {
      return;
    }

    setSnapshot((current) => current ? applySessionSelection(current, target, "threads") : current);
    void api.selectSession(target).then(() => {
      void api.setActiveView("threads");
      focusComposer();
    });
  }, [api, focusComposer, setSnapshot]);

  const handleArchiveSession = useCallback((target: SessionTarget) => {
    if (!api) {
      return;
    }
    void api.archiveSession(target);
  }, [api]);

  const handleSelectSession = useCallback((target: SessionTarget) => {
    if (!api) {
      return;
    }

    if (vsCodeOpen) {
      const targetWorkspace = workspaces.find((workspace) => workspace.id === target.workspaceId);
      if (targetWorkspace) {
        updateVsCodeTarget(targetWorkspace);
      }
    }

    setSnapshot((current) => current ? applySessionSelection(current, target) : current);
    void api.selectSession(target).then(() => {
      focusComposer();
    });
  }, [api, focusComposer, setSnapshot, updateVsCodeTarget, vsCodeOpen, workspaces]);

  const handleUnarchiveSession = useCallback((target: SessionTarget) => {
    if (!api) {
      return;
    }
    void api.unarchiveSession(target);
  }, [api]);

  return {
    handleArchiveSession,
    handleOpenSubagentRunTarget,
    handleSelectSession,
    handleUnarchiveSession,
  };
}

function applySessionSelection(
  state: DesktopAppState,
  target: WorkspaceSessionTarget,
  activeView?: DesktopAppState["activeView"],
): DesktopAppState {
  const targetWorkspace = state.workspaces.find((workspace) => workspace.id === target.workspaceId);
  const targetSession = targetWorkspace?.sessions.find((session) => session.id === target.sessionId);
  if (!targetWorkspace || !targetSession) {
    return activeView ? { ...state, activeView, lastError: undefined } : state;
  }
  return {
    ...state,
    selectedWorkspaceId: target.workspaceId,
    selectedSessionId: target.sessionId,
    activeView: activeView ?? state.activeView,
    lastError: undefined,
  };
}
