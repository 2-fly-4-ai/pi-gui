import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
  waitForWorkspaceByPath,
  type DesktopHarness,
} from "../helpers/electron-app";

async function startSecurityFixtureServer(): Promise<{
  readonly server: Server;
  readonly origin: string;
  readonly targetUrl: string;
  readonly popupUrl: string;
  readonly blankUrl: string;
}> {
  const server = createServer((request, response) => {
    const requestUrl = request.url ?? "/";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head><title>Security Fixture</title></head>
        <body>
          <h1>Security Fixture ${requestUrl}</h1>
          <a id="blank" href="/blank" target="_blank">Open blank</a>
          <button id="popup" onclick="window.open('/popup')">Open popup</button>
        </body>
      </html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    targetUrl: `${origin}/target`,
    popupUrl: `${origin}/popup`,
    blankUrl: `${origin}/blank`,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function stubExternalOpens(harness: DesktopHarness): Promise<void> {
  await harness.electronApp.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { __piExternalUrls?: string[] };
    state.__piExternalUrls = [];
    shell.openExternal = ((url: string) => {
      state.__piExternalUrls?.push(url);
      return Promise.resolve();
    }) as typeof shell.openExternal;
  });
}

async function readExternalOpens(harness: DesktopHarness): Promise<readonly string[]> {
  return harness.electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & { __piExternalUrls?: string[] };
    return state.__piExternalUrls ?? [];
  });
}

async function browserWindowCount(harness: DesktopHarness): Promise<number> {
  return harness.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

async function waitForWebContentsUrl(harness: DesktopHarness, url: string): Promise<void> {
  await expect.poll(
    () => harness.electronApp.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((contents) => contents.getURL()),
    ),
    { timeout: 10_000 },
  ).toContain(url);
}

async function executeInWebContents<T>(
  harness: DesktopHarness,
  urlPrefix: string,
  script: string,
): Promise<T> {
  return harness.electronApp.evaluate(async ({ webContents }, payload) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL().startsWith(payload.urlPrefix));
    if (!contents) {
      throw new Error(`No webContents found for ${payload.urlPrefix}`);
    }
    return await contents.executeJavaScript(payload.script, true) as T;
  }, { urlPrefix, script });
}

test("enforces main-window and webview security policies", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("security-policies-workspace");
  const fixture = await startSecurityFixtureServer();
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    await stubExternalOpens(harness);
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Security policies");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => `Open [security fixture](${fixture.targetUrl}) in the side panel.`,
    });
    await window.getByRole("link", { name: "security fixture" }).click();
    const panel = window.getByTestId("thread-browser-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("browser-panel-webview")).toHaveAttribute("src", fixture.targetUrl);
    await waitForWebContentsUrl(harness, fixture.targetUrl);

    await executeInWebContents<void>(harness, fixture.origin, "window.open('/popup')");
    await expect.poll(() => browserWindowCount(harness)).toBe(1);

    await window.evaluate((blankUrl) => {
      const webview = document.querySelector("[data-testid='browser-panel-webview']");
      if (!webview) {
        throw new Error("Browser webview was unavailable");
      }
      const event = new Event("new-window", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "url", { configurable: true, value: blankUrl });
      webview.dispatchEvent(event);
    }, fixture.blankUrl);
    await expect.poll(() => readExternalOpens(harness)).toContain(fixture.blankUrl);
    await expect.poll(() => browserWindowCount(harness)).toBe(1);

    const notificationPermission = await executeInWebContents<string>(
      harness,
      fixture.origin,
      "Notification.requestPermission()",
    );
    expect(notificationPermission).toBe("denied");

    await window.evaluate((targetUrl) => {
      const webview = document.createElement("webview");
      webview.setAttribute("src", targetUrl);
      webview.setAttribute("nodeintegration", "true");
      webview.setAttribute("preload", "file:///tmp/pi-gui-should-not-load.js");
      document.body.appendChild(webview);
    }, `${fixture.origin}/hardened-webview`);
    await waitForWebContentsUrl(harness, `${fixture.origin}/hardened-webview`);
    const nodeSurface = await executeInWebContents<{ readonly requireType: string; readonly processType: string }>(
      harness,
      `${fixture.origin}/hardened-webview`,
      "({ requireType: typeof require, processType: typeof process })",
    );
    expect(nodeSurface).toEqual({ requireType: "undefined", processType: "undefined" });

    await window.evaluate(() => {
      const webview = document.createElement("webview");
      webview.setAttribute("src", "file:///etc/hosts");
      document.body.appendChild(webview);
    });
    await expect.poll(
      () => harness.electronApp.evaluate(({ webContents }) =>
        webContents.getAllWebContents().map((contents) => contents.getURL()),
      ),
    ).not.toContain("file:///etc/hosts");

    const initialLocation = await window.evaluate(() => location.href);
    await harness.electronApp.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) {
        throw new Error("Main window webContents was unavailable");
      }
      await contents.executeJavaScript("location.href = 'https://example.com/blocked-main-navigation'", true);
      contents.stop();
    });
    await expect.poll(() =>
      harness.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? ""),
    ).toBe(initialLocation);
  } finally {
    await harness.close();
    await closeServer(fixture.server);
  }
});
