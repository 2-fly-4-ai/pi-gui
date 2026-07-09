import { describe, expect, it } from "vitest";
import type { DesktopAppState, SessionRecord, WorkspaceRecord, WorktreeRecord } from "../../src/desktop-state";
import { buildThreadGroups } from "../../src/thread-groups";

const session = (id: string, updatedAt: string, archivedAt?: string): SessionRecord => ({
  id,
  title: id,
  updatedAt,
  ...(archivedAt ? { archivedAt } : {}),
  preview: "",
  status: "idle",
  hasUnseenUpdate: false,
});

const workspace = (
  id: string,
  kind: WorkspaceRecord["kind"],
  sessions: readonly SessionRecord[],
  extra: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  id,
  name: id,
  path: `/repo/${id}`,
  lastOpenedAt: "2026-07-08T00:00:00.000Z",
  kind,
  sessions,
  ...extra,
});

const baseState = (overrides: Partial<DesktopAppState>): DesktopAppState =>
  ({
    workspaces: [],
    worktreesByWorkspace: {},
    selectedWorkspaceId: "",
    selectedSessionId: "",
    activeView: "threads",
    composerDraft: "",
    composerDraftSyncSource: "state",
    composerDraftSyncNonce: 0,
    composerAttachments: [],
    queuedComposerMessages: [],
    runtimeByWorkspace: {},
    runtimeJobsBySession: {},
    sessionCommandsBySession: {},
    sessionExtensionUiBySession: {},
    extensionCommandCompatibilityByWorkspace: {},
    notificationPreferences: {
      backgroundCompletion: false,
      backgroundFailure: false,
      attentionNeeded: false,
    },
    integratedTerminalShell: "",
    lastViewedAtBySession: {},
    workspaceOrder: [],
    modelSettingsScopeMode: "app-global",
    globalModelSettings: {
      enabledModelPatterns: [],
    },
    fastMode: {
      backend: "pi-codex-fast",
      available: false,
      enabled: false,
      configPath: "",
    },
    sidebarCollapsed: false,
    showThinking: true,
    desktopCustomInstructions: {
      enabled: false,
      text: "",
    },
    revision: 1,
    ...overrides,
  }) as DesktopAppState;

describe("buildThreadGroups", () => {
  it("orders roots by workspace order while placing newly added roots first", () => {
    const alpha = workspace("alpha", "primary", []);
    const beta = workspace("beta", "primary", []);
    const newRoot = workspace("new-root", "primary", []);

    const groups = buildThreadGroups(baseState({
      workspaces: [alpha, beta, newRoot],
      workspaceOrder: ["beta", "alpha"],
    }));

    expect(groups.map((group) => group.rootWorkspace.id)).toEqual(["new-root", "beta", "alpha"]);
  });

  it("combines root and linked worktree sessions sorted by recency", () => {
    const root = workspace("root", "primary", [
      session("local-old", "2026-07-08T10:00:00.000Z"),
      session("local-archived", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z"),
    ]);
    const linked = workspace("linked", "worktree", [
      session("worktree-new", "2026-07-08T13:00:00.000Z"),
    ], { rootWorkspaceId: "root", branchName: "feature/state-sync" });
    const worktree: WorktreeRecord = {
      id: "wt-1",
      rootWorkspaceId: "root",
      linkedWorkspaceId: "linked",
      name: "State sync",
      path: "/repo/root-wt",
      status: "ready",
      branchName: "feature/state-sync",
      updatedAt: "2026-07-08T13:00:00.000Z",
    };

    const [group] = buildThreadGroups(baseState({
      workspaces: [root, linked],
      worktreesByWorkspace: { root: [worktree] },
      workspaceOrder: ["root"],
    }));

    expect(group?.threads.map((entry) => `${entry.workspaceId}:${entry.session.id}:${entry.environment.label}`)).toEqual([
      "linked:worktree-new:State sync",
      "root:local-old:Local",
    ]);
    expect(group?.archivedThreads.map((entry) => entry.session.id)).toEqual(["local-archived"]);
  });

  it("keeps orphan worktrees visible as their own groups", () => {
    const orphan = workspace("orphan", "worktree", [session("orphan-thread", "2026-07-08T09:00:00.000Z")], {
      rootWorkspaceId: "missing-root",
    });

    const groups = buildThreadGroups(baseState({
      workspaces: [orphan],
    }));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rootWorkspace.id).toBe("orphan");
    expect(groups[0]?.threads[0]?.environment).toMatchObject({
      kind: "worktree",
      label: "orphan",
      detached: true,
    });
  });
});
