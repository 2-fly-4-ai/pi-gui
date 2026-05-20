# Desktop Custom Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional GUI-only custom-instructions setting that appends text to pi-gui launched agent sessions without editing `~/.pi/agent/APPEND_SYSTEM.md`.

**Architecture:** Persist a `desktopCustomInstructions` record in desktop UI state, expose it through the existing narrow IPC/state boundary, and append it at Pi SDK resource-loading time after Pi's normal global/project append system prompt. Keep the feature desktop-owned: do not write to global Pi config files and do not affect terminal Pi.

**Tech Stack:** Electron main/preload IPC, React settings UI, `DesktopAppStore`, `PiSdkDriver`/`SessionSupervisor`, Pi `DefaultResourceLoaderOptions.appendSystemPromptOverride`, Playwright core e2e.

---

## Acceptance Criteria

- Settings → General shows a “Desktop custom instructions” group with an enabled checkbox and editable textarea.
- The textarea persists across app restarts using pi-gui app data only.
- New sessions launched from pi-gui append the enabled desktop instructions after Pi's normal system-prompt append sources.
- Disabling the toggle keeps the text but stops appending it to new sessions.
- The implementation never creates, renames, edits, or deletes `~/.pi/agent/APPEND_SYSTEM.md`.
- Existing terminal Pi behavior remains unchanged.

## Files

- Modify: `apps/desktop/src/desktop-state.ts`
- Modify: `apps/desktop/electron/app-store-persistence.ts`
- Modify: `apps/desktop/electron/app-store.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/settings-view.tsx`
- Modify: `apps/desktop/src/settings-general-section.tsx`
- Modify: `packages/pi-sdk-driver/src/pi-sdk-driver.ts`
- Modify: `packages/pi-sdk-driver/src/session-supervisor.ts`
- Modify: `packages/pi-sdk-driver/src/npm-package-fallback.ts`
- Add: `apps/desktop/tests/core/desktop-custom-instructions.spec.ts`
- Optional if needed: `apps/desktop/src/styles/main.css`

---

### Task 1: Add persisted desktop custom-instructions state

**Files:**
- Modify: `apps/desktop/src/desktop-state.ts`
- Modify: `apps/desktop/electron/app-store-persistence.ts`
- Modify: `apps/desktop/electron/app-store.ts`

- [ ] **Step 1: Define the state type**

Add this interface near the other settings records in `apps/desktop/src/desktop-state.ts`:

```ts
export interface DesktopCustomInstructionsRecord {
  readonly enabled: boolean;
  readonly text: string;
}
```

Add this field to `DesktopAppState`:

```ts
readonly desktopCustomInstructions: DesktopCustomInstructionsRecord;
```

Add this default in `createEmptyDesktopAppState()`:

```ts
desktopCustomInstructions: {
  enabled: false,
  text: "",
},
```

- [ ] **Step 2: Persist the state**

In `apps/desktop/electron/app-store-persistence.ts`, import `DesktopCustomInstructionsRecord` and bump the `version` union and write payload from `10` to `11`.

Add to `PersistedUiState`:

```ts
readonly desktopCustomInstructions?: DesktopCustomInstructionsRecord;
```

In `readPersistedUiState()`, parse only safe values:

```ts
desktopCustomInstructions: toPersistedDesktopCustomInstructions(parsed.desktopCustomInstructions),
```

Add helper:

```ts
function toPersistedDesktopCustomInstructions(value: unknown): DesktopCustomInstructionsRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  return {
    enabled: candidate.enabled === true,
    text: typeof candidate.text === "string" ? candidate.text : "",
  };
}
```

- [ ] **Step 3: Hydrate and persist from the store**

In `apps/desktop/electron/app-store.ts`, during `initializeInternal()` where persisted UI state is applied, add:

```ts
desktopCustomInstructions: persisted.desktopCustomInstructions ?? this.state.desktopCustomInstructions,
```

In `persistUiState()`, include:

```ts
desktopCustomInstructions: this.state.desktopCustomInstructions,
```

Add a store method:

```ts
async setDesktopCustomInstructions(input: Partial<DesktopCustomInstructionsRecord>): Promise<DesktopAppState> {
  await this.initialize();
  const text = typeof input.text === "string" ? input.text.slice(0, 200_000) : this.state.desktopCustomInstructions.text;
  this.state = {
    ...this.state,
    desktopCustomInstructions: {
      enabled: input.enabled ?? this.state.desktopCustomInstructions.enabled,
      text,
    },
    revision: this.state.revision + 1,
  };
  await this.persistUiState();
  return this.emit();
}
```

- [ ] **Step 4: Run typecheck for the state changes**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: TypeScript passes, or only errors in files changed above that must be fixed before continuing.

- [ ] **Step 5: Commit the state slice**

```bash
git add apps/desktop/src/desktop-state.ts apps/desktop/electron/app-store-persistence.ts apps/desktop/electron/app-store.ts
git commit -m "feat(desktop): persist custom instructions setting"
```

---

### Task 2: Add IPC and Settings UI

**Files:**
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/settings-view.tsx`
- Modify: `apps/desktop/src/settings-general-section.tsx`
- Optional: `apps/desktop/src/styles/main.css`

- [ ] **Step 1: Add the IPC channel and renderer API**

In `apps/desktop/src/ipc.ts`, add to `desktopIpc`:

```ts
setDesktopCustomInstructions: "pi-gui:set-desktop-custom-instructions",
```

Add the preload API method in `apps/desktop/electron/preload.ts`:

```ts
setDesktopCustomInstructions: (input: Partial<DesktopAppState["desktopCustomInstructions"]>) =>
  ipcRenderer.invoke(desktopIpc.setDesktopCustomInstructions, input) as Promise<DesktopAppState>,
```

Ensure the exposed API type includes the method if this file has an explicit interface.

- [ ] **Step 2: Register main-process handler**

In `apps/desktop/electron/main.ts`, near other settings handlers, add:

```ts
ipcMain.handle(desktopIpc.setDesktopCustomInstructions, (_event, input) =>
  store.setDesktopCustomInstructions(input),
);
```

- [ ] **Step 3: Wire App and SettingsView props**

In `apps/desktop/src/App.tsx`, add:

```ts
const handleSetDesktopCustomInstructions = (input: Partial<DesktopAppState["desktopCustomInstructions"]>) => {
  void updateSnapshot(api, setSnapshot, () => api.setDesktopCustomInstructions(input));
};
```

Pass to `SettingsView`:

```tsx
desktopCustomInstructions={snapshot.desktopCustomInstructions}
onSetDesktopCustomInstructions={handleSetDesktopCustomInstructions}
```

In `apps/desktop/src/settings-view.tsx`, add matching props and pass them to `SettingsGeneralSection`.

- [ ] **Step 4: Build the Settings → General control**

In `apps/desktop/src/settings-general-section.tsx`, import `DesktopCustomInstructionsRecord` and add props:

```ts
readonly desktopCustomInstructions: DesktopCustomInstructionsRecord;
readonly onSetDesktopCustomInstructions: (input: Partial<DesktopCustomInstructionsRecord>) => void;
```

Add local textarea draft state:

```ts
const [customInstructionsDraft, setCustomInstructionsDraft] = useState(desktopCustomInstructions.text);

useEffect(() => {
  setCustomInstructionsDraft(desktopCustomInstructions.text);
}, [desktopCustomInstructions.text]);

const commitCustomInstructionsDraft = () => {
  if (customInstructionsDraft !== desktopCustomInstructions.text) {
    onSetDesktopCustomInstructions({ text: customInstructionsDraft });
  }
};
```

Add a new settings group after the existing General group:

```tsx
<SettingsGroup title="Desktop custom instructions">
  <SettingsRow
    title="Use desktop custom instructions"
    description="Append these instructions only to sessions launched from the desktop app. This does not edit ~/.pi/agent/APPEND_SYSTEM.md."
  >
    <input
      aria-label="Use desktop custom instructions"
      checked={desktopCustomInstructions.enabled}
      type="checkbox"
      onChange={(event) => onSetDesktopCustomInstructions({ enabled: event.target.checked })}
    />
  </SettingsRow>
  <SettingsRow
    title="Instructions"
    description="Keep this short. These instructions are appended after Pi's normal system prompt sources for new desktop sessions."
  >
    <textarea
      aria-label="Desktop custom instructions"
      className="settings-textarea"
      disabled={!desktopCustomInstructions.enabled}
      placeholder="Conversation style:\n\n- Keep answers short and concise."
      spellCheck={false}
      value={customInstructionsDraft}
      onBlur={commitCustomInstructionsDraft}
      onChange={(event) => setCustomInstructionsDraft(event.target.value)}
    />
  </SettingsRow>
</SettingsGroup>
```

If `settings-textarea` does not exist, add CSS in `apps/desktop/src/styles/main.css` consistent with `.settings-text-input`.

- [ ] **Step 5: Run focused typecheck**

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: passes.

- [ ] **Step 6: Commit the UI slice**

```bash
git add apps/desktop/src/ipc.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts apps/desktop/src/App.tsx apps/desktop/src/settings-view.tsx apps/desktop/src/settings-general-section.tsx apps/desktop/src/styles/main.css
git commit -m "feat(desktop): add custom instructions settings"
```

---

### Task 3: Append desktop instructions to pi-gui sessions only

**Files:**
- Modify: `apps/desktop/electron/app-store.ts`
- Modify: `packages/pi-sdk-driver/src/pi-sdk-driver.ts`
- Modify: `packages/pi-sdk-driver/src/session-supervisor.ts`
- Modify: `packages/pi-sdk-driver/src/npm-package-fallback.ts`

- [ ] **Step 1: Add a driver/provider option**

In `packages/pi-sdk-driver/src/session-supervisor.ts`, extend `PiSdkDriverOptions`:

```ts
readonly appendSystemPromptProvider?: () => readonly string[];
```

Store it as a private field and set it in the constructor:

```ts
private readonly appendSystemPromptProvider?: () => readonly string[];

this.appendSystemPromptProvider = options.appendSystemPromptProvider;
```

Update the default runtime factory:

```ts
options.createAgentSessionRuntimeImpl
  ?? ((createOptions) => createAgentSessionRuntimeWithNpmFallback(
    createOptions,
    options.skillCatalogFilePath,
    options.appendSystemPromptProvider,
  ));
```

If `skillCatalogFilePath` is only present in `PiSdkDriverConfig`, add it to `PiSdkDriverOptions` or pass the provider from `PiSdkDriver` where the default factory is assembled.

- [ ] **Step 2: Pass desktop state into the driver**

In `apps/desktop/electron/app-store.ts`, add to `driverOptions`:

```ts
appendSystemPromptProvider: () => {
  const instructions = this.state.desktopCustomInstructions;
  const text = instructions.enabled ? instructions.text.trim() : "";
  return text ? [text] : [];
},
```

This closure must read current state at session creation time so toggles affect future sessions without restarting the app.

- [ ] **Step 3: Merge with Pi's normal append sources**

In `packages/pi-sdk-driver/src/npm-package-fallback.ts`, change `createSkillCatalogResourceLoaderOptions` to accept the provider:

```ts
function createResourceLoaderOptions(
  skillCatalog: SkillCatalogStore | undefined,
  appendSystemPromptProvider: (() => readonly string[]) | undefined,
) {
  return {
    ...(skillCatalog
      ? {
          skillsOverride: (base: { skills: Skill[]; diagnostics: any[] }) => ({
            skills: skillCatalog.applyToSkills(base.skills),
            diagnostics: base.diagnostics,
          }),
        }
      : {}),
    ...(appendSystemPromptProvider
      ? {
          appendSystemPromptOverride: (base: string[]) => [
            ...base,
            ...appendSystemPromptProvider().map((entry) => entry.trim()).filter(Boolean),
          ],
        }
      : {}),
  };
}
```

Use that helper in both `createAgentSessionServices()` calls so npm fallback and normal loading behave the same.

- [ ] **Step 4: Thread the provider through runtime creation**

Update `createAgentSessionRuntimeWithNpmFallback` signature:

```ts
export async function createAgentSessionRuntimeWithNpmFallback(
  options?: CreateAgentSessionOptions,
  skillCatalogFilePath?: string,
  appendSystemPromptProvider?: () => readonly string[],
): Promise<AgentSessionRuntime> {
```

Pass `appendSystemPromptProvider` into `createAgentSessionResultWithNpmFallback()` from both initial and replacement runtime paths.

- [ ] **Step 5: Run package typechecks**

```bash
pnpm --filter @pi-gui/pi-sdk-driver typecheck
pnpm --filter @pi-gui/desktop typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit the injection slice**

```bash
git add packages/pi-sdk-driver/src/pi-sdk-driver.ts packages/pi-sdk-driver/src/session-supervisor.ts packages/pi-sdk-driver/src/npm-package-fallback.ts apps/desktop/electron/app-store.ts
git commit -m "feat(driver): append desktop custom instructions"
```

---

### Task 4: Add Electron regression coverage

**Files:**
- Add: `apps/desktop/tests/core/desktop-custom-instructions.spec.ts`

- [ ] **Step 1: Add a persistence/UI test**

Create `apps/desktop/tests/core/desktop-custom-instructions.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { desktopShortcut } from "../helpers/keyboard";
import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

test("persists desktop custom instructions without touching global append system prompt", async () => {
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("desktop-custom-instructions");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();

    const enabled = window.getByRole("checkbox", { name: "Use desktop custom instructions" });
    const textarea = window.getByLabel("Desktop custom instructions");
    await expect(enabled).not.toBeChecked();
    await expect(textarea).toBeDisabled();

    await enabled.click();
    await textarea.fill("Conversation style:\n\n- Technical prose only.");
    await textarea.blur();

    await expect.poll(async () => (await getDesktopState(window)).desktopCustomInstructions).toEqual({
      enabled: true,
      text: "Conversation style:\n\n- Technical prose only.",
    });
  } finally {
    await harness.close();
  }

  const restarted = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await restarted.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "General", exact: true }).click();
    await expect(window.getByRole("checkbox", { name: "Use desktop custom instructions" })).toBeChecked();
    await expect(window.getByLabel("Desktop custom instructions")).toHaveValue("Conversation style:\n\n- Technical prose only.");
  } finally {
    await restarted.close();
  }
});
```

If `desktopShortcut` is not exported from `../helpers/keyboard`, use the existing helper import pattern from `integrated-terminal.spec.ts`.

- [ ] **Step 2: Add an injection contract check if a safe seam exists**

Prefer a narrow test at the driver/store seam if implementation exposes one without broad test-only API. The assertion should verify:

```ts
appendSystemPromptOverride(["global append"])
// returns ["global append", "desktop custom instructions"]
```

If no safe seam exists, document in the test file comment that e2e covers UI/persistence and typecheck covers the resource-loader wiring; do not add broad IPC just for tests.

- [ ] **Step 3: Run focused test and build**

```bash
pnpm --filter @pi-gui/desktop test:e2e:runner -- apps/desktop/tests/core/desktop-custom-instructions.spec.ts
pnpm --filter @pi-gui/desktop build
```

Expected: focused test passes; build passes.

- [ ] **Step 4: Commit tests**

```bash
git add apps/desktop/tests/core/desktop-custom-instructions.spec.ts
git commit -m "test(desktop): cover custom instructions settings"
```

---

### Task 5: Final verification

**Files:**
- No new files unless verification uncovers fixes.

- [ ] **Step 1: Run focused verification**

```bash
pnpm --filter @pi-gui/pi-sdk-driver typecheck
pnpm --filter @pi-gui/desktop typecheck
pnpm --filter @pi-gui/desktop test:e2e:runner -- apps/desktop/tests/core/desktop-custom-instructions.spec.ts
pnpm --filter @pi-gui/desktop build
```

Expected: all pass.

- [ ] **Step 2: Run the strongest practical desktop lane**

Because this touches Settings, persistence, and session creation, run the core lane unless the known pre-existing `timeline-pinning` failure blocks it:

```bash
pnpm --filter @pi-gui/desktop test:e2e:core
```

If the known pre-existing timeline-pinning failure appears, capture the exact failing spec/output and rerun the focused custom-instructions spec plus `settings`/`persistence` adjacent specs.

- [ ] **Step 3: Manual real-surface check**

With only one real-data Electron app running, launch the branch using real data:

```bash
PI_APP_USER_DATA_DIR="$HOME/Library/Application Support/pi" \
PI_CODING_AGENT_DIR="$HOME/.pi/agent" \
pnpm --filter @pi-gui/desktop dev
```

Verify Settings → General shows the control, the value persists after restart, and `~/.pi/agent/APPEND_SYSTEM.md` is unchanged.

- [ ] **Step 4: Final status**

Run:

```bash
git status --short
```

Expected: only unrelated pre-existing files remain unstaged. Report commands run, results, and whether full core lane was blocked by a known unrelated failure.
