import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedBranchedTreeSessionFixture,
  selectSession,
} from "../helpers/electron-app";

test("branches from a timeline message while preserving the original durable path", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("branch-from-message");
  await seedAgentDir(agentDir);
  await seedBranchedTreeSessionFixture(agentDir, workspacePath);

  const first = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await first.firstWindow();
    await selectSession(window, "Tree fixture session");
    const rootAnswer = window.locator(".timeline-item--assistant").filter({ hasText: "Root answer" }).first();
    await rootAnswer.hover();
    await rootAnswer.getByRole("button", { name: "Try another approach" }).click();
    const confirmation = rootAnswer.getByRole("dialog", { name: "Try another approach" });
    await expect(confirmation).toContainText("original path remains available");
    await expect(confirmation).toContainText("current checkout does not change");
    await confirmation.getByRole("button", { name: "Create branch" }).click();

    await expect(window.getByTestId("composer")).toHaveValue(/Take a different approach from this point: Root answer/);
    await expect(window.getByTestId("transcript")).toContainText("Root answer");
    await expect(window.getByTestId("transcript")).not.toContainText("Branch beta");

    await window.getByTestId("composer").fill("/tree");
    await window.getByTestId("composer").press("Enter");
    await expect(window.getByTestId("tree-modal")).toContainText("Branch beta");
    await expect(window.getByTestId("tree-modal")).toContainText("Beta answer");
    await window.getByTestId("tree-modal").getByRole("button", { name: "Compare branches" }).click();
    const comparison = window.getByTestId("branch-comparison");
    await expect(comparison).toContainText("observed session-tree metrics");
    await expect(comparison).toContainText("Files changed");
    await expect(comparison).toContainText("Not attributed by the runtime");
    await expect(comparison).toContainText("Narrative recommendation");
    await expect(comparison).toContainText("Pi will not merge branches");
  } finally {
    await first.close();
  }

  const relaunched = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await relaunched.firstWindow();
    await selectSession(window, "Tree fixture session");
    await expect(window.getByTestId("transcript")).toContainText("Root answer");
    await expect(window.getByTestId("transcript")).not.toContainText("Branch beta");
  } finally {
    await relaunched.close();
  }
});
