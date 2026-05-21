import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedTranscriptMessages,
} from "../helpers/electron-app";

function markerText() {
  return `SUBAGENT_SETTINGS_RETURN_${Date.now()}`;
}

test("returning from Settings > Subagents keeps selected thread transcript visible", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("thread-return-subagents-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Thread return from subagents");
    const marker = markerText();
    await seedTranscriptMessages(harness, window, {
      count: 8,
      textFactory: (index) => index === 7 ? `${marker} visible after return` : `Seed row ${index}`,
    });

    await expect(window.getByTestId("transcript")).toContainText(marker);
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Subagents", exact: true }).click();
    await expect(window.getByTestId("settings-agents-section")).toBeVisible();

    await window.getByRole("button", { name: "Back" }).click();
    await expect(window.getByTestId("timeline-pane")).toBeVisible();
    await expect(window.getByTestId("transcript")).toContainText(marker);
    await expect.poll(async () => (await getSelectedTranscript(window))?.transcript.length ?? 0).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});

test("quick Settings round-trip after reopening a long thread returns to virtualized transcript rows", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("thread-return-long-reopen-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const marker = `LONG_THREAD_RETURN_${Date.now()}`;
  let harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Long thread return from settings");
    await seedTranscriptMessages(harness, window, {
      count: 700,
      textFactory: (index) =>
        index === 699 ? `${marker} visible after reopening settings` : `Long settings return seed row ${index} `.repeat(6),
    });
    await expect(window.getByTestId("transcript")).toContainText(marker);
  } finally {
    await harness.close();
  }

  harness = await launchDesktop(userDataDir, {
    agentDir,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await expect(window.locator(".topbar__session")).toHaveText("Long thread return from settings");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Back to app" }).click();

    await expect(window.getByTestId("timeline-pane")).toBeVisible();
    await expect.poll(async () =>
      window.evaluate(() => document.querySelectorAll(".timeline__virtual-row").length),
    ).toBeGreaterThan(0);
    await expect.poll(async () =>
      window.evaluate(() => {
        const pane = document.querySelector("[data-testid='timeline-pane']");
        const paneRect = pane?.getBoundingClientRect();
        if (!paneRect) return 0;
        return Array.from(document.querySelectorAll(".timeline__virtual-row")).filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > paneRect.top && rect.top < paneRect.bottom;
        }).length;
      }),
    ).toBeGreaterThan(0);
    await expect.poll(async () =>
      window.evaluate(() => document.querySelector("[data-testid='transcript']")?.textContent?.length ?? 0),
    ).toBeGreaterThan(100);
    await expect.poll(async () => (await getSelectedTranscript(window))?.transcript.length ?? 0).toBeGreaterThan(100);

    const desktopLog = await readFile(join(userDataDir, "logs", "desktop.log"), "utf8").catch(() => "");
    expect(desktopLog).not.toContain("Maximum update depth exceeded");
  } finally {
    await harness.close();
  }
});
