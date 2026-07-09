import { useMemo } from "react";
import type { DesktopAppState, WorktreeRecord, WorkspaceRecord } from "../../desktop-state";
import { resolveRepoWorkspaceId } from "../../workspace-roots";

interface UseWorkspaceDerivationsOptions {
  readonly snapshot: DesktopAppState | null;
  readonly selectedWorkspace?: WorkspaceRecord;
}

export function useWorkspaceDerivations({
  snapshot,
  selectedWorkspace,
}: UseWorkspaceDerivationsOptions): {
  readonly activeWorktrees: readonly WorktreeRecord[];
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly rootWorkspace?: WorkspaceRecord;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
} {
  return useMemo(() => {
    if (!snapshot) {
      return {
        activeWorktrees: [],
        linkedWorktreeByWorkspaceId: new Map<string, WorktreeRecord>(),
        rootWorkspace: undefined,
        rootWorkspaceOptions: [],
        visibleWorkspaces: [],
      };
    }

    const workspacesById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace] as const));
    const primaryWorkspaces = snapshot.workspaces.filter((workspace) => workspace.kind === "primary");
    const orphanWorkspaces = snapshot.workspaces.filter(
      (workspace) => workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
    );
    const visibleWorkspaces =
      primaryWorkspaces.length > 0 ? [...primaryWorkspaces, ...orphanWorkspaces] : snapshot.workspaces;
    const linkedWorktreeByWorkspaceId = new Map(
      Object.values(snapshot.worktreesByWorkspace)
        .flat()
        .filter((worktree) => Boolean(worktree.linkedWorkspaceId))
        .map((worktree) => [worktree.linkedWorkspaceId as string, worktree] as const),
    );
    const rootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
    const rootWorkspace =
      (rootWorkspaceId ? snapshot.workspaces.find((workspace) => workspace.id === rootWorkspaceId) : undefined)
      ?? selectedWorkspace;
    const rootWorkspaceOptions = [
      ...new Set(snapshot.workspaces.map((workspace) => resolveRepoWorkspaceId(snapshot.workspaces, workspace.id) ?? workspace.id)),
    ]
      .map((workspaceId) => snapshot.workspaces.find((workspace) => workspace.id === workspaceId))
      .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));

    return {
      activeWorktrees: rootWorkspace ? snapshot.worktreesByWorkspace[rootWorkspace.id] ?? [] : [],
      linkedWorktreeByWorkspaceId,
      rootWorkspace,
      rootWorkspaceOptions,
      visibleWorkspaces,
    };
  }, [selectedWorkspace, snapshot]);
}
