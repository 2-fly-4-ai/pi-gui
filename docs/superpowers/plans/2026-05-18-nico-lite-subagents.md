# Nico-lite Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first useful Nico-lite subagents slice in `pi-gui`: canonical roles, compatibility aliases, unknown-frontmatter-safe role editing, built-in workflow templates, submitted run records, and readable timeline cards.

**Architecture:** Keep the existing `.pi/agents/*.md` storage and tintinweb-compatible execution path, but rename the visible product to Subagents and extend the model behind it. Add focused shared modules for role metadata, workflow templates, submitted run records, and timeline card detection; avoid a second runtime system or Nico dependency.

**Tech Stack:** Electron main/preload IPC, React renderer, TypeScript shared types, Playwright desktop E2E tests, existing markdown frontmatter files under global/project `.pi/agents` directories.

---

## Success criteria for this plan

- Settings sidebar says **Subagents** and opens a unified Subagents page.
- Roles tab shows built-ins `delegate`, `scout`, `planner`, `worker`, `reviewer`, `oracle`, `researcher`, and `context-builder`.
- Legacy aliases `general-purpose`, `Explore`, and `Plan` still read/write existing files and are displayed as aliases of `delegate`, `scout`, and `planner`.
- Saving an agent markdown file through the GUI preserves unknown frontmatter such as `default_context`, `default_reads`, and `max_subagent_depth`.
- The editor can save first-slice Nico-lite fields: `role`, `context_mode`, `output`, `default_progress`, `inherit_project_context`, `max_subagent_depth`, `fallback_models`, and `default_reads`.
- Workflows tab offers built-in workflow cards and can submit a structured prompt into the selected thread via existing composer submission.
- Runs tab shows submitted workflow runs with role steps, status `submitted`, target thread, and expected artifacts.
- Timeline renders submitted subagent workflow marker messages as compact cards, while raw transcript content remains available in source data.
- Verification passes: focused agent settings E2E, focused timeline card E2E, typecheck, and full desktop core before completion.

## File structure

### Shared model and helpers

- Modify `apps/desktop/src/agent-definitions.ts`
  - Extend `AgentDefinitionConfig` with Nico-lite optional fields.
  - Add canonical role metadata and legacy alias helpers.
  - Add built-in role configs for canonical role names.
- Create `apps/desktop/src/subagent-workflows.ts`
  - Built-in workflow template definitions.
  - Prompt builder for submitting workflow runs through existing composer API.
  - In-memory/submitted run record types.
- Create `apps/desktop/src/subagent-timeline-card.ts`
  - Detect structured workflow marker messages in timeline items.
  - Parse into a compact render model.

### Electron main/preload

- Modify `apps/desktop/electron/agent-definitions.ts`
  - Parse/serialize richer frontmatter.
  - Preserve unknown frontmatter fields across GUI edits.
  - Keep safe path validation and existing directory layout.
- Modify `apps/desktop/src/ipc.ts`, `apps/desktop/electron/preload.ts`, `apps/desktop/electron/main.ts`
  - Add `runSubagentWorkflow` and `listSubagentRuns` IPC endpoints.
- Create `apps/desktop/electron/subagent-runs.ts`
  - Small in-memory run store and workflow submission helper.
  - Submit via `DesktopAppStore.submitComposerToSession`.

### Renderer UI

- Modify `apps/desktop/src/settings-utils.tsx`
  - Keep internal section key `agents` for minimal churn, but display title `Subagents`.
- Modify `apps/desktop/src/settings-models-section.tsx`
  - Link text should point to Subagents, not Agents.
- Modify `apps/desktop/src/settings-view.tsx`
  - Pass workflow props into the subagents section.
- Modify `apps/desktop/src/settings-agents-section.tsx`
  - Rename visible copy to Subagents.
  - Add tabs: Roles, Workflows, Runs.
  - Show role/alias metadata in role rows.
  - Render workflow cards and submitted run rows.
- Modify `apps/desktop/src/agent-definition-form.ts`
  - Add form state/build/validation for Nico-lite fields.
- Modify `apps/desktop/src/agent-definition-editor.tsx`
  - Add Role, Context mode, Output, Progress, default reads, fallback models, and max depth controls.
  - Keep advanced controls collapsed or grouped so the editor remains usable.
- Modify `apps/desktop/src/timeline-item.tsx`
  - Render workflow marker messages via `SubagentTimelineCard`.
- Modify `apps/desktop/src/styles/main.css`
  - Add styles for subagent tabs/cards/run rows/timeline cards.

### Tests

- Modify `apps/desktop/tests/core/agent-settings.spec.ts`
  - Update settings copy expectations.
  - Add role aliases and unknown-frontmatter preservation tests.
  - Add workflow submit/runs test.
- Create `apps/desktop/tests/core/subagent-timeline-card.spec.ts`
  - Verify structured workflow marker renders as compact card.

---

## Task 1: Rename visible Settings product from Agents to Subagents

**Files:**
- Modify: `apps/desktop/src/settings-utils.tsx`
- Modify: `apps/desktop/src/settings-models-section.tsx`
- Modify: `apps/desktop/src/settings-agents-section.tsx`
- Modify: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Update the focused E2E expectations first**

In `apps/desktop/tests/core/agent-settings.spec.ts`, replace settings navigation and heading assertions so the visible product is Subagents. Keep the file name for now to avoid unnecessary test churn.

Use these expectation changes:

```ts
await window.getByRole("button", { name: "Subagents", exact: true }).click();
await expect(window.getByTestId("settings-agents-section")).toBeVisible();
await expect(window.getByText("Role builder", { exact: true })).toBeVisible();
await expect(window.getByRole("button", { name: "New role" })).toBeEnabled();
```

Change the models-link test ending to:

```ts
await window.getByRole("button", { name: "Configure subagents" }).click();
await expect(window.getByRole("heading", { name: "Subagents" })).toBeVisible();
await expect(window.getByTestId("settings-agents-section")).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify it fails for the expected labels**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: FAIL because the UI still says `Agents`, `Custom agent builder`, and `New agent`.

- [ ] **Step 3: Update settings title/description**

In `apps/desktop/src/settings-utils.tsx`, change only the visible label for section key `agents`:

```ts
case "agents":
  return "Subagents";
```

and:

```ts
case "agents":
  return "Configure roles and workflows that Pi can delegate to during chat.";
```

Do not rename the `SettingsSection` union member yet; keeping `"agents"` avoids touching routing/state persistence.

- [ ] **Step 4: Update models section copy**

In `apps/desktop/src/settings-models-section.tsx`, update the row description to:

```tsx
<SettingsRow title="Role-specific models" description="Configure delegate, scout, planner, reviewer, and custom subagent roles from Settings → Subagents.">
  <button className="button button--secondary" type="button" onClick={onOpenAgentsSettings}>Configure subagents</button>
</SettingsRow>
```

- [ ] **Step 5: Update settings subagents section visible copy**

In `apps/desktop/src/settings-agents-section.tsx`, update the top group copy:

```tsx
<SettingsGroup title="Subagent roles" description="Roles define the specialists Pi can delegate to. Existing .pi/agents markdown files still work.">
  <div className="settings-row">
    <div className="settings-row__label">
      <div className="settings-row__title">Role builder</div>
      <div className="settings-row__description">Create specialist roles as markdown definitions under the selected global or project agents folder.</div>
    </div>
    <div className="settings-row__control">
      <button className="button button--primary" disabled={pending} type="button" onClick={openNew}>New role</button>
    </div>
  </div>
```

Keep `data-testid="settings-agents-section"` for compatibility.

- [ ] **Step 6: Run focused test again**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS for label-only changes, or fail only where later tasks intentionally update role names.

- [ ] **Step 7: Commit label change**

```bash
git add apps/desktop/src/settings-utils.tsx apps/desktop/src/settings-models-section.tsx apps/desktop/src/settings-agents-section.tsx apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "feat(desktop): rename agents settings to subagents"
```

---

## Task 2: Add canonical role model, built-ins, and legacy alias metadata

**Files:**
- Modify: `apps/desktop/src/agent-definitions.ts`
- Modify: `apps/desktop/electron/agent-definitions.ts`
- Modify: `apps/desktop/src/settings-agents-section.tsx`
- Modify: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add failing E2E expectations for canonical roles and aliases**

In the first test in `apps/desktop/tests/core/agent-settings.spec.ts`, replace old built-in expectations with:

```ts
await expect(window.getByTestId("agent-definition-row-delegate")).toContainText("Delegate");
await expect(window.getByTestId("agent-definition-row-scout")).toContainText("Scout");
await expect(window.getByTestId("agent-definition-row-planner")).toContainText("Planner");
await expect(window.getByTestId("agent-definition-row-worker")).toContainText("Worker");
await expect(window.getByTestId("agent-definition-row-reviewer")).toContainText("Reviewer");
await expect(window.getByTestId("agent-definition-row-oracle")).toContainText("Oracle");
await expect(window.getByTestId("agent-definition-row-researcher")).toContainText("Researcher");
await expect(window.getByTestId("agent-definition-row-context-builder")).toContainText("Context Builder");
await expect(window.getByTestId("agent-definition-row-general-purpose")).toContainText("Legacy alias for delegate");
await expect(window.getByTestId("agent-definition-row-Explore")).toContainText("Legacy alias for scout");
await expect(window.getByTestId("agent-definition-row-Plan")).toContainText("Legacy alias for planner");
```

Keep later tests that edit `general-purpose`, duplicate `Explore`, and reset `Plan`. Those tests prove compatibility.

- [ ] **Step 2: Run the focused test and verify canonical rows are missing**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: FAIL on missing `agent-definition-row-delegate`.

- [ ] **Step 3: Extend shared role metadata**

In `apps/desktop/src/agent-definitions.ts`, add these types and constants near the existing type definitions:

```ts
export type SubagentRoleName =
  | "delegate"
  | "scout"
  | "planner"
  | "worker"
  | "reviewer"
  | "oracle"
  | "researcher"
  | "context-builder"
  | string;

export type SubagentContextMode = "fresh" | "fork" | "project";
export type SubagentOutputMode = "message" | "artifact" | "both";
export type SubagentProgressMode = "silent" | "summary" | "stream";

export interface SubagentModelRef {
  readonly providerId: string;
  readonly modelId: string;
}

export interface AgentDefinitionExtraFrontmatter {
  readonly [key: string]: string | boolean | number | readonly string[];
}
```

Extend `AgentDefinitionConfig` with:

```ts
readonly role?: SubagentRoleName;
readonly systemPromptMode?: "append" | "replace";
readonly contextMode?: SubagentContextMode;
readonly inheritProjectContext?: boolean;
readonly fallbackModels?: readonly SubagentModelRef[];
readonly output?: SubagentOutputMode;
readonly defaultReads?: readonly string[];
readonly defaultProgress?: SubagentProgressMode;
readonly maxSubagentDepth?: number;
readonly extraFrontmatter?: AgentDefinitionExtraFrontmatter;
```

- [ ] **Step 4: Add canonical role prompts**

In `apps/desktop/src/agent-definitions.ts`, keep the existing `DEFAULT_EXPLORE_PROMPT` and `DEFAULT_PLAN_PROMPT`. Add these shorter prompts:

```ts
export const DEFAULT_WORKER_PROMPT = `You are a focused implementation worker.

Complete the delegated task in the current repository. Keep changes small, follow existing patterns, run targeted verification when possible, and report exactly what changed.`;

export const DEFAULT_REVIEWER_PROMPT = `You are a strict code reviewer.

Review the delegated diff, plan, or artifact for correctness, tests, maintainability, and product fit. Return findings with severity, file references, and concrete fixes. Do not modify files.`;

export const DEFAULT_ORACLE_PROMPT = `You are an oracle agent for second opinions.

Challenge assumptions, identify hidden risks, compare alternatives, and recommend a path. Do not modify files unless explicitly asked.`;

export const DEFAULT_RESEARCHER_PROMPT = `You are a research specialist.

Find relevant documentation and source-backed facts, summarize them concisely, and cite links or file paths. Avoid implementation unless explicitly asked.`;

export const DEFAULT_CONTEXT_BUILDER_PROMPT = `You are a context builder.

Create a compact handoff artifact that captures goals, constraints, decisions, touched files, verification, and remaining risks for another agent.`;
```

- [ ] **Step 5: Replace built-in configs with canonical roles plus legacy aliases**

In `apps/desktop/src/agent-definitions.ts`, replace `BUILTIN_AGENT_NAMES` and `BUILTIN_AGENT_CONFIGS` with:

```ts
export const CANONICAL_SUBAGENT_ROLES = [
  "delegate",
  "scout",
  "planner",
  "worker",
  "reviewer",
  "oracle",
  "researcher",
  "context-builder",
] as const;

export const LEGACY_AGENT_ALIASES: Readonly<Record<string, SubagentRoleName>> = {
  "general-purpose": "delegate",
  Explore: "scout",
  Plan: "planner",
};

export function canonicalRoleForAgentName(name: string, configuredRole?: string): string {
  return configuredRole || LEGACY_AGENT_ALIASES[name] || name;
}

export const BUILTIN_AGENT_NAMES = [
  ...CANONICAL_SUBAGENT_ROLES,
  "general-purpose",
  "Explore",
  "Plan",
] as const;
```

Build `BUILTIN_AGENT_CONFIGS` with canonical records first, then legacy aliases. Use this exact shape for `delegate`, `scout`, and `planner`:

```ts
{
  name: "delegate",
  displayName: "Delegate",
  role: "delegate",
  description: "General-purpose delegated agent for complex tasks",
  modelMode: "inherit",
  thinkingMode: "inherit",
  extensions: true,
  skills: true,
  promptMode: "append",
  systemPromptMode: "append",
  contextMode: "fork",
  output: "message",
  defaultProgress: "summary",
  enabled: true,
  systemPrompt: DEFAULT_GENERAL_PURPOSE_PROMPT,
},
{
  name: "scout",
  displayName: "Scout",
  role: "scout",
  description: "Fast read-only codebase reconnaissance",
  modelMode: "inherit",
  thinkingMode: "inherit",
  tools: READ_ONLY_AGENT_TOOLS,
  extensions: true,
  skills: true,
  promptMode: "replace",
  systemPromptMode: "replace",
  contextMode: "project",
  output: "artifact",
  defaultProgress: "summary",
  enabled: true,
  systemPrompt: DEFAULT_EXPLORE_PROMPT,
},
{
  name: "planner",
  displayName: "Planner",
  role: "planner",
  description: "Read-only implementation planning specialist",
  modelMode: "inherit",
  thinkingMode: "inherit",
  tools: READ_ONLY_AGENT_TOOLS,
  extensions: true,
  skills: true,
  promptMode: "replace",
  systemPromptMode: "replace",
  contextMode: "project",
  output: "artifact",
  defaultProgress: "summary",
  enabled: true,
  systemPrompt: DEFAULT_PLAN_PROMPT,
}
```

Then add `worker`, `reviewer`, `oracle`, `researcher`, `context-builder` using the prompts from Step 4. Legacy records keep existing names but include `role` and display names such as `Explore (legacy)`.

- [ ] **Step 6: Update rank ordering**

In `apps/desktop/electron/agent-definitions.ts`, replace `rankAgent` with:

```ts
function rankAgent(name: string): number {
  const order = [
    "delegate",
    "scout",
    "planner",
    "worker",
    "reviewer",
    "oracle",
    "researcher",
    "context-builder",
    "general-purpose",
    "Explore",
    "Plan",
  ];
  const index = order.indexOf(name);
  return index === -1 ? 100 : index;
}
```

- [ ] **Step 7: Display role and alias metadata in rows**

In `apps/desktop/src/settings-agents-section.tsx`, import `canonicalRoleForAgentName` and `LEGACY_AGENT_ALIASES`. In the metadata row, add:

```tsx
<span>Role: {canonicalRoleForAgentName(agent.name, agent.config.role)}</span>
{LEGACY_AGENT_ALIASES[agent.name] ? <span>Legacy alias for {LEGACY_AGENT_ALIASES[agent.name]}</span> : null}
```

- [ ] **Step 8: Run focused test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS, including legacy edit/duplicate/reset compatibility.

- [ ] **Step 9: Commit role model and aliases**

```bash
git add apps/desktop/src/agent-definitions.ts apps/desktop/electron/agent-definitions.ts apps/desktop/src/settings-agents-section.tsx apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "feat(desktop): add canonical subagent roles"
```

---

## Task 3: Preserve unknown frontmatter and serialize Nico-lite fields

**Files:**
- Modify: `apps/desktop/electron/agent-definitions.ts`
- Modify: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add a failing preservation test**

Append this test to `apps/desktop/tests/core/agent-settings.spec.ts`:

```ts
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
default_context: repo-map
unknown_flag: true
unknown_number: 7
unknown_list: scout, planner
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
    await row.getByRole("button", { name: "Edit" }).click();
    const dialog = window.getByTestId("agent-definition-editor");
    await dialog.getByLabel("Description").fill("Rich imported reviewer");
    await dialog.getByLabel("Output").selectOption("both");
    await dialog.getByRole("button", { name: "Save" }).click();

    const saved = await readFile(join(agentDir, "agents", "legacy-rich.md"), "utf8");
    expect(saved).toContain('description: "Rich imported reviewer"');
    expect(saved).toContain("role: reviewer");
    expect(saved).toContain("output: both");
    expect(saved).toContain("default_context: repo-map");
    expect(saved).toContain("unknown_flag: true");
    expect(saved).toContain("unknown_number: 7");
    expect(saved).toContain("unknown_list: scout, planner");
    expect(saved).toContain("fallback_models: openai/gpt-5, anthropic/claude-sonnet-4-5");
    expect(saved).toContain("max_subagent_depth: 2");
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run the focused test and verify unknown fields are dropped**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts --grep "preserves unknown frontmatter"
```

Expected: FAIL because current serializer drops unknown fields and the editor lacks Output.

- [ ] **Step 3: Upgrade frontmatter value parsing**

In `apps/desktop/electron/agent-definitions.ts`, change `parseFrontmatter` return type to:

```ts
type FrontmatterValue = string | boolean | number | readonly string[];
type FrontmatterRecord = Record<string, FrontmatterValue>;
```

Replace `parseFrontmatter` with:

```ts
function parseFrontmatter(source: string): FrontmatterRecord {
  const result: FrontmatterRecord = {};
  for (const line of source.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    if (!key) continue;
    if (rawValue === "true") result[key] = true;
    else if (rawValue === "false") result[key] = false;
    else if (/^-?\d+$/.test(rawValue)) result[key] = Number.parseInt(rawValue, 10);
    else result[key] = parseFrontmatterString(rawValue);
  }
  return result;
}
```

Keep comma-separated values as strings in this slice so existing formatting remains stable.

- [ ] **Step 4: Preserve unknown keys during parse**

In `parseAgentDefinition`, define known keys:

```ts
const knownFrontmatterKeys = new Set([
  "description",
  "display_name",
  "tools",
  "extensions",
  "skills",
  "model",
  "thinking",
  "prompt_mode",
  "system_prompt_mode",
  "context_mode",
  "inherit_project_context",
  "fallback_models",
  "output",
  "default_reads",
  "default_progress",
  "max_turns",
  "max_subagent_depth",
  "inherit_context",
  "run_in_background",
  "isolated",
  "isolation",
  "enabled",
  "role",
]);
const extraFrontmatter = Object.fromEntries(
  Object.entries(frontmatter).filter(([key]) => !knownFrontmatterKeys.has(key)),
);
```

Add parsed config properties:

```ts
role: typeof frontmatter.role === "string" ? frontmatter.role : undefined,
systemPromptMode: frontmatter.system_prompt_mode === "append" ? "append" : frontmatter.system_prompt_mode === "replace" ? "replace" : undefined,
contextMode: parseContextMode(frontmatter.context_mode),
inheritProjectContext: typeof frontmatter.inherit_project_context === "boolean" ? frontmatter.inherit_project_context : undefined,
fallbackModels: typeof frontmatter.fallback_models === "string" ? parseModelList(frontmatter.fallback_models) : undefined,
output: parseOutputMode(frontmatter.output),
defaultReads: typeof frontmatter.default_reads === "string" ? parseStringList(frontmatter.default_reads) : undefined,
defaultProgress: parseProgressMode(frontmatter.default_progress),
maxSubagentDepth: parsePositiveIntegerValue(frontmatter.max_subagent_depth),
extraFrontmatter,
```

- [ ] **Step 5: Add helper parsers**

Add these helpers below `parseTools`:

```ts
function parseStringList(value: string): readonly string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseModelList(value: string): readonly { providerId: string; modelId: string }[] | undefined {
  const models = parseStringList(value).flatMap((entry) => {
    const parsed = parseModel(entry);
    return parsed ? [parsed] : [];
  });
  return models.length ? models : undefined;
}

function parseContextMode(value: FrontmatterValue | undefined): "fresh" | "fork" | "project" | undefined {
  return value === "fresh" || value === "fork" || value === "project" ? value : undefined;
}

function parseOutputMode(value: FrontmatterValue | undefined): "message" | "artifact" | "both" | undefined {
  return value === "message" || value === "artifact" || value === "both" ? value : undefined;
}

function parseProgressMode(value: FrontmatterValue | undefined): "silent" | "summary" | "stream" | undefined {
  return value === "silent" || value === "summary" || value === "stream" ? value : undefined;
}

function parsePositiveIntegerValue(value: FrontmatterValue | undefined): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value === "string") return parsePositiveInteger(value);
  return undefined;
}
```

- [ ] **Step 6: Serialize extra and known Nico-lite fields safely**

In `serializeAgentDefinition`, after `description`/`display_name`, emit:

```ts
if (config.role) lines.push(`role: ${quoteFrontmatterScalar(config.role)}`);
if (config.systemPromptMode) lines.push(`system_prompt_mode: ${config.systemPromptMode}`);
if (config.contextMode) lines.push(`context_mode: ${config.contextMode}`);
if (config.inheritProjectContext !== undefined) lines.push(`inherit_project_context: ${config.inheritProjectContext}`);
if (config.fallbackModels?.length) lines.push(`fallback_models: ${config.fallbackModels.map((model) => `${model.providerId}/${model.modelId}`).join(", ")}`);
if (config.output) lines.push(`output: ${config.output}`);
if (config.defaultReads?.length) lines.push(`default_reads: ${config.defaultReads.join(", ")}`);
if (config.defaultProgress) lines.push(`default_progress: ${config.defaultProgress}`);
if (config.maxSubagentDepth !== undefined) lines.push(`max_subagent_depth: ${config.maxSubagentDepth}`);
for (const [key, value] of Object.entries(config.extraFrontmatter ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
  lines.push(`${key}: ${formatFrontmatterValue(value)}`);
}
```

Add:

```ts
function quoteFrontmatterScalar(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : JSON.stringify(value);
}

function formatFrontmatterValue(value: string | boolean | number | readonly string[]): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return quoteFrontmatterScalar(value);
}
```

Keep `quoteFrontmatterString` for description/display name to preserve existing tests expecting JSON quotes.

- [ ] **Step 7: Validate new fields**

In `validateSaveInput`, add:

```ts
if (config.contextMode && !["fresh", "fork", "project"].includes(config.contextMode)) throw new Error("Invalid subagent context mode.");
if (config.output && !["message", "artifact", "both"].includes(config.output)) throw new Error("Invalid subagent output mode.");
if (config.defaultProgress && !["silent", "summary", "stream"].includes(config.defaultProgress)) throw new Error("Invalid subagent progress mode.");
if (config.maxSubagentDepth !== undefined && (!Number.isInteger(config.maxSubagentDepth) || config.maxSubagentDepth < 0)) throw new Error("Max subagent depth must be a non-negative integer.");
if (config.fallbackModels?.some((model) => !model.providerId || !model.modelId)) throw new Error("Fallback models require provider and model IDs.");
```

- [ ] **Step 8: Run parser test again**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts --grep "preserves unknown frontmatter"
```

Expected: still FAIL until editor fields are added in Task 4, but saved output should preserve unknown fields once the Output control exists.

- [ ] **Step 9: Commit parser/serializer after Task 4 passes the test**

Do not commit at the end of Task 3 if the focused test is still red. Commit Task 3 together with Task 4 when the UI can save the field.

---

## Task 4: Add first-slice Nico-lite fields to the role editor

**Files:**
- Modify: `apps/desktop/src/agent-definition-form.ts`
- Modify: `apps/desktop/src/agent-definition-editor.tsx`
- Modify: `apps/desktop/src/settings-agents-section.tsx`
- Modify: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Extend form state**

In `apps/desktop/src/agent-definition-form.ts`, add imports/types from `agent-definitions`:

```ts
import type {
  AgentDefinitionConfig,
  AgentDefinitionScope,
  AgentThinkingLevel,
  AgentToolName,
  SubagentContextMode,
  SubagentOutputMode,
  SubagentProgressMode,
} from "./agent-definitions";
```

Add fields to `AgentDefinitionFormState`:

```ts
readonly role: string;
readonly contextMode: "" | SubagentContextMode;
readonly output: "" | SubagentOutputMode;
readonly defaultProgress: "" | SubagentProgressMode;
readonly inheritProjectContext: boolean;
readonly maxSubagentDepth: string;
readonly fallbackModels: string;
readonly defaultReads: string;
readonly extraFrontmatter: AgentDefinitionConfig["extraFrontmatter"];
```

- [ ] **Step 2: Populate form state from config**

In `createAgentDefinitionFormState`, add:

```ts
role: input.config.role ?? "",
contextMode: input.config.contextMode ?? "",
output: input.config.output ?? "",
defaultProgress: input.config.defaultProgress ?? "",
inheritProjectContext: input.config.inheritProjectContext ?? false,
maxSubagentDepth: input.config.maxSubagentDepth !== undefined ? String(input.config.maxSubagentDepth) : "",
fallbackModels: input.config.fallbackModels?.map((model) => `${model.providerId}/${model.modelId}`).join(", ") ?? "",
defaultReads: input.config.defaultReads?.join(", ") ?? "",
extraFrontmatter: input.config.extraFrontmatter,
```

- [ ] **Step 3: Add validation for text-list fields**

In `validateAgentDefinitionForm`, add:

```ts
if (state.maxSubagentDepth.trim()) {
  const parsed = Number.parseInt(state.maxSubagentDepth, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push("Max subagent depth must be zero or a positive integer.");
  }
}
for (const model of splitCommaList(state.fallbackModels)) {
  if (!/^[^/]+\/.+$/.test(model)) {
    errors.push("Fallback models must use provider/model format.");
    break;
  }
}
```

Add helper:

```ts
function splitCommaList(value: string): readonly string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Build config with new fields**

In `buildAgentDefinitionConfig`, compute:

```ts
const fallbackModels = splitCommaList(state.fallbackModels).map((entry) => {
  const slash = entry.indexOf("/");
  return { providerId: entry.slice(0, slash), modelId: entry.slice(slash + 1) };
});
const defaultReads = splitCommaList(state.defaultReads);
const maxSubagentDepth = state.maxSubagentDepth.trim() ? Number.parseInt(state.maxSubagentDepth, 10) : undefined;
```

Add config properties:

```ts
role: state.role.trim() || undefined,
systemPromptMode: state.promptMode,
contextMode: state.contextMode || undefined,
inheritProjectContext: state.inheritProjectContext || undefined,
fallbackModels: fallbackModels.length ? fallbackModels : undefined,
output: state.output || undefined,
defaultReads: defaultReads.length ? defaultReads : undefined,
defaultProgress: state.defaultProgress || undefined,
maxSubagentDepth,
extraFrontmatter: state.extraFrontmatter,
```

- [ ] **Step 5: Add editor controls**

In `apps/desktop/src/agent-definition-editor.tsx`, add fields in the grid after Description:

```tsx
<label className="action-dialog__field">
  <span>Role</span>
  <select aria-label="Role" className="settings-select" value={form.role} onChange={(event) => update("role", event.target.value)}>
    <option value="">Infer from name</option>
    <option value="delegate">Delegate</option>
    <option value="scout">Scout</option>
    <option value="planner">Planner</option>
    <option value="worker">Worker</option>
    <option value="reviewer">Reviewer</option>
    <option value="oracle">Oracle</option>
    <option value="researcher">Researcher</option>
    <option value="context-builder">Context Builder</option>
  </select>
</label>
<label className="action-dialog__field">
  <span>Context</span>
  <select aria-label="Context mode" className="settings-select" value={form.contextMode} onChange={(event) => update("contextMode", event.target.value as AgentDefinitionFormState["contextMode"])}>
    <option value="">Default</option>
    <option value="fresh">Fresh</option>
    <option value="fork">Fork current thread</option>
    <option value="project">Project context</option>
  </select>
</label>
<label className="action-dialog__field">
  <span>Output</span>
  <select aria-label="Output" className="settings-select" value={form.output} onChange={(event) => update("output", event.target.value as AgentDefinitionFormState["output"])}>
    <option value="">Default</option>
    <option value="message">Message</option>
    <option value="artifact">Artifact</option>
    <option value="both">Message + artifact</option>
  </select>
</label>
<label className="action-dialog__field">
  <span>Progress</span>
  <select aria-label="Progress" className="settings-select" value={form.defaultProgress} onChange={(event) => update("defaultProgress", event.target.value as AgentDefinitionFormState["defaultProgress"])}>
    <option value="">Default</option>
    <option value="silent">Silent</option>
    <option value="summary">Summary</option>
    <option value="stream">Stream</option>
  </select>
</label>
```

Add advanced text inputs near Max turns:

```tsx
<label className="action-dialog__field">
  <span>Fallback models</span>
  <input aria-label="Fallback models" placeholder="openai/gpt-5, anthropic/claude-sonnet-4-5" value={form.fallbackModels} onChange={(event) => update("fallbackModels", event.target.value)} />
</label>
<label className="action-dialog__field">
  <span>Default reads</span>
  <input aria-label="Default reads" placeholder="README.md, AGENTS.md" value={form.defaultReads} onChange={(event) => update("defaultReads", event.target.value)} />
</label>
<label className="action-dialog__field">
  <span>Max subagent depth</span>
  <input aria-label="Max subagent depth" inputMode="numeric" value={form.maxSubagentDepth} onChange={(event) => update("maxSubagentDepth", event.target.value)} />
</label>
<label className="agent-definition-editor__inline-check">
  <input aria-label="Inherit project context" checked={form.inheritProjectContext} type="checkbox" onChange={(event) => update("inheritProjectContext", event.target.checked)} />
  <span>Inherit project context</span>
</label>
```

- [ ] **Step 6: Show new metadata in role rows**

In `apps/desktop/src/settings-agents-section.tsx`, add metadata spans:

```tsx
{agent.config.contextMode ? <span>Context: {agent.config.contextMode}</span> : null}
{agent.config.output ? <span>Output: {agent.config.output}</span> : null}
{agent.config.defaultProgress ? <span>Progress: {agent.config.defaultProgress}</span> : null}
{agent.config.maxSubagentDepth !== undefined ? <span>Max depth: {agent.config.maxSubagentDepth}</span> : null}
```

- [ ] **Step 7: Run preservation test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts --grep "preserves unknown frontmatter"
```

Expected: PASS.

- [ ] **Step 8: Run all agent settings tests**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit frontmatter and editor fields**

```bash
git add apps/desktop/electron/agent-definitions.ts apps/desktop/src/agent-definition-form.ts apps/desktop/src/agent-definition-editor.tsx apps/desktop/src/settings-agents-section.tsx apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "feat(desktop): preserve rich subagent role metadata"
```

---

## Task 5: Add built-in workflow templates and submitted run records

**Files:**
- Create: `apps/desktop/src/subagent-workflows.ts`
- Create: `apps/desktop/electron/subagent-runs.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/settings-view.tsx`
- Modify: `apps/desktop/src/settings-agents-section.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/tests/core/agent-settings.spec.ts`

- [ ] **Step 1: Add failing workflow E2E**

Append to `apps/desktop/tests/core/agent-settings.spec.ts`:

```ts
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

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.locator(".timeline")).toContainText("SUBAGENT_WORKFLOW_RUN");
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run workflow test and verify Workflows tab is missing**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts --grep "submits a built-in workflow"
```

Expected: FAIL on missing `Workflows` tab.

- [ ] **Step 3: Create shared workflow module**

Create `apps/desktop/src/subagent-workflows.ts` with:

```ts
import type { WorkspaceSessionTarget } from "./desktop-state";

export type SubagentWorkflowId =
  | "scout-then-plan"
  | "implement-with-worker"
  | "review-current-diff"
  | "parallel-review"
  | "oracle-second-opinion"
  | "review-loop";

export interface SubagentWorkflowTemplate {
  readonly id: SubagentWorkflowId;
  readonly title: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
}

export type SubagentRunStatus = "submitted" | "failed";

export interface SubagentRunRecord {
  readonly id: string;
  readonly workflowId: SubagentWorkflowId;
  readonly title: string;
  readonly workspaceId: string;
  readonly target: WorkspaceSessionTarget;
  readonly status: SubagentRunStatus;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
  readonly submittedAt: string;
  readonly error?: string;
}

export interface RunSubagentWorkflowInput {
  readonly workflowId: SubagentWorkflowId;
  readonly target: WorkspaceSessionTarget;
  readonly userInstruction?: string;
}

export const BUILTIN_SUBAGENT_WORKFLOWS: readonly SubagentWorkflowTemplate[] = [
  {
    id: "scout-then-plan",
    title: "Scout then plan",
    description: "Ask scout to map the repo, then planner to produce an implementation plan.",
    roles: ["scout", "planner"],
    artifacts: ["context.md", "plan.md"],
  },
  {
    id: "implement-with-worker",
    title: "Implement with worker",
    description: "Delegate a bounded implementation task to worker.",
    roles: ["worker"],
    artifacts: ["progress.md"],
  },
  {
    id: "review-current-diff",
    title: "Review current diff",
    description: "Review the current working tree for correctness, tests, and maintainability.",
    roles: ["reviewer"],
    artifacts: ["review.md"],
  },
  {
    id: "parallel-review",
    title: "Parallel review",
    description: "Run correctness, tests, and simplicity review perspectives in parallel.",
    roles: ["reviewer/correctness", "reviewer/tests", "reviewer/simplicity"],
    artifacts: ["review-correctness.md", "review-tests.md", "review-simplicity.md"],
  },
  {
    id: "oracle-second-opinion",
    title: "Oracle second opinion",
    description: "Challenge assumptions and compare alternatives before committing to an approach.",
    roles: ["oracle"],
    artifacts: ["oracle.md"],
  },
  {
    id: "review-loop",
    title: "Review loop",
    description: "Review, apply accepted fixes with worker, then review once more.",
    roles: ["reviewer", "worker", "reviewer"],
    artifacts: ["review.md", "progress.md", "final-review.md"],
  },
];

export function workflowById(id: SubagentWorkflowId): SubagentWorkflowTemplate {
  const workflow = BUILTIN_SUBAGENT_WORKFLOWS.find((entry) => entry.id === id);
  if (!workflow) throw new Error(`Unknown subagent workflow: ${id}`);
  return workflow;
}

export function buildSubagentWorkflowPrompt(workflow: SubagentWorkflowTemplate, userInstruction?: string): string {
  const instruction = userInstruction?.trim() || "Use the current thread context and repository state.";
  return [
    "SUBAGENT_WORKFLOW_RUN",
    `workflow: ${workflow.title}`,
    `roles: ${workflow.roles.join(" -> ")}`,
    `artifacts: ${workflow.artifacts.join(", ")}`,
    "",
    "Run this Nico-lite subagent workflow using the available Agent(...) subagent tool when appropriate.",
    "Keep child-agent prompts bounded. Return a concise summary and link or paste any artifacts you create.",
    "",
    `User instruction: ${instruction}`,
  ].join("\n");
}
```

- [ ] **Step 4: Add Electron run store**

Create `apps/desktop/electron/subagent-runs.ts` with:

```ts
import type { DesktopAppStore } from "./app-store";
import {
  buildSubagentWorkflowPrompt,
  workflowById,
  type RunSubagentWorkflowInput,
  type SubagentRunRecord,
} from "../src/subagent-workflows";

export class SubagentRunStore {
  private readonly runs: SubagentRunRecord[] = [];

  listRuns(workspaceId: string): readonly SubagentRunRecord[] {
    return this.runs.filter((run) => run.workspaceId === workspaceId).sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  }

  async runWorkflow(store: DesktopAppStore, input: RunSubagentWorkflowInput): Promise<readonly SubagentRunRecord[]> {
    const workflow = workflowById(input.workflowId);
    const run: SubagentRunRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      workflowId: workflow.id,
      title: workflow.title,
      workspaceId: input.target.workspaceId,
      target: input.target,
      status: "submitted",
      roles: workflow.roles,
      artifacts: workflow.artifacts,
      submittedAt: new Date().toISOString(),
    };
    this.runs.unshift(run);
    await store.submitComposerToSession(input.target, buildSubagentWorkflowPrompt(workflow, input.userInstruction), { deliverAs: "followUp" });
    return this.listRuns(input.target.workspaceId);
  }
}
```

- [ ] **Step 5: Add IPC types and preload methods**

In `apps/desktop/src/ipc.ts`, import workflow types:

```ts
import type { RunSubagentWorkflowInput, SubagentRunRecord } from "./subagent-workflows";
```

Add channels:

```ts
listSubagentRuns: "pi-gui:list-subagent-runs",
runSubagentWorkflow: "pi-gui:run-subagent-workflow",
```

Add API methods:

```ts
listSubagentRuns(workspaceId: string): Promise<readonly SubagentRunRecord[]>;
runSubagentWorkflow(workspaceId: string, input: RunSubagentWorkflowInput): Promise<readonly SubagentRunRecord[]>;
```

In `apps/desktop/electron/preload.ts`, add:

```ts
listSubagentRuns: (workspaceId: string) =>
  ipcRenderer.invoke(desktopIpc.listSubagentRuns, workspaceId) as Promise<readonly SubagentRunRecord[]>,
runSubagentWorkflow: (workspaceId: string, input: RunSubagentWorkflowInput) =>
  ipcRenderer.invoke(desktopIpc.runSubagentWorkflow, workspaceId, input) as Promise<readonly SubagentRunRecord[]>,
```

Add the needed type import at the top of preload.

- [ ] **Step 6: Register IPC handlers**

In `apps/desktop/electron/main.ts`, import:

```ts
import { SubagentRunStore } from "./subagent-runs";
import type { RunSubagentWorkflowInput } from "../src/subagent-workflows";
```

Create the store near other service singletons inside `bootstrap`:

```ts
const subagentRuns = new SubagentRunStore();
```

Register near agent definition handlers:

```ts
ipcMain.handle(desktopIpc.listSubagentRuns, async (_event, workspaceId: string) => {
  return subagentRuns.listRuns(workspaceId);
});
ipcMain.handle(desktopIpc.runSubagentWorkflow, async (_event, _workspaceId: string, input: RunSubagentWorkflowInput) => {
  return subagentRuns.runWorkflow(store, input);
});
```

- [ ] **Step 7: Add renderer state/loading in App**

In `apps/desktop/src/App.tsx`, import:

```ts
import type { RunSubagentWorkflowInput, SubagentRunRecord } from "./subagent-workflows";
```

Add state near `agentDefinitions` state:

```ts
const [subagentRuns, setSubagentRuns] = useState<readonly SubagentRunRecord[]>([]);
const [subagentRunsPending, setSubagentRunsPending] = useState(false);
const [subagentRunsError, setSubagentRunsError] = useState<string | undefined>();
```

Add loader:

```ts
const loadSubagentRuns = useCallback((workspaceId?: string) => {
  if (!api || !workspaceId) {
    setSubagentRuns([]);
    return;
  }
  setSubagentRunsPending(true);
  setSubagentRunsError(undefined);
  void api.listSubagentRuns(workspaceId).then(setSubagentRuns).catch((error) => {
    setSubagentRunsError(error instanceof Error ? error.message : String(error));
  }).finally(() => setSubagentRunsPending(false));
}, [api]);
```

Update the existing settings effect to load runs when `settingsSection === "agents"`.

Add handler:

```ts
const handleRunSubagentWorkflow = async (input: RunSubagentWorkflowInput) => {
  if (!api || !settingsWorkspace) return;
  setSubagentRunsPending(true);
  setSubagentRunsError(undefined);
  try {
    setSubagentRuns(await api.runSubagentWorkflow(settingsWorkspace.id, input));
  } catch (error) {
    setSubagentRunsError(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    setSubagentRunsPending(false);
  }
};
```

Pass `subagentRuns`, `subagentRunsPending`, `subagentRunsError`, `selectedSessionId`, and `onRunWorkflow` to `SettingsView`, then to `SettingsAgentsSection`.

- [ ] **Step 8: Add tabs/workflow cards/runs UI**

In `apps/desktop/src/settings-agents-section.tsx`, import:

```ts
import { BUILTIN_SUBAGENT_WORKFLOWS, type RunSubagentWorkflowInput, type SubagentRunRecord } from "./subagent-workflows";
```

Extend props:

```ts
readonly workspaceId?: string;
readonly selectedSessionId?: string;
readonly subagentRuns: readonly SubagentRunRecord[];
readonly subagentRunsPending: boolean;
readonly subagentRunsError?: string;
readonly onRunWorkflow: (input: RunSubagentWorkflowInput) => Promise<void>;
```

Add state:

```ts
const [tab, setTab] = useState<"roles" | "workflows" | "runs">("roles");
```

Add tab buttons before content:

```tsx
<div className="settings-tabs" role="tablist" aria-label="Subagents">
  {(["roles", "workflows", "runs"] as const).map((entry) => (
    <button className={settingsPill(tab === entry)} key={entry} role="tab" type="button" aria-selected={tab === entry} onClick={() => setTab(entry)}>
      {entry === "roles" ? "Roles" : entry === "workflows" ? "Workflows" : "Runs"}
    </button>
  ))}
</div>
```

Render workflow cards when `tab === "workflows"`:

```tsx
<div className="subagent-workflow-grid">
  {BUILTIN_SUBAGENT_WORKFLOWS.map((workflow) => (
    <article className="subagent-workflow-card" data-testid={`subagent-workflow-${workflow.id}`} key={workflow.id}>
      <h3>{workflow.title}</h3>
      <p>{workflow.description}</p>
      <div className="agent-definition-row__meta">
        <span>{workflow.roles.join(" → ")}</span>
        <span>Artifacts: {workflow.artifacts.join(", ")}</span>
      </div>
      <button
        className="button button--primary"
        disabled={pending || subagentRunsPending || !workspaceId || !selectedSessionId}
        type="button"
        onClick={() => workspaceId && selectedSessionId && onRunWorkflow({ workflowId: workflow.id, target: { workspaceId, sessionId: selectedSessionId } })}
      >
        Run workflow
      </button>
    </article>
  ))}
</div>
```

Render run rows when `tab === "runs"`:

```tsx
{subagentRunsError ? <div className="settings-warning" role="alert">{subagentRunsError}</div> : null}
<div className="agent-definitions-list">
  {subagentRuns.length === 0 ? <div className="settings-hint">No subagent workflow runs submitted yet.</div> : null}
  {subagentRuns.map((run) => (
    <div className="agent-definition-row" data-testid="subagent-run-row" key={run.id}>
      <div className="agent-definition-row__main">
        <div className="agent-definition-row__title">{run.title}</div>
        <div className="agent-definition-row__description">{run.status}</div>
        <div className="agent-definition-row__meta">
          <span>{run.roles.join(" → ")}</span>
          <span>Artifacts: {run.artifacts.join(", ")}</span>
          <span>{new Date(run.submittedAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  ))}
</div>
```

- [ ] **Step 9: Add minimal CSS**

In `apps/desktop/src/styles/main.css`, add:

```css
.settings-tabs {
  display: flex;
  gap: 8px;
  margin: 0 0 16px;
}

.subagent-workflow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.subagent-workflow-card {
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 14px;
  background: var(--surface-elevated);
}

.subagent-workflow-card h3 {
  margin: 0 0 6px;
}
```

If `--border-subtle` or `--surface-elevated` are not defined in this CSS file, use existing nearby token names from `.settings-section`/`.agent-definition-row` instead.

- [ ] **Step 10: Run workflow test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts --grep "submits a built-in workflow"
```

Expected: PASS.

- [ ] **Step 11: Run agent settings tests**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 12: Commit workflow templates and run records**

```bash
git add apps/desktop/src/subagent-workflows.ts apps/desktop/electron/subagent-runs.ts apps/desktop/src/ipc.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts apps/desktop/src/App.tsx apps/desktop/src/settings-view.tsx apps/desktop/src/settings-agents-section.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/agent-settings.spec.ts
git commit -m "feat(desktop): add subagent workflow templates"
```

---

## Task 6: Render subagent workflow marker messages as compact timeline cards

**Files:**
- Create: `apps/desktop/src/subagent-timeline-card.ts`
- Modify: `apps/desktop/src/timeline-item.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Create: `apps/desktop/tests/core/subagent-timeline-card.spec.ts`

- [ ] **Step 1: Add failing timeline E2E**

Create `apps/desktop/tests/core/subagent-timeline-card.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

// This exercises the same marker emitted by the workflow runner without requiring real child agents.
test("timeline renders subagent workflow marker as a compact card", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("subagent-timeline-card-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Subagent timeline card session");
    await window.evaluate(async () => {
      await window.piApp.submitComposer([
        "SUBAGENT_WORKFLOW_RUN",
        "workflow: Parallel review",
        "roles: reviewer/correctness -> reviewer/tests -> reviewer/simplicity",
        "artifacts: review-correctness.md, review-tests.md, review-simplicity.md",
      ].join("\n"));
    });

    const card = window.getByTestId("subagent-timeline-card");
    await expect(card).toContainText("Parallel review");
    await expect(card).toContainText("reviewer/correctness → reviewer/tests → reviewer/simplicity");
    await expect(card).toContainText("review-correctness.md");
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run card test and verify no card exists**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/subagent-timeline-card.spec.ts
```

Expected: FAIL on missing `subagent-timeline-card`.

- [ ] **Step 3: Add parser module**

Create `apps/desktop/src/subagent-timeline-card.ts`:

```ts
export interface SubagentTimelineCardModel {
  readonly workflow: string;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
}

export function parseSubagentWorkflowMarker(text: string): SubagentTimelineCardModel | undefined {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "SUBAGENT_WORKFLOW_RUN") return undefined;
  const workflow = valueAfterPrefix(lines, "workflow:");
  const roles = valueAfterPrefix(lines, "roles:")
    ?.split(/\s*->\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
  const artifacts = valueAfterPrefix(lines, "artifacts:")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
  if (!workflow) return undefined;
  return { workflow, roles, artifacts };
}

function valueAfterPrefix(lines: readonly string[], prefix: string): string | undefined {
  const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix));
  return line?.slice(prefix.length).trim();
}
```

- [ ] **Step 4: Render card in timeline item**

In `apps/desktop/src/timeline-item.tsx`, import:

```ts
import { parseSubagentWorkflowMarker } from "./subagent-timeline-card";
```

In the message rendering path for user/assistant text, before normal markdown rendering, detect marker text. If the file has a `TimelineMessageItem` function, add near the top:

```tsx
const subagentCard = parseSubagentWorkflowMarker(item.text);
if (subagentCard) {
  return (
    <article className="subagent-timeline-card" data-testid="subagent-timeline-card">
      <div className="subagent-timeline-card__eyebrow">Subagent workflow submitted</div>
      <h3>{subagentCard.workflow}</h3>
      {subagentCard.roles.length ? <p>{subagentCard.roles.join(" → ")}</p> : null}
      {subagentCard.artifacts.length ? (
        <div className="subagent-timeline-card__artifacts">
          {subagentCard.artifacts.map((artifact) => <span key={artifact}>{artifact}</span>)}
        </div>
      ) : null}
    </article>
  );
}
```

In the current `timeline-item.tsx`, place this block inside the message item renderer immediately before the normal markdown/text output branch for `item.kind === "message"`. If the exact local function name has changed by execution time, first locate the branch that renders `item.text`, then insert the block there without changing tool/activity rendering.

- [ ] **Step 5: Add CSS**

In `apps/desktop/src/styles/main.css`, add:

```css
.subagent-timeline-card {
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--surface-elevated);
}

.subagent-timeline-card__eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.subagent-timeline-card h3 {
  margin: 0 0 6px;
  font-size: 14px;
}

.subagent-timeline-card p {
  margin: 0 0 8px;
  color: var(--text-muted);
}

.subagent-timeline-card__artifacts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.subagent-timeline-card__artifacts span {
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}
```

Use existing token names if any listed variables are absent.

- [ ] **Step 6: Run timeline card test**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/subagent-timeline-card.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit timeline card rendering**

```bash
git add apps/desktop/src/subagent-timeline-card.ts apps/desktop/src/timeline-item.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/subagent-timeline-card.spec.ts
git commit -m "feat(desktop): render subagent workflow timeline cards"
```

---

## Task 7: Final verification and cleanup

**Files:**
- Modify only files needed for fixes discovered by verification.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused E2E tests**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/agent-settings.spec.ts apps/desktop/tests/core/subagent-timeline-card.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run full desktop core before completion**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected: PASS.

- [ ] **Step 4: Manual visible Electron verification**

Only if no important current user run would be interrupted, launch a visible app:

```bash
unset PI_APP_TEST_MODE
PI_APP_OPEN_DEVTOOLS=0 pnpm dev
```

Manual checks:

1. Open Settings -> Subagents.
2. Confirm Roles, Workflows, Runs tabs are visible.
3. Confirm canonical roles and legacy aliases are visible.
4. Create a project role named `manual-reviewer` and confirm `.pi/agents/manual-reviewer.md` is written.
5. Edit a role file with unknown frontmatter and confirm unknown lines remain after save.
6. Run Scout then plan and confirm the submitted marker appears in the thread as a card and the run appears in Runs.

- [ ] **Step 5: Run simplify before closing implementation**

Use the `code-simplify` skill on touched code paths. Specific targets:

- `apps/desktop/src/settings-agents-section.tsx`
- `apps/desktop/electron/agent-definitions.ts`
- `apps/desktop/src/agent-definition-form.ts`
- `apps/desktop/src/subagent-workflows.ts`

Simplification goals:

- Extract repeated metadata rendering if `settings-agents-section.tsx` becomes hard to scan.
- Keep frontmatter parse/serialize helpers small and named by responsibility.
- Avoid adapter abstractions until a second adapter exists.

- [ ] **Step 6: Commit verification fixes**

If verification required fixes:

```bash
git add apps/desktop/src apps/desktop/electron apps/desktop/tests/core
git commit -m "fix(desktop): stabilize nico-lite subagents"
```

If no fixes were required, do not create an empty commit.

## Plan self-review

- Spec coverage: canonical roles, aliases, frontmatter preservation, Nico-lite fields, workflow templates, run records, and timeline cards are each covered by tasks.
- Scope control: this plan intentionally does not install Nico, does not add custom workflow persistence, and does not implement arbitrary TUI rendering.
- Type consistency: workflow/run types are shared from `apps/desktop/src/subagent-workflows.ts`; IPC imports those types; renderer props use the same `SubagentRunRecord` and `RunSubagentWorkflowInput`.
- Risk: actual child-agent orchestration remains prompt-based through the existing composer path in this slice. That is deliberate; the adapter boundary can be deepened after this UI/model slice is stable.
