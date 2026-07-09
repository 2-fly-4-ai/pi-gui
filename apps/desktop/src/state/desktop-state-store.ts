import { useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { DesktopAppState, SelectedTranscriptRecord } from "../desktop-state";
import {
  applyTranscriptSyncEvent,
  createTranscriptMaterializerState,
  type TranscriptMaterializerState,
} from "./transcript-sync-materializer";
import { applyDesktopStatePatchEvent } from "./state-patch-domains";
import type { StatePatchEvent, TranscriptSyncEvent } from "../ipc";

type DesktopSnapshotSetter = Dispatch<SetStateAction<DesktopAppState | null>>;

const transcriptMaterializeDelayMs = 250;

let snapshot: DesktopAppState | null = null;
let selectedTranscript: SelectedTranscriptRecord | null = null;
let transcriptMaterializer: TranscriptMaterializerState | null = null;
let pendingMaterializedTranscript: TranscriptMaterializerState | null = null;
let pendingMaterializedTranscriptTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let selectionRequestId = 0;
let lastSelectionKey = "";

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

  void Promise.all([api.getState(), api.getSelectedTranscript()]).then(([state, transcript]) => {
    applySnapshot(state);
    applySelectedTranscript(transcript);
  });

  api.onStatePatchChanged((event) => {
    applyStatePatchEvent(event);
  });
  api.onTranscriptEvent((event) => {
    applyTranscriptEvent(api, event);
  });
}

function applySnapshot(nextSnapshot: DesktopAppState | null): void {
  snapshot = nextSnapshot;
  notify(snapshotListeners);
  requestSelectedTranscriptForCurrentSelection();
}

function applyStatePatchEvent(event: StatePatchEvent): void {
  const nextSnapshot = applyDesktopStatePatchEvent(snapshot, event);
  if (nextSnapshot === snapshot) {
    return;
  }
  applySnapshot(nextSnapshot);
}

function applySelectedTranscript(nextSelectedTranscript: SelectedTranscriptRecord | null): void {
  pendingMaterializedTranscript = null;
  if (pendingMaterializedTranscriptTimer) {
    clearTimeout(pendingMaterializedTranscriptTimer);
    pendingMaterializedTranscriptTimer = undefined;
  }
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
  applySelectedTranscript({
    workspaceId: nextState.workspaceId,
    sessionId: nextState.sessionId,
    transcript: nextState.transcript,
  });
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

function isTranscriptEventForCurrentSelection(event: TranscriptSyncEvent): boolean {
  return snapshot?.selectedWorkspaceId === event.workspaceId && snapshot.selectedSessionId === event.sessionId;
}

function requestSelectedTranscriptForCurrentSelection(): void {
  const api = window.piApp;
  if (!api) {
    return;
  }

  const expectedWorkspaceId = snapshot?.selectedWorkspaceId;
  const expectedSessionId = snapshot?.selectedSessionId;
  const nextSelectionKey = expectedWorkspaceId && expectedSessionId
    ? `${expectedWorkspaceId}:${expectedSessionId}:${snapshot?.activeView ?? ""}`
    : "";
  if (nextSelectionKey === lastSelectionKey) {
    return;
  }
  lastSelectionKey = nextSelectionKey;

  if (!expectedWorkspaceId || !expectedSessionId) {
    applySelectedTranscript(null);
    return;
  }

  const requestId = ++selectionRequestId;
  void api.getSelectedTranscript().then((transcript) => {
    if (requestId !== selectionRequestId) {
      return;
    }
    if (
      transcript &&
      transcript.workspaceId === expectedWorkspaceId &&
      transcript.sessionId === expectedSessionId
    ) {
      applySelectedTranscript(transcript);
    }
  });
}

function notify(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}
