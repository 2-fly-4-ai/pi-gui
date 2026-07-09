import type { ToolAccessSelection } from "@pi-gui/session-driver";
import type { RuntimeSettingsSnapshot, RuntimeSkillProfileRecord } from "@pi-gui/session-driver/runtime-types";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  AppView,
  ComposerAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  DesktopAppState,
  DisplayModeThreadRecord,
  DiagnosticReportingPreferences,
  ModelSettingsScopeMode,
  NotificationPreferences,
  RemoveWorktreeInput,
  SelectedTranscriptRecord,
  StartThreadInput,
  TranscriptMessage,
  WorkspaceSessionTarget,
} from "./desktop-state";
import type { AgentDefinitionsSnapshot, DeleteAgentDefinitionInput, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "./agent-definitions";
import type { CreateReviewSnapshotOptions, ReviewSnapshot } from "./review/review-types";
import type {
  DeleteSubagentWorkflowInput,
  RunSubagentWorkflowInput,
  SaveSubagentWorkflowInput,
  SubagentRunRecord,
  SubagentWorkflowSnapshot,
} from "./subagent-workflows";
import type { ObservabilityEventPage, ObservabilityQuery } from "./observability-types";

export type DesktopNotificationPermissionStatus =
  | "granted"
  | "denied"
  | "default"
  | "unsupported"
  | "unknown";

export const desktopIpc = {
  rendererDiagnostic: "pi-gui:renderer-diagnostic",
  stateRequest: "pi-gui:state-request",
  statePatchChanged: "pi-gui:state-patch-changed",
  selectedTranscriptRequest: "pi-gui:selected-transcript-request",
  transcriptEvent: "pi-gui:transcript-event",
  transcriptResetRequest: "pi-gui:transcript-reset-request",
  displayModeThreadsRequest: "pi-gui:display-mode-threads-request",
  listObservabilityEvents: "pi-gui:list-observability-events",
  appCommand: "pi-gui:app-command",
  workspacePicked: "pi-gui:workspace-picked",
  clipboardImagePasted: "pi-gui:clipboard-image-pasted",
  addWorkspacePath: "pi-gui:add-workspace-path",
  pickWorkspace: "pi-gui:pick-workspace",
  selectWorkspace: "pi-gui:select-workspace",
  renameWorkspace: "pi-gui:rename-workspace",
  removeWorkspace: "pi-gui:remove-workspace",
  reorderWorkspaces: "pi-gui:reorder-workspaces",
  openWorkspaceInFinder: "pi-gui:open-workspace-in-finder",
  openWorkspaceInVSCode: "pi-gui:open-workspace-in-vscode",
  createWorktree: "pi-gui:create-worktree",
  removeWorktree: "pi-gui:remove-worktree",
  openSkillInFinder: "pi-gui:open-skill-in-finder",
  openExtensionInFinder: "pi-gui:open-extension-in-finder",
  syncCurrentWorkspace: "pi-gui:sync-current-workspace",
  selectSession: "pi-gui:select-session",
  renameSession: "pi-gui:rename-session",
  ensureVSCodeServer: "pi-gui:ensure-vscode-server",
  killVSCodeServer: "pi-gui:kill-vscode-server",
  archiveSession: "pi-gui:archive-session",
  unarchiveSession: "pi-gui:unarchive-session",
  createSession: "pi-gui:create-session",
  startThread: "pi-gui:start-thread",
  cancelCurrentRun: "pi-gui:cancel-current-run",
  cancelSessionRun: "pi-gui:cancel-session-run",
  stopRuntimeJob: "pi-gui:stop-runtime-job",
  refreshRuntimeJobs: "pi-gui:refresh-runtime-jobs",
  setActiveView: "pi-gui:set-active-view",
  setSidebarCollapsed: "pi-gui:set-sidebar-collapsed",
  setShowThinking: "pi-gui:set-show-thinking",
  setFastMode: "pi-gui:set-fast-mode",
  refreshRuntime: "pi-gui:refresh-runtime",
  setModelSettingsScopeMode: "pi-gui:set-model-settings-scope-mode",
  setDefaultModel: "pi-gui:set-default-model",
  setDefaultThinkingLevel: "pi-gui:set-default-thinking-level",
  setSessionModel: "pi-gui:set-session-model",
  setSessionThinkingLevel: "pi-gui:set-session-thinking-level",
  setSessionToolAccess: "pi-gui:set-session-tool-access",
  loginProvider: "pi-gui:login-provider",
  logoutProvider: "pi-gui:logout-provider",
  setProviderApiKey: "pi-gui:set-provider-api-key",
  setEnableSkillCommands: "pi-gui:set-enable-skill-commands",
  setScopedModelPatterns: "pi-gui:set-scoped-model-patterns",
  setSkillEnabled: "pi-gui:set-skill-enabled",
  setSkillMode: "pi-gui:set-skill-mode",
  setActiveSkillProfile: "pi-gui:set-active-skill-profile",
  saveSkillProfile: "pi-gui:save-skill-profile",
  deleteSkillProfile: "pi-gui:delete-skill-profile",
  setExtensionEnabled: "pi-gui:set-extension-enabled",
  listAgentDefinitions: "pi-gui:list-agent-definitions",
  saveAgentDefinition: "pi-gui:save-agent-definition",
  resetAgentDefinition: "pi-gui:reset-agent-definition",
  deleteAgentDefinition: "pi-gui:delete-agent-definition",
  listSubagentWorkflows: "pi-gui:list-subagent-workflows",
  saveSubagentWorkflow: "pi-gui:save-subagent-workflow",
  deleteSubagentWorkflow: "pi-gui:delete-subagent-workflow",
  listSubagentRuns: "pi-gui:list-subagent-runs",
  runSubagentWorkflow: "pi-gui:run-subagent-workflow",
  cancelSubagentRun: "pi-gui:cancel-subagent-run",
  subagentRunsChanged: "pi-gui:subagent-runs-changed",
  respondToHostUiRequest: "pi-gui:respond-to-host-ui-request",
  setNotificationPreferences: "pi-gui:set-notification-preferences",
  setDiagnosticReportingPreferences: "pi-gui:set-diagnostic-reporting-preferences",
  setDesktopCustomInstructions: "pi-gui:set-desktop-custom-instructions",
  setIntegratedTerminalShell: "pi-gui:set-integrated-terminal-shell",
  terminalEnsurePanel: "pi-gui:terminal-ensure-panel",
  terminalCreateSession: "pi-gui:terminal-create-session",
  terminalSetActiveSession: "pi-gui:terminal-set-active-session",
  terminalWrite: "pi-gui:terminal-write",
  terminalResize: "pi-gui:terminal-resize",
  terminalRestartSession: "pi-gui:terminal-restart-session",
  terminalCloseSession: "pi-gui:terminal-close-session",
  terminalSetTitle: "pi-gui:terminal-set-title",
  terminalSetFocused: "pi-gui:terminal-set-focused",
  terminalData: "pi-gui:terminal-data",
  terminalExit: "pi-gui:terminal-exit",
  terminalError: "pi-gui:terminal-error",
  getNotificationPermissionStatus: "pi-gui:get-notification-permission-status",
  requestNotificationPermission: "pi-gui:request-notification-permission",
  openSystemNotificationSettings: "pi-gui:open-system-notification-settings",
  notificationPermissionStatusChanged: "pi-gui:notification-permission-status-changed",
  updateStatusRequest: "pi-gui:update-status-request",
  updateStatusChanged: "pi-gui:update-status-changed",
  checkForUpdates: "pi-gui:check-for-updates",
  installUpdate: "pi-gui:install-update",
  copyText: "pi-gui:copy-text",
  pickComposerAttachments: "pi-gui:pick-composer-attachments",
  readClipboardImage: "pi-gui:read-clipboard-image",
  readSubagentTranscript: "pi-gui:read-subagent-transcript",
  addComposerAttachments: "pi-gui:add-composer-attachments",
  removeComposerAttachment: "pi-gui:remove-composer-attachment",
  editQueuedComposerMessage: "pi-gui:edit-queued-composer-message",
  cancelQueuedComposerEdit: "pi-gui:cancel-queued-composer-edit",
  removeQueuedComposerMessage: "pi-gui:remove-queued-composer-message",
  steerQueuedComposerMessage: "pi-gui:steer-queued-composer-message",
  updateComposerDraft: "pi-gui:update-composer-draft",
  submitComposer: "pi-gui:submit-composer",
  submitComposerToSession: "pi-gui:submit-composer-to-session",
  getSessionTree: "pi-gui:get-session-tree",
  navigateSessionTree: "pi-gui:navigate-session-tree",
  toggleWindowMaximize: "pi-gui:toggle-window-maximize",
  listWorkspaceFiles: "pi-gui:list-workspace-files",
  getChangedFiles: "pi-gui:get-changed-files",
  getCurrentBranch: "pi-gui:get-current-branch",
  getFileDiff: "pi-gui:get-file-diff",
  stageFile: "pi-gui:stage-file",
  stageAllFiles: "pi-gui:stage-all-files",
  commitChanges: "pi-gui:commit-changes",
  pushBranch: "pi-gui:push-branch",
  createPullRequest: "pi-gui:create-pull-request",
  createReviewSnapshot: "pi-gui:create-review-snapshot",
  runReviewAgentPreReview: "pi-gui:run-review-agent-pre-review",
  getThemeMode: "pi-gui:get-theme-mode",
  getResolvedTheme: "pi-gui:get-resolved-theme",
  setThemeMode: "pi-gui:set-theme-mode",
  themeChanged: "pi-gui:theme-changed",
  ping: "app:ping",
  openExternal: "app:open-external",
} as const;

export const desktopCommands = {
  openSettings: "open-settings",
  openNewThread: "open-new-thread",
  openCommandPalette: "open-command-palette",
  toggleTerminal: "toggle-terminal",
  toggleSidebar: "toggle-sidebar",
} as const;

export function getDesktopShortcutLabel(platform: NodeJS.Platform, key: string): string {
  return `${platform === "darwin" ? "⌘" : "Ctrl+"}${key.toUpperCase()}`;
}

export type PiDesktopCommand = (typeof desktopCommands)[keyof typeof desktopCommands];

export type TranscriptSyncEvent =
  | {
      readonly kind: "reset";
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly sequence: number;
      readonly transcript: readonly TranscriptMessage[];
    }
  | {
      readonly kind: "append";
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly sequence: number;
      readonly items: readonly TranscriptMessage[];
    }
  | {
      readonly kind: "update-last";
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly sequence: number;
      readonly item: TranscriptMessage;
    }
  | {
      readonly kind: "truncate";
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly sequence: number;
      readonly afterItemId?: string;
      readonly length?: number;
    };

export type TranscriptResetReason = "gap" | "selection" | "manual";

export interface TranscriptResetRequest {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly expectedSequence?: number;
  readonly reason: TranscriptResetReason;
}

export type StatePatchDomain =
  | "selection"
  | "workspaces"
  | "composer"
  | "runtime"
  | "settings"
  | "diagnostics";

export interface StatePatchEvent {
  readonly domain: StatePatchDomain;
  readonly revision: number;
  readonly patch: unknown;
}

export type PiDesktopTranscriptEventListener = (event: TranscriptSyncEvent) => void;
export type PiDesktopStatePatchListener = (event: StatePatchEvent) => void;

export type DesktopUpdateStatus =
  | {
      readonly status: "idle" | "checking";
      readonly currentVersion: string;
      readonly source: "direct" | "homebrew";
    }
  | {
      readonly status: "up-to-date";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly source: "direct" | "homebrew";
    }
  | {
      readonly status: "update-available";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly source: "direct";
      readonly releasePageUrl: string;
    }
  | {
      readonly status: "downloading";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly source: "direct";
      readonly percent?: number;
    }
  | {
      readonly status: "ready";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly source: "direct";
    }
  | {
      readonly status: "homebrew-update-available";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly source: "homebrew";
      readonly command: string;
    }
  | {
      readonly status: "error";
      readonly currentVersion: string;
      readonly source: "direct" | "homebrew";
      readonly message: string;
    };

export type PiDesktopUpdateStatusListener = (status: DesktopUpdateStatus) => void;

export interface RendererDiagnosticPayload {
  readonly kind: string;
  readonly message?: string;
  readonly stack?: string;
  readonly componentStack?: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly href?: string;
  readonly userAgent?: string;
  readonly timestamp?: string;
  readonly details?: unknown;
}

export interface RendererDiagnosticFlags {
  readonly layoutMonitor: boolean;
  readonly perfMonitor: boolean;
}

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalSessionStatus = "running" | "exited" | "error";

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly title: string;
  readonly status: TerminalSessionStatus;
  readonly replay: string;
  readonly truncated: boolean;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalPanelSnapshot {
  readonly workspaceId: string;
  readonly rootKey: string;
  readonly activeSessionId: string;
  readonly sessions: readonly TerminalSessionSnapshot[];
}

export interface TerminalDataEvent {
  readonly terminalId: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly terminalId: string;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalErrorEvent {
  readonly terminalId: string;
  readonly message: string;
}

export interface DesktopShortcutInput {
  readonly modifier: boolean;
  readonly shift: boolean;
  readonly key: string;
  readonly code?: string;
}

export interface SubagentTranscriptPreview {
  readonly path: string;
  readonly text: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
}

export function getDesktopCommandFromShortcut(input: DesktopShortcutInput): PiDesktopCommand | undefined {
  if (!input.modifier) {
    return undefined;
  }

  const lowerKey = input.key.toLowerCase();
  const isComma = input.key === "," || input.code === "Comma";
  const isB = lowerKey === "b" || input.code === "KeyB";
  const isJ = lowerKey === "j" || input.code === "KeyJ";
  const isK = lowerKey === "k" || input.code === "KeyK";
  const isShiftO = input.shift && (lowerKey === "o" || input.code === "KeyO");

  if (!input.shift && isComma) {
    return desktopCommands.openSettings;
  }

  if (!input.shift && isJ) {
    return desktopCommands.toggleTerminal;
  }

  if (!input.shift && isB) {
    return desktopCommands.toggleSidebar;
  }

  if (isShiftO) {
    return desktopCommands.openNewThread;
  }

  if (!input.shift && isK) {
    return desktopCommands.openCommandPalette;
  }

  return undefined;
}

export interface PiDesktopApi {
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  diagnosticFlags: RendererDiagnosticFlags;
  reportRendererDiagnostic(payload: RendererDiagnosticPayload): void;
  ping(): Promise<string>;
  getState(): Promise<DesktopAppState>;
  onStatePatchChanged(listener: PiDesktopStatePatchListener): () => void;
  getSelectedTranscript(): Promise<SelectedTranscriptRecord | null>;
  onTranscriptEvent(listener: PiDesktopTranscriptEventListener): () => void;
  requestTranscriptReset(input: TranscriptResetRequest): Promise<SelectedTranscriptRecord | null>;
  getDisplayModeThreads(): Promise<readonly DisplayModeThreadRecord[]>;
  listObservabilityEvents(input?: ObservabilityQuery): Promise<ObservabilityEventPage>;
  onCommand(listener: (command: PiDesktopCommand) => void): () => void;
  onWorkspacePicked(listener: (workspaceId: string) => void): () => void;
  onClipboardImagePasted(listener: (attachment: ComposerImageAttachment) => void): () => void;
  getPathForFile(file: File): string;
  addWorkspacePath(path: string): Promise<void>;
  pickWorkspace(): Promise<void>;
  selectWorkspace(workspaceId: string): Promise<void>;
  renameWorkspace(workspaceId: string, displayName: string): Promise<void>;
  removeWorkspace(workspaceId: string): Promise<void>;
  reorderWorkspaces(workspaceOrder: readonly string[]): Promise<void>;
  openWorkspaceInFinder(workspaceId: string): Promise<void>;
  openWorkspaceInVSCode(workspaceId: string): Promise<void>;
  createWorktree(input: CreateWorktreeInput): Promise<void>;
  removeWorktree(input: RemoveWorktreeInput): Promise<void>;
  openSkillInFinder(workspaceId: string, filePath: string): Promise<void>;
  openExtensionInFinder(workspaceId: string, filePath: string): Promise<void>;
  syncCurrentWorkspace(): Promise<void>;
  selectSession(target: WorkspaceSessionTarget): Promise<void>;
  renameSession(target: WorkspaceSessionTarget, title: string): Promise<void>;
  ensureVSCodeServer(workspaceId: string): Promise<number>;
  killVSCodeServer(workspaceId: string): Promise<void>;
  archiveSession(target: WorkspaceSessionTarget): Promise<void>;
  unarchiveSession(target: WorkspaceSessionTarget): Promise<void>;
  createSession(input: CreateSessionInput): Promise<void>;
  startThread(input: StartThreadInput): Promise<void>;
  cancelCurrentRun(): Promise<void>;
  cancelSessionRun(target: WorkspaceSessionTarget): Promise<void>;
  stopRuntimeJob(target: WorkspaceSessionTarget, jobId: string): Promise<void>;
  refreshRuntimeJobs(target: WorkspaceSessionTarget): Promise<void>;
  setActiveView(view: AppView): Promise<void>;
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
  setShowThinking(showThinking: boolean): Promise<void>;
  setFastMode(enabled: boolean): Promise<void>;
  refreshRuntime(workspaceId?: string): Promise<void>;
  setModelSettingsScopeMode(mode: ModelSettingsScopeMode): Promise<void>;
  setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<void>;
  setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<void>;
  setSessionModel(
    workspaceId: string,
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<void>;
  setSessionThinkingLevel(
    workspaceId: string,
    sessionId: string,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<void>;
  setSessionToolAccess(
    workspaceId: string,
    sessionId: string,
    toolAccess: ToolAccessSelection,
  ): Promise<void>;
  loginProvider(workspaceId: string, providerId: string): Promise<void>;
  logoutProvider(workspaceId: string, providerId: string): Promise<void>;
  setProviderApiKey(workspaceId: string, providerId: string, apiKey: string): Promise<void>;
  setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<void>;
  setScopedModelPatterns(workspaceId: string, patterns: readonly string[]): Promise<void>;
  setSkillEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<void>;
  setSkillMode(workspaceId: string, filePath: string, mode: "auto" | "manual" | "off"): Promise<void>;
  setActiveSkillProfile(workspaceId: string, profileId: string): Promise<void>;
  saveSkillProfile(workspaceId: string, profile: RuntimeSkillProfileRecord): Promise<void>;
  deleteSkillProfile(workspaceId: string, profileId: string): Promise<void>;
  setExtensionEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<void>;
  listAgentDefinitions(workspaceId: string): Promise<AgentDefinitionsSnapshot>;
  saveAgentDefinition(workspaceId: string, input: SaveAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>;
  resetAgentDefinition(workspaceId: string, input: ResetAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>;
  deleteAgentDefinition(workspaceId: string, input: DeleteAgentDefinitionInput): Promise<AgentDefinitionsSnapshot>;
  listSubagentWorkflows(workspaceId: string): Promise<SubagentWorkflowSnapshot>;
  saveSubagentWorkflow(workspaceId: string, input: SaveSubagentWorkflowInput): Promise<SubagentWorkflowSnapshot>;
  deleteSubagentWorkflow(workspaceId: string, input: DeleteSubagentWorkflowInput): Promise<SubagentWorkflowSnapshot>;
  listSubagentRuns(workspaceId: string): Promise<readonly SubagentRunRecord[]>;
  runSubagentWorkflow(workspaceId: string, input: RunSubagentWorkflowInput): Promise<readonly SubagentRunRecord[]>;
  cancelSubagentRun(workspaceId: string, runId: string): Promise<readonly SubagentRunRecord[]>;
  onSubagentRunsChanged(listener: (workspaceId: string) => void): () => void;
  respondToHostUiRequest(
    workspaceId: string,
    sessionId: string,
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ): Promise<void>;
  setNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<void>;
  setDiagnosticReportingPreferences(preferences: Partial<DiagnosticReportingPreferences>): Promise<void>;
  setDesktopCustomInstructions(input: Partial<DesktopAppState["desktopCustomInstructions"]>): Promise<void>;
  setIntegratedTerminalShell(shell: string): Promise<void>;
  ensureTerminalPanel(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  createTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  setActiveTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    terminalId: string,
  ): Promise<TerminalPanelSnapshot>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, size: TerminalSize): Promise<void>;
  restartTerminalSession(terminalId: string, size?: Partial<TerminalSize>): Promise<TerminalPanelSnapshot>;
  closeTerminalSession(terminalId: string): Promise<TerminalPanelSnapshot | null>;
  setTerminalTitle(terminalId: string, title: string): Promise<void>;
  setTerminalFocused(focused: boolean): Promise<void>;
  onTerminalData(listener: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
  onTerminalError(listener: (event: TerminalErrorEvent) => void): () => void;
  getNotificationPermissionStatus(): Promise<DesktopNotificationPermissionStatus>;
  requestNotificationPermission(): Promise<DesktopNotificationPermissionStatus>;
  openSystemNotificationSettings(): Promise<void>;
  onNotificationPermissionStatusChanged(
    callback: (status: DesktopNotificationPermissionStatus) => void,
  ): () => void;
  getUpdateStatus(): Promise<DesktopUpdateStatus>;
  onUpdateStatusChanged(listener: PiDesktopUpdateStatusListener): () => void;
  checkForUpdates(): Promise<DesktopUpdateStatus>;
  installUpdate(): Promise<void>;
  copyText(text: string): Promise<void>;
  pickComposerAttachments(): Promise<void>;
  readClipboardImage(): Promise<ComposerImageAttachment | null>;
  readSubagentTranscript(path: string): Promise<SubagentTranscriptPreview>;
  addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<void>;
  removeComposerAttachment(attachmentId: string): Promise<void>;
  editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<void>;
  cancelQueuedComposerEdit(): Promise<void>;
  removeQueuedComposerMessage(messageId: string): Promise<void>;
  steerQueuedComposerMessage(messageId: string): Promise<void>;
  updateComposerDraft(composerDraft: string): Promise<void>;
  submitComposer(text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly messageMetadata?: unknown }): Promise<void>;
  submitComposerToSession(
    target: WorkspaceSessionTarget,
    text: string,
    options?: { readonly deliverAs?: "steer" | "followUp"; readonly messageMetadata?: unknown },
  ): Promise<void>;
  getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }>;
  listWorkspaceFiles(workspaceId: string): Promise<string[]>;
  getChangedFiles(workspaceId: string): Promise<{ path: string; status: "added" | "modified" | "deleted" | "untracked"; staged: boolean }[]>;
  getCurrentBranch(workspaceId: string): Promise<string | undefined>;
  getFileDiff(workspaceId: string, filePath: string): Promise<string>;
  stageFile(workspaceId: string, filePath: string): Promise<void>;
  stageAllFiles(workspaceId: string): Promise<void>;
  commitChanges(workspaceId: string, message: string): Promise<void>;
  pushBranch(workspaceId: string, options?: { readonly setUpstream?: boolean }): Promise<void>;
  createPullRequest(
    workspaceId: string,
    input: { readonly title: string; readonly body: string; readonly base: string },
  ): Promise<{ readonly url?: string }>;
  createReviewSnapshot(workspaceId: string, options?: CreateReviewSnapshotOptions): Promise<ReviewSnapshot>;
  runReviewAgentPreReview(workspaceId: string, sessionId: string, snapshot: ReviewSnapshot): Promise<readonly import("./review/review-types").ReviewDraftComment[]>;
  toggleWindowMaximize(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getThemeMode(): Promise<"system" | "light" | "dark">;
  getResolvedTheme(): Promise<"light" | "dark">;
  setThemeMode(mode: "system" | "light" | "dark"): Promise<string>;
  onThemeChanged(callback: (theme: "light" | "dark") => void): () => void;
}
