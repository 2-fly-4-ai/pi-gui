import type { SessionDriverEvent } from "@pi-gui/session-driver";
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
    await expect(toggle.locator("svg")).toBeVisible();
    await expect(toggle.locator("svg.lucide-brain")).toBeVisible();
    await expect(toggle.locator("img")).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText(thinkingText);
    await expect(window.locator(".timeline-item--thinking-running .timeline-thinking__icon")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(window.getByTestId("transcript")).not.toContainText(thinkingText);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(window.getByTestId("transcript")).toContainText(thinkingText);

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

test("shows thinking immediately before thinking text arrives", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-thinking-start-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Thinking starts immediately");

    const toggle = window.getByTestId("thinking-trace-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };

    await emitTestSessionEvent(harness, {
      type: "assistantThinkingStarted",
      sessionRef,
      timestamp: new Date().toISOString(),
    } satisfies Extract<SessionDriverEvent, { type: "assistantThinkingStarted" }>);

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("Thinking…");
    await expect(transcript.locator(".timeline-thinking__elapsed")).toContainText(/\d+s/);

    await emitTestSessionEvent(harness, {
      type: "assistantThinkingDelta",
      sessionRef,
      timestamp: new Date().toISOString(),
      text: "Checking deployment state before choosing a command.",
    } satisfies Extract<SessionDriverEvent, { type: "assistantThinkingDelta" }>);

    await expect(transcript).toContainText("Checking deployment state before choosing a command.");
  } finally {
    await harness.close();
  }
});

test("shows running command output without foregrounding raw JSON", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-tool-output-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Tool output visibility");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    const timestamp = new Date().toISOString();
    const command = "printf 'first line\\nsecond line\\n'";

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      toolName: "bash",
      callId: "bash-live-output-1",
      input: { command },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("Running printf");
    await expect(transcript.locator(".timeline-tool__spinner")).toBeVisible();

    await expect(transcript).toContainText("Still running.");
    await expect(transcript).toContainText("No stdout/stderr emitted yet.");
    await expect(transcript).toContainText(/bash · running for \d+s/);
    await expect(transcript).toContainText(`$ ${command}`);
    await expect(transcript).not.toContainText('"command"');

    const runningToolButton = transcript.getByRole("button", { name: /Running printf/ });
    await expect(runningToolButton).toHaveAttribute("aria-expanded", "true");

    await runningToolButton.click();
    await expect(runningToolButton).toHaveAttribute("aria-expanded", "false");
    await expect(transcript).not.toContainText(`$ ${command}`);

    await emitTestSessionEvent(harness, {
      type: "toolUpdated",
      sessionRef,
      timestamp: new Date().toISOString(),
      callId: "bash-live-output-1",
      text: "live output one\nlive output two",
    } satisfies Extract<SessionDriverEvent, { type: "toolUpdated" }>);

    await expect(runningToolButton).toHaveAttribute("aria-expanded", "false");
    await expect(transcript).not.toContainText("live output one");

    await runningToolButton.click();
    await expect(runningToolButton).toHaveAttribute("aria-expanded", "true");
    await expect(transcript).toContainText("live output one");
    await expect(transcript).toContainText("live output two");
    await expect(transcript).not.toContainText('"command"');
  } finally {
    await harness.close();
  }
});
