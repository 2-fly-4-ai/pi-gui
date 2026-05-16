# Subagent Settings and Agent Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Settings → Agents page that configures pi-subagents agent definitions, starting with built-in subagent model/reasoning overrides and leaving a clean path to a full custom agent builder.

**Architecture:** Use the documented `pi-subagents` agent definition files as the source of truth instead of forking the extension: global agents live in `~/.pi/agent/agents/<name>.md`; project agents live in `<workspace>/.pi/agents/<name>.md`; project definitions override global definitions. The Electron main process owns safe filesystem reads/writes and frontmatter serialization, the preload IPC exposes narrow agent-definition methods, and the renderer presents an Agents settings section backed by the runtime model catalog so OpenAI, Anthropic, local, and future providers all work through exact `providerId/modelId` values.

**Tech Stack:** Electron main/preload IPC, React/TypeScript renderer, Pi runtime model snapshots, markdown frontmatter files, Playwright core tests, Node `fs/promises`.

---

## Source Docs and Constraints

The implementation must follow the `pi-subagents` documented behavior:

- Built-in agent types are `general-purpose`, `Explore`, and `Plan`.
- Custom/override agent files are discovered from `.pi/agents/<name>.md` and `$PI_CODING_AGENT_DIR/agents/<name>.md`.
- Project definitions override global definitions with the same name.
- Frontmatter fields are authoritative for `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background`, `isolated`, and `isolation`; tool-call params only fill missing fields.
- `model` accepts exact `provider/modelId`; use exact values from Pi's runtime model catalog, not hardcoded model families.
- `thinking` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `prompt_mode: append` makes an agent a parent-twin; this is appropriate for `general-purpose`.
- `prompt_mode: replace` makes the body the full standalone prompt; this is appropriate for `Explore`, `Plan`, and most custom specialist agents.

## File Structure

### Main-process definition module

Create `apps/desktop/electron/agent-definitions.ts`.

Responsibilities:
- Resolve global agent dir from `PI_CODING_AGENT_DIR` or `~/.pi/agent`.
- Resolve project agent dir from a workspace path.
- Read `.md` files from both locations.
- Parse and serialize simple YAML frontmatter used by `pi-subagents`.
- Merge built-in definitions, global overrides, and project overrides.
- Save or reset definitions with path traversal protection.

### Shared renderer/main types

Create `apps/desktop/src/agent-definitions.ts`.

Responsibilities:
- Define `AgentDefinitionScope`, `AgentDefinitionSource`, `AgentDefinitionConfig`, `AgentDefinitionRecord`, and save/reset inputs.
- Hold built-in metadata used by renderer and Electron.

### IPC plumbing

Modify:
- `apps/desktop/src/ipc.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/main.ts`

New IPC methods:
- `listAgentDefinitions(workspaceId: string): Promise<AgentDefinitionsSnapshot>`
- `saveAgentDefinition(workspaceId: string, input: SaveAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>`
- `resetAgentDefinition(workspaceId: string, input: ResetAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>`

### Settings UI

Create:
- `apps/desktop/src/settings-agents-section.tsx`
- `apps/desktop/src/agent-definition-editor.tsx`

Modify:
- `apps/desktop/src/settings-utils.tsx` to add `agents` section metadata.
- `apps/desktop/src/settings-view.tsx` to render the section.
- `apps/desktop/src/App.tsx` to load/save agent definitions and include the Agents nav item.
- `apps/desktop/src/styles/main.css` for the list/editor/card styles.

### Tests

Create:
- `apps/desktop/tests/core/agent-settings.spec.ts`

Modify if necessary:
- `apps/desktop/tests/helpers/electron-app.ts` only if a helper is needed for inspecting test user-data files.

---

## Task 1: Define agent definition types and built-in defaults

**Files:**
- Create: `apps/desktop/src/agent-definitions.ts`
- Test: typecheck only in this task

- [ ] **Step 1: Create shared types**

Create `apps/desktop/src/agent-definitions.ts` with this content:

```ts
import type { RuntimeSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";

export type AgentDefinitionScope = "global" | "project";
export type AgentDefinitionSource = "builtin" | "global" | "project";
export type AgentDefinitionModelMode = "inherit" | "fixed";
export type AgentDefinitionThinkingMode = "inherit" | "fixed";
export type AgentToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";

export interface AgentDefinitionConfig {
  readonly name: string;
  readonly displayName?: string;
  readonly description: string;
  readonly modelMode: AgentDefinitionModelMode;
  readonly model?: {
    readonly providerId: string;
    readonly modelId: string;
  };
  readonly thinkingMode: AgentDefinitionThinkingMode;
  readonly thinking?: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]> | "off" | "minimal";
  readonly tools?: readonly AgentToolName[];
  readonly extensions: true | false;
  readonly skills: true | false;
  readonly promptMode: "append" | "replace";
  readonly enabled: boolean;
  readonly systemPrompt: string;
}

export interface AgentDefinitionRecord {
  readonly name: string;
  readonly source: AgentDefinitionSource;
  readonly scope?: AgentDefinitionScope;
  readonly path?: string;
  readonly builtin: boolean;
  readonly overridden: boolean;
  readonly config: AgentDefinitionConfig;
  readonly warnings: readonly string[];
}

export interface AgentDefinitionsSnapshot {
  readonly globalAgentsDir: string;
  readonly projectAgentsDir?: string;
  readonly agents: readonly AgentDefinitionRecord[];
}

export interface SaveAgentDefinitionInput {
  readonly scope: AgentDefinitionScope;
  readonly config: AgentDefinitionConfig;
}

export interface ResetAgentDefinitionInput {
  readonly scope: AgentDefinitionScope;
  readonly name: string;
}

export const BUILTIN_AGENT_NAMES = ["general-purpose", "Explore", "Plan"] as const;

export const READ_ONLY_AGENT_TOOLS: readonly AgentToolName[] = ["read", "bash", "grep", "find", "ls"];

export const DEFAULT_GENERAL_PURPOSE_PROMPT = "";

export const DEFAULT_EXPLORE_PROMPT = `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a file search specialist. You excel at thoroughly navigating and exploring codebases.
Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Use Bash ONLY for read-only operations: ls, git status, git log, git diff, find, cat, head, tail.

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations
- Make independent tool calls in parallel for efficiency
- Adapt search approach based on thoroughness level specified

# Output
- Use absolute file paths in all references
- Report findings as regular messages
- Do not use emojis
- Be thorough and precise`;

export const DEFAULT_PLAN_PROMPT = `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a software architect and planning specialist.
Your role is EXCLUSIVELY to explore the codebase and design implementation plans.
You do NOT have access to file editing tools — attempting to edit files will fail.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

# Planning Process
1. Understand requirements
2. Explore thoroughly (read files, find patterns, understand architecture)
3. Design solution based on your assigned perspective
4. Detail the plan with step-by-step implementation strategy

# Requirements
- Consider trade-offs and architectural decisions
- Identify dependencies and sequencing
- Anticipate potential challenges
- Follow existing patterns where appropriate

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations

# Output Format
- Use absolute file paths
- Do not use emojis
- End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- /absolute/path/to/file.ts - [Brief reason]`;

export const BUILTIN_AGENT_CONFIGS: readonly AgentDefinitionConfig[] = [
  {
    name: "general-purpose",
    displayName: "Agent",
    description: "General-purpose agent for complex, multi-step tasks",
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "append",
    enabled: true,
    systemPrompt: DEFAULT_GENERAL_PURPOSE_PROMPT,
  },
  {
    name: "Explore",
    displayName: "Explore",
    description: "Fast codebase exploration agent (read-only)",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: DEFAULT_EXPLORE_PROMPT,
  },
  {
    name: "Plan",
    displayName: "Plan",
    description: "Software architect for implementation planning (read-only)",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: DEFAULT_PLAN_PROMPT,
  },
];
```

- [ ] **Step 2: Verify types compile**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/agent-definitions.ts
git commit -m "Add agent definition types"
```

---

## Task 2: Implement Electron agent definition persistence

**Files:**
- Create: `apps/desktop/electron/agent-definitions.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Test: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Write failing Playwright test for listing built-ins and saving an override**

Create `apps/desktop/tests/core/agent-settings.spec.ts` with this content:

```ts
import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("settings agents page saves built-in subagent model overrides", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("agent-settings-workspace");
  await mkdir(agentDir, { recursive: true });

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
    await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("general-purpose");
    await expect(window.getByTestId("agent-definition-row-Explore")).toContainText("Explore");
    await expect(window.getByTestId("agent-definition-row-Plan")).toContainText("Plan");

    await window.getByTestId("agent-definition-row-general-purpose").getByRole("button", { name: "Edit" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Model").selectOption("openai-codex:gpt-5.5");
    await dialog.getByLabel("Reasoning").selectOption("medium");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("openai-codex/gpt-5.5");
    await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("Medium");

    const saved = await readFile(join(agentDir, "agents", "general-purpose.md"), "utf8");
    expect(saved).toContain("model: openai-codex/gpt-5.5");
    expect(saved).toContain("thinking: medium");
    expect(saved).toContain("prompt_mode: append");
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run test and confirm it fails because the Agents page does not exist**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: FAIL with missing `Agents` settings nav or missing `settings-agents-section`.

- [ ] **Step 3: Implement main-process persistence module**

Create `apps/desktop/electron/agent-definitions.ts` with this content:

```ts
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type {
  AgentDefinitionConfig,
  AgentDefinitionRecord,
  AgentDefinitionScope,
  AgentDefinitionsSnapshot,
  AgentToolName,
  ResetAgentDefinitionInput,
  SaveAgentDefinitionInput,
} from "../src/agent-definitions";
import { BUILTIN_AGENT_CONFIGS } from "../src/agent-definitions";

const BUILTIN_TOOL_NAMES: readonly AgentToolName[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export async function listAgentDefinitions(workspacePath: string | undefined): Promise<AgentDefinitionsSnapshot> {
  const globalAgentsDir = join(resolveAgentDir(), "agents");
  const projectAgentsDir = workspacePath ? join(workspacePath, ".pi", "agents") : undefined;
  const globalRecords = await readAgentDir(globalAgentsDir, "global");
  const projectRecords = projectAgentsDir ? await readAgentDir(projectAgentsDir, "project") : [];

  const merged = new Map<string, AgentDefinitionRecord>();
  for (const builtin of BUILTIN_AGENT_CONFIGS) {
    merged.set(builtin.name, {
      name: builtin.name,
      source: "builtin",
      builtin: true,
      overridden: false,
      config: builtin,
      warnings: [],
    });
  }
  for (const record of globalRecords) {
    merged.set(record.name, record);
  }
  for (const record of projectRecords) {
    merged.set(record.name, record);
  }

  return {
    globalAgentsDir,
    ...(projectAgentsDir ? { projectAgentsDir } : {}),
    agents: [...merged.values()].sort((left, right) => rankAgent(left.name) - rankAgent(right.name) || left.name.localeCompare(right.name)),
  };
}

export async function saveAgentDefinition(
  workspacePath: string | undefined,
  input: SaveAgentDefinitionInput,
): Promise<AgentDefinitionsSnapshot> {
  const dir = resolveScopeDir(workspacePath, input.scope);
  const path = safeAgentPath(dir, input.config.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path, serializeAgentDefinition(input.config), "utf8");
  return listAgentDefinitions(workspacePath);
}

export async function resetAgentDefinition(
  workspacePath: string | undefined,
  input: ResetAgentDefinitionInput,
): Promise<AgentDefinitionsSnapshot> {
  const dir = resolveScopeDir(workspacePath, input.scope);
  const path = safeAgentPath(dir, input.name);
  await rm(path, { force: true });
  return listAgentDefinitions(workspacePath);
}

function resolveAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent");
}

function resolveScopeDir(workspacePath: string | undefined, scope: AgentDefinitionScope): string {
  if (scope === "global") return join(resolveAgentDir(), "agents");
  if (!workspacePath) throw new Error("Project agent settings require a workspace.");
  return join(workspacePath, ".pi", "agents");
}

function safeAgentPath(dir: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid agent name: ${name}`);
  }
  const resolvedDir = resolve(dir);
  const resolvedPath = resolve(resolvedDir, `${name}.md`);
  if (!resolvedPath.startsWith(resolvedDir + sep)) {
    throw new Error("Agent path escapes agent directory.");
  }
  return resolvedPath;
}

async function readAgentDir(dir: string, scope: AgentDefinitionScope): Promise<AgentDefinitionRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const records: AgentDefinitionRecord[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    const name = basename(entry, ".md");
    const path = safeAgentPath(dir, name);
    try {
      const raw = await readFile(path, "utf8");
      const config = parseAgentDefinition(name, raw);
      records.push({
        name,
        source: scope,
        scope,
        path,
        builtin: BUILTIN_AGENT_CONFIGS.some((agent) => agent.name === name),
        overridden: BUILTIN_AGENT_CONFIGS.some((agent) => agent.name === name),
        config,
        warnings: [],
      });
    } catch (error) {
      records.push({
        name,
        source: scope,
        scope,
        path,
        builtin: BUILTIN_AGENT_CONFIGS.some((agent) => agent.name === name),
        overridden: BUILTIN_AGENT_CONFIGS.some((agent) => agent.name === name),
        config: fallbackConfig(name),
        warnings: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return records;
}

function parseAgentDefinition(name: string, raw: string): AgentDefinitionConfig {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = match ? parseFrontmatter(match[1]) : {};
  const body = match ? match[2].trim() : raw.trim();
  const model = typeof frontmatter.model === "string" ? parseModel(frontmatter.model) : undefined;
  const thinking = typeof frontmatter.thinking === "string" ? frontmatter.thinking : undefined;
  return {
    name,
    ...(typeof frontmatter.display_name === "string" ? { displayName: frontmatter.display_name } : {}),
    description: typeof frontmatter.description === "string" ? frontmatter.description : name,
    modelMode: model ? "fixed" : "inherit",
    ...(model ? { model } : {}),
    thinkingMode: thinking ? "fixed" : "inherit",
    ...(thinking ? { thinking: thinking as AgentDefinitionConfig["thinking"] } : {}),
    ...(typeof frontmatter.tools === "string" ? { tools: parseTools(frontmatter.tools) } : {}),
    extensions: frontmatter.extensions === "false" || frontmatter.extensions === false ? false : true,
    skills: frontmatter.skills === "false" || frontmatter.skills === false ? false : true,
    promptMode: frontmatter.prompt_mode === "append" ? "append" : "replace",
    enabled: frontmatter.enabled === "false" || frontmatter.enabled === false ? false : true,
    systemPrompt: body,
  };
}

function parseFrontmatter(source: string): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const line of source.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    if (rawValue === "true") result[key] = true;
    else if (rawValue === "false") result[key] = false;
    else result[key] = rawValue.replace(/^"|"$/g, "");
  }
  return result;
}

function parseModel(value: string): { providerId: string; modelId: string } | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0) return undefined;
  const providerId = value.slice(0, slash);
  const modelId = value.slice(slash + 1);
  return providerId && modelId ? { providerId, modelId } : undefined;
}

function parseTools(value: string): readonly AgentToolName[] {
  if (value.trim() === "none") return [];
  return value.split(",").map((tool) => tool.trim()).filter((tool): tool is AgentToolName => BUILTIN_TOOL_NAMES.includes(tool as AgentToolName));
}

function serializeAgentDefinition(config: AgentDefinitionConfig): string {
  const lines = ["---"];
  lines.push(`description: ${config.description}`);
  if (config.displayName) lines.push(`display_name: ${config.displayName}`);
  if (config.tools) lines.push(`tools: ${config.tools.length ? config.tools.join(", ") : "none"}`);
  if (!config.extensions) lines.push("extensions: false");
  if (!config.skills) lines.push("skills: false");
  if (config.modelMode === "fixed" && config.model) lines.push(`model: ${config.model.providerId}/${config.model.modelId}`);
  if (config.thinkingMode === "fixed" && config.thinking) lines.push(`thinking: ${config.thinking}`);
  lines.push(`prompt_mode: ${config.promptMode}`);
  if (!config.enabled) lines.push("enabled: false");
  lines.push("---", "", config.systemPrompt.trim(), "");
  return lines.join("\n");
}

function fallbackConfig(name: string): AgentDefinitionConfig {
  return {
    name,
    description: name,
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: "",
  };
}

function rankAgent(name: string): number {
  if (name === "general-purpose") return 0;
  if (name === "Explore") return 1;
  if (name === "Plan") return 2;
  return 10;
}
```

- [ ] **Step 4: Add IPC channel constants and preload methods**

In `apps/desktop/src/ipc.ts`, import the new types and add channels:

```ts
import type { AgentDefinitionsSnapshot, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "./agent-definitions";
```

Add to `desktopIpc`:

```ts
listAgentDefinitions: "pi-gui:list-agent-definitions",
saveAgentDefinition: "pi-gui:save-agent-definition",
resetAgentDefinition: "pi-gui:reset-agent-definition",
```

Add to `PiDesktopApi`:

```ts
listAgentDefinitions(workspaceId: string): Promise<AgentDefinitionsSnapshot>;
saveAgentDefinition(workspaceId: string, input: SaveAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>;
resetAgentDefinition(workspaceId: string, input: ResetAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>;
```

In `apps/desktop/electron/preload.ts`, import the types and add:

```ts
listAgentDefinitions: (workspaceId: string) =>
  ipcRenderer.invoke(desktopIpc.listAgentDefinitions, workspaceId) as Promise<AgentDefinitionsSnapshot>,
saveAgentDefinition: (workspaceId: string, input: SaveAgentDefinitionInput) =>
  ipcRenderer.invoke(desktopIpc.saveAgentDefinition, workspaceId, input) as Promise<AgentDefinitionsSnapshot>,
resetAgentDefinition: (workspaceId: string, input: ResetAgentDefinitionInput) =>
  ipcRenderer.invoke(desktopIpc.resetAgentDefinition, workspaceId, input) as Promise<AgentDefinitionsSnapshot>,
```

- [ ] **Step 5: Register IPC handlers**

In `apps/desktop/electron/main.ts`, import:

```ts
import { listAgentDefinitions, resetAgentDefinition, saveAgentDefinition } from "./agent-definitions";
```

Near other workspace-scoped handlers, add:

```ts
ipcMain.handle(desktopIpc.listAgentDefinitions, async (_event, workspaceId: string) => {
  return listAgentDefinitions(store.getWorkspacePath(workspaceId));
});
ipcMain.handle(desktopIpc.saveAgentDefinition, async (_event, workspaceId: string, input: SaveAgentDefinitionInput) => {
  return saveAgentDefinition(store.getWorkspacePath(workspaceId), input);
});
ipcMain.handle(desktopIpc.resetAgentDefinition, async (_event, workspaceId: string, input: ResetAgentDefinitionInput) => {
  return resetAgentDefinition(store.getWorkspacePath(workspaceId), input);
});
```

- [ ] **Step 6: Run the failing test again**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: still FAIL because UI is not implemented, but IPC compiles after typecheck.

- [ ] **Step 7: Commit persistence and IPC**

```bash
pnpm --filter @pi-gui/desktop typecheck
git add apps/desktop/electron/agent-definitions.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/src/ipc.ts apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Add agent definition persistence"
```

---

## Task 3: Add Settings → Agents V1 UI for built-in agent configuration

**Files:**
- Create: `apps/desktop/src/settings-agents-section.tsx`
- Create: `apps/desktop/src/agent-definition-editor.tsx`
- Modify: `apps/desktop/src/settings-utils.tsx`
- Modify: `apps/desktop/src/settings-view.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add settings section metadata**

In `apps/desktop/src/settings-utils.tsx`, change `SettingsSection` to:

```ts
export type SettingsSection = "appearance" | "general" | "providers" | "models" | "agents" | "notifications";
```

Add cases:

```ts
case "agents":
  return "Agents";
```

and:

```ts
case "agents":
  return "Configure subagents that Pi can spawn automatically during chat.";
```

- [ ] **Step 2: Create the editor dialog**

Create `apps/desktop/src/agent-definition-editor.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { AgentDefinitionConfig, AgentDefinitionScope, SaveAgentDefinitionInput } from "./agent-definitions";
import { THINKING_LEVELS, labelForThinking } from "./settings-utils";

interface AgentDefinitionEditorProps {
  readonly config: AgentDefinitionConfig;
  readonly runtime?: RuntimeSnapshot;
  readonly defaultScope: AgentDefinitionScope;
  readonly onClose: () => void;
  readonly onSave: (input: SaveAgentDefinitionInput) => void;
}

export function AgentDefinitionEditor({ config, runtime, defaultScope, onClose, onSave }: AgentDefinitionEditorProps) {
  const [scope, setScope] = useState<AgentDefinitionScope>(defaultScope);
  const [modelValue, setModelValue] = useState(
    config.modelMode === "fixed" && config.model ? `${config.model.providerId}:${config.model.modelId}` : "inherit",
  );
  const [thinkingValue, setThinkingValue] = useState(
    config.thinkingMode === "fixed" && config.thinking ? config.thinking : "inherit",
  );
  const enabledModels = useMemo(() => (runtime?.models ?? []).filter((model) => model.available), [runtime]);

  const save = () => {
    const [providerId, ...modelParts] = modelValue === "inherit" ? ["", ""] : modelValue.split(":");
    const modelId = modelParts.join(":");
    onSave({
      scope,
      config: {
        ...config,
        modelMode: modelValue === "inherit" ? "inherit" : "fixed",
        ...(modelValue === "inherit" ? { model: undefined } : { model: { providerId, modelId } }),
        thinkingMode: thinkingValue === "inherit" ? "inherit" : "fixed",
        ...(thinkingValue === "inherit" ? { thinking: undefined } : { thinking: thinkingValue as AgentDefinitionConfig["thinking"] }),
      },
    });
  };

  return (
    <div className="action-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-modal="true" className="action-dialog agent-definition-editor" data-testid="agent-definition-editor" role="dialog">
        <h2>Edit {config.name}</h2>
        <p>Configure the model and reasoning this subagent uses when Pi launches it automatically.</p>
        <label className="action-dialog__field">
          <span>Scope</span>
          <select aria-label="Scope" value={scope} onChange={(event) => setScope(event.target.value as AgentDefinitionScope)}>
            <option value="global">Global — all projects</option>
            <option value="project">Project — this workspace</option>
          </select>
        </label>
        <label className="action-dialog__field">
          <span>Model</span>
          <select aria-label="Model" value={modelValue} onChange={(event) => setModelValue(event.target.value)}>
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
          <select aria-label="Reasoning" value={thinkingValue} onChange={(event) => setThinkingValue(event.target.value)}>
            <option value="inherit">Inherit</option>
            <option value="off">Off</option>
            <option value="minimal">Minimal</option>
            {THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>{labelForThinking(level)}</option>
            ))}
          </select>
        </label>
        <div className="action-dialog__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="button" onClick={save}>Save</button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Create Agents settings section**

Create `apps/desktop/src/settings-agents-section.tsx`:

```tsx
import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { AgentDefinitionRecord, AgentDefinitionsSnapshot, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "./agent-definitions";
import { AgentDefinitionEditor } from "./agent-definition-editor";
import { SettingsGroup } from "./settings-utils";

interface SettingsAgentsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly snapshot?: AgentDefinitionsSnapshot;
  readonly onSave: (input: SaveAgentDefinitionInput) => void;
  readonly onReset: (input: ResetAgentDefinitionInput) => void;
}

export function SettingsAgentsSection({ runtime, snapshot, onSave, onReset }: SettingsAgentsSectionProps) {
  const [editing, setEditing] = useState<AgentDefinitionRecord | undefined>();
  const agents = snapshot?.agents ?? [];

  return (
    <div data-testid="settings-agents-section">
      <SettingsGroup
        title="Subagent definitions"
        description="Agents are launched naturally by Pi during chat. Configure what model, reasoning, and definition each agent type uses."
      >
        <div className="agent-definitions-list">
          {agents.map((agent) => (
            <div className="agent-definition-row" data-testid={`agent-definition-row-${agent.name}`} key={agent.name}>
              <div className="agent-definition-row__main">
                <div className="agent-definition-row__title">{agent.name}</div>
                <div className="agent-definition-row__description">{agent.config.description}</div>
                <div className="agent-definition-row__meta">
                  <span>{agent.source === "builtin" ? "Built-in" : agent.source === "project" ? "Project override" : "Global override"}</span>
                  <span>Model: {formatModel(agent)}</span>
                  <span>Reasoning: {formatThinking(agent)}</span>
                  <span>Prompt: {agent.config.promptMode}</span>
                </div>
                {agent.warnings.map((warning) => <div className="settings-warning" key={warning}>{warning}</div>)}
              </div>
              <div className="agent-definition-row__actions">
                <button className="button button--secondary" type="button" onClick={() => setEditing(agent)}>Edit</button>
                {agent.source !== "builtin" && agent.scope ? (
                  <button className="button button--secondary" type="button" onClick={() => onReset({ scope: agent.scope!, name: agent.name })}>Reset</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>
      {editing ? (
        <AgentDefinitionEditor
          config={editing.config}
          runtime={runtime}
          defaultScope={editing.scope ?? "global"}
          onClose={() => setEditing(undefined)}
          onSave={(input) => {
            onSave(input);
            setEditing(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function formatModel(agent: AgentDefinitionRecord): string {
  return agent.config.modelMode === "fixed" && agent.config.model
    ? `${agent.config.model.providerId}/${agent.config.model.modelId}`
    : "Inherit current thread";
}

function formatThinking(agent: AgentDefinitionRecord): string {
  if (agent.config.thinkingMode !== "fixed" || !agent.config.thinking) return "Inherit";
  if (agent.config.thinking === "xhigh") return "Extra High";
  return agent.config.thinking.charAt(0).toUpperCase() + agent.config.thinking.slice(1);
}
```

- [ ] **Step 4: Wire SettingsView**

In `apps/desktop/src/settings-view.tsx`, import:

```ts
import type { AgentDefinitionsSnapshot, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "./agent-definitions";
import { SettingsAgentsSection } from "./settings-agents-section";
```

Add props:

```ts
readonly agentDefinitions?: AgentDefinitionsSnapshot;
readonly onSaveAgentDefinition: (input: SaveAgentDefinitionInput) => void;
readonly onResetAgentDefinition: (input: ResetAgentDefinitionInput) => void;
```

Render:

```tsx
{section === "agents" ? (
  <SettingsAgentsSection
    runtime={runtime}
    snapshot={agentDefinitions}
    onSave={onSaveAgentDefinition}
    onReset={onResetAgentDefinition}
  />
) : null}
```

- [ ] **Step 5: Wire App state and nav item**

In `apps/desktop/src/App.tsx`, import agent definition types:

```ts
import type { AgentDefinitionsSnapshot, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "./agent-definitions";
```

Add state:

```ts
const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinitionsSnapshot | undefined>();
```

Add loader and handlers:

```ts
const loadAgentDefinitions = useCallback((workspaceId?: string) => {
  if (!api || !workspaceId) return;
  void api.listAgentDefinitions(workspaceId).then(setAgentDefinitions).catch((error) => {
    console.warn("Failed to load agent definitions", error);
  });
}, [api]);

const handleSaveAgentDefinition = (input: SaveAgentDefinitionInput) => {
  if (!api || !settingsWorkspace) return;
  void api.saveAgentDefinition(settingsWorkspace.id, input).then(setAgentDefinitions);
};

const handleResetAgentDefinition = (input: ResetAgentDefinitionInput) => {
  if (!api || !settingsWorkspace) return;
  void api.resetAgentDefinition(settingsWorkspace.id, input).then(setAgentDefinitions);
};
```

Add effect:

```ts
useEffect(() => {
  if (snapshot?.activeView === "settings" && settingsSection === "agents") {
    loadAgentDefinitions(settingsWorkspace?.id);
  }
}, [loadAgentDefinitions, settingsSection, settingsWorkspace?.id, snapshot?.activeView]);
```

Add nav item:

```ts
{ id: "agents", label: "Agents" },
```

Pass props to `SettingsView`:

```tsx
agentDefinitions={agentDefinitions}
onSaveAgentDefinition={handleSaveAgentDefinition}
onResetAgentDefinition={handleResetAgentDefinition}
```

- [ ] **Step 6: Add styles**

Append to `apps/desktop/src/styles/main.css`:

```css
.agent-definitions-list {
  display: grid;
  gap: 10px;
}

.agent-definition-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--surface-muted);
}

.agent-definition-row__main {
  min-width: 0;
}

.agent-definition-row__title {
  color: var(--text-strong);
  font-weight: 700;
}

.agent-definition-row__description {
  margin-top: 3px;
  color: var(--muted);
  font-size: 13px;
}

.agent-definition-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 9px;
  color: var(--muted-soft);
  font-size: 12px;
}

.agent-definition-row__meta span {
  max-width: 320px;
  overflow: hidden;
  padding: 4px 7px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-definition-row__actions {
  display: flex;
  gap: 8px;
}

.agent-definition-editor {
  width: min(620px, 100%);
}
```

- [ ] **Step 7: Run the V1 test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Run settings regression test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/skills-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit V1 UI**

```bash
git add apps/desktop/src/settings-utils.tsx apps/desktop/src/settings-view.tsx apps/desktop/src/settings-agents-section.tsx apps/desktop/src/agent-definition-editor.tsx apps/desktop/src/App.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Add subagent settings page"
```

---

## Task 4: Add unavailable model warnings and reset coverage

**Files:**
- Modify: `apps/desktop/src/settings-agents-section.tsx`
- Modify: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Extend test for unavailable configured model and reset**

Append this test to `apps/desktop/tests/core/agent-settings.spec.ts`:

```ts
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
```

- [ ] **Step 2: Implement warning derivation in renderer**

In `apps/desktop/src/settings-agents-section.tsx`, add:

```ts
function modelAvailable(runtime: RuntimeSnapshot | undefined, agent: AgentDefinitionRecord): boolean {
  if (agent.config.modelMode !== "fixed" || !agent.config.model) return true;
  return Boolean(runtime?.models.some((model) =>
    model.available &&
    model.providerId === agent.config.model?.providerId &&
    model.modelId === agent.config.model?.modelId,
  ));
}
```

Inside each row after persisted warnings, render:

```tsx
{!modelAvailable(runtime, agent) ? (
  <div className="settings-warning">Configured model is not currently available. The extension may fall back or fail until the provider is connected.</div>
) : null}
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit warnings**

```bash
git add apps/desktop/src/settings-agents-section.tsx apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Warn for unavailable subagent models"
```

---

## Task 5: Prepare V2 builder shell without enabling broad editing yet

**Files:**
- Modify: `apps/desktop/src/settings-agents-section.tsx`
- Modify: `apps/desktop/src/agent-definition-editor.tsx`
- Modify: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add a disabled New agent affordance with copy explaining V2**

In `SettingsAgentsSection`, above the list, add:

```tsx
<div className="settings-row">
  <div className="settings-row__label">
    <div className="settings-row__title">Custom agent builder</div>
    <div className="settings-row__description">Create new specialist agents with custom tools and prompts. Built-in overrides are available now; full custom creation is staged next.</div>
  </div>
  <div className="settings-row__control">
    <button className="button button--secondary" disabled type="button">New agent</button>
  </div>
</div>
```

This makes the future builder discoverable without shipping an incomplete creation flow.

- [ ] **Step 2: Add advanced fields hidden behind disclosure for existing agents**

In `AgentDefinitionEditor`, below reasoning, add:

```tsx
<details className="settings-disclosure">
  <summary className="settings-disclosure__summary">
    <span>Definition details</span>
    <span>{config.promptMode}</span>
  </summary>
  <div className="settings-disclosure__body">
    <label className="action-dialog__field">
      <span>System prompt</span>
      <textarea readOnly value={config.systemPrompt} />
    </label>
  </div>
</details>
```

This lets users inspect generated/ejected prompts without editing prompt text in V1.

- [ ] **Step 3: Extend test for V2 shell visibility**

In `agent-settings.spec.ts`, add after opening Agents page:

```ts
await expect(window.getByText("Custom agent builder", { exact: true })).toBeVisible();
await expect(window.getByRole("button", { name: "New agent" })).toBeDisabled();
```

- [ ] **Step 4: Run test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit V2 shell**

```bash
git add apps/desktop/src/settings-agents-section.tsx apps/desktop/src/agent-definition-editor.tsx apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "Prepare custom agent builder shell"
```

---

## Task 6: Final verification

**Files:**
- No source changes expected unless tests reveal a targeted fix.

- [ ] **Step 1: Run typecheck**

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 2: Run targeted E2E**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts apps/desktop/tests/core/skills-settings.spec.ts apps/desktop/tests/core/model-scope-toggle.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run full core lane**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected: full lane may still show known unrelated failures in `archive.spec.ts` and `unread-state.spec.ts`; no new failures should appear in `agent-settings.spec.ts`, `skills-settings.spec.ts`, `model-scope-toggle.spec.ts`, settings, or model-picker surfaces.

- [ ] **Step 4: Restart dev app**

```bash
pkill -f "pnpm --filter @pi-gui/desktop dev|electron-vite dev|/pi-gui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" || true
nohup pnpm --filter @pi-gui/desktop dev > /tmp/pi-gui-desktop-dev.log 2>&1 &
```

Expected: Electron launches from latest `main`, renderer available at `http://localhost:5173/`.

---

## Self-Review

- Spec coverage: The plan covers the requested dedicated Agents page, automatic subagent configuration rather than launch UI, exact provider/model support for local and remote models, built-in override support, global/project file locations, reset behavior, unavailable model warnings, and a staged V2 builder shell.
- Placeholder scan: No implementation step uses placeholder wording. V2 creation is explicitly out of scope and represented by a disabled shell with concrete copy.
- Type consistency: `AgentDefinitionsSnapshot`, `SaveAgentDefinitionInput`, and `ResetAgentDefinitionInput` are defined once in `apps/desktop/src/agent-definitions.ts` and reused consistently through IPC, preload, App, and settings components.
