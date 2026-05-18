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
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

    await expect(window.getByTestId("settings-agents-section")).toBeVisible();
    await expect(window.getByText("Role builder", { exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "New role" })).toBeEnabled();
    await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("general-purpose");
    await expect(window.getByTestId("agent-definition-row-Explore")).toContainText("Explore");
    await expect(window.getByTestId("agent-definition-row-Plan")).toContainText("Plan");

    await window.getByTestId("agent-definition-row-general-purpose").getByRole("button", { name: "Edit" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Edit general-purpose");
    await dialog.getByLabel("System prompt").fill("Use the parent context and complete the delegated task.");
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

test("settings agents page creates a custom subagent with model, tools, prompt, and runtime settings", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-builder-v2-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5", "openai/gpt-4o"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Agent builder session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

    await window.getByRole("button", { name: "New agent" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toHaveAccessibleName("New agent");
    await dialog.getByLabel("Agent name").fill("security-reviewer");
    await dialog.getByLabel("Display name").fill("Security Reviewer");
    await dialog.getByLabel("Description").fill("Reviews code for security-sensitive mistakes");
    await dialog.getByLabel("Scope").selectOption("project");
    await dialog.getByLabel("Model").selectOption("openai:gpt-5");
    await dialog.getByLabel("Reasoning").selectOption("high");
    await dialog.getByLabel("Prompt mode").selectOption("replace");
    await dialog.getByLabel("System prompt").fill("You review code for authentication, authorization, injection, and secret-handling bugs.");
    await dialog.getByLabel("Tool: edit").uncheck();
    await dialog.getByLabel("Tool: write").uncheck();
    await dialog.getByLabel("Extensions").uncheck();
    await dialog.getByLabel("Skills").check();
    await dialog.getByLabel("Max turns").fill("8");
    await dialog.getByLabel("Inherit context").check();
    await dialog.getByLabel("Run in background").check();
    await dialog.getByLabel("Isolated").check();
    await dialog.getByLabel("Isolation").selectOption("worktree");
    await dialog.getByRole("button", { name: "Create agent" }).click();

    const row = window.getByTestId("agent-definition-row-security-reviewer");
    await expect(row).toContainText("Security Reviewer");
    await expect(row).toContainText("Project override");
    await expect(row).toContainText("openai/gpt-5");
    await expect(row).toContainText("High");

    const saved = await readFile(join(workspacePath, ".pi", "agents", "security-reviewer.md"), "utf8");
    expect(saved).toContain("description: \"Reviews code for security-sensitive mistakes\"");
    expect(saved).toContain("display_name: \"Security Reviewer\"");
    expect(saved).toContain("tools: read, bash, grep, find, ls");
    expect(saved).toContain("extensions: false");
    expect(saved).toContain("model: openai/gpt-5");
    expect(saved).toContain("thinking: high");
    expect(saved).toContain("prompt_mode: replace");
    expect(saved).toContain("max_turns: 8");
    expect(saved).toContain("inherit_context: true");
    expect(saved).toContain("run_in_background: true");
    expect(saved).toContain("isolated: true");
    expect(saved).toContain("isolation: \"worktree\"");
    expect(saved).toContain("You review code for authentication");
  } finally {
    await harness.close();
  }
});

test("settings agents page deletes a custom subagent file", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-builder-delete-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });
  await mkdir(join(workspacePath, ".pi", "agents"), { recursive: true });
  await writeFile(
    join(workspacePath, ".pi", "agents", "cleanup-agent.md"),
    `---
description: Deletes safely from the builder test
prompt_mode: replace
---

You are a cleanup test agent.
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
    await createNamedThread(window, "Delete agent session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

    const row = window.getByTestId("agent-definition-row-cleanup-agent");
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click();
    await window.getByRole("button", { name: "Delete agent" }).click();
    await expect(row).toHaveCount(0);
    await expect(readFile(join(workspacePath, ".pi", "agents", "cleanup-agent.md"), "utf8")).rejects.toThrow();
  } finally {
    await harness.close();
  }
});

test("settings agents page duplicates a built-in agent into a custom agent", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-builder-duplicate-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Duplicate agent session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

    await window.getByTestId("agent-definition-row-Explore").getByRole("button", { name: "Duplicate" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toHaveAccessibleName("New agent");
    await dialog.getByLabel("Agent name").fill("explore-local");
    await dialog.getByLabel("Display name").fill("Explore Local");
    await dialog.getByRole("button", { name: "Create agent" }).click();

    await expect(window.getByTestId("agent-definition-row-explore-local")).toContainText("Explore Local");
    const saved = await readFile(join(agentDir, "agents", "explore-local.md"), "utf8");
    expect(saved).toContain("Fast codebase exploration agent");
    expect(saved).toContain("# CRITICAL: READ-ONLY MODE");
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
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

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
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

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

test("settings models points subagent model selection to Subagents", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-models-link-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Models link session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.getByText("Subagent models", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Configure subagents" }).click();
    await expect(window.getByRole("heading", { name: "Subagents" })).toBeVisible();
    await expect(window.getByTestId("settings-agents-section")).toBeVisible();
  } finally {
    await harness.close();
  }
});
