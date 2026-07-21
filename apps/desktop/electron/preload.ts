import { contextBridge, ipcRenderer, webUtils } from "electron";
import { PRELOAD_DEV_RELOAD_MARKER } from "./dev-reload-preload-probe";
import {
  desktopIpc,
  type DesktopNotificationPermissionStatus,
  type DesktopUpdateStatus,
  type PiDesktopCommand,
  type RendererDiagnosticPayload,
  type StatePatchEvent,
  type SubagentTranscriptPreview,
  type TerminalDataEvent,
  type TerminalErrorEvent,
  type TerminalExitEvent,
  type TerminalPanelSnapshot,
  type TerminalSize,
  type TranscriptResetRequest,
  type TranscriptSyncEvent,
} from "../src/ipc";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  HostUiResponse,
  ToolAccessSelection,
} from "@pi-gui/session-driver";
import type { RuntimeSettingsSnapshot, RuntimeSkillProfileRecord } from "@pi-gui/session-driver/runtime-types";
import type {
  AppView,
  ComposerAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  DesktopAppState,
  DiagnosticReportingPreferences,
  DisplayModeThreadRecord,
  NotificationPreferences,
  RemoveWorktreeInput,
  SelectedTranscriptRecord,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { AgentDefinitionsSnapshot, DeleteAgentDefinitionInput, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "../src/agent-definitions";
import type { CreateReviewSnapshotOptions, ReviewDraftComment, ReviewSnapshot } from "../src/review/review-types";
import type {
  DeleteSubagentWorkflowInput,
  RunSubagentWorkflowInput,
  SaveSubagentWorkflowInput,
  SubagentRunRecord,
  SubagentWorkflowSnapshot,
} from "../src/subagent-workflows";
import type { ObservabilityEventPage, ObservabilityQuery } from "../src/observability-types";

const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";

function resolveDevReloadMarkers() {
  if (!devReloadMarkersEnabled) {
    return undefined;
  }

  return {
    preload: PRELOAD_DEV_RELOAD_MARKER,
  };
}

const devReloadMarkers = resolveDevReloadMarkers();

if (devReloadMarkers) {
  contextBridge.exposeInMainWorld("__piDevReloadHost", devReloadMarkers);
}

function subscribeIpc<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld("piApp", {
  platform: process.platform,
  versions: process.versions,
  diagnosticFlags: {
    layoutMonitor: process.env.PI_APP_LAYOUT_MONITOR === "1",
    perfMonitor: process.env.PI_APP_PERF_MONITOR === "1",
  },
  reportRendererDiagnostic: (payload: RendererDiagnosticPayload) => {
    ipcRenderer.send(desktopIpc.rendererDiagnostic, payload);
  },
  ping: () => ipcRenderer.invoke(desktopIpc.ping) as Promise<string>,
  getState: () => ipcRenderer.invoke(desktopIpc.stateRequest) as Promise<DesktopAppState>,
  onStatePatchChanged: (listener: (event: StatePatchEvent) => void) =>
    subscribeIpc(desktopIpc.statePatchChanged, listener),
  getSelectedTranscript: () =>
    ipcRenderer.invoke(desktopIpc.selectedTranscriptRequest) as Promise<SelectedTranscriptRecord | null>,
  getDisplayModeThreads: () =>
    ipcRenderer.invoke(desktopIpc.displayModeThreadsRequest) as Promise<readonly DisplayModeThreadRecord[]>,
  listObservabilityEvents: (input?: ObservabilityQuery) =>
    ipcRenderer.invoke(desktopIpc.listObservabilityEvents, input) as Promise<ObservabilityEventPage>,
  onTranscriptEvent: (listener: (event: TranscriptSyncEvent) => void) =>
    subscribeIpc(desktopIpc.transcriptEvent, listener),
  requestTranscriptReset: (input: TranscriptResetRequest) =>
    ipcRenderer.invoke(desktopIpc.transcriptResetRequest, input) as Promise<SelectedTranscriptRecord | null>,
  onCommand: (listener: (command: PiDesktopCommand) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, command: PiDesktopCommand) => {
      listener(command);
    };
    ipcRenderer.on(desktopIpc.appCommand, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.appCommand, handle);
    };
  },
  onWorkspacePicked: (listener: (workspaceId: string) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, workspaceId: string) => {
      listener(workspaceId);
    };
    ipcRenderer.on(desktopIpc.workspacePicked, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.workspacePicked, handle);
    };
  },
  onClipboardImagePasted: (listener: (attachment: ComposerImageAttachment) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, attachment: ComposerImageAttachment) => {
      listener(attachment);
    };
    ipcRenderer.on(desktopIpc.clipboardImagePasted, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.clipboardImagePasted, handle);
    };
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  addWorkspacePath: (workspacePath: string) =>
    ipcRenderer.invoke(desktopIpc.addWorkspacePath, workspacePath) as Promise<void>,
  pickWorkspace: () => ipcRenderer.invoke(desktopIpc.pickWorkspace) as Promise<void>,
  selectWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.selectWorkspace, workspaceId) as Promise<void>,
  renameWorkspace: (workspaceId: string, displayName: string) =>
    ipcRenderer.invoke(desktopIpc.renameWorkspace, workspaceId, displayName) as Promise<void>,
  removeWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.removeWorkspace, workspaceId) as Promise<void>,
  reorderWorkspaces: (workspaceOrder: readonly string[]) =>
    ipcRenderer.invoke(desktopIpc.reorderWorkspaces, workspaceOrder) as Promise<void>,
  openWorkspaceInFinder: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.openWorkspaceInFinder, workspaceId) as Promise<void>,
  openWorkspaceInVSCode: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.openWorkspaceInVSCode, workspaceId) as Promise<void>,
  createWorktree: (input: CreateWorktreeInput) =>
    ipcRenderer.invoke(desktopIpc.createWorktree, input) as Promise<void>,
  removeWorktree: (input: RemoveWorktreeInput) =>
    ipcRenderer.invoke(desktopIpc.removeWorktree, input) as Promise<void>,
  openSkillInFinder: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.openSkillInFinder, workspaceId, filePath) as Promise<void>,
  openExtensionInFinder: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.openExtensionInFinder, workspaceId, filePath) as Promise<void>,
  syncCurrentWorkspace: () =>
    ipcRenderer.invoke(desktopIpc.syncCurrentWorkspace) as Promise<void>,
  selectSession: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.selectSession, target) as Promise<void>,
  renameSession: (target: WorkspaceSessionTarget, title: string) =>
    ipcRenderer.invoke(desktopIpc.renameSession, target, title) as Promise<void>,
  ensureVSCodeServer: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.ensureVSCodeServer, workspaceId) as Promise<number>,
  killVSCodeServer: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.killVSCodeServer, workspaceId) as Promise<void>,
  archiveSession: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.archiveSession, target) as Promise<void>,
  unarchiveSession: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.unarchiveSession, target) as Promise<void>,
  createSession: (input: CreateSessionInput) =>
    ipcRenderer.invoke(desktopIpc.createSession, input) as Promise<void>,
  startThread: (input: StartThreadInput) =>
    ipcRenderer.invoke(desktopIpc.startThread, input) as Promise<void>,
  cancelCurrentRun: () => ipcRenderer.invoke(desktopIpc.cancelCurrentRun) as Promise<void>,
  cancelSessionRun: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.cancelSessionRun, target) as Promise<void>,
  stopRuntimeJob: (target: WorkspaceSessionTarget, jobId: string) =>
    ipcRenderer.invoke(desktopIpc.stopRuntimeJob, target, jobId) as Promise<void>,
  refreshRuntimeJobs: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.refreshRuntimeJobs, target) as Promise<void>,
  setActiveView: (view: AppView) =>
    ipcRenderer.invoke(desktopIpc.setActiveView, view) as Promise<void>,
  setSidebarCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(desktopIpc.setSidebarCollapsed, collapsed) as Promise<void>,
  setShowThinking: (showThinking: boolean) =>
    ipcRenderer.invoke(desktopIpc.setShowThinking, showThinking) as Promise<void>,
  setFastMode: (enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setFastMode, enabled) as Promise<void>,
  refreshRuntime: (workspaceId?: string) =>
    ipcRenderer.invoke(desktopIpc.refreshRuntime, workspaceId) as Promise<void>,
  setModelSettingsScopeMode: (mode: "app-global" | "per-repo") =>
    ipcRenderer.invoke(desktopIpc.setModelSettingsScopeMode, mode) as Promise<void>,
  setDefaultModel: (workspaceId: string, provider: string, modelId: string) =>
    ipcRenderer.invoke(desktopIpc.setDefaultModel, workspaceId, provider, modelId) as Promise<void>,
  setDefaultThinkingLevel: (workspaceId: string, thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) =>
    ipcRenderer.invoke(desktopIpc.setDefaultThinkingLevel, workspaceId, thinkingLevel) as Promise<void>,
  setSessionModel: (workspaceId: string, sessionId: string, provider: string, modelId: string) =>
    ipcRenderer.invoke(desktopIpc.setSessionModel, workspaceId, sessionId, provider, modelId) as Promise<void>,
  setSessionThinkingLevel: (workspaceId: string, sessionId: string, thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) =>
    ipcRenderer.invoke(desktopIpc.setSessionThinkingLevel, workspaceId, sessionId, thinkingLevel) as Promise<void>,
  setSessionToolAccess: (workspaceId: string, sessionId: string, toolAccess: ToolAccessSelection) =>
    ipcRenderer.invoke(desktopIpc.setSessionToolAccess, workspaceId, sessionId, toolAccess) as Promise<void>,
  loginProvider: (workspaceId: string, providerId: string) =>
    ipcRenderer.invoke(desktopIpc.loginProvider, workspaceId, providerId) as Promise<void>,
  logoutProvider: (workspaceId: string, providerId: string) =>
    ipcRenderer.invoke(desktopIpc.logoutProvider, workspaceId, providerId) as Promise<void>,
  setProviderApiKey: (workspaceId: string, providerId: string, apiKey: string) =>
    ipcRenderer.invoke(desktopIpc.setProviderApiKey, workspaceId, providerId, apiKey) as Promise<void>,
  setEnableSkillCommands: (workspaceId: string, enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setEnableSkillCommands, workspaceId, enabled) as Promise<void>,
  setScopedModelPatterns: (workspaceId: string, patterns: readonly string[]) =>
    ipcRenderer.invoke(desktopIpc.setScopedModelPatterns, workspaceId, patterns) as Promise<void>,
  setSkillEnabled: (workspaceId: string, filePath: string, enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setSkillEnabled, workspaceId, filePath, enabled) as Promise<void>,
  setSkillMode: (workspaceId: string, filePath: string, mode: "auto" | "manual" | "off") =>
    ipcRenderer.invoke(desktopIpc.setSkillMode, workspaceId, filePath, mode) as Promise<void>,
  setActiveSkillProfile: (workspaceId: string, profileId: string) =>
    ipcRenderer.invoke(desktopIpc.setActiveSkillProfile, workspaceId, profileId) as Promise<void>,
  saveSkillProfile: (workspaceId: string, profile: RuntimeSkillProfileRecord) =>
    ipcRenderer.invoke(desktopIpc.saveSkillProfile, workspaceId, profile) as Promise<void>,
  deleteSkillProfile: (workspaceId: string, profileId: string) =>
    ipcRenderer.invoke(desktopIpc.deleteSkillProfile, workspaceId, profileId) as Promise<void>,
  setExtensionEnabled: (workspaceId: string, filePath: string, enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setExtensionEnabled, workspaceId, filePath, enabled) as Promise<void>,
  listAgentDefinitions: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.listAgentDefinitions, workspaceId) as Promise<AgentDefinitionsSnapshot>,
  saveAgentDefinition: (workspaceId: string, input: SaveAgentDefinitionInput) =>
    ipcRenderer.invoke(desktopIpc.saveAgentDefinition, workspaceId, input) as Promise<AgentDefinitionsSnapshot>,
  resetAgentDefinition: (workspaceId: string, input: ResetAgentDefinitionInput) =>
    ipcRenderer.invoke(desktopIpc.resetAgentDefinition, workspaceId, input) as Promise<AgentDefinitionsSnapshot>,
  deleteAgentDefinition: (workspaceId: string, input: DeleteAgentDefinitionInput) =>
    ipcRenderer.invoke(desktopIpc.deleteAgentDefinition, workspaceId, input) as Promise<AgentDefinitionsSnapshot>,
  listSubagentWorkflows: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.listSubagentWorkflows, workspaceId) as Promise<SubagentWorkflowSnapshot>,
  saveSubagentWorkflow: (workspaceId: string, input: SaveSubagentWorkflowInput) =>
    ipcRenderer.invoke(desktopIpc.saveSubagentWorkflow, workspaceId, input) as Promise<SubagentWorkflowSnapshot>,
  deleteSubagentWorkflow: (workspaceId: string, input: DeleteSubagentWorkflowInput) =>
    ipcRenderer.invoke(desktopIpc.deleteSubagentWorkflow, workspaceId, input) as Promise<SubagentWorkflowSnapshot>,
  listSubagentRuns: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.listSubagentRuns, workspaceId) as Promise<readonly SubagentRunRecord[]>,
  runSubagentWorkflow: (workspaceId: string, input: RunSubagentWorkflowInput) =>
    ipcRenderer.invoke(desktopIpc.runSubagentWorkflow, workspaceId, input) as Promise<readonly SubagentRunRecord[]>,
  cancelSubagentRun: (workspaceId: string, runId: string) =>
    ipcRenderer.invoke(desktopIpc.cancelSubagentRun, workspaceId, runId) as Promise<readonly SubagentRunRecord[]>,
  onSubagentRunsChanged: (listener: (workspaceId: string) => void) =>
    subscribeIpc(desktopIpc.subagentRunsChanged, listener),
  respondToHostUiRequest: (workspaceId: string, sessionId: string, response: HostUiResponse) =>
    ipcRenderer.invoke(desktopIpc.respondToHostUiRequest, workspaceId, sessionId, response) as Promise<void>,
  setNotificationPreferences: (preferences: Partial<NotificationPreferences>) =>
    ipcRenderer.invoke(desktopIpc.setNotificationPreferences, preferences) as Promise<void>,
  setDiagnosticReportingPreferences: (preferences: Partial<DiagnosticReportingPreferences>) =>
    ipcRenderer.invoke(desktopIpc.setDiagnosticReportingPreferences, preferences) as Promise<void>,
  setDesktopCustomInstructions: (input: Partial<DesktopAppState["desktopCustomInstructions"]>) =>
    ipcRenderer.invoke(desktopIpc.setDesktopCustomInstructions, input) as Promise<void>,
  setIntegratedTerminalShell: (shellPath: string) =>
    ipcRenderer.invoke(desktopIpc.setIntegratedTerminalShell, shellPath) as Promise<void>,
  ensureTerminalPanel: (workspaceId: string, terminalScopeId: string, size?: Partial<TerminalSize>) =>
    ipcRenderer.invoke(desktopIpc.terminalEnsurePanel, workspaceId, terminalScopeId, size) as Promise<TerminalPanelSnapshot>,
  createTerminalSession: (workspaceId: string, terminalScopeId: string, size?: Partial<TerminalSize>) =>
    ipcRenderer.invoke(desktopIpc.terminalCreateSession, workspaceId, terminalScopeId, size) as Promise<TerminalPanelSnapshot>,
  setActiveTerminalSession: (workspaceId: string, terminalScopeId: string, terminalId: string) =>
    ipcRenderer.invoke(desktopIpc.terminalSetActiveSession, workspaceId, terminalScopeId, terminalId) as Promise<TerminalPanelSnapshot>,
  writeTerminal: (terminalId: string, data: string) =>
    ipcRenderer.invoke(desktopIpc.terminalWrite, terminalId, data) as Promise<void>,
  resizeTerminal: (terminalId: string, size: TerminalSize) =>
    ipcRenderer.invoke(desktopIpc.terminalResize, terminalId, size) as Promise<void>,
  restartTerminalSession: (terminalId: string, size?: Partial<TerminalSize>) =>
    ipcRenderer.invoke(desktopIpc.terminalRestartSession, terminalId, size) as Promise<TerminalPanelSnapshot>,
  closeTerminalSession: (terminalId: string) =>
    ipcRenderer.invoke(desktopIpc.terminalCloseSession, terminalId) as Promise<TerminalPanelSnapshot | null>,
  setTerminalTitle: (terminalId: string, title: string) =>
    ipcRenderer.invoke(desktopIpc.terminalSetTitle, terminalId, title) as Promise<void>,
  setTerminalFocused: (focused: boolean) => {
    ipcRenderer.send(desktopIpc.terminalSetFocused, focused);
    return Promise.resolve();
  },
  onTerminalData: (listener: (event: TerminalDataEvent) => void) =>
    subscribeIpc(desktopIpc.terminalData, listener),
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) =>
    subscribeIpc(desktopIpc.terminalExit, listener),
  onTerminalError: (listener: (event: TerminalErrorEvent) => void) =>
    subscribeIpc(desktopIpc.terminalError, listener),
  getNotificationPermissionStatus: () =>
    ipcRenderer.invoke(desktopIpc.getNotificationPermissionStatus) as Promise<DesktopNotificationPermissionStatus>,
  requestNotificationPermission: () =>
    ipcRenderer.invoke(desktopIpc.requestNotificationPermission) as Promise<DesktopNotificationPermissionStatus>,
  openSystemNotificationSettings: () =>
    ipcRenderer.invoke(desktopIpc.openSystemNotificationSettings) as Promise<void>,
  onNotificationPermissionStatusChanged: (callback: (status: DesktopNotificationPermissionStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopNotificationPermissionStatus) => callback(status);
    ipcRenderer.on(desktopIpc.notificationPermissionStatusChanged, handler);
    return () => {
      ipcRenderer.removeListener(desktopIpc.notificationPermissionStatusChanged, handler);
    };
  },
  getUpdateStatus: () =>
    ipcRenderer.invoke(desktopIpc.updateStatusRequest) as Promise<DesktopUpdateStatus>,
  onUpdateStatusChanged: (listener: (status: DesktopUpdateStatus) => void) =>
    subscribeIpc(desktopIpc.updateStatusChanged, listener),
  checkForUpdates: () =>
    ipcRenderer.invoke(desktopIpc.checkForUpdates) as Promise<DesktopUpdateStatus>,
  installUpdate: () =>
    ipcRenderer.invoke(desktopIpc.installUpdate) as Promise<void>,
  copyText: (text: string) =>
    ipcRenderer.invoke(desktopIpc.copyText, text) as Promise<void>,
  pickComposerAttachments: () => ipcRenderer.invoke(desktopIpc.pickComposerAttachments) as Promise<void>,
  readClipboardImage: () =>
    ipcRenderer.invoke(desktopIpc.readClipboardImage) as Promise<ComposerImageAttachment | null>,
  readSubagentTranscript: (path: string) =>
    ipcRenderer.invoke(desktopIpc.readSubagentTranscript, path) as Promise<SubagentTranscriptPreview>,
  addComposerAttachments: (attachments: readonly ComposerAttachment[]) =>
    ipcRenderer.invoke(desktopIpc.addComposerAttachments, attachments) as Promise<void>,
  removeComposerAttachment: (attachmentId: string) =>
    ipcRenderer.invoke(desktopIpc.removeComposerAttachment, attachmentId) as Promise<void>,
  editQueuedComposerMessage: (messageId: string, currentDraft?: string) =>
    ipcRenderer.invoke(desktopIpc.editQueuedComposerMessage, messageId, currentDraft) as Promise<void>,
  cancelQueuedComposerEdit: () =>
    ipcRenderer.invoke(desktopIpc.cancelQueuedComposerEdit) as Promise<void>,
  removeQueuedComposerMessage: (messageId: string) =>
    ipcRenderer.invoke(desktopIpc.removeQueuedComposerMessage, messageId) as Promise<void>,
  steerQueuedComposerMessage: (messageId: string) =>
    ipcRenderer.invoke(desktopIpc.steerQueuedComposerMessage, messageId) as Promise<void>,
  updateComposerDraft: (target: WorkspaceSessionTarget, composerDraft: string) =>
    ipcRenderer.invoke(desktopIpc.updateComposerDraft, target, composerDraft) as Promise<void>,
  submitComposer: (text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly messageMetadata?: unknown }) =>
    ipcRenderer.invoke(desktopIpc.submitComposer, text, options) as Promise<void>,
  submitComposerToSession: (target: WorkspaceSessionTarget, text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly messageMetadata?: unknown }) =>
    ipcRenderer.invoke(desktopIpc.submitComposerToSession, target, text, options) as Promise<void>,
  getSessionTree: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.getSessionTree, target) as Promise<SessionTreeSnapshot>,
  navigateSessionTree: (target: WorkspaceSessionTarget, targetId: string, options?: NavigateSessionTreeOptions) =>
    ipcRenderer.invoke(desktopIpc.navigateSessionTree, target, targetId, options) as Promise<{
      readonly state: DesktopAppState;
      readonly result: NavigateSessionTreeResult;
    }>,
  listWorkspaceFiles: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.listWorkspaceFiles, workspaceId) as Promise<string[]>,
  getChangedFiles: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.getChangedFiles, workspaceId) as Promise<{ path: string; status: "added" | "modified" | "deleted" | "untracked"; staged: boolean }[]>,
  getCurrentBranch: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.getCurrentBranch, workspaceId) as Promise<string | undefined>,
  getFileDiff: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.getFileDiff, workspaceId, filePath) as Promise<string>,
  stageFile: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.stageFile, workspaceId, filePath) as Promise<void>,
  stageAllFiles: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.stageAllFiles, workspaceId) as Promise<void>,
  commitChanges: (workspaceId: string, message: string) =>
    ipcRenderer.invoke(desktopIpc.commitChanges, workspaceId, message) as Promise<void>,
  pushBranch: (workspaceId: string, options?: { readonly setUpstream?: boolean }) =>
    ipcRenderer.invoke(desktopIpc.pushBranch, workspaceId, options) as Promise<void>,
  createPullRequest: (workspaceId: string, input: { readonly title: string; readonly body: string; readonly base: string }) =>
    ipcRenderer.invoke(desktopIpc.createPullRequest, workspaceId, input) as Promise<{ readonly url?: string }>,
  createReviewSnapshot: (workspaceId: string, options?: CreateReviewSnapshotOptions) =>
    ipcRenderer.invoke(desktopIpc.createReviewSnapshot, workspaceId, options) as Promise<ReviewSnapshot>,
  runReviewAgentPreReview: (workspaceId: string, sessionId: string, snapshot: ReviewSnapshot) =>
    ipcRenderer.invoke(desktopIpc.runReviewAgentPreReview, workspaceId, sessionId, snapshot) as Promise<readonly ReviewDraftComment[]>,
  toggleWindowMaximize: () => ipcRenderer.invoke(desktopIpc.toggleWindowMaximize) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke(desktopIpc.openExternal, url) as Promise<void>,
  getThemeMode: () => ipcRenderer.invoke(desktopIpc.getThemeMode) as Promise<"system" | "light" | "dark">,
  getResolvedTheme: () => ipcRenderer.invoke(desktopIpc.getResolvedTheme) as Promise<"light" | "dark">,
  setThemeMode: (mode: "system" | "light" | "dark") =>
    ipcRenderer.invoke(desktopIpc.setThemeMode, mode) as Promise<string>,
  onThemeChanged: (callback: (theme: "light" | "dark") => void) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: "light" | "dark") => callback(theme);
    ipcRenderer.on(desktopIpc.themeChanged, handler);
    return () => {
      ipcRenderer.removeListener(desktopIpc.themeChanged, handler);
    };
  },
});
