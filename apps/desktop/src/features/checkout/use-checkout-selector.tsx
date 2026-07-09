import { useCallback, type ReactNode } from "react";
import { CheckoutSelector, type CheckoutSelectorOption } from "../../checkout-selector";
import type { DesktopAppState, WorktreeRecord, WorkspaceRecord } from "../../desktop-state";

type CheckoutSelectionMode = "app" | "new-thread";

interface UseCheckoutSelectorOptions {
  readonly snapshot: DesktopAppState | null;
  readonly linkedWorktreeByWorkspaceId: ReadonlyMap<string, WorktreeRecord>;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSelectLocalNewThreadCheckout: (workspaceId: string) => void;
  readonly onSelectWorktreeNewThreadCheckout: (workspaceId: string) => void;
}

export function useCheckoutSelector({
  snapshot,
  linkedWorktreeByWorkspaceId,
  onSelectWorkspace,
  onSelectLocalNewThreadCheckout,
  onSelectWorktreeNewThreadCheckout,
}: UseCheckoutSelectorOptions) {
  return useCallback((workspace: WorkspaceRecord | undefined, selectionMode: CheckoutSelectionMode = "app"): ReactNode => {
    if (!snapshot || !workspace) {
      return undefined;
    }

    const root = snapshot.workspaces.find((entry) => entry.id === (workspace.rootWorkspaceId ?? workspace.id));
    if (!root) {
      return undefined;
    }

    const currentWorktree = linkedWorktreeByWorkspaceId.get(workspace.id);
    const currentRef =
      currentWorktree?.branchName ??
      currentWorktree?.name ??
      workspace.branchName ??
      root.branchName ??
      (workspace.kind === "worktree" ? "worktree" : "main");

    const selectLocalCheckout = () => {
      if (selectionMode === "new-thread") {
        onSelectLocalNewThreadCheckout(root.id);
        return;
      }
      onSelectWorkspace(root.id);
    };

    const selectWorktreeCheckout = (linkedWorkspace: WorkspaceRecord | undefined, status: WorktreeRecord["status"]) => {
      if (!linkedWorkspace || status !== "ready") {
        return;
      }
      if (selectionMode === "new-thread") {
        onSelectWorktreeNewThreadCheckout(root.id);
        return;
      }
      onSelectWorkspace(linkedWorkspace.id);
    };

    const worktreeOptions = selectionMode === "app" ? snapshot.worktreesByWorkspace[root.id] ?? [] : [];
    const options: CheckoutSelectorOption[] = [
      {
        id: root.id,
        label: root.branchName ?? "main",
        detail: "Local checkout",
        current: workspace.id === root.id,
        onSelect: selectLocalCheckout,
      },
      ...worktreeOptions.map((worktree) => {
        const linkedWorkspace = worktree.linkedWorkspaceId
          ? snapshot.workspaces.find((entry) => entry.id === worktree.linkedWorkspaceId)
          : undefined;
        const selectable = Boolean(linkedWorkspace) && worktree.status === "ready";

        return {
          id: worktree.id,
          label: worktree.branchName ?? worktree.name,
          detail: selectable ? worktree.name : `${worktree.name} · ${worktree.status === "ready" ? "unavailable" : worktree.status}`,
          current: linkedWorkspace?.id === workspace.id,
          disabled: !selectable,
          onSelect: () => selectWorktreeCheckout(linkedWorkspace, worktree.status),
        } satisfies CheckoutSelectorOption;
      }),
    ];

    return <CheckoutSelector label="Local checkout" currentRef={currentRef} options={options} />;
  }, [
    linkedWorktreeByWorkspaceId,
    onSelectLocalNewThreadCheckout,
    onSelectWorkspace,
    onSelectWorktreeNewThreadCheckout,
    snapshot,
  ]);
}
