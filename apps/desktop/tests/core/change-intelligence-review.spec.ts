import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  commitAllInGitRepo,
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("groups evidence-backed changes and safely rejects Pi-attributed hunks", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("change-intelligence-review");
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, "src"), { recursive: true });
  const filePath = join(workspacePath, "src/example.ts");
  const before = "export const value = 1;\n";
  const after = "export const value = 2;\n";
  await writeFile(filePath, before);
  await commitAllInGitRepo(workspacePath, "initial");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Change intelligence");
    await window.getByTestId("composer").fill("Update the example constant for the review workflow.");
    await window.getByRole("button", { name: "Send message" }).click();
    await expect(window.getByTestId("transcript")).toContainText("Update the example constant");
    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId ?? "",
      sessionId: state.selectedSessionId ?? "",
    };
    const startedAt = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      runId: "review-run",
      timestamp: startedAt,
      toolName: "Edit",
      callId: "edit-example",
      input: { file_path: "src/example.ts" },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await expect.poll(() => window.evaluate(
      (workspaceId) => window.piApp?.listCheckpoints(workspaceId).then((items) => items.length),
      sessionRef.workspaceId,
    )).toBe(1);
    await writeFile(filePath, after);
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      runId: "review-run",
      timestamp: new Date(Date.parse(startedAt) + 1_000).toISOString(),
      callId: "edit-example",
      success: true,
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      runId: "review-run",
      timestamp: new Date(Date.parse(startedAt) + 2_000).toISOString(),
      toolName: "exec_command",
      callId: "test-example",
      input: { cmd: "pnpm test src/example.ts", cwd: workspacePath },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      runId: "review-run",
      timestamp: new Date(Date.parse(startedAt) + 3_000).toISOString(),
      callId: "test-example",
      success: true,
      output: { exitCode: 0 },
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);
    await expect.poll(() => window.evaluate(
      ({ workspaceId, sessionId }) => window.piApp?.listTaskEvidence({
        workspaceId,
        sessionId,
        kinds: ["test"],
      }).then((page) => page.records[0]?.verification?.relatedPaths),
      sessionRef,
    )).toEqual(["src/example.ts"]);

    await window.getByTestId("composer").fill("/review");
    await window.getByTestId("composer").press("Enter");
    const review = window.getByTestId("review-surface");
    await expect(review).toContainText("Update the example constant for the review workflow.");
    const evidence = review.getByTestId("review-group-evidence");
    await expect(evidence).toContainText("src/example.ts · pi");
    await expect(evidence).toContainText("Verification · verified");
    await expect(evidence).toContainText("run review-run");
    await expect(evidence).toContainText("tool edit-example");
    await expect(evidence).toContainText("request");
    await review.getByRole("button", { name: "Accept as reviewed" }).click();
    await expect(review).toContainText("Review complete · all files accepted as reviewed");

    await review.locator(".review-mode__line").first().click();
    const hunkControl = review.getByTestId("hunk-review-control");
    await expect(hunkControl).toContainText("Pi-attributed hunk recovery");
    const safeHunk = hunkControl.locator('input[type="checkbox"]:not([disabled])');
    await safeHunk.check();
    await expect(safeHunk).toBeChecked();
    await hunkControl.locator("summary").first().click();
    await expect(safeHunk).toBeChecked();
    await expect(hunkControl).toContainText("export const value = 2");
    window.once("dialog", (dialog) => dialog.accept());
    await hunkControl.getByRole("button", { name: /Reject 1 hunk/ }).click();
    await expect.poll(() => readFile(filePath, "utf8")).toBe(before);
  } finally {
    await harness.close();
  }
});
