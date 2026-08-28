import { expect, test } from "@playwright/test";
import {
  clickSession,
  getAppDiagnostics,
  getDesktopState,
  getRealAuthConfig,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedLargeHistorySessionFixture,
} from "../helpers/electron-app";
import { join } from "node:path";

test("streams a real provider response into 1,000 historical rows within resource ceilings", async () => {
  test.setTimeout(150_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("live-resource-safety-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();
    const fixture = await seedLargeHistorySessionFixture(
      join(userDataDir, "agent"),
      workspacePath,
      1_000,
    );
    await window.evaluate(() => window.piApp?.syncCurrentWorkspace());
    await clickSession(window, fixture.title);
    await expect(window.getByTestId("transcript")).toContainText("Historical context row 999");

    const composer = window.getByTestId("composer");
    await composer.fill(
      "In about 80 short words, explain why bounded queues protect desktop apps. End with the exact token LIVE_STREAM_OK.",
    );
    await composer.press("Enter");
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return state.workspaces
        .flatMap((workspace) => workspace.sessions)
        .find((session) => session.id === fixture.sessionId)?.status;
    }, { timeout: 10_000 }).toBe("running");
    let terminalSession: Awaited<ReturnType<typeof getDesktopState>>["workspaces"][number]["sessions"][number] | undefined;
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      terminalSession = state.workspaces
        .flatMap((workspace) => workspace.sessions)
        .find((session) => session.id === fixture.sessionId);
      return terminalSession?.status;
    }, { timeout: 120_000 }).toMatch(/^(idle|failed)$/);
    expect(terminalSession, JSON.stringify(terminalSession)).toMatchObject({ status: "idle" });
    await expect.poll(async () =>
      (await getSelectedTranscript(window))?.transcript.some((item) =>
        item.kind === "message"
        && item.role === "assistant"
        && item.text.includes("LIVE_STREAM_OK"),
      ) ?? false,
    { timeout: 10_000 }).toBe(true);

    const indexed = await window.evaluate(async (sessionId) =>
      window.piApp?.getUsageDashboard({ window: "90d", sessionId }, true),
    fixture.sessionId);
    expect(indexed?.recordCount).toBeGreaterThanOrEqual(1);
    expect(indexed?.providers).toHaveLength(1);
    expect(indexed?.models).toHaveLength(1);
    expect(indexed?.providers[0]?.turns).toBe(1);
    expect(indexed?.models[0]?.turns).toBe(1);
    expect(indexed?.totals.totalTokens).toBeGreaterThan(0);

    const unchanged = await window.evaluate(async (sessionId) =>
      window.piApp?.getUsageDashboard({ window: "90d", sessionId }, false),
    fixture.sessionId);
    expect(unchanged?.recordCount).toBe(indexed?.recordCount);
    expect(unchanged?.totals.totalTokens).toBe(indexed?.totals.totalTokens);
    expect(unchanged?.unchangedFileCount).toBeGreaterThanOrEqual(1);

    const diagnostics = await getAppDiagnostics(harness);
    expect(diagnostics.currentDriverEventsPending).toBe(0);
    expect(diagnostics.maxDriverEventsPending).toBeLessThanOrEqual(64);
    expect(diagnostics.residentSessionRuntimeCount).toBeLessThanOrEqual(8);
    expect(diagnostics.fullTranscriptCacheEntries).toBeLessThanOrEqual(6);
  } finally {
    await harness.close();
  }
});
