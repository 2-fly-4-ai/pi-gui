import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { NavigateSessionTreeOptions, SessionTreeSnapshot } from "@pi-gui/session-driver/types";
import type { AppView, DesktopAppState, SessionRecord, WorkspaceRecord } from "../../desktop-state";

interface SessionTreeModalState {
  readonly open: boolean;
  readonly loading: boolean;
  readonly submitting: boolean;
  readonly tree?: SessionTreeSnapshot;
  readonly error?: string;
}

interface UseSessionTreeModalOptions {
  readonly activeView: AppView | undefined;
  readonly api: typeof window.piApp;
  readonly focusComposer: () => void;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}

const closedTreeModalState: SessionTreeModalState = {
  open: false,
  loading: false,
  submitting: false,
};

export function useSessionTreeModal({
  activeView,
  api,
  focusComposer,
  selectedSession,
  selectedSessionKey,
  selectedWorkspace,
  setComposerDraft,
  setSnapshot,
}: UseSessionTreeModalOptions) {
  const [treeModalState, setTreeModalState] = useState<SessionTreeModalState>(closedTreeModalState);

  const closeTreeModal = useCallback(() => {
    setTreeModalState((current) => (current.submitting ? current : closedTreeModalState));
    focusComposer();
  }, [focusComposer]);

  const openTreeModal = useCallback(() => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    setTreeModalState({
      open: true,
      loading: true,
      submitting: false,
    });
    setComposerDraft("");

    void api
      .getSessionTree({
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      })
      .then((tree) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          tree,
        });
      })
      .catch((error) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [api, selectedSession, selectedWorkspace, setComposerDraft]);

  const navigateTreeSelection = useCallback(
    (targetId: string, options?: NavigateSessionTreeOptions) => {
      if (!api || !selectedWorkspace || !selectedSession) {
        return;
      }

      setTreeModalState((current) => ({ ...current, submitting: true, error: undefined }));
      void api
        .navigateSessionTree(
          {
            workspaceId: selectedWorkspace.id,
            sessionId: selectedSession.id,
          },
          targetId,
          options,
        )
        .then(({ state, result }) => {
          setSnapshot(state);
          setTreeModalState(closedTreeModalState);
          setComposerDraft((current) =>
            !current.trim() && result.editorText ? result.editorText : state.composerDraft,
          );
          focusComposer();
        })
        .catch((error) => {
          setTreeModalState((current) => ({
            ...current,
            submitting: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    },
    [api, focusComposer, selectedSession, selectedWorkspace, setComposerDraft, setSnapshot],
  );

  useEffect(() => {
    setTreeModalState((current) => (current.open ? closedTreeModalState : current));
  }, [activeView, selectedSessionKey]);

  return {
    closeTreeModal,
    navigateTreeSelection,
    openTreeModal,
    treeModalState,
  };
}
