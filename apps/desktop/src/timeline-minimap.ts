import type { AttentionMarker } from "./attention-markers";
import type { TimelineDisplayRow } from "./semantic-timeline-compression";
import type { TranscriptMessage } from "./timeline-types";

export const TIMELINE_MINIMAP_THRESHOLD = 100;
export const TIMELINE_MINIMAP_MAX_SEGMENTS = 96;

export type TimelineMinimapSignalType =
  | "user"
  | "subagent"
  | "failure"
  | "approval"
  | "decision"
  | "milestone"
  | "completion";

export interface TimelineMinimapSegment {
  readonly id: string;
  readonly rowId: string;
  readonly position: number;
  readonly types: readonly TimelineMinimapSignalType[];
  readonly count: number;
  readonly label: string;
}

interface RawSignal {
  readonly rawIndex: number;
  readonly rowId: string;
  readonly type: TimelineMinimapSignalType;
  readonly label: string;
}

export function buildTimelineMinimap(
  transcript: readonly TranscriptMessage[],
  displayRows: readonly TimelineDisplayRow[],
  attentionMarkers: readonly AttentionMarker[],
  maximumSegments = TIMELINE_MINIMAP_MAX_SEGMENTS,
): readonly TimelineMinimapSegment[] {
  if (transcript.length < TIMELINE_MINIMAP_THRESHOLD || maximumSegments < 1) return [];
  const displayRowByRawId = displayRowMap(displayRows);
  const rawIndexById = new Map(transcript.map((item, index) => [item.id, index]));
  const signals: RawSignal[] = [];

  for (let index = 0; index < transcript.length; index += 1) {
    const item = transcript[index];
    if (!item) continue;
    if (item.kind === "message" && item.role === "user") {
      signals.push({ rawIndex: index, rowId: displayRowByRawId.get(item.id) ?? item.id, type: "user", label: "User message" });
    } else if (item.kind === "tool" && isAgentTool(item.toolName)) {
      signals.push({ rawIndex: index, rowId: displayRowByRawId.get(item.id) ?? item.id, type: "subagent", label: item.label });
    }
  }

  for (const marker of attentionMarkers) {
    const type = signalTypeForMarker(marker.type);
    if (!type) continue;
    const rawIndex = rawIndexById.get(marker.rowId) ?? rawIndexForDisplayRow(marker.rowId, displayRows, rawIndexById);
    if (rawIndex === undefined) continue;
    signals.push({
      rawIndex,
      rowId: displayRowByRawId.get(marker.rowId) ?? marker.rowId,
      type,
      label: marker.label,
    });
  }

  const bins = new Map<number, RawSignal[]>();
  for (const signal of signals) {
    const bin = Math.min(maximumSegments - 1, Math.floor(signal.rawIndex / transcript.length * maximumSegments));
    const existing = bins.get(bin);
    if (existing) existing.push(signal);
    else bins.set(bin, [signal]);
  }

  return [...bins.entries()].sort(([left], [right]) => left - right).map(([bin, entries]) => {
    const representative = preferredSignal(entries);
    const types = [...new Set(entries.map((entry) => entry.type))];
    const labels = [...new Set(entries.map((entry) => entry.label))].slice(0, 3);
    return {
      id: `minimap:${bin}:${representative.rowId}`,
      rowId: representative.rowId,
      position: (bin + 0.5) / maximumSegments,
      types,
      count: entries.length,
      label: labels.join(" · "),
    };
  });
}

function displayRowMap(displayRows: readonly TimelineDisplayRow[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of displayRows) {
    if (row.kind === "semantic-group") {
      for (const item of row.items) result.set(item.id, row.id);
    } else {
      result.set(row.id, row.id);
    }
  }
  return result;
}

function rawIndexForDisplayRow(
  rowId: string,
  displayRows: readonly TimelineDisplayRow[],
  rawIndexById: ReadonlyMap<string, number>,
): number | undefined {
  const row = displayRows.find((candidate) => candidate.id === rowId);
  if (!row) return undefined;
  if (row.kind !== "semantic-group") return rawIndexById.get(row.id);
  return rawIndexById.get(row.items[0]?.id ?? "");
}

function signalTypeForMarker(type: AttentionMarker["type"]): TimelineMinimapSignalType | undefined {
  if (type === "input-required" || type === "approval") return "approval";
  if (type === "failure") return "failure";
  if (type === "decision") return "decision";
  if (type === "milestone" || type === "checkpoint") return "milestone";
  if (type === "completion") return "completion";
  return undefined;
}

function preferredSignal(signals: readonly RawSignal[]): RawSignal {
  return [...signals].sort((left, right) => signalPriority(right.type) - signalPriority(left.type))[0]!;
}

function signalPriority(type: TimelineMinimapSignalType): number {
  if (type === "failure" || type === "approval") return 5;
  if (type === "completion" || type === "decision") return 4;
  if (type === "milestone") return 3;
  if (type === "subagent") return 2;
  return 1;
}

function isAgentTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "agent" || normalized.endsWith(".agent");
}
