# Agent Observability Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent Logs / Observability side panel that surfaces desktop, renderer, parent agent, tool, skill, subagent, cwd, and slash-command failures without leaving Threads or Display Mode.

**Architecture:** Add a narrow main-process observability service that tails approved local log files and normalizes them into shared event records. Expose a bounded IPC query through preload, render a persistent right-side Logs panel from App, and add topbar toggle state that coexists with VS Code and Changes panels.

**Tech Stack:** Electron main/preload IPC, React renderer, TypeScript shared types, Playwright core Electron tests, JSONL log parsing.

---

## Files and responsibilities

- Create `apps/desktop/src/observability-types.ts`: shared event, filter, and page types used by main, preload, renderer, and tests.
- Create `apps/desktop/electron/observability-service.ts`: bounded log readers and normalizers for `desktop.log`, `subagents-audit.jsonl`, and future `agent-activity.jsonl`.
- Create `apps/desktop/src/logs-panel.tsx`: right-side Logs panel UI with filters, search, event list, details, refresh, and failure counts.
- Modify `apps/desktop/src/ipc.ts`: add observability IPC names and preload API types.
- Modify `apps/desktop/electron/preload.ts`: expose `listObservabilityEvents` only.
- Modify `apps/desktop/electron/main.ts`: register IPC handler for observability queries.
- Modify `apps/desktop/src/icons.tsx`: add `LogsIcon`.
- Modify `apps/desktop/src/topbar.tsx`: add Logs topbar button and active state.
- Modify `apps/desktop/src/App.tsx`: add Logs panel state, layout classes, render the panel on Threads and Display Mode, preserve open/filter state across view switches.
- Modify `apps/desktop/src/styles/main.css`: add grid columns for Logs alongside VS Code/Changes/Plan and add Logs panel styles.
- Create `apps/desktop/tests/core/observability-panel.spec.ts`: UI tests for Logs opening, coexistence with VS Code, view switching, and seeded failure filtering.

---

### Task 1: Shared observability types and IPC shape

**Files:**
- Create: `apps/desktop/src/observability-types.ts`
- Modify: `apps/desktop/src/ipc.ts`

- [ ] **Step 1: Create shared event types**

Create `apps/desktop/src/observability-types.ts` with:

```ts
export type ObservabilitySeverity = "info" | "warning" | "error";
export type ObservabilityCategory =
  | "desktop"
  | "renderer"
  | "agent"
  | "tool"
  | "skill"
  | "subagent"
  | "workspace"
  | "slash-command";

export interface ObservabilityEventSource {
  readonly kind: "desktop-log" | "subagents-audit" | "session-jsonl" | "transcript" | "ledger";
  readonly path?: string;
  readonly line?: number;
}

export interface ObservabilityEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly severity: ObservabilitySeverity;
  readonly category: ObservabilityCategory;
  readonly event: string;
  readonly title: string;
  readonly message?: string;
  readonly source: ObservabilityEventSource;
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

export interface ObservabilityQuery {
  readonly workspaceId?: string;
  readonly severity?: readonly ObservabilitySeverity[];
  readonly category?: readonly ObservabilityCategory[];
  readonly query?: string;
  readonly since?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ObservabilityEventPage {
  readonly events: readonly ObservabilityEvent[];
  readonly nextCursor?: string;
  readonly scannedSources: readonly string[];
  readonly warnings: readonly string[];
}
```

- [ ] **Step 2: Add IPC names and API types**

In `apps/desktop/src/ipc.ts`, import the types and add `listObservabilityEvents` to `desktopIpc`:

```ts
import type { ObservabilityEventPage, ObservabilityQuery } from "./observability-types";
```

Add this key near the other app APIs:

```ts
listObservabilityEvents: "pi-gui:list-observability-events",
```

Add this method to `PiDesktopApi`:

```ts
listObservabilityEvents(input?: ObservabilityQuery): Promise<ObservabilityEventPage>;
```

- [ ] **Step 3: Run typecheck to expose integration gaps**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: fails because preload/main do not implement `listObservabilityEvents` yet.

---

### Task 2: Main-process log normalizer

**Files:**
- Create: `apps/desktop/electron/observability-service.ts`
- Test through: `apps/desktop/tests/core/observability-panel.spec.ts` in later tasks

- [ ] **Step 1: Implement bounded JSONL/text tail reading**

Create `apps/desktop/electron/observability-service.ts` with these exported functions:

```ts
import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ObservabilityCategory,
  ObservabilityEvent,
  ObservabilityEventPage,
  ObservabilityQuery,
  ObservabilitySeverity,
} from "../src/observability-types";
import { getDesktopLogPath } from "./diagnostics";

const MAX_SOURCE_BYTES = 512 * 1024;
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;
const AGENT_ACTIVITY_LOG = "agent-activity.jsonl";
const SUBAGENTS_AUDIT_LOG = path.join(homedir(), ".pi", "agent", "logs", "subagents-audit.jsonl");

type RawLogLine = { readonly path: string; readonly line: number; readonly text: string };

export async function listObservabilityEvents(input: ObservabilityQuery = {}): Promise<ObservabilityEventPage> {
  const warnings: string[] = [];
  const sources = observabilitySources();
  const pages = await Promise.all(sources.map((source) => readRecentLines(source, warnings)));
  const events = pages.flatMap((lines) => lines.flatMap(normalizeLine));
  const filtered = filterEvents(events, input)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  return {
    events: filtered.slice(0, limit),
    scannedSources: sources,
    warnings,
  };
}

function observabilitySources(): string[] {
  const userData = process.env.PI_APP_USER_DATA_DIR || app.getPath("userData");
  return [
    getDesktopLogPath(),
    path.join(userData, "logs", AGENT_ACTIVITY_LOG),
    process.env.PI_SUBAGENTS_AUDIT_LOG || SUBAGENTS_AUDIT_LOG,
  ];
}
```

- [ ] **Step 2: Add line reading helpers**

Append these helpers in the same file:

```ts
async function readRecentLines(filePath: string, warnings: string[]): Promise<RawLogLine[]> {
  if (!existsSync(filePath)) {
    warnings.push(`Missing log source: ${filePath}`);
    return [];
  }
  try {
    const buffer = await readFile(filePath);
    const start = Math.max(0, buffer.length - MAX_SOURCE_BYTES);
    const text = buffer.subarray(start).toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const skippedPrefix = start > 0 ? 1 : 0;
    return lines.slice(skippedPrefix).map((line, index) => ({ path: filePath, line: index + 1, text: line }));
  } catch (error) {
    warnings.push(`Failed to read log source ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function stableId(source: RawLogLine, event: string, timestamp: string): string {
  return createHash("sha1").update(`${source.path}:${source.line}:${event}:${timestamp}:${source.text}`).digest("hex").slice(0, 16);
}

function excerpt(value: unknown, max = 700): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}
```

- [ ] **Step 3: Normalize desktop and subagent lines**

Append these helpers:

```ts
function normalizeLine(line: RawLogLine): ObservabilityEvent[] {
  const parsed = parseJson(line.text);
  if (line.path.endsWith("subagents-audit.jsonl")) {
    return parsed ? [normalizeSubagentAudit(line, parsed)] : [parseWarning(line, "subagents-audit")];
  }
  if (line.path.endsWith(AGENT_ACTIVITY_LOG)) {
    return parsed ? [normalizeLedger(line, parsed)] : [parseWarning(line, "ledger")];
  }
  return [normalizeDesktopLog(line, parsed)];
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSubagentAudit(source: RawLogLine, raw: Record<string, unknown>): ObservabilityEvent {
  const event = String(raw.event ?? "subagent_event");
  const timestamp = String(raw.ts ?? raw.timestamp ?? new Date(0).toISOString());
  const toolName = typeof raw.toolName === "string" ? raw.toolName : undefined;
  const agentId = typeof raw.agentId === "string" ? raw.agentId : typeof raw.id === "string" ? raw.id : undefined;
  const blocked = event.includes("blocked");
  const failed = event.includes("failed") || raw.status === "error" || raw.status === "failed" || raw.isError === true;
  return {
    id: stableId(source, event, timestamp),
    timestamp,
    severity: blocked || failed ? "error" : "info",
    category: event.includes("tool") ? "tool" : "subagent",
    event,
    title: titleForSubagentEvent(event, raw),
    message: excerpt(typeof raw.reason === "string" ? raw.reason : typeof raw.error === "string" ? raw.error : typeof raw.resultExcerpt === "string" ? raw.resultExcerpt : undefined),
    source: { kind: "subagents-audit", path: source.path, line: source.line },
    correlation: {
      subagentId: agentId,
      toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
    },
    workspace: {
      runtimeCwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
      workspaceRoot: typeof raw.workspaceRoot === "string" ? raw.workspaceRoot : undefined,
      repoRoot: typeof raw.workspaceRoot === "string" ? raw.workspaceRoot : undefined,
    },
    agent: {
      kind: "subagent",
      type: typeof raw.type === "string" ? raw.type : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      status: typeof raw.status === "string" ? raw.status : undefined,
    },
    tool: toolName ? {
      name: toolName,
      argsExcerpt: excerpt(JSON.stringify(raw.args ?? raw.path ?? "")),
      isError: raw.isError === true,
    } : undefined,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : undefined,
    raw,
  };
}

function titleForSubagentEvent(event: string, raw: Record<string, unknown>): string {
  if (event === "subagent_spawn_blocked") return "Subagent blocked: prompt targets another repo";
  if (event === "subagent_tool_blocked") return `Tool blocked: ${String(raw.toolName ?? "tool")}`;
  if (event === "subagent_failed") return `Subagent failed: ${String(raw.description ?? raw.type ?? "unknown")}`;
  if (event === "subagent_completed") return `Subagent completed: ${String(raw.description ?? raw.type ?? "unknown")}`;
  if (event === "subagent_tool_start") return `Tool started: ${String(raw.toolName ?? "tool")}`;
  if (event === "subagent_tool_end") return raw.isError === true ? `Tool failed: ${String(raw.toolName ?? "tool")}` : `Tool finished: ${String(raw.toolName ?? "tool")}`;
  return event.replace(/_/g, " ");
}
```

- [ ] **Step 4: Normalize desktop diagnostics and ledger events**

Append:

```ts
function normalizeDesktopLog(source: RawLogLine, parsed: Record<string, unknown> | undefined): ObservabilityEvent {
  const rawEvent = parsed?.event ?? parsed?.kind ?? detectDesktopEventFromText(source.text);
  const event = String(rawEvent ?? "desktop-log-line");
  const timestamp = String(parsed?.timestamp ?? parsed?.ts ?? extractTimestamp(source.text) ?? new Date(0).toISOString());
  const severity = severityForDesktopEvent(event, parsed, source.text);
  return {
    id: stableId(source, event, timestamp),
    timestamp,
    severity,
    category: event.startsWith("renderer") ? "renderer" : "desktop",
    event,
    title: titleForDesktopEvent(event),
    message: excerpt(String(parsed?.message ?? parsed?.payload ?? source.text)),
    source: { kind: "desktop-log", path: source.path, line: source.line },
    raw: parsed ?? source.text,
  };
}

function normalizeLedger(source: RawLogLine, raw: Record<string, unknown>): ObservabilityEvent {
  const event = String(raw.event ?? "agent_activity");
  const timestamp = String(raw.timestamp ?? raw.ts ?? new Date(0).toISOString());
  const severity = normalizeSeverity(raw.severity) ?? (event.includes("failed") || event.includes("mismatch") ? "error" : "info");
  return {
    id: stableId(source, event, timestamp),
    timestamp,
    severity,
    category: normalizeCategory(raw.category) ?? "agent",
    event,
    title: typeof raw.title === "string" ? raw.title : event.replace(/_/g, " "),
    message: excerpt(typeof raw.message === "string" ? raw.message : undefined),
    source: { kind: "ledger", path: source.path, line: source.line },
    raw,
  };
}

function parseWarning(source: RawLogLine, kind: "subagents-audit" | "ledger"): ObservabilityEvent {
  const timestamp = new Date().toISOString();
  return {
    id: stableId(source, "parse-warning", timestamp),
    timestamp,
    severity: "warning",
    category: kind === "subagents-audit" ? "subagent" : "agent",
    event: "log_parse_warning",
    title: "Could not parse log line",
    message: excerpt(source.text),
    source: { kind: kind === "subagents-audit" ? "subagents-audit" : "ledger", path: source.path, line: source.line },
    raw: source.text,
  };
}
```

- [ ] **Step 5: Add classification/filter helpers**

Append:

```ts
function detectDesktopEventFromText(text: string): string {
  const match = text.match(/\b(renderer-[a-z-]+|main-[a-z-]+|render-process-gone|child-process-gone)\b/);
  return match?.[1] ?? "desktop-log-line";
}

function extractTimestamp(text: string): string | undefined {
  return text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)?.[0];
}

function severityForDesktopEvent(event: string, parsed: Record<string, unknown> | undefined, text: string): ObservabilitySeverity {
  if (/uncaught|unhandled|gone|fail|error/i.test(event) || /error|failed|terminated/i.test(text)) return "error";
  if (/unresponsive|warning|long-task|layout-shift/i.test(event) || parsed?.level === 2) return "warning";
  return "info";
}

function titleForDesktopEvent(event: string): string {
  if (event === "main-unhandled-rejection") return "Main process unhandled rejection";
  if (event === "main-uncaught-exception") return "Main process uncaught exception";
  if (event === "render-process-gone") return "Renderer process gone";
  if (event === "renderer-console-message") return "Renderer console error";
  if (event === "renderer-diagnostic") return "Renderer diagnostic";
  return event.replace(/-/g, " ");
}

function normalizeSeverity(value: unknown): ObservabilitySeverity | undefined {
  return value === "info" || value === "warning" || value === "error" ? value : undefined;
}

function normalizeCategory(value: unknown): ObservabilityCategory | undefined {
  const categories: readonly ObservabilityCategory[] = ["desktop", "renderer", "agent", "tool", "skill", "subagent", "workspace", "slash-command"];
  return categories.includes(value as ObservabilityCategory) ? value as ObservabilityCategory : undefined;
}

function filterEvents(events: readonly ObservabilityEvent[], input: ObservabilityQuery): ObservabilityEvent[] {
  const query = input.query?.trim().toLowerCase();
  const sinceMs = input.since ? Date.parse(input.since) : undefined;
  return events.filter((event) => {
    if (input.severity?.length && !input.severity.includes(event.severity)) return false;
    if (input.category?.length && !input.category.includes(event.category)) return false;
    if (sinceMs && Date.parse(event.timestamp) < sinceMs) return false;
    if (input.workspaceId && event.correlation?.workspaceId !== input.workspaceId && event.workspace?.id !== input.workspaceId) return false;
    if (query) {
      const haystack = `${event.title} ${event.message ?? ""} ${event.event} ${event.category} ${event.agent?.type ?? ""} ${event.tool?.name ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 6: Run typecheck for this file**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: still fails until IPC/preload/main are wired, but `observability-service.ts` should not have local syntax/type errors.

---

### Task 3: Wire observability IPC through main and preload

**Files:**
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/src/ipc.ts`

- [ ] **Step 1: Expose preload method**

In `apps/desktop/electron/preload.ts`, import no Node filesystem APIs. Add this to the object passed to `contextBridge.exposeInMainWorld("piApp", ...)`:

```ts
listObservabilityEvents: (input?: ObservabilityQuery) =>
  ipcRenderer.invoke(desktopIpc.listObservabilityEvents, input) as Promise<ObservabilityEventPage>,
```

Import the types at the top:

```ts
import type { ObservabilityEventPage, ObservabilityQuery } from "../src/observability-types";
```

- [ ] **Step 2: Register main IPC handler**

In `apps/desktop/electron/main.ts`, import:

```ts
import { listObservabilityEvents } from "./observability-service";
```

Add an `ipcMain.handle` near other handlers:

```ts
ipcMain.handle(desktopIpc.listObservabilityEvents, async (_event, input) => listObservabilityEvents(input));
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: passes or reports only renderer UI references not yet created.

- [ ] **Step 4: Commit IPC and service**

```bash
git add apps/desktop/src/observability-types.ts apps/desktop/src/ipc.ts apps/desktop/electron/observability-service.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts
git commit -m "feat(desktop): add observability log query"
```

---

### Task 4: Logs panel UI component

**Files:**
- Create: `apps/desktop/src/logs-panel.tsx`
- Modify: `apps/desktop/src/icons.tsx`
- Modify: `apps/desktop/src/styles/main.css`

- [ ] **Step 1: Add Logs icon**

In `apps/desktop/src/icons.tsx`, add:

```tsx
export function LogsIcon() {
  return (
    <Icon>
      <rect x="4" y="3.8" width="12" height="12.4" rx="2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M7 7.1h6M7 10h6M7 12.9h3.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <circle cx="14.2" cy="14.1" r="1.25" fill="currentColor" />
    </Icon>
  );
}
```

- [ ] **Step 2: Create LogsPanel component**

Create `apps/desktop/src/logs-panel.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ObservabilityCategory, ObservabilityEvent, ObservabilityEventPage, ObservabilitySeverity } from "./observability-types";
import type { PiDesktopApi } from "./ipc";
import { CloseIcon, RefreshIcon } from "./icons";

const CATEGORIES: readonly { value: ObservabilityCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "desktop", label: "Desktop" },
  { value: "renderer", label: "Renderer" },
  { value: "agent", label: "Agent" },
  { value: "tool", label: "Tools" },
  { value: "skill", label: "Skills" },
  { value: "subagent", label: "Subagents" },
  { value: "workspace", label: "Workspace" },
  { value: "slash-command", label: "Slash" },
];

const SEVERITIES: readonly { value: ObservabilitySeverity | "all" | "failures"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failures", label: "Failures" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "Info" },
];

export function LogsPanel({ api, onClose }: { readonly api: PiDesktopApi; readonly onClose: () => void }) {
  const [page, setPage] = useState<ObservabilityEventPage>({ events: [], scannedSources: [], warnings: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [severity, setSeverity] = useState<ObservabilitySeverity | "all" | "failures">(() => readLocal("logs:severity") as ObservabilitySeverity | "all" | "failures" || "failures");
  const [category, setCategory] = useState<ObservabilityCategory | "all">(() => readLocal("logs:category") as ObservabilityCategory | "all" || "all");
  const [query, setQuery] = useState(() => readLocal("logs:query") || "");
  const [selectedId, setSelectedId] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const severityFilter = severity === "all" ? undefined : severity === "failures" ? ["error" as const] : [severity];
      const categoryFilter = category === "all" ? undefined : [category];
      const next = await api.listObservabilityEvents({ severity: severityFilter, category: categoryFilter, query, limit: 500 });
      setPage(next);
      setSelectedId((current) => current && next.events.some((event) => event.id === current) ? current : next.events[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, category, query, severity]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { writeLocal("logs:severity", severity); }, [severity]);
  useEffect(() => { writeLocal("logs:category", category); }, [category]);
  useEffect(() => { writeLocal("logs:query", query); }, [query]);

  const selected = useMemo(() => page.events.find((event) => event.id === selectedId), [page.events, selectedId]);
  const failureCount = page.events.filter((event) => event.severity === "error").length;

  return (
    <aside className="logs-panel" data-testid="logs-panel" aria-label="Logs panel">
      <header className="logs-panel__header">
        <div>
          <div className="logs-panel__eyebrow">Observability</div>
          <h2>Logs</h2>
        </div>
        <span className="logs-panel__failure-count" data-testid="logs-failure-count">{failureCount} failures</span>
        <button className="icon-button" type="button" aria-label="Refresh logs" onClick={() => void refresh()} disabled={loading}><RefreshIcon /></button>
        <button className="icon-button" type="button" aria-label="Close logs" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="logs-panel__filters">
        <input aria-label="Search logs" className="logs-panel__search" placeholder="Search logs" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Log severity" value={severity} onChange={(event) => setSeverity(event.target.value as ObservabilitySeverity | "all" | "failures")}>
          {SEVERITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select aria-label="Log category" value={category} onChange={(event) => setCategory(event.target.value as ObservabilityCategory | "all")}>
          {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      {error ? <div className="logs-panel__error">{error}</div> : null}
      {page.warnings.length > 0 ? <div className="logs-panel__warning">{page.warnings[0]}</div> : null}
      <div className="logs-panel__body">
        <div className="logs-panel__list" role="list" aria-label="Log events">
          {page.events.length === 0 ? <div className="logs-panel__empty">No log events match this filter.</div> : page.events.map((event) => (
            <button
              key={event.id}
              className={`logs-panel__event logs-panel__event--${event.severity}${selectedId === event.id ? " logs-panel__event--selected" : ""}`}
              type="button"
              role="listitem"
              onClick={() => setSelectedId(event.id)}
            >
              <span className="logs-panel__event-time">{formatTime(event.timestamp)}</span>
              <span className="logs-panel__event-title">{event.title}</span>
              <span className="logs-panel__event-meta">{event.category} · {event.source.kind}</span>
              {event.message ? <span className="logs-panel__event-message">{event.message}</span> : null}
            </button>
          ))}
        </div>
        <EventDetails event={selected} />
      </div>
    </aside>
  );
}

function EventDetails({ event }: { readonly event: ObservabilityEvent | undefined }) {
  if (!event) return <div className="logs-panel__details logs-panel__details--empty">Select an event to inspect raw details.</div>;
  return (
    <section className="logs-panel__details" aria-label="Log event details">
      <h3>{event.title}</h3>
      <dl>
        <dt>Severity</dt><dd>{event.severity}</dd>
        <dt>Category</dt><dd>{event.category}</dd>
        <dt>Source</dt><dd>{event.source.kind}{event.source.line ? `:${event.source.line}` : ""}</dd>
        {event.workspace?.runtimeCwd ? <><dt>cwd</dt><dd>{event.workspace.runtimeCwd}</dd></> : null}
        {event.workspace?.workspaceRoot ? <><dt>workspace</dt><dd>{event.workspace.workspaceRoot}</dd></> : null}
        {event.agent?.type ? <><dt>agent</dt><dd>{event.agent.type}</dd></> : null}
        {event.tool?.name ? <><dt>tool</dt><dd>{event.tool.name}</dd></> : null}
      </dl>
      <pre>{JSON.stringify(event.raw ?? event, null, 2)}</pre>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function readLocal(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}
```

- [ ] **Step 3: Add panel styles**

Append to `apps/desktop/src/styles/main.css`:

```css
.logs-panel {
  grid-row: 2 / -1;
  width: var(--logs-panel-width, 380px);
  min-width: 320px;
  border-left: 1px solid var(--border);
  background: #0f141d;
  color: #e8edf7;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.logs-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.logs-panel__header h2 { margin: 0; font-size: 15px; }
.logs-panel__eyebrow { color: #8b98ad; font-size: 11px; font-weight: 750; text-transform: uppercase; letter-spacing: 0.08em; }
.logs-panel__failure-count { margin-left: auto; color: #ffb4aa; font-size: 12px; font-weight: 650; }
.logs-panel__filters { display: grid; grid-template-columns: 1fr 110px 120px; gap: 6px; padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.logs-panel__search,
.logs-panel__filters select { min-height: 30px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 8px; background: #151b26; color: #e8edf7; padding: 0 8px; }
.logs-panel__warning,
.logs-panel__error { margin: 8px 10px 0; padding: 8px; border-radius: 8px; font-size: 12px; }
.logs-panel__warning { background: rgba(210, 153, 34, 0.14); color: #ffd58a; }
.logs-panel__error { background: rgba(248, 81, 73, 0.14); color: #ffb4aa; }
.logs-panel__body { display: grid; grid-template-rows: minmax(0, 1fr) minmax(170px, 38%); min-height: 0; flex: 1; }
.logs-panel__list { overflow-y: auto; min-height: 0; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.logs-panel__event { text-align: left; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 8px; background: #151b26; color: inherit; display: grid; gap: 3px; }
.logs-panel__event:hover,
.logs-panel__event--selected { border-color: rgba(125, 146, 255, 0.7); background: #1a2230; }
.logs-panel__event--error { border-color: rgba(248, 81, 73, 0.36); }
.logs-panel__event--warning { border-color: rgba(210, 153, 34, 0.36); }
.logs-panel__event-time,
.logs-panel__event-meta { color: #8b98ad; font-size: 11px; }
.logs-panel__event-title { font-size: 13px; font-weight: 650; }
.logs-panel__event-message { color: #c4ccda; font-size: 12px; line-height: 1.35; }
.logs-panel__details { border-top: 1px solid rgba(255, 255, 255, 0.1); overflow: auto; padding: 10px; background: #0b0f16; }
.logs-panel__details h3 { margin: 0 0 8px; font-size: 13px; }
.logs-panel__details dl { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 4px 8px; margin: 0 0 8px; font-size: 12px; }
.logs-panel__details dt { color: #8b98ad; }
.logs-panel__details dd { margin: 0; overflow-wrap: anywhere; }
.logs-panel__details pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; color: #c4ccda; }
.logs-panel__empty,
.logs-panel__details--empty { color: #8b98ad; padding: 16px; font-size: 13px; }
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: passes for this component once App integration is still absent because it is unused.

---

### Task 5: Persistent topbar toggle and layout integration

**Files:**
- Modify: `apps/desktop/src/topbar.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`

- [ ] **Step 1: Add topbar props and button**

In `apps/desktop/src/topbar.tsx`, import `LogsIcon` and extend props:

```ts
readonly logsOpen?: boolean;
readonly onToggleLogs?: () => void;
```

Add the button near VS Code / Changes actions:

```tsx
{onToggleLogs !== undefined && (
  <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
    <button
      aria-label="Toggle logs panel"
      className={`icon-button topbar__icon ${logsOpen ? "icon-button--active" : ""}`}
      type="button"
      onClick={onToggleLogs}
    >
      <LogsIcon />
    </button>
    <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
      <span>Toggle logs</span>
    </span>
  </div>
)}
```

- [ ] **Step 2: Add App state and render LogsPanel**

In `apps/desktop/src/App.tsx`, import `LogsPanel` and add state near the VS Code/diff state:

```ts
const [logsOpen, setLogsOpen] = useState(() => { try { return localStorage.getItem("logs:open") === "true"; } catch { return false; } });
const toggleLogsPanel = useCallback(() => {
  setLogsOpen((open) => {
    const next = !open;
    try { localStorage.setItem("logs:open", String(next)); } catch {}
    return next;
  });
}, []);
```

Compute:

```ts
const showLogsPanel = logsOpen && (snapshot.activeView === "threads" || snapshot.activeView === "display-mode");
```

Add `showLogsPanel ? "main--with-logs" : ""` to `mainClassName`.

Pass props to `Topbar`:

```tsx
logsOpen={snapshot.activeView === "threads" || snapshot.activeView === "display-mode" ? logsOpen : undefined}
onToggleLogs={snapshot.activeView === "threads" || snapshot.activeView === "display-mode" ? toggleLogsPanel : undefined}
```

Render after VS Code and Diff panels so it appears far right:

```tsx
{showLogsPanel ? <LogsPanel api={api} onClose={() => setLogsOpen(false)} /> : null}
```

- [ ] **Step 3: Replace brittle grid combinations with side-panel variables**

At the top of `apps/desktop/src/styles/main.css`, replace the existing `.main--with-diff`, `.main--with-vscode`, `.main--with-plan`, and combination grid-column rules with a simpler side-panel grid:

```css
.main {
  --main-side-columns: ;
  background: #fbfbfd;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--main-side-columns);
  grid-template-rows: auto 1fr auto;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.main--with-plan { --plan-panel-column: minmax(320px, 30vw); }
.main--with-diff { --diff-panel-column: 400px; }
.main--with-vscode { --vscode-panel-column: 5px var(--thread-vscode-width, 520px); }
.main--with-logs { --logs-panel-column: var(--logs-panel-width, 380px); }

.main--with-plan,
.main--with-diff,
.main--with-vscode,
.main--with-logs {
  --main-side-columns: var(--plan-panel-column, ) var(--diff-panel-column, ) var(--vscode-panel-column, ) var(--logs-panel-column, );
}

.main--with-diff > .topbar,
.main--with-vscode > .topbar,
.main--with-plan > .topbar,
.main--with-logs > .topbar { grid-column: 1 / -1; }

.main--with-diff > .composer,
.main--with-vscode > .composer,
.main--with-plan > .composer,
.main--with-logs > .composer { grid-column: 1; }

.main--with-plan > .plan-panel { grid-column: 2; grid-row: 2 / -1; width: auto; }
.main--with-diff > .diff-panel { grid-column: 3; grid-row: 2 / -1; }
.main--with-vscode > .thread-vscode-resize-handle { grid-column: 4; grid-row: 2 / -1; }
.main--with-vscode > .thread-vscode-panel { grid-column: 5; grid-row: 2 / -1; }
.main--with-logs > .logs-panel { grid-column: -2; grid-row: 2 / -1; }
```

If CSS variable empty column lists are unreliable in Electron Chromium, use explicit combination rules instead. Prefer explicit rules if type/e2e shows layout regressions.

- [ ] **Step 4: Run focused UI smoke manually through Playwright target once tests exist**

No command yet; this task is complete after typecheck and integration tests in Task 6.

- [ ] **Step 5: Commit UI shell**

```bash
git add apps/desktop/src/topbar.tsx apps/desktop/src/App.tsx apps/desktop/src/icons.tsx apps/desktop/src/logs-panel.tsx apps/desktop/src/styles/main.css
git commit -m "feat(desktop): add persistent logs panel"
```

---

### Task 6: E2E coverage for panel behavior and seeded failures

**Files:**
- Create: `apps/desktop/tests/core/observability-panel.spec.ts`

- [ ] **Step 1: Write Playwright spec**

Create `apps/desktop/tests/core/observability-panel.spec.ts` with tests that seed logs in `userDataDir` and agent dir before launch:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "@playwright/test";
import { launchDesktop } from "../helpers/electron-app";

async function seedLogs(userDataDir: string, agentDir: string): Promise<void> {
  await mkdir(join(userDataDir, "logs"), { recursive: true });
  await mkdir(join(agentDir, "logs"), { recursive: true });
  await writeFile(join(userDataDir, "logs", "desktop.log"), JSON.stringify({
    timestamp: "2026-05-21T08:31:31.000Z",
    event: "main-unhandled-rejection",
    message: "Summarization failed: terminated",
  }) + "\n", "utf8");
  await writeFile(join(agentDir, "logs", "subagents-audit.jsonl"), JSON.stringify({
    ts: "2026-05-21T08:32:31.000Z",
    event: "subagent_spawn_blocked",
    agentId: "agent-1",
    type: "scout",
    description: "Wrong repo check",
    cwd: "/repo/pi-gui",
    workspaceRoot: "/repo/pi-gui",
    reason: "Prompt references /repo/lago outside workspace",
    path: "/repo/lago",
  }) + "\n", "utf8");
}

test("logs panel opens on threads and shows seeded failures", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await expect(page.getByText("Subagent blocked: prompt targets another repo")).toBeVisible();
    await expect(page.getByText("Main process unhandled rejection")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("logs panel stays open when switching threads and display mode", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-observability-view-"));
  const agentDir = join(userDataDir, "agent");
  await seedLogs(userDataDir, agentDir);
  const app = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [userDataDir], testMode: "background" });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("Toggle logs panel").click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await page.getByRole("button", { name: "Display Mode" }).click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
    await page.getByRole("button", { name: "Threads" }).click();
    await expect(page.getByTestId("logs-panel")).toBeVisible();
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Add a VS Code coexistence assertion if server is deterministic**

If the existing helper starts VS Code reliably in test mode, add:

```ts
await page.getByLabel("Toggle VS Code panel").click();
await expect(page.getByTestId("thread-vscode-panel")).toBeVisible();
await expect(page.getByTestId("logs-panel")).toBeVisible();
```

If VS Code server startup is flaky in background core, skip this assertion and rely on CSS/grid tests plus manual verification.

- [ ] **Step 3: Run targeted spec**

Run:

```bash
pnpm --filter @pi-gui/desktop test:e2e:runner -- apps/desktop/tests/core/observability-panel.spec.ts
```

Expected: both tests pass.

- [ ] **Step 4: Commit tests**

```bash
git add apps/desktop/tests/core/observability-panel.spec.ts
git commit -m "test(desktop): cover observability panel"
```

---

### Task 7: First structured agent activity ledger events

**Files:**
- Modify: `apps/desktop/electron/observability-service.ts`
- Modify: `apps/desktop/electron/app-store-composer.ts`

- [ ] **Step 1: Add ledger writer**

In `apps/desktop/electron/observability-service.ts`, export:

```ts
import { appendFile, mkdir } from "node:fs/promises";

export async function appendAgentActivity(event: Record<string, unknown>): Promise<void> {
  const userData = process.env.PI_APP_USER_DATA_DIR || app.getPath("userData");
  const logPath = path.join(userData, "logs", AGENT_ACTIVITY_LOG);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, "utf8");
}
```

- [ ] **Step 2: Log slash-command failures**

In `apps/desktop/electron/app-store-composer.ts`, import `appendAgentActivity`. In the existing catch path that now surfaces host command failures, add:

```ts
void appendAgentActivity({
  severity: "error",
  category: "slash-command",
  event: "slash_command_failed",
  title: "Slash command failed",
  message: error instanceof Error ? error.message : String(error),
  workspaceId: sessionRef.workspaceId,
  sessionId: sessionRef.sessionId,
});
```

Use the actual local variable names from the catch block; do not change existing composer error behavior.

- [ ] **Step 3: Run focused slash failure regression**

Run:

```bash
pnpm --filter @pi-gui/desktop test:e2e:runner -- apps/desktop/tests/core/composer-controls.spec.ts -g "host slash command failures"
```

Expected: pass.

- [ ] **Step 4: Run observability spec again**

Run:

```bash
pnpm --filter @pi-gui/desktop test:e2e:runner -- apps/desktop/tests/core/observability-panel.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit ledger slice**

```bash
git add apps/desktop/electron/observability-service.ts apps/desktop/electron/app-store-composer.ts
git commit -m "feat(desktop): log agent activity failures"
```

---

### Task 8: Verification and real-surface check

**Files:**
- No source changes expected unless verification reveals defects.

- [ ] **Step 1: Run typecheck**

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: pass.

- [ ] **Step 2: Run targeted E2E specs**

```bash
pnpm --filter @pi-gui/desktop test:e2e:runner -- apps/desktop/tests/core/observability-panel.spec.ts apps/desktop/tests/core/composer-controls.spec.ts -g "host slash command failures|logs panel"
```

Expected: pass.

- [ ] **Step 3: Run build**

```bash
pnpm --filter @pi-gui/desktop build
```

Expected: pass.

- [ ] **Step 4: Real Electron surface verification**

Launch or reload the real-data app only with user approval if a restart is needed. Verify:

- Topbar Logs icon appears.
- On Threads, clicking Logs opens the panel without changing selected thread.
- Open VS Code then Logs; Logs appears to the right of VS Code.
- Open Changes plus Logs; both panels remain usable.
- Switch to Display Mode and back; Logs remains open.
- Failures filter shows recent `desktop.log` / `subagents-audit.jsonl` failures.

- [ ] **Step 5: Final commit if verification fixes were needed**

If any verification fixes were made:

```bash
git add <changed-files>
git commit -m "fix(desktop): stabilize observability panel"
```

---

## Self-review

- Spec coverage: persistent panel, topbar icon, Threads/Display Mode availability, coexistence with VS Code/Changes, failure-first filters, desktop/subagent ingestion, cwd safety highlighting, and slash-command failure ledger are covered.
- Deferred but represented: deeper parent tool event and skill activation logging remain future instrumentation after initial ledger; schema and category UI are ready.
- Placeholder scan: no unresolved placeholder text remains.
- Type consistency: `ObservabilityEvent`, `ObservabilityQuery`, `ObservabilityEventPage`, IPC names, and component props use the same names across tasks.
