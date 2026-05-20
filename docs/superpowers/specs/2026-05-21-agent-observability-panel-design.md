# Agent Observability Panel Design

## Goal

Add a first-class Logs / Observability panel to `pi-gui` so failures, tool calls, skill activity, parent agent runs, and subagent runs are visible from the desktop app without leaving the current work surface. The panel should help debug wrong-cwd execution, hidden slash-command failures, renderer issues, subagent failures, and confusing context leakage.

## Success criteria

- Topbar has a dedicated Logs icon with active state.
- Logs opens as a persistent right-side panel on Threads and Display Mode.
- Logs does not navigate to Display Mode and does not replace the current thread.
- Logs can be open at the same time as VS Code and Changes; if VS Code is open, Logs appears to the right of VS Code.
- Logs preserves search, filters, selected event, and scroll position when switching Threads ↔ Display Mode.
- The panel clearly separates failures from routine noise.
- The panel includes desktop, renderer, parent agent, tool, skill, subagent, cwd/workspace, and slash-command events.
- Every failure-like event is findable from a **Failures** view.
- Subagent events include agent id, role/type, description, cwd, workspace root, tool name, tool call id, status, duration, and error/result excerpts when available.
- Wrong-cwd / cross-workspace events are highlighted as high-severity safety events.
- Existing log files remain intact. The feature must read and index logs without deleting or rewriting transcript/history data.

## Non-goals

- Do not make Logs a Display Mode tab.
- Do not remove the existing Display Mode side drawer in this slice.
- Do not expose raw filesystem access to the renderer. Main/preload must provide a bounded IPC API.
- Do not delete, rotate, compact, or rewrite existing logs/transcripts without explicit approval.
- Do not send logs to an external service.
- Do not require a provider run to load the Logs panel.
- Do not solve every missing upstream Pi runtime event in the first slice; add a forward-compatible ledger and ingest existing sources where practical.

## Product model

The GUI should present one concept: **Observability**.

Observability has three layers:

1. **Event ledger**: normalized JSON events from desktop, renderer, parent agent, tools, skills, subagents, and workspace guards.
2. **Log sources**: append-only files and transcript/session sources that produce ledger events.
3. **Logs panel**: a searchable, filterable right-side UI for incidents, timelines, and raw details.

The user should not need to know whether an event came from `desktop.log`, `subagents-audit.jsonl`, a Pi session JSONL file, or a transcript cache. The UI can show source metadata, but the main list should be normalized and grouped by meaning.

## Right-side panel behavior

The layout should support independent right-side panels:

```txt
[Sidebar] [Main Threads / Display Mode] [VS Code?] [Changes?] [Logs?]
```

Rules:

- Logs panel has its own open/closed state and width.
- VS Code, Changes, and Logs can be open together.
- Existing VS Code persistence continues to work.
- Logs appears on the far right by default.
- Logs should not steal focus from the composer unless the user clicks into Logs search/details.
- The topbar icon toggles Logs open/closed.
- The active topbar icon state reflects whether Logs is currently visible.

The first implementation can use a fixed/resizable width similar to existing side panels. It should avoid changing transcript rendering internals except for the container width caused by the panel.

## Logs panel UI

The panel has four areas:

1. **Header**
   - Title: `Logs`
   - Failure count badge for the current filter window.
   - Refresh button.
   - Close button.

2. **Filters**
   - Severity: `All`, `Failures`, `Warnings`, `Info`
   - Category: `All`, `Desktop`, `Renderer`, `Agent`, `Tools`, `Skills`, `Subagents`, `Workspace`, `Slash commands`
   - Workspace: current workspace, all workspaces, or known workspace roots when available.
   - Time: `Last 15m`, `Last hour`, `Today`, `All loaded`
   - Search text.

3. **Event list**
   - Compact rows with timestamp, severity, category, title, workspace/repo label, and short detail.
   - Failures use high-contrast styling.
   - Workspace/cwd mismatch events get a safety badge.
   - Related events share a correlation id when available.

4. **Details drawer inside the panel**
   - Full normalized event JSON.
   - Raw source excerpt.
   - Related events.
   - Copy event JSON.
   - Open related transcript/session when a target is known.

## Severity model

Use deterministic severity classification:

- `error`
  - run failed, slash command failed, tool error, renderer crash/gone, unhandled rejection, uncaught exception, subagent failed, cwd guard blocked, workspace mismatch.
- `warning`
  - renderer long task over threshold, suspicious cwd mismatch that did not block, missing log source, parse error for a log line, terminal-only unsupported command.
- `info`
  - tool started/ended successfully, subagent started/completed, skill loaded, session selected, renderer load finished.

The **Failures** view includes `error` plus safety warnings that indicate potential wrong-repo execution.

## Normalized event schema

Create a shared event shape for renderer and main process use:

```ts
type ObservabilitySeverity = "info" | "warning" | "error";
type ObservabilityCategory =
  | "desktop"
  | "renderer"
  | "agent"
  | "tool"
  | "skill"
  | "subagent"
  | "workspace"
  | "slash-command";

interface ObservabilityEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly severity: ObservabilitySeverity;
  readonly category: ObservabilityCategory;
  readonly event: string;
  readonly title: string;
  readonly message?: string;
  readonly source: {
    readonly kind: "desktop-log" | "subagents-audit" | "session-jsonl" | "transcript" | "ledger";
    readonly path?: string;
    readonly line?: number;
  };
  readonly correlation?: {
    readonly desktopSessionId?: string;
    readonly workspaceId?: string;
    readonly sessionId?: string;
    readonly parentToolCallId?: string;
    readonly toolCallId?: string;
    readonly subagentId?: string;
    readonly runId?: string;
  };
  readonly workspace?: {
    readonly id?: string;
    readonly name?: string;
    readonly selectedPath?: string;
    readonly runtimeCwd?: string;
    readonly repoRoot?: string;
    readonly workspaceRoot?: string;
  };
  readonly agent?: {
    readonly kind?: "parent" | "subagent";
    readonly type?: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly model?: string;
    readonly thinking?: string;
    readonly status?: string;
  };
  readonly tool?: {
    readonly name?: string;
    readonly argsExcerpt?: string;
    readonly isError?: boolean;
  };
  readonly skill?: {
    readonly name?: string;
    readonly path?: string;
    readonly trigger?: "auto" | "explicit" | "preload";
  };
  readonly durationMs?: number;
  readonly raw?: unknown;
}
```

This schema is intentionally broad enough for existing log ingestion and future structured ledger writes.

## Log sources to ingest

### Desktop diagnostics

Source:

```txt
~/Library/Application Support/pi/logs/desktop.log
```

Ingest events:

- `main-uncaught-exception`
- `main-unhandled-rejection`
- `render-process-gone`
- `renderer-unresponsive`
- `renderer-responsive`
- `renderer-did-fail-load`
- `renderer-console-message`
- `renderer-diagnostic`

Renderer diagnostic payloads should map `kind`, `message`, and `details` into readable titles. Timeline perf diagnostics should default to `info` or `warning`, not failure, unless they indicate crashes/blank rendering.

### Subagent audit log

Source:

```txt
~/.pi/agent/logs/subagents-audit.jsonl
```

Existing events:

- `subagent_spawn_requested`
- `subagent_spawn_blocked`
- `subagent_session_create`
- `subagent_tool_start`
- `subagent_tool_end`
- `subagent_tool_blocked`
- `subagent_completed`
- `subagent_failed`

Mapping:

- `subagent_spawn_blocked` and `subagent_tool_blocked` are `error` safety events.
- `subagent_failed` is `error`.
- `subagent_tool_end` with `isError: true` is `error`.
- Routine start/end/completed events are `info`.

The panel should group subagent events by `agentId` where possible.

### Parent Pi sessions

Source:

```txt
~/.pi/agent/sessions/**/*.jsonl
```

Ingest a limited first slice:

- tool execution starts/ends when event shape is recognizable.
- assistant/model errors when event shape is recognizable.
- slash command or command result events when recognizable.

This should be read-only and defensive. Unknown event shapes become optional raw rows only when debug mode is enabled; otherwise avoid flooding the panel.

### Desktop transcript cache

Source:

```txt
~/Library/Application Support/pi/transcripts/*.json
```

Use transcripts only to attach user-facing session/workspace metadata and links. Do not scan full transcript text into the event list by default. Transcript scanning can leak user prompts into logs and create noise.

### Future agent activity ledger

Create a new GUI-owned source:

```txt
~/Library/Application Support/pi/logs/agent-activity.jsonl
```

This ledger should be append-only and structured. It should become the main future source for GUI-created events.

First ledger events to write:

- `session_selected`
- `composer_submit`
- `slash_command_start`
- `slash_command_end`
- `slash_command_failed`
- `parent_tool_start`
- `parent_tool_end`
- `skill_catalog_loaded`
- `skill_loaded`
- `workspace_runtime_selected`
- `workspace_cwd_mismatch_detected`

The first implementation may ingest existing logs before writing every ledger event, but the schema should be added up front so future instrumentation is consistent.

## Parent agent logging requirements

Parent agent observability must capture:

- selected workspace id/path when the user sends a message.
- runtime cwd used by the Pi session.
- session id and title.
- model and thinking level when known.
- tool start/end, tool name, tool call id, error status, duration, cwd when known.
- host slash-command start/end/failure, including `/compact` failures.
- active skill profile and skill settings snapshot when a session starts or changes.

Wrong-cwd debugging depends on logging both **selected workspace path** and **actual runtime cwd**. A row that only says `cwd=/Users/.../pi-gui` is not enough; it must also show what the GUI thought the selected repo was.

## Subagent logging requirements

Subagents need detailed lifecycle observability because they can run in the wrong repo, fork context incorrectly, or fail in the background.

Required subagent fields:

- parent workspace cwd and root.
- child workspace cwd and root.
- parent session id where available.
- parent tool call id for `Agent(...)` where available.
- subagent id.
- subagent type/role/display name.
- description.
- prompt excerpt, capped and whitespace-normalized.
- inherit context / isolated / worktree isolation flags.
- model and thinking level when available.
- session created timestamp.
- tool start/end events with tool name, tool call id, args excerpt, cwd/root, and error status.
- blocked tool events with reason and offending path.
- completion/failure status, duration, token summary, result excerpt, and error.

The current `pi-subagents` audit log already covers many of these. Gaps should be filled either by improving `pi-subagents` or by correlating GUI/session events around the Agent tool call.

## Skill logging requirements

Skills need enough observability to explain why an agent behaved a certain way.

Required skill events going forward:

- skill catalog loaded, with catalog path/count and filtered duplicate counts.
- skill selected explicitly by user/system prompt.
- skill auto-triggered by description match when available.
- skill preloaded into a subagent prompt.
- skill load failed, with path and error.

The GUI should show skills as a category, but the first slice can mark some skill data as unavailable if upstream Pi does not expose activation events yet.

## Workspace and cwd safety

The panel should make wrong-cwd incidents obvious.

Add or ingest events for:

- selected workspace changed.
- session runtime cwd resolved.
- subagent prompt references absolute paths outside workspace root.
- tool call attempted outside workspace root and was blocked.
- selected GUI workspace and runtime cwd disagree.

Safety event titles should be plain language:

- `Subagent blocked: prompt targets another repo`
- `Tool blocked: path outside workspace`
- `Runtime cwd differs from selected workspace`

These events should appear in Failures even if the guard worked correctly, because they explain why a run did not do what the user expected.

## Main / preload / renderer boundary

Implement log access in Electron main:

- Main reads bounded tails from approved log paths.
- Main normalizes events before sending to renderer.
- Renderer never receives arbitrary file read capability.
- IPC supports refresh/query with filters and pagination.

Suggested IPC:

```ts
listObservabilityEvents(input: {
  readonly workspaceId?: string;
  readonly severity?: readonly ObservabilitySeverity[];
  readonly category?: readonly ObservabilityCategory[];
  readonly query?: string;
  readonly since?: string;
  readonly limit?: number;
  readonly cursor?: string;
}): Promise<ObservabilityEventPage>
```

The implementation should cap file reads to avoid renderer OOM regressions. Start with recent tails, then add pagination.

## Error handling

- Missing log files produce a warning row in the panel, not a crash.
- Malformed JSONL lines produce parse-warning rows with source path/line.
- Large log files are tailed and paginated; never read unbounded logs into memory.
- IPC failures surface in the Logs panel header and `lastError` without replacing the current thread.

## Privacy and path handling

Logs necessarily contain local absolute paths. The GUI may display them because this is a local developer tool, but it should avoid copying logs into prompts automatically.

Rules:

- Do not inject log contents into agent context unless the user explicitly asks.
- Copy buttons copy only the selected event unless the user chooses export later.
- Truncate long prompts, tool args, and results in list rows; full raw JSON remains in details.
- Do not display secrets from provider settings. If API key-like fields appear in known config snapshots, redact them.

## Testing and verification

Automated checks:

- Unit tests for normalizing `desktop.log` lines into events.
- Unit tests for normalizing `subagents-audit.jsonl` lines into events.
- Unit tests for severity classification, especially failures and cwd safety events.
- Electron core test for topbar Logs icon opening the panel without leaving Threads.
- Electron core test for Logs + VS Code open simultaneously.
- Electron core test for switching Threads ↔ Display Mode preserves Logs panel open state.
- Electron core test for failure filter showing a seeded subagent failure.

Manual desktop verification:

- Launch real Electron surface.
- On Threads, click Logs icon; confirm the current thread stays selected.
- Open VS Code panel, then Logs; confirm Logs appears to the right of VS Code.
- Open Changes plus Logs; confirm both remain usable.
- Switch to Display Mode and back; confirm Logs remains open.
- Trigger or seed a slash-command failure and verify it appears under Failures.
- Run or inspect a subagent failure and verify subagent lifecycle/tool/cwd details are visible.

## Implementation slices

### Slice 1: Persistent panel shell

- Add Logs icon to topbar.
- Add independent Logs panel state and layout beside VS Code/Changes.
- Add static/empty Logs panel with filters and search.
- Verify panel behavior on Threads and Display Mode.

### Slice 2: Existing log ingestion

- Add main-process log reader/normalizer.
- Ingest `desktop.log` and `subagents-audit.jsonl`.
- Add filter/search/failure counts.
- Add details view and copy JSON.

### Slice 3: Agent activity ledger

- Add `agent-activity.jsonl` writer.
- Instrument composer submit, slash-command start/end/failure, selected workspace/runtime cwd, and available parent tool events.
- Correlate events with workspace/session ids.

### Slice 4: Deeper agent/subagent/skill correlation

- Improve `pi-subagents` audit fields if needed.
- Correlate parent Agent tool call to subagent id.
- Add skill catalog/load/activation events where available.
- Add related-events grouping by session/tool/subagent id.

## Risks

- Reading large logs can recreate renderer memory pressure. Mitigation: main-process tailing, limits, pagination, and no unbounded transcript scans.
- Event shapes in Pi session JSONL may change. Mitigation: defensive parser and source-specific tests.
- Too many info rows can bury real failures. Mitigation: default to Failures or recent important events, with categories for routine tool chatter.
- Path-rich logs can confuse future agents if pasted into prompts. Mitigation: display locally, copy intentionally, never auto-inject.
- Layout can become cramped with VS Code, Changes, and Logs open. Mitigation: resizable widths and sensible minimum panel widths.
