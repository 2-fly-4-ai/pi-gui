import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
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

test("long transcripts stay virtualized during restore", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("long-transcript-virtualized-restore-workspace");
  await initGitRepo(workspacePath);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Long transcript restore session");
    await window.evaluate(() => {
      const testWindow = window as typeof window & { __maxTimelineRows?: number; __timelineRowObserver?: MutationObserver };
      const sample = () => {
        const rowCount = document.querySelectorAll("[data-timeline-row-id]").length;
        testWindow.__maxTimelineRows = Math.max(testWindow.__maxTimelineRows ?? 0, rowCount);
      };
      testWindow.__maxTimelineRows = 0;
      testWindow.__timelineRowObserver?.disconnect();
      testWindow.__timelineRowObserver = new MutationObserver(sample);
      testWindow.__timelineRowObserver.observe(document.body, { childList: true, subtree: true });
      sample();
    });

    await seedTranscriptMessages(harness, window, {
      count: 360,
      textFactory: (index) => `Virtualized restore row ${index} ${"wrapped content ".repeat(18)}`,
    });
    await expect(window.getByTestId("transcript")).toContainText("Virtualized restore row 359");

    const maxRenderedRows = await window.evaluate(() => {
      const testWindow = window as typeof window & { __maxTimelineRows?: number; __timelineRowObserver?: MutationObserver };
      testWindow.__timelineRowObserver?.disconnect();
      return testWindow.__maxTimelineRows ?? 0;
    });
    expect(maxRenderedRows).toBeLessThan(220);
  } finally {
    await harness.close();
  }
});

test("fast virtualized timeline scrolling keeps a visible rendered row", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("virtual-scroll-no-blank-workspace");
  await initGitRepo(workspacePath);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Virtual scroll no blank session");
    await seedTranscriptMessages(harness, window, {
      count: 320,
      textFactory: (index) => `No blank row ${index} ${"variable markdown content ".repeat(index % 11 === 0 ? 90 : 10)}`,
    });
    await expect(window.getByTestId("transcript")).toContainText("No blank row 319");
    await jumpTimelineToBottom(window);

    const result = await window.evaluate(async () => {
      const pane = document.querySelector<HTMLDivElement>("[data-testid='timeline-pane']");
      if (!pane) throw new Error("Timeline pane was unavailable");

      const waitFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const visibleRows = () => {
        const paneRect = pane.getBoundingClientRect();
        return Array.from(pane.querySelectorAll<HTMLElement>("[data-timeline-row-id]")).filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > paneRect.top + 8 && rect.top < paneRect.bottom - 8;
        }).length;
      };

      let blankFrames = 0;
      let maxBlankFrames = 0;
      const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
      const targets = [
        maxScrollTop * 0.75,
        maxScrollTop * 0.35,
        maxScrollTop * 0.9,
        maxScrollTop * 0.15,
        maxScrollTop * 0.6,
      ];

      for (const target of targets) {
        pane.scrollTop = target;
        pane.dispatchEvent(new Event("scroll", { bubbles: true }));
        await waitFrame();
        const count = visibleRows();
        if (count === 0) {
          blankFrames += 1;
          maxBlankFrames = Math.max(maxBlankFrames, blankFrames);
        } else {
          blankFrames = 0;
        }
      }

      return { maxBlankFrames, finalVisibleRows: visibleRows() };
    });

    expect(result.maxBlankFrames).toBeLessThanOrEqual(1);
    expect(result.finalVisibleRows).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});

test("virtualized tool rows expand after scrolling", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("virtual-tool-expand-workspace");
  await initGitRepo(workspacePath);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Virtual tool expand session");
    const seeded = await seedTranscriptMessages(harness, window, {
      count: 120,
      textFactory: (index) => `Virtual expand row ${index} ${"wrapped content ".repeat(8)}`,
    });
    const timestamp = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef: seeded.sessionRef,
      timestamp,
      toolName: "Read",
      callId: "virtual-read-expand-1",
      input: { path: "virtual-file.txt" },
    } satisfies Extract<SessionDriverEvent, { type: "toolStarted" }>);
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef: seeded.sessionRef,
      timestamp,
      callId: "virtual-read-expand-1",
      success: true,
      output: "expanded virtual output is visible",
    } satisfies Extract<SessionDriverEvent, { type: "toolFinished" }>);

    await jumpTimelineToBottom(window);
    await expect(window.getByTestId("transcript")).toContainText("virtual-file.txt");

    const toolHeader = window.locator(".timeline-tool__header", { hasText: "virtual-file.txt" }).last();
    await expect(toolHeader).toHaveAttribute("aria-expanded", "false");
    await toolHeader.click();
    await expect(toolHeader).toHaveAttribute("aria-expanded", "true");
    await expect(window.locator(".timeline-tool__pre")).toContainText("expanded virtual output is visible");
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
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
      pane.scrollTop = Math.max(0, pane.scrollTop - 1_200);
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
      pane.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
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
