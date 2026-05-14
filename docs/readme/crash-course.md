# Pi Crash Course

This crash course is distilled from the mirrored Pi docs in
[`pi-dev/`](pi-dev/index.md). Read it when you want the fast mental model:
what Pi is, how to use it day to day, and which parts matter for this
Codex-style desktop app.

## 1. What Pi Is

Pi is a small terminal coding-agent harness. The core stays intentionally
minimal, and workflow-specific behavior is added through:

- **Context files**: project instructions such as `AGENTS.md` or `CLAUDE.md`.
- **Settings**: model, thinking level, themes, resources, sessions, shell config.
- **Sessions**: saved JSONL conversation trees with branching and compaction.
- **Skills**: reusable agent instructions loaded on demand.
- **Prompt templates**: reusable prompts exposed as slash commands.
- **Extensions**: TypeScript modules that add tools, commands, UI, events, custom providers, and persistence.
- **Packages**: distributable bundles of extensions, skills, prompts, and themes.
- **SDK/RPC/JSON modes**: programmatic surfaces for embedding Pi in apps.

The key product idea: Pi is not a giant built-in IDE assistant. It is a thin,
composable coding-agent runtime that can be wrapped by other interfaces.

For this repo, that matters because `pi-gui` is building a desktop experience
around Pi. We should lean on Pi's existing runtime, session, provider, and
agent semantics instead of reimplementing them.

## 2. Installation And First Run

Install globally:

```bash
npm install -g @earendil-works/pi-coding-agent
```

Or use the install script:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

Run Pi inside the project you want it to operate on:

```bash
cd /path/to/project
pi
```

Authenticate either with subscription login:

```text
/login
```

Or with an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
pi
```

Built-in subscription logins include ChatGPT Plus/Pro through Codex, Claude
Pro/Max, and GitHub Copilot. API-key providers include Anthropic, OpenAI,
Google Gemini, Azure OpenAI, DeepSeek, Mistral, Groq, Cloudflare, OpenRouter,
Vercel AI Gateway, Bedrock, Vertex, and more.

## 3. The Basic Agent Loop

Start Pi, type a request, and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

By default the model can use these built-in tools:

- `read`: read files
- `write`: create or overwrite files
- `edit`: patch files
- `bash`: run shell commands
- `grep`, `find`, `ls`: optional read-only tools available through tool options

Pi runs in the current working directory and can modify files there. Use git
checkpoints, commits, or separate worktrees when you want easy rollback.

Important editor features:

| Need | How |
| --- | --- |
| Reference files | Type `@` and fuzzy-search files |
| Include files at startup | `pi @README.md "Summarize this"` |
| Multi-line input | Shift+Enter, or Ctrl+Enter on Windows Terminal |
| Run shell command | `!npm test` |
| Run shell command without adding output to context | `!!npm test` |
| Paste or attach images | Ctrl+V, Alt+V on Windows, or drag into terminal |
| Open external editor | Ctrl+G |

## 4. The Interactive UI

Pi's terminal interface has four major areas:

- **Startup header**: loaded context files, skills, prompts, extensions, shortcuts.
- **Messages**: user messages, assistant responses, tool calls, tool results, errors, extension UI.
- **Editor**: where you type. The border color reflects thinking level.
- **Footer**: cwd, session name, token/cache usage, cost, context usage, current model.

The editor can temporarily become built-in UI such as `/settings`, or extension
UI created by a custom TypeScript extension.

Useful default shortcuts:

| Shortcut | Action |
| --- | --- |
| Ctrl+L | Open model selector |
| Shift+Tab | Cycle thinking level |
| Ctrl+P / Shift+Ctrl+P | Cycle enabled models |
| Ctrl+O | Expand/collapse tool output |
| Escape | Abort/cancel |
| Alt+Enter | Queue a follow-up while agent is working |
| Alt+Up | Restore queued messages to editor |

Customize keybindings in:

```text
~/.pi/agent/keybindings.json
```

Then run:

```text
/reload
```

## 5. Slash Commands You Should Know

Type `/` to open command completion.

| Command | Use |
| --- | --- |
| `/login`, `/logout` | Manage provider credentials |
| `/model` | Switch model |
| `/scoped-models` | Configure models available to Ctrl+P cycling |
| `/settings` | Change thinking, theme, transport, message behavior |
| `/reload` | Reload context files, skills, prompts, extensions, keybindings |
| `/resume` | Pick a previous session |
| `/new` | Start a fresh session |
| `/name <name>` | Name the current session |
| `/session` | Show session file, ID, tokens, cost |
| `/tree` | Navigate session history and branch from earlier points |
| `/fork` | Create a new session from an earlier user message |
| `/clone` | Duplicate current active branch into a new session |
| `/compact [prompt]` | Summarize old context |
| `/export [file]` | Export session to HTML |
| `/share` | Upload private gist with shareable session HTML |
| `/hotkeys` | Show keyboard shortcuts |
| `/quit` | Exit |

Skills appear as `/skill:name`. Prompt templates appear as `/filename`.
Extensions can register their own commands.

## 6. Context Files Are Project Instructions

Pi loads project instructions at startup from:

- `~/.pi/agent/AGENTS.md`
- `AGENTS.md` or `CLAUDE.md` in parent directories
- `AGENTS.md` or `CLAUDE.md` in the current directory

After changing context files, restart Pi or run:

```text
/reload
```

For this repo, the root `AGENTS.md` is the source of truth. It tells agents to:

- preserve the Codex-style desktop-app direction
- keep `pi-sdk-driver` thin over `pi-mono`
- verify desktop work on the real Electron surface
- protect user session history and cached artifacts
- avoid broad Node exposure to the renderer

That means our desktop app should treat Pi's runtime semantics as product
behavior, not incidental implementation detail.

## 7. Settings

Pi uses JSON settings files:

| File | Scope |
| --- | --- |
| `~/.pi/agent/settings.json` | Global |
| `.pi/settings.json` | Project |

Project settings override global settings. Nested objects merge.

Common settings:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "enabledModels": ["claude-*", "gpt-4o"],
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3
  },
  "packages": ["pi-skills"]
}
```

Important knobs:

- **Model defaults**: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`.
- **Compaction**: `compaction.enabled`, `reserveTokens`, `keepRecentTokens`.
- **Message delivery**: `steeringMode`, `followUpMode`.
- **Resources**: `packages`, `extensions`, `skills`, `prompts`, `themes`.
- **Sessions**: `sessionDir`.
- **Shell**: `shellPath`, `shellCommandPrefix`, `npmCommand`.
- **Images**: `images.autoResize`, `images.blockImages`, terminal image display.
- **Network/update behavior**: `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY`.

Settings can also be changed through `/settings` for the common options.

## 8. Providers, Models, And Auth

Credentials resolve in this order:

1. CLI `--api-key`
2. `~/.pi/agent/auth.json`
3. Environment variables
4. Custom provider keys from `models.json`

Subscription credentials and API keys are stored in:

```text
~/.pi/agent/auth.json
```

The file is created with user-only permissions.

Model selection examples:

```bash
pi --provider openai --model gpt-4o
pi --model openai/gpt-4o
pi --model sonnet:high
pi --models "claude-*,gpt-4o"
pi --list-models
```

Thinking levels are:

```text
off, minimal, low, medium, high, xhigh
```

Custom local or proxy models go in:

```text
~/.pi/agent/models.json
```

Minimal Ollama-style provider:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

Use `models.json` for OpenAI-compatible servers, Ollama, LM Studio, vLLM,
SGLang, proxies, and built-in provider overrides. Use a custom provider
extension when auth, OAuth, model discovery, or streaming behavior needs code.

## 9. Sessions, History, And Branching

Pi saves sessions automatically under:

```text
~/.pi/agent/sessions/
```

Each session is a JSONL file. Entries form a tree using `id` and `parentId`.
This is how Pi can branch inside a single session file.

Startup session commands:

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse previous sessions
pi --no-session        # Ephemeral mode
pi --session <path|id> # Open specific session
pi --fork <path|id>    # Fork a session into a new file
```

Inside Pi:

- `/session` shows current session metadata.
- `/name` gives the session a useful display name.
- `/resume` opens the session picker.
- `/tree` lets you jump to an earlier point and continue from there.
- `/fork` starts a new session from a previous user message.
- `/clone` copies the current active branch to a new session file.

Use `/tree` when alternatives belong together. Use `/fork` or `/clone` when
you want a separate session file.

Why this matters for `pi-gui`: transcript and timeline behavior are not just UI
polish. Session tree navigation, branch summaries, compaction entries, model
changes, tool results, and custom extension messages are core product behavior.

## 10. Compaction

LLM context windows are finite. Pi handles long sessions through compaction.

Auto-compaction triggers roughly when:

```text
contextTokens > contextWindow - reserveTokens
```

Defaults:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

Compaction:

1. Keeps recent messages.
2. Summarizes older messages.
3. Saves a `compaction` entry to the session JSONL.
4. Reloads context using summary plus kept messages.

Manual compaction:

```text
/compact
/compact focus on files modified, decisions made, and remaining TODOs
```

Branch summarization is separate. When `/tree` switches from one branch to
another, Pi can summarize the branch you are leaving and attach that summary at
the new position.

Both mechanisms track read and modified files in their details. A desktop app
should preserve and display these entries rather than flattening them away.

## 11. Print, JSON, And RPC Modes

Interactive mode is the default. Pi also has headless modes.

Print mode:

```bash
pi -p "Summarize this codebase"
cat README.md | pi -p "Summarize this text"
pi -p @screenshot.png "What's in this image?"
```

JSON event stream mode:

```bash
pi --mode json "List files" 2>/dev/null | jq -c 'select(.type == "message_end")'
```

This emits JSON lines for session and agent events:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `queue_update`
- `compaction_start`, `compaction_end`
- `auto_retry_start`, `auto_retry_end`

RPC mode:

```bash
pi --mode rpc
```

RPC is JSONL over stdin/stdout. Commands include:

- `prompt`
- `steer`
- `follow_up`
- `abort`
- `new_session`
- `get_state`
- `get_messages`
- `set_model`
- `cycle_model`

Use RPC when an app wants to control Pi as a subprocess. Use the SDK directly
when building a Node/TypeScript app and you can link against
`@earendil-works/pi-coding-agent`.

## 12. SDK: The Important Surface For This Desktop App

The SDK is part of:

```bash
npm install @earendil-works/pi-coding-agent
```

Minimal session:

```typescript
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

`AgentSession` handles:

- prompts
- streaming events
- steering and follow-up queues
- model and thinking-level changes
- session messages
- tree navigation
- compaction
- abort
- cleanup

For desktop integration, the runtime layer is especially important:

- `createAgentSessionRuntime()` owns active-session replacement.
- `runtime.session` changes after new, resume, fork, clone, or import flows.
- Event subscriptions attach to a specific session, so the UI must resubscribe
  after replacement.
- Extensions may need rebinding after replacement.
- Diagnostics come from runtime creation.

This matches our repo guidance: keep `pi-sdk-driver` thin over `pi-mono`. The
desktop app should translate SDK/runtime events into UI state, not invent a
parallel session model.

## 13. Message Queueing

Pi supports sending input while the agent is still working.

Interactive:

- Enter queues a steering message.
- Alt+Enter queues a follow-up.
- Escape aborts and restores queued messages.
- Alt+Up restores queued messages to the editor.

SDK:

```typescript
await session.steer("New instruction");
await session.followUp("After that, also check X");
```

RPC:

```json
{"type":"prompt","message":"New instruction","streamingBehavior":"steer"}
{"type":"follow_up","message":"After that, also check X"}
```

Difference:

- **Steering** is delivered after the current assistant turn finishes tool calls,
  before the next LLM call.
- **Follow-up** waits until the agent has fully stopped.

For UI design, these should be visible queue states, not hidden text buffers.

## 14. Skills

Skills are on-demand capability packages. Pi scans only the skill names and
descriptions at startup, then the agent reads the full `SKILL.md` when needed.

Locations:

- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `.pi/skills/`
- `.agents/skills/` in the current repo or ancestors
- packages
- settings `skills`
- CLI `--skill <path>`

Skill structure:

```text
my-skill/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

`SKILL.md` has frontmatter:

```markdown
---
name: code-review
description: Review code changes for bugs, regressions, and missing tests.
---

# Code Review

Use this workflow when reviewing staged git changes...
```

Use a skill when the agent needs a repeatable workflow with detailed
instructions, helper scripts, or reference files.

Project idea for this repo: define skills for Electron verification, transcript
diagnostics, session import/export analysis, or SDK-driver integration checks.

## 15. Prompt Templates

Prompt templates are Markdown snippets exposed as slash commands.

Locations:

- `~/.pi/agent/prompts/*.md`
- `.pi/prompts/*.md`
- packages
- settings `prompts`
- CLI `--prompt-template <path>`

Example `.pi/prompts/review.md`:

```markdown
---
description: Review staged git changes
argument-hint: "[focus]"
---

Review the staged changes (`git diff --cached`). Focus on:
- Bugs and logic errors
- Security issues
- Error handling gaps
- Missing tests

Additional focus: $ARGUMENTS
```

Invoke it as:

```text
/review session handling
```

Use prompt templates for common prompts that do not need scripts or large
reference material. Use skills when the workflow is more involved.

## 16. Extensions

Extensions are TypeScript modules with full system permissions. They can:

- register custom LLM-callable tools
- intercept or block tool calls
- prompt the user through UI helpers
- register slash commands
- add custom TUI components
- add shortcuts and flags
- persist session entries
- customize rendering
- customize compaction
- register or override model providers

Auto-discovered locations:

| Location | Scope |
| --- | --- |
| `~/.pi/agent/extensions/*.ts` | Global |
| `~/.pi/agent/extensions/*/index.ts` | Global |
| `.pi/extensions/*.ts` | Project |
| `.pi/extensions/*/index.ts` | Project |

Minimal extension:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous command", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

Test an extension without installing it:

```bash
pi -e ./my-extension.ts
```

Use extensions when behavior must run as code: permissions, custom tools,
providers, UI, event hooks, or persistence. Review extension source carefully;
extensions run with your full system permissions.

## 17. Pi Packages

Pi packages bundle resources:

- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

Install examples:

```bash
pi install npm:@foo/bar@1.0.0
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo
pi install /absolute/path/to/package
pi install ./relative/path/to/package
```

Manage packages:

```bash
pi list
pi remove npm:@foo/bar
pi update
pi update --self
pi update --extensions
```

Use `-l` to install into project settings instead of global settings:

```bash
pi install -l ./tools/my-pi-package
```

Project-local package settings are shareable. Pi installs missing project
packages automatically on startup.

Package manifest:

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Use packages when you want to share a bundle of team workflows, prompts, skills,
themes, and integrations.

## 18. Themes And Terminal Polish

Themes are JSON files loaded from:

- built-ins: `dark`, `light`
- `~/.pi/agent/themes/*.json`
- `.pi/themes/*.json`
- packages
- settings `themes`
- CLI `--theme <path>`

Select through `/settings` or:

```json
{
  "theme": "my-theme"
}
```

Themes define all UI color tokens: borders, message backgrounds, markdown,
diffs, syntax, thinking levels, and bash mode.

For the terminal app, themes are Pi-native TUI appearance. For `pi-gui`, they
are useful as reference vocabulary, but the desktop UI may need its own design
tokens that map to the same concepts: tool states, user/assistant messages,
thinking, selected tree nodes, compaction summaries, and errors.

## 19. Session File Format

Sessions are JSONL. First line is a header:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path/to/project"}
```

Then entries follow. Major entry types:

- `message`: user, assistant, tool result, bash execution, custom messages.
- `model_change`: selected model changed.
- `thinking_level_change`: thinking level changed.
- `compaction`: old context summarized.
- `branch_summary`: abandoned branch summarized during `/tree`.
- `custom`: extension state that does not enter LLM context.

Message roles include:

- `user`
- `assistant`
- `toolResult`
- `bashExecution`
- `custom`
- `branchSummary`
- `compactionSummary`

Assistant messages contain content blocks:

- text
- thinking
- tool calls

User and tool result messages can contain text and images.

This is the schema our desktop transcript needs to respect. The UI should not
assume a flat alternating user/assistant chat. Real Pi sessions contain tool
results, branch entries, compactions, custom extension messages, model changes,
and thinking-level changes.

## 20. How We Can Use Pi In This Repo

This repo is building a Codex-style desktop app for Pi. The highest-leverage
parts of Pi to use are:

### Runtime

Use the Pi SDK/runtime as the source of truth for:

- starting sessions
- streaming events
- message queueing
- model selection
- thinking level
- compaction
- tree navigation
- resume/fork/clone/new session behavior

Do not duplicate session semantics in the renderer. The renderer should display
and command the runtime.

### Session UI

Treat sessions as trees, not flat chats. The desktop app should be able to show:

- active branch
- branch alternatives
- labels
- model changes
- thinking changes
- compaction summaries
- branch summaries
- tool call lifecycle
- queued steering/follow-up messages

This aligns with the repo guideline that transcript/timeline behavior and
session correctness are product features.

### Driver Boundary

Keep `pi-sdk-driver` thin over `pi-mono`:

- translate SDK events to app IPC-friendly structures
- avoid reimplementing agent behavior
- avoid forking runtime behavior unless absolutely necessary
- preserve message IDs, parent IDs, session IDs, and file paths

### Desktop Safety

Follow the renderer/main/preload boundary:

- main process owns Node and Pi SDK access
- preload exposes narrow IPC APIs
- renderer receives structured events and sends explicit commands
- avoid broad Node exposure to the renderer

### Feature Opportunities

Useful Pi-backed desktop features:

- session picker backed by Pi session files
- visual session tree with branch summaries
- transcript view with tool-call expansion
- model and thinking-level controls
- queued-message UI for steering/follow-ups
- compaction visibility
- prompt-template palette
- skill browser
- extension/package status view
- provider/auth setup flows
- JSONL session import/export/debug tooling
- Electron-specific verification workflows as project skills

## 21. A Good First Learning Path

Read the docs in this order:

1. [`pi-dev/quickstart.md`](pi-dev/quickstart.md): install, auth, first session.
2. [`pi-dev/usage.md`](pi-dev/usage.md): daily workflow and CLI flags.
3. [`pi-dev/sessions.md`](pi-dev/sessions.md): resume, tree, fork, clone.
4. [`pi-dev/compaction.md`](pi-dev/compaction.md): long-context behavior.
5. [`pi-dev/settings.md`](pi-dev/settings.md): configuration.
6. [`pi-dev/providers.md`](pi-dev/providers.md): auth and model setup.
7. [`pi-dev/session-format.md`](pi-dev/session-format.md): JSONL structure.
8. [`pi-dev/sdk.md`](pi-dev/sdk.md): embedding in TypeScript apps.
9. [`pi-dev/rpc.md`](pi-dev/rpc.md): subprocess integration.
10. [`pi-dev/extensions.md`](pi-dev/extensions.md): custom tools, events, providers.
11. [`pi-dev/skills.md`](pi-dev/skills.md): reusable workflows.
12. [`pi-dev/prompt-templates.md`](pi-dev/prompt-templates.md): reusable prompts.
13. [`pi-dev/packages.md`](pi-dev/packages.md): sharing resources.

## 22. Quick Command Cheat Sheet

```bash
# Start interactive Pi in the current project
pi

# Start with files in context
pi @README.md @package.json "Summarize this project"

# One-shot answer
pi -p "Summarize this codebase"

# One-shot with stdin
cat README.md | pi -p "Summarize this text"

# Continue or resume
pi -c
pi -r

# Open a specific session
pi --session <path-or-id>

# Fork a session
pi --fork <path-or-id>

# Disable session persistence
pi --no-session

# Select model
pi --provider openai --model gpt-4o
pi --model sonnet:high

# Restrict tools for read-only review
pi --tools read,grep,find,ls -p "Review the code"

# JSON events
pi --mode json "List files"

# RPC server
pi --mode rpc

# Package management
pi install npm:some-pi-package
pi install -l ./local-package
pi list
pi update
```

## 23. Mental Model To Keep

Pi has three layers:

1. **Agent runtime**: models, tools, messages, sessions, compaction, events.
2. **Resource system**: context files, settings, skills, prompts, extensions, packages.
3. **Interfaces**: terminal UI, print mode, JSON stream, RPC, SDK, and our desktop UI.

For `pi-gui`, the goal is to make a better interface over the runtime while
preserving Pi's semantics. The desktop app should make sessions, tools,
branching, queueing, and compaction easier to see and control, not replace them
with a simpler chat abstraction.
