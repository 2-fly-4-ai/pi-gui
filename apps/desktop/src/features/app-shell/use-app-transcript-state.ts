import { useMemo } from "react";
import type { DesktopAppState, SelectedTranscriptRecord, SessionRecord, WorkspaceRecord } from "../../desktop-state";

interface UseAppTranscriptStateOptions {
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionId: string | undefined;
  readonly selectedSessionKey: string;
  readonly selectedTranscript: SelectedTranscriptRecord | null;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspaceId: string | undefined;
  readonly showThinking: boolean;
  readonly snapshot: DesktopAppState | null;
}

export function useAppTranscriptState({
  selectedSession,
  selectedSessionId,
  selectedSessionKey,
  selectedTranscript,
  selectedWorkspace,
  selectedWorkspaceId,
  showThinking,
  snapshot,
}: UseAppTranscriptStateOptions) {
  const rawActiveTranscript = useMemo(
    () =>
      selectedTranscript &&
      selectedWorkspaceId &&
      selectedSessionId &&
      selectedTranscript.workspaceId === selectedWorkspaceId &&
      selectedTranscript.sessionId === selectedSessionId
        ? selectedTranscript.transcript
        : [],
    [selectedSessionId, selectedTranscript, selectedWorkspaceId],
  );
  const thinkingActive = rawActiveTranscript.some((item) => item.kind === "thinking" && item.status === "running");
  const activeTranscript = showThinking
    ? rawActiveTranscript
    : rawActiveTranscript.filter((item) => item.kind !== "thinking");
  const selectedTranscriptMatchesSession = Boolean(
    selectedTranscript &&
    selectedTranscript.workspaceId === selectedWorkspace?.id &&
    selectedTranscript.sessionId === selectedSession?.id,
  );
  const selectedSessionLooksHydratable = Boolean(selectedSession?.preview.trim() || selectedSession?.status === "running");
  const isTranscriptLoading = Boolean(selectedSession) && activeTranscript.length === 0 && (
    !selectedTranscriptMatchesSession || selectedSessionLooksHydratable
  );
  const selectedSessionCommands = selectedSession ? snapshot?.sessionCommandsBySession[selectedSessionKey] ?? [] : [];
  const selectedExtensionUi = selectedSession ? snapshot?.sessionExtensionUiBySession[selectedSessionKey] : undefined;
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? []
    : [];

  return {
    activeTranscript,
    isTranscriptLoading,
    rawActiveTranscript,
    selectedExtensionUi,
    selectedSessionCommands,
    selectedWorkspaceCommandCompatibility,
    thinkingActive,
  };
}
