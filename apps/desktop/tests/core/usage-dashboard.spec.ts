import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir, seedUsageSessionFixture, waitForWorkspaceByPath } from "../helpers/electron-app";

test("usage dashboard indexes a persisted provider turn exactly once and survives restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("usage-dashboard-workspace");
  await seedAgentDir(agentDir);
  await seedUsageSessionFixture(agentDir, workspacePath);

  let harness = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    let window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const taskButton = window.getByRole("button", { name: /Usage dashboard fixture/ }).first();
    await expect(taskButton).toBeVisible();
    await taskButton.click();
    await window.getByTestId("context-window-button").click();
    await window.getByRole("button", { name: "Open usage dashboard" }).click();

    const dashboard = window.getByTestId("usage-dashboard");
    await expect(dashboard).toBeVisible();
    await expect(dashboard).toContainText("225");
    await expect(dashboard).toContainText("anthropic");
    await expect(dashboard).toContainText("claude-sonnet-test");
    await expect(dashboard).toContainText("$0.0033");
    await dashboard.getByRole("button", { name: "Current task" }).click();
    await expect(dashboard).toContainText("225");

    const first = await window.evaluate(async () => window.piApp?.getUsageDashboard({ window: "90d" }, true));
    expect(first?.recordCount).toBe(1);
    expect(first?.totals.totalTokens).toBe(225);
    await harness.close();

    harness = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [workspacePath], testMode: "background" });
    window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const second = await window.evaluate(async () => window.piApp?.getUsageDashboard({ window: "90d" }, false));
    expect(second?.recordCount).toBe(1);
    expect(second?.totals.totalTokens).toBe(225);
    expect(second?.unchangedFileCount).toBeGreaterThanOrEqual(1);
    expect(second?.indexBytes).toBeLessThanOrEqual(second!.indexByteLimit);
  } finally {
    await harness.close().catch(() => undefined);
  }
});
