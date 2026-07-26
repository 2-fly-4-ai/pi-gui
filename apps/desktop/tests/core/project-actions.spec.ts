import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
  type PiAppWindow,
} from "../helpers/electron-app";

test("adds a project action and runs it in the selected thread terminal", async () => {
  test.setTimeout(60_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("project-actions");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Project action host");

    await window.getByRole("button", { name: "Add action" }).click();
    const dialog = window.getByRole("dialog", { name: "Add Action" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("Echo Action");
    await dialog.getByLabel("Command").fill("printf 'PROJECT_ACTION_OK\\n'");
    await dialog.getByRole("button", { name: "Save action" }).click();

    const actionButton = window.getByRole("button", { name: "Run action Echo Action" });
    await expect(actionButton).toBeVisible();
    await actionButton.click();

    const terminal = window.getByTestId("integrated-terminal");
    await expect(terminal).toBeVisible();
    await expect(terminal.locator(".xterm-rows")).toContainText("PROJECT_ACTION_OK", { timeout: 15_000 });
    const state = await getDesktopState(window);
    await expect.poll(() => window.evaluate(
      ({ workspaceId, sessionId }) => (window as PiAppWindow).piApp?.listTaskEvidence({
        workspaceId,
        sessionId,
        kinds: ["command"],
      }),
      {
        workspaceId: state.selectedWorkspaceId ?? "",
        sessionId: state.selectedSessionId ?? "",
      },
    )).toMatchObject({
      records: [{
        kind: "command",
        source: "desktop",
        authority: "desktop-observed",
        status: "unknown",
        verification: {
          command: "printf 'PROJECT_ACTION_OK\\n'",
          cwd: ".",
        },
      }],
    });
  } finally {
    await harness.close();
  }
});
