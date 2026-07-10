import type { MouseEvent as ReactMouseEvent, Dispatch, SetStateAction } from "react";
import type { AppView, DesktopAppState, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import type { ProjectActionRecord } from "./project-actions";
import { BrowserIcon, DiffIcon, FolderIcon, LogsIcon, PlusIcon, SidebarToggleIcon, TerminalIcon, VSCodeIcon } from "./icons";
import { getDesktopShortcutLabel, type DesktopUpdateStatus, type PiDesktopApi } from "./ipc";
import { GitQuickActions } from "./git-quick-actions";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { runtimeStatusLabel, topbarRuntimeStatusLabel } from "./runtime-status";
import { ExtensionDock, type ExtensionDockModel } from "./extension-session-ui";

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
  } = props;
  const terminalShortcut = getDesktopShortcutLabel(api.platform, "J");
  const diffShortcut = getDesktopShortcutLabel(api.platform, "D");
  const showGitQuickActions = activeView === "threads" && Boolean(selectedWorkspace && selectedSession && onGitCommit && onGitPush && onGitCreatePr);
  const showExternalActions = showGitQuickActions || onToggleVsCode !== undefined;
  const updateAction = getTopbarUpdateAction(updateStatus);
  const runtimeLabel = runtimeStatusLabel(selectedSession);
  const topbarRuntimeLabel = topbarRuntimeStatusLabel(selectedSession);
  const topbarExtensionDock = extensionDock && !isTopbarNoisyExtensionDock(extensionDock) ? extensionDock : undefined;

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
              <span className="topbar__running" aria-label={selectedSessionRunningLabel}>
                <span className="topbar__running-dot" aria-hidden="true" />
                <span>{selectedSessionRunningLabel}</span>
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
          {browserAvailable && onToggleBrowser ? (
            <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
              <button
                aria-label="Toggle browser"
                className={`icon-button topbar__icon ${browserOpen ? "icon-button--active" : ""}`}
                type="button"
                onClick={onToggleBrowser}
              >
                <BrowserIcon />
              </button>
              <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
                <span>Toggle browser</span>
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
          {onToggleLogs !== undefined && (
            <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
              <button
                aria-label="Toggle logs panel"
                className={`icon-button topbar__icon ${logsOpen ? "icon-button--active" : ""}`}
                type="button"
                onClick={onToggleLogs}
              >
                <LogsIcon />
              </button>
              <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
                <span>Toggle logs</span>
              </span>
            </div>
          )}
          {onToggleDrawer !== undefined && (
            <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
              <button
                aria-label="Toggle side panel"
                className={`icon-button topbar__icon ${drawerOpen ? "icon-button--active" : ""}`}
                type="button"
                onClick={onToggleDrawer}
              >
                <SidebarToggleIcon />
              </button>
              <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
                <span>Toggle side panel</span>
              </span>
            </div>
          )}
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
            {onToggleVsCode !== undefined && (
              <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
                <button
                  aria-label="Toggle VS Code panel"
                  className={`icon-button topbar__icon ${vsCodeOpen ? "icon-button--active" : ""}`}
                  type="button"
                  onClick={onToggleVsCode}
                >
                  <VSCodeIcon />
                </button>
                <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
                  <span>Toggle VS Code</span>
                </span>
              </div>
            )}
          </div>
        ) : null}
        <div className="topbar__action-group topbar__action-group--workspace" data-testid="topbar-workspace-actions">
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Add folder"
              className="icon-button topbar__icon"
              type="button"
              onClick={() => {
                void api.pickWorkspace().then(() => api.getState()).then(setSnapshot);
              }}
            >
              <FolderIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Add folder</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

function isTopbarNoisyExtensionDock(dock: ExtensionDockModel): boolean {
  return dock.summaryText.trim().toLowerCase() === "fast";
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
