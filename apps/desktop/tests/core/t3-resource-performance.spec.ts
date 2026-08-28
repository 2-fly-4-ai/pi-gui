import { expect, test } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  emitTestSessionEvent,
  getAppDiagnostics,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  toggleTopbarPanel,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("bounds resources with ten concurrent tasks, a PTY, VS Code, and repeated inspector subscriptions", async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("t3-resource-performance");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    const sessions = await window.evaluate(async ({ workspaceId }) => {
      const api = window.piApp;
      if (!api) throw new Error("Pi API unavailable");
      for (let index = 0; index < 10; index += 1) {
        await api.createSession({ workspaceId, title: `Resource stress ${String(index + 1).padStart(2, "0")}` });
      }
      const state = await api.getState();
      const current = state.workspaces.find((entry) => entry.id === workspaceId);
      return current?.sessions.filter((session) => session.title.startsWith("Resource stress ")).map((session) => ({
        id: session.id,
        title: session.title,
      })) ?? [];
    }, { workspaceId: workspace.id });
    expect(sessions).toHaveLength(10);

    for (const [index, session] of sessions.entries()) {
      const timestamp = new Date(Date.now() + index).toISOString();
      const event: Extract<SessionDriverEvent, { type: "sessionUpdated" }> = {
        type: "sessionUpdated",
        sessionRef: { workspaceId: workspace.id, sessionId: session.id },
        timestamp,
        runId: `resource-stress-${index}`,
        snapshot: {
          ref: { workspaceId: workspace.id, sessionId: session.id },
          workspace: { workspaceId: workspace.id, path: workspace.path, displayName: workspace.name },
          title: session.title,
          status: "running",
          updatedAt: timestamp,
          preview: "Seeded concurrent resource run",
          runningRunId: `resource-stress-${index}`,
        },
      };
      await emitTestSessionEvent(harness, event);
    }
    await expect.poll(async () => (await getDesktopState(window)).workspaces
      .flatMap((entry) => entry.sessions)
      .filter((session) => session.title.startsWith("Resource stress ") && session.status === "running").length).toBe(10);

    const terminal = await window.evaluate(async ({ workspaceId, scopeId }) => {
      const panel = await window.piApp?.createTerminalSession(workspaceId, scopeId, { cols: 80, rows: 24 });
      return panel?.sessions.find((session) => session.id === panel.activeSessionId);
    }, { workspaceId: workspace.id, scopeId: sessions[0]!.id });
    expect(terminal?.status).toBe("running");

    const vscode = await window.evaluate(async (workspaceId) => {
      try {
        return { port: await window.piApp?.ensureVSCodeServer(workspaceId) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }, workspace.id);
    testInfo.annotations.push({
      type: "embedded-vscode",
      description: vscode.port ? `owned lease on port ${vscode.port}` : `unavailable: ${vscode.error ?? "unknown"}`,
    });

    const beforeHeap = await rendererHeap(window);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await toggleTopbarPanel(window, "App logs");
      await window.getByRole("tab", { name: "Resources" }).click();
      await expect(window.getByTestId("resource-inspector")).toBeVisible();
      await expect.poll(() => window.evaluate(() => window.piApp?.getResourceInspectorSnapshot()))
        .toMatchObject({ sampling: { visible: true, intervalMs: 1_000 } });
      const snapshot = await window.evaluate(() => window.piApp?.getResourceInspectorSnapshot());
      expect(snapshot?.owners.some((owner) => owner.ownerKind === "terminal")).toBe(true);
      if (vscode.port) expect(snapshot?.owners.some((owner) => owner.ownerKind === "vscode")).toBe(true);
      expect(snapshot?.processes.length ?? 0).toBeLessThanOrEqual(500);
      expect(snapshot?.history.length ?? 0).toBeLessThanOrEqual(900);
      expect(snapshot?.sampling.processRowsRetained ?? 0).toBeLessThanOrEqual(20_000);
      expect(snapshot?.sampling.historyBytes ?? 0).toBeLessThanOrEqual(16 * 1024 * 1024);
      await window.getByLabel("Close logs").click();
      await expect.poll(() => window.evaluate(() => window.piApp?.getResourceInspectorSnapshot()))
        .toMatchObject({ sampling: { visible: false, intervalMs: 15_000 } });
    }

    const diagnostics = await getAppDiagnostics(harness);
    expect(diagnostics.currentDriverEventsPending).toBe(0);
    expect(diagnostics.maxDriverEventsPending).toBeLessThanOrEqual(64);
    expect(diagnostics.fullTranscriptCacheEntries).toBeLessThanOrEqual(6);
    expect(diagnostics.activeTranscriptTailEntries).toBeLessThanOrEqual(10);
    expect(diagnostics.activeTranscriptTailBytes).toBeLessThan(16 * 1024 * 1024);
    // Seeded driver events exercise concurrent renderer/state load without
    // pretending that fake events own ten provider child processes.
    expect(diagnostics.runningSessionRuntimeCount).toBe(0);
    expect(diagnostics.managedSessionCount).toBeGreaterThanOrEqual(10);
    expect(diagnostics.residentSessionRuntimeCount).toBe(10);
    const afterHeap = await rendererHeap(window);
    expect(afterHeap.used).toBeLessThan(750 * 1024 * 1024);
    expect(afterHeap.limit > 0 ? afterHeap.used / afterHeap.limit : 0).toBeLessThan(0.8);
    expect(afterHeap.used - beforeHeap.used).toBeLessThan(256 * 1024 * 1024);

    for (const [index, session] of sessions.entries()) {
      const timestamp = new Date(Date.now() + 1_000 + index).toISOString();
      const event: Extract<SessionDriverEvent, { type: "runCompleted" }> = {
        type: "runCompleted",
        sessionRef: { workspaceId: workspace.id, sessionId: session.id },
        timestamp,
        runId: `resource-stress-${index}`,
        snapshot: {
          ref: { workspaceId: workspace.id, sessionId: session.id },
          workspace: { workspaceId: workspace.id, path: workspace.path, displayName: workspace.name },
          title: session.title,
          status: "idle",
          updatedAt: timestamp,
          preview: "Seeded concurrent resource run complete",
        },
      };
      await emitTestSessionEvent(harness, event);
    }
    await expect.poll(async () => (await getAppDiagnostics(harness)).residentSessionRuntimeCount).toBeLessThanOrEqual(8);
    expect((await getAppDiagnostics(harness)).runningSessionRuntimeCount).toBe(0);

    if (terminal) await window.evaluate((terminalId) => window.piApp?.closeTerminalSession(terminalId), terminal.id);
  } finally {
    await harness.close();
  }
});

async function rendererHeap(window: Parameters<typeof getDesktopState>[0]): Promise<{ readonly used: number; readonly limit: number }> {
  return window.evaluate(() => {
    const memory = (performance as Performance & {
      readonly memory?: { readonly usedJSHeapSize?: number; readonly jsHeapSizeLimit?: number };
    }).memory;
    return { used: memory?.usedJSHeapSize ?? 0, limit: memory?.jsHeapSizeLimit ?? 0 };
  });
}
