import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

test("GitHub quick actions open commit, push, and PR dialogs", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("git-quick-actions-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Git quick actions session");

    await expect(window.locator(".chat-header")).toHaveCount(0);
    const topbar = window.getByTestId("topbar");
    const trigger = topbar.getByRole("button", { name: "GitHub actions" });
    await expect(trigger).toBeVisible();

    await trigger.click();
    const menu = window.locator(".git-quick-actions__menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Commit");
    await expect(menu).toContainText("Push");
    await expect(menu).toContainText("Create PR");

    await menu.getByRole("button", { name: /Commit/ }).click();
    const commitDialog = window.getByTestId("git-commit-dialog");
    await expect(commitDialog).toBeVisible();
    await expect(commitDialog).toContainText("Commit changes");
    await expect(commitDialog).toContainText("Branch:");
    await expect(commitDialog).toContainText("Repo:");
    await expect(commitDialog.locator(".git-dialog__file-list")).toHaveCSS("background-color", /rgb\((?!248, 249, 252)/);
    await expect(commitDialog.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
    await commitDialog.getByLabel("Commit message").fill("test commit");
    await expect(commitDialog.getByRole("button", { name: "Commit", exact: true })).toBeEnabled();
    await commitDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(commitDialog).toHaveCount(0);

    await trigger.click();
    await menu.getByRole("button", { name: /Push/ }).click();
    const pushDialog = window.getByTestId("git-push-dialog");
    await expect(pushDialog).toBeVisible();
    await expect(pushDialog).toContainText("Push branch");
    await pushDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(pushDialog).toHaveCount(0);

    await trigger.click();
    await menu.getByRole("button", { name: /Create PR/ }).click();
    const prDialog = window.getByTestId("git-create-pr-dialog");
    await expect(prDialog).toBeVisible();
    await expect(prDialog).toContainText("Create PR");
    await prDialog.getByLabel("Title").fill("Test PR");
    await expect(prDialog.getByRole("button", { name: "Create PR", exact: true })).toBeEnabled();
  } finally {
    await harness.close();
  }
});
