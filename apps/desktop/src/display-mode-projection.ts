import type { TranscriptMessage } from "./timeline-types";
import type { DisplayModeSubagentActivity } from "./display-mode-subagent-activity";
import { projectLatestThinkingPerRun } from "./thinking-trace-projection";

export const DISPLAY_MODE_PROJECTION_MAX_ROWS = 8;
export const DISPLAY_MODE_PROJECTION_MAX_BYTES = 96 * 1024;

const DISPLAY_MODE_MESSAGE_TEXT_MAX_CHARS = 16 * 1024;
const DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS = 8 * 1024;
const TRUNCATION_MARKER = "\n… excerpt truncated";

export interface DisplayModeThreadProjection {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly sourceUpdatedAt: string;
  readonly showThinking: boolean;
  readonly excerptRows: readonly TranscriptMessage[];
  readonly subagentActivity?: DisplayModeSubagentActivity;
  readonly previewUrls: readonly string[];
  readonly truncated: boolean;
  readonly serializedBytes: number;
}

export type DisplayModeProjectionResponse =
  | { readonly kind: "projection"; readonly projection: DisplayModeThreadProjection }
  | { readonly kind: "not-modified"; readonly revision: number }
  | { readonly kind: "not-found" };

export interface DisplayModeProjectionChangedEvent {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly sourceUpdatedAt: string;
}

export function buildDisplayModeThreadProjection(input: {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly sourceUpdatedAt: string;
  readonly transcript: readonly TranscriptMessage[];
  readonly showThinking: boolean;
  readonly subagentActivity?: DisplayModeSubagentActivity;
}): DisplayModeThreadProjection {
  const visibleTranscript = input.showThinking
    ? projectLatestThinkingPerRun(input.transcript)
    : input.transcript;
  const eligibleRows = visibleTranscript.filter((row) =>
    row.kind !== "runtime-job" && (input.showThinking || row.kind !== "thinking"),
  );
  const sourceRows = eligibleRows.slice(-DISPLAY_MODE_PROJECTION_MAX_ROWS);
  const clippedRows = sourceRows.map((row) => clipProjectionRow(row));
  const previewUrls = collectPreviewUrls(clippedRows);
  let truncated =
    eligibleRows.length > DISPLAY_MODE_PROJECTION_MAX_ROWS ||
    clippedRows.some((row, index) => JSON.stringify(row) !== JSON.stringify(sourceRows[index]));
  let excerptRows = clippedRows;

  let projection = projectionWithSize({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    revision: input.revision,
    sourceUpdatedAt: input.sourceUpdatedAt,
    showThinking: input.showThinking,
    excerptRows,
    ...(input.subagentActivity ? { subagentActivity: input.subagentActivity } : {}),
    previewUrls,
    truncated,
  });

  while (projection.serializedBytes > DISPLAY_MODE_PROJECTION_MAX_BYTES && excerptRows.length > 1) {
    excerptRows = excerptRows.slice(1);
    truncated = true;
    projection = projectionWithSize({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      revision: input.revision,
      sourceUpdatedAt: input.sourceUpdatedAt,
      showThinking: input.showThinking,
      excerptRows,
      ...(input.subagentActivity ? { subagentActivity: input.subagentActivity } : {}),
      previewUrls,
      truncated,
    });
  }

  if (projection.serializedBytes > DISPLAY_MODE_PROJECTION_MAX_BYTES && excerptRows.length === 1) {
    excerptRows = [clipProjectionRow(excerptRows[0] as TranscriptMessage, 2 * 1024)];
    projection = projectionWithSize({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      revision: input.revision,
      sourceUpdatedAt: input.sourceUpdatedAt,
      showThinking: input.showThinking,
      excerptRows,
      ...(input.subagentActivity ? { subagentActivity: input.subagentActivity } : {}),
      previewUrls,
      truncated: true,
    });
  }

  return projection;
}

export function projectionSerializedBytes(projection: Omit<DisplayModeThreadProjection, "serializedBytes">): number {
  return utf8ByteLength(JSON.stringify(projection));
}

function projectionWithSize(
  projection: Omit<DisplayModeThreadProjection, "serializedBytes">,
): DisplayModeThreadProjection {
  return {
    ...projection,
    serializedBytes: projectionSerializedBytes(projection),
  };
}

function clipProjectionRow(row: TranscriptMessage, textLimit = DISPLAY_MODE_MESSAGE_TEXT_MAX_CHARS): TranscriptMessage {
  switch (row.kind) {
    case "message":
      return {
        kind: "message",
        id: row.id,
        role: row.role,
        text: clipText(row.text, textLimit),
        createdAt: row.createdAt,
        ...(row.attachments?.length ? { attachments: row.attachments.map(stripAttachmentPayload) } : {}),
      };
    case "thinking":
      return {
        ...row,
        text: clipText(row.text, textLimit),
      };
    case "tool":
      return {
        kind: "tool",
        id: row.id,
        callId: row.callId,
        toolName: row.toolName,
        status: row.status,
        label: clipText(row.label, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS),
        createdAt: row.createdAt,
        ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
        ...(row.detail ? { detail: clipText(row.detail, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS) } : {}),
        ...(row.metadata ? { metadata: clipText(row.metadata, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS) } : {}),
        ...(row.outputText ? { outputText: clipText(row.outputText, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS) } : {}),
      };
    case "activity":
      return {
        ...row,
        label: clipText(row.label, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS),
        ...(row.detail ? { detail: clipText(row.detail, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS) } : {}),
        ...(row.metadata ? { metadata: clipText(row.metadata, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS) } : {}),
      };
    case "summary":
      return {
        ...row,
        label: clipText(row.label, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS),
        ...(row.metadata ? { metadata: clipText(row.metadata, DISPLAY_MODE_DETAIL_TEXT_MAX_CHARS) } : {}),
      };
    case "runtime-job":
      return row;
  }
}

function stripAttachmentPayload(
  attachment: NonNullable<Extract<TranscriptMessage, { kind: "message" }>["attachments"]>[number],
): NonNullable<Extract<TranscriptMessage, { kind: "message" }>["attachments"]>[number] {
  const record = attachment as unknown as Record<string, unknown>;
  const stripped = Object.fromEntries(
    ["id", "kind", "name", "mimeType", "sizeBytes", "status", "relativePath"]
      .flatMap((key) => record[key] === undefined ? [] : [[key, record[key]]]),
  );
  return stripped as unknown as NonNullable<
    Extract<TranscriptMessage, { kind: "message" }>["attachments"]
  >[number];
}

function collectPreviewUrls(rows: readonly TranscriptMessage[]): string[] {
  const urls = new Set<string>();
  for (const row of rows) {
    const texts = row.kind === "message"
      ? [row.text]
      : row.kind === "tool"
        ? [row.detail, row.outputText]
        : [];
    for (const text of texts) {
      if (!text) continue;
      for (const match of text.matchAll(/https?:\/\/localhost:\d+(?:\/[^\s]*)?/g)) {
        const url = match[0]?.replace(/[)\]}>"',.;:]+$/g, "");
        if (url) urls.add(url);
      }
    }
  }
  return [...urls].slice(0, 8);
}

function clipText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
