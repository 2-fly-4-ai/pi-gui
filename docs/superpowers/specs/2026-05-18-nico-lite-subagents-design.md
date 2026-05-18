# Nico-lite Subagents Design

## Goal

Build a single `pi-gui` subagent experience that borrows Nico's strongest workflow ideas without exposing Nico's full command/config surface. The desktop app should present subagents as roles, workflows, and runs; package-specific implementation details stay behind an adapter boundary.

## Success criteria

- Settings exposes one product concept: **Subagents**, not competing tintinweb/Nico systems.
- Existing `Agent(...)`/tintinweb-style definitions keep working through compatibility aliases.
- Built-in roles include `scout`, `planner`, `worker`, `reviewer`, `oracle`, `researcher`, `context-builder`, and `delegate`.
- Legacy built-ins map cleanly: `Explore -> scout`, `Plan -> planner`, `general-purpose -> delegate`.
- Agent markdown parsing preserves unknown frontmatter fields when a user edits a file through the GUI.
- The data model can represent Nico-inspired fields: role, fallback models, system prompt mode, project context inheritance, default reads/progress/output, and max subagent depth.
- Users can define and run simple workflow templates such as scout-then-plan, review current diff, parallel review, and review loop.
- Subagent runs are visible as first-class records with status, child role names, transcript links, and artifacts.
- Thread timeline renders subagent activity as readable cards rather than raw tool JSON where possible.
- The first implementation slice is useful without requiring Nico's package to be installed.

## Non-goals

- Do not install Nico's package wholesale as the only path.
- Do not expose every Nico command or field in the first GUI.
- Do not support two equal first-class subagent products in Settings.
- Do not break existing `.pi/agents/*.md` files.
- Do not implement arbitrary TUI component rendering for `ctx.ui.custom()` in this slice.
- Do not remove existing tintinweb adapter behavior until migration is proven.

## Product model

The GUI owns these concepts:

1. **Role**: a reusable subagent definition with prompt, tools, model preferences, context policy, and output expectations.
2. **Workflow**: an ordered or parallel set of role invocations with named inputs and expected artifacts.
3. **Run**: one execution instance of a role or workflow, with status, child transcripts, artifacts, and errors.
4. **Artifact**: durable output such as `plan.md`, `review.md`, `context.md`, or `progress.md` that can be opened, copied, or inserted into the composer.

The GUI should not ask the user whether they are using "tintinweb" or "Nico" for normal workflows. Those are runtime adapters.

## Architecture

Add a canonical v2 subagent model in the desktop renderer/shared source, then adapt it to current markdown files and backend tools.

```txt
UI: Settings -> Subagents
        |
        v
SubagentRole / SubagentWorkflow / SubagentRun model
        |
        v
Electron subagent registry + run service
        |
        v
Adapter boundary
  - TintinwebAdapter first: emits existing Agent(...) compatible prompts/tool calls
  - NicoAdapter later: imports/exports Nico agents/chains and can call subagent(...) if installed
  - NativeAdapter later: pi-gui-owned orchestration if needed
```

The first implementation should be incremental: add the richer model and UI labels while continuing to execute through the existing mechanisms.

## Data model

Extend the current `AgentDefinitionConfig` rather than replacing it immediately. Add fields only where the GUI needs them:

```ts
type SubagentRoleName =
  | "scout"
  | "planner"
  | "worker"
  | "reviewer"
  | "oracle"
  | "researcher"
  | "context-builder"
  | "delegate"
  | string;

interface SubagentRoleConfig extends AgentDefinitionConfig {
  readonly role?: SubagentRoleName;
  readonly systemPromptMode?: "replace" | "append";
  readonly contextMode?: "fresh" | "fork" | "project";
  readonly inheritProjectContext?: boolean;
  readonly fallbackModels?: readonly { providerId: string; modelId: string }[];
  readonly output?: "message" | "artifact" | "both";
  readonly defaultReads?: readonly string[];
  readonly defaultProgress?: "silent" | "summary" | "stream";
  readonly maxSubagentDepth?: number;
  readonly extraFrontmatter?: Readonly<Record<string, string | boolean | number | readonly string[]>>;
}
```

`extraFrontmatter` is required for safety: if a user's markdown file contains Nico-specific or future fields the current GUI does not understand, saving from the GUI must preserve them.

## Built-in roles

Create short built-in role presets:

- `scout`: read-only repository reconnaissance. Replaces the product role currently named `Explore`.
- `planner`: read-only implementation planner. Replaces the product role currently named `Plan`.
- `worker`: edits files according to a bounded task or plan.
- `reviewer`: reviews a diff, plan, or artifact and returns findings with severity.
- `oracle`: challenges assumptions and offers a second opinion without making changes.
- `researcher`: retrieves external documentation and summarizes sources.
- `context-builder`: creates handoff/context artifacts for future agents.
- `delegate`: generic child agent. Replaces the product role currently named `general-purpose`.

Legacy names remain accepted and visible as aliases until users migrate.

## Workflows

Start with built-in workflow templates rather than a full visual chain editor:

1. **Scout then plan**: `scout -> planner`, produces `context.md` and `plan.md`.
2. **Implement with worker**: `worker`, optionally uses selected plan/context artifact.
3. **Review current diff**: `reviewer`, produces `review.md`.
4. **Parallel review**: runs multiple reviewers with perspectives: correctness, tests, simplicity.
5. **Oracle second opinion**: `oracle`, produces an assumptions/challenges note.
6. **Review loop**: `reviewer -> worker -> reviewer`, with a max iteration count of 1 for the first slice.

Persist custom workflows later after the built-ins work. The model should be compatible with `.pi/chains/*.chain.md`, but GUI-native workflows can be represented internally first.

## UI design

Rename Settings -> Agents to Settings -> Subagents and split it into tabs over time:

- **Roles**: current list/editor, with role labels and legacy alias notices.
- **Workflows**: built-in workflow cards with Run buttons.
- **Runs**: recent subagent/workflow runs with status, transcript links, artifacts, and errors.
- **Settings**: advanced compatibility/adapter controls only if needed.

Keep advanced role fields collapsed by default. The common editor fields are name, display name, role, description, model, reasoning, tools, context mode, output mode, and prompt.

## Timeline behavior

Subagent tool calls and workflow runs should render as compact cards:

```txt
Parallel review complete
- reviewer/correctness: 2 findings
- reviewer/tests: clean
- reviewer/simplicity: 1 suggestion
Artifacts: review-correctness.md, review-tests.md
```

This is presentation only at first. Raw transcript data should remain unchanged.

## Execution strategy

The first implementation should execute through the existing tintinweb-style support where possible. Workflow templates can initially submit structured prompts that call the existing `Agent(...)` tool with canonical role names/aliases. A later adapter can call Nico's `subagent(...)` when installed.

Define an adapter boundary before adding Nico-specific runtime behavior:

```ts
interface SubagentEngine {
  listRoles(workspaceId: string): Promise<readonly SubagentRoleRecord[]>;
  runRole(input: RunSubagentRoleInput): Promise<SubagentRunRecord>;
  runWorkflow(input: RunSubagentWorkflowInput): Promise<SubagentRunRecord>;
  listRuns(workspaceId: string): Promise<readonly SubagentRunRecord[]>;
}
```

The first concrete implementation can be a thin wrapper around current agent definitions and session submission. It should not fork the Pi runtime.

## Migration and compatibility

- Read from existing global/project `.pi/agents/*.md` locations.
- Preserve existing filenames and safe path validation.
- Continue accepting `prompt_mode`, `inherit_context`, `run_in_background`, `isolated`, `isolation`, and `max_turns`.
- Add support for new frontmatter keys without dropping old unknown keys.
- Surface `Explore`, `Plan`, and `general-purpose` as legacy aliases, not separate strategic roles.
- Do not auto-delete or rewrite user agent files during migration.

## Testing and verification

Automated checks:

- Unit tests for parsing/serializing frontmatter with unknown-field preservation.
- Unit tests for legacy alias mapping.
- Renderer tests for Settings -> Subagents labels, role list, editor save, duplicate, reset, and delete behavior.
- Workflow model tests for built-in templates and run-status derivation.
- Timeline rendering tests for subagent run cards.
- Existing desktop core e2e suite should still pass.

Manual desktop verification:

- Launch visible Electron app with `unset PI_APP_TEST_MODE`.
- Open Settings -> Subagents.
- Confirm legacy agents are visible as aliases.
- Create a project-scoped role and verify the markdown file is written under `.pi/agents`.
- Edit a markdown file containing unknown frontmatter and verify saving through the GUI preserves it.
- Run a simple scout-then-plan workflow and confirm the run appears in the thread and Runs tab.

## Risks

- A full workflow runner can become too large. Mitigation: ship built-in workflow templates before custom chain editing.
- Supporting Nico and tintinweb equally would create product confusion. Mitigation: keep one GUI model and use adapters internally.
- Unknown frontmatter preservation is easy to get subtly wrong. Mitigation: test parse/serialize round-trips before adding more UI fields.
- Timeline cards may accidentally duplicate or hide important transcript data. Mitigation: keep raw transcript available and make cards purely representational.
