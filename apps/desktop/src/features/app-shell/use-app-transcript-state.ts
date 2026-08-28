import { useMemo } from "react";
import type { DesktopAppState, SelectedTranscriptRecord, SessionRecord, WorkspaceRecord } from "../../desktop-state";
import { projectLatestThinkingPerRun } from "../../thinking-trace-projection";

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
    ? projectLatestThinkingPerRun(rawActiveTranscript)
    : rawActiveTranscript.filter((item) => item.kind !== "thinking");
  const selectedTranscriptMatchesSession = Boolean(
    selectedTranscript &&
    selectedTranscript.workspaceId === selectedWorkspace?.id &&
    selectedTranscript.sessionId === selectedSession?.id,
  );
  // A matching empty transcript is a successfully loaded new/empty task, not
  // an indeterminate loading state. The record identity is authoritative;
  // preview text is not proof that timeline rows must exist.
  const isTranscriptLoading = Boolean(selectedSession) && !selectedTranscriptMatchesSession;
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
