import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  commitAllInGitRepo,
  createNamedThread,
  getDesktopState,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeProjectExtension,
} from "../helpers/electron-app";

const extensionSource = String.raw`
const green = "\u001b[32m";
const reset = "\u001b[0m";

export default function dockExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("alpha", green + "Ready" + reset);
    ctx.ui.setStatus("beta", "Queued");
    ctx.ui.setWidget("primary", ["Primary line", "  child line"]);
    ctx.ui.setWidget("secondary", [green + "Below line" + reset], { placement: "belowEditor" });
  });

  pi.registerCommand("status-only", {
    description: "Show only status text",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("alpha", "");
      ctx.ui.setStatus("beta", "");
      ctx.ui.setStatus("solo", "Only status");
      ctx.ui.setWidget("primary", []);
      ctx.ui.setWidget("secondary", [], { placement: "belowEditor" });
    },
  });

  pi.registerCommand("widget-only", {
    description: "Show only widget text",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("alpha", "");
      ctx.ui.setStatus("beta", "");
      ctx.ui.setStatus("solo", "");
      ctx.ui.setWidget("primary", ["Widget only line"]);
      ctx.ui.setWidget("secondary", [], { placement: "belowEditor" });
    },
  });
}
`;

const tickingExtensionSource = String.raw`
export default function tickingExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    let tick = 0;
    const render = () => {
      ctx.ui.setWidget("ticker", ["Tick " + tick, "child line"]);
    };
    render();

    const interval = setInterval(() => {
      tick += 1;
      render();
      if (tick >= 3) {
        clearInterval(interval);
      }
    }, 250);
  });
}
`;

const functionWidgetExtensionSource = String.raw`
export default function functionWidgetExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setWidget("function-widget", (tui, theme) => {
      let tick = 0;
      const interval = setInterval(() => {
        tick += 1;
        tui.requestRender();
        if (tick >= 2) clearInterval(interval);
      }, 150);
      return {
        render: () => [theme.fg("accent", "Function widget tick " + tick)],
        dispose: () => clearInterval(interval),
      };
    });
  });
}
`;

test("renders a single collapsed dock in the compact topbar and expands to one text body", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-workspace");
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src", "App.tsx"), "export default function App() { return null; }\n", "utf8");
  await commitAllInGitRepo(workspacePath, "init");
  await writeProjectExtension(workspacePath, "dock-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Dock session");

    const dock = window.getByTestId("extension-dock");
    const dockSummary = window.getByTestId("extension-dock-summary");
    const dockToggle = window.getByTestId("extension-dock-toggle");
    const dockInTopbar = window.locator(".topbar__extension-dock [data-testid='extension-dock']");
    const composer = window.getByTestId("composer");

    await expect(dock).toBeVisible();
    await expect(dockInTopbar).toBeVisible();
    await expect(dockSummary).toHaveText(/Ready|Queued/);
    await expect(window.getByTestId("extension-dock-body")).toHaveCount(0);
    await expect(window.getByTestId("extension-status-strip")).toHaveCount(0);
    await expect(window.getByTestId("extension-widget-rail")).toHaveCount(0);

    await dockToggle.focus();
    await window.keyboard.press("Enter");
    const dockBody = window.getByTestId("extension-dock-body");
    await expect(dockBody).toHaveCount(1);
    await expect(dockBody).toContainText("alpha: Ready");
    await expect(dockBody).toContainText("beta: Queued");
    await expect(dockBody).toContainText("primary:");
    await expect(dockBody).toContainText("Primary line");
    await expect(dockBody).toContainText("secondary:");
    await expect(dockBody).toContainText("Below line");
    await expect(dockBody).toContainText("--------------------");
    await expect(dockBody).not.toContainText("\u001b[32m");

    await window.keyboard.press("Space");
    await expect(dockBody).toHaveCount(0);

    await composer.fill("/");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();

    await composer.fill("@");
    const mentionMenu = window.getByTestId("mention-menu");
    await expect(mentionMenu).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("uses literal fallback summaries for status-only and widget-only extension ui", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-fallback-workspace");
  await writeProjectExtension(workspacePath, "dock-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Fallback session");

    const composer = window.getByTestId("composer");
    const dockToggle = window.getByTestId("extension-dock-toggle");
    const dockSummary = window.getByTestId("extension-dock-summary");
    const dockBody = window.getByTestId("extension-dock-body");
    await expect
      .poll(async () => {
        const nextState = await getDesktopState(window);
        const sessionKey = `${nextState.selectedWorkspaceId}:${nextState.selectedSessionId}`;
        return (nextState.sessionCommandsBySession[sessionKey] ?? []).map((command) => command.name).sort();
      })
      .toEqual(expect.arrayContaining(["status-only", "widget-only"]));

    await composer.fill("/status-only ");
    await composer.press("Enter");
    await expect(dockSummary).toHaveText("Only status");
    await dockToggle.click();
    await expect(dockBody).toContainText("Only status");
    await expect(dockBody).not.toContainText("Widget only line");

    await dockToggle.click();
    await composer.fill("/widget-only ");
    await composer.press("Enter");
    await expect(dockSummary).toHaveText("Widget only line");
    await dockToggle.click();
    await expect(dockBody).toContainText("Widget only line");
    await expect(dockBody).not.toContainText("Only status");
  } finally {
    await harness.close();
  }
});

test("renders TUI function widgets as composer dock text and responds to requestRender", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-function-widget-workspace");
  await writeProjectExtension(workspacePath, "function-widget-extension.ts", functionWidgetExtensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Function widget session");

    await expect(window.getByTestId("extension-dock")).toBeVisible();
    await expect(window.getByTestId("extension-dock-summary")).toHaveText("Function widget tick 2", { timeout: 10_000 });
    await window.getByTestId("extension-dock-toggle").click();
    await expect(window.getByTestId("extension-dock-body")).toContainText("Function widget tick 2");
  } finally {
    await harness.close();
  }
});

test("does not spam the transcript when an extension updates its widget repeatedly", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-ticker-workspace");
  await writeProjectExtension(workspacePath, "ticking-extension.ts", tickingExtensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Ticker session");

    const transcriptActivities = window.locator(".timeline .timeline-activity");
    const baselineCount = await transcriptActivities.count();

    await expect(window.getByTestId("extension-dock-summary")).toHaveText("Tick 3", { timeout: 10_000 });
    await expect(transcriptActivities).toHaveCount(baselineCount);
    await expect(window.locator(".timeline")).not.toContainText("Tick 1");
    await expect(window.locator(".timeline")).not.toContainText("Tick 2");
    await expect(window.locator(".timeline")).not.toContainText("Tick 3");
  } finally {
    await harness.close();
  }
});
