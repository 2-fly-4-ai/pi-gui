import { expect, test } from "@playwright/test";
import type { RuntimeJobSnapshot, SessionDriverEvent } from "@pi-gui/session-driver";

const NONEXISTENT_REFRESH_TEST_PID = 999_999_999;
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
        pid: NONEXISTENT_REFRESH_TEST_PID,
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
    await expect(runningToolCard).toContainText(String(NONEXISTENT_REFRESH_TEST_PID));
    await expect(runningToolCard.getByTestId("runtime-job-refresh-button")).toBeVisible();
    await expect(runningToolCard.getByTestId("runtime-job-stop-button")).toBeVisible();
    await expect(window.getByTestId("topbar-runtime-status")).toContainText("Tool running");

    await runningToolCard.getByTestId("runtime-job-refresh-button").click();
    await expect
      .poll(async () => {
        const nextState = await getDesktopState(window);
        const workspace = nextState.workspaces.find((entry) => entry.id === workspaceId);
        return workspace?.sessions.find((entry) => entry.id === sessionId)?.runtimeSummary?.jobs.length ?? -1;
      })
      .toBe(0);

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
    await expect(backgroundCard.getByTestId("runtime-job-refresh-button")).toBeVisible();
    await expect(backgroundCard.getByTestId("runtime-job-stop-button")).toBeVisible();

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

    const claimedTimestamp = new Date(Date.now() + 2_000).toISOString();
    const claimedJob = {
      id: "process:6262",
      sessionRef,
      runId: "runtime-visibility-run",
      kind: "background",
      status: "unknown",
      confidence: "claimed",
      title: "Claimed worker",
      command: "npm run claimed",
      cwd: workspacePath,
      startedAt: claimedTimestamp,
      updatedAt: claimedTimestamp,
      process: {
        pid: 6262,
        command: "npm run claimed",
        cwd: workspacePath,
        status: "running",
        confidence: "claimed",
        startedAt: claimedTimestamp,
        updatedAt: claimedTimestamp,
      },
      message: "Reported by tool output",
    } satisfies RuntimeJobSnapshot;

    await emitTestSessionEvent(harness, {
      type: "runtimeJobUpdated",
      sessionRef,
      timestamp: claimedTimestamp,
      job: claimedJob,
      summary: {
        agentStatus: "idle",
        activeToolCount: 0,
        backgroundJobCount: 0,
        unknownJobCount: 1,
        jobs: [claimedJob],
      },
    } satisfies Extract<SessionDriverEvent, { type: "runtimeJobUpdated" }>);

    const claimedCard = window.getByTestId("runtime-job-card").filter({ hasText: "Claimed worker" }).first();
    await expect(claimedCard).toBeVisible();
    await expect(claimedCard).toContainText("unknown · claimed");
    await expect(window.getByTestId("topbar-runtime-status")).toContainText("Unknown background activity");
    await expect(sessionRow.getByTestId("session-runtime-badge")).toHaveText("1");
    await expect(claimedCard.getByTestId("runtime-job-refresh-button")).toBeVisible();
    await expect(claimedCard.getByTestId("runtime-job-stop-button")).toHaveCount(0);

    const stopAttempt = await window.evaluate(async ({ target, jobId }) => {
      const app = (window as typeof window & {
        piApp?: { stopRuntimeJob: (target: typeof target, jobId: string) => Promise<{ lastError?: string }> };
      }).piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      return app.stopRuntimeJob(target, jobId);
    }, { target: sessionRef, jobId: claimedJob.id });
    expect(stopAttempt.lastError).toMatch(/unknown runtime job|cannot be stopped|failed to stop/i);
  } finally {
    await harness.close();
  }
});
