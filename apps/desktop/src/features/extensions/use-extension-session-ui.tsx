import { useCallback, useEffect, useMemo, useState } from "react";
import type { HostUiResponse } from "@pi-gui/session-driver";
import type {
  DesktopAppState,
  SessionRecord,
  SessionExtensionUiStateRecord,
  WorkspaceRecord,
} from "../../desktop-state";
import { buildExtensionDockModel, hasExtensionDockContent } from "../../extension-session-ui";

interface UseExtensionSessionUiOptions {
  readonly api: NonNullable<typeof window.piApp> | undefined;
  readonly focusComposer: () => void;
  readonly selectedExtensionUi: SessionExtensionUiStateRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly sessionExtensionUiBySession: DesktopAppState["sessionExtensionUiBySession"] | undefined;
}

export function useExtensionSessionUi({
  api,
  focusComposer,
  selectedExtensionUi,
  selectedSession,
  selectedSessionKey,
  selectedWorkspace,
  sessionExtensionUiBySession,
}: UseExtensionSessionUiOptions) {
  const [dockExpandedBySession, setDockExpandedBySession] = useState<Record<string, boolean>>({});
  const selectedExtensionDock = useMemo(() => buildExtensionDockModel(selectedExtensionUi), [selectedExtensionUi]);
  const activeExtensionDialog = selectedExtensionUi?.pendingDialogs[0];
  const isSelectedExtensionDockExpanded = dockExpandedBySession[selectedSessionKey] ?? false;

  useEffect(() => {
    if (!sessionExtensionUiBySession) {
      setDockExpandedBySession((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }

    setDockExpandedBySession((current) => {
      let next: Record<string, boolean> | undefined;
      for (const [sessionKey, expanded] of Object.entries(current)) {
        if (!expanded && sessionExtensionUiBySession[sessionKey]) {
          continue;
        }
        if (hasExtensionDockContent(sessionExtensionUiBySession[sessionKey])) {
          continue;
        }
        if (!next) {
          next = { ...current };
        }
        delete next[sessionKey];
      }
      return next ?? current;
    });
  }, [sessionExtensionUiBySession]);

  const handleRespondToExtensionDialog = useCallback((response: HostUiResponse) => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    void api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, response).then(() => {
      focusComposer();
    });
  }, [api, focusComposer, selectedSession, selectedWorkspace]);

  const handleToggleExtensionDock = useCallback(() => {
    if (!selectedExtensionDock) {
      return;
    }

    setDockExpandedBySession((current) => ({
      ...current,
      [selectedSessionKey]: !(current[selectedSessionKey] ?? false),
    }));
  }, [selectedExtensionDock, selectedSessionKey]);

  return {
    activeExtensionDialog,
    handleRespondToExtensionDialog,
    handleToggleExtensionDock,
    isSelectedExtensionDockExpanded,
    selectedExtensionDock,
  };
}
