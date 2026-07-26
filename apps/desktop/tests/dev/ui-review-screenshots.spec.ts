import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createSessionViaIpc,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  seedTranscriptMessages,
  waitForWorkspaceByPath,
  writeTextFile,
} from "../helpers/electron-app";

const OUT_DIR = process.env.UI_REVIEW_OUT_DIR ?? "/tmp";

const SAMPLE_REPLY = [
  "## Plan",
  "",
  "I looked at `src/server.ts` and the failing test. Here's what I found:",
  "",
  "1. The retry loop never backs off, so the queue saturates.",
  "2. `parseConfig` swallows the validation error.",
  "3. Two tests assert on stale fixtures.",
  "",
  "```ts",
  "export function backoff(attempt: number): number {",
  "  return Math.min(1000 * 2 ** attempt, 30_000);",
  "}",
  "```",
  "",
  "| file | change |",
  "| --- | --- |",
  "| src/server.ts | add backoff |",
  "| src/config.ts | rethrow validation error |",
  "",
  "> Note: the fixture update touches 12 snapshot files.",
].join("\n");

test("capture ui review screenshots", async () => {
  test.setTimeout(300_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("ui-review-workspace");
  await mkdir(join(workspacePath, "plans"), { recursive: true });
  await writeFile(join(workspacePath, "plans", "active.md"), "# Final product experience plan\n");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    const shot = async (name: string) => {
      await window.waitForTimeout(700);
      await window.screenshot({ path: join(OUT_DIR, `${name}.png`) });
      console.log(`captured ${name}`);
    };

    await waitForWorkspaceByPath(window, workspacePath);

    await createSessionViaIpc(window, workspacePath, "Fix retry backoff");
    await seedTranscriptMessages(harness, window, { count: 1, textFactory: () => SAMPLE_REPLY });
    await createSessionViaIpc(window, workspacePath, "Investigate flaky e2e suite");
    await seedTranscriptMessages(harness, window, {
      count: 2,
      textFactory: (i) => (i === 0 ? SAMPLE_REPLY : "Short follow-up answer confirming the fix landed and tests pass."),
    });
    await shot("01-thread-light");

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    const selectedSession = selectedWorkspace?.sessions.find((session) => session.id === state.selectedSessionId);
    if (!selectedWorkspace || !selectedSession) {
      throw new Error("Expected selected workspace and session for the UI review states");
    }
    const sessionRef = { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id };
    const workspace = {
      workspaceId: selectedWorkspace.id,
      path: selectedWorkspace.path,
      displayName: selectedWorkspace.name,
    };
    const runId = "ui-review-active-run";
    const startedAt = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp: startedAt,
      runId,
      snapshot: {
        ref: sessionRef,
        workspace,
        title: selectedSession.title,
        status: "running",
        updatedAt: startedAt,
        preview: "Inspecting the workspace",
        runningRunId: runId,
      },
    });
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp: startedAt,
      runId,
      toolName: "read",
      callId: "ui-review-read",
      input: { path: "src/server.ts" },
    });
    await shot("02-thread-running");

    await emitTestSessionEvent(harness, {
      type: "subagentRunUpdated",
      sessionRef,
      timestamp: new Date().toISOString(),
      runId,
      subagentRunId: "ui-review-reviewer",
      parentSession: sessionRef,
      toolCallId: "ui-review-agent-call",
      status: "progress",
      role: "reviewer",
      agentName: "Reviewer",
      description: "Review the retry fix",
      toolUseCount: 3,
      elapsedMs: 4_000,
      progress: 0.5,
    } satisfies Extract<SessionDriverEvent, { type: "subagentRunUpdated" }>);
    await shot("03-thread-subagent");

    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef,
      timestamp: new Date().toISOString(),
      runId,
      request: {
        kind: "confirm",
        requestId: "ui-review-approval",
        title: "Confirm project action",
        message: "Allow the extension to run the workspace verification action?",
      },
    });
    await expect(window.getByTestId("extension-dialog")).toBeVisible();
    await shot("04-thread-approval");
    await window.getByTestId("extension-dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(window.getByTestId("extension-dialog")).toHaveCount(0);

    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp: new Date().toISOString(),
      runId,
      callId: "ui-review-read",
      success: false,
      output: "Unable to read the requested fixture.",
    });
    await emitTestSessionEvent(harness, {
      type: "runFailed",
      sessionRef,
      timestamp: new Date().toISOString(),
      runId,
      error: {
        code: "fixture_unavailable",
        message: "The requested fixture was unavailable. Retry or open logs for details.",
      },
    });
    await shot("05-thread-failed");

    await createSessionViaIpc(window, workspacePath, "Completed verification run");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "Implemented the retry fix and verified the focused tests.",
    });
    const completedState = await getDesktopState(window);
    const completedWorkspace = completedState.workspaces.find(
      (candidate) => candidate.id === completedState.selectedWorkspaceId,
    );
    const completedSession = completedWorkspace?.sessions.find(
      (candidate) => candidate.id === completedState.selectedSessionId,
    );
    if (!completedWorkspace || !completedSession) {
      throw new Error("Expected the completed UI review session");
    }
    const completedSessionRef = {
      workspaceId: completedWorkspace.id,
      sessionId: completedSession.id,
    };
    const completedRunId = "ui-review-completed-run";
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef: completedSessionRef,
      timestamp: "2026-07-25T12:00:00.000Z",
      runId: completedRunId,
      snapshot: {
        ref: completedSessionRef,
        workspace: {
          workspaceId: completedWorkspace.id,
          path: completedWorkspace.path,
          displayName: completedWorkspace.name,
        },
        title: completedSession.title,
        status: "running",
        updatedAt: "2026-07-25T12:00:00.000Z",
        preview: "Verifying the focused tests",
        runningRunId: completedRunId,
      },
    });
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef: completedSessionRef,
      timestamp: "2026-07-25T12:00:00.100Z",
      runId: completedRunId,
      toolName: "exec_command",
      callId: "ui-review-verification",
      input: { cmd: "pnpm test:unit" },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef: completedSessionRef,
      timestamp: "2026-07-25T12:00:04.000Z",
      runId: completedRunId,
      callId: "ui-review-verification",
      success: true,
      output: { exitCode: 0, stdout: "197 tests passed" },
    });
    await emitTestSessionEvent(harness, {
      type: "runCompleted",
      sessionRef: completedSessionRef,
      timestamp: "2026-07-25T12:00:05.000Z",
      runId: completedRunId,
      snapshot: {
        ref: completedSessionRef,
        workspace: {
          workspaceId: completedWorkspace.id,
          path: completedWorkspace.path,
          displayName: completedWorkspace.name,
        },
        title: completedSession.title,
        status: "idle",
        updatedAt: "2026-07-25T12:00:05.000Z",
        preview: "Observed completion",
      },
    });
    await expect(window.getByTestId("task-evidence-surface")).toHaveAttribute("data-product-state", "success");
    await shot("06-thread-verified-success");

    await seedTranscriptMessages(harness, window, {
      count: 180,
      textFactory: (index) => `Long timeline baseline row ${index}: inspected a file and recorded the result.`,
    });
    await expect(window.locator(".timeline-summary").first()).toHaveAttribute("tabindex", "0");
    await expect(window.locator(".timeline-summary").first()).toHaveAttribute("title", /.+/);
    await shot("07-thread-long-timeline");

    await window.keyboard.press("Meta+k");
    await shot("07-command-palette");
    await window.keyboard.press("Escape");
    await window.keyboard.press("Meta+k");
    const palette = window.getByTestId("command-palette");
    await palette.getByPlaceholder("Search commands…").fill("workspace hub");
    await palette.getByRole("option", { name: /Workspace hub/ }).click();
    await expect(window.getByTestId("artifact-shelf")).toContainText("plans/active.md");
    await shot("07-artifact-shelf");
    await window.keyboard.press("Escape");

    await writeTextFile(join(workspacePath, "README.md"), "# ui-review-workspace\n\nChanged for the diff baseline.\n");
    await window.getByLabel("Toggle changes").click();
    await expect(window.locator(".diff-panel")).toBeVisible();
    await shot("08-thread-diff");
    await window.getByLabel("Toggle changes").click();
    await window.getByTestId("composer").fill("/review");
    await window.getByTestId("composer").press("Enter");
    await expect(window.getByTestId("review-surface")).toBeVisible();
    await shot("08-review-surface");
    await window.evaluate(() =>
      (window as unknown as { piApp: { setActiveView(view: string): Promise<unknown> } }).piApp.setActiveView("threads"),
    );
    await window.getByRole("button", { name: "Open panels menu" }).click();
    await shot("09-panels-menu");
    await window.keyboard.press("Escape");

    const views = ["new-thread", "skills", "extensions", "settings", "display-mode"] as const;
    for (const view of views) {
      await window.evaluate((v) => (window as unknown as { piApp: { setActiveView(view: string): Promise<unknown> } }).piApp.setActiveView(v), view);
      await shot(`10-${view}-light`);
    }

    const setTheme = (mode: string) =>
      window.evaluate((m) => (window as unknown as { piApp: { setThemeMode(mode: string): Promise<unknown> } }).piApp.setThemeMode(m), mode);
    const setView = (view: string) =>
      window.evaluate((v) => (window as unknown as { piApp: { setActiveView(view: string): Promise<unknown> } }).piApp.setActiveView(v), view);

    await setTheme("light");
    await setView("threads");
    await shot("30-thread-lightmode");
    await window.getByRole("button", { name: "Open panels menu" }).click();
    await shot("30-panels-menu-lightmode");
    await window.keyboard.press("Escape");
    await setView("new-thread");
    await shot("31-new-thread-lightmode");
    await setView("settings");
    await shot("32-settings-lightmode");
    await setView("skills");
    await shot("33-skills-lightmode");
    await setView("extensions");
    await shot("34-extensions-lightmode");
    await setView("display-mode");
    await shot("35-display-mode-lightmode");

    await setTheme("dark");
    await setView("threads");
    await shot("40-thread-darkmode");
    await window.getByRole("button", { name: "Open panels menu" }).click();
    await shot("40-panels-menu-darkmode");
    await window.keyboard.press("Escape");
    await setView("new-thread");
    await shot("41-new-thread-darkmode");
    await setView("settings");
    await shot("42-settings-darkmode");
    await setView("skills");
    await shot("43-skills-darkmode");
    await setView("extensions");
    await shot("44-extensions-darkmode");
    await setView("display-mode");
    await shot("45-display-mode-darkmode");
    await setTheme("light");
    await setView("threads");
    await window.emulateMedia({ forcedColors: "active" });
    await shot("50-thread-forced-colors");
    await window.emulateMedia({ forcedColors: "none" });
    await window.evaluate(() => {
      document.documentElement.dataset.density = "compact";
      document.documentElement.style.setProperty("--transcript-font-size", "15px");
      document.documentElement.style.setProperty("--mono-font-size", "13px");
    });
    await shot("51-thread-compact-light");
    await setTheme("dark");
    await shot("52-thread-compact-dark");
    await window.setViewportSize({ width: 720, height: 760 });
    await shot("53-thread-compact-dark-narrow");
  } finally {
    await harness.close();
  }
});
