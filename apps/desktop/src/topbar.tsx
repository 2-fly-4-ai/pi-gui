import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type Dispatch, type SetStateAction } from "react";
import type { AppView, DesktopAppState, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import type { ProjectActionRecord } from "./project-actions";
import { BrowserIcon, DiffIcon, FolderIcon, LogsIcon, MaximizeIcon, PlusIcon, SidebarToggleIcon, TerminalIcon, VSCodeIcon } from "./icons";
import { getDesktopShortcutLabel, type DesktopUpdateStatus, type PiDesktopApi } from "./ipc";
import { GitQuickActions } from "./git-quick-actions";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { runtimeStatusLabel, topbarRuntimeStatusLabel } from "./runtime-status";
import { ExtensionDock, type ExtensionDockModel } from "./extension-session-ui";
import { useTaskEvidence } from "./features/evidence/use-task-evidence";
import { deriveTaskEvidencePresentation } from "./features/evidence/task-evidence-presentation";
import { ApprovalCenter } from "./features/evidence/approval-center";
import { useStableTaskActivity } from "./features/evidence/use-stable-task-activity";
import type { WorkspaceSessionTarget } from "./desktop-state";

interface TopbarProps {
  readonly activeView: AppView;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionTitle: string | undefined;
  readonly selectedSessionRunningLabel: string | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly activeWorktrees: readonly WorktreeRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly terminalAvailable: boolean;
  readonly terminalVisible: boolean;
  readonly projectActions: readonly ProjectActionRecord[];
  readonly onAddAction: () => void;
  readonly onRunProjectAction: (action: ProjectActionRecord) => void;
  readonly onToggleTerminal: () => void;
  readonly planAvailable: boolean;
  readonly planPanelOpen: boolean;
  readonly onTogglePlanPanel: () => void;
  readonly browserAvailable?: boolean;
  readonly browserOpen?: boolean;
  readonly onToggleBrowser?: () => void;
  readonly showDiffPanel: boolean;
  readonly onToggleDiffPanel: () => void;
  readonly logsOpen?: boolean;
  readonly onToggleLogs?: () => void;
  readonly drawerOpen?: boolean;
  readonly onToggleDrawer?: () => void;
  readonly vsCodeOpen?: boolean;
  readonly onToggleVsCode?: () => void;
  readonly extensionDock?: ExtensionDockModel;
  readonly extensionDockExpanded?: boolean;
  readonly onToggleExtensionDock?: () => void;
  readonly onGitCommit?: () => void;
  readonly onGitPush?: () => void;
  readonly onGitCreatePr?: () => void;
  readonly updateStatus?: DesktopUpdateStatus;
  readonly onCheckForUpdates?: () => void;
  readonly onInstallUpdate?: () => void;
  readonly state: DesktopAppState;
  readonly onOpenThread: (target: WorkspaceSessionTarget) => void;
  readonly focusMode: boolean;
  readonly keepFocusMode: boolean;
  readonly onToggleFocusMode: () => void;
  readonly onSetKeepFocusMode: (keep: boolean) => void;
}

export function Topbar(props: TopbarProps) {
  const {
    activeView,
    rootWorkspace,
    selectedWorkspace,
    selectedSession,
    selectedSessionTitle,
    selectedSessionRunningLabel,
    selectedWorktree,
    activeWorktrees,
    workspaces,
    wsMenu,
    api,
    setSnapshot,
    terminalAvailable,
    terminalVisible,
    projectActions,
    onAddAction,
    onRunProjectAction,
    onToggleTerminal,
    planAvailable,
    planPanelOpen,
    onTogglePlanPanel,
    browserAvailable,
    browserOpen,
    onToggleBrowser,
    showDiffPanel,
    onToggleDiffPanel,
    logsOpen,
    onToggleLogs,
    drawerOpen,
    onToggleDrawer,
    vsCodeOpen,
    onToggleVsCode,
    extensionDock,
    extensionDockExpanded = false,
    onToggleExtensionDock,
    onGitCommit,
    onGitPush,
    onGitCreatePr,
    updateStatus,
    onCheckForUpdates,
    onInstallUpdate,
    state,
    onOpenThread,
    focusMode,
    keepFocusMode,
    onToggleFocusMode,
    onSetKeepFocusMode,
  } = props;
  const terminalShortcut = getDesktopShortcutLabel(api.platform, "J");
  const diffShortcut = getDesktopShortcutLabel(api.platform, "D");
  const showGitQuickActions = activeView === "threads" && Boolean(selectedWorkspace && selectedSession && onGitCommit && onGitPush && onGitCreatePr);
  const showExternalActions = showGitQuickActions;
  const hasPanelsMenu = Boolean(
    (browserAvailable && onToggleBrowser) ||
    onToggleLogs ||
    onToggleDrawer ||
    onToggleVsCode ||
    selectedWorkspace,
  );
  const anyUtilityPanelOpen = Boolean(browserOpen || logsOpen || drawerOpen || vsCodeOpen);
  const updateAction = getTopbarUpdateAction(updateStatus);
  const runtimeLabel = runtimeStatusLabel(selectedSession);
  const topbarRuntimeLabel = topbarRuntimeStatusLabel(selectedSession);
  const { records: taskEvidence } = useTaskEvidence(api, selectedWorkspace?.id, selectedSession?.id);
  const taskPresentation = deriveTaskEvidencePresentation(
    taskEvidence,
    selectedSession?.status ?? "idle",
  );
  const topbarActivity = useStableTaskActivity(
    taskPresentation.activity,
    selectedSession?.status ?? "idle",
  );
  const topbarActivityLabel = topbarActivity?.label;
  const topbarExtensionDock = extensionDock && !isTopbarNoisyExtensionDock(extensionDock) ? extensionDock : undefined;
  const [panelsMenuOpen, setPanelsMenuOpen] = useState(false);
  const panelsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!panelsMenuOpen) return;
    const closeOnPointerDown = (event: MouseEvent) => {
      if (!panelsMenuRef.current?.contains(event.target as Node)) {
        setPanelsMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panelsMenuOpen]);

  useEffect(() => {
    setPanelsMenuOpen(false);
  }, [activeView]);

  const runPanelAction = (action: () => void) => {
    setPanelsMenuOpen(false);
    action();
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".topbar__actions")) {
      return;
    }

    void api.toggleWindowMaximize();
  };

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <div className="topbar__title">
        <span className="topbar__workspace">
          {rootWorkspace ? rootWorkspace.name : "Open a folder to begin"}
        </span>
        {selectedWorkspace && activeView === "threads" ? (
          <>
            <span className="topbar__separator">/</span>
            <div className="environment-picker" ref={wsMenu.environmentMenuRef}>
              <button
                aria-expanded={wsMenu.environmentMenuOpen}
                aria-haspopup="menu"
                className="environment-picker__button"
                type="button"
                onClick={() => wsMenu.setEnvironmentMenuOpen((current) => !current)}
              >
                {selectedWorkspace.kind === "worktree" ? selectedWorktree?.name ?? selectedWorkspace.name : "Local"}
              </button>
              {wsMenu.environmentMenuOpen && rootWorkspace ? (
                <div className="workspace-menu environment-picker__menu">
                  <button
                    className="workspace-menu__item"
                    type="button"
                    onClick={() => wsMenu.selectWorkspace(rootWorkspace.id)}
                  >
                    Local
                  </button>
                  {activeWorktrees.map((worktree) => {
                    const linkedWorkspace = workspaces.find(
                      (workspace) => workspace.id === worktree.linkedWorkspaceId,
                    );
                    const worktreeSelectable = Boolean(linkedWorkspace) && worktree.status === "ready";
                    return (
                      <button
                        className="workspace-menu__item"
                        key={worktree.id}
                        type="button"
                        disabled={!worktreeSelectable}
                        onClick={() => {
                          if (worktreeSelectable && linkedWorkspace) {
                            wsMenu.selectWorkspace(linkedWorkspace.id);
                          }
                        }}
                      >
                        {worktree.name}
                        {!worktreeSelectable ? ` (${worktree.status !== "ready" ? worktree.status : "unavailable"})` : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {selectedWorkspace && activeView === "threads" && selectedSession ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{selectedSessionTitle ?? selectedSession.title}</span>
            <span className="topbar__runtime-status" data-testid="topbar-runtime-status" title={runtimeLabel}>
              {topbarRuntimeLabel}
            </span>
            {selectedSession.status === "running" && selectedSessionRunningLabel ? (
              <span
                className="topbar__running"
                aria-label={topbarActivityLabel
                  ? `${topbarActivityLabel}, ${selectedSessionRunningLabel}`
                  : selectedSessionRunningLabel}
              >
                <span className="topbar__running-dot" aria-hidden="true" />
                <span>{topbarActivityLabel ? `${topbarActivityLabel} · ` : ""}{selectedSessionRunningLabel}</span>
              </span>
            ) : null}
            {topbarExtensionDock && onToggleExtensionDock ? (
              <div className="topbar__extension-dock">
                <ExtensionDock dock={topbarExtensionDock} expanded={extensionDockExpanded} onToggle={onToggleExtensionDock} />
              </div>
            ) : null}
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">New thread</span>
          </>
        ) : null}
      </div>

      <div className="topbar__actions">
        <ApprovalCenter
          api={api}
          state={state}
          setSnapshot={setSnapshot}
          onOpenThread={onOpenThread}
        />
        {activeView === "threads" ? (
          <div className="topbar__action-group topbar__action-group--focus" data-testid="topbar-focus-actions">
            <button
              aria-label={focusMode ? "Exit Focus mode" : "Enter Focus mode"}
              aria-pressed={focusMode}
              className={`topbar__action-button${focusMode ? " topbar__action-button--active" : ""}`}
              type="button"
              title="Focus mode · Shift+⌘F"
              onClick={onToggleFocusMode}
            >
              <MaximizeIcon />
              <span>{focusMode ? "Focused" : "Focus"}</span>
            </button>
            {focusMode ? (
              <label className="topbar__focus-persist">
                <input
                  type="checkbox"
                  checked={keepFocusMode}
                  onChange={(event) => onSetKeepFocusMode(event.currentTarget.checked)}
                />
                Keep
              </label>
            ) : null}
          </div>
        ) : null}
        {updateAction ? (
          <div className="topbar__action-group topbar__action-group--update" data-testid="topbar-update-actions">
            <button
              aria-label={updateAction.ariaLabel}
              className={`topbar__action-button topbar__update-action topbar__update-action--${updateAction.variant}`}
              type="button"
              title={updateAction.title}
              disabled={updateAction.disabled}
              onClick={() => {
                if (updateStatus?.status === "ready") {
                  onInstallUpdate?.();
                  return;
                }
                if (updateStatus?.status === "update-available") {
                  void api.openExternal(updateStatus.releasePageUrl);
                  return;
                }
                if (updateStatus?.status === "homebrew-update-available") {
                  void api.copyText(updateStatus.command);
                  return;
                }
                onCheckForUpdates?.();
              }}
            >
              <span>{updateAction.label}</span>
            </button>
          </div>
        ) : null}
        <div className="topbar__action-group topbar__action-group--project" data-testid="topbar-project-actions">
          <button
            aria-label="Add action"
            className="topbar__action-button"
            type="button"
            disabled={!terminalAvailable}
            onClick={onAddAction}
          >
            <PlusIcon />
            <span>Add action</span>
          </button>
          {projectActions.slice(0, 3).map((action) => (
            <button
              aria-label={`Run action ${action.name}`}
              className="topbar__saved-action"
              key={action.id}
              type="button"
              disabled={!terminalAvailable}
              onClick={() => onRunProjectAction(action)}
            >
              {action.name}
            </button>
          ))}
        </div>
        <div className="topbar__action-group topbar__action-group--panels" data-testid="topbar-panel-actions">
          {planAvailable ? (
            <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
              <button
                aria-label="Toggle plan"
                className={`icon-button topbar__icon ${planPanelOpen ? "icon-button--active" : ""}`}
                type="button"
                onClick={onTogglePlanPanel}
              >
                <span aria-hidden="true">▦</span>
              </button>
              <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
                <span>Toggle plan</span>
              </span>
            </div>
          ) : null}
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Toggle terminal"
              className={`icon-button topbar__icon ${terminalVisible ? "icon-button--active" : ""}`}
              type="button"
              disabled={!terminalAvailable}
              onClick={onToggleTerminal}
            >
              <TerminalIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Toggle terminal</span>
              <kbd>{terminalShortcut}</kbd>
            </span>
          </div>
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Toggle changes"
              className={`icon-button topbar__icon ${showDiffPanel ? "icon-button--active" : ""}`}
              type="button"
              onClick={onToggleDiffPanel}
            >
              <DiffIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Toggle changes</span>
              <kbd>{diffShortcut}</kbd>
            </span>
          </div>
          {hasPanelsMenu ? (
            <div className="topbar__panels-menu-wrap" ref={panelsMenuRef}>
              <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
                <button
                  aria-expanded={panelsMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Open panels menu"
                  className={`icon-button topbar__icon ${anyUtilityPanelOpen ? "icon-button--active" : ""}`}
                  type="button"
                  onClick={() => setPanelsMenuOpen((open) => !open)}
                >
                  <SidebarToggleIcon />
                </button>
                <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
                  <span>Panels and tools</span>
                </span>
              </div>
              {panelsMenuOpen ? (
                <div aria-label="Panels and tools" className="topbar__panels-menu" role="menu">
                  {browserAvailable && onToggleBrowser ? (
                    <button className="topbar__panels-menu-item" role="menuitemcheckbox" aria-checked={Boolean(browserOpen)} type="button" onClick={() => runPanelAction(onToggleBrowser)}>
                      <BrowserIcon />
                      <span>Browser</span>
                      <span className="topbar__panels-menu-state">{browserOpen ? "Open" : "Closed"}</span>
                    </button>
                  ) : null}
                  {onToggleLogs ? (
                    <button className="topbar__panels-menu-item" role="menuitemcheckbox" aria-checked={Boolean(logsOpen)} type="button" onClick={() => runPanelAction(onToggleLogs)}>
                      <LogsIcon />
                      <span>App logs</span>
                      <span className="topbar__panels-menu-state">{logsOpen ? "Open" : "Closed"}</span>
                    </button>
                  ) : null}
                  {onToggleDrawer ? (
                    <button className="topbar__panels-menu-item" role="menuitemcheckbox" aria-checked={Boolean(drawerOpen)} type="button" onClick={() => runPanelAction(onToggleDrawer)}>
                      <SidebarToggleIcon />
                      <span>Preview panel</span>
                      <span className="topbar__panels-menu-state">{drawerOpen ? "Open" : "Closed"}</span>
                    </button>
                  ) : null}
                  {onToggleVsCode ? (
                    <button className="topbar__panels-menu-item" role="menuitemcheckbox" aria-checked={Boolean(vsCodeOpen)} type="button" onClick={() => runPanelAction(onToggleVsCode)}>
                      <VSCodeIcon />
                      <span>VS Code</span>
                      <span className="topbar__panels-menu-state">{vsCodeOpen ? "Open" : "Closed"}</span>
                    </button>
                  ) : null}
                  {selectedWorkspace ? (
                    <>
                      <div className="topbar__panels-menu-separator" role="separator" />
                      <button
                        className="topbar__panels-menu-item"
                        role="menuitem"
                        type="button"
                        onClick={() => runPanelAction(() => {
                          void api.pickWorkspace().then(() => api.getState()).then(setSnapshot);
                        })}
                      >
                        <FolderIcon />
                        <span>Add folder</span>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {showExternalActions ? (
          <div className="topbar__action-group topbar__action-group--external" data-testid="topbar-external-actions">
            {showGitQuickActions && onGitCommit && onGitPush && onGitCreatePr ? (
              <GitQuickActions
                onCommit={onGitCommit}
                onPush={onGitPush}
                onCreatePr={onGitCreatePr}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function isTopbarNoisyExtensionDock(dock: ExtensionDockModel): boolean {
  const summary = dock.summaryText
    .trim()
    .toLowerCase()
    .replace(/^[\s●•○◉∙·]+/u, "")
    .replace(/\s+/g, " ");

  return summary === "fast" || summary === "fast mode" || /^fast:\s*(?:on|off)$/.test(summary);
}

function getTopbarUpdateAction(status: DesktopUpdateStatus | undefined): {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly title?: string;
  readonly variant: "ready" | "available" | "homebrew" | "downloading";
} | null {
  if (!status) {
    return null;
  }

  if (status.status === "ready") {
    return {
      ariaLabel: `Restart to update to version ${status.latestVersion}`,
      label: "Restart to update",
      title: `Version ${status.latestVersion} is ready to install.`,
      variant: "ready",
    };
  }

  if (status.status === "downloading") {
    const percent = typeof status.percent === "number" ? ` ${Math.round(status.percent)}%` : "";
    return {
      ariaLabel: `Downloading update to version ${status.latestVersion}`,
      disabled: true,
      label: `Downloading${percent}`,
      title: `Downloading version ${status.latestVersion}.`,
      variant: "downloading",
    };
  }

  if (status.status === "update-available") {
    return {
      ariaLabel: `View update to version ${status.latestVersion}`,
      label: "View update",
      title: `Version ${status.latestVersion} is available.`,
      variant: "available",
    };
  }

  if (status.status === "homebrew-update-available") {
    return {
      ariaLabel: `Homebrew update to version ${status.latestVersion} available`,
      label: "Run brew upgrade",
      title: status.command,
      variant: "homebrew",
    };
  }

  return null;
}
