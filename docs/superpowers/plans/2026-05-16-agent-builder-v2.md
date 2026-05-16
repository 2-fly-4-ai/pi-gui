# Agent Builder V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Settings → Agents a real pi-subagents manager: users can create custom agents, edit built-in/custom definitions thoroughly, choose subagent models clearly, and understand from Settings → Models where subagent model choices live.

**Architecture:** Keep the `pi-subagents` markdown files as the source of truth and expand the existing narrow IPC surface instead of introducing a separate database. Split the current read-only-ish editor into focused form/model modules so the same editor handles create and edit flows, while Electron remains responsible for validation and serialization. Add visible cross-link copy from Settings → Models to Settings → Agents so users looking for subagent model selection find the right place.

**Tech Stack:** Electron main/preload IPC, React/TypeScript renderer, Pi runtime model catalog, markdown frontmatter files, Playwright core tests, Node `fs/promises`.

---

## Scope

This plan implements the full usable V2 builder for documented `pi-subagents` fields that are safe to edit from Pi GUI:

- Create custom agents via **New agent**.
- Edit built-in overrides and custom agents with:
  - name for new custom agents only
  - display name
  - description
  - scope: global or project
  - enabled toggle
  - model: inherit or exact provider/model from runtime catalog
  - reasoning: inherit/off/minimal/low/medium/high/xhigh
  - prompt mode: append or replace
  - system prompt editor
  - tool selection: read, bash, edit, write, grep, find, ls
  - extensions enabled
  - skills enabled
  - max turns
  - inherit context
  - run in background
  - isolated
  - isolation mode: none or worktree
- Delete custom agents and reset built-in overrides.
- Duplicate any agent into a new custom agent.
- Show a Settings → Models callout explaining that subagent model choices live under Settings → Agents.

Out of scope for this plan:

- Editing arbitrary extension-specific custom fields beyond the safe frontmatter fields above.
- Launching subagents manually from a UI button.
- Building a visual graph or run monitor for subagents.
- Changing the upstream `pi-subagents` extension.

## File Structure

### Shared model and form helpers

Modify `apps/desktop/src/agent-definitions.ts`:
- Add `DeleteAgentDefinitionInput` and `DuplicateAgentDefinitionInput` if needed by IPC.
- Add constants for editable tool choices, prompt modes, isolation choices, and empty custom-agent defaults.
- Add helpers for creating a new custom config and duplicating an existing config.

Create `apps/desktop/src/agent-definition-form.ts`:
- Owns mutable form state conversions between `AgentDefinitionConfig` and controlled inputs.
- Validates client-side form errors for name, description, prompt, model, and max turns.
- Builds `AgentDefinitionConfig` for save.

### Electron persistence

Modify `apps/desktop/electron/agent-definitions.ts`:
- Add delete support for custom agents.
- Strengthen validation for editable fields.
- Preserve existing parser/serializer behavior for V1 fields.
- Ensure custom delete cannot delete built-in fallback definitions, only override files.

Modify IPC files:
- `apps/desktop/src/ipc.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/main.ts`

### UI

Replace/expand `apps/desktop/src/agent-definition-editor.tsx`:
- Convert from simple modal to full editor modal with sections.
- Support create/edit/duplicate modes.
- Enable editable prompt and tools.
- Keep model selection provider-agnostic from `runtime.models`.

Modify `apps/desktop/src/settings-agents-section.tsx`:
- Enable New agent.
- Add Duplicate, Delete/Reset actions.
- Add clearer row metadata.
- Add loading and error states.

Modify `apps/desktop/src/settings-models-section.tsx`:
- Add a clear callout/link for “Subagent models”.
- Accept an `onOpenAgentsSettings` callback.

Modify `apps/desktop/src/settings-view.tsx` and `apps/desktop/src/App.tsx`:
- Wire new callbacks, async save/delete/reset feedback, and Settings → Models link.

Modify `apps/desktop/src/styles/main.css`:
- Add form grid, checkbox group, prompt editor, danger action, and loading/error styling.

### Tests

Modify `apps/desktop/tests/core/agent-settings.spec.ts`:
- Update V1 assertions now New agent is enabled.
- Add custom-agent create/edit/delete flow.
- Add duplicate flow.
- Add prompt/tools/max-turns/isolation serialization assertions.
- Add Models → Agents cross-link test.

---

## Task 1: Add shared V2 form model and IPC delete type

**Files:**
- Modify: `apps/desktop/src/agent-definitions.ts`
- Create: `apps/desktop/src/agent-definition-form.ts`
- Test: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add failing test for enabled New agent and custom agent creation**

Append this test to `apps/desktop/tests/core/agent-settings.spec.ts`:

```ts
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
    await window.getByRole("button", { name: "Agents", exact: true }).click();

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: FAIL because New agent is disabled and the V2 editor fields do not exist.

- [ ] **Step 3: Extend shared types and constants**

In `apps/desktop/src/agent-definitions.ts`, add after `ResetAgentDefinitionInput`:

```ts
export interface DeleteAgentDefinitionInput {
  readonly scope: AgentDefinitionScope;
  readonly name: string;
}

export const AGENT_TOOL_OPTIONS: readonly { readonly name: AgentToolName; readonly label: string; readonly description: string }[] = [
  { name: "read", label: "Read", description: "Read files" },
  { name: "bash", label: "Bash", description: "Run shell commands" },
  { name: "grep", label: "Grep", description: "Search file contents" },
  { name: "find", label: "Find", description: "Find files by glob" },
  { name: "ls", label: "List", description: "List directories" },
  { name: "edit", label: "Edit", description: "Edit files" },
  { name: "write", label: "Write", description: "Create or overwrite files" },
];

export const DEFAULT_CUSTOM_AGENT_PROMPT = `You are a focused specialist agent.

Use the repository context and available tools to complete the delegated task.
Be concise, cite files when relevant, and stop when the task is complete.`;

export function createDefaultCustomAgentConfig(): AgentDefinitionConfig {
  return {
    name: "",
    displayName: "",
    description: "Specialist agent for delegated tasks",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: DEFAULT_CUSTOM_AGENT_PROMPT,
  };
}

export function duplicateAgentConfig(config: AgentDefinitionConfig): AgentDefinitionConfig {
  return {
    ...config,
    name: "",
    displayName: config.displayName ? `${config.displayName} Copy` : `${config.name} Copy`,
    description: config.description,
  };
}
```

- [ ] **Step 4: Create form model helper**

Create `apps/desktop/src/agent-definition-form.ts`:

```ts
import type { AgentDefinitionConfig, AgentDefinitionScope, AgentThinkingLevel, AgentToolName } from "./agent-definitions";

export interface AgentDefinitionFormState {
  readonly mode: "create" | "edit";
  readonly originalName?: string;
  readonly builtin: boolean;
  readonly scope: AgentDefinitionScope;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly modelValue: string;
  readonly thinkingValue: "inherit" | AgentThinkingLevel;
  readonly promptMode: "append" | "replace";
  readonly systemPrompt: string;
  readonly tools: readonly AgentToolName[];
  readonly extensions: boolean;
  readonly skills: boolean;
  readonly maxTurns: string;
  readonly inheritContext: boolean;
  readonly runInBackground: boolean;
  readonly isolated: boolean;
  readonly isolation: "" | "worktree";
}

export interface AgentDefinitionFormValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function createAgentDefinitionFormState(input: {
  readonly mode: "create" | "edit";
  readonly config: AgentDefinitionConfig;
  readonly scope: AgentDefinitionScope;
  readonly builtin: boolean;
}): AgentDefinitionFormState {
  return {
    mode: input.mode,
    originalName: input.mode === "edit" ? input.config.name : undefined,
    builtin: input.builtin,
    scope: input.scope,
    name: input.config.name,
    displayName: input.config.displayName ?? "",
    description: input.config.description,
    enabled: input.config.enabled,
    modelValue: input.config.modelMode === "fixed" && input.config.model ? `${input.config.model.providerId}:${input.config.model.modelId}` : "inherit",
    thinkingValue: input.config.thinkingMode === "fixed" && input.config.thinking ? input.config.thinking : "inherit",
    promptMode: input.config.promptMode,
    systemPrompt: input.config.systemPrompt,
    tools: input.config.tools ?? [],
    extensions: input.config.extensions,
    skills: input.config.skills,
    maxTurns: input.config.maxTurns ? String(input.config.maxTurns) : "",
    inheritContext: input.config.inheritContext ?? false,
    runInBackground: input.config.runInBackground ?? false,
    isolated: input.config.isolated ?? false,
    isolation: input.config.isolation === "worktree" ? "worktree" : "",
  };
}

export function validateAgentDefinitionForm(state: AgentDefinitionFormState): AgentDefinitionFormValidation {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(state.name)) {
    errors.push("Agent name must start with a letter or number and use only letters, numbers, dots, underscores, or dashes.");
  }
  if (!state.description.trim()) {
    errors.push("Description is required.");
  }
  if (!state.systemPrompt.trim()) {
    errors.push("System prompt is required.");
  }
  if (state.modelValue !== "inherit") {
    const [providerId, ...modelParts] = state.modelValue.split(":");
    if (!providerId || !modelParts.join(":")) {
      errors.push("Fixed model requires a provider and model.");
    }
  }
  if (state.maxTurns.trim()) {
    const parsed = Number.parseInt(state.maxTurns, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push("Max turns must be a positive integer.");
    }
  }
  return { valid: errors.length === 0, errors };
}

export function buildAgentDefinitionConfig(state: AgentDefinitionFormState): AgentDefinitionConfig {
  const modelParts = state.modelValue === "inherit" ? [] : state.modelValue.split(":");
  const providerId = modelParts[0] ?? "";
  const modelId = modelParts.slice(1).join(":");
  const maxTurns = state.maxTurns.trim() ? Number.parseInt(state.maxTurns, 10) : undefined;
  return {
    name: state.name.trim(),
    displayName: state.displayName.trim() || undefined,
    description: state.description.trim(),
    modelMode: state.modelValue === "inherit" ? "inherit" : "fixed",
    model: state.modelValue === "inherit" ? undefined : { providerId, modelId },
    thinkingMode: state.thinkingValue === "inherit" ? "inherit" : "fixed",
    thinking: state.thinkingValue === "inherit" ? undefined : state.thinkingValue,
    tools: state.tools,
    extensions: state.extensions,
    skills: state.skills,
    promptMode: state.promptMode,
    maxTurns,
    inheritContext: state.inheritContext || undefined,
    runInBackground: state.runInBackground || undefined,
    isolated: state.isolated || undefined,
    isolation: state.isolation || undefined,
    enabled: state.enabled,
    systemPrompt: state.systemPrompt.trim(),
  };
}

export function toggleAgentTool(tools: readonly AgentToolName[], tool: AgentToolName, checked: boolean): readonly AgentToolName[] {
  if (checked) {
    return tools.includes(tool) ? tools : [...tools, tool];
  }
  return tools.filter((entry) => entry !== tool);
}
```

- [ ] **Step 5: Typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit shared V2 model**

```bash
git add apps/desktop/src/agent-definitions.ts apps/desktop/src/agent-definition-form.ts apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Add agent builder form model"
```

---

## Task 2: Add Electron delete support and stronger custom-agent validation

**Files:**
- Modify: `apps/desktop/electron/agent-definitions.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`

- [ ] **Step 1: Add failing test for delete custom agent**

Append this test to `apps/desktop/tests/core/agent-settings.spec.ts`:

```ts
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
    await window.getByRole("button", { name: "Agents", exact: true }).click();

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
```

- [ ] **Step 2: Extend Electron persistence**

In `apps/desktop/electron/agent-definitions.ts`, import `DeleteAgentDefinitionInput` and add:

```ts
export async function deleteAgentDefinition(
  workspacePath: string | undefined,
  input: DeleteAgentDefinitionInput,
): Promise<AgentDefinitionsSnapshot> {
  validateResetInput(input);
  if (isBuiltin(input.name)) {
    throw new Error("Built-in agents can be reset, not deleted.");
  }
  const dir = resolveScopeDir(workspacePath, input.scope);
  const path = safeAgentPath(dir, input.name);
  await rm(path, { force: true });
  return listAgentDefinitions(workspacePath);
}
```

Strengthen `validateSaveInput` by adding:

```ts
if (config.tools?.some((tool) => !BUILTIN_TOOL_NAMES.includes(tool))) throw new Error("Invalid agent tool.");
if (config.isolation && config.isolation !== "worktree") throw new Error("Invalid isolation mode.");
if (config.enabled !== true && config.enabled !== false) throw new Error("Invalid enabled value.");
if (config.extensions !== true && config.extensions !== false) throw new Error("Invalid extensions value.");
if (config.skills !== true && config.skills !== false) throw new Error("Invalid skills value.");
```

- [ ] **Step 3: Add IPC channel and API**

In `apps/desktop/src/ipc.ts`, import `DeleteAgentDefinitionInput`, add channel:

```ts
deleteAgentDefinition: "pi-gui:delete-agent-definition",
```

Add API method:

```ts
deleteAgentDefinition(workspaceId: string, input: DeleteAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>;
```

In `apps/desktop/electron/preload.ts`, add:

```ts
deleteAgentDefinition: (workspaceId: string, input: DeleteAgentDefinitionInput) =>
  ipcRenderer.invoke(desktopIpc.deleteAgentDefinition, workspaceId, input) as Promise<AgentDefinitionsSnapshot>,
```

In `apps/desktop/electron/main.ts`, import `deleteAgentDefinition` and register:

```ts
ipcMain.handle(desktopIpc.deleteAgentDefinition, async (_event, workspaceId: string, input: DeleteAgentDefinitionInput) => {
  return deleteAgentDefinition(store.getWorkspacePath(workspaceId), input);
});
```

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit delete support**

```bash
git add apps/desktop/electron/agent-definitions.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/ipc.ts apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Add custom agent deletion support"
```

---

## Task 3: Build the full AgentDefinitionEditor UI

**Files:**
- Modify: `apps/desktop/src/agent-definition-editor.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Replace the editor with create/edit form support**

Replace `apps/desktop/src/agent-definition-editor.tsx` with:

```tsx
import { useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { AgentDefinitionConfig, AgentDefinitionScope, AgentToolName, SaveAgentDefinitionInput } from "./agent-definitions";
import { AGENT_TOOL_OPTIONS } from "./agent-definitions";
import {
  buildAgentDefinitionConfig,
  createAgentDefinitionFormState,
  toggleAgentTool,
  validateAgentDefinitionForm,
  type AgentDefinitionFormState,
} from "./agent-definition-form";
import { THINKING_LEVELS, labelForThinking } from "./settings-utils";

interface AgentDefinitionEditorProps {
  readonly mode: "create" | "edit";
  readonly config: AgentDefinitionConfig;
  readonly runtime?: RuntimeSnapshot;
  readonly defaultScope: AgentDefinitionScope;
  readonly builtin: boolean;
  readonly onClose: () => void;
  readonly onSave: (input: SaveAgentDefinitionInput) => void;
}

export function AgentDefinitionEditor({ mode, config, runtime, defaultScope, builtin, onClose, onSave }: AgentDefinitionEditorProps) {
  const title = mode === "create" ? "New agent" : `Edit ${config.name}`;
  const titleId = `agent-definition-editor-title-${mode}-${config.name || "new"}`;
  const [form, setForm] = useState<AgentDefinitionFormState>(() => createAgentDefinitionFormState({ mode, config, scope: defaultScope, builtin }));
  const [attemptedSave, setAttemptedSave] = useState(false);
  const validation = validateAgentDefinitionForm(form);
  const enabledModels = useMemo(() => (runtime?.models ?? []).filter((model) => model.available), [runtime]);

  const update = <Key extends keyof AgentDefinitionFormState>(key: Key, value: AgentDefinitionFormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    setAttemptedSave(true);
    if (!validation.valid) return;
    onSave({ scope: form.scope, config: buildAgentDefinitionConfig(form) });
  };

  return (
    <div className="action-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby={titleId} aria-modal="true" className="action-dialog agent-definition-editor agent-definition-editor--wide" data-testid="agent-definition-editor" role="dialog">
        <header className="agent-definition-editor__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>Create and tune pi-subagents definitions without editing markdown by hand.</p>
          </div>
          <label className="agent-definition-editor__enabled">
            <input aria-label="Enabled" checked={form.enabled} type="checkbox" onChange={(event) => update("enabled", event.target.checked)} />
            <span>Enabled</span>
          </label>
        </header>

        {attemptedSave && !validation.valid ? (
          <div className="settings-warning" role="alert">
            {validation.errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        ) : null}

        <div className="agent-definition-editor__grid">
          <label className="action-dialog__field">
            <span>Agent name</span>
            <input aria-label="Agent name" disabled={mode === "edit"} value={form.name} onChange={(event) => update("name", event.target.value)} />
          </label>
          <label className="action-dialog__field">
            <span>Display name</span>
            <input aria-label="Display name" value={form.displayName} onChange={(event) => update("displayName", event.target.value)} />
          </label>
          <label className="action-dialog__field agent-definition-editor__span">
            <span>Description</span>
            <input aria-label="Description" value={form.description} onChange={(event) => update("description", event.target.value)} />
          </label>
          <label className="action-dialog__field">
            <span>Scope</span>
            <select aria-label="Scope" className="settings-select" value={form.scope} onChange={(event) => update("scope", event.target.value as AgentDefinitionScope)}>
              <option value="global">Global — all projects</option>
              <option value="project">Project — this workspace</option>
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Model</span>
            <select aria-label="Model" className="settings-select" value={form.modelValue} onChange={(event) => update("modelValue", event.target.value)}>
              <option value="inherit">Inherit current thread</option>
              {enabledModels.map((model) => (
                <option key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}>
                  {model.providerName} · {model.label}
                </option>
              ))}
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Reasoning</span>
            <select aria-label="Reasoning" className="settings-select" value={form.thinkingValue} onChange={(event) => update("thinkingValue", event.target.value as AgentDefinitionFormState["thinkingValue"])}>
              <option value="inherit">Inherit</option>
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              {THINKING_LEVELS.map((level) => <option key={level} value={level}>{labelForThinking(level)}</option>)}
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Prompt mode</span>
            <select aria-label="Prompt mode" className="settings-select" value={form.promptMode} onChange={(event) => update("promptMode", event.target.value as "append" | "replace")}>
              <option value="replace">Replace — standalone agent prompt</option>
              <option value="append">Append — parent-twin prompt</option>
            </select>
          </label>
        </div>

        <label className="action-dialog__field">
          <span>System prompt</span>
          <textarea aria-label="System prompt" className="agent-definition-editor__prompt" value={form.systemPrompt} onChange={(event) => update("systemPrompt", event.target.value)} />
        </label>

        <section className="agent-definition-editor__panel">
          <h3>Tools and context</h3>
          <div className="agent-definition-editor__checks">
            {AGENT_TOOL_OPTIONS.map((tool) => (
              <label className="agent-definition-editor__check" key={tool.name}>
                <input
                  aria-label={`Tool: ${tool.name}`}
                  checked={form.tools.includes(tool.name)}
                  type="checkbox"
                  onChange={(event) => update("tools", toggleAgentTool(form.tools, tool.name, event.target.checked))}
                />
                <span><strong>{tool.label}</strong><small>{tool.description}</small></span>
              </label>
            ))}
          </div>
          <div className="agent-definition-editor__grid agent-definition-editor__grid--compact">
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Extensions" checked={form.extensions} type="checkbox" onChange={(event) => update("extensions", event.target.checked)} />
              <span>Extensions</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Skills" checked={form.skills} type="checkbox" onChange={(event) => update("skills", event.target.checked)} />
              <span>Skills</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Inherit context" checked={form.inheritContext} type="checkbox" onChange={(event) => update("inheritContext", event.target.checked)} />
              <span>Inherit context</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Run in background" checked={form.runInBackground} type="checkbox" onChange={(event) => update("runInBackground", event.target.checked)} />
              <span>Run in background</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Isolated" checked={form.isolated} type="checkbox" onChange={(event) => update("isolated", event.target.checked)} />
              <span>Isolated</span>
            </label>
            <label className="action-dialog__field">
              <span>Isolation</span>
              <select aria-label="Isolation" className="settings-select" value={form.isolation} onChange={(event) => update("isolation", event.target.value as "" | "worktree")}>
                <option value="">None</option>
                <option value="worktree">Worktree</option>
              </select>
            </label>
            <label className="action-dialog__field">
              <span>Max turns</span>
              <input aria-label="Max turns" inputMode="numeric" value={form.maxTurns} onChange={(event) => update("maxTurns", event.target.value)} />
            </label>
          </div>
        </section>

        <div className="action-dialog__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="button" onClick={save}>{mode === "create" ? "Create agent" : "Save"}</button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add editor styles**

Append to `apps/desktop/src/styles/main.css`:

```css
.agent-definition-editor--wide {
  width: min(860px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
}

.agent-definition-editor__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.agent-definition-editor__enabled,
.agent-definition-editor__inline-check,
.agent-definition-editor__check {
  display: flex;
  gap: 8px;
  align-items: center;
}

.agent-definition-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.agent-definition-editor__grid--compact {
  align-items: end;
}

.agent-definition-editor__span {
  grid-column: 1 / -1;
}

.agent-definition-editor__prompt {
  min-height: 180px;
  resize: vertical;
  font-family: var(--font-mono);
}

.agent-definition-editor__panel {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--surface-muted);
}

.agent-definition-editor__panel h3 {
  margin: 0;
  color: var(--text-strong);
  font-size: 13px;
}

.agent-definition-editor__checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.agent-definition-editor__check {
  align-items: flex-start;
  padding: 9px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--surface);
}

.agent-definition-editor__check span {
  display: grid;
  gap: 2px;
}

.agent-definition-editor__check small {
  color: var(--muted);
}
```

- [ ] **Step 3: Run targeted test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: custom create test still fails until SettingsAgentsSection opens create mode in Task 4.

- [ ] **Step 4: Commit editor UI**

```bash
git add apps/desktop/src/agent-definition-editor.tsx apps/desktop/src/styles/main.css
git commit -m "Build full agent definition editor"
```

---

## Task 4: Enable New, Duplicate, Delete, and async error handling in Settings → Agents

**Files:**
- Modify: `apps/desktop/src/settings-agents-section.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/settings-view.tsx`
- Test: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add failing duplicate test**

Append this test to `apps/desktop/tests/core/agent-settings.spec.ts`:

```ts
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
    await window.getByRole("button", { name: "Agents", exact: true }).click();

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
```

- [ ] **Step 2: Update SettingsAgentsSection props and state**

In `apps/desktop/src/settings-agents-section.tsx`, replace the component with one that supports create/edit/duplicate/delete:

```tsx
import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  AgentDefinitionConfig,
  AgentDefinitionRecord,
  AgentDefinitionsSnapshot,
  DeleteAgentDefinitionInput,
  ResetAgentDefinitionInput,
  SaveAgentDefinitionInput,
} from "./agent-definitions";
import { createDefaultCustomAgentConfig, duplicateAgentConfig } from "./agent-definitions";
import { AgentDefinitionEditor } from "./agent-definition-editor";
import { SettingsGroup } from "./settings-utils";

interface SettingsAgentsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly snapshot?: AgentDefinitionsSnapshot;
  readonly pending: boolean;
  readonly error?: string;
  readonly onSave: (input: SaveAgentDefinitionInput) => Promise<void>;
  readonly onReset: (input: ResetAgentDefinitionInput) => Promise<void>;
  readonly onDelete: (input: DeleteAgentDefinitionInput) => Promise<void>;
}

type EditorState =
  | { readonly mode: "create"; readonly config: AgentDefinitionConfig; readonly scope: "global" | "project"; readonly builtin: false }
  | { readonly mode: "edit"; readonly record: AgentDefinitionRecord }
  | undefined;

export function SettingsAgentsSection({ runtime, snapshot, pending, error, onSave, onReset, onDelete }: SettingsAgentsSectionProps) {
  const [editor, setEditor] = useState<EditorState>();
  const [deleteTarget, setDeleteTarget] = useState<AgentDefinitionRecord | undefined>();
  const agents = snapshot?.agents ?? [];

  const openNew = () => setEditor({ mode: "create", config: createDefaultCustomAgentConfig(), scope: "global", builtin: false });
  const openDuplicate = (agent: AgentDefinitionRecord) => setEditor({ mode: "create", config: duplicateAgentConfig(agent.config), scope: agent.scope ?? "global", builtin: false });

  return (
    <div data-testid="settings-agents-section">
      <SettingsGroup title="Subagent definitions" description="Agents are launched naturally by Pi during chat. Configure models, prompts, tools, and custom pi-subagents definitions.">
        <div className="settings-row">
          <div className="settings-row__label">
            <div className="settings-row__title">Custom agent builder</div>
            <div className="settings-row__description">Create specialist agents as markdown definitions under the selected global or project agents folder.</div>
          </div>
          <div className="settings-row__control">
            <button className="button button--primary" disabled={pending} type="button" onClick={openNew}>New agent</button>
          </div>
        </div>
        {error ? <div className="settings-warning" role="alert">{error}</div> : null}
        {!snapshot ? <div className="settings-hint">Loading agent definitions…</div> : null}
        <div className="agent-definitions-list">
          {agents.map((agent) => (
            <div className="agent-definition-row" data-testid={`agent-definition-row-${agent.name}`} key={agent.name}>
              <div className="agent-definition-row__main">
                <div className="agent-definition-row__title">{agent.config.displayName || agent.name}</div>
                <div className="agent-definition-row__description">{agent.config.description}</div>
                <div className="agent-definition-row__meta">
                  <span>{agent.source === "builtin" ? "Built-in" : agent.source === "project" ? "Project override" : "Global override"}</span>
                  <span>Name: {agent.name}</span>
                  <span>Model: {formatModel(agent)}</span>
                  <span>Reasoning: {formatThinking(agent)}</span>
                  <span>Tools: {agent.config.tools?.length ? agent.config.tools.join(", ") : "Inherited/default"}</span>
                  <span>Prompt: {agent.config.promptMode}</span>
                </div>
                {agent.warnings.map((warning) => <div className="settings-warning" key={warning}>{warning}</div>)}
                {!modelAvailable(runtime, agent) ? <div className="settings-warning">Configured model is not currently available. The extension may fall back or fail until the provider is connected.</div> : null}
              </div>
              <div className="agent-definition-row__actions">
                <button className="button button--secondary" disabled={pending} type="button" onClick={() => setEditor({ mode: "edit", record: agent })}>Edit</button>
                <button className="button button--secondary" disabled={pending} type="button" onClick={() => openDuplicate(agent)}>Duplicate</button>
                {agent.source !== "builtin" && agent.scope ? (
                  agent.builtin ? (
                    <button className="button button--secondary" disabled={pending} type="button" onClick={() => void onReset({ scope: agent.scope!, name: agent.name })}>Reset</button>
                  ) : (
                    <button className="button button--danger" disabled={pending} type="button" onClick={() => setDeleteTarget(agent)}>Delete</button>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>

      {editor?.mode === "create" ? (
        <AgentDefinitionEditor mode="create" config={editor.config} runtime={runtime} defaultScope={editor.scope} builtin={false} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {editor?.mode === "edit" ? (
        <AgentDefinitionEditor mode="edit" config={editor.record.config} runtime={runtime} defaultScope={editor.record.scope ?? "global"} builtin={editor.record.builtin} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {deleteTarget?.scope ? (
        <div className="action-dialog-backdrop" role="presentation">
          <section aria-label="Delete agent" aria-modal="true" className="action-dialog" role="dialog">
            <h2>Delete {deleteTarget.name}?</h2>
            <p>This removes the {deleteTarget.scope} markdown definition file. This cannot delete built-in fallback agents.</p>
            <div className="action-dialog__actions">
              <button className="button button--secondary" type="button" onClick={() => setDeleteTarget(undefined)}>Cancel</button>
              <button className="button button--danger" type="button" onClick={async () => { await onDelete({ scope: deleteTarget.scope!, name: deleteTarget.name }); setDeleteTarget(undefined); }}>Delete agent</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function formatModel(agent: AgentDefinitionRecord): string {
  return agent.config.modelMode === "fixed" && agent.config.model ? `${agent.config.model.providerId}/${agent.config.model.modelId}` : "Inherit current thread";
}

function formatThinking(agent: AgentDefinitionRecord): string {
  if (agent.config.thinkingMode !== "fixed" || !agent.config.thinking) return "Inherit";
  if (agent.config.thinking === "xhigh") return "Extra High";
  return agent.config.thinking.charAt(0).toUpperCase() + agent.config.thinking.slice(1);
}

function modelAvailable(runtime: RuntimeSnapshot | undefined, agent: AgentDefinitionRecord): boolean {
  if (agent.config.modelMode !== "fixed" || !agent.config.model) return true;
  if (!runtime) return true;
  return runtime.models.some((model) => model.available && model.providerId === agent.config.model?.providerId && model.modelId === agent.config.model?.modelId);
}
```

- [ ] **Step 3: Wire async handlers in SettingsView and App**

In `apps/desktop/src/settings-view.tsx`, change handler prop types to promises and add `agentDefinitionsPending`, `agentDefinitionsError`, `onDeleteAgentDefinition`.

In `apps/desktop/src/App.tsx`, add state:

```ts
const [agentDefinitionsPending, setAgentDefinitionsPending] = useState(false);
const [agentDefinitionsError, setAgentDefinitionsError] = useState<string | undefined>();
```

Update load/save/reset/delete handlers so they set pending and error, and return promises:

```ts
const handleSaveAgentDefinition = async (input: SaveAgentDefinitionInput) => {
  if (!api || !settingsWorkspace) return;
  setAgentDefinitionsPending(true);
  setAgentDefinitionsError(undefined);
  try {
    setAgentDefinitions(await api.saveAgentDefinition(settingsWorkspace.id, input));
  } catch (error) {
    setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    setAgentDefinitionsPending(false);
  }
};
```

Implement equivalent reset and delete handlers.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS for create, duplicate, delete, V1 edit, warning, precedence tests.

- [ ] **Step 5: Commit Agents section V2**

```bash
git add apps/desktop/src/settings-agents-section.tsx apps/desktop/src/settings-view.tsx apps/desktop/src/App.tsx apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Enable custom agent builder"
```

---

## Task 5: Add Settings → Models cross-link to subagent model controls

**Files:**
- Modify: `apps/desktop/src/settings-models-section.tsx`
- Modify: `apps/desktop/src/settings-view.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add failing test for Models cross-link**

Append this test to `apps/desktop/tests/core/agent-settings.spec.ts`:

```ts
test("settings models points subagent model selection to Agents", async () => {
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
    await expect(window.getByRole("heading", { name: "Agents" })).toBeVisible();
    await expect(window.getByTestId("settings-agents-section")).toBeVisible();
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Add callback prop to SettingsModelsSection**

In `apps/desktop/src/settings-models-section.tsx`, add prop:

```ts
readonly onOpenAgentsSettings: () => void;
```

Near the top of the returned JSX, after default model settings, add:

```tsx
<SettingsGroup title="Subagent models" description="Subagents can inherit the active thread model or use their own fixed model.">
  <SettingsRow title="Agent-specific models" description="Configure general-purpose, Explore, Plan, and custom pi-subagents definitions from Settings → Agents.">
    <button className="button button--secondary" type="button" onClick={onOpenAgentsSettings}>Configure subagents</button>
  </SettingsRow>
</SettingsGroup>
```

- [ ] **Step 3: Wire SettingsView and App**

In `apps/desktop/src/settings-view.tsx`, add prop:

```ts
readonly onOpenAgentsSettings: () => void;
```

Pass it into `SettingsModelsSection`.

In `apps/desktop/src/App.tsx`, pass:

```tsx
onOpenAgentsSettings={() => setSettingsSection("agents")}
```

- [ ] **Step 4: Run cross-link test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Models cross-link**

```bash
git add apps/desktop/src/settings-models-section.tsx apps/desktop/src/settings-view.tsx apps/desktop/src/App.tsx apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Link model settings to subagent configuration"
```

---

## Task 6: Final verification and polish

**Files:**
- Modify only files needed for fixes discovered during verification.

- [ ] **Step 1: Run typecheck**

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 2: Run targeted core specs**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts apps/desktop/tests/core/skills-settings.spec.ts apps/desktop/tests/core/model-scope-toggle.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run full core lane**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected: no new failures. Known unrelated failures may still appear in `archive.spec.ts` and `unread-state.spec.ts`.

- [ ] **Step 4: Restart dev app**

```bash
pkill -f "pnpm --filter @pi-gui/desktop dev|electron-vite dev|/pi-gui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" || true
nohup pnpm --filter @pi-gui/desktop dev > /tmp/pi-gui-desktop-dev.log 2>&1 &
sleep 5
pgrep -fl "electron-vite dev|@pi-gui/desktop dev|Electron.app/Contents/MacOS/Electron"
```

Expected: dev server listens on `localhost:5173`, Electron launches from latest `main`.

- [ ] **Step 5: Commit verification fixes if any**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "Polish agent builder"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: This plan covers New agent creation, full custom-agent editing, built-in override editing, model/reasoning selection, prompt/tools/runtime fields, duplicate/delete/reset, and a Settings → Models link so users can find subagent model controls.
- Placeholder scan: No placeholder tasks remain. Every task has concrete file paths, code snippets, commands, and expected results.
- Type consistency: `DeleteAgentDefinitionInput`, `AgentDefinitionFormState`, `AgentDefinitionConfig`, and `SettingsAgentsSection` async handlers are named consistently across the plan.
