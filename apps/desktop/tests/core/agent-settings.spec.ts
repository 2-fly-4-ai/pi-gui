import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

test("settings agents page saves built-in subagent model overrides", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-settings-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5", "openai/gpt-4o"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Agent settings session");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Agents", exact: true }).click();

    await expect(window.getByTestId("settings-agents-section")).toBeVisible();
    await expect(window.getByText("Custom agent builder", { exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "New agent" })).toBeDisabled();
    await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("general-purpose");
    await expect(window.getByTestId("agent-definition-row-Explore")).toContainText("Explore");
    await expect(window.getByTestId("agent-definition-row-Plan")).toContainText("Plan");

    await window.getByTestId("agent-definition-row-general-purpose").getByRole("button", { name: "Edit" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Edit general-purpose");
    await dialog.getByText("Definition details").click();
    await expect(dialog.locator("textarea[readonly]")).toBeVisible();
    await dialog.getByLabel("Model").selectOption("openai:gpt-5");
    await dialog.getByLabel("Reasoning").selectOption("medium");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("openai/gpt-5");
    await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("Medium");

    const saved = await readFile(join(agentDir, "agents", "general-purpose.md"), "utf8");
    expect(saved).toContain("model: openai/gpt-5");
    expect(saved).toContain("thinking: medium");
    expect(saved).toContain("prompt_mode: append");
  } finally {
    await harness.close();
  }
});

test("settings agents page warns for unavailable configured models and resets overrides", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-settings-warning-workspace");
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await writeFile(
    join(agentDir, "agents", "Explore.md"),
    `---
description: Fast codebase exploration agent (read-only)
tools: read, bash, grep, find, ls
model: unavailable-provider/unavailable-model
thinking: low
prompt_mode: replace
---

# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Agent warning session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Agents", exact: true }).click();

    const row = window.getByTestId("agent-definition-row-Explore");
    await expect(row).toContainText("unavailable-provider/unavailable-model");
    await expect(row).toContainText("Configured model is not currently available");
    await row.getByRole("button", { name: "Reset" }).click();
    await expect(row).toContainText("Built-in");
    await expect(row).toContainText("Inherit current thread");
  } finally {
    await harness.close();
  }
});


test("settings agents page uses project overrides before global overrides", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-settings-project-override-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5", "openai/gpt-4o"] });
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await mkdir(join(workspacePath, ".pi", "agents"), { recursive: true });
  await writeFile(
    join(agentDir, "agents", "Plan.md"),
    `---
description: Global Plan override
tools: read, bash, grep, find, ls
model: openai/gpt-4o
thinking: low
prompt_mode: replace
max_turns: 4
run_in_background: true
---

# Global plan prompt
`,
    "utf8",
  );
  await writeFile(
    join(workspacePath, ".pi", "agents", "Plan.md"),
    `---
description: Project Plan override
tools: read, bash, grep, find, ls
model: openai/gpt-5
thinking: high
prompt_mode: replace
max_turns: 7
inherit_context: false
isolated: true
isolation: "worktree"
---

# Project plan prompt
`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Agent project override session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Agents", exact: true }).click();

    const row = window.getByTestId("agent-definition-row-Plan");
    await expect(row).toContainText("Project override");
    await expect(row).toContainText("openai/gpt-5");
    await row.getByRole("button", { name: "Reset" }).click();
    await expect(row).toContainText("Global override");
    await expect(row).toContainText("openai/gpt-4o");

    await rm(join(agentDir, "agents", "Plan.md"));
  } finally {
    await harness.close();
  }
});
