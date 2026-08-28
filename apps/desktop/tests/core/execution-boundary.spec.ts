import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  type PiAppWindow,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("persists an execution boundary, enforces tool access, and records one-time exceptions", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("execution-boundary");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Execution boundary");
    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId ?? "";
    const sessionId = state.selectedSessionId ?? "";

    await window.getByTestId("execution-boundary-trigger").click();
    const boundary = window.getByTestId("execution-boundary");
    await expect(boundary).toBeVisible();
    await expect(boundary).toHaveAttribute("aria-modal", "true");
    await expect(boundary).toHaveCSS("background-color", /rgb/);
    const boundaryBox = await boundary.boundingBox();
    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(boundaryBox).not.toBeNull();
    expect(boundaryBox!.y).toBeGreaterThanOrEqual(0);
    expect(boundaryBox!.y + boundaryBox!.height).toBeLessThanOrEqual(viewport.height);
    await window.keyboard.press("Escape");
    await expect(boundary).toBeHidden();
    await expect(window.getByTestId("execution-boundary-trigger")).toBeFocused();
    await window.getByTestId("execution-boundary-trigger").click();
    await boundary.getByLabel("Enable boundary for this thread").check();
    await boundary.getByLabel("Maximum files").fill("1");
    await boundary.getByLabel("Allowed paths").fill("src/**");
    await boundary.getByLabel("Dependency changes").selectOption("approval");
    await boundary.getByLabel("Tool access enforced").selectOption("read-only");
    await boundary.getByRole("button", { name: "Apply boundary" }).click();

    await expect(window.getByTestId("execution-boundary-trigger")).toContainText("active");
    await expect(window.getByTestId("tool-access-trigger")).toContainText("Read-only");
    await expect(boundary).toContainText("Elapsed time and unannounced runtime behavior remain advisory");
    await boundary.getByRole("button", { name: "Close execution boundary" }).click();

    const persisted = await window.evaluate(
      ({ workspaceId, sessionId }) =>
        (window as PiAppWindow).piApp?.getExecutionBoundary(workspaceId, sessionId),
      { workspaceId, sessionId },
    );
    expect(persisted).toMatchObject({
      enabled: true,
      maxFiles: 1,
      allowPaths: ["src/**"],
      toolAccess: { mode: "read-only" },
    });

    const composer = window.getByTestId("composer");
    await composer.fill("Review @src/app.ts and @tests/app.test.ts");
    const approval = new Promise<string>((resolve) => {
      window.once("dialog", async (dialog) => {
        resolve(dialog.message());
        await dialog.accept();
      });
    });
    await window.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => approval).toContain("Approve this submission once?");
    await expect(window.getByTestId("transcript")).toContainText("Review @src/app.ts and @tests/app.test.ts");

    const evidence = await window.evaluate(
      ({ workspaceId, sessionId }) =>
        (window as PiAppWindow).piApp?.listTaskEvidence({
          workspaceId,
          sessionId,
          kinds: ["decision", "approval"],
        }),
      { workspaceId, sessionId },
    );
    expect(evidence?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "decision",
        summary: expect.stringContaining("Execution boundary updated"),
      }),
      expect.objectContaining({
        kind: "approval",
        approval: expect.objectContaining({ requestKind: "boundary", decision: "approved" }),
      }),
    ]));

    await window.getByTestId("execution-boundary-trigger").click();
    await boundary.getByRole("button", { name: "Disable boundary" }).click();
    await expect(window.getByTestId("execution-boundary-trigger")).toContainText("off");
    await expect(window.getByTestId("tool-access-trigger")).toContainText("Full");
  } finally {
    await harness.close();
  }
});
