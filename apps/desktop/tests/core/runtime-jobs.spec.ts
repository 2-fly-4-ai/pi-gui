import { expect, test } from "@playwright/test";
import type { RuntimeJobSnapshot, SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("shows runtime job visibility for running tools and background jobs", async () => {
  test.setTimeout(90_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("runtime-jobs-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Runtime job visibility");

    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();
    const sessionRef = {
      workspaceId: workspaceId!,
      sessionId: sessionId!,
    };
    const timestamp = new Date().toISOString();

    const runningToolJob = {
      id: "tool:bash-runtime-1",
      sessionRef,
      runId: "runtime-visibility-run",
      toolCallId: "bash-runtime-1",
      kind: "tool",
      status: "running",
      confidence: "tracked",
      title: "Bash",
      command: "sleep 30",
      cwd: workspacePath,
      startedAt: timestamp,
      updatedAt: timestamp,
      process: {
        pid: 4242,
        command: "sleep 30",
        cwd: workspacePath,
        status: "running",
        confidence: "tracked",
        startedAt: timestamp,
        updatedAt: timestamp,
      },
      message: "Shell tool still running",
    } satisfies RuntimeJobSnapshot;

    await emitTestSessionEvent(harness, {
      type: "runtimeJobUpdated",
      sessionRef,
      timestamp,
      job: runningToolJob,
      summary: {
        agentStatus: "running",
        activeToolCount: 1,
        backgroundJobCount: 0,
        unknownJobCount: 0,
        jobs: [runningToolJob],
      },
    } satisfies Extract<SessionDriverEvent, { type: "runtimeJobUpdated" }>);

    const runningToolCard = window.getByTestId("runtime-job-card").filter({ hasText: "Bash" }).first();
    await expect(runningToolCard).toBeVisible();
    await expect(runningToolCard).toContainText("pid");
    await expect(runningToolCard).toContainText("4242");
    await expect(window.getByTestId("topbar-runtime-status")).toContainText("Tool running");

    const backgroundTimestamp = new Date(Date.now() + 1_000).toISOString();
    const backgroundJob = {
      id: "process:5151",
      sessionRef,
      runId: "runtime-visibility-run",
      kind: "background",
      status: "background",
      confidence: "survived",
      title: "Background worker",
      command: "npm run watch",
      cwd: workspacePath,
      startedAt: backgroundTimestamp,
      updatedAt: backgroundTimestamp,
      process: {
        pid: 5151,
        processGroupId: 5151,
        command: "npm run watch",
        cwd: workspacePath,
        status: "running",
        confidence: "survived",
        startedAt: backgroundTimestamp,
        updatedAt: backgroundTimestamp,
      },
      children: [
        {
          pid: 5151,
          processGroupId: 5151,
          command: "npm run watch",
          cwd: workspacePath,
          status: "running",
          confidence: "survived",
          startedAt: backgroundTimestamp,
          updatedAt: backgroundTimestamp,
        },
      ],
      message: "Detached watcher still running",
    } satisfies RuntimeJobSnapshot;

    await emitTestSessionEvent(harness, {
      type: "runtimeJobUpdated",
      sessionRef,
      timestamp: backgroundTimestamp,
      job: backgroundJob,
      summary: {
        agentStatus: "idle",
        activeToolCount: 0,
        backgroundJobCount: 1,
        unknownJobCount: 0,
        jobs: [backgroundJob],
      },
    } satisfies Extract<SessionDriverEvent, { type: "runtimeJobUpdated" }>);

    const backgroundCard = window.getByTestId("runtime-job-card").filter({ hasText: "Background worker" }).first();
    await expect(backgroundCard).toBeVisible();
    await expect(backgroundCard).toContainText("1 background job");

    await expect(window.getByTestId("topbar-runtime-status")).toContainText("1 background job");
    await expect(window.getByTestId("composer-runtime-status")).toContainText("1 background job");

    const sessionRow = window.locator(".session-row", { hasText: "Runtime job visibility" }).first();
    await expect(sessionRow.getByTestId("session-runtime-badge")).toHaveText("1");

    await expect
      .poll(async () => {
        const nextState = await getDesktopState(window);
        const workspace = nextState.workspaces.find((entry) => entry.id === workspaceId);
        return workspace?.sessions.find((entry) => entry.id === sessionId)?.runtimeSummary;
      })
      .toMatchObject({
        activeToolCount: 0,
        backgroundJobCount: 1,
        unknownJobCount: 0,
        jobs: [{ id: backgroundJob.id }],
      });
  } finally {
    await harness.close();
  }
});
