# Global Skill Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing workspace-scoped skill-management mental model with global reusable skill profiles that users can select from the chatbox and manage from the Skills page.

**Architecture:** Keep skill discovery workspace-aware because Pi itself discovers project/global/package skills from the current cwd, but move user intent into global profile presets stored in the existing desktop skill catalog file. A profile stores per-skill mode overrides (`auto`, `manual`, `off`) by stable skill identity, the active profile is global desktop state, and the runtime resource loader applies that profile to every workspace/session. The Skills page becomes a global profile editor over the currently visible discovered skill library, while the composer gets a compact profile selector so users can switch skill sets without copying skills into projects.

**Tech Stack:** TypeScript, React, Electron IPC/preload, existing `SkillCatalogStore`, Pi runtime resource loader `skillsOverride`, Playwright core tests, localStorage only for legacy usage counts.

---

## Product Semantics

- Profiles are **global**, not per-project.
- The workspace dropdown on Skills should stop implying skills are scoped to a workspace. It can remain only as a discovery-context selector labelled “Discovery workspace” because project-local skills still exist in Pi and only appear when that workspace is selected.
- A profile is a named set of skill mode overrides:
  - `auto`: skill is available to model and slash command.
  - `manual`: skill is slash-only (`disable-model-invocation`).
  - `off`: skill is removed from runtime discovery.
- The active profile applies to all desktop runtime snapshots and new/existing sessions after refresh/reload.
- Selecting a profile from the chatbox updates the active profile and refreshes current runtime.
- Existing individual Auto / Manual / Off controls edit the selected profile, not a hidden workspace-scoped override.
- There should be a built-in `Default` profile if no profile exists.
- Usage counters should be relabelled to avoid pretending they count all real Pi skill usage. Use “Slash uses” or “Desktop slash uses”.

## File Structure

### Skill catalog profile support

Modify `packages/pi-sdk-driver/src/skill-catalog.ts`:
- Add `SkillProfileRecord`, `SkillProfileSkillRef`, `activeProfileId`, and `profiles` to `SkillCatalogFile`.
- Add methods:
  - `getProfiles()`
  - `getActiveProfileId()`
  - `setActiveProfile(profileId)`
  - `saveProfile(profile)`
  - `deleteProfile(profileId)`
  - `setSkillModeInActiveProfile(skill, mode)`
- Update `modeForSkill` so active profile mode wins over user/default entry mode.
- Preserve legacy `skills`, `bySource`, `byPath` behavior for metadata and fallback mode.

Modify runtime types:
- `packages/session-driver/src/runtime-types.ts`
- `packages/pi-sdk-driver/src/runtime-types.ts` if mirrored
- `packages/pi-sdk-driver/src/vendor/session-driver.d.ts`

Add profile snapshot fields and resource driver methods.

Modify `packages/pi-sdk-driver/src/runtime-supervisor.ts`:
- Include profile snapshot in `RuntimeSnapshot`.
- Add profile methods to runtime supervisor.
- Make `setSkillMode` write to active profile.

### Desktop IPC/state

Modify:
- `apps/desktop/src/ipc.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/app-store.ts` or appropriate store pass-through if needed

Expose narrow APIs:
- `setActiveSkillProfile(workspaceId, profileId): Promise<DesktopAppState>`
- `saveSkillProfile(workspaceId, profile): Promise<DesktopAppState>`
- `deleteSkillProfile(workspaceId, profileId): Promise<DesktopAppState>`

### UI

Create `apps/desktop/src/skill-profile-selector.tsx`:
- Composer control button/dropdown for active profile.
- Lists profiles and opens Skills page for management.

Modify:
- `apps/desktop/src/composer-control-bar.tsx`
- `apps/desktop/src/composer-panel.tsx`
- `apps/desktop/src/new-thread-view.tsx` if new-thread composer has same controls
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/skills-view.tsx`
- `apps/desktop/src/styles/main.css`

Skills page changes:
- Rename workspace picker label to “Discovery workspace”.
- Add profile header: active profile, create, duplicate, rename, delete.
- Individual skill mode controls edit active profile.
- Add copy explaining project skills are discovered from selected workspace but profiles are global.
- Rename usage label to “Slash uses”.

### Tests

Modify/create:
- `apps/desktop/tests/core/skills-settings.spec.ts`
- `apps/desktop/tests/core/skill-profiles.spec.ts`
- Existing composer controls spec if needed.

---

## Task 1: Add profile-aware catalog model

**Files:**
- Modify: `packages/pi-sdk-driver/src/skill-catalog.ts`
- Modify: `packages/session-driver/src/runtime-types.ts`
- Modify: `packages/pi-sdk-driver/src/runtime-types.ts`
- Modify: `packages/pi-sdk-driver/src/vendor/session-driver.d.ts`
- Test: typecheck in package

- [ ] **Step 1: Add failing focused test if package has test harness**

If no package test harness exists, skip to Step 2 and rely on TypeScript plus desktop E2E. Do not create a new test framework just for this.

- [ ] **Step 2: Extend catalog types**

In `packages/pi-sdk-driver/src/skill-catalog.ts`, add:

```ts
export interface SkillProfileRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly skills: Readonly<Record<string, SkillInvocationMode>>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}
```

Extend `SkillCatalogFile`:

```ts
readonly activeProfileId?: string;
readonly profiles?: readonly SkillProfileRecord[];
```

Add a default profile constant:

```ts
const DEFAULT_SKILL_PROFILE: SkillProfileRecord = {
  id: "default",
  name: "Default",
  description: "Use the default skill modes from Pi and the local catalog.",
  skills: {},
};
```

- [ ] **Step 3: Add stable skill identity helper**

Add:

```ts
function skillProfileKey(skill: Pick<Skill, "name" | "filePath"> & { readonly source?: string }): string {
  if (skill.source) return `${skill.source}:${skill.name}`;
  return resolve(skill.filePath);
}
```

This lets package/global skills survive path changes better when a source is available, while project/local path-only skills still work.

- [ ] **Step 4: Add profile methods**

Add methods to `SkillCatalogStore`:

```ts
getProfiles(): readonly SkillProfileRecord[] {
  const userProfiles = this.cachedUserCatalog?.profiles ?? [];
  return ensureDefaultProfile(userProfiles);
}

getActiveProfileId(): string {
  const active = this.cachedUserCatalog?.activeProfileId;
  return this.getProfiles().some((profile) => profile.id === active) ? active! : DEFAULT_SKILL_PROFILE.id;
}

getActiveProfile(): SkillProfileRecord {
  const activeId = this.getActiveProfileId();
  return this.getProfiles().find((profile) => profile.id === activeId) ?? DEFAULT_SKILL_PROFILE;
}

async setActiveProfile(profileId: string): Promise<void> { ... }
async saveProfile(profile: SkillProfileRecord): Promise<void> { ... }
async deleteProfile(profileId: string): Promise<void> { ... }
async setSkillModeInActiveProfile(skill: Pick<Skill, "name" | "filePath"> & { readonly source?: string }, mode: SkillInvocationMode): Promise<void> { ... }
```

Implementation rules:
- `setActiveProfile` throws if the profile does not exist.
- `saveProfile` validates id with `/^[a-z0-9][a-z0-9._-]*$/`.
- `deleteProfile("default")` throws.
- Deleting the active profile resets active profile to `default`.
- `setSkillModeInActiveProfile` creates a real user profile entry for `default` if needed, then writes the skill key.

- [ ] **Step 5: Update modeForSkill**

Change `modeForSkill` order:

1. Active profile mode by `skillProfileKey`.
2. Legacy catalog entry mode from `getEntry`.
3. Skill frontmatter `disableModelInvocation`.
4. `auto`.

- [ ] **Step 6: Preserve profile fields in normalize/read/write**

Update `normalizeCatalogFile` so valid profiles and active profile survive reload.

- [ ] **Step 7: Update runtime snapshot types**

Add to `RuntimeSnapshot`:

```ts
readonly skillProfiles: readonly RuntimeSkillProfileRecord[];
readonly activeSkillProfileId: string;
```

Add type:

```ts
export interface RuntimeSkillProfileRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly skills: Readonly<Record<string, RuntimeSkillMode>>;
}
```

Add resource driver methods:

```ts
setActiveSkillProfile(workspace: WorkspaceRef, profileId: string): Promise<RuntimeSnapshot>;
saveSkillProfile(workspace: WorkspaceRef, profile: RuntimeSkillProfileRecord): Promise<RuntimeSnapshot>;
deleteSkillProfile(workspace: WorkspaceRef, profileId: string): Promise<RuntimeSnapshot>;
```

- [ ] **Step 8: Typecheck packages**

Run:

```bash
pnpm --filter @pi-gui/pi-sdk-driver build
pnpm --filter @pi-gui/session-driver build
```

Expected: PASS.

- [ ] **Step 9: Commit profile catalog model**

```bash
git add packages/pi-sdk-driver/src/skill-catalog.ts packages/session-driver/src/runtime-types.ts packages/pi-sdk-driver/src/runtime-types.ts packages/pi-sdk-driver/src/vendor/session-driver.d.ts
git commit -m "Add skill profile catalog model"
```

---

## Task 2: Wire skill profile runtime and IPC

**Files:**
- Modify: `packages/pi-sdk-driver/src/runtime-supervisor.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: app store/runtime plumbing as needed

- [ ] **Step 1: Add RuntimeSupervisor profile methods**

In `packages/pi-sdk-driver/src/runtime-supervisor.ts`, update `buildSnapshot` to include:

```ts
skillProfiles: this.skillCatalog.getProfiles(),
activeSkillProfileId: this.skillCatalog.getActiveProfileId(),
```

Add methods:

```ts
async setActiveSkillProfile(workspace: WorkspaceRef, profileId: string): Promise<RuntimeSnapshot> {
  const context = await this.ensureContext(workspace);
  await this.skillCatalog.setActiveProfile(profileId);
  await this.skillCatalog.reload();
  await context.resourceLoader.reload();
  return this.buildSnapshot(context);
}

async saveSkillProfile(workspace: WorkspaceRef, profile: RuntimeSkillProfileRecord): Promise<RuntimeSnapshot> { ... }
async deleteSkillProfile(workspace: WorkspaceRef, profileId: string): Promise<RuntimeSnapshot> { ... }
```

Update existing `setSkillMode` to call `setSkillModeInActiveProfile` instead of legacy `setSkillMode`.

- [ ] **Step 2: Add IPC methods**

Add desktop API methods:

```ts
setActiveSkillProfile(workspaceId: string, profileId: string): Promise<DesktopAppState>;
saveSkillProfile(workspaceId: string, profile: RuntimeSkillProfileRecord): Promise<DesktopAppState>;
deleteSkillProfile(workspaceId: string, profileId: string): Promise<DesktopAppState>;
```

Wire through preload and main to the existing app store runtime update pattern used by `setSkillMode`.

- [ ] **Step 3: Typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit runtime and IPC wiring**

```bash
git add packages/pi-sdk-driver/src/runtime-supervisor.ts apps/desktop/src/ipc.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts apps/desktop/electron/app-store*.ts
git commit -m "Wire global skill profiles through runtime"
```

---

## Task 3: Add Skills page profile management

**Files:**
- Modify: `apps/desktop/src/skills-view.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/skill-profiles.spec.ts`

- [ ] **Step 1: Create failing Playwright test**

Create `apps/desktop/tests/core/skill-profiles.spec.ts`:

```ts
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

    await expect(window.getByText("Discovery workspace", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "New profile" }).click();
    await window.getByLabel("Profile name").fill("Demo profile");
    await window.getByRole("button", { name: "Create profile" }).click();
    await expect(window.getByText("Active profile: Demo profile")).toBeVisible();

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
```

- [ ] **Step 2: Update SkillsView props**

Add props:

```ts
readonly activeProfileId?: string;
readonly profiles?: readonly RuntimeSkillProfileRecord[];
readonly onSetActiveProfile: (profileId: string) => void;
readonly onSaveProfile: (profile: RuntimeSkillProfileRecord) => void;
readonly onDeleteProfile: (profileId: string) => void;
```

- [ ] **Step 3: Add profile management UI**

At top of SkillsView, derive active profile:

```ts
const profiles = runtime?.skillProfiles ?? [];
const activeProfileId = runtime?.activeSkillProfileId ?? "default";
const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
```

Add profile header above search:

- Displays `Active profile: <name>`.
- Select dropdown to switch profiles.
- `New profile` button opens small dialog.
- `Duplicate` duplicates active profile.
- `Delete` deletes non-default profile.

Profile create dialog fields:
- Profile name.
- Description optional.
- Create profile button.
- Id generated by slugifying name.

- [ ] **Step 4: Rename usage label**

In `SkillUsageStats`, change text from `Used N times` to `Slash uses N` or `N slash uses`.

- [ ] **Step 5: Rename workspace label in App surface toolbar**

In Skills surface toolbar in `App.tsx`, change label text from `Workspace` to `Discovery workspace` and add short helper copy:

```tsx
<span className="surface-toolbar__hint">Profiles are global. This only changes which project-local skills are discoverable.</span>
```

- [ ] **Step 6: Wire App handlers**

Pass runtime profile fields from `skillsRuntime` and handlers that call new IPC APIs.

- [ ] **Step 7: Run skill profile spec**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/skill-profiles.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Skills page profile management**

```bash
git add apps/desktop/src/skills-view.tsx apps/desktop/src/App.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/skill-profiles.spec.ts
git commit -m "Add global skill profile management"
```

---

## Task 4: Add composer skill profile selector

**Files:**
- Create: `apps/desktop/src/skill-profile-selector.tsx`
- Modify: `apps/desktop/src/composer-control-bar.tsx`
- Modify: `apps/desktop/src/composer-panel.tsx`
- Modify: `apps/desktop/src/new-thread-view.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/skill-profiles.spec.ts`

- [ ] **Step 1: Add failing composer selector test**

Append to `skill-profiles.spec.ts`:

```ts
test("composer switches global skill profiles from the chatbox", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("skill-profile-composer-workspace");
  const catalogPath = join(userDataDir, "skill-catalog.json");
  await writeFile(catalogPath, JSON.stringify({
    activeProfileId: "default",
    profiles: [
      { id: "default", name: "Default", skills: {} },
      { id: "debug", name: "Debug", description: "Debugging skills", skills: {} }
    ]
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
```

- [ ] **Step 2: Create SkillProfileSelector component**

Create `apps/desktop/src/skill-profile-selector.tsx` with:

```tsx
import { useState } from "react";
import type { RuntimeSkillProfileRecord } from "@pi-gui/session-driver/runtime-types";
import { SkillIcon } from "./icons";

interface SkillProfileSelectorProps {
  readonly profiles: readonly RuntimeSkillProfileRecord[];
  readonly activeProfileId?: string;
  readonly onSelectProfile: (profileId: string) => void;
  readonly onOpenSkillProfiles: () => void;
}

export function SkillProfileSelector({ profiles, activeProfileId, onSelectProfile, onOpenSkillProfiles }: SkillProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  return (
    <div className="skill-profile-selector">
      <button aria-label={`Skills profile: ${active?.name ?? "Default"}`} className="composer-control" type="button" onClick={() => setOpen((value) => !value)}>
        <SkillIcon />
        <span>{active?.name ?? "Default"}</span>
      </button>
      {open ? (
        <div className="skill-profile-selector__menu">
          {profiles.map((profile) => (
            <button className="skill-profile-selector__item" key={profile.id} type="button" onClick={() => { onSelectProfile(profile.id); setOpen(false); }}>
              <strong>{profile.name}</strong>
              {profile.description ? <span>{profile.description}</span> : null}
            </button>
          ))}
          <button className="skill-profile-selector__manage" type="button" onClick={() => { onOpenSkillProfiles(); setOpen(false); }}>Manage profiles…</button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Wire composer control bar**

Add `skillProfileControl?: ReactNode` to `ComposerControlBarProps` and render it after Fast or before Build with separators.

Add props through `ComposerPanel` and `NewThreadView`.

- [ ] **Step 4: Wire App handlers**

Create handler:

```ts
const handleSetActiveSkillProfile = (workspaceId: string | undefined, profileId: string) => {
  if (!workspaceId) return;
  void updateSnapshot(api, setSnapshot, () => api.setActiveSkillProfile(workspaceId, profileId));
};
```

Pass `SkillProfileSelector` into existing and new thread composers using the selected/new-thread runtime.

- [ ] **Step 5: Add styles**

Add dropdown styles for `.skill-profile-selector`.

- [ ] **Step 6: Run composer selector test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/skill-profiles.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit composer selector**

```bash
git add apps/desktop/src/skill-profile-selector.tsx apps/desktop/src/composer-control-bar.tsx apps/desktop/src/composer-panel.tsx apps/desktop/src/new-thread-view.tsx apps/desktop/src/App.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/skill-profiles.spec.ts
git commit -m "Add composer skill profile selector"
```

---

## Task 5: Deprecate confusing workspace-scoped skill wording and verify

**Files:**
- Modify: `apps/desktop/src/skills-view.tsx`
- Modify: `apps/desktop/tests/core/skills-settings.spec.ts`
- Modify: `apps/desktop/tests/core/skill-profiles.spec.ts`

- [ ] **Step 1: Update copy**

Change Skills page header body to:

```tsx
<p className="view-header__body">
  Build global skill profiles from the skills Pi discovers in the selected project context.
</p>
```

Ensure empty state says:

```text
No skills discovered in this workspace context. Global profiles still apply wherever those skills are available.
```

- [ ] **Step 2: Update old skills settings tests**

In `skills-settings.spec.ts`, update assertions from `Used 0 times` to `0 slash uses` or the exact new copy.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/skill-profiles.spec.ts apps/desktop/tests/core/skills-settings.spec.ts apps/desktop/tests/core/composer-controls.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full core lane**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected: no new failures. Known unrelated failures may remain in `archive.spec.ts` and `unread-state.spec.ts`.

- [ ] **Step 6: Restart dev app**

```bash
pkill -f "pnpm --filter @pi-gui/desktop dev|electron-vite dev|/pi-gui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" || true
nohup pnpm --filter @pi-gui/desktop dev > /tmp/pi-gui-desktop-dev.log 2>&1 &
sleep 5
pgrep -fl "electron-vite dev|@pi-gui/desktop dev|Electron.app/Contents/MacOS/Electron"
```

Expected: Electron launches from latest main.

- [ ] **Step 7: Commit final copy/verification fixes**

```bash
git add apps/desktop/src/skills-view.tsx apps/desktop/tests/core/skills-settings.spec.ts apps/desktop/tests/core/skill-profiles.spec.ts
git commit -m "Clarify global skill profile semantics"
```

---

## Self-Review

- Spec coverage: This plan makes profiles global, adds profile management, adds chatbox selection, keeps workspace only as discovery context, and relabels misleading usage stats.
- Placeholder scan: No placeholder tasks remain; code snippets and commands are concrete.
- Type consistency: `RuntimeSkillProfileRecord`, `SkillProfileRecord`, profile methods, and IPC names are consistent across package/runtime/desktop layers.
