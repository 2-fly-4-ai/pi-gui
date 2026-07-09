import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  createNamedThread,
  desktopShortcut,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
} from "../helpers/electron-app";

function parseRgb(color: string): [number, number, number] {
  const channels = color.match(/\d+(?:\.\d+)?/g);
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported color value: ${color}`);
  }
  return [Number(channels[0]), Number(channels[1]), Number(channels[2])];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const linearized = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linearized[0] + 0.7152 * linearized[1] + 0.0722 * linearized[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseRgb(foreground));
  const backgroundLuminance = relativeLuminance(parseRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test("supports keyboard shortcuts, slash menus, and topbar controls through the user surface", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("controls-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Controls session");
    await expect(window.locator(".topbar__session")).toHaveText("Controls session");

    const composer = window.getByTestId("composer");

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toContainText("General");

    await window.keyboard.press(desktopShortcut("Shift+O"));
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();
    await expect(window.getByTestId("new-thread-composer")).toBeFocused();

    await selectSession(window, "Controls session");
    await expect(composer).toBeFocused();

    const topbarRuntimeStatus = window.getByTestId("topbar-runtime-status");
    await expect(topbarRuntimeStatus).toHaveText("Idle");
    await expect(topbarRuntimeStatus).toHaveAttribute("title", /idle/i);
    const composerStatusStrip = window.locator(".composer > .conversation--composer .composer-status-strip").first();
    await expect(composerStatusStrip.locator(".checkout-selector__bar")).toContainText("Local checkout");
    await expect(composerStatusStrip).not.toContainText(/idle/i);
    await expect(window.getByTestId("composer-runtime-status")).toHaveCount(0);

    await expect(window.locator(".checkout-selector__bar")).toContainText("Local checkout");
    await window.locator(".checkout-selector__button").click();
    await expect(window.locator(".checkout-selector__popover")).toBeVisible();
    await expect(window.locator(".checkout-selector__search")).toBeFocused();
    await expect(window.locator(".checkout-selector__option")).toContainText("current");
    await window.locator(".checkout-selector__search").fill("missing-ref");
    await expect(window.locator(".checkout-selector__empty")).toHaveText("No refs found");
    await window.keyboard.press("Escape");
    await expect(window.locator(".checkout-selector__popover")).toHaveCount(0);

    await composer.fill("/stat");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    const slashMenuBox = await slashMenu.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(slashMenuBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect((slashMenuBox?.y ?? 0) + (slashMenuBox?.height ?? 0)).toBeLessThanOrEqual((composerBox?.y ?? 0) + 2);

    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("/status");
    await composer.press("Enter");
    await expect(window.getByTestId("transcript")).toContainText(/Model |No session overrides set/);
    await expect(composer).toHaveValue("");

    await composer.fill("Need a quick check /stat");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Need a quick check /status");

    await composer.fill("/thinking");
    const optionsMenu = window.getByTestId("slash-options-menu");
    await expect(optionsMenu).toBeVisible();
    await expect(optionsMenu).toContainText("Low");
    await expect(optionsMenu).toContainText("Extra High");
    await composer.press("ArrowDown");
    await composer.press("ArrowDown");
    await composer.press("Enter");
    await expect(optionsMenu).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText("Thinking set to high");
    const reasoningTrigger = window.getByTestId("reasoning-selector-trigger");
    await expect(reasoningTrigger).toContainText("High");
    await reasoningTrigger.click();
    const reasoningDropdown = window.locator(".reasoning-selector__dropdown");
    await expect(reasoningDropdown).toBeVisible();
    await expect(reasoningDropdown).toContainText("Medium (default)");
    await expect(reasoningDropdown).not.toContainText("Normal");
    await window.keyboard.press("Escape");

    const composerControlBar = window.locator(".composer > .conversation--composer .composer-control-bar").first();
    await expect(composerControlBar).not.toContainText("Fast:");
    await expect(composerControlBar).not.toContainText("Build");
    await expect(window.getByTestId("fast-mode-selector-trigger")).toHaveCount(0);

    await composer.fill("Keep the draft /thinking");
    await expect(optionsMenu).toBeVisible();
    await composer.press("ArrowDown");
    await composer.press("Enter");
    await expect(optionsMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Keep the draft /thinking medium");

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();
    await window.evaluate(async ({ workspaceId }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.setScopedModelPatterns(workspaceId, ["fake-provider/fake-model"]);
    }, { workspaceId: selectedWorkspaceId });

    await composer.fill("/model");
    await expect(optionsMenu).toBeVisible();
    await expect(optionsMenu).toContainText("No models available");
    await expect(optionsMenu).toContainText("Open Settings > Models to enable models.");
    await composer.fill("continue");
    await expect(optionsMenu).toHaveCount(0);

    const onboardingNotice = window.getByTestId("model-onboarding-notice");
    await expect(onboardingNotice).toContainText("No models available");
    await expect(onboardingNotice).toContainText("Settings > Models");
    await expect(window.getByTestId("send")).toBeDisabled();

    await onboardingNotice.getByRole("button", { name: "Open Settings > Models" }).click();
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toHaveText("Models");
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("send")).toBeDisabled();

    const appRegions = await window.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>("[data-testid='topbar']");
      const addFolder = document.querySelector<HTMLElement>(".topbar__actions button");
      return {
        topbar: topbar ? getComputedStyle(topbar).getPropertyValue("-webkit-app-region") : "",
        addFolder: addFolder ? getComputedStyle(addFolder).getPropertyValue("-webkit-app-region") : "",
      };
    });
    expect(appRegions.topbar).toBe("drag");
    expect(appRegions.addFolder).toBe("no-drag");

    const topbarChrome = await window.evaluate(() => {
      const groups = Array.from(document.querySelectorAll<HTMLElement>(".topbar__actions .topbar__action-group"));
      const dividers = groups.slice(1).map((group) => {
        const styles = getComputedStyle(group, "::before");
        return {
          background: styles.backgroundColor,
          height: styles.height,
          width: styles.width,
        };
      });
      const iconButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".topbar__actions .topbar__icon, .topbar__actions .git-quick-actions__trigger"),
      );
      const iconMetadata = iconButtons.map((button) => {
        const tooltip = button.closest(".shortcut-tooltip-wrap")?.querySelector<HTMLElement>("[role='tooltip']");
        return {
          label: button.getAttribute("aria-label") ?? "",
          tooltip: tooltip?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        };
      });

      return {
        groupCount: groups.length,
        dividers,
        iconMetadata,
        missingLabels: iconMetadata.filter((entry) => entry.label.length === 0),
        missingTooltips: iconMetadata.filter((entry) => entry.tooltip.length === 0),
      };
    });

    expect(topbarChrome.groupCount).toBeGreaterThanOrEqual(3);
    expect(topbarChrome.dividers.length).toBe(topbarChrome.groupCount - 1);
    expect(topbarChrome.dividers.every((divider) => divider.width === "1px" && divider.height === "18px" && divider.background !== "rgba(0, 0, 0, 0)")).toBe(true);
    expect(topbarChrome.missingLabels).toEqual([]);
    expect(topbarChrome.missingTooltips).toEqual([]);
    expect(topbarChrome.iconMetadata.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["Toggle terminal", "Toggle changes", "GitHub actions", "Add folder"]),
    );
    expect(topbarChrome.iconMetadata.map((entry) => entry.tooltip)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Toggle terminal\s*(⌘J|Ctrl\+J)/),
        expect.stringMatching(/Toggle changes\s*(⌘D|Ctrl\+D)/),
        "GitHub actions",
        "Add folder",
      ]),
    );

    const maximizedBefore = await harness.electronApp.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false;
    });
    await window.getByTestId("topbar").dblclick({ position: { x: 140, y: 12 } });
    await expect
      .poll(() =>
        harness.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false),
      )
      .toBe(!maximizedBefore);
  } finally {
    await harness.close();
  }
});

test("run failures appear in the timeline without duplicating inside the composer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("run-failure-composer-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Run failure composer session");
    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === state.selectedSessionId);
    if (!workspace || !session) {
      throw new Error("Expected a selected session");
    }

    const sessionRef = { workspaceId: workspace.id, sessionId: session.id };
    const runId = "overload-test-run";
    const startedAt = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp: startedAt,
      runId,
      snapshot: {
        ref: sessionRef,
        workspace: { workspaceId: workspace.id, path: workspace.path, displayName: workspace.name },
        title: session.title,
        status: "running",
        updatedAt: startedAt,
        preview: "Running",
        runningRunId: runId,
      },
    });

    const message = "Codex error: server is overloaded";
    const failedAt = new Date(Date.now() + 1_000).toISOString();
    await emitTestSessionEvent(harness, {
      type: "runFailed",
      sessionRef,
      timestamp: failedAt,
      runId,
      error: { message, code: "server_is_overloaded" },
    });

    await expect(window.locator(".timeline")).toContainText(message);
    await expect(window.getByTestId("composer-error-banner")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("host slash command failures restore the draft and surface an error", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("host-command-failure-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Host command failure session");
    const composer = window.getByTestId("composer");

    await composer.fill("/compact");
    await window.evaluate(async () => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.submitComposer("/compact");
    });

    await expect
      .poll(async () => (await getDesktopState(window)).lastError ?? "", { timeout: 30_000 })
      .toMatch(/Summarization failed|compact|auth|key|model|terminated/i);
    await expect.poll(async () => (await getDesktopState(window)).composerDraft, { timeout: 15_000 }).toBe("/compact");
    await expect(composer).toHaveValue("/compact", { timeout: 15_000 });
    await expect(window.getByTestId("composer-error-banner")).toContainText(
      /Summarization failed|compact|auth|key|model|terminated/i,
      { timeout: 15_000 },
    );
  } finally {
    await harness.close();
  }
});

test("composer keeps narrow widths friendly by collapsing secondary controls", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("compact-composer-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Compact composer session");

    await harness.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      browserWindow?.setMinimumSize(520, 640);
      browserWindow?.setBounds({ width: 1040, height: 760 });
    });

    await expect.poll(() => readThreadResponsiveMetrics(window)).toMatchObject({
      composerWithinMain: true,
      mainHasNoHorizontalOverflow: true,
      topbarWithinMain: true,
    });

    await harness.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      browserWindow?.setBounds({ width: 560, height: 760 });
    });

    await expect.poll(() => readThreadResponsiveMetrics(window)).toMatchObject({
      composerWithinMain: true,
      mainHasNoHorizontalOverflow: true,
      topbarWithinMain: true,
    });

    await expect
      .poll(() =>
        window.evaluate(() =>
          document.querySelector(".composer-control-bar")?.classList.contains("composer-control-bar--compact") ?? false,
        ),
      )
      .toBe(true);

    const compactMetrics = await window.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".composer-control-bar");
      const send = document.querySelector<HTMLElement>("[data-testid='send']");
      if (!bar || !send) {
        throw new Error("Compact composer controls were not rendered");
      }
      const sendBox = send.getBoundingClientRect();
      const sendStyles = getComputedStyle(send);
      return {
        barClientWidth: Math.ceil(bar.clientWidth),
        barScrollWidth: Math.ceil(bar.scrollWidth),
        sendHeight: Math.round(sendBox.height),
        sendRadius: Number.parseFloat(sendStyles.borderTopLeftRadius),
        sendWidth: Math.round(sendBox.width),
      };
    });

    expect(compactMetrics.barScrollWidth).toBeLessThanOrEqual(compactMetrics.barClientWidth + 1);
    expect(compactMetrics.sendWidth).toBe(36);
    expect(compactMetrics.sendHeight).toBe(36);
    expect(compactMetrics.sendRadius).toBeGreaterThanOrEqual(10);

    await window.getByTestId("composer-more-controls").click();
    const compactMenu = window.getByTestId("composer-control-menu");
    await expect(compactMenu).toBeVisible();
    await expect(compactMenu).toContainText("Reasoning");
    await expect(compactMenu).not.toContainText("Fast Mode");
    await expect(compactMenu).not.toContainText("Mode");
    await expect(compactMenu).toContainText("Access");
    await expect(compactMenu).toContainText("Attach files");
  } finally {
    await harness.close();
  }
});

async function readThreadResponsiveMetrics(window: Page) {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".main");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const composer = document.querySelector<HTMLElement>(".composer");
    if (!main || !topbar || !composer) {
      throw new Error("Thread shell metrics target was not rendered");
    }

    const mainBox = main.getBoundingClientRect();
    const topbarBox = topbar.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return {
      composerWithinMain: composerBox.left >= mainBox.left - 1 && composerBox.right <= mainBox.right + 1,
      mainHasNoHorizontalOverflow: main.scrollWidth <= main.clientWidth + 1,
      topbarWithinMain: topbarBox.left >= mainBox.left - 1 && topbarBox.right <= mainBox.right + 1,
    };
  });
}

test("dark mode keeps the send button visible before and after typing", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("dark-send-button-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Dark send button session");

    await window.keyboard.press(desktopShortcut(","));
    const settingsSurface = window.getByTestId("settings-surface");
    await expect(settingsSurface).toBeVisible();
    await settingsSurface.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Appearance");
    await settingsSurface.locator(".settings-row", { hasText: "Dark" }).locator('input[type="radio"]').click();
    await expect
      .poll(() => window.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(true);

    await settingsSurface.getByRole("button", { name: "Back to app" }).click();
    await selectSession(window, "Dark send button session");

    const sendButton = window.getByTestId("send");
    await expect(sendButton).toBeDisabled();
    await expect
      .poll(async () => {
        const styles = await sendButton.evaluate((button) => {
          const computed = getComputedStyle(button);
          return {
            backgroundColor: computed.backgroundColor,
            color: computed.color,
          };
        });
        return contrastRatio(styles.color, styles.backgroundColor);
      })
      .toBeGreaterThan(3);

    await window.getByTestId("composer").fill("make the arrow visible");
    await expect(sendButton).toBeEnabled();
    await expect
      .poll(async () => {
        const styles = await sendButton.evaluate((button) => {
          const computed = getComputedStyle(button);
          return {
            backgroundColor: computed.backgroundColor,
            color: computed.color,
          };
        });
        return contrastRatio(styles.color, styles.backgroundColor);
      })
      .toBeGreaterThan(4.5);
  } finally {
    await harness.close();
  }
});
