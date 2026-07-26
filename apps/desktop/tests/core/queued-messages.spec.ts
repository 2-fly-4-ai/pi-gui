import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionDriverEvent, SessionQueuedMessage, SessionRef, WorkspaceRef } from "@pi-gui/session-driver";
import {
  TINY_PNG_BASE64,
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  pasteTinyPng,
} from "../helpers/electron-app";

async function selectedSessionContext(window: Parameters<typeof getDesktopState>[0]): Promise<{
  readonly sessionRef: SessionRef;
  readonly workspace: WorkspaceRef;
  readonly title: string;
}> {
  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
  if (!workspace) {
    throw new Error("Expected a selected workspace");
  }
  const session = workspace.sessions.find((entry) => entry.id === state.selectedSessionId);
  if (!session) {
    throw new Error("Expected a selected session");
  }
  return {
    sessionRef: {
      workspaceId: workspace.id,
      sessionId: session.id,
    },
    workspace: {
      workspaceId: workspace.id,
      path: workspace.path,
      displayName: workspace.name,
    },
    title: session.title,
  };
}

async function emitRunningSnapshot(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  window: Parameters<typeof getDesktopState>[0],
  queuedMessages: readonly SessionQueuedMessage[],
): Promise<void> {
  const context = await selectedSessionContext(window);
  const timestamp = new Date().toISOString();
  const event: Extract<SessionDriverEvent, { type: "sessionUpdated" }> = {
    type: "sessionUpdated",
    sessionRef: context.sessionRef,
    timestamp,
    runId: "queued-messages-core-run",
    snapshot: {
      ref: context.sessionRef,
      workspace: context.workspace,
      title: context.title,
      status: "running",
      updatedAt: timestamp,
      preview: "Working…",
      runningRunId: "queued-messages-core-run",
      queuedMessages,
    },
  };
  await emitTestSessionEvent(harness, event);
}

async function emitQueuedMessageStarted(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  window: Parameters<typeof getDesktopState>[0],
  message: SessionQueuedMessage,
  remainingQueuedMessages: readonly SessionQueuedMessage[],
): Promise<void> {
  const context = await selectedSessionContext(window);
  const timestamp = new Date().toISOString();
  const startedEvent: Extract<SessionDriverEvent, { type: "queuedMessageStarted" }> = {
    type: "queuedMessageStarted",
    sessionRef: context.sessionRef,
    timestamp,
    message,
  };
  await emitTestSessionEvent(harness, startedEvent);
  await emitRunningSnapshot(harness, window, remainingQueuedMessages);
}

async function transcriptMessages(window: Parameters<typeof getDesktopState>[0]): Promise<string[]> {
  return (await getSelectedTranscript(window))?.transcript.flatMap((item) =>
    item.kind === "message" ? [`${item.role}:${item.text}`] : [],
  ) ?? [];
}

test("shows queued messages while running and preserves attachments through inline edit", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("queued-messages-core");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Queued messages");

    const queuedMessage: SessionQueuedMessage = {
      id: "queued-message-1",
      mode: "followUp",
      text: "Inspect the queued screenshot",
      attachments: [
        {
          kind: "image",
          mimeType: "image/png",
          data: TINY_PNG_BASE64,
          name: "queued-image.png",
        },
      ],
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      updatedAt: new Date(Date.now() - 5_000).toISOString(),
    };
    await emitRunningSnapshot(harness, window, [queuedMessage]);
    await expect
      .poll(async () => (await getDesktopState(window)).queuedComposerMessages.map((message) => message.text))
      .toEqual(["Inspect the queued screenshot"]);

    const composer = window.getByTestId("composer");

    await composer.click();
    await window.keyboard.type("local scratch draft");
    await pasteTinyPng(window, "local-draft.png");
    await expect(window.locator(".composer-attachment__name")).toContainText("local-draft.png");

    const queuedCard = window.getByTestId("queued-composer-message").first();
    await expect(queuedCard.locator(".queued-composer-message__mode")).toHaveCount(0);
    await expect(queuedCard.locator(".queued-composer-message__header .queued-composer-message__text")).toContainText("Inspect the queued screenshot");
    await queuedCard.getByRole("button", { name: "Edit" }).click();
    await expect(window.getByTestId("queued-composer-editing")).toContainText("Editing queued message");
    await expect(composer).toHaveValue("Inspect the queued screenshot");
    await expect(window.locator(".composer-attachment__name")).toContainText("queued-image.png");

    await window.getByRole("button", { name: "Cancel" }).click();
    await expect(composer).toHaveValue("local scratch draft");
    await expect(window.locator(".composer-attachment__name")).toContainText("local-draft.png");
  } finally {
    await harness.close();
  }
});

test("recovers queue order, edits, attachments, context, and invalid items across relaunch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("queued-messages-relaunch");
  const first = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let queueFilePath = "";
  try {
    const window = await first.firstWindow();
    await createNamedThread(window, "Recovered queue");
    const context = await selectedSessionContext(window);
    queueFilePath = join(
      userDataDir,
      "queued-messages",
      `${encodeURIComponent(`${context.sessionRef.workspaceId}:${context.sessionRef.sessionId}`)}.json`,
    );
    const now = new Date().toISOString();
    await emitRunningSnapshot(first, window, [
      {
        id: "recovered-a",
        mode: "followUp",
        text: "First recovered item",
        attachments: [{
          kind: "image",
          mimeType: "image/png",
          data: TINY_PNG_BASE64,
          name: "recovered-context.png",
        }],
        metadata: { contextManifestSnapshotId: "context-snapshot-a" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "recovered-b",
        mode: "followUp",
        text: "Second recovered item",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await expect.poll(async () => {
      try {
        return JSON.parse(await readFile(queueFilePath, "utf8")).length;
      } catch {
        return 0;
      }
    }).toBe(2);
  } finally {
    await first.close();
  }
  await expect.poll(async () => {
    const value = JSON.parse(await readFile(queueFilePath, "utf8")) as Array<{ recoveryState?: string }>;
    return value.map((message) => message.recoveryState);
  }).toEqual(["stale", "stale"]);

  const second = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await second.firstWindow();
    const cards = window.getByTestId("queued-composer-message");
    await expect(cards).toHaveCount(2, { timeout: 15_000 });
    await expect(cards.first()).toContainText("Recovered");
    await expect(cards.first()).toContainText("Context attached");
    await expect(cards.first()).toContainText("recovered-context.png");

    const secondCard = cards.filter({ hasText: "Second recovered item" });
    await secondCard.getByRole("button", { name: /Move queued message up/ }).click();
    await expect(cards.first()).toContainText("Second recovered item");
    await cards.filter({ hasText: "First recovered item" }).getByRole("button", { name: "Steer" }).click();
    await expect(cards.filter({ hasText: "First recovered item" })).toContainText("Steer");
    await expect(cards.filter({ hasText: "First recovered item" }).getByRole("button", { name: "Queue", exact: true })).toBeVisible();
    await expect(cards.first().getByRole("button", { name: "Send next" })).toBeVisible();

    await cards.first().getByRole("button", { name: "Edit" }).click();
    await window.getByTestId("composer").fill("Edited recovered item");
    await window.getByTestId("send").click();
    await expect(window.getByTestId("queued-composer-editing")).toHaveCount(0);
    await expect(cards.first()).toContainText("Edited recovered item");
  } finally {
    await second.close();
  }

  const persisted = JSON.parse(await readFile(queueFilePath, "utf8")) as unknown[];
  persisted.push({ id: "invalid-recovered-item", mode: "not-a-mode" });
  await writeFile(queueFilePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  const third = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await third.firstWindow();
    const cards = window.getByTestId("queued-composer-message");
    await expect(cards).toHaveCount(3, { timeout: 15_000 });
    await expect(cards.first()).toContainText("Edited recovered item");
    await expect(cards.filter({ hasText: "First recovered item" })).toContainText("Context attached");
    await expect(cards.filter({ hasText: "First recovered item" })).toContainText("recovered-context.png");
    await expect(cards.filter({ hasText: "Needs edit" })).toContainText("no sendable text or attachments");
  } finally {
    await third.close();
  }
});

test("delineates queued follow-ups and submitted steers in the timeline", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("queued-messages-timeline");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Queued timeline messages");

    const queuedSteer: SessionQueuedMessage = {
      id: "queued-steer-1",
      mode: "followUp",
      text: "Steer this queued message now",
      createdAt: new Date(Date.now() - 6_000).toISOString(),
      updatedAt: new Date(Date.now() - 6_000).toISOString(),
    };
    const queuedFollowUp: SessionQueuedMessage = {
      id: "queued-follow-up-1",
      mode: "followUp",
      text: "Run this queued follow-up next",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      updatedAt: new Date(Date.now() - 5_000).toISOString(),
    };
    await emitRunningSnapshot(harness, window, [queuedSteer, queuedFollowUp]);

    await expect(window.getByTestId("queued-composer-message").filter({ hasText: queuedSteer.text })).toHaveCount(1);
    await expect(window.getByTestId("queued-composer-message").filter({ hasText: queuedFollowUp.text })).toHaveCount(1);
    await expect(window.locator(".queued-composer-message__mode")).toHaveCount(0);
    await expect(window.getByTestId("transcript")).not.toContainText(queuedSteer.text);
    await expect(window.getByTestId("transcript")).not.toContainText(queuedFollowUp.text);

    await window
      .getByTestId("queued-composer-message")
      .filter({ hasText: queuedSteer.text })
      .getByRole("button", { name: "Steer", exact: true })
      .click();
    await expect(window.getByTestId("queued-composer-message").filter({ hasText: queuedSteer.text })).toHaveCount(1);
    await expect(window.getByTestId("transcript")).not.toContainText(queuedSteer.text);

    await emitQueuedMessageStarted(harness, window, { ...queuedSteer, mode: "steer" }, [queuedFollowUp]);
    await expect(window.getByTestId("queued-composer-message").filter({ hasText: queuedSteer.text })).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText(queuedSteer.text);

    const submittedSteer: SessionQueuedMessage = {
      id: "submitted-steer-1",
      mode: "steer",
      text: "Steer the current run now",
      createdAt: new Date(Date.now() - 4_000).toISOString(),
      updatedAt: new Date(Date.now() - 4_000).toISOString(),
    };
    await emitRunningSnapshot(harness, window, [submittedSteer, queuedFollowUp]);
    await expect(window.getByTestId("queued-composer-message").filter({ hasText: "Steer the current run now" })).toHaveCount(1);
    await expect(window.getByTestId("transcript")).not.toContainText("Steer the current run now");

    await emitQueuedMessageStarted(harness, window, submittedSteer, [queuedFollowUp]);
    await expect(window.getByTestId("queued-composer-message").filter({ hasText: "Steer the current run now" })).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText("Steer the current run now");

    await emitQueuedMessageStarted(harness, window, queuedFollowUp, []);
    await expect(window.getByTestId("queued-composer-messages")).toHaveCount(0);
    await expect(window.getByTestId("transcript")).toContainText(queuedFollowUp.text);

    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef: (await selectedSessionContext(window)).sessionRef,
      timestamp: new Date().toISOString(),
      text: "Answering the queued follow-up",
    });

    await expect
      .poll(async () => transcriptMessages(window))
      .toEqual([
        `user:${queuedSteer.text}`,
        "user:Steer the current run now",
        `user:${queuedFollowUp.text}`,
        "assistant:Answering the queued follow-up",
      ]);
  } finally {
    await harness.close();
  }
});

test("clears queued messages when a running turn aborts", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("queued-messages-abort");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Queued abort cleanup");
    const context = await selectedSessionContext(window);
    const queuedMessage: SessionQueuedMessage = {
      id: "queued-message-abort",
      mode: "steer",
      text: "This should not survive stop",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      updatedAt: new Date(Date.now() - 5_000).toISOString(),
    };
    await emitRunningSnapshot(harness, window, [queuedMessage]);

    await expect(window.getByTestId("queued-composer-message").filter({ hasText: "This should not survive stop" })).toHaveCount(1);
    await expect(window.getByTestId("transcript")).not.toContainText("This should not survive stop");

    await emitTestSessionEvent(harness, {
      type: "runFailed",
      sessionRef: context.sessionRef,
      timestamp: new Date().toISOString(),
      error: {
        message: "Request was aborted",
        code: "ABORTED",
      },
    });

    await expect(window.getByTestId("queued-composer-messages")).toHaveCount(0);
    await expect.poll(async () => (await getDesktopState(window)).queuedComposerMessages).toEqual([]);
    await expect(window.getByTestId("transcript")).not.toContainText("This should not survive stop");
    await expect(window.getByTestId("transcript")).toContainText("Request was aborted");
  } finally {
    await harness.close();
  }
});
