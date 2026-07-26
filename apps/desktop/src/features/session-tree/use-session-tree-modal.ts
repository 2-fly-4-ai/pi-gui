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

  const branchFromMessage = useCallback(async (
    messageId: string,
    role: "user" | "assistant",
    text: string,
    createdAt?: string,
  ): Promise<void> => {
    if (!api || !selectedWorkspace || !selectedSession) {
      throw new Error("Select an existing thread before creating another approach.");
    }
    const target = {
      workspaceId: selectedWorkspace.id,
      sessionId: selectedSession.id,
    };
    const tree = await api.getSessionTree(target);
    const branchPoint = findBranchPoint(tree, { messageId, role, text, createdAt });
    if (!branchPoint) {
      throw new Error("This historical branch point is no longer available in Pi's durable session tree.");
    }
    const { result } = await api.navigateSessionTree(target, branchPoint.id, { summarize: false });
    if (result.cancelled || result.aborted) {
      throw new Error(result.aborted
        ? "Pi could not move to that historical branch point."
        : "Branch creation was cancelled.");
    }
    const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 180);
    const starter = result.editorText?.trim()
      || (role === "user"
        ? `Try a different approach to this request: ${excerpt}`
        : `Take a different approach from this point: ${excerpt}`);
    await api.updateComposerDraft(target, starter, { syncToEditor: true });
    setSnapshot(await api.getState());
    setComposerDraft(starter);
    focusComposer();
  }, [api, focusComposer, selectedSession, selectedWorkspace, setComposerDraft, setSnapshot]);

  useEffect(() => {
    setTreeModalState((current) => (current.open ? closedTreeModalState : current));
  }, [activeView, selectedSessionKey]);

  return {
    closeTreeModal,
    branchFromMessage,
    navigateTreeSelection,
    openTreeModal,
    treeModalState,
  };
}

function findBranchPoint(
  tree: SessionTreeSnapshot,
  input: {
    readonly messageId: string;
    readonly role: "user" | "assistant";
    readonly text: string;
    readonly createdAt?: string;
  },
): SessionTreeSnapshot["roots"][number] | undefined {
  const nodes = flattenTreeNodes(tree.roots);
  const exactId = nodes.find((node) => node.id === input.messageId);
  if (exactId) return exactId;

  const normalizedText = input.text.replace(/\s+/g, " ").trim();
  const createdAtMs = input.createdAt ? Date.parse(input.createdAt) : Number.NaN;
  const candidates = nodes.filter((node) => (
    node.kind === "message"
    && node.role === input.role
    && Boolean(node.preview)
    && (
      normalizedText === node.preview
      || normalizedText.startsWith(node.preview ?? "")
      || (node.preview ?? "").startsWith(normalizedText)
    )
  ));
  if (candidates.length === 1 || !Number.isFinite(createdAtMs)) {
    return candidates[0];
  }
  return candidates
    .map((node) => ({ node, distance: Math.abs(Date.parse(node.timestamp) - createdAtMs) }))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
}

function flattenTreeNodes(
  roots: readonly SessionTreeSnapshot["roots"][number][],
): SessionTreeSnapshot["roots"][number][] {
  return roots.flatMap((node) => [node, ...flattenTreeNodes(node.children)]);
}
