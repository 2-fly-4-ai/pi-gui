import { useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { DesktopAppState, SelectedTranscriptRecord, WorkspaceSessionTarget } from "../desktop-state";
import {
  applyTranscriptSyncEvent,
  createTranscriptMaterializerState,
  type TranscriptMaterializerState,
} from "./transcript-sync-materializer";
import { applyDesktopStatePatchEvent } from "./state-patch-domains";
import type { StatePatchEvent, TranscriptSyncEvent } from "../ipc";

type DesktopSnapshotSetter = Dispatch<SetStateAction<DesktopAppState | null>>;

const transcriptMaterializeDelayMs = 250;
const rendererRecoveryMessage =
  "Pi recovered the renderer in safe mode. This task is showing a bounded recent-history window; the complete transcript remains stored on disk.";

let snapshot: DesktopAppState | null = null;
let selectedTranscript: SelectedTranscriptRecord | null = null;
let transcriptMaterializer: TranscriptMaterializerState | null = null;
let pendingMaterializedTranscript: TranscriptMaterializerState | null = null;
let pendingMaterializedTranscriptTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let selectionRequestId = 0;
let lastSelectionKey = "";
let selectionRetryTimer: ReturnType<typeof setTimeout> | undefined;

const snapshotListeners = new Set<() => void>();
const selectedTranscriptListeners = new Set<() => void>();

export function useDesktopSnapshot(): DesktopAppState | null {
  return useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);
}

export function useSelectedTranscript(): SelectedTranscriptRecord | null {
  return useSyncExternalStore(subscribeSelectedTranscript, getSelectedTranscriptSnapshot, getSelectedTranscriptSnapshot);
}

export const setDesktopSnapshot: DesktopSnapshotSetter = (nextSnapshot) => {
  const resolvedSnapshot = typeof nextSnapshot === "function" ? nextSnapshot(snapshot) : nextSnapshot;
  applySnapshot(resolvedSnapshot);
};

export function useDesktopAppState() {
  const currentSnapshot = useDesktopSnapshot();
  const currentSelectedTranscript = useSelectedTranscript();
  return [currentSnapshot, setDesktopSnapshot, currentSelectedTranscript] as const;
}

function subscribeSnapshot(listener: () => void): () => void {
  ensureDesktopStateStoreStarted();
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

function subscribeSelectedTranscript(listener: () => void): () => void {
  ensureDesktopStateStoreStarted();
  selectedTranscriptListeners.add(listener);
  return () => {
    selectedTranscriptListeners.delete(listener);
  };
}

function getSnapshot(): DesktopAppState | null {
  return snapshot;
}

function getSelectedTranscriptSnapshot(): SelectedTranscriptRecord | null {
  return selectedTranscript;
}

function ensureDesktopStateStoreStarted(): void {
  if (started) {
    return;
  }
  started = true;

  const api = window.piApp;
  if (!api) {
    return;
  }

  const rendererRecoveryMode = new URLSearchParams(window.location.search).get("rendererRecovery") === "1";
  void Promise.all([
    api.getState(),
    api.getSelectedTranscript(rendererRecoveryMode ? { recoveryMode: true } : undefined),
  ]).then(([state, transcript]) => {
    applySnapshot(
      rendererRecoveryMode
        ? { ...state, lastError: state.lastError ?? rendererRecoveryMessage }
        : state,
      false,
    );
    applySelectedTranscript(transcript);
    lastSelectionKey = currentSelectionKey();
  });

  api.onStatePatchChanged((event) => {
    applyStatePatchEvent(event);
  });
  api.onTranscriptEvent((event) => {
    applyTranscriptEvent(api, event);
  });
}

function applySnapshot(nextSnapshot: DesktopAppState | null, requestTranscript = true): void {
  snapshot = nextSnapshot;
  notify(snapshotListeners);
  if (requestTranscript) {
    requestSelectedTranscriptForCurrentSelection();
  }
}

function applyStatePatchEvent(event: StatePatchEvent): void {
  const nextSnapshot = applyDesktopStatePatchEvent(snapshot, event);
  if (nextSnapshot === snapshot) {
    return;
  }
  applySnapshot(nextSnapshot);
}

function applySelectedTranscript(nextSelectedTranscript: SelectedTranscriptRecord | null): void {
  clearPendingMaterializedTranscript();
  const sequence = nextSelectedTranscript && transcriptMaterializer
    && transcriptMaterializer.workspaceId === nextSelectedTranscript.workspaceId
    && transcriptMaterializer.sessionId === nextSelectedTranscript.sessionId
    ? transcriptMaterializer.sequence
    : 0;
  transcriptMaterializer = createTranscriptMaterializerState(nextSelectedTranscript, sequence);
  selectedTranscript = nextSelectedTranscript;
  notify(selectedTranscriptListeners);
}

function applyMaterializedTranscript(nextState: TranscriptMaterializerState): void {
  clearPendingMaterializedTranscript();
  transcriptMaterializer = nextState;
  selectedTranscript = {
    workspaceId: nextState.workspaceId,
    sessionId: nextState.sessionId,
    transcript: nextState.transcript,
  };
  notify(selectedTranscriptListeners);
}

function scheduleMaterializedTranscript(nextState: TranscriptMaterializerState): void {
  pendingMaterializedTranscript = nextState;
  if (pendingMaterializedTranscriptTimer) {
    return;
  }
  pendingMaterializedTranscriptTimer = setTimeout(() => {
    pendingMaterializedTranscriptTimer = undefined;
    const nextTranscript = pendingMaterializedTranscript;
    pendingMaterializedTranscript = null;
    if (nextTranscript) {
      applyMaterializedTranscript(nextTranscript);
    }
  }, transcriptMaterializeDelayMs);
}

function applyTranscriptEvent(api: NonNullable<typeof window.piApp>, event: TranscriptSyncEvent): void {
  if (event.kind === "reset" && isTranscriptEventForCurrentSelection(event)) {
    // Session selection can race the direct getSelectedTranscript response with
    // the authoritative reset event. Once the event arrives, ignore the older
    // in-flight response so a large history is not materialized twice.
    selectionRequestId += 1;
  }

  if (!transcriptMaterializer && event.kind !== "reset") {
    if (!isTranscriptEventForCurrentSelection(event)) {
      return;
    }
    transcriptMaterializer = createTranscriptMaterializerState({
      workspaceId: event.workspaceId,
      sessionId: event.sessionId,
      transcript: [],
    });
  }

  const wasResyncing = transcriptMaterializer?.resyncing ?? false;
  const result = applyTranscriptSyncEvent(transcriptMaterializer, event);

  if (result.status === "ignored") {
    return;
  }

  transcriptMaterializer = result.state;

  if (result.status === "applied") {
    if (event.kind === "reset") {
      applyMaterializedTranscript(result.state);
    } else {
      scheduleMaterializedTranscript(result.state);
    }
    return;
  }

  if (!wasResyncing) {
    void api.requestTranscriptReset(result.request).then((transcript) => {
      if (
        transcript &&
        transcript.workspaceId === result.request.workspaceId &&
        transcript.sessionId === result.request.sessionId
      ) {
        applySelectedTranscript(transcript);
      }
    });
  }
}

function clearPendingMaterializedTranscript(): void {
  pendingMaterializedTranscript = null;
  if (pendingMaterializedTranscriptTimer) {
    clearTimeout(pendingMaterializedTranscriptTimer);
    pendingMaterializedTranscriptTimer = undefined;
  }
}

function isTranscriptEventForCurrentSelection(event: TranscriptSyncEvent): boolean {
  return snapshot?.selectedWorkspaceId === event.workspaceId && snapshot.selectedSessionId === event.sessionId;
}

function requestSelectedTranscriptForCurrentSelection(): void {
  const expectedWorkspaceId = snapshot?.selectedWorkspaceId;
  const expectedSessionId = snapshot?.selectedSessionId;
  const nextSelectionKey = currentSelectionKey();
  if (nextSelectionKey === lastSelectionKey) {
    return;
  }
  if (!expectedWorkspaceId || !expectedSessionId) {
    applySelectedTranscript(null);
    return;
  }

  refreshSelectedTranscriptForTarget({
    workspaceId: expectedWorkspaceId,
    sessionId: expectedSessionId,
  });
}

export function refreshSelectedTranscriptForTarget(target: WorkspaceSessionTarget): void {
  const api = window.piApp;
  if (
    !api
    || snapshot?.selectedWorkspaceId !== target.workspaceId
    || snapshot.selectedSessionId !== target.sessionId
  ) {
    return;
  }
  const nextSelectionKey = currentSelectionKey();
  lastSelectionKey = nextSelectionKey;
  if (selectionRetryTimer) {
    clearTimeout(selectionRetryTimer);
    selectionRetryTimer = undefined;
  }

  const requestId = ++selectionRequestId;
  applySelectedTranscript(null);
  void api.getSelectedTranscript({ target }).then((transcript) => {
    if (requestId !== selectionRequestId) return;
    if (
      transcript &&
      transcript.workspaceId === target.workspaceId &&
      transcript.sessionId === target.sessionId
    ) {
      applySelectedTranscript(transcript);
      return;
    }
    scheduleSelectedTranscriptRetry(nextSelectionKey, requestId);
  }).catch(() => {
    scheduleSelectedTranscriptRetry(nextSelectionKey, requestId);
  });
}

export function applySelectedTranscriptForTarget(
  target: WorkspaceSessionTarget,
  transcript: SelectedTranscriptRecord | null,
): void {
  if (
    snapshot?.selectedWorkspaceId !== target.workspaceId
    || snapshot.selectedSessionId !== target.sessionId
    || !transcript
    || transcript.workspaceId !== target.workspaceId
    || transcript.sessionId !== target.sessionId
  ) {
    return;
  }
  selectionRequestId += 1;
  if (selectionRetryTimer) {
    clearTimeout(selectionRetryTimer);
    selectionRetryTimer = undefined;
  }
  lastSelectionKey = currentSelectionKey();
  applySelectedTranscript(transcript);
}

function scheduleSelectedTranscriptRetry(selectionKey: string, requestId: number): void {
  if (requestId !== selectionRequestId || currentSelectionKey() !== selectionKey || selectionRetryTimer) {
    return;
  }
  selectionRetryTimer = setTimeout(() => {
    selectionRetryTimer = undefined;
    if (requestId !== selectionRequestId || currentSelectionKey() !== selectionKey) return;
    lastSelectionKey = "";
    requestSelectedTranscriptForCurrentSelection();
  }, 500);
}

function currentSelectionKey(): string {
  const workspaceId = snapshot?.selectedWorkspaceId;
  const sessionId = snapshot?.selectedSessionId;
  return workspaceId && sessionId
    ? `${workspaceId}:${sessionId}:${snapshot?.activeView ?? ""}`
    : "";
}

function notify(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}
