import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("creates and applies a global skill profile from the Skills page", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("skill-profiles-workspace");
  await mkdir(join(workspacePath, ".agents", "skills", "demo-skill"), { recursive: true });
  await writeFile(join(workspacePath, ".agents", "skills", "demo-skill", "SKILL.md"), `# Demo Skill\n\nUse this skill for demo workflows.\n`, "utf8");

  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Skill profile session");
    await window.getByRole("button", { name: "Skills", exact: true }).click();

    await expect(window.getByRole("heading", { name: "Skill profiles" })).toBeVisible();
    await expect(window.getByRole("button", { name: /Demo Skill/i })).toBeVisible();
    await window.getByRole("button", { name: "New profile" }).click();
    await window.getByLabel("Profile name").fill("Demo profile");
    await window.getByRole("button", { name: "Create profile" }).click();
    await expect(window.locator(".skill-profile-manager__eyebrow")).toHaveText("Demo profile");

    await window.getByRole("button", { name: /Demo Skill/i }).click();
    await window.locator(".skill-detail").getByRole("button", { name: "Manual", exact: true }).click();
    await expect(window.locator(".skill-detail__status")).toHaveText("Manual");

    const catalog = await readFile(join(userDataDir, "skill-catalog.json"), "utf8");
    expect(catalog).toContain("Demo profile");
    expect(catalog).toContain("manual");
  } finally {
    await harness.close();
  }
});

test("composer switches global skill profiles from the chatbox", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("skill-profile-composer-workspace");
  const catalogPath = join(userDataDir, "skill-catalog.json");
  await writeFile(catalogPath, JSON.stringify({
    activeProfileId: "default",
    profiles: [
      { id: "default", name: "Default", skills: {} },
      { id: "debug", name: "Debug", description: "Debugging skills", skills: {} },
    ],
  }, null, 2));

  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Skill profile composer session");
    await window.getByRole("button", { name: /Skills profile/i }).click();
    await window.getByRole("button", { name: "Debug" }).click();
    await expect(window.getByRole("button", { name: /Skills profile: Debug/i })).toBeVisible();
    const catalog = await readFile(catalogPath, "utf8");
    expect(catalog).toContain('"activeProfileId": "debug"');
  } finally {
    await harness.close();
  }
});
