import type { DesktopAppState } from "../desktop-state";
import type { StatePatchDomain, StatePatchEvent } from "../ipc";

export interface DesktopStateDomainSnapshot {
  readonly selection: Pick<
    DesktopAppState,
    "selectedWorkspaceId" | "selectedSessionId" | "activeView" | "sidebarCollapsed" | "showThinking" | "reviewRequest"
  >;
  readonly workspaces: Pick<
    DesktopAppState,
    "workspaces" | "worktreesByWorkspace" | "lastViewedAtBySession" | "workspaceOrder"
  >;
  readonly composer: Pick<
    DesktopAppState,
    | "composerDraft"
    | "composerDraftSyncSource"
    | "composerDraftSyncNonce"
    | "composerAttachments"
    | "queuedComposerMessages"
    | "editingQueuedMessageId"
  >;
  readonly runtime: Pick<
    DesktopAppState,
    | "runtimeByWorkspace"
    | "runtimeJobsBySession"
    | "sessionCommandsBySession"
    | "sessionExtensionUiBySession"
    | "extensionCommandCompatibilityByWorkspace"
    | "fastMode"
  >;
  readonly settings: Pick<
    DesktopAppState,
    | "notificationPreferences"
    | "diagnosticReporting"
    | "integratedTerminalShell"
    | "modelSettingsScopeMode"
    | "globalModelSettings"
    | "desktopCustomInstructions"
  >;
  readonly diagnostics: Pick<DesktopAppState, "revision" | "lastError">;
}

export const desktopStatePatchDomains = [
  "selection",
  "workspaces",
  "composer",
  "runtime",
  "settings",
  "diagnostics",
] as const satisfies readonly StatePatchDomain[];

export function buildDesktopStateDomainSnapshot(state: DesktopAppState): DesktopStateDomainSnapshot {
  return {
    selection: {
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectedSessionId: state.selectedSessionId,
      activeView: state.activeView,
      sidebarCollapsed: state.sidebarCollapsed,
      showThinking: state.showThinking,
      reviewRequest: state.reviewRequest,
    },
    workspaces: {
      workspaces: state.workspaces,
      worktreesByWorkspace: state.worktreesByWorkspace,
      lastViewedAtBySession: state.lastViewedAtBySession,
      workspaceOrder: state.workspaceOrder,
    },
    composer: {
      composerDraft: state.composerDraft,
      composerDraftSyncSource: state.composerDraftSyncSource,
      composerDraftSyncNonce: state.composerDraftSyncNonce,
      composerAttachments: state.composerAttachments,
      queuedComposerMessages: state.queuedComposerMessages,
      editingQueuedMessageId: state.editingQueuedMessageId,
    },
    runtime: {
      runtimeByWorkspace: state.runtimeByWorkspace,
      runtimeJobsBySession: state.runtimeJobsBySession,
      sessionCommandsBySession: state.sessionCommandsBySession,
      sessionExtensionUiBySession: state.sessionExtensionUiBySession,
      extensionCommandCompatibilityByWorkspace: state.extensionCommandCompatibilityByWorkspace,
      fastMode: state.fastMode,
    },
    settings: {
      notificationPreferences: state.notificationPreferences,
      diagnosticReporting: state.diagnosticReporting,
      integratedTerminalShell: state.integratedTerminalShell,
      modelSettingsScopeMode: state.modelSettingsScopeMode,
      globalModelSettings: state.globalModelSettings,
      desktopCustomInstructions: state.desktopCustomInstructions,
    },
    diagnostics: {
      revision: state.revision,
      lastError: state.lastError,
    },
  };
}

export function buildDesktopStatePatchEvents(
  previous: DesktopAppState | null,
  next: DesktopAppState,
): readonly StatePatchEvent[] {
  const nextSnapshot = buildDesktopStateDomainSnapshot(next);
  if (!previous) {
    return desktopStatePatchDomains.map((domain) => ({
      domain,
      revision: next.revision,
      patch: nextSnapshot[domain],
    }));
  }

  const previousSnapshot = buildDesktopStateDomainSnapshot(previous);
  return desktopStatePatchDomains.flatMap((domain) =>
    stableJson(previousSnapshot[domain]) === stableJson(nextSnapshot[domain])
      ? []
      : [{
          domain,
          revision: next.revision,
          patch: nextSnapshot[domain],
        }],
  );
}

export function applyDesktopStatePatchEvent(
  state: DesktopAppState | null,
  event: StatePatchEvent,
): DesktopAppState | null {
  if (!state || event.revision < state.revision) {
    return state;
  }

  switch (event.domain) {
    case "selection":
      return {
        ...state,
        ...(event.patch as DesktopStateDomainSnapshot["selection"]),
      };
    case "workspaces":
      return {
        ...state,
        ...(event.patch as DesktopStateDomainSnapshot["workspaces"]),
      };
    case "composer":
      return {
        ...state,
        ...(event.patch as DesktopStateDomainSnapshot["composer"]),
      };
    case "runtime":
      return {
        ...state,
        ...(event.patch as DesktopStateDomainSnapshot["runtime"]),
      };
    case "settings":
      return {
        ...state,
        ...(event.patch as DesktopStateDomainSnapshot["settings"]),
      };
    case "diagnostics":
      return {
        ...state,
        ...(event.patch as DesktopStateDomainSnapshot["diagnostics"]),
      };
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
