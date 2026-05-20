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
    await expect(window.getByTestId("agent-definition-row-delegate")).toContainText("Delegate");
    await expect(window.getByTestId("agent-definition-row-scout")).toContainText("Scout");
    await expect(window.getByTestId("agent-definition-row-planner")).toContainText("Planner");
    await expect(window.getByTestId("agent-definition-row-worker")).toContainText("Worker");
    await expect(window.getByTestId("agent-definition-row-reviewer")).toContainText("Reviewer");
    await expect(window.getByTestId("agent-definition-row-oracle")).toContainText("Oracle");
    await expect(window.getByTestId("agent-definition-row-researcher")).toContainText("Researcher");
    await expect(window.getByTestId("agent-definition-row-context-builder")).toContainText("Context Builder");
    await expect(window.getByTestId("agent-definition-row-stream-shadow")).toContainText("Nagarekage");
    await expect(window.getByTestId("agent-definition-row-general-purpose")).toHaveCount(0);
    await expect(window.getByTestId("agent-definition-row-Explore")).toHaveCount(0);
    await expect(window.getByTestId("agent-definition-row-Plan")).toHaveCount(0);

    await window.getByTestId("agent-definition-row-delegate").getByRole("button", { name: "Edit" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Edit delegate");
    await dialog.getByLabel("System prompt", { exact: true }).fill("Use the parent context and complete the delegated task.");
    await dialog.getByLabel("Model", { exact: true }).selectOption("openai:gpt-5");
    await dialog.getByLabel("Reasoning").selectOption("medium");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(window.getByTestId("agent-definition-row-delegate")).toContainText("openai/gpt-5");
    await expect(window.getByTestId("agent-definition-row-delegate")).toContainText("Medium");

    const saved = await readFile(join(agentDir, "agents", "delegate.md"), "utf8");
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

    await window.getByRole("button", { name: "New role" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toHaveAccessibleName("New role");
    await dialog.getByLabel("Role name").fill("security-reviewer");
    await dialog.getByLabel("Display name").fill("Security Reviewer");
    await dialog.getByLabel("Description").fill("Reviews code for security-sensitive mistakes");
    await dialog.getByLabel("Scope").selectOption("project");
    await dialog.getByLabel("Model", { exact: true }).selectOption("openai:gpt-5");
    await dialog.getByLabel("Reasoning").selectOption("high");
    await dialog.getByLabel("Prompt mode", { exact: true }).selectOption("replace");
    await dialog.getByLabel("System prompt", { exact: true }).fill("You review code for authentication, authorization, injection, and secret-handling bugs.");
    await dialog.getByLabel("Tool: edit").uncheck();
    await dialog.getByLabel("Tool: write").uncheck();
    await dialog.getByLabel("Extensions").uncheck();
    await dialog.getByLabel("Skills").check();
    await dialog.getByLabel("Max turns").fill("8");
    await dialog.getByLabel("Inherit context").check();
    await dialog.getByLabel("Run in background").check();
    await dialog.getByLabel("Isolated").check();
    await dialog.getByLabel("Isolation").selectOption("worktree");
    await dialog.getByRole("button", { name: "Create role" }).click();

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
    await window.getByRole("button", { name: "Delete role" }).click();
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

    await window.getByTestId("agent-definition-row-scout").getByRole("button", { name: "Duplicate" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toHaveAccessibleName("New role");
    await dialog.getByLabel("Role name").fill("explore-local");
    await dialog.getByLabel("Display name").fill("Explore Local");
    await dialog.getByRole("button", { name: "Create role" }).click();

    await expect(window.getByTestId("agent-definition-row-explore-local")).toContainText("Explore Local");
    const saved = await readFile(join(agentDir, "agents", "explore-local.md"), "utf8");
    expect(saved).toContain("Fast read-only codebase reconnaissance");
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
    join(agentDir, "agents", "scout.md"),
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

    const row = window.getByTestId("agent-definition-row-scout");
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
    join(agentDir, "agents", "planner.md"),
    `---
description: Global Planner override
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
    join(workspacePath, ".pi", "agents", "planner.md"),
    `---
description: Project Planner override
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

    const row = window.getByTestId("agent-definition-row-planner");
    await expect(row).toContainText("Project override");
    await expect(row).toContainText("openai/gpt-5");
    await row.getByRole("button", { name: "Reset" }).click();
    await expect(row).toContainText("Global override");
    await expect(row).toContainText("openai/gpt-4o");

    await rm(join(agentDir, "agents", "planner.md"));
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

test("settings subagents preserves unknown frontmatter while saving nico-lite fields", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("subagent-frontmatter-preserve-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await writeFile(
    join(agentDir, "agents", "legacy-rich.md"),
    `---
description: Rich imported agent
role: reviewer
system_prompt_mode: replace
context_mode: project
inherit_project_context: false
default_reads: README.md, AGENTS.md
default_progress: summary
default_context: repo-map
unknown_flag: true
unknown_number: 7
unknown_list: scout, planner
unknown_nested:
  - scout
  - planner
fallback_models: openai/gpt-5, anthropic/claude-sonnet-4-5
max_subagent_depth: 2
---

Review imported plans.
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
    await createNamedThread(window, "Frontmatter preserve session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

    const row = window.getByTestId("agent-definition-row-legacy-rich");
    await expect(row).toContainText("Role: reviewer");
    await expect(row).toContainText("Context: project");
    await expect(row).toContainText("Progress: summary");
    await expect(row).toContainText("Max depth: 2");
    await row.getByRole("button", { name: "Edit" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await dialog.getByLabel("Description").fill("Rich imported reviewer");
    await dialog.getByLabel("System prompt mode").selectOption("append");
    await dialog.getByLabel("Output").selectOption("both");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("Output: both");

    const saved = await readFile(join(agentDir, "agents", "legacy-rich.md"), "utf8");
    expect(saved).toContain('description: "Rich imported reviewer"');
    expect(saved).toContain("role: reviewer");
    expect(saved).toContain("system_prompt_mode: append");
    expect(saved).toContain("context_mode: project");
    expect(saved).toContain("inherit_project_context: false");
    expect(saved).toContain("default_reads: README.md, AGENTS.md");
    expect(saved).toContain("default_progress: summary");
    expect(saved).toContain("output: both");
    expect(saved).toContain("default_context: repo-map");
    expect(saved).toContain("unknown_flag: true");
    expect(saved).toContain("unknown_number: 7");
    expect(saved).toContain("unknown_list: scout, planner");
    expect(saved).toContain("unknown_nested:\n  - scout\n  - planner");
    expect(saved).toContain("fallback_models: openai/gpt-5, anthropic/claude-sonnet-4-5");
    expect(saved).toContain("max_subagent_depth: 2");
  } finally {
    await harness.close();
  }
});

test("settings subagents warns instead of partially parsing invalid max subagent depth", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("subagent-invalid-depth-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await writeFile(
    join(agentDir, "agents", "invalid-depth.md"),
    `---
description: Invalid depth imported agent
role: reviewer
max_subagent_depth: 2abc
---

This file should not partially parse.
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
    await createNamedThread(window, "Invalid depth session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Subagents", exact: true }).click();

    const row = window.getByTestId("agent-definition-row-invalid-depth");
    await expect(row).toContainText("Invalid max_subagent_depth frontmatter value");
    await expect(row).not.toContainText("Max depth: 2");
  } finally {
    await harness.close();
  }
});

test("settings subagents submits a built-in workflow and shows a run record", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("subagent-workflow-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Workflow target session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Subagents", exact: true }).click();
    await window.getByRole("tab", { name: "Workflows" }).click();

    const card = window.getByTestId("subagent-workflow-scout-then-plan");
    await expect(card).toContainText("Scout then plan");
    await card.getByRole("button", { name: "Run workflow" }).click();

    await window.getByRole("tab", { name: "Runs" }).click();
    const run = window.getByTestId("subagent-run-row").first();
    await expect(run).toContainText("Scout then plan");
    await expect(run).toContainText("submitted");
    await expect(run).toContainText("scout → planner");
    await expect(run.getByRole("button", { name: "Open transcript" })).toBeVisible();

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("subagent-timeline-card")).toContainText("Scout then plan");
  } finally {
    await harness.close();
  }
});
