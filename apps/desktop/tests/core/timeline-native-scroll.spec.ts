import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getTimelineScrollMetrics,
  initGitRepo,
  jumpTimelineToBottom,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
} from "../helpers/electron-app";

test("native timeline scrollbar movement down is treated as user scroll intent", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-scrollbar-down-workspace");
  await initGitRepo(workspacePath);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Native scrollbar down session");
    await seedTranscriptMessages(harness, window, {
      count: 36,
      textFactory: (index) => `Native scrollbar row ${index} ${"wrapped content ".repeat(14)}`,
    });
    await expect(window.getByTestId("transcript")).toContainText("Native scrollbar row 35");

    await jumpTimelineToBottom(window);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    await window.evaluate(() => {
      const pane = document.querySelector<HTMLDivElement>("[data-testid='timeline-pane']");
      if (!pane) throw new Error("timeline pane missing");
      pane.scrollTop = Math.max(0, pane.scrollTop - 1_200);
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeGreaterThan(900);

    const beforeNativeDown = await getTimelineScrollMetrics(window);
    const targetScrollTop = beforeNativeDown.scrollTop + 420;
    await window.evaluate((target) => {
      const pane = document.querySelector<HTMLDivElement>("[data-testid='timeline-pane']");
      if (!pane) throw new Error("timeline pane missing");
      pane.scrollTop = target;
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, targetScrollTop);

    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return Math.abs(metrics.scrollTop - targetScrollTop);
    }).toBeLessThanOrEqual(16);
  } finally {
    await harness.close();
  }
});
