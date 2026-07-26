import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("persists explicit decisions and scoped memory while rejecting secret-like input", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("project-knowledge");
  const first = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await first.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Knowledge controls");
    await window.getByTestId("context-inspector-trigger").click();
    const panel = window.getByTestId("project-knowledge");
    await panel.locator("summary").click();

    await panel.getByLabel("Decision or assumption").fill("Keep the driver thin.");
    await panel.getByRole("button", { name: "Save decision" }).click();
    await expect(panel).toContainText("Keep the driver thin.");

    await panel.getByRole("button", { name: "Memory" }).click();
    await panel.getByLabel("Memory key").fill("style");
    await panel.getByLabel("Exact memory to inject").fill("Prefer focused changes.");
    await panel.getByRole("button", { name: "Save memory" }).click();
    await expect(panel).toContainText("Prefer focused changes.");

    await panel.getByLabel("Memory key").fill("secret");
    await panel.getByLabel("Exact memory to inject").fill("OPENAI_API_KEY=sk-abcdefghijklmnop");
    await panel.getByRole("button", { name: "Save memory" }).click();
    await expect(panel.getByRole("alert")).toContainText("not stored");

    await window.getByRole("button", { name: "Close context inspector" }).click();
    await window.getByTestId("composer").fill("Use the configured context.");
    await window.getByRole("button", { name: "Send message" }).click();
    await expect(window.getByTestId("transcript")).toContainText("Context used · 1 memory · 1 decision");
    await expect(window.getByTestId("transcript")).not.toContainText("pi-gui-explicit-context");
  } finally {
    await first.close();
  }

  const relaunched = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await relaunched.firstWindow();
    await selectSession(window, "Knowledge controls");
    await window.getByTestId("context-inspector-trigger").click();
    const panel = window.getByTestId("project-knowledge");
    await panel.locator("summary").click();
    await expect(panel).toContainText("Keep the driver thin.");
    await expect(panel).toContainText("Prefer focused changes.");
    await expect(panel).not.toContainText("OPENAI_API_KEY");
  } finally {
    await relaunched.close();
  }
});
