import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("opens Display Mode from the sidebar and renders thread command-center tiles", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("display-mode-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await waitForWorkspaceByPath(window, workspacePath);
    await window.evaluate(async ({ targetPath, title }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      const state = await app.getState();
      const workspace = state.workspaces.find((entry) => entry.path === targetPath);
      if (!workspace) {
        throw new Error(`Workspace not found: ${targetPath}`);
      }
      await app.createSession({ workspaceId: workspace.id, title });
    }, { targetPath: workspacePath, title: "Display mode seed thread" });
    await expect.poll(async () => {
      return window.evaluate(({ targetPath, title }) => window.piApp?.getState().then((state) => {
        const workspace = state.workspaces.find((entry) => entry.path === targetPath);
        return workspace?.sessions.some((session) => session.title === title) ?? false;
      }) ?? false, { targetPath: workspacePath, title: "Display mode seed thread" });
    }).toBe(true);
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "Display mode assistant tile transcript",
    });

    const nav = window.locator(".sidebar__nav");
    await expect(nav.getByRole("button", { name: "Threads" })).toBeVisible();
    await nav.getByRole("button", { name: "Display Mode" }).click();

    await expect.poll(async () => window.evaluate(() => window.piApp?.getState().then((state) => state.activeView) ?? "missing")).toBe("display-mode");
    await expect(window.getByTestId("display-mode-surface")).toBeVisible();
    await expect(window.getByRole("heading", { name: "Command center" })).toBeVisible();
    await expect(window.locator(".display-mode-drawer")).toContainText("Preview");
    await expect(window.getByTestId("display-mode-thread-tile").first()).toContainText(basename(workspacePath));
    await expect(window.getByTestId("display-mode-thread-tile").first()).toContainText("Display mode seed thread");
    await expect(window.getByTestId("display-mode-thread-tile").first()).toContainText("Display mode assistant tile transcript");
    await expect(window.getByPlaceholder("Reply to Display mode seed thread…")).toBeVisible();

    await window.getByTestId("display-mode-thread-tile").first().getByRole("button", { name: "VS Code" }).click();
    await expect(window.locator(".display-mode-vscode")).toBeVisible();
    await expect(window.locator(".display-mode-vscode__webview")).toHaveAttribute("title", "VS Code");
    await expect.poll(async () => window.evaluate(() => {
      const surface = document.querySelector<HTMLElement>(".display-mode");
      const panel = document.querySelector<HTMLElement>(".display-mode-vscode");
      const webview = document.querySelector<HTMLElement>(".display-mode-vscode__webview");
      if (!surface || !panel || !webview) return 0;
      const surfaceHeight = surface.getBoundingClientRect().height;
      const panelHeight = panel.getBoundingClientRect().height;
      const webviewHeight = webview.getBoundingClientRect().height;
      return Math.abs(surfaceHeight - panelHeight) <= 2 && Math.abs(panelHeight - webviewHeight) <= 2 && webviewHeight > 500
        ? webviewHeight
        : 0;
    })).toBeGreaterThan(500);
    await expect(window.frameLocator(".display-mode-vscode__webview").getByText("workbench failed to connect")).toHaveCount(0);
    await expect(window.frameLocator(".display-mode-vscode__webview").getByText("README.md")).toBeVisible({ timeout: 45_000 });
  } finally {
    await harness.close();
  }
});
