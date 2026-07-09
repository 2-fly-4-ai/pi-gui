import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
} from "../helpers/electron-app";

test("returning from settings keeps a long selected thread visibly hydrated", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-return-hydration-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Return from settings hydration session");
    await seedTranscriptMessages(harness, window, {
      count: 120,
      textFactory: (index) => `return hydration transcript row ${index}`,
    });

    await expect
      .poll(async () => window.locator("[data-timeline-row-id]").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect(window.getByTestId("transcript")).toContainText(/return hydration transcript row \d+/);
    await window.locator(".timeline-pane").evaluate((pane) => {
      pane.scrollTop = Math.floor(pane.scrollHeight / 2);
    });

    await window.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();

    await expect(window.getByTestId("transcript")).toBeVisible();
    await expect
      .poll(async () => window.locator("[data-timeline-row-id]").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect(window.getByTestId("transcript")).toContainText(/return hydration transcript row \d+/);
  } finally {
    await harness.close();
  }
});
