import type { TimelineToolCall, TranscriptMessage } from "./timeline-types";

export interface DisplayModeSubagentActivity {
  readonly status: "running" | "completed" | "failed";
  readonly count: number;
  readonly roles: readonly string[];
  readonly label: string;
}

export function summarizeDisplayModeSubagents(transcript: readonly TranscriptMessage[]): DisplayModeSubagentActivity | undefined {
  const agentRows = transcript.filter(isAgentToolCall);
  if (agentRows.length === 0) return undefined;
  const running = agentRows.filter((item) => item.status === "running");
  if (running.length > 0) return buildSubagentActivity("running", running);
  const failed = agentRows.filter((item) => item.status === "error");
  if (failed.length > 0) return buildSubagentActivity("failed", failed);
  return buildSubagentActivity("completed", agentRows);
}

function buildSubagentActivity(status: DisplayModeSubagentActivity["status"], rows: readonly TimelineToolCall[]): DisplayModeSubagentActivity {
  const roles = uniqueRoles(rows);
  const count = rows.length;
  const statusLabelText = status === "running" ? "running" : status === "failed" ? "needs attention" : "completed";
  const agentLabel = count === 1 ? "Agent" : "Agents";
  return {
    status,
    count,
    roles,
    label: `${count} ${agentLabel} ${statusLabelText}${roles.length > 0 ? ` · ${roles.join(", ")}` : ""}`,
  };
}

function uniqueRoles(rows: readonly TimelineToolCall[]): readonly string[] {
  const roles = new Set<string>();
  for (const row of rows) {
    const role = roleFromAgentToolCall(row);
    if (role) roles.add(role);
  }
  return [...roles].slice(0, 3);
}

function isAgentToolCall(item: TranscriptMessage): item is TimelineToolCall {
  return item.kind === "tool" && item.toolName.toLowerCase() === "agent";
}

function roleFromAgentToolCall(item: TimelineToolCall): string | undefined {
  const inputRole = roleFromAgentInput(item.input);
  if (inputRole) return inputRole;
  const labelRole = item.label.match(/^(?:Started|Running|Completed|Cancelled|Failed)\s+(.+)$/i)?.[1]?.trim();
  if (labelRole && labelRole.toLowerCase() !== "subagent") return labelRole;
  return undefined;
}

function roleFromAgentInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const value = record.subagent_type ?? record.subagentType ?? record.agentName ?? record.role;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
