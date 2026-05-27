import { useRef } from "react";
import type { TranscriptMessage } from "./desktop-state";

interface StableTranscriptState {
  readonly byId: Map<string, TranscriptMessage>;
  readonly result: readonly TranscriptMessage[];
}

export function useStableTranscriptRows(transcript: readonly TranscriptMessage[]): readonly TranscriptMessage[] {
  const stateRef = useRef<StableTranscriptState>({ byId: new Map(), result: [] });
  const previous = stateRef.current;
  const nextById = new Map<string, TranscriptMessage>();
  let changed = transcript.length !== previous.result.length;

  const result = transcript.map((item, index) => {
    const previousItem = previous.byId.get(item.id);
    const nextItem = previousItem && transcriptItemsEqual(previousItem, item) ? previousItem : item;
    nextById.set(item.id, nextItem);
    if (!changed && previous.result[index] !== nextItem) {
      changed = true;
    }
    return nextItem;
  });

  if (!changed) {
    return previous.result;
  }

  stateRef.current = { byId: nextById, result };
  return result;
}

function transcriptItemsEqual(left: TranscriptMessage, right: TranscriptMessage): boolean {
  if (left.kind !== right.kind || left.id !== right.id) {
    return false;
  }

  switch (left.kind) {
    case "message": {
      const message = right as typeof left;
      return (
        left.role === message.role &&
        left.text === message.text &&
        left.createdAt === message.createdAt &&
        attachmentsEqual(left.attachments, message.attachments)
      );
    }
    case "thinking": {
      const thinking = right as typeof left;
      return left.text === thinking.text && left.status === thinking.status && left.createdAt === thinking.createdAt;
    }
    case "tool": {
      const tool = right as typeof left;
      return (
        left.callId === tool.callId &&
        left.toolName === tool.toolName &&
        left.status === tool.status &&
        left.label === tool.label &&
        left.detail === tool.detail &&
        left.metadata === tool.metadata &&
        left.updatedAt === tool.updatedAt &&
        left.outputText === tool.outputText &&
        unknownValuesLikelyEqual(left.input, tool.input) &&
        unknownValuesLikelyEqual(left.output, tool.output)
      );
    }
    case "activity": {
      const activity = right as typeof left;
      return (
        left.label === activity.label &&
        left.detail === activity.detail &&
        left.metadata === activity.metadata &&
        left.tone === activity.tone &&
        left.createdAt === activity.createdAt
      );
    }
    case "summary": {
      const summary = right as typeof left;
      return (
        left.label === summary.label &&
        left.presentation === summary.presentation &&
        left.metadata === summary.metadata &&
        left.createdAt === summary.createdAt
      );
    }
    case "runtime-job": {
      const runtimeJob = right as typeof left;
      return (
        left.createdAt === runtimeJob.createdAt &&
        left.job.id === runtimeJob.job.id &&
        left.job.status === runtimeJob.job.status &&
        left.job.updatedAt === runtimeJob.job.updatedAt &&
        left.job.title === runtimeJob.job.title &&
        left.job.message === runtimeJob.job.message
      );
    }
  }
}

function attachmentsEqual(
  left: Extract<TranscriptMessage, { kind: "message" }>["attachments"],
  right: Extract<TranscriptMessage, { kind: "message" }>["attachments"],
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    if (!other || item.kind !== other.kind || item.name !== other.name || item.mimeType !== other.mimeType) {
      return false;
    }
    if (item.kind === "image" || other.kind === "image") {
      return item.kind === "image" && other.kind === "image" && item.data.length === other.data.length;
    }
    return item.fsPath === other.fsPath && item.sizeBytes === other.sizeBytes;
  });
}

function unknownValuesLikelyEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left === null || right === null) return left === right;
  if (typeof left !== typeof right) return false;
  if (typeof left === "string" && typeof right === "string") {
    return left.length === right.length && left.slice(0, 256) === right.slice(0, 256) && left.slice(-256) === right.slice(-256);
  }
  if (typeof left === "number" || typeof left === "boolean") return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length;
  }
  if (typeof left !== "object" || typeof right !== "object") return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => key in rightRecord && shallowScalarEqual(leftRecord[key], rightRecord[key]));
}

function shallowScalarEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === "string" && typeof right === "string") return left.length === right.length;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length;
  if (typeof left === "object" && typeof right === "object") return Boolean(left) === Boolean(right);
  return false;
}
