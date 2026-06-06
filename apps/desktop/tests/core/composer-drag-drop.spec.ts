import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  dragFilesOverComposer,
  dropFilesOnComposer,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedTranscriptMessages,
  stubNextOpenDialog,
  writeTextFile,
  writeTinyPng,
} from "../helpers/electron-app";

test("typing in a long bottom-pinned thread keeps the composer and timeline stable", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-typing-stability");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Typing stability");
    await seedTranscriptMessages(harness, window, {
      count: 80,
      textFactory: (index) => `seeded transcript row ${index} with enough text to fill the visible conversation pane`,
    });
    await window.evaluate(() => {
      const pane = document.querySelector<HTMLElement>(".timeline-pane");
      if (pane) {
        pane.scrollTop = pane.scrollHeight;
      }
    });

    const before = await window.evaluate(() => {
      const pane = document.querySelector<HTMLElement>(".timeline-pane");
      const composer = document.querySelector<HTMLTextAreaElement>("[data-testid='composer']");
      if (!pane || !composer) {
        throw new Error("Composer or timeline pane was unavailable");
      }
      return {
        composerHeight: composer.getBoundingClientRect().height,
        remaining: pane.scrollHeight - pane.scrollTop - pane.clientHeight,
      };
    });

    const composer = window.getByTestId("composer");
    const prompt = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";
    const remainingAfterEachKey: number[] = [];
    for (const character of prompt) {
      await composer.type(character, { delay: 1 });
      await window.waitForTimeout(20);
      remainingAfterEachKey.push(await window.evaluate(() => {
        const pane = document.querySelector<HTMLElement>(".timeline-pane");
        if (!pane) {
          throw new Error("Timeline pane was unavailable");
        }
        return pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      }));
    }

    const afterComposerHeight = await composer.evaluate((element) => element.getBoundingClientRect().height);
    expect(afterComposerHeight).toBeGreaterThan(before.composerHeight);
    expect(Math.max(...remainingAfterEachKey)).toBeLessThanOrEqual(before.remaining + 4);
  } finally {
    await harness.close();
  }
});

test("existing thread highlights and accepts dropped images and files", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-drop-existing-thread");
  const imagePath = join(workspacePath, "drop-image.png");
  const filePath = join(workspacePath, "notes.txt");
  await writeTinyPng(imagePath);
  await writeTextFile(filePath, "drag-and-drop file sentinel");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Drop attachments");

    await dragFilesOverComposer(window, [imagePath, filePath], "composer-surface");
    await expect(window.getByTestId("composer-drop-indicator")).toBeVisible();

    await dropFilesOnComposer(window, [imagePath, filePath], "composer-surface");

    await expect(window.getByTestId("composer-drop-indicator")).toHaveCount(0);
    await expect(window.locator(".composer-attachment--image")).toHaveCount(1);
    await expect(window.locator(".composer-attachment--file")).toHaveCount(1);
    await expect(window.locator(".composer-attachment__name")).toContainText(["drop-image.png", "notes.txt"]);
  } finally {
    await harness.close();
  }
});

test("dark mode drag hover stays dark and non-flickery", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-drop-dark-hover");
  const imagePath = join(workspacePath, "dark-hover-image.png");
  await writeTinyPng(imagePath);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Dark drop hover");
    await window.evaluate(() => document.documentElement.classList.add("dark"));

    await dragFilesOverComposer(window, [imagePath], "composer-surface");
    const overlay = window.getByTestId("composer-drop-indicator");
    await expect(overlay).toBeVisible();

    await expect.poll(async () => overlay.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        pointerEvents: style.pointerEvents,
      };
    })).toMatchObject({
      background: expect.not.stringMatching(/^rgba?\(25[05],\s*25[15],\s*255/i),
      pointerEvents: "none",
    });

    const cardBackground = await window.locator(".composer__drop-card").evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(cardBackground).not.toMatch(/^rgb\(255,\s*255,\s*255\)$/i);
  } finally {
    await harness.close();
  }
});

test("dropping files on the text input renders image and file previews", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-drop-textarea-target");
  const imagePath = join(workspacePath, "textarea-drop-image.png");
  const filePath = join(workspacePath, "textarea-notes.txt");
  await writeTinyPng(imagePath);
  await writeTextFile(filePath, "textarea drop file sentinel");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Textarea drop attachments");

    await dragFilesOverComposer(window, [imagePath, filePath], "composer");
    await expect(window.getByTestId("composer-drop-indicator")).toBeVisible();

    await dropFilesOnComposer(window, [imagePath, filePath], "composer");

    const preview = window.locator(".composer-attachment--image .composer-attachment__preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(window.locator(".composer-attachment--file")).toContainText("textarea-notes.txt");
  } finally {
    await harness.close();
  }
});

test("new thread reuses drag-drop attachments and carries them into the transcript", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-drop-new-thread");
  const imagePath = join(workspacePath, "drop-image.png");
  const filePath = join(workspacePath, "notes.txt");
  await writeTinyPng(imagePath);
  await writeTextFile(filePath, "new-thread file sentinel");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    await dragFilesOverComposer(window, [imagePath, filePath], "new-thread-composer-surface");
    await expect(window.getByTestId("composer-drop-indicator")).toBeVisible();

    await dropFilesOnComposer(window, [imagePath, filePath], "new-thread-composer-surface");

    await expect(window.locator(".new-thread .composer-attachment--image")).toHaveCount(1);
    await expect(window.locator(".new-thread .composer-attachment--file")).toHaveCount(1);

    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const transcript = await getSelectedTranscript(window);
        const userMessage = transcript?.transcript.find(
          (entry) => entry.kind === "message" && "role" in entry && entry.role === "user",
        );
        return userMessage?.attachments?.map((attachment) => attachment.kind).sort().join(",") ?? "";
      }, { timeout: 15_000 })
      .toBe("file,image");
    await expect(window.locator(".timeline-item__attachment--image")).toHaveCount(1, { timeout: 15_000 });
    await expect(window.locator(".timeline-item__attachment--file")).toContainText("notes.txt", { timeout: 15_000 });
  } finally {
    await harness.close();
  }
});

test("attach controls add mixed attachments in both composer flows", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-picker-attachments");
  const imagePath = join(workspacePath, "picker-image.png");
  const filePath = join(workspacePath, "picker-notes.txt");
  await writeTinyPng(imagePath);
  await writeTextFile(filePath, "picker file sentinel");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Picker attachments");

    await stubNextOpenDialog(harness, [imagePath, filePath]);
    await window.getByRole("button", { name: "Attach files" }).click();
    await expect(window.locator(".composer-attachment--image")).toHaveCount(1);
    await expect(window.locator(".composer-attachment--file")).toHaveCount(1);

    await openNewThread(window);
    await window.locator('.new-thread input[type="file"]').setInputFiles([imagePath, filePath]);
    await expect(window.locator(".new-thread .composer-attachment--image")).toHaveCount(1);
    await expect(window.locator(".new-thread .composer-attachment--file")).toHaveCount(1);
  } finally {
    await harness.close();
  }
});
