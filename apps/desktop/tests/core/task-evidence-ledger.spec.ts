import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  type PiAppWindow,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("publishes narrow evidence deltas and rehydrates evidence after relaunch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("task-evidence-workspace");
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src/example.test.ts"), "const state = 'before';\n");
  const first = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let workspaceId = "";
  let sessionId = "";
  try {
    const window = await first.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Evidence persistence");
    const state = await getDesktopState(window);
    workspaceId = state.selectedWorkspaceId ?? "";
    sessionId = state.selectedSessionId ?? "";
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();
    const sessionRef = { workspaceId, sessionId };
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === workspaceId);
    const selectedSession = selectedWorkspace?.sessions.find((session) => session.id === sessionId);
    await emitTestSessionEvent(first, {
      type: "sessionUpdated",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T11:59:59.000Z",
      snapshot: {
        ref: sessionRef,
        workspace: {
          workspaceId,
          path: workspacePath,
          displayName: selectedWorkspace?.name ?? "Workspace",
        },
        title: selectedSession?.title ?? "Evidence persistence",
        status: "running",
        runningRunId: "evidence-run-1",
        updatedAt: "2026-07-24T11:59:59.000Z",
      },
    } satisfies Extract<SessionDriverEvent, { type: "sessionUpdated" }>);

    const deltaPromise = window.evaluate(() => new Promise<unknown>((resolve) => {
      const unsubscribe = (window as PiAppWindow).piApp?.onTaskEvidenceDelta((delta) => {
        unsubscribe?.();
        resolve(delta);
      });
    }));
    await emitTestSessionEvent(first, {
      type: "toolStarted",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T12:00:00.000Z",
      toolName: "exec_command",
      callId: "evidence-call-1",
      input: { cmd: "pnpm exec vitest run src/example.test.ts" },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);

    const delta = await deltaPromise as {
      workspaceId: string;
      sessionId: string;
      sequence: number;
      records: readonly { kind: string; status?: string }[];
    };
    expect(delta).toMatchObject({ workspaceId, sessionId });
    expect(delta.sequence).toBeGreaterThanOrEqual(1);
    expect(["activity", "test"]).toContain(delta.records[0]?.kind);
    expect(delta.records[0]?.status).toBe("running");
    await expect(window.getByTestId("task-activity")).toContainText("Running tests");
    await expect(window.getByTestId("task-evidence-surface")).toHaveAttribute("data-product-state", "working");
    await expect(window.getByTestId("topbar")).toContainText("Running tests");
    await expect.poll(() => window.evaluate(
      ({ workspaceId, sessionId }) => (window as PiAppWindow).piApp?.listTaskEvidence({
        workspaceId,
        sessionId,
        runId: "evidence-run-1",
        kinds: ["test"],
      }),
      { workspaceId, sessionId },
    )).toMatchObject({
      records: [{
        kind: "test",
        verification: {
          command: "pnpm exec vitest run src/example.test.ts",
          scope: "package",
        },
      }],
      hasMore: false,
    });
    await emitTestSessionEvent(first, {
      type: "toolStarted",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T12:00:00.050Z",
      toolName: "read",
      callId: "evidence-read-1",
      input: { file_path: join(workspacePath, "src/example.test.ts") },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await expect.poll(() => window.evaluate(
      ({ workspaceId, sessionId }) => (window as PiAppWindow).piApp?.listTaskEvidence({
        workspaceId,
        sessionId,
        runId: "evidence-run-1",
        kinds: ["file-read"],
      }),
      { workspaceId, sessionId },
    )).toMatchObject({ records: [expect.objectContaining({ status: "running" })] });
    await expect(window.getByTestId("task-activity")).toContainText("Running tests");
    await window.waitForTimeout(180);
    await expect(window.getByTestId("task-activity")).toContainText("Reading files");
    await emitTestSessionEvent(first, {
      type: "toolFinished",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T12:00:00.100Z",
      callId: "evidence-read-1",
      success: true,
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);
    await window.waitForTimeout(180);
    await expect(window.getByTestId("task-activity")).toContainText("Running tests");
    await emitTestSessionEvent(first, {
      type: "toolFinished",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T12:00:04.000Z",
      callId: "evidence-call-1",
      success: true,
      output: { exitCode: 0, stdout: "raw output remains outside evidence" },
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);
    await emitTestSessionEvent(first, {
      type: "toolStarted",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T12:00:04.100Z",
      toolName: "edit",
      callId: "evidence-write-1",
      input: { file_path: join(workspacePath, "src/example.test.ts") },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await writeFile(join(workspacePath, "src/example.test.ts"), "const state = 'after';\n");
    await emitTestSessionEvent(first, {
      type: "toolFinished",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T12:00:04.500Z",
      callId: "evidence-write-1",
      success: true,
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);
    await emitTestSessionEvent(first, {
      type: "runCompleted",
      sessionRef,
      runId: "evidence-run-1",
      timestamp: "2026-07-24T12:00:05.000Z",
      snapshot: {
        ref: sessionRef,
        workspace: {
          workspaceId,
          path: workspacePath,
          displayName: selectedWorkspace?.name ?? "Workspace",
        },
        title: selectedSession?.title ?? "Evidence persistence",
        status: "idle",
        updatedAt: "2026-07-24T12:00:05.000Z",
        preview: "Observed completion",
      },
    } satisfies Extract<SessionDriverEvent, { type: "runCompleted" }>);
    await expect(window.getByTestId("completion-card")).toContainText("Run completed");
    await expect(window.getByTestId("task-evidence-surface")).toHaveAttribute("data-product-state", "success");
    await expect(window.getByTestId("task-evidence-surface")).toHaveClass(/task-evidence-surface--success-moment/);
    await expect.poll(() => window.locator(".product-state-accent img").evaluate(
      (image) => image instanceof HTMLImageElement ? image.naturalWidth : 0,
    )).toBeGreaterThan(40);
    await window.getByTestId("completion-card").locator(".completion-card__details > summary").click();
    await expect(window.getByTestId("completion-card")).toContainText("1 verification scopes passed");
    await expect(window.getByTestId("completion-card")).toContainText("6s elapsed");
    await expect(window.getByTestId("completion-card")).toContainText("Checkout");
    await expect(window.getByTestId("completion-card")).toContainText("src/example.test.ts");
    await expect(window.getByTestId("thread-health-strip")).toContainText("package verified");
    await expect(window.getByTestId("completion-card")).toContainText("pnpm exec vitest run src/example.test.ts");
    await expect(window.getByTestId("completion-card")).toContainText("exit 0");
    await expect(window.getByTestId("completion-card")).toContainText("tool");
    await expect(window.getByTestId("completion-card").getByRole("button", { name: "Review changes" })).toBeVisible();
    await window.getByTestId("completion-card").getByRole("button", { name: "Commit" }).click();
    await expect(window.getByTestId("git-commit-dialog")).toBeVisible();
    await window.getByRole("button", { name: "Close Commit changes" }).click();
    const checkpointRecovery = window.getByTestId("checkpoint-recovery");
    await expect(checkpointRecovery).toContainText("src/example.test.ts");
    await expect(checkpointRecovery).toContainText("safe");
    await checkpointRecovery.getByText("Retention · keep up to 100").click();
    await checkpointRecovery.getByLabel("Maximum checkpoints").fill("25");
    await checkpointRecovery.getByLabel("Protect selected checkpoint").check();
    await checkpointRecovery.getByRole("button", { name: "Apply retention" }).click();
    await expect(checkpointRecovery).toContainText("Retention · keep up to 25");
    await expect.poll(() => window.evaluate(
      () => (window as PiAppWindow).piApp?.getCheckpointRetention(),
    )).toMatchObject({
      maxCheckpoints: 25,
      protectedCheckpointIds: [expect.any(String)],
      pendingRestoreCheckpointIds: [expect.any(String)],
    });
    await checkpointRecovery.getByRole("button", { name: "Restore 1 selected" }).click();
    await expect(checkpointRecovery).toContainText("Restore completed");
    expect(await readFile(join(workspacePath, "src/example.test.ts"), "utf8")).toBe("const state = 'before';\n");
  } finally {
    await first.close();
  }

  const relaunched = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await relaunched.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const page = await window.evaluate(
      ({ workspaceId, sessionId }) => (window as PiAppWindow).piApp?.listTaskEvidence({
        workspaceId,
        sessionId,
      }),
      { workspaceId, sessionId },
    );
    expect(page?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "completion" }),
      expect.objectContaining({
        kind: "test",
        correlation: { toolCallId: "evidence-call-1", commandId: "evidence-call-1" },
      }),
    ]));
    const resume = window.getByTestId("resume-card");
    await expect(resume).toContainText("Observed state since this thread was last active");
    await expect(resume).toContainText("Current checkout state was rechecked safely");
    await expect(resume).toContainText("Remaining plan items unavailable");
    await resume.getByRole("button", { name: "Inspect context" }).click();
    await expect(window.getByTestId("context-inspector")).toBeVisible();
    await window.getByRole("button", { name: "Close context inspector" }).click();
    await resume.getByRole("button", { name: "Dismiss resume card for this session" }).click();
    await expect(resume).toHaveCount(0);
    await expect(window.getByTestId("completion-card")).toContainText("Run completed");
  } finally {
    await relaunched.close();
  }
});
