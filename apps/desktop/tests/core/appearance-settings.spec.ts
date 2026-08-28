import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("semantic muted text tokens remain readable in light and dark themes", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("appearance-contrast-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();

    for (const theme of ["Light", "Dark"] as const) {
      await window.locator(`input[name="theme"][aria-label="${theme}"]`).check();
      const ratios = await window.evaluate(() => {
        const styles = getComputedStyle(document.documentElement);
        const parse = (value: string) => {
          const normalized = value.trim();
          if (/^#[\da-f]{6}$/i.test(normalized)) {
            return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
          }
          const match = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
          if (!match || match.length !== 3) throw new Error(`Unable to parse color: ${value}`);
          return match;
        };
        const luminance = (rgb: number[]) => {
          const linear = rgb.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
        };
        const contrast = (foreground: string, background: string) => {
          const foregroundLuminance = luminance(parse(foreground));
          const backgroundLuminance = luminance(parse(background));
          const lighter = Math.max(foregroundLuminance, backgroundLuminance);
          const darker = Math.min(foregroundLuminance, backgroundLuminance);
          return (lighter + 0.05) / (darker + 0.05);
        };
        const backgrounds = ["--main", "--surface"] as const;
        const foregrounds = ["--muted", "--muted-strong", "--muted-faint"] as const;
        return foregrounds.flatMap((foreground) =>
          backgrounds.map((background) => ({
            foreground,
            background,
            ratio: contrast(styles.getPropertyValue(foreground), styles.getPropertyValue(background)),
          })),
        );
      });

      for (const result of ratios) {
        expect(result.ratio, `${theme} ${result.foreground} on ${result.background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  } finally {
    await harness.close();
  }
});

test("settings use a bounded two-column grid that collapses cleanly", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-geometry-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.setViewportSize({ width: 1480, height: 900 });
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();

    const settingsView = window.locator(".settings-view");
    const wideBox = await settingsView.boundingBox();
    expect(wideBox?.width ?? 0).toBeGreaterThan(960);
    expect(wideBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1320);
    const firstRow = settingsView.locator(".settings-row").first();
    await expect.poll(() => firstRow.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);

    await window.setViewportSize({ width: 720, height: 780 });
    await expect.poll(() => firstRow.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
    await expect.poll(() => settingsView.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  } finally {
    await harness.close();
  }
});

test("density and transcript font preferences persist and reset", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("appearance-density-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    await window.getByLabel("Interface density").selectOption("compact");
    await window.getByLabel("Transcript text size").selectOption("18");
    await window.getByLabel("Monospace text size").selectOption("16");
    await expect(window.getByLabel("Show success moments")).toBeChecked();
    await window.getByLabel("Show success moments").uncheck();
    await expect.poll(() => window.evaluate(() => ({
      density: document.documentElement.dataset.density,
      transcript: document.documentElement.style.getPropertyValue("--transcript-font-size"),
      mono: document.documentElement.style.getPropertyValue("--mono-font-size"),
    }))).toEqual({ density: "compact", transcript: "18px", mono: "16px" });
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.density)).toBe("compact");
    if (await window.getByTestId("settings-surface").count() === 0) {
      await window.getByRole("button", { name: "Settings", exact: true }).click();
    }
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(window.getByLabel("Transcript text size")).toHaveValue("18");
    await expect(window.getByLabel("Show success moments")).not.toBeChecked();
    await window.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(window.getByLabel("Interface density")).toHaveValue("comfortable");
    await expect(window.getByLabel("Show success moments")).toBeChecked();
    await expect.poll(() => window.evaluate(() => document.documentElement.style.getPropertyValue("--transcript-font-size"))).toBe("15px");
  } finally {
    await secondRun.close();
  }
});

test("theme gallery previews, cancels, applies across modes, and persists after restart", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("theme-gallery-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = window.getByTestId("settings-surface");
    await settings.getByRole("button", { name: "Appearance", exact: true }).click();
    const ocean = window.locator(".theme-card", { has: window.getByRole("heading", { name: "Ocean Terminal" }) });
    await ocean.scrollIntoViewIfNeeded();
    await ocean.getByRole("button", { name: "Preview", exact: true }).click();
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.paletteId)).toBe("builtin:ocean-terminal");
    await window.getByRole("button", { name: "Cancel preview", exact: true }).click();
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.paletteId)).toBe("builtin:pi-default");

    await ocean.getByRole("button", { name: "Apply", exact: true }).click();
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.paletteId)).toBe("builtin:ocean-terminal");
    await window.locator('input[name="theme"][aria-label="Light"]').check();
    await expect.poll(() => window.evaluate(() => ({
      palette: document.documentElement.dataset.paletteId,
      mode: document.documentElement.classList.contains("dark") ? "dark" : "light",
      main: document.documentElement.style.getPropertyValue("--main"),
    }))).toEqual({ palette: "builtin:ocean-terminal", mode: "light", main: "#f3f8ff" });
    await window.locator('input[name="theme"][aria-label="Dark"]').check();
    await expect.poll(() => window.evaluate(() => document.documentElement.style.getPropertyValue("--main"))).toBe("#111a24");
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await expect.poll(() => window.evaluate(() => ({
      palette: document.documentElement.dataset.paletteId,
      main: document.documentElement.style.getPropertyValue("--main"),
    }))).toEqual({ palette: "builtin:ocean-terminal", main: "#111a24" });
  } finally {
    await secondRun.close();
  }
});

test("theme gallery searches and installs bounded Open VSX color data through a deterministic main-process fake", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("theme-gallery-openvsx-workspace");
  const app = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await app.firstWindow();
    await expect.poll(() => app.electronApp.evaluate(() => Boolean((globalThis as { __PI_APP_TEST_HOOKS?: { seedOpenVsxThemeFixture?: () => void } }).__PI_APP_TEST_HOOKS?.seedOpenVsxThemeFixture))).toBe(true);
    await app.electronApp.evaluate(() => (globalThis as { __PI_APP_TEST_HOOKS?: { seedOpenVsxThemeFixture?: () => void } }).__PI_APP_TEST_HOOKS?.seedOpenVsxThemeFixture?.());
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    const search = window.getByPlaceholder("Search themes…");
    await search.scrollIntoViewIfNeeded();
    await search.fill("ocean");
    await search.press("Enter");
    const results = window.getByLabel("Open VSX theme results");
    await expect(results).toContainText("Safe Ocean");
    await results.getByRole("button", { name: "Install color data" }).click();
    await expect(window.getByRole("status")).toContainText("Previewing Safe Ocean");
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.paletteId)).toBe("openvsx:pi-test/safe-ocean");
    await window.getByRole("button", { name: "Apply theme" }).click();
    const installedCard = window.locator(".theme-card", { has: window.getByRole("heading", { name: "Safe Ocean" }) });
    await expect(installedCard).toContainText("MIT");
    await installedCard.getByRole("button", { name: "Remove" }).click();
    await expect(installedCard).toHaveCount(0);
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.paletteId)).toBe("builtin:pi-default");
  } finally { await app.close(); }
});

test("appearance shuriken picker controls the thinking spinner", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("appearance-shuriken-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Shuriken appearance session");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    const settingsSurface = window.getByTestId("settings-surface");
    await expect(settingsSurface).toBeVisible();
    await settingsSurface.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Appearance");

    const shurikenPicker = window.getByTestId("shuriken-picker");
    await shurikenPicker.scrollIntoViewIfNeeded();
    await expect(shurikenPicker).toBeVisible();
    await window.getByTestId("shuriken-option-shuriken-07").click();
    await expect(window.getByTestId("selected-shuriken")).toContainText("Compass Ring");
    await expect(window.getByTestId("shuriken-option-shuriken-07")).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => window.evaluate(() => window.localStorage.getItem("pi-gui:selected-shuriken")))
      .toBe("shuriken-07");

    await settingsSurface.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("composer")).toBeVisible();
    await window.getByTestId("thinking-trace-toggle").click();

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    const selectedSession = selectedWorkspace?.sessions.find((session) => session.id === state.selectedSessionId);
    expect(selectedWorkspace).toBeTruthy();
    expect(selectedSession).toBeTruthy();
    if (!selectedWorkspace || !selectedSession) {
      throw new Error("Expected selected workspace and session");
    }

    const sessionRef = { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id };
    const workspace = {
      workspaceId: selectedWorkspace.id,
      path: selectedWorkspace.path,
      displayName: selectedWorkspace.name,
    };
    const runId = "appearance-shuriken-thinking-run";
    const startedAt = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp: startedAt,
      runId,
      snapshot: {
        ref: sessionRef,
        workspace,
        title: selectedSession.title,
        status: "running",
        updatedAt: startedAt,
        preview: "Thinking with selected shuriken",
        runningRunId: runId,
      },
    });
    await emitTestSessionEvent(harness, {
      type: "assistantThinkingStarted",
      sessionRef,
      timestamp: startedAt,
      runId,
    });
    await emitTestSessionEvent(harness, {
      type: "assistantThinkingDelta",
      sessionRef,
      timestamp: new Date(Date.now() + 1_000).toISOString(),
      runId,
      text: "Checking the selected shuriken.",
    });

    const thinkingShuriken = window.getByTestId("timeline-thinking-shuriken");
    await expect(thinkingShuriken).toBeVisible();
    await expect(thinkingShuriken).toHaveAttribute("data-shuriken-id", "shuriken-07");
    await expect(thinkingShuriken).toHaveJSProperty("naturalWidth", 782);
  } finally {
    await harness.close();
  }
});
