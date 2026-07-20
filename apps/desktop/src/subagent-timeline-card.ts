import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";
import { isSubagentWorkflowMessageMetadata } from "./subagent-workflows";

export interface SubagentTimelineCardModel {
  readonly workflowRunId?: string;
  readonly workflow: string;
  readonly roles: readonly string[];
  readonly artifacts: readonly string[];
}

export function subagentWorkflowCardFromMessage(message: SessionTranscriptMessage): SubagentTimelineCardModel | undefined {
  return subagentWorkflowCardFromMetadata(message.metadata) ?? parseSubagentWorkflowMarker(message.text);
}

export function parseSubagentWorkflowMarker(text: string): SubagentTimelineCardModel | undefined {
  const lines = normalizeMarkerLines(text);
  if (lines[0] !== "SUBAGENT_WORKFLOW_RUN") return undefined;

  const fields = markerFields(lines);
  const workflow = fields.workflow;
  const roles = fields.roles
    ?.split(/\s*->\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
  const artifacts = fields.artifacts
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

  if (!workflow) return undefined;
  return { workflow, roles, artifacts, ...(fields.workflowRunId ? { workflowRunId: fields.workflowRunId } : {}) };
}

function subagentWorkflowCardFromMetadata(metadata: unknown): SubagentTimelineCardModel | undefined {
  if (!isSubagentWorkflowMessageMetadata(metadata)) return undefined;
  return {
    ...(metadata.workflowRunId ? { workflowRunId: metadata.workflowRunId } : {}),
    workflow: metadata.workflow,
    roles: metadata.roles,
    artifacts: metadata.artifacts,
  };
}

function normalizeMarkerLines(text: string): readonly string[] {
  const normalized = text
    .replace(/\r/g, "")
    .trim()
    .replace(/\s+(workflow_run_id|workflow|roles|artifacts|User instruction):/gi, "\n$1:")
    .replace(/\s+Run this Nico-lite subagent workflow/gi, "\nRun this Nico-lite subagent workflow");

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function markerFields(lines: readonly string[]): {
  readonly workflowRunId?: string;
  readonly workflow?: string;
  readonly roles?: string;
  readonly artifacts?: string;
} {
  const fields: { workflowRunId?: string; workflow?: string; roles?: string; artifacts?: string } = {};
  for (const line of lines.slice(1)) {
    const lower = line.toLowerCase();
    if (lower.startsWith("run this nico-lite subagent workflow") || lower.startsWith("user instruction:")) {
      break;
    }
    if (fields.workflowRunId === undefined && lower.startsWith("workflow_run_id:")) {
      fields.workflowRunId = line.slice("workflow_run_id:".length).trim();
    } else if (fields.workflow === undefined && lower.startsWith("workflow:")) {
      fields.workflow = line.slice("workflow:".length).trim();
    } else if (fields.roles === undefined && lower.startsWith("roles:")) {
      fields.roles = line.slice("roles:".length).trim();
    } else if (fields.artifacts === undefined && lower.startsWith("artifacts:")) {
      fields.artifacts = line.slice("artifacts:".length).trim();
    }
  }
  return fields;
}
