import { test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("reliably creates and reaps Electron windows across repeated launches", async () => {
  test.setTimeout(180_000);

  for (let index = 0; index < 12; index += 1) {
    const userDataDir = await makeUserDataDir(`pi-gui-startup-${index}-`);
    const workspacePath = await makeWorkspace(`startup-${index}`);
    const harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    try {
      await harness.firstWindow();
    } finally {
      await harness.close();
    }
  }
});
