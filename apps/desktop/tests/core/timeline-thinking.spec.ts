import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("toggles assistant thinking blocks in the chat", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-thinking-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Thinking visibility");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    const thinkingText = "I should inspect the route handling before editing.";

    await emitTestSessionEvent(harness, {
      type: "assistantThinkingDelta",
      sessionRef,
      timestamp: new Date().toISOString(),
      text: thinkingText,
    });

    await expect(window.getByTestId("transcript")).not.toContainText(thinkingText);
    const toggle = window.getByTestId("thinking-trace-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect.poll(async () => (await getDesktopState(window)).showThinking).toBe(true);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(window.getByTestId("transcript")).toContainText(thinkingText);
    await expect(window.locator(".timeline-item--thinking-running .timeline-thinking__icon")).toBeVisible();

    await emitTestSessionEvent(harness, {
      type: "assistantThinkingFinished",
      sessionRef,
      timestamp: new Date().toISOString(),
    });
    await expect(window.locator(".timeline-item--thinking-running")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
