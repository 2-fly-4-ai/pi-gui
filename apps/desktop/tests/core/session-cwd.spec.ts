import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
  type PiAppWindow,
} from "../helpers/electron-app";

test("new threads persist the selected workspace cwd, not Electron's launch cwd", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("session-cwd-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);

    const selectedSessionId = await window.evaluate(async (workspaceId) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.createSession({ workspaceId, title: "Cwd regression thread" });
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const state = await app.getState();
        const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
        const session = workspace?.sessions.find((entry) => entry.title === "Cwd regression thread");
        if (session) {
          return session.id;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      throw new Error("Created session was not published to state");
    }, workspace.id);
    expect(selectedSessionId).toBeTruthy();

    const catalogsPath = join(userDataDir, "catalogs.json");
    await expect
      .poll(async () => {
        const catalogs = JSON.parse(await readFile(catalogsPath, "utf8")) as {
          sessions?: Array<{
            sessionRef: { workspaceId: string; sessionId: string };
            sessionFilePath?: string;
          }>;
        };
        return catalogs.sessions?.find(
          (session) =>
            session.sessionRef.workspaceId === workspace.id && session.sessionRef.sessionId === selectedSessionId,
        )?.sessionFilePath;
      })
      .toBeTruthy();

    const catalogs = JSON.parse(await readFile(catalogsPath, "utf8")) as {
      sessions: Array<{
        sessionRef: { workspaceId: string; sessionId: string };
        sessionFilePath?: string;
      }>;
    };
    const sessionFilePath = catalogs.sessions.find(
      (session) => session.sessionRef.workspaceId === workspace.id && session.sessionRef.sessionId === selectedSessionId,
    )?.sessionFilePath;
    expect(sessionFilePath).toBeTruthy();

    const sessionFileText = await readFile(sessionFilePath!, "utf8");
    const [headerLine] = sessionFileText.split("\n");
    const header = JSON.parse(headerLine) as { cwd?: string };
    expect(header.cwd).toBe(workspacePath);
    expect(sessionFileText).not.toContain(process.cwd());

    const state = await getDesktopState(window);
    expect(state.selectedWorkspaceId).toBe(workspace.id);
  } finally {
    await harness.close();
  }
});
