import { expect, test } from "@playwright/test";
import { desktopShortcut, launchDesktop, makeUserDataDir, makeWorkspace, toggleTopbarPanel, waitForWorkspaceByPath } from "../helpers/electron-app";

test("Resource Inspector samples owned processes and produces a redacted bounded diagnosis", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("resource-inspector-workspace");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await toggleTopbarPanel(window, "App logs");
    await window.getByRole("tab", { name: "Resources" }).click();

    const inspector = window.getByTestId("resource-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.locator(".resource-health span", { hasText: "Health" })).toBeVisible();
    await expect(inspector.locator(".resource-owner").first()).toBeVisible();
    await expect(inspector.locator(".logs-panel__runtime-note")).toContainText("Updates every 1s while visible");
    await expect(inspector.getByRole("button", { name: "Start diagnostic task" })).toBeEnabled();
    await expect.poll(() => window.evaluate(() => window.piApp.getResourceInspectorSnapshot().then((snapshot) => snapshot.sampling))).toMatchObject({ visible: true, intervalMs: 1_000 });

    const bundle = await window.evaluate(async () => {
      const api = window.piApp;
      if (!api) throw new Error("Pi API unavailable");
      return api.getDiagnosticBundle();
    });
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.markdown).toContain("# Diagnose Pi");
    expect(bundle.markdown).toContain("Paths, commands, prompts, environment values");
    expect(bundle.markdown).not.toContain(workspacePath);
    expect(bundle.resourceSnapshot.history.length).toBeGreaterThan(0);
    expect(bundle.resourceSnapshot.processes.length).toBeLessThanOrEqual(500);
    expect(bundle.resourceSnapshot.sampling.historyBytes).toBeLessThanOrEqual(16 * 1024 * 1024);

    await inspector.getByLabel("Show").selectOption("electron");
    await expect(inspector.locator(".resource-owner").first()).toContainText("electron");
    await inspector.getByText("History table").click();
    await expect(inspector.getByRole("table")).toBeVisible();

    await window.getByLabel("Close logs").click();
    await expect.poll(() => window.evaluate(() => window.piApp.getResourceInspectorSnapshot().then((snapshot) => snapshot.sampling))).toMatchObject({ visible: false, intervalMs: 15_000 });
    await window.keyboard.press(desktopShortcut("k"));
    const palette = window.getByTestId("command-palette");
    await palette.getByPlaceholder("Search commands…").fill("Diagnose Pi");
    await palette.getByRole("option", { name: /Diagnose Pi/ }).click();
    await expect(window.getByTestId("resource-inspector")).toBeVisible();
    const before = await window.evaluate(async () => {
      const state = await window.piApp.getState();
      return state.workspaces.reduce((total, workspace) => total + workspace.sessions.length, 0);
    });
    const startDiagnosticTask = window.getByRole("button", { name: "Start diagnostic task" });
    await startDiagnosticTask.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => window.evaluate(async () => {
      const state = await window.piApp.getState();
      return state.workspaces.reduce((total, workspace) => total + workspace.sessions.length, 0);
    })).toBe(before + 1);

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    const restarted = await harness.firstWindow();
    await waitForWorkspaceByPath(restarted, workspacePath);
    expect(await restarted.evaluate(async () => {
      const state = await window.piApp.getState();
      return state.workspaces.reduce((total, workspace) => total + workspace.sessions.length, 0);
    })).toBe(before + 1);
    if (await restarted.getByRole("tab", { name: "Resources" }).count() === 0) {
      await toggleTopbarPanel(restarted, "App logs");
    }
    await expect(restarted.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => restarted.evaluate(() => window.piApp.getResourceInspectorSnapshot().then((snapshot) => snapshot.sampling)))
      .toMatchObject({ visible: true, intervalMs: 1_000 });
    await restarted.getByLabel("Close logs").click();
    await expect.poll(() => restarted.evaluate(() => window.piApp.getResourceInspectorSnapshot().then((snapshot) => snapshot.sampling)))
      .toMatchObject({ visible: false, intervalMs: 15_000 });
  } finally {
    await harness.close().catch(() => undefined);
  }
});
