import type { SelectedTranscriptRecord, TranscriptMessage } from "../desktop-state";
import type { TranscriptResetRequest, TranscriptSyncEvent } from "../ipc";

export interface TranscriptMaterializerState {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly transcript: readonly TranscriptMessage[];
  readonly resyncing: boolean;
}

export type TranscriptMaterializerApplyResult =
  | {
      readonly status: "applied";
      readonly state: TranscriptMaterializerState;
    }
  | {
      readonly status: "ignored";
      readonly state: TranscriptMaterializerState | null;
    }
  | {
      readonly status: "gap";
      readonly state: TranscriptMaterializerState;
      readonly request: TranscriptResetRequest;
    };

export function createTranscriptMaterializerState(
  record: SelectedTranscriptRecord | null,
  sequence = 0,
): TranscriptMaterializerState | null {
  if (!record) {
    return null;
  }

  return {
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    sequence,
    transcript: [...record.transcript],
    resyncing: false,
  };
}

export function applyTranscriptSyncEvent(
  state: TranscriptMaterializerState | null,
  event: TranscriptSyncEvent,
): TranscriptMaterializerApplyResult {
  if (event.kind === "reset") {
    return {
      status: "applied",
      state: {
        workspaceId: event.workspaceId,
        sessionId: event.sessionId,
        sequence: event.sequence,
        transcript: [...event.transcript],
        resyncing: false,
      },
    };
  }

  if (!state || !isTranscriptSyncEventForState(state, event)) {
    return { status: "ignored", state };
  }

  const expectedSequence = state.sequence + 1;
  if (event.sequence !== expectedSequence) {
    const gapState = { ...state, resyncing: true };
    return {
      status: "gap",
      state: gapState,
      request: buildResetRequest(event, expectedSequence),
    };
  }

  if (event.kind === "append") {
    return applied(state, event.sequence, [...state.transcript, ...event.items]);
  }

  if (event.kind === "update-last") {
    const transcript = state.transcript.length > 0
      ? [...state.transcript.slice(0, -1), event.item]
      : [event.item];
    return applied(state, event.sequence, transcript);
  }

  const truncated = truncateTranscript(state.transcript, event);
  if (!truncated) {
    const gapState = { ...state, resyncing: true };
    return {
      status: "gap",
      state: gapState,
      request: buildResetRequest(event, expectedSequence),
    };
  }

  return applied(state, event.sequence, truncated);
}

export function isTranscriptSyncEventForState(
  state: TranscriptMaterializerState,
  event: TranscriptSyncEvent,
): boolean {
  return event.workspaceId === state.workspaceId && event.sessionId === state.sessionId;
}

function applied(
  state: TranscriptMaterializerState,
  sequence: number,
  transcript: readonly TranscriptMessage[],
): TranscriptMaterializerApplyResult {
  return {
    status: "applied",
    state: {
      ...state,
      sequence,
      transcript,
      resyncing: false,
    },
  };
}

function buildResetRequest(event: TranscriptSyncEvent, expectedSequence: number): TranscriptResetRequest {
  return {
    workspaceId: event.workspaceId,
    sessionId: event.sessionId,
    expectedSequence,
    reason: "gap",
  };
}

function truncateTranscript(
  transcript: readonly TranscriptMessage[],
  event: Extract<TranscriptSyncEvent, { readonly kind: "truncate" }>,
): readonly TranscriptMessage[] | null {
  if (event.afterItemId) {
    const index = transcript.findIndex((item) => item.id === event.afterItemId);
    return index >= 0 ? transcript.slice(0, index + 1) : null;
  }

  if (typeof event.length === "number") {
    const length = Math.max(0, Math.min(event.length, transcript.length));
    return transcript.slice(0, length);
  }

  return null;
}
