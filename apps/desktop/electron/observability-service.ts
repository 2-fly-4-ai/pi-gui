import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
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
const MAX_LIMIT = 1_000;
const AGENT_ACTIVITY_LOG = "agent-activity.jsonl";
const SUBAGENTS_AUDIT_LOG = path.join(homedir(), ".pi", "agent", "logs", "subagents-audit.jsonl");

type ObservabilitySource = {
  readonly path: string;
  readonly optional?: boolean;
  readonly global?: boolean;
  readonly kind?: "desktop-log" | "subagents-audit" | "ledger" | "session-jsonl";
  readonly workspaceId?: string;
  readonly workspacePath?: string;
  readonly sessionId?: string;
};
type RawLogLine = {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly global?: boolean;
  readonly kind?: "desktop-log" | "subagents-audit" | "ledger" | "session-jsonl";
  readonly workspaceId?: string;
  readonly workspacePath?: string;
  readonly sessionId?: string;
};

export async function listObservabilityEvents(input: ObservabilityQuery = {}): Promise<ObservabilityEventPage> {
  const warnings: string[] = [];
  const sources = [
    ...observabilitySources(),
    ...(await sessionObservabilitySources(input, warnings)),
  ];
  const pages = await Promise.all(sources.map((source) => readRecentLines(source, warnings)));
  const events = pages.flatMap((lines) => lines.flatMap(normalizeLine));
  const scoped = input.includeGlobal ? events : filterToCurrentScope(events, input);
  const filtered = filterEvents(scoped, input)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  return {
    events: filtered.slice(0, limit),
    scannedSources: sources.map((source) => source.path),
    warnings,
  };
}

export async function appendAgentActivity(event: Record<string, unknown>): Promise<void> {
  try {
    const userData = process.env.PI_APP_USER_DATA_DIR || app.getPath("userData");
    const logPath = path.join(userData, "logs", AGENT_ACTIVITY_LOG);
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, "utf8");
  } catch {
    // Observability must never break app/session behavior.
  }
}

function observabilitySources(): ObservabilitySource[] {
  const userData = process.env.PI_APP_USER_DATA_DIR || app.getPath("userData");
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  return [
    { path: getDesktopLogPath(), kind: "desktop-log" },
    { path: path.join(userData, "logs", AGENT_ACTIVITY_LOG), optional: true, kind: "ledger" },
    { path: process.env.PI_SUBAGENTS_AUDIT_LOG || path.join(agentDir, "logs", "subagents-audit.jsonl") || SUBAGENTS_AUDIT_LOG, global: true, kind: "subagents-audit" },
  ];
}

async function sessionObservabilitySources(input: ObservabilityQuery, warnings: string[]): Promise<ObservabilitySource[]> {
  const workspaceId = input.workspaceId?.trim();
  const sessionId = input.sessionId?.trim();
  if (!workspaceId || !sessionId) return [];

  const sessionFile = await findSessionFile(workspaceId, sessionId, warnings);
  if (!sessionFile) return [];
  return [{
    path: sessionFile,
    kind: "session-jsonl",
    workspaceId,
    workspacePath: input.workspacePath,
    sessionId,
  }];
}

async function findSessionFile(workspaceId: string, sessionId: string, warnings: string[]): Promise<string | undefined> {
  const userData = process.env.PI_APP_USER_DATA_DIR || app.getPath("userData");
  const catalogPath = path.join(userData, "catalogs.json");
  if (!existsSync(catalogPath)) return undefined;
  try {
    const raw = JSON.parse(await readFile(catalogPath, "utf8")) as Record<string, unknown>;
    const key = `${workspaceId}:${sessionId}`;
    const sessionFiles = isRecord(raw.sessionFiles) ? raw.sessionFiles : undefined;
    const fromSessionFiles = typeof sessionFiles?.[key] === "string" ? sessionFiles[key] : undefined;
    if (fromSessionFiles) return fromSessionFiles;

    const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
    for (const entry of sessions) {
      if (!isRecord(entry)) continue;
      const ref = isRecord(entry.sessionRef) ? entry.sessionRef : undefined;
      const matchesRef = ref?.workspaceId === workspaceId && ref?.sessionId === sessionId;
      const matchesFlat = entry.workspaceId === workspaceId && entry.sessionId === sessionId;
      if ((matchesRef || matchesFlat) && typeof entry.sessionFilePath === "string") {
        return entry.sessionFilePath;
      }
    }
  } catch (error) {
    warnings.push(`Failed to read session catalog ${catalogPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readRecentLines(source: ObservabilitySource, warnings: string[]): Promise<RawLogLine[]> {
  const filePath = source.path;
  if (!existsSync(filePath)) {
    if (!source.optional) warnings.push(`Missing log source: ${filePath}`);
    return [];
  }
  try {
    const buffer = await readFile(filePath);
    const start = Math.max(0, buffer.length - MAX_SOURCE_BYTES);
    const text = buffer.subarray(start).toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const skippedPrefix = start > 0 ? 1 : 0;
    return lines.slice(skippedPrefix).map((line, index) => ({
      path: filePath,
      line: index + 1,
      text: line,
      global: source.global,
      kind: source.kind,
      workspaceId: source.workspaceId,
      workspacePath: source.workspacePath,
      sessionId: source.sessionId,
    }));
  } catch (error) {
    warnings.push(`Failed to read log source ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function stableId(source: RawLogLine, event: string, timestamp: string): string {
  return createHash("sha1").update(`${source.path}:${source.line}:${event}:${timestamp}:${source.text}`).digest("hex").slice(0, 16);
}

function excerpt(value: unknown, max = 700): string | undefined {
  const text = stringifyExcerptValue(value);
  if (!text) return undefined;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function stringifyExcerptValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "kind", "event", "reason", "error", "title"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function normalizeLine(line: RawLogLine): ObservabilityEvent[] {
  const parsed = parseJson(line.text);
  if (line.kind === "session-jsonl") {
    const event = parsed ? normalizeSessionJsonl(line, parsed) : undefined;
    return event ? [event] : [];
  }
  if (line.kind === "subagents-audit" || line.path.endsWith("subagents-audit.jsonl")) {
    return parsed ? [normalizeSubagentAudit(line, parsed)] : [parseWarning(line, "subagents-audit")];
  }
  if (line.kind === "ledger" || line.path.endsWith(AGENT_ACTIVITY_LOG)) {
    return parsed ? [normalizeLedger(line, parsed)] : [parseWarning(line, "ledger")];
  }
  return [normalizeDesktopLog(line, parsed)];
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  } catch {
    const jsonStart = text.indexOf("{");
    if (jsonStart < 0) return undefined;
    try {
      const value = JSON.parse(text.slice(jsonStart));
      return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
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

function normalizeDesktopLog(source: RawLogLine, parsed: Record<string, unknown> | undefined): ObservabilityEvent {
  const payload = typeof parsed?.payload === "object" && parsed.payload !== null ? parsed.payload as Record<string, unknown> : undefined;
  const rendererPayload = typeof payload?.payload === "object" && payload.payload !== null ? payload.payload as Record<string, unknown> : undefined;
  const rawEvent = parsed?.event ?? parsed?.kind ?? rendererPayload?.kind ?? payload?.kind ?? detectDesktopEventFromText(source.text);
  const event = String(rawEvent ?? "desktop-log-line");
  const timestamp = String(parsed?.timestamp ?? parsed?.ts ?? rendererPayload?.timestamp ?? payload?.timestamp ?? extractTimestamp(source.text) ?? new Date(0).toISOString());
  const severity = severityForDesktopEvent(event, parsed, payload, rendererPayload, source.text);
  return {
    id: stableId(source, event, timestamp),
    timestamp,
    severity,
    category: event.startsWith("renderer") || event.startsWith("timeline") ? "renderer" : "desktop",
    event,
    title: titleForDesktopEvent(event),
    message: excerpt(parsed?.message ?? rendererPayload?.message ?? payload?.message ?? parsed?.payload ?? source.text),
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
    correlation: {
      workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : undefined,
      sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
      toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
      subagentId: typeof raw.subagentId === "string" ? raw.subagentId : undefined,
    },
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

function detectDesktopEventFromText(text: string): string {
  const match = text.match(/\b(renderer-[a-z-]+|main-[a-z-]+|render-process-gone|child-process-gone|timeline-[a-z-]+)\b/);
  return match?.[1] ?? "desktop-log-line";
}

function extractTimestamp(text: string): string | undefined {
  return text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)?.[0];
}

function normalizeSessionJsonl(source: RawLogLine, raw: Record<string, unknown>): ObservabilityEvent | undefined {
  if (raw.type !== "message" || !isRecord(raw.message)) return undefined;
  const message = raw.message;
  if (message.role !== "toolResult" || message.isError !== true) return undefined;

  const toolName = typeof message.toolName === "string" ? message.toolName : "tool";
  const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
  const timestamp = String(raw.timestamp ?? message.timestamp ?? new Date(0).toISOString());
  return {
    id: stableId(source, `session-tool-failed:${toolName}`, timestamp),
    timestamp,
    severity: "error",
    category: "tool",
    event: "session_tool_failed",
    title: `Tool failed: ${toolName}`,
    message: excerpt(sessionToolResultText(message.content)),
    source: { kind: "session-jsonl", path: source.path, line: source.line },
    correlation: {
      workspaceId: source.workspaceId,
      sessionId: source.sessionId,
      toolCallId,
    },
    workspace: {
      id: source.workspaceId,
      selectedPath: source.workspacePath,
      runtimeCwd: source.workspacePath,
      workspaceRoot: source.workspacePath,
    },
    tool: {
      name: toolName,
      isError: true,
    },
    raw,
  };
}

function sessionToolResultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : undefined)
    .filter(Boolean)
    .join("\n");
}

function severityForDesktopEvent(
  event: string,
  parsed: Record<string, unknown> | undefined,
  payload: Record<string, unknown> | undefined,
  rendererPayload: Record<string, unknown> | undefined,
  text: string,
): ObservabilitySeverity {
  const level = numericLogLevel(parsed?.level ?? payload?.level ?? rendererPayload?.level);
  if (level !== undefined && level >= 3) return "error";
  if (/maximum update depth exceeded|cannot update a component|minified react error/i.test(text)) return "error";
  if (/uncaught|unhandled|gone|fail|error/i.test(event) || /error|failed|terminated/i.test(text)) return "error";
  if (/unresponsive|warning|long-task|layout-shift/i.test(event) || /long-task|layout-shift/i.test(text) || level === 2) return "warning";
  return "info";
}

function numericLogLevel(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
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

function filterToCurrentScope(events: readonly ObservabilityEvent[], input: ObservabilityQuery): ObservabilityEvent[] {
  const workspacePath = input.workspacePath?.trim();
  const workspaceId = input.workspaceId?.trim();
  const sessionId = input.sessionId?.trim();
  if (!workspacePath && !workspaceId && !sessionId) return [...events];

  return events.filter((event) => {
    if (event.source.kind === "desktop-log") return true;
    if (workspaceId && event.correlation?.workspaceId === workspaceId) return true;
    if (sessionId && event.correlation?.sessionId === sessionId) return true;
    if (!workspacePath) return !isGlobalAuditEvent(event);
    return eventPathMatchesWorkspace(event.workspace?.workspaceRoot, workspacePath)
      || eventPathMatchesWorkspace(event.workspace?.repoRoot, workspacePath)
      || eventPathMatchesWorkspace(event.workspace?.runtimeCwd, workspacePath)
      || eventPathMatchesWorkspace(event.workspace?.selectedPath, workspacePath);
  });
}

function isGlobalAuditEvent(event: ObservabilityEvent): boolean {
  return event.source.kind === "subagents-audit";
}

function eventPathMatchesWorkspace(value: string | undefined, workspacePath: string): boolean {
  if (!value) return false;
  const normalizedValue = realpathIfExists(value);
  const normalizedWorkspace = realpathIfExists(workspacePath);
  return normalizedValue === normalizedWorkspace || normalizedValue.startsWith(`${normalizedWorkspace}${path.sep}`);
}

function realpathIfExists(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function filterEvents(events: readonly ObservabilityEvent[], input: ObservabilityQuery): ObservabilityEvent[] {
  const query = input.query?.trim().toLowerCase();
  const sinceMs = input.since ? Date.parse(input.since) : undefined;
  return events.filter((event) => {
    if (input.severity?.length && !input.severity.includes(event.severity)) return false;
    if (input.category?.length && !input.category.includes(event.category)) return false;
    if (sinceMs && Date.parse(event.timestamp) < sinceMs) return false;
    if (query) {
      const haystack = `${event.title} ${event.message ?? ""} ${event.event} ${event.category} ${event.agent?.type ?? ""} ${event.tool?.name ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
