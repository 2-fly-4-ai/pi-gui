import type { TimelineCompressionMode } from "./appearance-preferences";
import type { TimelineActivity, TimelineToolCall, TranscriptMessage } from "./timeline-types";

const GROUP_WINDOW_MS = 45_000;
const AUTOMATIC_TRANSCRIPT_THRESHOLD = 24;

export type SemanticTimelineGroupKind = "read" | "search" | "command" | "retry" | "progress";

export interface SemanticTimelineGroup {
  readonly kind: "semantic-group";
  readonly id: string;
  readonly groupKind: SemanticTimelineGroupKind;
  readonly items: readonly TranscriptMessage[];
  readonly count: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly summary: string;
  readonly exceptions: readonly string[];
}

export type TimelineDisplayRow = TranscriptMessage | SemanticTimelineGroup;

interface GroupCandidate {
  readonly kind: SemanticTimelineGroupKind;
  readonly correlation: string;
  readonly label: string;
  readonly timestamp: string;
}

export function compressTimelineRows(
  transcript: readonly TranscriptMessage[],
  mode: TimelineCompressionMode,
): readonly TimelineDisplayRow[] {
  if (mode === "expanded" || (mode === "automatic" && transcript.length < AUTOMATIC_TRANSCRIPT_THRESHOLD)) {
    return transcript;
  }

  const minimumGroupSize = mode === "compact" ? 2 : 3;
  const rows: TimelineDisplayRow[] = [];
  let pendingItems: TranscriptMessage[] = [];
  let pendingCandidate: GroupCandidate | undefined;

  const flush = () => {
    if (pendingItems.length >= minimumGroupSize && pendingCandidate) {
      rows.push(makeGroup(pendingItems, pendingCandidate.kind));
    } else {
      rows.push(...pendingItems);
    }
    pendingItems = [];
    pendingCandidate = undefined;
  };

  for (const item of transcript) {
    const candidate = groupCandidate(item);
    if (!candidate) {
      flush();
      rows.push(item);
      continue;
    }
    if (
      pendingCandidate &&
      (pendingCandidate.kind !== candidate.kind ||
        pendingCandidate.correlation !== candidate.correlation ||
        timestampDistance(pendingCandidate.timestamp, candidate.timestamp) > GROUP_WINDOW_MS)
    ) {
      flush();
    }
    pendingItems.push(item);
    pendingCandidate ??= candidate;
  }
  flush();
  return rows;
}

function groupCandidate(item: TranscriptMessage): GroupCandidate | undefined {
  if (item.kind === "tool") return toolCandidate(item);
  if (item.kind === "activity") return activityCandidate(item);
  return undefined;
}

function toolCandidate(item: TimelineToolCall): GroupCandidate | undefined {
  if (item.status !== "success" || isAgentTool(item.toolName)) return undefined;
  const command = commandFromInput(item.input);
  const normalizedTool = item.toolName.toLowerCase();
  const kind: SemanticTimelineGroupKind =
    isSearchCommand(command) || /search|grep|glob|find|ripgrep/.test(normalizedTool)
      ? "search"
      : isReadCommand(command) || /read|fetch|open|list/.test(normalizedTool)
        ? "read"
        : command || /bash|shell|command|exec/.test(normalizedTool)
          ? "command"
          : "progress";
  return {
    kind,
    correlation: `${kind}:${normalizedTool}:${metadataCorrelation(item.metadata)}`,
    label: item.label,
    timestamp: item.updatedAt ?? item.createdAt,
  };
}

function activityCandidate(item: TimelineActivity): GroupCandidate | undefined {
  if (item.tone === "error" || item.tone === "warning") return undefined;
  const normalized = `${item.label} ${item.detail ?? ""}`.toLowerCase();
  const kind = /retry|retrying|attempt/.test(normalized) ? "retry" : "progress";
  if (kind === "progress" && !/read|search|running|working|progress|waiting|used|checked|inspect/.test(normalized)) {
    return undefined;
  }
  return {
    kind,
    correlation: `${kind}:${metadataCorrelation(item.metadata)}:${normalizedLabel(item.label)}`,
    label: item.label,
    timestamp: item.createdAt,
  };
}

function makeGroup(items: readonly TranscriptMessage[], kind: SemanticTimelineGroupKind): SemanticTimelineGroup {
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) throw new Error("Cannot create an empty timeline group.");
  const startedAt = timestampFor(first);
  const endedAt = timestampFor(last);
  const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  const labels = items.map(labelFor);
  const primaryLabel = labels[0] ?? kind;
  const exceptions = [...new Set(labels.filter((label) => label !== primaryLabel))].slice(0, 3);
  return {
    kind: "semantic-group",
    id: `semantic-group:${first.id}`,
    groupKind: kind,
    items,
    count: items.length,
    startedAt,
    endedAt,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    summary: summaryFor(kind, items.length),
    exceptions,
  };
}

function summaryFor(kind: SemanticTimelineGroupKind, count: number): string {
  if (kind === "read") return `Read ${count} items`;
  if (kind === "search") return `Ran ${count} searches`;
  if (kind === "command") return `Ran ${count} commands`;
  if (kind === "retry") return `Retried ${count} times`;
  return `${count} progress updates`;
}

function timestampFor(item: TranscriptMessage): string {
  return item.kind === "tool" ? item.updatedAt ?? item.createdAt : item.createdAt;
}

function labelFor(item: TranscriptMessage): string {
  if (item.kind === "tool" || item.kind === "activity" || item.kind === "summary") return item.label;
  if (item.kind === "runtime-job") return item.job.title;
  if (item.kind === "message") return item.text.slice(0, 80);
  return item.text.slice(0, 80);
}

function timestampDistance(left: string, right: string): number {
  const distance = Date.parse(right) - Date.parse(left);
  return Number.isFinite(distance) ? Math.max(0, distance) : Number.POSITIVE_INFINITY;
}

function metadataCorrelation(metadata: string | undefined): string {
  return metadata?.trim().toLowerCase().slice(0, 96) || "session";
}

function normalizedLabel(label: string): string {
  return label.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function commandFromInput(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command.trim().toLowerCase() : "";
}

function isSearchCommand(command: string): boolean {
  return /^(?:rg|grep|find|fd)\b/.test(command);
}

function isReadCommand(command: string): boolean {
  return /^(?:cat|head|tail|sed\s+-n|less)\b/.test(command);
}

function isAgentTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "agent" || normalized.endsWith(".agent");
}
