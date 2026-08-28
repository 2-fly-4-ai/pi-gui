import type { SelectedTranscriptRecord, TranscriptMessage } from "../desktop-state";
import type { TranscriptResetRequest, TranscriptSyncEvent } from "../ipc";

const MATERIALIZED_TRANSCRIPT_MAX_ROWS = 2_501;

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
    transcript: record.transcript,
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
        transcript: event.transcript,
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
    return applied(
      state,
      event.sequence,
      boundMaterializedTranscript([...state.transcript, ...event.items]),
    );
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

function boundMaterializedTranscript(
  transcript: readonly TranscriptMessage[],
): readonly TranscriptMessage[] {
  if (transcript.length <= MATERIALIZED_TRANSCRIPT_MAX_ROWS) {
    return transcript;
  }
  const keep = transcript.slice(-(MATERIALIZED_TRANSCRIPT_MAX_ROWS - 1));
  const existingMarker = transcript.find((item) =>
    item.kind === "summary" && item.id.startsWith("__pi-gui-omitted-history__"));
  const newlyOmitted = transcript.length - keep.length - (existingMarker ? 1 : 0);
  const previousOmitted = existingMarker
    ? Number.parseInt(existingMarker.id.split(":").at(-1) ?? "0", 10) || 0
    : 0;
  const omitted = previousOmitted + newlyOmitted;
  return [
    {
      kind: "summary",
      id: `__pi-gui-omitted-history__:${omitted}`,
      createdAt: keep[0]?.createdAt ?? new Date(0).toISOString(),
      label: `${omitted.toLocaleString()} earlier timeline item${omitted === 1 ? "" : "s"} hidden to keep this task responsive`,
      metadata: "The complete history remains stored on disk. Recent activity is loaded automatically.",
      presentation: "inline",
    },
    ...keep.filter((item) => item !== existingMarker),
  ];
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
