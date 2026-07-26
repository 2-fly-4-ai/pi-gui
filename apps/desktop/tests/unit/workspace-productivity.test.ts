import { describe, expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/desktop-state";
import {
  buildWorkspaceHandoff,
  deriveWorktreeLifecycle,
  indexWorkspaceArtifacts,
  validateWorkspaceShortcut,
} from "../../src/product-experience/workspace-productivity";

const workspace: WorkspaceRecord = {
  id: "workspace",
  name: "Demo",
  path: "/Users/example/project",
  lastOpenedAt: "2026-07-25T00:00:00.000Z",
  kind: "primary",
  sessions: [],
};

describe("workspace productivity", () => {
  it("indexes references without previewing sensitive logs and reports missing declarations", () => {
    const artifacts = indexWorkspaceArtifacts({
      workspacePaths: ["plans/active.md", "screenshots/ui.png", "private/run.log", "moved/final.md", "exports/demo.zip"],
      evidence: [
        {
          schemaVersion: 1,
          id: "artifact",
          workspaceId: "workspace",
          sessionId: "session",
          timestamp: "2026-07-25T00:00:00.000Z",
          kind: "artifact",
          source: "runtime",
          authority: "runtime-observed",
          summary: "Report",
          artifact: { artifactId: "report", artifactType: "report", path: "reports/final.md" },
        },
      ],
      subagentRuns: [],
    });
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "plans/active.md", type: "plan", state: "available" }),
      expect.objectContaining({ path: "private/run.log", sensitivity: "private", state: "private" }),
      expect.objectContaining({ path: "reports/final.md", state: "moved" }),
      expect.objectContaining({ path: "exports/demo.zip", state: "export-excluded" }),
    ]));
  });

  it("generates deterministic redacted handoff Markdown", () => {
    const handoff = buildWorkspaceHandoff({
      workspace,
      decisions: [],
      changedPaths: [
        "/Users/example/project/src/app.ts",
        "/Users/example/project/private/runtime.log",
        "/Users/example/project/.env.local",
      ],
      evidence: [{
        schemaVersion: 1,
        id: "test",
        workspaceId: "workspace",
        sessionId: "session",
        timestamp: "2026-07-25T00:00:00.000Z",
        kind: "test",
        source: "tool",
        authority: "tool-observed",
        status: "passed",
        summary: "API_KEY=do-not-export",
        verification: { scope: "unit", command: "TOKEN=secret-value pnpm test" },
      }],
      artifacts: [{
        id: "private",
        path: "/Users/example/private/run.log",
        type: "log",
        source: "workspace",
        state: "private",
        sensitivity: "private",
      }],
      includedArtifactIds: new Set(["private"]),
      narrative: "Bearer abcdefghijklmnopqrstuvwxyz",
    });
    expect(handoff).toContain("`src/app.ts`");
    expect(handoff).toContain("[secret redacted]");
    expect(handoff).not.toContain("/Users/example/project");
    expect(handoff).not.toContain("secret-value");
    expect(handoff).not.toContain("run.log");
    expect(handoff).not.toContain(".env.local");
  });

  it("keeps worktree cleanup advisory and shortcut conflicts deterministic", () => {
    expect(deriveWorktreeLifecycle(workspace, undefined, 1, 0)).toMatchObject({
      status: "ready",
      dirty: true,
    });
    expect(deriveWorktreeLifecycle(workspace, {
      id: "stale",
      rootWorkspaceId: workspace.id,
      name: "stale",
      path: workspace.path,
      status: "error",
      updatedAt: new Date().toISOString(),
    }, 0, 0)).toMatchObject({
      status: "stale",
      dirty: false,
    });
    expect(validateWorkspaceShortcut("Cmd+Q", [])).toContain("reserved");
    expect(validateWorkspaceShortcut("Cmd+Shift+1", [{
      id: "one",
      commandId: "toggle-changes",
      label: "Changes",
      keys: "cmd+shift+1",
      enabled: true,
      significant: false,
    }])).toContain("already assigned");
  });
});
