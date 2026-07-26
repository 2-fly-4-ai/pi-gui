import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("searches safe thread metadata, groups dates, filters, navigates, and keeps archive explicit", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thread-organization");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Alpha completed work");
    await createNamedThread(window, "Beta current work");
    await expect(window.getByText("Today", { exact: true }).first()).toBeVisible();

    const search = window.getByLabel("Search threads");
    await search.fill("Alpha");
    await expect(window.getByTestId("thread-organizer")).toContainText("1 result");
    await expect(window.locator(".session-row").filter({ hasText: "Alpha completed work" })).toHaveCount(1);
    await expect(window.locator(".session-row").filter({ hasText: "Beta current work" })).toHaveCount(0);

    await search.press("Escape");
    const betaRow = window.locator(".session-row").filter({ hasText: "Beta current work" });
    await betaRow.hover();
    await betaRow.getByRole("button", { name: "Thread actions for Beta current work" }).click();
    await betaRow.getByRole("menuitem", { name: "Archive" }).click();

    await search.fill("Beta");
    await expect(window.getByTestId("thread-organizer")).toContainText("0 results");
    await window.getByText("Filters", { exact: true }).click();
    await window.getByText("Archived", { exact: true }).click();
    await expect(window.locator(".session-row").filter({ hasText: "Beta current work" })).toHaveCount(1);

    await window.getByText("Reset", { exact: true }).click();
    await search.fill("Alpha");
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(window.locator(".topbar__session")).toHaveText("Alpha completed work");

    await window.keyboard.press(`${modifier}+K`);
    await window.getByPlaceholder("Search commands…").fill("search threads");
    await window.getByRole("option", { name: /Search threads/ }).click();
    await expect(search).toBeFocused();
  } finally {
    await harness.close();
  }
});
