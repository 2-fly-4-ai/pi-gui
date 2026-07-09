import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
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

test("summarizes subagent result transcripts instead of rendering raw JSONL", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-subagent-result-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Subagent result visibility");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    const timestamp = new Date().toISOString();
    const rawResult = [
      "Agent: 466fd35c-91a5-450",
      "Type: Reviewer | Status: completed | Tool uses: 10 | Duration: 38.2s",
      "Description: Task 1 spec review",
      "",
      "Result:",
      '{"type":"session","version":3,"id":"raw-session"}',
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"**Evaluating tool usage for compliance**"}}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"<pi-subagent-result-v1>\\nSTATUS: APPROVED\\nSUMMARY: Reviewed the task spec.\\nISSUES: none\\nTESTS: pnpm typecheck passed\\nARTIFACTS: review.md\\n</pi-subagent-result-v1>"}]}}',
      "[Result truncated: showing 20,000 of 3,247,498 characters.]",
      "[Full output: /var/folders/example/tasks/466fd35c-91a5-450.output]",
    ].join("\n");

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      toolName: "get_subagent_result",
      callId: "subagent-result-1",
      input: { agent_id: "466fd35c-91a5-450" },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp: new Date().toISOString(),
      callId: "subagent-result-1",
      success: true,
      output: rawResult,
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);

    const transcript = window.getByTestId("transcript");
    const toolButton = transcript.getByRole("button", { name: /get_subagent_result/ });
    await expect(toolButton).toHaveAttribute("aria-expanded", "false");
    await toolButton.click();
    await expect(toolButton).toHaveAttribute("aria-expanded", "true");

    await expect(transcript).toContainText("Agent: 466fd35c-91a5-450");
    await expect(transcript).toContainText("STATUS: APPROVED");
    await expect(transcript).toContainText("SUMMARY: Reviewed the task spec.");
    await expect(transcript).toContainText("ISSUES: none");
    await expect(transcript).toContainText("TESTS: pnpm typecheck passed");
    await expect(transcript).toContainText("Transcript: /var/folders/example/tasks/466fd35c-91a5-450.output");
    await transcript.getByText("Full output", { exact: true }).click();
    await expect(transcript.getByText("/var/folders/example/tasks/466fd35c-91a5-450.output", { exact: true })).toBeVisible();
    await expect(transcript.getByRole("button", { name: "Copy full output path" })).toBeVisible();
    await expect(transcript).not.toContainText('"type":"message_update"');
    await expect(transcript).not.toContainText("thinking_delta");
    await expect(transcript).not.toContainText("Result truncated");
  } finally {
    await harness.close();
  }
});

test("renders typed subagent lifecycle events in the transcript", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-subagent-lifecycle-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Subagent lifecycle visibility");
    await selectSession(window, "Subagent lifecycle visibility");
    const transcript = window.getByTestId("transcript");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "subagentRunUpdated",
      sessionRef,
      timestamp,
      subagentRunId: "agent-call-1",
      parentSession: sessionRef,
      toolCallId: "agent-call-1",
      status: "started",
      role: "reviewer",
      description: "Review current diff",
    } satisfies Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>);

    await expect(transcript.getByRole("button", { name: /Started reviewer/ })).toBeVisible();

    await emitTestSessionEvent(harness, {
      type: "subagentRunUpdated",
      sessionRef,
      timestamp: new Date().toISOString(),
      subagentRunId: "agent-call-1",
      parentSession: sessionRef,
      toolCallId: "agent-call-1",
      status: "completed",
      role: "reviewer",
      toolUseCount: 3,
      elapsedMs: 2400,
      summary: "Reviewed the diff and found no blocking issues.",
      transcriptPath: "/var/folders/example/tasks/agent-call-1.output",
      artifacts: ["review.md"],
    } satisfies Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>);

    const completedButton = transcript.getByRole("button", { name: /Completed reviewer/ });
    await expect(completedButton).toBeVisible();
    await completedButton.click();
    await expect(transcript).toContainText("Reviewed the diff and found no blocking issues.");
    await expect(transcript).toContainText("Tool uses: 3");
    await expect(transcript).toContainText("Elapsed: 2s");
    await expect(transcript).toContainText("Transcript: /var/folders/example/tasks/agent-call-1.output");
    await expect(transcript).toContainText("Artifacts: review.md");
    await transcript.getByText("Full transcript", { exact: true }).click();
    await expect(transcript.getByText("/var/folders/example/tasks/agent-call-1.output", { exact: true })).toBeVisible();
    await expect(transcript.getByRole("button", { name: "Copy full transcript path" })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("caps oversized tool output before rendering the transcript", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-tool-output-cap-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Tool output cap");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    const timestamp = new Date().toISOString();
    const tailSentinel = "TAIL_SENTINEL_SHOULD_NOT_RENDER";
    const oversizedOutput = `${"x".repeat(12_050)}${tailSentinel}`;

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      toolName: "debug_dump",
      callId: "oversized-tool-output-1",
      input: { title: "large transcript payload" },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp: new Date().toISOString(),
      callId: "oversized-tool-output-1",
      success: true,
      output: oversizedOutput,
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);

    const transcript = window.getByTestId("transcript");
    const toolButton = transcript.getByRole("button", { name: /debug_dump/ });
    await expect(toolButton).toHaveAttribute("aria-expanded", "false");
    await toolButton.click();
    await expect(toolButton).toHaveAttribute("aria-expanded", "true");

    await expect(transcript).toContainText("Output truncated for chat");
    await expect(transcript).toContainText("showing first 12,000");
    await expect(transcript).not.toContainText(tailSentinel);
  } finally {
    await harness.close();
  }
});
