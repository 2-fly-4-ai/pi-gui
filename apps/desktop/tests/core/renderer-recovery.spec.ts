import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
} from "../helpers/electron-app";

test("renderer crash recovery reopens once in bounded safe mode with an explanation", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("renderer-safe-recovery-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Recovery fixture");
    const recoverySentinel = "RECOVERY_TRANSCRIPT_RESTORED_WITHOUT_REOPEN";
    await seedTranscriptMessages(harness, window, {
      count: 20,
      textFactory: (index) => index === 19 ? recoverySentinel : `recovery history ${index}`,
    });
    await expect(window.getByTestId("transcript")).toContainText(recoverySentinel);
    const rendererHeapLimit = await window.evaluate(() =>
      (performance as Performance & {
        readonly memory?: { readonly jsHeapSizeLimit: number };
      }).memory?.jsHeapSizeLimit ?? 0);
    expect(rendererHeapLimit).toBeGreaterThanOrEqual(3.5 * 1024 * 1024 * 1024);
    expect(rendererHeapLimit).toBeLessThanOrEqual(4.5 * 1024 * 1024 * 1024);
    await harness.electronApp.evaluate(() => {
      const hooks = (globalThis as {
        __PI_APP_TEST_HOOKS?: { forceRendererCrash?: () => void };
      }).__PI_APP_TEST_HOOKS;
      if (!hooks?.forceRendererCrash) {
        throw new Error("Renderer crash hook is unavailable");
      }
      hooks.forceRendererCrash();
    });

    await expect.poll(() => window.url(), { timeout: 20_000 })
      .toContain("rendererRecovery=1");
    await expect.poll(
      () =>
        harness.electronApp.evaluate(async ({ BrowserWindow }) => {
          const recoveredWindow = BrowserWindow.getAllWindows()[0];
          if (!recoveredWindow || recoveredWindow.webContents.isLoading()) {
            return "";
          }
          return recoveredWindow.webContents
            .executeJavaScript("document.body?.innerText ?? ''")
            .catch(() => "");
        }),
      { timeout: 20_000 },
    ).toContain("Pi recovered the renderer in safe mode");
    await expect.poll(
      () =>
        harness.electronApp.evaluate(async ({ BrowserWindow }) => {
          const recoveredWindow = BrowserWindow.getAllWindows()[0];
          if (!recoveredWindow || recoveredWindow.webContents.isLoading()) {
            return false;
          }
          return recoveredWindow.webContents
            .executeJavaScript("Boolean(document.querySelector('[data-testid=\"composer\"]'))")
            .catch(() => false);
        }),
      { timeout: 20_000 },
    ).toBe(true);
    await expect.poll(
      () => harness.electronApp.evaluate(async ({ BrowserWindow }, sentinel) => {
        const recoveredWindow = BrowserWindow.getAllWindows()[0];
        if (!recoveredWindow || recoveredWindow.webContents.isLoading()) return false;
        return recoveredWindow.webContents.executeJavaScript(
          `document.querySelector('[data-testid="transcript"]')?.textContent?.includes(${JSON.stringify(sentinel)}) ?? false`,
        ).catch(() => false) as Promise<boolean>;
      }, recoverySentinel),
      { timeout: 20_000 },
    ).toBe(true);
    await expect.poll(
      () => harness.electronApp.evaluate(async ({ BrowserWindow }) => {
        const recoveredWindow = BrowserWindow.getAllWindows()[0];
        if (!recoveredWindow || recoveredWindow.webContents.isLoading()) return true;
        return recoveredWindow.webContents.executeJavaScript(
          `document.querySelector('[data-testid="transcript"]')?.textContent?.includes('Loading transcript') ?? true`,
        ).catch(() => true) as Promise<boolean>;
      }),
      { timeout: 20_000 },
    ).toBe(false);
  } finally {
    await harness.close();
  }
});
