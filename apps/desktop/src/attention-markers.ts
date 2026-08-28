import type { TaskEvidenceRecord } from "./product-experience/task-evidence";
import type { TranscriptMessage } from "./timeline-types";

export type AttentionMarkerType =
  | "input-required"
  | "approval"
  | "failure"
  | "direction-change"
  | "checkpoint"
  | "decision"
  | "milestone"
  | "completion";

export interface AttentionMarker {
  readonly id: string;
  readonly type: AttentionMarkerType;
  readonly label: string;
  readonly rowId: string;
  readonly timestamp: string;
  readonly evidenceId?: string;
}

export function deriveAttentionMarkers(
  transcript: readonly TranscriptMessage[],
  evidence: readonly TaskEvidenceRecord[],
): readonly AttentionMarker[] {
  if (transcript.length === 0) return [];
  const markers: AttentionMarker[] = [];

  for (const item of transcript) {
    if (item.kind === "message" && item.role === "user") {
      markers.push({
        id: `direction:${item.id}`,
        type: "direction-change",
        label: "User direction",
        rowId: item.id,
        timestamp: item.createdAt,
      });
    } else if (item.kind === "summary" && item.presentation === "divider") {
      markers.push({
        id: `milestone:${item.id}`,
        type: "milestone",
        label: item.label,
        rowId: item.id,
        timestamp: item.createdAt,
      });
    }
  }

  for (const record of evidence) {
    const type = markerTypeForEvidence(record);
    if (!type) continue;
    const rowId = correlatedRowId(record, transcript)
      ?? (type === "completion" ? nearestCompletionRowId(record.timestamp, transcript) : undefined);
    if (!rowId) continue;
    markers.push({
      id: `evidence:${record.id}:${type}`,
      type,
      label: markerLabel(type, record),
      rowId,
      timestamp: record.timestamp,
      evidenceId: record.id,
    });
  }

  const rowOrder = new Map(transcript.map((item, index) => [item.id, index]));
  return dedupeMarkers(markers).sort((left, right) => (
    (rowOrder.get(left.rowId) ?? Number.MAX_SAFE_INTEGER) - (rowOrder.get(right.rowId) ?? Number.MAX_SAFE_INTEGER) ||
    Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
    left.id.localeCompare(right.id)
  ));
}

function markerTypeForEvidence(record: TaskEvidenceRecord): AttentionMarkerType | undefined {
  if (record.kind === "approval") {
    return record.status === "pending" || record.status === "blocked" ? "input-required" : "approval";
  }
  if (record.kind === "error" || record.status === "failed") return "failure";
  if (record.kind === "checkpoint") return "checkpoint";
  if (record.kind === "decision") return "decision";
  if (record.kind === "completion") return "completion";
  if ((record.kind === "verification" || record.kind === "test") && record.status === "passed") return "milestone";
  return undefined;
}

function correlatedRowId(
  record: TaskEvidenceRecord,
  transcript: readonly TranscriptMessage[],
): string | undefined {
  const toolCallId = record.correlation?.toolCallId;
  if (!toolCallId) return undefined;
  return transcript.find((item) => item.kind === "tool" && item.callId === toolCallId)?.id;
}

function nearestCompletionRowId(timestamp: string, transcript: readonly TranscriptMessage[]): string | undefined {
  const completionRows = transcript.filter(
    (item) => item.kind === "summary" && item.presentation === "divider",
  );
  if (completionRows.length === 0) return undefined;
  const target = Date.parse(timestamp);
  if (!Number.isFinite(target)) return completionRows.at(-1)?.id;
  let nearest: { readonly id: string; readonly distance: number } | undefined;
  for (const item of completionRows) {
    const itemTime = Date.parse(item.createdAt);
    if (!Number.isFinite(itemTime)) continue;
    const distance = Math.abs(itemTime - target);
    if (!nearest || distance < nearest.distance) nearest = { id: item.id, distance };
  }
  return nearest?.id ?? completionRows.at(-1)?.id;
}

function markerLabel(type: AttentionMarkerType, record: TaskEvidenceRecord): string {
  if (type === "input-required") return `Input required · ${record.summary}`;
  if (type === "approval") return `Approval · ${record.summary}`;
  if (type === "failure") return `Failure · ${record.summary}`;
  if (type === "checkpoint") return `Checkpoint · ${record.summary}`;
  if (type === "decision") return `Decision · ${record.summary}`;
  if (type === "completion") return `Completion · ${record.summary}`;
  return `Milestone · ${record.summary}`;
}

function dedupeMarkers(markers: readonly AttentionMarker[]): AttentionMarker[] {
  const seen = new Set<string>();
  return markers.filter((marker) => {
    const key = `${marker.type}:${marker.evidenceId ?? marker.rowId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
