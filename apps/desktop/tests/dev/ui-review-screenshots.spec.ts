import { join } from "node:path";
import { test } from "@playwright/test";
import {
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

const OUT_DIR = process.env.UI_REVIEW_OUT_DIR ?? "/tmp";

const SAMPLE_REPLY = [
  "## Plan",
  "",
  "I looked at `src/server.ts` and the failing test. Here's what I found:",
  "",
  "1. The retry loop never backs off, so the queue saturates.",
  "2. `parseConfig` swallows the validation error.",
  "3. Two tests assert on stale fixtures.",
  "",
  "```ts",
  "export function backoff(attempt: number): number {",
  "  return Math.min(1000 * 2 ** attempt, 30_000);",
  "}",
  "```",
  "",
  "| file | change |",
  "| --- | --- |",
  "| src/server.ts | add backoff |",
  "| src/config.ts | rethrow validation error |",
  "",
  "> Note: the fixture update touches 12 snapshot files.",
].join("\n");

test("capture ui review screenshots", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("ui-review-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    const shot = async (name: string) => {
      await window.waitForTimeout(700);
      await window.screenshot({ path: join(OUT_DIR, `${name}.png`) });
      console.log(`captured ${name}`);
    };

    await waitForWorkspaceByPath(window, workspacePath);

    await createSessionViaIpc(window, workspacePath, "Fix retry backoff");
    await seedTranscriptMessages(harness, window, { count: 1, textFactory: () => SAMPLE_REPLY });
    await createSessionViaIpc(window, workspacePath, "Investigate flaky e2e suite");
    await seedTranscriptMessages(harness, window, {
      count: 2,
      textFactory: (i) => (i === 0 ? SAMPLE_REPLY : "Short follow-up answer confirming the fix landed and tests pass."),
    });
    await shot("01-thread-light");

    const views = ["new-thread", "skills", "extensions", "settings", "display-mode"] as const;
    for (const view of views) {
      await window.evaluate((v) => (window as unknown as { piApp: { setActiveView(view: string): Promise<unknown> } }).piApp.setActiveView(v), view);
      await shot(`10-${view}-light`);
    }

    const setTheme = (mode: string) =>
      window.evaluate((m) => (window as unknown as { piApp: { setThemeMode(mode: string): Promise<unknown> } }).piApp.setThemeMode(m), mode);
    const setView = (view: string) =>
      window.evaluate((v) => (window as unknown as { piApp: { setActiveView(view: string): Promise<unknown> } }).piApp.setActiveView(v), view);

    await setTheme("light");
    await setView("threads");
    await shot("30-thread-lightmode");
    await setView("new-thread");
    await shot("31-new-thread-lightmode");
    await setView("settings");
    await shot("32-settings-lightmode");
    await setView("skills");
    await shot("33-skills-lightmode");
    await setView("extensions");
    await shot("34-extensions-lightmode");
    await setView("display-mode");
    await shot("35-display-mode-lightmode");

    await setTheme("dark");
    await setView("threads");
    await shot("40-thread-darkmode");
    await setView("new-thread");
    await shot("41-new-thread-darkmode");
    await setView("settings");
    await shot("42-settings-darkmode");
    await setView("skills");
    await shot("43-skills-darkmode");
    await setView("extensions");
    await shot("44-extensions-darkmode");
    await setView("display-mode");
    await shot("45-display-mode-darkmode");
  } finally {
    await harness.close();
  }
});
