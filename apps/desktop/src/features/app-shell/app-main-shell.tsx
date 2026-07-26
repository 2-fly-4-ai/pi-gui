import { useEffect, useState, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import type { DesktopAppState, SessionRecord, WorkspaceRecord, WorktreeRecord } from "../../desktop-state";
import { runtimeBadgeCount } from "../../runtime-status";
import { TerminalStack } from "../terminal/terminal-stack";
import type { useDiffPanel } from "../diff/use-diff-panel";
import type { useExtensionSessionUi } from "../extensions/use-extension-session-ui";
import type { useGitActions } from "../git/use-git-actions";
import type { usePanelLayout } from "../panels/use-panel-layout";
import type { useProjectActions } from "../project-actions/use-project-actions";
import type { useVisibleTerminal } from "../terminal/use-visible-terminal";
import type { useWorkspaceDerivations } from "../workspaces/use-workspace-derivations";
import type { useWorkspaceMenu } from "../../hooks/use-workspace-menu";
import type { DesktopUpdateStatus } from "../../ipc";
import type { buildThreadGroups } from "../../thread-groups";
import { AppShell } from "./app-shell";

interface AppMainShellProps {
  readonly activeWorktrees: ReturnType<typeof useWorkspaceDerivations>["activeWorktrees"];
  readonly addActionDialogOpen: boolean;
  readonly api: NonNullable<typeof window.piApp>;
  readonly closeAddActionDialog: () => void;
  readonly commandPalette: ReactNode;
  readonly diffFileRequest: ReturnType<typeof useDiffPanel>["diffFileRequest"];
  readonly displayedSessionTitle: string;
  readonly gitActions: ReturnType<typeof useGitActions>;
  readonly handleArchiveSession: (target: { readonly workspaceId: string; readonly sessionId: string }) => void;
  readonly handleSelectSession: (target: { readonly workspaceId: string; readonly sessionId: string }) => void;
  readonly handleToggleExtensionDock: () => void;
  readonly handleTogglePrimarySidebar: () => void;
  readonly handleUnarchiveSession: (target: { readonly workspaceId: string; readonly sessionId: string }) => void;
  readonly isSelectedExtensionDockExpanded: boolean;
  readonly linkedWorktreeByWorkspaceId: ReturnType<typeof useWorkspaceDerivations>["linkedWorktreeByWorkspaceId"];
  readonly mainRef: RefObject<HTMLElement | null>;
  readonly onAddAction: () => void;
  readonly onAddTerminalSelectionToComposer: (context: string) => void;
  readonly onFocusComposer: () => void;
  readonly onOpenExtensions: () => void;
  readonly onOpenNewThreadSurface: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onOpenSkills: (workspaceId?: string) => void;
  readonly onOpenUrl: (url: string, options?: { readonly external?: boolean }) => void;
  readonly onRunProjectAction: ReturnType<typeof useProjectActions>["runProjectAction"];
  readonly onSaveProjectAction: ReturnType<typeof useProjectActions>["saveProjectAction"];
  readonly onSetActiveView: (view: DesktopAppState["activeView"]) => void;
  readonly panelLayout: ReturnType<typeof usePanelLayout>;
  readonly planPanelOpen: boolean;
  readonly planSurfaceAvailable: boolean;
  readonly primaryContent: ReactNode;
  readonly primarySidebarToggleVisible: boolean;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly runningLabel: string;
  readonly selectedExtensionDock: ReturnType<typeof useExtensionSessionUi>["selectedExtensionDock"];
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionKey: string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly showDiffPanel: boolean;
  readonly sidebarToggleShortcutLabel: string;
  readonly snapshot: DesktopAppState;
  readonly threadGroups: ReturnType<typeof buildThreadGroups>;
  readonly toggleDiffPanel: () => void;
  readonly togglePlanPanel: () => void;
  readonly toggleSelectedWorkspaceVsCodePanel: () => void;
  readonly topbarProjectActions: ReturnType<typeof useProjectActions>["topbarProjectActions"];
  readonly visibleTerminal: ReturnType<typeof useVisibleTerminal>;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly wsMenu: ReturnType<typeof useWorkspaceMenu>;
}

export function AppMainShell({
  activeWorktrees,
  addActionDialogOpen,
  api,
  closeAddActionDialog,
  commandPalette,
  diffFileRequest,
  displayedSessionTitle,
  gitActions,
  handleArchiveSession,
  handleSelectSession,
  handleToggleExtensionDock,
  handleTogglePrimarySidebar,
  handleUnarchiveSession,
  isSelectedExtensionDockExpanded,
  linkedWorktreeByWorkspaceId,
  mainRef,
  onAddAction,
  onAddTerminalSelectionToComposer,
  onFocusComposer,
  onOpenExtensions,
  onOpenNewThreadSurface,
  onOpenSettings,
  onOpenSkills,
  onOpenUrl,
  onRunProjectAction,
  onSaveProjectAction,
  onSetActiveView,
  panelLayout,
  planPanelOpen,
  planSurfaceAvailable,
  primaryContent,
  primarySidebarToggleVisible,
  rootWorkspace,
  runningLabel,
  selectedExtensionDock,
  selectedSession,
  selectedSessionKey,
  selectedWorkspace,
  selectedWorktree,
  setSnapshot,
  showDiffPanel,
  sidebarToggleShortcutLabel,
  snapshot,
  threadGroups,
  toggleDiffPanel,
  togglePlanPanel,
  toggleSelectedWorkspaceVsCodePanel,
  topbarProjectActions,
  visibleTerminal,
  visibleWorkspaces,
  wsMenu,
}: AppMainShellProps) {
  const [focusMode, setFocusMode] = useState(() => {
    try {
      return localStorage.getItem("pi-gui:focus-mode:keep") === "true";
    } catch {
      return false;
    }
  });
  const [keepFocusMode, setKeepFocusMode] = useState(focusMode);
  const focusModeActive = focusMode && snapshot.activeView === "threads";
  const exitFocusMode = () => {
    setFocusMode(false);
    setKeepFocusMode(false);
    try {
      localStorage.removeItem("pi-gui:focus-mode:keep");
    } catch {
      // Focus mode still exits for the current window.
    }
  };
  const toggleFocusMode = () => {
    if (focusModeActive) {
      exitFocusMode();
    } else {
      setFocusMode(true);
    }
  };
  const setFocusModePersistence = (keep: boolean) => {
    setKeepFocusMode(keep);
    try {
      if (keep) localStorage.setItem("pi-gui:focus-mode:keep", "true");
      else localStorage.removeItem("pi-gui:focus-mode:keep");
    } catch {
      // The current-window focus state remains usable.
    }
  };
  useEffect(() => {
    const handleFocusShortcut = (event: KeyboardEvent) => {
      const toggleShortcut = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f";
      if (toggleShortcut && snapshot.activeView === "threads") {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if (
        event.key === "Escape" &&
        focusModeActive &&
        !document.querySelector("[role='dialog'], [data-testid='command-palette']")
      ) {
        exitFocusMode();
      }
    };
    document.addEventListener("keydown", handleFocusShortcut, true);
    return () => document.removeEventListener("keydown", handleFocusShortcut, true);
  });
  const {
    isTerminalVisible,
    isVisibleTerminalTakeover,
    openTerminalTargets,
    visibleTerminalKey,
    visibleTerminalTarget,
  } = visibleTerminal;
  const showTerminalTakeover = !focusModeActive && isTerminalVisible && isVisibleTerminalTakeover && Boolean(visibleTerminalTarget);
  const threadVsCodeTarget = selectedWorkspace
    ? { workspaceId: selectedWorkspace.id, folderPath: selectedWorkspace.path }
    : panelLayout.vsCodeWorkspaceId && panelLayout.vsCodeFolderPath
      ? { workspaceId: panelLayout.vsCodeWorkspaceId, folderPath: panelLayout.vsCodeFolderPath }
      : null;
  const displayVsCodeTarget = panelLayout.vsCodeWorkspaceId && panelLayout.vsCodeFolderPath
    ? { workspaceId: panelLayout.vsCodeWorkspaceId, folderPath: panelLayout.vsCodeFolderPath }
    : null;
  const persistentVsCodeTarget = snapshot.activeView === "threads"
    ? threadVsCodeTarget
    : snapshot.activeView === "display-mode"
      ? displayVsCodeTarget
      : null;
  const showPersistentVsCodePanel = !focusModeActive && panelLayout.vsCodeOpen && persistentVsCodeTarget !== null && (snapshot.activeView === "threads" || snapshot.activeView === "display-mode");
  const showThreadVsCodePanel = snapshot.activeView === "threads" && !panelLayout.showThreadBrowserPanel && showPersistentVsCodePanel && threadVsCodeTarget !== null;
  const showPlanPanel = !focusModeActive && planPanelOpen && planSurfaceAvailable;
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | undefined>();
  useEffect(() => {
    let disposed = false;
    void api.getUpdateStatus().then((status) => {
      if (!disposed) {
        setUpdateStatus(status);
      }
    });
    const unsubscribe = api.onUpdateStatusChanged((status) => {
      if (!disposed) {
        setUpdateStatus(status);
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api]);
  const handleCheckForUpdates = () => {
    void api.checkForUpdates().then(setUpdateStatus);
  };
  const handleInstallUpdate = () => {
    void api.installUpdate();
  };
  const mainClassName = [
    "main",
    showDiffPanel && !focusModeActive ? "main--with-diff" : "",
    showThreadVsCodePanel ? "main--with-vscode" : "",
    panelLayout.showThreadBrowserPanel && !focusModeActive ? "main--with-browser" : "",
    showPlanPanel ? "main--with-plan" : "",
    panelLayout.showLogsPanel && !focusModeActive ? "main--with-logs" : "",
    isTerminalVisible && !focusModeActive ? "main--with-terminal" : "",
    showTerminalTakeover ? "main--terminal-takeover" : "",
  ].filter(Boolean).join(" ");
  const threadVsCodeBounds = panelLayout.getThreadVsCodePanelBounds();
  const threadBrowserBounds = panelLayout.getThreadBrowserPanelBounds();
  const terminalPanel = !focusModeActive && isTerminalVisible && visibleTerminalTarget ? (
    <TerminalStack
      targets={openTerminalTargets}
      visibleTarget={visibleTerminalTarget}
      visibleKey={visibleTerminalKey}
      height={panelLayout.terminalHeight}
      isTakeover={isVisibleTerminalTakeover}
      onSelectTarget={panelLayout.setActiveTerminalSessionKey}
      onHeightChange={panelLayout.setTerminalHeight}
      onExitTakeover={panelLayout.removeTerminalTakeover}
      onToggleTakeover={panelLayout.toggleTerminalTakeover}
      onClose={(key) => {
        panelLayout.closeTerminal(key);
        onFocusComposer();
      }}
      onAddSelectionToComposer={onAddTerminalSelectionToComposer}
      onOpenUrl={onOpenUrl}
    />
  ) : null;

  return (
    <AppShell
      addActionDialogOpen={addActionDialogOpen}
      commandPalette={commandPalette}
      mainClassName={mainClassName}
      mainRef={mainRef}
      mainStyle={{
        "--thread-vscode-width": `${panelLayout.threadVsCodeWidth}px`,
        "--thread-browser-width": `${panelLayout.browserPanelWidth}px`,
      } as CSSProperties}
      panelOverlaysProps={{
        api,
        activeView: snapshot.activeView,
        browserPanelWidth: panelLayout.browserPanelWidth,
        browserUrl: panelLayout.sideBrowserUrl,
        diagnosticReporting: snapshot.diagnosticReporting,
        diffFileRequest,
        persistentVsCodeTarget,
        selectedSession,
        selectedWorkspace,
        showDiffPanel: showDiffPanel && !focusModeActive,
        showLogsPanel: panelLayout.showLogsPanel && !focusModeActive,
        showPersistentVsCodePanel,
        showThreadBrowserPanel: panelLayout.showThreadBrowserPanel && !focusModeActive,
        showThreadVsCodePanel,
        threadBrowserMaxWidth: threadBrowserBounds.maxWidth,
        threadBrowserMinWidth: threadBrowserBounds.minWidth,
        threadVsCodeMaxWidth: threadVsCodeBounds.maxWidth,
        threadVsCodeMinWidth: threadVsCodeBounds.minWidth,
        threadVsCodeTarget,
        threadVsCodeWidth: panelLayout.threadVsCodeWidth,
        vsCodePanelStyle: panelLayout.vsCodePanelStyle,
        onBrowserNavigate: (nextUrl) => panelLayout.setSideBrowserUrl(nextUrl),
        onBrowserClose: () => panelLayout.setSideBrowserOpen(false),
        onBrowserOpenExternal: (nextUrl) => onOpenUrl(nextUrl, { external: true }),
        onLogsClose: () => panelLayout.setLogsPanelOpen(false),
        onThreadBrowserResizeKeyDown: panelLayout.handleThreadBrowserResizeKeyDown,
        onThreadBrowserResizePointerDown: panelLayout.startThreadBrowserResize,
        onThreadVsCodeResizeKeyDown: panelLayout.handleThreadVsCodeResizeKeyDown,
        onThreadVsCodeResizePointerDown: panelLayout.startThreadVsCodeResize,
        setVsCodeSlotElement: panelLayout.setVsCodeSlotElement,
      }}
      primarySidebarToggleVisible={primarySidebarToggleVisible && !focusModeActive}
      shellClassName={`shell${snapshot.sidebarCollapsed || focusModeActive ? " shell--sidebar-collapsed" : ""}${focusModeActive ? " shell--focus-mode" : ""}`}
      showTerminalTakeover={showTerminalTakeover}
      sidebarCollapsed={snapshot.sidebarCollapsed || focusModeActive}
      sidebarProps={{
        activeView: snapshot.activeView,
        selectedWorkspace,
        selectedSession,
        visibleWorkspaces,
        threadGroups,
        linkedWorktreeByWorkspaceId,
        wsMenu,
        api,
        setSnapshot,
        onNewThread: () => onOpenNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id),
        onSetActiveView,
        onOpenSkills,
        onOpenExtensions,
        onOpenSettings,
        onArchiveSession: handleArchiveSession,
        onSelectSession: handleSelectSession,
        onUnarchiveSession: handleUnarchiveSession,
        getRuntimeBadgeCount: runtimeBadgeCount,
      }}
      sidebarToggleProps={{
        collapsed: snapshot.sidebarCollapsed || focusModeActive,
        shortcutLabel: sidebarToggleShortcutLabel,
        onToggle: handleTogglePrimarySidebar,
      }}
      terminalPanel={terminalPanel}
      topbarProps={{
        activeView: snapshot.activeView,
        rootWorkspace,
        selectedWorkspace,
        selectedSession,
        selectedSessionTitle: displayedSessionTitle || selectedSession?.title,
        selectedSessionRunningLabel: selectedSession?.status === "running" ? runningLabel : undefined,
        selectedWorktree,
        activeWorktrees,
        workspaces: snapshot.workspaces,
        wsMenu,
        api,
        setSnapshot,
        terminalAvailable: Boolean(selectedSessionKey) || snapshot.activeView === "new-thread",
        terminalVisible: isTerminalVisible,
        projectActions: topbarProjectActions,
        onAddAction,
        onRunProjectAction,
        onToggleTerminal: panelLayout.toggleTerminal,
        planAvailable: planSurfaceAvailable,
        planPanelOpen,
        onTogglePlanPanel: togglePlanPanel,
        browserAvailable: snapshot.activeView === "threads" && Boolean(selectedWorkspace && selectedSession),
        browserOpen: panelLayout.sideBrowserOpen,
        onToggleBrowser: panelLayout.toggleSideBrowser,
        showDiffPanel,
        onToggleDiffPanel: toggleDiffPanel,
        logsOpen: snapshot.activeView === "threads" || snapshot.activeView === "display-mode" ? panelLayout.logsOpen : undefined,
        onToggleLogs: snapshot.activeView === "threads" || snapshot.activeView === "display-mode" ? panelLayout.toggleLogsPanel : undefined,
        drawerOpen: snapshot.activeView === "display-mode" ? panelLayout.dmDrawerOpen : undefined,
        onToggleDrawer: snapshot.activeView === "display-mode" ? panelLayout.toggleDmDrawer : undefined,
        vsCodeOpen: snapshot.activeView === "threads" || snapshot.activeView === "display-mode" ? panelLayout.vsCodeOpen : undefined,
        onToggleVsCode: snapshot.activeView === "threads" ? toggleSelectedWorkspaceVsCodePanel : snapshot.activeView === "display-mode" ? panelLayout.toggleVsCode : undefined,
        extensionDock: snapshot.activeView === "threads" ? selectedExtensionDock : undefined,
        extensionDockExpanded: isSelectedExtensionDockExpanded,
        onToggleExtensionDock: snapshot.activeView === "threads" ? handleToggleExtensionDock : undefined,
        onGitCommit: snapshot.activeView === "threads" ? () => gitActions.openGitDialog("commit") : undefined,
        onGitPush: snapshot.activeView === "threads" ? () => gitActions.openGitDialog("push") : undefined,
        onGitCreatePr: snapshot.activeView === "threads" ? () => gitActions.openGitDialog("pr") : undefined,
        updateStatus,
        onCheckForUpdates: handleCheckForUpdates,
        onInstallUpdate: handleInstallUpdate,
        state: snapshot,
        onOpenThread: handleSelectSession,
        focusMode: focusModeActive,
        keepFocusMode,
        onToggleFocusMode: toggleFocusMode,
        onSetKeepFocusMode: setFocusModePersistence,
      }}
      onCloseAddActionDialog={closeAddActionDialog}
      onSaveProjectAction={onSaveProjectAction}
    >
      {primaryContent}
    </AppShell>
  );
}
