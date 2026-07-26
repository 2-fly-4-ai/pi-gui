import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  pasteTinyPng,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("context inspector previews and removes only app-controlled next-message context", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("context-inspector");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Context inspector");
    const composer = window.getByTestId("composer");
    await composer.fill("Review @src/app.ts before continuing");
    await pasteTinyPng(window);
    await expect(window.locator(".composer-attachment")).toHaveCount(1);

    await window.getByTestId("context-inspector-trigger").click();
    const inspector = window.getByTestId("context-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("Next message manifest");
    await expect(inspector).toContainText("src/app.ts");
    await expect(inspector).toContainText("screenshot.png");
    await expect(inspector).toContainText("Workspace instruction discovery");
    await expect(inspector).toContainText("Runtime-managed context");
    await expect(inspector).toContainText("Project memory · none configured");
    await expect(inspector).toContainText("Sent externally");
    await expect(inspector).toContainText("Details unavailable");
    await expect(inspector).toContainText("Read-only");
    await expect(inspector).toContainText("Hidden prompts and secret values are never displayed");

    const mentionEntry = inspector.locator(".context-inspector__entry", { hasText: "src/app.ts" });
    await mentionEntry.getByRole("button", { name: "Remove" }).click();
    await expect(composer).toHaveValue("Review before continuing");

    const attachmentEntry = inspector.locator(".context-inspector__entry", { hasText: "screenshot.png" });
    await attachmentEntry.getByRole("button", { name: "Remove" }).click();
    await expect(window.locator(".composer-attachment")).toHaveCount(0);
    await expect(inspector.locator(".context-inspector__entry", { hasText: "screenshot.png" })).toHaveCount(0);

    await inspector.getByRole("button", { name: "Close context inspector" }).click();
    await window.getByRole("button", { name: "Send message" }).click();
    await expect(window.getByTestId("transcript")).toContainText("Review before continuing");
    await window.getByTestId("context-inspector-trigger").click();
    await expect(window.getByTestId("context-inspector")).toContainText("1 submitted manifest");
  } finally {
    await harness.close();
  }
});
