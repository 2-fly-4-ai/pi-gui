import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  toggleTopbarPanel,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

const vscodeServerRoot = join(homedir(), ".vscode", "cli", "serve-web");

test("starts the installed VS Code server and renders its workbench in dark mode", async () => {
  test.skip(!existsSync(vscodeServerRoot), "No local VS Code serve-web installation is available.");
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("installed-vscode-server");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Installed VS Code server");
    await toggleTopbarPanel(window, "VS Code");

    const panel = window.getByTestId("thread-vscode-panel");
    const webview = panel.locator(".display-mode-vscode__webview");
    await expect(panel).toBeVisible();
    await expect(webview).toHaveCount(1, { timeout: 20_000 });
    await expect(panel.locator(".display-mode-vscode__error")).toHaveCount(0);

    await expect
      .poll(
        () =>
          harness.electronApp.evaluate(async ({ webContents }) => {
            const guest = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getType() === "webview");
            if (!guest || guest.isDestroyed()) return false;
            return guest.executeJavaScript(
              `Boolean(document.querySelector(".monaco-workbench.vs-dark"))`,
              true,
            ) as Promise<boolean>;
          }),
        { timeout: 20_000 },
      )
      .toBe(true);
  } finally {
    await harness.close();
  }
});
