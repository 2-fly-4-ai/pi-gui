import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, type PiAppWindow } from "../helpers/electron-app";

test("persists renderer diagnostics to the desktop log", async () => {
  const userDataDir = await makeUserDataDir();
  const harness = await launchDesktop(userDataDir, { testMode: "background" });
  const logPath = join(userDataDir, "logs", "desktop.log");

  try {
    const window = await harness.firstWindow();
    await window.evaluate(() => {
      (window as PiAppWindow).piApp?.reportRendererDiagnostic({
        kind: "playwright-renderer-diagnostic",
        message: "renderer diagnostic smoke test",
      });
      (window as PiAppWindow).piApp?.reportRendererDiagnostic({
        kind: "ignored-error",
        message: "Ignored error in playwright diagnostics smoke",
        details: {
          scope: "playwright.diagnostics-smoke",
          error: { message: "ignored diagnostic smoke test" },
        },
      });
      console.error("playwright console diagnostic smoke test");
    });

    await expect
      .poll(
        async () => {
          try {
            return await readFile(logPath, "utf8");
          } catch {
            return "";
          }
        },
        { timeout: 10_000 },
      )
      .toContain("playwright-renderer-diagnostic");

    const log = await readFile(logPath, "utf8");
    expect(log).toContain("renderer diagnostic smoke test");
    expect(log).toContain("playwright.diagnostics-smoke");
    expect(log).toContain("ignored diagnostic smoke test");
    expect(log).toContain("playwright console diagnostic smoke test");
  } finally {
    await harness.close();
  }
});
