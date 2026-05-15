import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("shows skills and settings surfaces from runtime data", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("skills-settings-workspace");
  await mkdir(join(workspacePath, ".agents", "skills", "demo-skill"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "demo-skill", "SKILL.md"),
    `# Demo Skill

Use this skill when the user wants a short demo workflow.

## Workflow

1. Inspect the repo.
2. Summarize what changed.
`,
    "utf8",
  );
  await mkdir(join(workspacePath, ".agents", "skills", "frontend-design"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "frontend-design", "SKILL.md"),
    `# Frontend Design

Use this skill when the user wants to design a frontend interface.
`,
    "utf8",
  );
  await mkdir(join(workspacePath, ".agents", "skills", "cloudflare-workers"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "cloudflare-workers", "SKILL.md"),
    `# Cloudflare Workers

Use this skill when building Cloudflare Workers, KV, R2, or Wrangler projects.
`,
    "utf8",
  );
  await mkdir(join(workspacePath, ".agents", "skills", "pi-extension-authoring"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "pi-extension-authoring", "SKILL.md"),
    `# Pi Extension Authoring

Use this skill when building Pi extensions, commands, tools, packages, or SDK integrations.
`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Skill test session");

    await window.getByRole("button", { name: "Skills", exact: true }).click();
    await expect(window.locator(".skills-view")).toBeVisible();
    await expect(window.getByTestId("skills-list")).toContainText("Demo Skill");
    await expect(window.getByLabel("Search skills")).toHaveAttribute("placeholder", "Search by name, tag, source, or slash command");
    await expect(window.locator(".skills-toolbar__meta")).toContainText("4 of 4 skills");
    await window.getByRole("button", { name: "Frontend", exact: true }).click();
    await expect(window.getByTestId("skills-list")).toContainText("Frontend Design");
    await expect(window.getByTestId("skills-list")).not.toContainText("Demo Skill");
    await window.getByRole("button", { name: "Cloudflare", exact: true }).click();
    await expect(window.getByTestId("skills-list")).toContainText("Cloudflare Workers");
    await expect(window.getByTestId("skills-list")).not.toContainText("Pi Extension Authoring");
    await window.getByRole("button", { name: "Pi dev", exact: true }).click();
    await expect(window.getByTestId("skills-list")).toContainText("Pi Extension Authoring");
    await expect(window.getByTestId("skills-list")).not.toContainText("Cloudflare Workers");
    await window.getByRole("button", { name: "All", exact: true }).click();
    await window.getByLabel("Search skills").fill("demo");
    await expect(window.getByTestId("skills-list")).toContainText("Demo Skill");
    await expect(window.getByTestId("skills-list")).not.toContainText("Frontend Design");
    await window.getByRole("button", { name: "Clear skill search" }).click();
    const listWidthBeforeSelection = (await window.getByTestId("skills-list").boundingBox())?.width ?? 0;
    await window.getByRole("button", { name: /Demo Skill/i }).click();
    const listWidthAfterSelection = (await window.getByTestId("skills-list").boundingBox())?.width ?? 0;
    expect(Math.abs(listWidthAfterSelection - listWidthBeforeSelection)).toBeLessThan(20);
    await expect(window.locator(".skill-detail")).toContainText("/skill:demo-skill");
    await expect(window.locator(".skill-detail")).toContainText("Workflow");
    await expect(window.locator(".skill-detail")).toContainText("Used 0 times");
    await expect(window.locator(".skill-detail")).toContainText("Never used");
    await expect(window.locator(".skill-detail")).toContainText("Use");
    await expect(window.locator(".skill-detail")).toContainText("Auto");
    await window.locator(".skill-detail").getByRole("button", { name: "Manual", exact: true }).click();
    await expect(window.locator(".skill-detail__status")).toHaveText("Manual");
    await expect(window.locator(".skill-detail")).toContainText("Slash only");
    await window.locator(".skill-detail").getByRole("button", { name: "Auto", exact: true }).click();
    await expect(window.locator(".skill-detail__status")).toHaveText("Auto");

    await window.getByRole("button", { name: "Try skill", exact: true }).click();
    await expect(window.getByRole("button", { name: "Threads", exact: true })).toBeVisible();
    await expect(window.getByTestId("composer")).toHaveValue("/skill:demo-skill ");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.locator(".settings-view")).toBeVisible();
    await expect(window.getByText("Notifications", { exact: true })).toBeVisible();
    await expect(window.locator(".settings-view")).toContainText("Enable skill slash commands");
    const skillCommandsToggle = window.getByRole("checkbox", { name: "Enable skill slash commands" });
    await expect(skillCommandsToggle).toBeChecked();
    await skillCommandsToggle.click();

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    const composer = window.getByTestId("composer");
    await composer.fill("/skill");
    await expect(window.getByTestId("slash-menu")).toHaveCount(0);

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(skillCommandsToggle).not.toBeChecked();
    await skillCommandsToggle.click();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await composer.fill("/skill");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toContainText("Runtime Commands");
    await expect(slashMenu).toContainText("Demo Skill");
  } finally {
    await harness.close();
  }
});

test("matches skill slash commands by skill name aliases", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("skills-alias-workspace");
  await mkdir(join(workspacePath, ".agents", "skills", "plan-loop"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "plan-loop", "SKILL.md"),
    `# Plan Loop

Use this skill for complex or high-risk implementation work that needs plan-first execution.
`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Skill alias session");

    const composer = window.getByTestId("composer");
    const slashMenu = window.getByTestId("slash-menu");

    await composer.fill("/plan");
    await expect(slashMenu).toContainText("Plan Loop");
    await expect(slashMenu).toContainText("/skill:plan-loop");

    await composer.fill("/plan-loop");
    await expect(slashMenu).toContainText("Plan Loop");

    await composer.fill("/skill:plan-loop");
    await expect(slashMenu).toContainText("Plan Loop");
  } finally {
    await harness.close();
  }
});
