import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  persistedSessionDataPaths,
  selectSession,
} from "../helpers/electron-app";

type PersistedUiState = {
  lastViewedAtBySession?: Record<string, string>;
};

type PersistedCatalog = {
  sessions?: Array<{
    sessionRef?: { workspaceId?: string; sessionId?: string };
    updatedAt?: string;
  }>;
};

test("selecting an unread thread persists read state through the latest known activity", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("unread-state-workspace");
  const title = "Unread watermark session";

  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let sessionRef: { workspaceId: string; sessionId: string } | undefined;
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, title);
    const state = await getDesktopState(window);
    sessionRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    await createNamedThread(window, "Selected reader session");
  } finally {
    await firstRun.close();
  }

  expect(sessionRef).toBeDefined();
  const { rawSessionKey } = persistedSessionDataPaths(userDataDir, sessionRef!);
  const uiStatePath = join(userDataDir, "ui-state.json");
  const catalogPath = join(userDataDir, "catalogs.json");
  const [uiStateRaw, catalogRaw] = await Promise.all([
    readFile(uiStatePath, "utf8"),
    readFile(catalogPath, "utf8"),
  ]);
  const uiState = JSON.parse(uiStateRaw) as PersistedUiState;
  const catalog = JSON.parse(catalogRaw) as PersistedCatalog;
  const targetCatalogSession = (catalog.sessions ?? []).find(
    (session) => session.sessionRef?.workspaceId === sessionRef!.workspaceId && session.sessionRef?.sessionId === sessionRef!.sessionId,
  );
  expect(targetCatalogSession?.updatedAt).toBeTruthy();

  await writeFile(
    uiStatePath,
    `${JSON.stringify(
      {
        ...uiState,
        lastViewedAtBySession: {
          ...(uiState.lastViewedAtBySession ?? {}),
          [rawSessionKey]: new Date(Date.parse(targetCatalogSession!.updatedAt!) - 1_000).toISOString(),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    const row = window.locator(".session-row", { hasText: title });
    await expect(row).toHaveAttribute("data-sidebar-indicator", "unseen");

    await selectSession(window, title);
    await expect(row).toHaveAttribute("data-sidebar-indicator", "none");
  } finally {
    await secondRun.close();
  }

  const thirdRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await thirdRun.firstWindow();
    await expect(window.locator(".session-row", { hasText: title })).toHaveAttribute("data-sidebar-indicator", "none");
  } finally {
    await thirdRun.close();
  }
});
