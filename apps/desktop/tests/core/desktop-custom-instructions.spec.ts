import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("persists desktop custom instructions without touching global append system prompt", async () => {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const globalAppendSystemPromptPath = join(agentDir, "APPEND_SYSTEM.md");
  const workspacePath = await makeWorkspace("desktop-custom-instructions");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });
  await expect.poll(() => pathExists(globalAppendSystemPromptPath)).toBe(false);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    await expect(window.locator(".settings-section__title", { hasText: /^General$/ })).toHaveCount(0);

    const enabled = window.getByRole("checkbox", { name: "Use desktop custom instructions" });
    const textarea = window.getByRole("textbox", { name: "Desktop custom instructions" });
    await expect(enabled).not.toBeChecked();
    await expect(textarea).toBeDisabled();
    await expect.poll(() => textarea.evaluate((element) => getComputedStyle(element).cursor)).toBe("not-allowed");
    await expect.poll(() => enabled.evaluate((element) => {
      const styles = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      document.body.append(probe);
      const accentColor = getComputedStyle(probe).color;
      probe.remove();
      return styles.accentColor === accentColor;
    })).toBe(true);
    for (let index = 0; index < 40; index += 1) {
      if (await enabled.evaluate((element) => document.activeElement === element)) {
        break;
      }
      await window.keyboard.press("Tab");
    }
    await expect.poll(() => enabled.evaluate((element) => document.activeElement === element)).toBe(true);
    await expect.poll(() => enabled.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");

    await enabled.click();
    await expect(textarea).toBeEnabled();
    await textarea.fill("Conversation style:\n\n- Technical prose only.");
    await textarea.blur();

    await expect.poll(async () => (await getDesktopState(window)).desktopCustomInstructions).toEqual({
      enabled: true,
      text: "Conversation style:\n\n- Technical prose only.",
    });
    await expect.poll(() => pathExists(globalAppendSystemPromptPath)).toBe(false);
  } finally {
    await harness.close();
  }

  const restarted = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await restarted.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    await expect(window.getByRole("checkbox", { name: "Use desktop custom instructions" })).toBeChecked();
    await expect(window.getByRole("textbox", { name: "Desktop custom instructions" })).toHaveValue(
      "Conversation style:\n\n- Technical prose only.",
    );
    await expect.poll(() => pathExists(globalAppendSystemPromptPath)).toBe(false);
  } finally {
    await restarted.close();
  }
});

test("persists diagnostic issue draft opt-in", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("diagnostic-issue-drafts");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    const issueDrafts = window.getByRole("checkbox", { name: "Enable diagnostic issue drafts" });
    await expect(issueDrafts).not.toBeChecked();
    await issueDrafts.click();
    await expect(issueDrafts).toBeChecked();
    await expect.poll(async () => (await getDesktopState(window)).diagnosticReporting).toEqual({
      issueDraftsEnabled: true,
      nativeCrashReportsEnabled: false,
      onboardingDismissed: true,
    });
  } finally {
    await harness.close();
  }

  const restarted = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await restarted.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    await expect(window.getByRole("checkbox", { name: "Enable diagnostic issue drafts" })).toBeChecked();
  } finally {
    await restarted.close();
  }
});

// UI/persistence are covered here. Resource-loader injection is wired through typed driver options;
// no narrow runtime seam currently exposes appendSystemPromptOverride without broad test-only IPC.
