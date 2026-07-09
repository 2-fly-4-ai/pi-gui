import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppView, DesktopAppState, SessionRecord, WorkspaceRecord } from "../../desktop-state";
import type { PiDesktopApi } from "../../ipc";
import { resolveRepoWorkspaceId } from "../../workspace-roots";

interface UseAppViewNavigationOptions {
  readonly api: PiDesktopApi | undefined;
  readonly activeView: AppView | undefined;
  readonly openVsCodeForWorkspace: (workspaceId: string, folderPath: string) => void;
  readonly resetNewThreadSurface: (workspaceId?: string) => void;
  readonly resetReviewSurface: () => void;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly setNewThreadRootWorkspaceId: (workspaceId: string) => void;
  readonly setPendingNewThreadWorkspaceId: (workspaceId: string) => void;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly vsCodeOpen: boolean;
  readonly workspaces: readonly WorkspaceRecord[];
}

export function useAppViewNavigation({
  api,
  activeView,
  openVsCodeForWorkspace,
  resetNewThreadSurface,
  resetReviewSurface,
  selectedSession,
  selectedWorkspace,
  setNewThreadRootWorkspaceId,
  setPendingNewThreadWorkspaceId,
  setSnapshot,
  vsCodeOpen,
  workspaces,
}: UseAppViewNavigationOptions) {
  const previousActiveViewRef = useRef<AppView | null>(null);
  const [displayModeInitialPinnedThreadKey, setDisplayModeInitialPinnedThreadKey] = useState("");

  const onLeaveDisplayModeSurface = useCallback(() => {
    setDisplayModeInitialPinnedThreadKey("");
  }, []);

  const setActiveView = useCallback((view: AppView) => {
    if (!api) {
      return;
    }
    if (view !== "review") {
      resetReviewSurface();
    }
    if (view === "display-mode" && activeView === "threads" && selectedWorkspace && selectedSession) {
      setDisplayModeInitialPinnedThreadKey(`${selectedWorkspace.id}:${selectedSession.id}`);
      if (vsCodeOpen) {
        openVsCodeForWorkspace(selectedWorkspace.id, selectedWorkspace.path);
      }
    } else if (view !== "display-mode") {
      setDisplayModeInitialPinnedThreadKey("");
    }
    setSnapshot((current) => current ? { ...current, activeView: view, lastError: undefined } : current);
    void api.setActiveView(view);
  }, [activeView, api, openVsCodeForWorkspace, resetReviewSurface, selectedSession, selectedWorkspace, setSnapshot, vsCodeOpen]);

  const openNewThreadSurface = useCallback((workspaceId?: string) => {
    setPendingNewThreadWorkspaceId("");
    resetNewThreadSurface(workspaceId);
    setActiveView("new-thread");
  }, [resetNewThreadSurface, setActiveView, setPendingNewThreadWorkspaceId]);

  useEffect(() => {
    if (!activeView) {
      return;
    }

    if (activeView === "new-thread" && previousActiveViewRef.current !== "new-thread") {
      const nextRootWorkspaceId = resolveRepoWorkspaceId(workspaces, selectedWorkspace?.id);
      if (nextRootWorkspaceId) {
        setNewThreadRootWorkspaceId(nextRootWorkspaceId);
      }
    }

    previousActiveViewRef.current = activeView;
  }, [activeView, selectedWorkspace?.id, setNewThreadRootWorkspaceId, workspaces]);

  return {
    displayModeInitialPinnedThreadKey,
    onLeaveDisplayModeSurface,
    openNewThreadSurface,
    setActiveView,
  };
}
