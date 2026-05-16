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
    case "tool": {
      const tool = right as typeof left;
      return (
        left.callId === tool.callId &&
        left.toolName === tool.toolName &&
        left.status === tool.status &&
        left.label === tool.label &&
        left.detail === tool.detail &&
        left.metadata === tool.metadata &&
        shallowJsonEqual(left.input, tool.input) &&
        shallowJsonEqual(left.output, tool.output)
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
    return other !== undefined && shallowJsonEqual(item, other);
  });
}

function shallowJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
