import type { SelectedTranscriptRecord } from "../../desktop-state";

export type TimelinePaneElement = HTMLDivElement & {
  __legendListRef?: {
    scrollToEnd: (options?: { animated?: boolean }) => Promise<void> | void;
    scrollToOffset?: (params: { offset: number; animated?: boolean }) => Promise<void> | void;
    scrollToIndex?: (params: {
      animated?: boolean;
      index: number;
      viewOffset?: number;
      viewPosition?: number;
    }) => Promise<void> | void;
    getState?: () => {
      readonly reprocessCurrentScroll?: () => void;
      readonly triggerCalculateItemsInView?: (params?: Record<string, unknown>) => void;
    };
  } | null;
};

export interface TimelinePaneSize {
  readonly width: number;
  readonly height: number;
}

export function buildTranscriptChangeMarker(
  sessionKey: string,
  transcript: SelectedTranscriptRecord["transcript"],
): string {
  const lastItem = transcript.at(-1);
  const textLengthFootprint = transcript.reduce((total, item) => total + ("text" in item ? item.text.length : 0), 0);
  if (!lastItem) {
    return `${sessionKey}:0:empty`;
  }

  switch (lastItem.kind) {
    case "message": {
      const tail = lastItem.text.slice(-48);
      const attachmentCount = lastItem.attachments?.length ?? 0;
      return [
        sessionKey,
        transcript.length,
        textLengthFootprint,
        lastItem.id,
        lastItem.kind,
        lastItem.role,
        lastItem.text.length,
        tail,
        attachmentCount,
      ].join(":");
    }
    case "thinking":
      return [
        sessionKey,
        transcript.length,
        textLengthFootprint,
        lastItem.id,
        lastItem.kind,
        lastItem.status,
        lastItem.text.length,
        lastItem.text.slice(-48),
      ].join(":");
    case "tool": {
      const inputSize = estimateUnknownSize(lastItem.input);
      const outputSize = estimateUnknownSize(lastItem.output);
      return [
        sessionKey,
        transcript.length,
        textLengthFootprint,
        lastItem.id,
        lastItem.kind,
        lastItem.callId,
        lastItem.status,
        lastItem.label,
        lastItem.detail ?? "",
        inputSize,
        outputSize,
      ].join(":");
    }
    case "activity":
      return [
        sessionKey,
        transcript.length,
        textLengthFootprint,
        lastItem.id,
        lastItem.kind,
        lastItem.label,
        lastItem.detail ?? "",
        lastItem.metadata ?? "",
        lastItem.tone ?? "",
      ].join(":");
    case "summary":
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.presentation,
        lastItem.label.length,
        lastItem.label.slice(-48),
        lastItem.metadata ?? "",
      ].join(":");
    case "runtime-job":
      return [
        sessionKey,
        transcript.length,
        lastItem.id,
        lastItem.kind,
        lastItem.job.id,
        lastItem.job.status,
        lastItem.job.updatedAt,
        lastItem.job.title,
        lastItem.job.message ?? "",
      ].join(":");
  }
}

export function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}

function estimateUnknownSize(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 1;
}
