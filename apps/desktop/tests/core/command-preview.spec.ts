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

test("previews significant saved actions, redacts secrets, and records denial and approval", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("command-preview");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Command preview");
    await window.getByRole("button", { name: "Add action" }).click();
    const addAction = window.getByRole("dialog", { name: "Add Action" });
    await addAction.getByLabel("Name").fill("Network info");
    await addAction.getByLabel("Command").fill("API_TOKEN=secret-value curl --version");
    await addAction.getByRole("button", { name: "Save action" }).click();

    const action = window.getByRole("button", { name: "Run action Network info" });
    await action.click();
    const preview = window.getByTestId("command-preview-dialog");
    await expect(preview).toContainText("Saved project action");
    await expect(preview).toContainText("Review significant command");
    await expect(preview).toContainText("API_TOKEN=[redacted] curl --version");
    await expect(preview).toContainText(workspacePath);
    await expect(preview).toContainText("API_TOKEN=[redacted]");
    await expect(preview).not.toContainText("secret-value");
    await expect(preview).toContainText("Agent-proposed commands are identified in the tool timeline");
    await preview.getByRole("button", { name: "Deny" }).click();
    await expect(window.getByTestId("integrated-terminal")).toHaveCount(0);

    await action.click();
    await window.getByTestId("command-preview-dialog").getByRole("button", { name: "Run once" }).click();
    await expect(window.getByTestId("integrated-terminal")).toBeVisible();
    await expect(window.getByTestId("integrated-terminal").locator(".xterm-rows")).toContainText("curl", {
      timeout: 15_000,
    });

    const state = await getDesktopState(window);
    const evidence = await window.evaluate(
      ({ workspaceId, sessionId }) =>
        (window as PiAppWindow).piApp?.listTaskEvidence({
          workspaceId,
          sessionId,
          kinds: ["approval", "command"],
        }),
      {
        workspaceId: state.selectedWorkspaceId ?? "",
        sessionId: state.selectedSessionId ?? "",
      },
    );
    expect(evidence?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "approval",
        status: "cancelled",
        summary: expect.stringContaining("denied"),
      }),
      expect.objectContaining({
        kind: "approval",
        status: "passed",
        summary: expect.stringContaining("approved"),
      }),
      expect.objectContaining({
        kind: "command",
        status: "unknown",
      }),
    ]));
    expect(JSON.stringify(evidence)).not.toContain("secret-value");
  } finally {
    await harness.close();
  }
});
