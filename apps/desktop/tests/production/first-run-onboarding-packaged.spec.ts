import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
} from "../helpers/electron-app";

test("packaged app guides a clean profile from provider setup into a first session", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir("pi-gui-packaged-first-run-user-data-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("packaged-first-run-onboarding-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });
  const harness = await launchPackagedDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const guide = window.getByTestId("first-run-onboarding");
    await expect(guide).toContainText("First run setup");
    await guide.getByRole("button", { name: "Use starter prompt" }).click();
    await expect(window.getByTestId("new-thread-composer")).toHaveValue(
      "Inspect this repo and suggest the first useful improvement.",
    );

    await guide.getByRole("button", { name: "Connect provider" }).click();
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const allProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "All providers" }),
    });
    await allProviders.locator(".settings-disclosure__summary").click();
    const openAiRow = allProviders.locator(".settings-row", {
      has: window.locator(".settings-row__title", { hasText: /^openai$/ }),
    });
    await openAiRow.getByRole("button", { name: "Set API key" }).click();
    const dialog = window.getByTestId("provider-api-key-dialog");
    await dialog.getByLabel("openai API key").fill("test-openai-key");
    await dialog.getByRole("button", { name: "Set API key" }).click();
    await expect(dialog).toHaveCount(0);

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("new-thread-composer")).toHaveValue(
      "Inspect this repo and suggest the first useful improvement.",
    );

    const modelBadge = window.locator(".new-thread .model-selector__badge").first();
    await expect(modelBadge).toHaveText("Pick a model");
    await modelBadge.click();
    await window.locator(".new-thread .model-selector__dropdown").first().getByRole("button", { name: /GPT-5/ }).first().click();
    await expect(window.getByRole("button", { name: "Start thread" })).toBeEnabled();
    await window.getByRole("button", { name: "Start thread" }).click();
    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
  } finally {
    await harness.close();
  }
});
