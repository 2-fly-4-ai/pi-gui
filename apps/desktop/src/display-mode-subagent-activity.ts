import type { TimelineToolCall, TranscriptMessage } from "./timeline-types";
import type { SubagentRunRecord } from "./subagent-workflows";

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

export function summarizeDisplayModeSubagentRuns(runs: readonly SubagentRunRecord[]): DisplayModeSubagentActivity | undefined {
  if (runs.length === 0) return undefined;
  const active = runs.filter((run) => run.status === "submitted" || run.status === "running");
  if (active.length > 0) return buildWorkflowActivity("running", active);
  const failed = runs.filter((run) => run.status === "failed" || run.status === "cancelled");
  if (failed.length > 0) return buildWorkflowActivity("failed", failed);
  return buildWorkflowActivity("completed", runs);
}

export function mergeDisplayModeSubagentActivity(
  transcriptActivity: DisplayModeSubagentActivity | undefined,
  runActivity: DisplayModeSubagentActivity | undefined,
): DisplayModeSubagentActivity | undefined {
  if (!transcriptActivity) return runActivity;
  if (!runActivity) return transcriptActivity;
  return activityPriority(runActivity.status) > activityPriority(transcriptActivity.status)
    ? runActivity
    : transcriptActivity;
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

function buildWorkflowActivity(status: DisplayModeSubagentActivity["status"], runs: readonly SubagentRunRecord[]): DisplayModeSubagentActivity {
  const roles = uniqueRunRoles(runs);
  const count = runs.length;
  const statusLabelText = status === "running" ? "running" : status === "failed" ? "needs attention" : "completed";
  const workflowLabel = count === 1 ? "Workflow" : "Workflows";
  return {
    status,
    count,
    roles,
    label: `${count} ${workflowLabel} ${statusLabelText}${roles.length > 0 ? ` · ${roles.join(", ")}` : ""}`,
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

function uniqueRunRoles(runs: readonly SubagentRunRecord[]): readonly string[] {
  const roles = new Set<string>();
  for (const run of runs) {
    for (const role of run.roles) {
      const value = role.trim();
      if (value) roles.add(value);
    }
  }
  return [...roles].slice(0, 3);
}

function activityPriority(status: DisplayModeSubagentActivity["status"]): number {
  if (status === "running") return 3;
  if (status === "failed") return 2;
  return 1;
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
