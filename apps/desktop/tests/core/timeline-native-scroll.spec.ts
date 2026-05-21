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

test("dragging the timeline scrollbar thumb keeps the dragged scroll position", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scrollbar-drag-workspace");
  await initGitRepo(workspacePath);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Scrollbar drag session");
    await seedTranscriptMessages(harness, window, {
      count: 260,
      textFactory: (index) => `Scrollbar drag row ${index} ${"wrapped content ".repeat(index % 7 === 0 ? 80 : 8)}`,
    });
    await expect(window.getByTestId("transcript")).toContainText("Scrollbar drag row 259");

    await jumpTimelineToBottom(window);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const paneBox = await window.getByTestId("timeline-pane").boundingBox();
    if (!paneBox) throw new Error("timeline pane missing bounding box");
    const beforeDrag = await getTimelineScrollMetrics(window);
    const dragStartX = paneBox.x + paneBox.width - 4;
    const dragStartY = paneBox.y + paneBox.height - 26;
    const dragEndY = Math.max(paneBox.y + 32, dragStartY - 260);

    await window.evaluate(() => {
      const pane = document.querySelector<HTMLDivElement>("[data-testid='timeline-pane']");
      if (!pane) throw new Error("timeline pane missing");
      (window as typeof window & { __timelineScrollSamples?: number[] }).__timelineScrollSamples = [];
      pane.addEventListener("scroll", () => {
        (window as typeof window & { __timelineScrollSamples?: number[] }).__timelineScrollSamples?.push(pane.scrollTop);
      });
    });

    await window.mouse.move(dragStartX, dragStartY);
    await window.mouse.down();
    await window.mouse.move(dragStartX, dragEndY, { steps: 24 });
    await window.mouse.up();

    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return beforeDrag.scrollTop - metrics.scrollTop;
    }).toBeGreaterThan(400);

    const samples = await window.evaluate(() => (window as typeof window & { __timelineScrollSamples?: number[] }).__timelineScrollSamples ?? []);
    const upwardJumps = samples.filter((value, index) => index > 0 && value > (samples[index - 1] ?? value) + 120);
    expect(upwardJumps).toHaveLength(0);

    const afterDrag = await getTimelineScrollMetrics(window);
    await window.waitForTimeout(250);
    const afterSettling = await getTimelineScrollMetrics(window);
    expect(Math.abs(afterSettling.scrollTop - afterDrag.scrollTop)).toBeLessThanOrEqual(24);
  } finally {
    await harness.close();
  }
});

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
