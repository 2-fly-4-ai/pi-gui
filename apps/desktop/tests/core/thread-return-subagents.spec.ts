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
