import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_SCAN_INTERVAL_MS = 750;
const MAX_AUDIT_BYTES = 2 * 1024 * 1024;

export type SubagentAuditStatus = "started" | "progress" | "completed" | "failed" | "cancelled";

export interface SubagentAuditLifecycleEvent {
  readonly timestamp: string;
  readonly status: SubagentAuditStatus;
  readonly workflowRunId?: string;
  readonly parentToolCallId?: string;
  readonly agentId?: string;
  readonly role?: string;
  readonly description?: string;
  readonly cwd?: string;
  readonly toolUseCount?: number;
  readonly elapsedMs?: number;
  readonly summary?: string;
}

interface PendingSpawn {
  readonly timestamp: string;
  readonly workflowRunId?: string;
  readonly parentToolCallId?: string;
  readonly role?: string;
  readonly description?: string;
  readonly cwd?: string;
  claimed: boolean;
}

interface AgentCorrelation extends PendingSpawn {
  toolUseCount: number;
}

export interface SubagentAuditAdapterOptions {
  readonly auditPath?: string;
  readonly scanIntervalMs?: number;
  readonly onEvent: (event: SubagentAuditLifecycleEvent) => void | Promise<void>;
}

/**
 * Converts pi-subagents' append-only audit JSONL into stable lifecycle events.
 * The adapter intentionally owns the fuzzy spawn/session pairing so the durable
 * run store only receives exact workflow, parent tool-call, or child-agent IDs.
 */
export class SubagentAuditAdapter {
  private readonly auditPath: string;
  private readonly scanIntervalMs: number;
  private readonly pendingSpawns: PendingSpawn[] = [];
  private readonly agents = new Map<string, AgentCorrelation>();
  private readonly seenLines = new Set<string>();
  private readonly lifecycleEvents: SubagentAuditLifecycleEvent[] = [];
  private interval?: ReturnType<typeof setInterval>;
  private scanInFlight = false;

  constructor(private readonly options: SubagentAuditAdapterOptions) {
    this.auditPath = options.auditPath ?? resolveSubagentAuditPath();
    this.scanIntervalMs = options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.scan(), this.scanIntervalMs);
    void this.scan();
  }

  dispose(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }

  async scan(): Promise<void> {
    if (this.scanInFlight) return;
    this.scanInFlight = true;
    try {
      const buffer = await readAuditFile(this.auditPath);
      if (!buffer) return;
      const start = Math.max(0, buffer.length - MAX_AUDIT_BYTES);
      const lines = buffer.subarray(start).toString("utf8").split(/\r?\n/);
      if (start > 0) lines.shift();
      for (const line of lines) {
        if (!line || this.seenLines.has(line)) continue;
        this.seenLines.add(line);
        if (this.seenLines.size > 20_000) {
          const oldest = this.seenLines.values().next().value;
          if (oldest) this.seenLines.delete(oldest);
        }
        await this.consumeLine(line);
      }
    } finally {
      this.scanInFlight = false;
    }
  }

  async replay(onEvent: SubagentAuditAdapterOptions["onEvent"] = this.options.onEvent): Promise<void> {
    for (const event of this.lifecycleEvents) await onEvent(event);
  }

  private async emit(event: SubagentAuditLifecycleEvent): Promise<void> {
    this.lifecycleEvents.push(event);
    if (this.lifecycleEvents.length > 10_000) this.lifecycleEvents.shift();
    await this.options.onEvent(event);
  }

  private async consumeLine(line: string): Promise<void> {
    const record = parseAuditRecord(line);
    if (!record) return;
    const eventName = stringField(record, "event");
    const timestamp = stringField(record, "ts") ?? stringField(record, "timestamp") ?? new Date().toISOString();
    const role = stringField(record, "type") ?? stringField(record, "role");
    const cwd = stringField(record, "cwd") ?? stringField(record, "workspaceRoot");

    if (eventName === "subagent_spawn_requested") {
      const prompt = stringField(record, "promptExcerpt");
      const workflowRunId = extractWorkflowRunId(prompt);
      const parentToolCallId = stringField(record, "toolCallId");
      const description = stringField(record, "description");
      const pending: PendingSpawn = {
        timestamp,
        ...(workflowRunId ? { workflowRunId } : {}),
        ...(parentToolCallId ? { parentToolCallId } : {}),
        ...(role ? { role } : {}),
        ...(description ? { description } : {}),
        ...(cwd ? { cwd } : {}),
        claimed: false,
      };
      this.pendingSpawns.push(pending);
      if (this.pendingSpawns.length > 2_000) this.pendingSpawns.shift();
      await this.emit(toLifecycleEvent(pending, timestamp, "started"));
      return;
    }

    const agentId = stringField(record, "agentId") ?? stringField(record, "id");
    if (eventName === "subagent_session_create" && agentId) {
      const pending = this.claimPendingSpawn(role, cwd);
      const correlation: AgentCorrelation = { ...(pending ?? { timestamp, claimed: true }), ...(role ? { role } : {}), ...(cwd ? { cwd } : {}), toolUseCount: 0 };
      this.agents.set(agentId, correlation);
      await this.emit({ ...toLifecycleEvent(correlation, timestamp, "started"), agentId });
      return;
    }

    if (!agentId) return;
    const correlation = this.agents.get(agentId) ?? {
      timestamp,
      ...(role ? { role } : {}),
      ...(cwd ? { cwd } : {}),
      claimed: true,
      toolUseCount: 0,
    };
    this.agents.set(agentId, correlation);

    if (eventName === "subagent_tool_end") {
      correlation.toolUseCount += 1;
      await this.emit({
        ...toLifecycleEvent(correlation, timestamp, "progress"),
        agentId,
        toolUseCount: correlation.toolUseCount,
        ...(stringField(record, "toolName") ? { summary: `Used ${stringField(record, "toolName")}` } : {}),
      });
      return;
    }
    if (eventName === "subagent_needs_attention") {
      await this.emit({
        ...toLifecycleEvent(correlation, timestamp, "progress"),
        agentId,
        ...(stringField(record, "reason") ? { summary: stringField(record, "reason") } : {}),
      });
      return;
    }
    if (eventName !== "subagent_completed" && eventName !== "subagent_failed" && eventName !== "subagent_cancelled") return;

    const rawStatus = stringField(record, "status")?.toLowerCase();
    const status: SubagentAuditStatus = eventName === "subagent_failed"
      ? "failed"
      : eventName === "subagent_cancelled" || rawStatus === "cancelled" || rawStatus === "aborted" || rawStatus === "stopped"
        ? "cancelled"
        : "completed";
    const toolUseCount = numberField(record, "toolUses") ?? correlation.toolUseCount;
    const elapsedMs = numberField(record, "durationMs");
    const summary = stringField(record, "resultExcerpt") ?? stringField(record, "error");
    await this.emit({
      ...toLifecycleEvent(correlation, timestamp, status),
      agentId,
      ...(role ? { role } : {}),
      ...(toolUseCount > 0 ? { toolUseCount } : {}),
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      ...(summary ? { summary } : {}),
    });
  }

  private claimPendingSpawn(role?: string, cwd?: string): PendingSpawn | undefined {
    const match = [...this.pendingSpawns].reverse().find((pending) =>
      !pending.claimed && (!role || !pending.role || pending.role === role) && (!cwd || !pending.cwd || pending.cwd === cwd)
    );
    if (match) match.claimed = true;
    return match;
  }
}

async function readAuditFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch {
    // The upstream extension creates this optional log lazily.
    return undefined;
  }
}

export function resolveSubagentAuditPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  return process.env.PI_SUBAGENTS_AUDIT_LOG || path.join(agentDir, "logs", "subagents-audit.jsonl");
}

export function extractWorkflowRunId(prompt: string | undefined): string | undefined {
  return prompt?.match(/(?:^|\s)workflow_run_id:\s*([^\s]+)/i)?.[1];
}

function parseAuditRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" && record[key].trim() ? record[key] : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : undefined;
}

function toLifecycleEvent(
  correlation: PendingSpawn,
  timestamp: string,
  status: SubagentAuditStatus,
): SubagentAuditLifecycleEvent {
  return {
    timestamp,
    status,
    ...(correlation.workflowRunId ? { workflowRunId: correlation.workflowRunId } : {}),
    ...(correlation.parentToolCallId ? { parentToolCallId: correlation.parentToolCallId } : {}),
    ...(correlation.role ? { role: correlation.role } : {}),
    ...(correlation.description ? { description: correlation.description } : {}),
    ...(correlation.cwd ? { cwd: correlation.cwd } : {}),
  };
}
