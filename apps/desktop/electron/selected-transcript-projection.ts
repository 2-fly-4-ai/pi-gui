import type { TranscriptMessage } from "../src/desktop-state";
import { cloneTranscriptMessage } from "./app-store-utils";

export const RENDERER_TOOL_TEXT_LIMIT = 12_000;
export const RENDERER_TOOL_STRUCTURED_VALUE_LIMIT = 64 * 1024;
export const RENDERER_MESSAGE_TEXT_LIMIT = 256 * 1024;
export const RENDERER_TRANSCRIPT_MAX_ROWS = 2_500;
export const RENDERER_TRANSCRIPT_MAX_BYTES = 32 * 1024 * 1024;
export const RENDERER_MESSAGE_IMAGE_BYTES = 16 * 1024 * 1024;
export const RECOVERY_TRANSCRIPT_MAX_ROWS = 250;
export const RECOVERY_TRANSCRIPT_MAX_BYTES = 4 * 1024 * 1024;
export const RECOVERY_MESSAGE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface TranscriptProjectionOptions {
  readonly maxRows?: number;
  readonly maxBytes?: number;
  readonly maxImageBytes?: number;
}

const WRITE_TOOL_PATTERN = /write|edit|patch|apply/i;
const OMITTED_HISTORY_ID_PREFIX = "__pi-gui-omitted-history__";

export function projectTranscriptForRenderer(
  transcript: readonly TranscriptMessage[],
  options: TranscriptProjectionOptions = {},
): TranscriptMessage[] {
  const maxRows = options.maxRows ?? RENDERER_TRANSCRIPT_MAX_ROWS;
  const maxBytes = options.maxBytes ?? RENDERER_TRANSCRIPT_MAX_BYTES;
  const projectedNewestFirst: TranscriptMessage[] = [];
  let projectedBytes = 0;
  let firstIncludedIndex = transcript.length;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const projected = projectTranscriptMessageForRenderer(transcript[index] as TranscriptMessage, options);
    const itemBytes = byteLength(projected);
    if (
      projectedNewestFirst.length >= maxRows
      || projectedBytes + itemBytes > maxBytes
    ) {
      break;
    }
    projectedNewestFirst.push(projected);
    projectedBytes += itemBytes;
    firstIncludedIndex = index;
  }

  const projected = projectedNewestFirst.reverse();
  if (firstIncludedIndex > 0) {
    projected.unshift(omittedHistoryMarker(firstIncludedIndex, transcript[firstIncludedIndex]?.createdAt));
  }
  return projected;
}

export function projectTranscriptMessageForRenderer(
  message: TranscriptMessage,
  options: TranscriptProjectionOptions = {},
): TranscriptMessage {
  if (message.kind === "message") {
    const projectedMetadata = projectStructuredValue(message.metadata);
    return {
      kind: "message",
      id: message.id,
      role: message.role,
      text: clipOrdinaryText(message.text),
      createdAt: message.createdAt,
      ...(message.attachments?.length
        ? { attachments: projectMessageAttachments(message.attachments, options.maxImageBytes) }
        : {}),
      ...(projectedMetadata.truncated ? {} : { metadata: projectedMetadata.value }),
    };
  }

  if (message.kind === "thinking") {
    return {
      ...message,
      text: clipOrdinaryText(message.text),
    };
  }

  if (message.kind !== "tool") {
    return cloneTranscriptMessage(message);
  }

  const originalSizeBytes = byteLength(message);
  let truncated = false;
  let input = message.input;
  let output = message.output;
  let outputText = message.outputText;

  const projectedInput = projectToolInput(input);
  input = projectedInput.value;
  truncated ||= projectedInput.truncated;

  if (typeof outputText === "string") {
    const clipped = clipToolText(outputText);
    outputText = clipped.text;
    truncated ||= clipped.truncated;

    // Most driver transcripts store stdout twice: once in output and once in
    // outputText. The renderer consumes outputText, so retaining both roughly
    // doubles every historical tool result. Write/edit tools keep a small
    // structured output because the inline diff renderer needs it.
    if (!WRITE_TOOL_PATTERN.test(message.toolName)) {
      output = undefined;
    } else {
      const projectedOutput = projectStructuredValue(output);
      output = projectedOutput.value;
      truncated ||= projectedOutput.truncated;
    }
  } else {
    const projectedOutput = projectStructuredValue(output);
    output = projectedOutput.value;
    truncated ||= projectedOutput.truncated;
    if (projectedOutput.previewText) {
      outputText = projectedOutput.previewText;
    }
  }

  const projected: Extract<TranscriptMessage, { kind: "tool" }> = {
    ...message,
    input,
    output,
    outputText,
    ...(truncated
      ? {
          payloadTruncated: true,
          payloadSizeBytes: originalSizeBytes,
        }
      : {}),
  };
  if (input === undefined) delete (projected as { input?: unknown }).input;
  if (output === undefined) delete (projected as { output?: unknown }).output;
  if (outputText === undefined) delete (projected as { outputText?: string }).outputText;
  return projected;
}

function projectMessageAttachments(
  attachments: Extract<TranscriptMessage, { kind: "message" }>["attachments"] & readonly unknown[],
  maxImageBytes = RENDERER_MESSAGE_IMAGE_BYTES,
): NonNullable<Extract<TranscriptMessage, { kind: "message" }>["attachments"]> {
  let retainedImageBytes = 0;
  return attachments.map((attachment) => {
    if (attachment.kind !== "image") {
      return { ...attachment };
    }
    const sizeBytes = approximateBase64Bytes(attachment.data);
    if (retainedImageBytes + sizeBytes <= maxImageBytes) {
      retainedImageBytes += sizeBytes;
      return { ...attachment, sizeBytes };
    }
    return {
      ...attachment,
      data: "",
      dataOmitted: true,
      sizeBytes,
    };
  });
}

function clipOrdinaryText(text: string): string {
  if (text.length <= RENDERER_MESSAGE_TEXT_LIMIT) {
    return text;
  }
  const tailLength = Math.floor(RENDERER_MESSAGE_TEXT_LIMIT / 4);
  const headLength = RENDERER_MESSAGE_TEXT_LIMIT - tailLength;
  return [
    text.slice(0, headLength),
    `\n\n… ${formatCharacterCount(text.length - RENDERER_MESSAGE_TEXT_LIMIT)} omitted from the live renderer …\n\n`,
    text.slice(-tailLength),
  ].join("");
}

function omittedHistoryMarker(count: number, createdAt?: string): TranscriptMessage {
  return {
    kind: "summary",
    id: `${OMITTED_HISTORY_ID_PREFIX}:${count}`,
    createdAt: createdAt ?? new Date(0).toISOString(),
    label: `${count.toLocaleString()} earlier timeline item${count === 1 ? "" : "s"} hidden to keep this task responsive`,
    metadata: "The complete history remains stored on disk. Recent activity is loaded automatically.",
    presentation: "inline",
  };
}

function clipToolText(text: string): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= RENDERER_TOOL_TEXT_LIMIT) {
    return { text, truncated: false };
  }

  const tailLength = Math.floor(RENDERER_TOOL_TEXT_LIMIT / 3);
  const headLength = RENDERER_TOOL_TEXT_LIMIT - tailLength;
  return {
    text: [
      text.slice(0, headLength),
      `\n\n… ${formatCharacterCount(text.length - RENDERER_TOOL_TEXT_LIMIT)} omitted from the live renderer …\n\n`,
      text.slice(-tailLength),
    ].join(""),
    truncated: true,
  };
}

function projectStructuredValue(value: unknown): {
  readonly value: unknown;
  readonly truncated: boolean;
  readonly previewText?: string;
} {
  if (value === undefined) {
    return { value: undefined, truncated: false };
  }

  const serialized = safeSerialize(value);
  if (serialized.length <= RENDERER_TOOL_STRUCTURED_VALUE_LIMIT) {
    return { value, truncated: false };
  }

  const clipped = clipToolText(serialized);
  return {
    value: undefined,
    truncated: true,
    previewText: clipped.text,
  };
}

function projectToolInput(value: unknown): {
  readonly value: unknown;
  readonly truncated: boolean;
} {
  const projected = projectStructuredValue(value);
  if (!projected.truncated || !value || typeof value !== "object" || Array.isArray(value)) {
    return projected;
  }

  const source = value as Record<string, unknown>;
  const preview: Record<string, unknown> = { truncated: true };
  for (const key of ["command", "cwd", "path", "filePath", "file_path", "query", "pattern", "name"]) {
    const candidate = source[key];
    if (typeof candidate === "string") {
      preview[key] = clipToolText(candidate).text;
    } else if (typeof candidate === "number" || typeof candidate === "boolean") {
      preview[key] = candidate;
    }
  }
  return { value: preview, truncated: true };
}

function safeSerialize(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Buffer.byteLength(String(value), "utf8");
  }
}

function approximateBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function formatCharacterCount(count: number): string {
  return `${count.toLocaleString()} character${count === 1 ? "" : "s"}`;
}
