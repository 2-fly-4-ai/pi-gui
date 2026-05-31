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
} from "../helpers/electron-app";

async function startFixtureServer(): Promise<{ readonly server: Server; readonly url: string }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<html><head><title>Side Browser Fixture</title></head><body><h1>Loaded ${request.url}</h1></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/target` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("opens transcript links in the side browser panel", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("side-browser-workspace");
  const fixture = await startFixtureServer();
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Side browser links");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => `Open [fixture link](${fixture.url}) in the side panel.`,
    });

    const browserToggle = window.getByRole("button", { name: "Toggle browser" });
    await expect(browserToggle).toBeVisible();
    await browserToggle.click();
    await expect(window.getByTestId("thread-browser-panel")).toBeVisible();
    await window.getByTestId("thread-browser-panel").getByRole("button", { name: "Close browser" }).click();
    await expect(window.getByTestId("thread-browser-panel")).toHaveCount(0);

    await window.getByRole("link", { name: "fixture link" }).click();

    const panel = window.getByTestId("thread-browser-panel");
    await expect(panel).toBeVisible();
    await expect(browserToggle).toHaveClass(/icon-button--active/);
    await expect(panel.getByLabel("Browser address")).toHaveValue(fixture.url);
    await expect(panel.getByTestId("browser-panel-webview")).toHaveAttribute("src", fixture.url);

    await panel.getByRole("button", { name: "Close browser" }).click();
    await expect(window.getByTestId("thread-browser-panel")).toHaveCount(0);
  } finally {
    await harness.close();
    await closeServer(fixture.server);
  }
});
