import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
} from "../helpers/electron-app";

test("opt-in minimap stays bounded and navigable for long virtualized timelines", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-minimap-workspace");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await createNamedThread(window, "Long minimap thread");
    await seedTranscriptMessages(harness, window, {
      count: 110,
      textFactory: (index) => `Minimap milestone ${index}`,
    });
    await expect(window.getByTestId("timeline-minimap")).toHaveCount(0);

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByTestId("settings-surface").getByRole("button", { name: "Appearance", exact: true }).click();
    await window.getByLabel("Show timeline minimap").check();
    await window.getByRole("button", { name: "Back to app" }).click();

    const minimap = window.getByTestId("timeline-minimap");
    await expect(minimap).toBeVisible();
    const segments = minimap.locator(".timeline-minimap__segment");
    const initialSegmentCount = await segments.count();
    expect(initialSegmentCount).toBeGreaterThan(0);
    expect(initialSegmentCount).toBeLessThanOrEqual(96);
    await expect(minimap.locator("[data-signal-types~='milestone']").first()).toBeVisible();
    await expect(minimap.locator("[data-signal-types~='completion']").first()).toBeVisible();

    await segments.first().click();
    await expect(window.locator(".timeline-attention-target")).toHaveCount(1);
    await expect(window.locator(".timeline-attention-target")).toHaveAttribute("data-timeline-row-id", /.+/);

    await window.setViewportSize({ width: 1120, height: 720 });
    await expect(minimap).toBeVisible();
    expect(await segments.count()).toBeLessThanOrEqual(96);

    await createNamedThread(window, "Short minimap thread");
    await expect(window.getByTestId("timeline-minimap")).toHaveCount(0);

    await window.locator(".session-row__select", { hasText: "Long minimap thread" }).click();
    await expect(window.getByTestId("timeline-minimap")).toBeVisible();

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    await window.locator(".session-row__select", { hasText: "Long minimap thread" }).click();
    await expect(window.getByTestId("timeline-minimap")).toBeVisible();
    expect(await window.locator(".timeline-minimap__segment").count()).toBeLessThanOrEqual(96);
  } finally {
    await harness.close();
  }
});
