import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, toggleTopbarPanel } from "../helpers/electron-app";

test("loopback remote prototype is disabled by default", async () => {
  const userDataDir = await makeUserDataDir();
  const workspace = await makeWorkspace("remote-disabled-workspace");
  const app = await launchDesktop(userDataDir, { initialWorkspaces: [workspace], testMode: "background" });
  try {
    const page = await app.firstWindow();
    await toggleTopbarPanel(page, "App logs");
    await page.getByRole("tab", { name: "Remote spike" }).click();
    const panel = page.getByTestId("loopback-remote-diagnostics");
    await expect(panel).toContainText("Disabled by default");
    await expect(panel.getByRole("button", { name: "Launch prototype" })).toBeDisabled();
  } finally { await app.close(); }
});

test("loopback remote prototype launches, probes, rejects traversal, reconnects, and shuts down", async () => {
  const userDataDir = await makeUserDataDir();
  const workspace = await makeWorkspace("remote-enabled-workspace");
  const app = await launchDesktop(userDataDir, { initialWorkspaces: [workspace], testMode: "background", envOverrides: { PI_APP_EXPERIMENTAL_REMOTE_EXECUTION: "1" } });
  let helperPid: number | undefined;
  try {
    const page = await app.firstWindow();
    await toggleTopbarPanel(page, "App logs");
    await page.getByRole("tab", { name: "Remote spike" }).click();
    const panel = page.getByTestId("loopback-remote-diagnostics");
    await panel.getByRole("button", { name: "Launch prototype" }).click();
    await expect(panel.locator(".remote-spike-status")).toHaveText("connected");
    helperPid = await page.evaluate(() => window.piApp.getLoopbackRemoteSnapshot().then((snapshot) => snapshot.pid));
    expect(helperPid).toBeGreaterThan(0);
    await panel.getByRole("button", { name: "Run read-only probe" }).click();
    await expect(panel).toContainText("Probe healthy");
    await expect(panel).toContainText("README.md");

    const transportProof = await app.electronApp.evaluate(async () => {
      const hooks = (globalThis as { __PI_APP_TEST_HOOKS?: { testLoopbackCancellation?: () => Promise<string>; testLoopbackTimeout?: () => Promise<string> } }).__PI_APP_TEST_HOOKS;
      return { cancelled: await hooks?.testLoopbackCancellation?.(), timedOut: await hooks?.testLoopbackTimeout?.() };
    });
    expect(transportProof.cancelled).toMatch(/cancelled/i);
    expect(transportProof.timedOut).toMatch(/timed out/i);
    await expect.poll(() => page.evaluate(() => window.piApp.probeLoopbackRemote(".").then(() => true))).toBe(true);

    await panel.getByLabel("Relative probe path").fill("../");
    await panel.getByRole("button", { name: "Run read-only probe" }).click();
    await expect(panel.locator(".logs-panel__error")).toContainText("escapes");
    const before = await page.evaluate(() => window.piApp.getLoopbackRemoteSnapshot());
    await app.electronApp.evaluate(() => (globalThis as { __PI_APP_TEST_HOOKS?: { crashLoopbackRemote?: () => void } }).__PI_APP_TEST_HOOKS?.crashLoopbackRemote?.());
    await expect.poll(() => page.evaluate(() => window.piApp.getLoopbackRemoteSnapshot().then((snapshot) => snapshot.status))).toBe("disconnected");
    await page.getByLabel("Refresh logs").click();
    await expect(panel.locator(".remote-spike-status")).toHaveText("disconnected");
    await panel.getByRole("button", { name: "Launch prototype" }).click();
    await expect(panel.locator(".remote-spike-status")).toHaveText("connected");
    const after = await page.evaluate(() => window.piApp.getLoopbackRemoteSnapshot());
    expect(after.generation).toBe(before.generation + 1);
    expect(after.pid).not.toBe(before.pid);
    helperPid = after.pid;

    await panel.getByRole("button", { name: "Shut down" }).click();
    await expect(panel.locator(".remote-spike-status")).toHaveText("stopped");
    if (helperPid) await expect.poll(() => processExists(helperPid!)).toBe(false);
  } finally { await app.close(); }
});

test("loopback remote helper is terminated with the app and relaunch starts without persisted connection state", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspace = await makeWorkspace("remote-restart-workspace");
  let app = await launchDesktop(userDataDir, { initialWorkspaces: [workspace], testMode: "background", envOverrides: { PI_APP_EXPERIMENTAL_REMOTE_EXECUTION: "1" } });
  let helperPid = 0;
  try {
    let page = await app.firstWindow();
    await toggleTopbarPanel(page, "App logs");
    await page.getByRole("tab", { name: "Remote spike" }).click();
    const panel = page.getByTestId("loopback-remote-diagnostics");
    await panel.getByRole("button", { name: "Launch prototype" }).click();
    await expect(panel.locator(".remote-spike-status")).toHaveText("connected");
    helperPid = (await page.evaluate(() => window.piApp.getLoopbackRemoteSnapshot())).pid ?? 0;
    expect(helperPid).toBeGreaterThan(0);

    await app.close();
    await expect.poll(() => processExists(helperPid), { timeout: 5_000 }).toBe(false);

    app = await launchDesktop(userDataDir, { initialWorkspaces: [workspace], testMode: "background", envOverrides: { PI_APP_EXPERIMENTAL_REMOTE_EXECUTION: "1" } });
    page = await app.firstWindow();
    const snapshot = await page.evaluate(() => window.piApp.getLoopbackRemoteSnapshot());
    expect(snapshot).toMatchObject({ status: "stopped", generation: 0 });
    expect(snapshot.pid).toBeUndefined();
    expect(snapshot.connectedAt).toBeUndefined();
  } finally { await app.close().catch(() => undefined); }
});

function processExists(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
