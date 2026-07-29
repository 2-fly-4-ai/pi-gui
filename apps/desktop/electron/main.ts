import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session as electronSession,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type Session,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, readFileSync } from "node:fs";
import { copyFile, mkdir, open as openFile, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopAppStore } from "./app-store";
import { getChangedFiles, getFileDiff, stageFile } from "./app-store-diff";
import { commitChanges, createPullRequest, currentBranch, pushBranch, stageAllFiles } from "./git-actions";
import { deleteAgentDefinition, listAgentDefinitions, resetAgentDefinition, saveAgentDefinition } from "./agent-definitions";
import {
  deleteSubagentWorkflow,
  listSubagentWorkflows,
  resolveSubagentWorkflow,
  saveSubagentWorkflow,
} from "./subagent-workflow-definitions";
import { buildAgentPreReviewPrompt, parseAgentPreReviewComments } from "./review/agent-pre-review";
import { SubagentRunStore } from "./subagent-runs";
import { SubagentAuditAdapter } from "./subagent-audit-adapter";
import { createReviewSnapshot } from "./review/review-snapshot";
import type { DeleteAgentDefinitionInput, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "../src/agent-definitions";
import type { CreateReviewSnapshotOptions, ReviewSnapshot } from "../src/review/review-types";
import type {
  DeleteSubagentWorkflowInput,
  RunSubagentWorkflowInput,
  SaveSubagentWorkflowInput,
} from "../src/subagent-workflows";
import { dryRunSubagentWorkflow, roleFromDryRunWorkflowId } from "../src/subagent-workflows";
import { listWorkspaceFiles } from "./app-store-files";
import { ensureVSCodeServer, killAllVSCodeServers, killVSCodeServer } from "./vscode-server-manager";
import { MAIN_DEV_RELOAD_MARKER } from "./dev-reload-main-probe";
import { NotificationManager } from "./notification-manager";
import {
  NotificationPermissionService,
} from "./notification-permission";
import {
  checkForUpdate,
  getUpdateStatus,
  initUpdateChecker,
  installDownloadedUpdate,
  onUpdateStatusChanged,
  setUpdateStatusForTest,
} from "./update-checker";
import { ThemeManager } from "./theme-manager";
import { TerminalService } from "./terminal-service";
import { startMemoryMonitor } from "./memory-monitor";
import { appendAgentActivity, listObservabilityEvents } from "./observability-service";
import {
  attachWindowDiagnostics,
  configureDesktopDiagnostics,
  isNativeCrashReporterStarted,
  logIgnoredError,
  registerProcessDiagnostics,
  reportRendererDiagnostic,
  startNativeCrashReporter,
} from "./diagnostics";
import type {
  AppView,
  DesktopAppState,
  DesktopCustomInstructionsRecord,
  DiagnosticReportingPreferences,
  ModelSettingsScopeMode,
  NotificationPreferences,
  ThemeMode,
} from "../src/desktop-state";
import {
  desktopIpc,
  getDesktopCommandFromShortcut,
  type DesktopUpdateStatus,
  type RecordProjectActionEvidenceInput,
  type StatePatchEvent,
  type SubagentTranscriptPreview,
  type TerminalSize,
  type TranscriptResetRequest,
  type TranscriptSyncEvent,
} from "../src/ipc";
import { buildDesktopStatePatchEvents } from "../src/state/state-patch-domains";
import { SUPPORTED_COMPOSER_IMAGE_TYPES } from "../src/composer-attachments";
import type {
  ComposerAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  RemoveWorktreeInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { HostUiResponse, ToolAccessSelection } from "@pi-gui/session-driver";
import type { RuntimeSettingsSnapshot, RuntimeSkillProfileRecord } from "@pi-gui/session-driver/runtime-types";
import type { NavigateSessionTreeOptions } from "@pi-gui/session-driver/types";
import type { GenerateThreadTitleOptions } from "@pi-gui/pi-sdk-driver";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import type { ObservabilityQuery } from "../src/observability-types";
import {
  TASK_EVIDENCE_SCHEMA_VERSION,
  type TaskEvidenceQuery,
} from "../src/product-experience/task-evidence";
import { TaskEvidenceLedger } from "./task-evidence-ledger";
import {
  classifyObservedCommand,
  extractTestIdentifiers,
  TaskEvidenceSessionObserver,
} from "./task-evidence-session-observer";
import { CheckpointStore } from "./checkpoint-store";
import { CheckpointSessionObserver } from "./checkpoint-session-observer";
import type {
  CheckpointRestoreRequest,
  CheckpointRetentionInput,
} from "../src/product-experience/checkpoint-contract";
import type { ContextManifest } from "../src/product-experience/context-manifest";
import type { RejectCheckpointHunksRequest } from "../src/product-experience/hunk-restoration";
import { ContextManifestStore } from "./context-manifest-store";
import {
  validateExecutionBoundaryPrompt,
  type ExecutionBoundaryInput,
} from "../src/product-experience/execution-boundary";
import { ExecutionBoundaryStore } from "./execution-boundary-store";
import {
  commandOriginLabel,
  redactCommandEnvironment,
  type CommandOrigin,
  type CommandRisk,
} from "../src/product-experience/command-preview";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const windowTestMode = resolveWindowTestMode();
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
let store: DesktopAppStore;
const themeManager = new ThemeManager();
let mainWindow: BrowserWindow | null = null;
let notificationManager: NotificationManager | undefined;
let notificationPermissionService: NotificationPermissionService | undefined;
let terminalService: TerminalService | undefined;
let subagentRunsStore: SubagentRunStore | undefined;
let subagentAuditAdapter: SubagentAuditAdapter | undefined;
let taskEvidenceLedger: TaskEvidenceLedger | undefined;
let taskEvidenceObserver: TaskEvidenceSessionObserver | undefined;
let checkpointStore: CheckpointStore | undefined;
let checkpointObserver: CheckpointSessionObserver | undefined;
let contextManifestStore: ContextManifestStore | undefined;
let executionBoundaryStore: ExecutionBoundaryStore | undefined;
let integratedTerminalShell = "";
let stopPublishingStatePatches: (() => void) | undefined;
let stopPublishingTranscriptEvents: (() => void) | undefined;
let stopPublishingDisplayModeProjectionEvents: (() => void) | undefined;
let stopTrackingWindowActivation: (() => void) | undefined;
let stopNotifications: (() => void) | undefined;
let stopUpdateChecker: (() => void) | undefined;
let stopUpdateStatusEvents: (() => void) | undefined;
let stopPruningTerminals: (() => void) | undefined;
let stopMemoryMonitor: (() => void) | undefined;
let retainedTerminalWorkspacePathSignature = "";
let nextRuntimeRefreshError: string | undefined;
const terminalFocusedWebContentsIds = new Set<number>();
let quittingAfterStoreFlush = false;

const SUPPORTED_IMAGE_TYPES = SUPPORTED_COMPOSER_IMAGE_TYPES;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_TYPES.map((type) => type.mimeType));
const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";
const CHECK_FOR_UPDATES_MENU_ITEM_ID = "app.check-for-updates";
const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_DIMENSION = 8_192;
const MAX_SUBAGENT_TRANSCRIPT_PREVIEW_BYTES = 256 * 1024;
const SIDE_BROWSER_PARTITION = "persist:pi-side-browser";

function getTerminalService(): TerminalService {
  if (!terminalService) {
    terminalService = new TerminalService({
      getWorkspacePath: (workspaceId) => store.getWorkspacePath(workspaceId),
      getIntegratedTerminalShell: () => integratedTerminalShell,
      isPackaged: app.isPackaged,
    });
  }
  return terminalService;
}

// Resolve the bundled application icon. In dev the repo's `resources/icon.png`
// sits two levels up from the compiled `out/main/main.js`; in a packaged build
// it is copied to `process.resourcesPath` via `extraResources` in
// electron-builder.yml. On macOS packaged builds the window/dock icon already
// comes from `icon.icns` in the app bundle, so we only need the PNG for dev
// and for Linux/Windows window chrome.
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "..", "..", "resources", "icon.png");
const appIcon = nativeImage.createFromPath(appIconPath);

function readClipboardImageAttachment(): ComposerImageAttachment | null {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const size = image.getSize();
  if (size.width > MAX_CLIPBOARD_IMAGE_DIMENSION || size.height > MAX_CLIPBOARD_IMAGE_DIMENSION) {
    return null;
  }

  const png = image.toPNG();
  if (png.length === 0 || png.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    return null;
  }

  return {
    id: randomUUID(),
    kind: "image",
    name: "pasted-image.png",
    mimeType: "image/png",
    data: png.toString("base64"),
  };
}

async function readSubagentTranscriptPreview(rawPath: string): Promise<SubagentTranscriptPreview> {
  const transcriptPath = validateSubagentTranscriptPath(rawPath);
  const fileStats = await stat(transcriptPath);
  if (!fileStats.isFile()) {
    throw new Error("Subagent transcript path is not a file.");
  }

  const bytesToRead = Math.min(fileStats.size, MAX_SUBAGENT_TRANSCRIPT_PREVIEW_BYTES);
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await openFile(transcriptPath, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      path: transcriptPath,
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      sizeBytes: fileStats.size,
      truncated: fileStats.size > bytesRead,
    };
  } finally {
    await handle.close();
  }
}

function validateSubagentTranscriptPath(rawPath: string): string {
  if (typeof rawPath !== "string" || rawPath.includes("\0")) {
    throw new Error("Invalid subagent transcript path.");
  }
  const transcriptPath = path.resolve(rawPath);
  if (!path.isAbsolute(rawPath) || transcriptPath !== rawPath) {
    throw new Error("Subagent transcript path must be absolute and normalized.");
  }
  if (!/\.(?:output|jsonl)$/i.test(path.basename(transcriptPath))) {
    throw new Error("Subagent transcript must be an .output or .jsonl file.");
  }
  return transcriptPath;
}

function isHttpOrHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function openExternalIfAllowed(rawUrl: string): Promise<void> {
  if (!isHttpOrHttpsUrl(rawUrl)) {
    throw new Error(`Refusing to open unsupported URL: ${rawUrl}`);
  }
  return shell.openExternal(rawUrl);
}

function installWindowOpenPolicy(contents: WebContents): void {
  contents.setWindowOpenHandler((details) => {
    if (isHttpOrHttpsUrl(details.url)) {
      void openExternalIfAllowed(details.url);
    }
    return { action: "deny" };
  });
}

function isAllowedMainWindowNavigation(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (isDev) {
      const devServer = new URL(process.env.ELECTRON_RENDERER_URL as string);
      return parsed.origin === devServer.origin;
    }

    if (parsed.protocol !== "file:") {
      return false;
    }

    const rendererRootUrl = pathToFileURL(path.join(__dirname, "..", "renderer")).toString();
    return parsed.href.startsWith(rendererRootUrl);
  } catch {
    return false;
  }
}

function installMainWindowSecurityPolicies(window: BrowserWindow): void {
  installWindowOpenPolicy(window.webContents);

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedMainWindowNavigation(url)) {
      return;
    }
    event.preventDefault();
    console.warn(`Blocked main-window navigation to ${url}`);
  });

  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    const guardedWebPreferences = webPreferences as typeof webPreferences & { preloadURL?: string };
    delete guardedWebPreferences.preload;
    delete guardedWebPreferences.preloadURL;
    guardedWebPreferences.nodeIntegration = false;
    guardedWebPreferences.contextIsolation = true;
    guardedWebPreferences.sandbox = true;

    const initialUrl = typeof params.src === "string" ? params.src : "";
    if (!isHttpOrHttpsUrl(initialUrl)) {
      event.preventDefault();
      console.warn(`Blocked webview attachment for unsupported URL: ${initialUrl || "(empty)"}`);
    }
  });

  window.webContents.on("did-attach-webview", (_event, webContents) => {
    installWindowOpenPolicy(webContents);
  });
}

function installPermissionHandler(): void {
  const allowPermission = (contents: WebContents, permission: string, requestingUrl?: string): boolean => {
    if (permission === "notifications") {
      return mainWindow !== null && contents.id === mainWindow.webContents.id;
    }

    if (permission === "clipboard-read" || permission === "clipboard-sanitized-write") {
      return requestingUrl !== undefined && isLocalHttpUrl(requestingUrl);
    }

    return false;
  };

  const install = (targetSession: Session) => {
    targetSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(allowPermission(contents, permission, details.requestingUrl));
    });
  };

  install(electronSession.defaultSession);
  install(electronSession.fromPartition(SIDE_BROWSER_PARTITION));
}

function assertMainFrameIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const window = mainWindow;
  if (
    !window
    || window.isDestroyed()
    || event.sender.id !== window.webContents.id
    || event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error(`Rejected IPC from non-main-frame sender on ${event.processId}:${event.frameId}`);
  }
}

function handleMainFrameIpc<T extends readonly unknown[]>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertMainFrameIpcSender(event);
    return listener(event, ...(args as unknown as T));
  });
}

function onMainFrameIpc<T extends readonly unknown[]>(
  channel: string,
  listener: (event: IpcMainEvent, ...args: T) => void,
): void {
  ipcMain.on(channel, (event, ...args) => {
    assertMainFrameIpcSender(event);
    listener(event, ...(args as unknown as T));
  });
}

function appendRendererTestModeParam(rawUrl: string): string {
  if (!process.env.PI_APP_TEST_MODE) {
    return rawUrl;
  }
  const url = new URL(rawUrl);
  url.searchParams.set("pi-app-test-mode", "1");
  return url.toString();
}

function readNativeCrashReportsOptIn(userDataDir: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(path.join(userDataDir, "ui-state.json"), "utf8")) as Record<string, unknown>;
    const diagnosticReporting = raw.diagnosticReporting;
    return Boolean(
      diagnosticReporting
        && typeof diagnosticReporting === "object"
        && (diagnosticReporting as Record<string, unknown>).nativeCrashReportsEnabled === true,
    );
  } catch {
    return false;
  }
}

function createWindow(): BrowserWindow {
  const backgroundTestMode = windowTestMode === "background";
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#f3f4f8",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      // Keep hidden test windows responsive so Playwright exercises the same UI flows.
      backgroundThrottling: !backgroundTestMode,
    },
  });

  attachWindowDiagnostics(window);
  installMainWindowSecurityPolicies(window);

  window.once("ready-to-show", () => {
    if (!backgroundTestMode) {
      window.show();
    }
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const lowerKey = input.key.toLowerCase();
    const platformModifier = process.platform === "darwin" ? input.meta : input.control;
    const terminalFocused = terminalFocusedWebContentsIds.has(window.webContents.id);
    if (terminalFocused) {
      return;
    }
    if (platformModifier && !input.shift && lowerKey === "o") {
      event.preventDefault();
      void pickWorkspaceViaDialog();
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "v") {
      const clipboardImage = readClipboardImageAttachment();
      if (clipboardImage) {
        event.preventDefault();
        window.webContents.send(desktopIpc.clipboardImagePasted, clipboardImage);
        return;
      }
    }

    const command = getDesktopCommandFromShortcut({
      modifier: process.platform === "darwin" ? input.meta : input.control,
      shift: input.shift,
      key: input.key,
      code: input.code,
    });
    if (command) {
      event.preventDefault();
      window.webContents.send(desktopIpc.appCommand, command);
    }
  });

  if (isDev) {
    void window.loadURL(appendRendererTestModeParam(process.env.ELECTRON_RENDERER_URL as string));
    if (process.env.PI_APP_OPEN_DEVTOOLS !== "0") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const indexPath = path.join(__dirname, "..", "renderer", "index.html");
    void window.loadURL(appendRendererTestModeParam(pathToFileURL(indexPath).toString()));
  }

  return window;
}

function attachStatePublisher(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  stopPublishingStatePatches?.();
  stopPublishingTranscriptEvents?.();
  stopPublishingDisplayModeProjectionEvents?.();

  const statePatchPublisher = createImmediateIpcPublisher<StatePatchEvent>(
    window,
    desktopIpc.statePatchChanged,
    (_payload, bytes) => store.recordIpcPublish("state-patch-changed", bytes),
  );
  let previousPatchState: DesktopAppState | null = null;

  const unsubscribeState = store.subscribe((state) => {
    for (const event of buildDesktopStatePatchEvents(previousPatchState, state)) {
      statePatchPublisher.publish(event);
    }
    previousPatchState = state;
  });
  const transcriptEventPublisher = createImmediateIpcPublisher<TranscriptSyncEvent>(
    window,
    desktopIpc.transcriptEvent,
    (_payload, bytes) => store.recordIpcPublish("transcript-event", bytes),
  );
  const unsubscribeTranscriptEvents = store.subscribeToTranscriptEvents((event) => {
    transcriptEventPublisher.publish(event);
  });
  const unsubscribeDisplayModeProjectionEvents = store.subscribeToDisplayModeProjectionEvents((event) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.displayModeProjectionChanged, event);
    }
  });

  stopPublishingStatePatches = () => {
    unsubscribeState();
  };
  stopPublishingTranscriptEvents = () => {
    unsubscribeTranscriptEvents();
  };
  stopPublishingDisplayModeProjectionEvents = () => {
    unsubscribeDisplayModeProjectionEvents();
  };

  const stopPublishers = () => {
    stopPublishingStatePatches?.();
    stopPublishingStatePatches = undefined;
    stopPublishingTranscriptEvents?.();
    stopPublishingTranscriptEvents = undefined;
    stopPublishingDisplayModeProjectionEvents?.();
    stopPublishingDisplayModeProjectionEvents = undefined;
  };

  window.webContents.once("render-process-gone", stopPublishers);
  window.once("closed", () => {
    stopPublishers();
    if (mainWindow === window) {
      mainWindow = null;
    }
    terminalFocusedWebContentsIds.delete(webContentsId);
    terminalService?.dispose();
  });
}

function createImmediateIpcPublisher<T>(
  window: BrowserWindow,
  channel: string,
  onPublish?: (payload: T, bytes: number) => void,
): { publish(payload: T): void } {
  return {
    publish(payload) {
      if (!canPublishToWindow(window)) {
        return;
      }
      onPublish?.(payload, serializedPayloadByteLength(payload));
      window.webContents.send(channel, payload);
    },
  };
}

function serializedPayloadByteLength(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return 0;
  }
}

function attachViewedSessionTracking(window: BrowserWindow): void {
  stopTrackingWindowActivation?.();

  const handleActivation = () => {
    store.handleWindowActivation();
  };
  const clearTracking = () => {
    stopTrackingWindowActivation?.();
    stopTrackingWindowActivation = undefined;
  };

  window.on("focus", handleActivation);
  window.on("show", handleActivation);
  window.on("restore", handleActivation);
  window.once("closed", clearTracking);

  stopTrackingWindowActivation = () => {
    window.off("focus", handleActivation);
    window.off("show", handleActivation);
    window.off("restore", handleActivation);
    window.off("closed", clearTracking);
  };
}

function canPublishToWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed();
}

function resolveWindowTestMode(): "foreground" | "background" {
  return process.env.PI_APP_TEST_MODE?.trim().toLowerCase() === "background" ? "background" : "foreground";
}

async function pickWorkspaceViaDialog(): Promise<void> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const result = window
    ? await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "Open workspace folder",
      })
    : await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Open workspace folder",
      });
  if (result.canceled || result.filePaths.length === 0) {
    return;
  }
  const nextState = await store.addWorkspace(result.filePaths[0] as string);
  if (!nextState.selectedWorkspaceId) {
    return;
  }
  if (nextState.activeView !== "new-thread") {
    await store.setActiveView("new-thread");
  }
  if (window) {
    window.webContents.send(desktopIpc.workspacePicked, nextState.selectedWorkspaceId);
  }
}

async function runManualUpdateCheck(): Promise<void> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const result = await checkForUpdate({ manual: true });

  if (result.status === "update-available") {
    const options: MessageBoxOptions = {
      type: "info",
      title: "pi-gui",
      message: `Version ${result.latestVersion} is available.`,
      detail: `You are currently on version ${result.currentVersion}.`,
      buttons: ["View Release", "OK"],
      defaultId: 0,
      cancelId: 1,
    };
    const response = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    if (response.response === 0) {
      await openExternalIfAllowed(result.releasePageUrl);
    }
    return;
  }

  if (result.status === "homebrew-update-available") {
    const options: MessageBoxOptions = {
      type: "info",
      title: "pi-gui",
      message: `Version ${result.latestVersion} is available through Homebrew.`,
      detail: `Run ${result.command} to update this install.`,
      buttons: ["OK"],
    };
    if (window) {
      await dialog.showMessageBox(window, options);
    } else {
      await dialog.showMessageBox(options);
    }
    return;
  }

  if (result.status === "downloading" || result.status === "ready") {
    return;
  }

  if (result.status === "up-to-date") {
    const options: MessageBoxOptions = {
      type: "info",
      title: "pi-gui",
      message: `You're up to date on version ${result.currentVersion}.`,
      buttons: ["OK"],
    };
    if (window) {
      await dialog.showMessageBox(window, options);
    } else {
      await dialog.showMessageBox(options);
    }
    return;
  }

  const options: MessageBoxOptions = {
    type: "warning",
    title: "pi-gui",
    message: "Could not check for updates right now.",
    detail: result.status === "error" ? result.message : undefined,
    buttons: ["OK"],
  };
  if (window) {
    await dialog.showMessageBox(window, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          id: CHECK_FOR_UPDATES_MENU_ITEM_ID,
          label: "Check for Updates…",
          click: () => {
            void runManualUpdateCheck();
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          id: OPEN_FOLDER_MENU_ITEM_ID,
          label: "Open Folder…",
          accelerator: "Command+O",
          click: () => {
            void pickWorkspaceViaDialog();
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName("pi");

const configuredUserDataDir = process.env.PI_APP_USER_DATA_DIR?.trim() || app.getPath("userData");
app.setPath("userData", configuredUserDataDir);
configureDesktopDiagnostics({ userDataDir: configuredUserDataDir });
if (readNativeCrashReportsOptIn(configuredUserDataDir)) {
  startNativeCrashReporter("persisted-opt-in");
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

void app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  // On macOS, packaged builds already render the dock icon from `icon.icns`
  // in the app bundle. In dev we override the generic Electron dock icon with
  // the real PNG so the running app looks right end-to-end.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }
  registerProcessDiagnostics();
  installPermissionHandler();

  let generateThreadTitleOverride:
    | ((workspace: WorkspaceRef, options: GenerateThreadTitleOptions) => Promise<string | null | undefined>)
    | undefined;
  let deferredThreadTitle:
    | {
        resolve: (title: string | null) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  store = new DesktopAppStore({
    userDataDir: configuredUserDataDir,
    initialWorkspacePaths: resolveInitialWorkspacePaths(),
    getWindow: () => mainWindow,
    listSubagentRunsForDisplayMode: async (workspaceId) => {
      if (!subagentRunsStore) return [];
      return subagentRunsStore.listRunsSnapshot(workspaceId);
    },
    generateThreadTitleOverride: async (workspace, options) => generateThreadTitleOverride?.(workspace, options),
  });
  const publishSubagentRunsChanged = (workspaceId: string, sessionId?: string) => {
    if (sessionId) {
      store.invalidateDisplayModeProjection({ workspaceId, sessionId });
    } else {
      store.invalidateDisplayModeProjectionsForWorkspace(workspaceId);
    }
    if (mainWindow && canPublishToWindow(mainWindow)) {
      mainWindow.webContents.send(desktopIpc.subagentRunsChanged, workspaceId);
    }
  };
  const subagentRuns = new SubagentRunStore(configuredUserDataDir, publishSubagentRunsChanged);
  subagentRunsStore = subagentRuns;
  const evidenceSequences = new Map<string, number>();
  taskEvidenceLedger = new TaskEvidenceLedger(configuredUserDataDir, {
    homePath: app.getPath("home"),
    workspacePath: (workspaceId) => store.getWorkspacePath(workspaceId),
    onRecordsAppended: (workspaceId, records) => {
      if (!mainWindow || !canPublishToWindow(mainWindow)) return;
      const sequence = (evidenceSequences.get(workspaceId) ?? 0) + 1;
      evidenceSequences.set(workspaceId, sequence);
      const sessionRecords = new Map<string, typeof records>();
      for (const record of records) {
        const existing = sessionRecords.get(record.sessionId) ?? [];
        sessionRecords.set(record.sessionId, [...existing, record]);
      }
      for (const [sessionId, appendedRecords] of sessionRecords) {
        mainWindow.webContents.send(desktopIpc.taskEvidenceDelta, {
          workspaceId,
          sessionId,
          sequence,
          records: appendedRecords,
        });
      }
    },
  });
  taskEvidenceObserver = new TaskEvidenceSessionObserver(
    taskEvidenceLedger,
    randomUUID,
    async (event) => {
      const selected = await store.getSelectedTranscript();
      if (
        !selected
        || selected.workspaceId !== event.sessionRef.workspaceId
        || selected.sessionId !== event.sessionRef.sessionId
      ) return undefined;
      const user = [...selected.transcript].reverse().find((entry) => (
        entry.kind === "message" && entry.role === "user" && entry.text.trim()
      ));
      return user && user.kind === "message"
        ? { id: user.id, intent: user.text.replace(/\s+/g, " ").trim().slice(0, 160) }
        : undefined;
    },
  );
  checkpointStore = new CheckpointStore(configuredUserDataDir);
  contextManifestStore = new ContextManifestStore(configuredUserDataDir);
  executionBoundaryStore = new ExecutionBoundaryStore(configuredUserDataDir);
  checkpointObserver = new CheckpointSessionObserver(
    checkpointStore,
    taskEvidenceLedger,
    resolveCheckpointWorkspaceIdentity,
  );
  await store.initialize();
  store.subscribeToSessionEvents(async (event) => {
    await checkpointObserver?.observe(event);
    taskEvidenceObserver?.observe(event);
    const changedTarget = await subagentRuns.applySessionEvent(event);
    if (changedTarget) {
      publishSubagentRunsChanged(changedTarget.workspaceId, changedTarget.sessionId);
    }
    if (event.type === "subagentRunUpdated") {
      await appendAgentActivity({
        event: `subagent_lifecycle_${event.status}`,
        category: "subagent",
        title: `${event.role ?? event.agentName ?? "Subagent"} ${event.status}`,
        workspaceId: event.parentSession.workspaceId,
        sessionId: event.parentSession.sessionId,
        runId: event.subagentRunId,
        subagentId: event.subagentRunId,
        parentToolCallId: event.toolCallId,
        role: event.role ?? event.agentName,
        status: event.status,
        elapsedMs: event.elapsedMs,
        message: event.summary,
        transcriptPath: event.transcriptPath,
      });
      if (
        changedTarget?.workspaceId !== event.parentSession.workspaceId ||
        changedTarget?.sessionId !== event.parentSession.sessionId
      ) {
        publishSubagentRunsChanged(event.parentSession.workspaceId, event.parentSession.sessionId);
      }
    }
  });
  subagentAuditAdapter = new SubagentAuditAdapter({
    onEvent: async (event) => {
      const changedTargets = await subagentRuns.applyAuditEvent(event);
      for (const target of changedTargets) {
        await appendAgentActivity({
          event: `subagent_audit_${event.status}`,
          category: "subagent",
          title: `${event.role ?? "Subagent"} ${event.status}`,
          workspaceId: target.workspaceId,
          sessionId: target.sessionId,
          runId: event.workflowRunId ?? event.agentId ?? event.parentToolCallId,
          subagentId: event.agentId,
          parentToolCallId: event.parentToolCallId,
          role: event.role,
          status: event.status,
          elapsedMs: event.elapsedMs,
          message: event.summary,
        });
        publishSubagentRunsChanged(target.workspaceId, target.sessionId);
      }
    },
  });
  subagentAuditAdapter.start();
  integratedTerminalShell = (await store.getState()).integratedTerminalShell;
  stopPruningTerminals = store.subscribe((state) => {
    integratedTerminalShell = state.integratedTerminalShell;
    const workspacePaths = state.workspaces.map((workspace) => workspace.path);
    const workspacePathSignature = workspacePaths.join("\0");
    if (workspacePathSignature !== retainedTerminalWorkspacePathSignature) {
      retainedTerminalWorkspacePathSignature = workspacePathSignature;
      terminalService?.retainWorkspacePaths(workspacePaths);
    }
  });
  installApplicationMenu();
  if (process.env.PI_APP_TEST_MODE) {
    Object.assign(globalThis, {
      __PI_APP_TEST_HOOKS: {
        emitSessionEvent: (event: SessionDriverEvent) => store.emitTestSessionEvent(event),
        emitTranscriptEvent: (event: TranscriptSyncEvent) => store.emitTestTranscriptEvent(event),
        forceNativeCrash: () => {
          startNativeCrashReporter("test-force-native-crash");
          const crash = (process as NodeJS.Process & { readonly crash?: () => void }).crash;
          if (typeof crash === "function") {
            crash.call(process);
          }
          process.abort();
        },
        flushPersistence: () => store.flushPersistence(),
        activateWindow: () => store.handleWindowActivation(),
        getDiagnostics: () => store.getDiagnostics(),
        seedDisplayModeScaleFixture: (options?: { readonly count?: number; readonly legacyCount?: number }) =>
          store.seedDisplayModeScaleFixtureForTest(options),
        updateDisplayModeFixtureSession: (
          target: WorkspaceSessionTarget,
          patch: { readonly status?: "idle" | "running" | "failed"; readonly preview?: string },
        ) => store.updateDisplayModeFixtureSessionForTest(target, patch),
        setUpdateStatus: (status: DesktopUpdateStatus) => setUpdateStatusForTest(status),
        failNextRuntimeRefresh: (message = "Runtime discovery failed for test.") => {
          nextRuntimeRefreshError = message;
        },
        setDeferredThreadTitleMode: () => {
          generateThreadTitleOverride = () =>
            new Promise<string | null>((resolve, reject) => {
              deferredThreadTitle = { resolve, reject };
            });
        },
        hasDeferredThreadTitle: () => Boolean(deferredThreadTitle),
        resolveDeferredThreadTitle: (title: string) => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.resolve(title);
        },
        rejectDeferredThreadTitle: () => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.reject(new Error("Deferred thread-title rejected by test"));
        },
      },
    });
  }
  notificationPermissionService = new NotificationPermissionService(() => mainWindow);
  notificationPermissionService.subscribe((status) => {
    if (mainWindow && canPublishToWindow(mainWindow)) {
      mainWindow.webContents.send(desktopIpc.notificationPermissionStatusChanged, status);
    }
  });
  notificationManager = new NotificationManager(store, () => mainWindow, notificationPermissionService);
  stopNotifications = notificationManager.start();
  stopUpdateStatusEvents = onUpdateStatusChanged((status) => {
    if (mainWindow && canPublishToWindow(mainWindow)) {
      mainWindow.webContents.send(desktopIpc.updateStatusChanged, status);
    }
  });
  if (!isDev) {
    stopUpdateChecker = initUpdateChecker();
  }

  onMainFrameIpc(desktopIpc.rendererDiagnostic, reportRendererDiagnostic);
  handleMainFrameIpc(desktopIpc.ping, () =>
    devReloadMarkersEnabled ? `pi desktop ready:${MAIN_DEV_RELOAD_MARKER}` : "pi desktop ready",
  );
  handleMainFrameIpc(desktopIpc.getThemeMode, () => themeManager.getMode());
  handleMainFrameIpc(desktopIpc.getResolvedTheme, () => themeManager.getResolvedTheme());
  handleMainFrameIpc(desktopIpc.setThemeMode, (_event, mode: ThemeMode) => {
    themeManager.setMode(mode);
    return mode;
  });
  handleMainFrameIpc(desktopIpc.openExternal, (_event, url: string) => openExternalIfAllowed(url));
  handleMainFrameIpc(desktopIpc.stateRequest, () => store.getState());
  handleMainFrameIpc(desktopIpc.selectedTranscriptRequest, () => store.getSelectedTranscript());
  handleMainFrameIpc(desktopIpc.transcriptResetRequest, (_event, input: TranscriptResetRequest) =>
    store.resetSelectedTranscriptForRequest(input),
  );
  handleMainFrameIpc(
    desktopIpc.displayModeProjectionRequest,
    (_event, target: WorkspaceSessionTarget, knownRevision?: number) =>
      store.getDisplayModeThreadProjection(target, knownRevision),
  );
  handleMainFrameIpc(desktopIpc.listObservabilityEvents, async (_event, input?: ObservabilityQuery) => {
    const state = await store.getState();
    return listObservabilityEvents(input, {
      includeNativeCrashReports: state.diagnosticReporting.nativeCrashReportsEnabled,
    });
  });
  handleMainFrameIpc(desktopIpc.listTaskEvidence, (_event, input: TaskEvidenceQuery) => {
    if (!taskEvidenceLedger) {
      throw new Error("Task evidence is unavailable.");
    }
    return taskEvidenceLedger.query(input);
  });
  handleMainFrameIpc(desktopIpc.recordProjectActionEvidence, async (
    _event,
    input: RecordProjectActionEvidenceInput,
  ) => {
    if (!taskEvidenceLedger) {
      throw new Error("Task evidence is unavailable.");
    }
    const state = await store.getState();
    const workspace = state.workspaces.find((candidate) => candidate.id === input.workspaceId);
    const session = workspace?.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!workspace || !session || !input.actionId.trim() || !input.command.trim()) {
      throw new Error("The project action target is no longer available.");
    }
    const classification = classifyObservedCommand(input.command);
    await taskEvidenceLedger.append({
      schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
      id: randomUUID(),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      timestamp: new Date().toISOString(),
      kind: classification.kind,
      source: "desktop",
      authority: "desktop-observed",
      status: "unknown",
      summary: `Project action sent to terminal: ${input.actionName.trim() || "Unnamed action"}`,
      correlation: { commandId: input.actionId },
      verification: {
        scope: classification.scope ?? "package",
        command: input.command,
        cwd: workspace.path,
        ...(classification.kind === "test" ? {
          testIdentifiers: extractTestIdentifiers(input.command),
        } : {}),
      },
      activity: {
        type: classification.kind === "test" ? "running-tests" : "running-command",
      },
    });
  });
  handleMainFrameIpc(desktopIpc.listCheckpoints, async (_event, workspaceId: string) => {
    if (!checkpointStore || !(await resolveCheckpointWorkspaceIdentity(workspaceId))) {
      throw new Error("Checkpoint workspace is unavailable.");
    }
    return checkpointStore.list(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.previewCheckpointRestore, async (
    _event,
    checkpointId: string,
    workspaceId: string,
  ) => {
    if (!checkpointStore) throw new Error("Checkpoints are unavailable.");
    const workspace = await resolveCheckpointWorkspaceIdentity(workspaceId);
    if (!workspace) throw new Error("Checkpoint workspace is unavailable.");
    return checkpointStore.preview(checkpointId, workspace);
  });
  handleMainFrameIpc(desktopIpc.restoreCheckpoint, async (
    _event,
    input: CheckpointRestoreRequest,
  ) => {
    if (!checkpointStore) throw new Error("Checkpoints are unavailable.");
    const workspace = await resolveCheckpointWorkspaceIdentity(input.workspaceId);
    if (!workspace) throw new Error("Checkpoint workspace is unavailable.");
    return checkpointStore.restore({
      checkpointId: input.checkpointId,
      workspace,
      selectedPaths: input.selectedPaths,
      ...(input.confirmedPaths ? { confirmedPaths: input.confirmedPaths } : {}),
    });
  });
  handleMainFrameIpc(desktopIpc.previewCheckpointHunks, async (
    _event,
    checkpointId: string,
    workspaceId: string,
    path: string,
  ) => {
    if (!checkpointStore) throw new Error("Checkpoints are unavailable.");
    const workspace = await resolveCheckpointWorkspaceIdentity(workspaceId);
    if (!workspace) throw new Error("Checkpoint workspace is unavailable.");
    return checkpointStore.previewHunks(checkpointId, workspace, path);
  });
  handleMainFrameIpc(desktopIpc.rejectCheckpointHunks, async (
    _event,
    input: RejectCheckpointHunksRequest,
  ) => {
    if (!checkpointStore) throw new Error("Checkpoints are unavailable.");
    const workspace = await resolveCheckpointWorkspaceIdentity(input.workspaceId);
    if (!workspace) throw new Error("Checkpoint workspace is unavailable.");
    return checkpointStore.rejectHunks({
      checkpointId: input.checkpointId,
      workspace,
      path: input.path,
      hunkIds: input.hunkIds,
    });
  });
  handleMainFrameIpc(desktopIpc.getCheckpointRetention, () => {
    if (!checkpointStore) throw new Error("Checkpoints are unavailable.");
    return checkpointStore.getRetentionPolicy();
  });
  handleMainFrameIpc(desktopIpc.setCheckpointRetention, (
    _event,
    input: CheckpointRetentionInput,
  ) => {
    if (!checkpointStore) throw new Error("Checkpoints are unavailable.");
    return checkpointStore.setRetentionPolicy(input);
  });
  handleMainFrameIpc(desktopIpc.releaseCheckpointRestorePreview, (
    _event,
    checkpointId: string,
  ) => {
    if (!checkpointStore) throw new Error("Checkpoints are unavailable.");
    return checkpointStore.releaseRestoreLease(checkpointId);
  });
  handleMainFrameIpc(desktopIpc.snapshotContextManifest, async (
    _event,
    manifest: ContextManifest,
  ) => {
    if (!contextManifestStore) throw new Error("Context manifest storage is unavailable.");
    const state = await store.getState();
    const workspace = state.workspaces.find((candidate) => candidate.id === manifest.workspaceId);
    const session = manifest.sessionId
      ? workspace?.sessions.find((candidate) => candidate.id === manifest.sessionId)
      : undefined;
    if (!workspace || (manifest.sessionId && !session)) {
      throw new Error("Context manifest target is unavailable.");
    }
    return contextManifestStore.snapshot(manifest);
  });
  handleMainFrameIpc(desktopIpc.listContextManifests, async (
    _event,
    workspaceId: string,
    sessionId?: string,
  ) => {
    if (!contextManifestStore || !(await resolveCheckpointWorkspaceIdentity(workspaceId))) {
      throw new Error("Context manifest workspace is unavailable.");
    }
    return contextManifestStore.list(workspaceId, sessionId);
  });
  handleMainFrameIpc(desktopIpc.getExecutionBoundary, async (
    _event,
    workspaceId: string,
    sessionId: string,
  ) => {
    assertSessionTargetAvailable(workspaceId, sessionId);
    if (!executionBoundaryStore) throw new Error("Execution boundaries are unavailable.");
    return executionBoundaryStore.get(workspaceId, sessionId);
  });
  handleMainFrameIpc(desktopIpc.setExecutionBoundary, async (
    _event,
    workspaceId: string,
    sessionId: string,
    input: ExecutionBoundaryInput,
  ) => {
    assertSessionTargetAvailable(workspaceId, sessionId);
    if (!executionBoundaryStore) throw new Error("Execution boundaries are unavailable.");
    const boundary = await executionBoundaryStore.set(workspaceId, sessionId, input);
    await store.setSessionToolAccess(
      { workspaceId, sessionId },
      boundary.enabled ? boundary.toolAccess : { mode: "full", tools: [] },
    );
    await taskEvidenceLedger?.append({
      schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
      id: randomUUID(),
      workspaceId,
      sessionId,
      timestamp: new Date().toISOString(),
      kind: "decision",
      source: "user",
      authority: "user-declared",
      status: "passed",
      summary: boundary.enabled
        ? `Execution boundary updated (revision ${boundary.revision})`
        : `Execution boundary disabled (revision ${boundary.revision})`,
      decision: {
        decisionId: `execution-boundary:${boundary.revision}`,
        state: boundary.enabled ? "active" : "withdrawn",
        scope: "thread",
      },
    });
    return boundary;
  });
  handleMainFrameIpc(desktopIpc.preflightExecutionBoundary, async (
    _event,
    workspaceId: string,
    sessionId: string,
    prompt: string,
  ) => {
    assertSessionTargetAvailable(workspaceId, sessionId);
    if (!executionBoundaryStore) throw new Error("Execution boundaries are unavailable.");
    return validateExecutionBoundaryPrompt(
      await executionBoundaryStore.get(workspaceId, sessionId),
      typeof prompt === "string" ? prompt.slice(0, 200_000) : "",
    );
  });
  handleMainFrameIpc(desktopIpc.recordExecutionBoundaryException, async (
    _event,
    workspaceId: string,
    sessionId: string,
    violationIds: readonly string[],
  ) => {
    assertSessionTargetAvailable(workspaceId, sessionId);
    const ids = [...new Set(violationIds.filter((value) => typeof value === "string" && value.trim()))].slice(0, 50);
    if (ids.length === 0 || !taskEvidenceLedger) return;
    await taskEvidenceLedger.append({
      schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
      id: randomUUID(),
      workspaceId,
      sessionId,
      timestamp: new Date().toISOString(),
      kind: "approval",
      source: "user",
      authority: "user-declared",
      status: "passed",
      summary: `Approved one-time execution boundary exception for ${ids.length} predicted limit${ids.length === 1 ? "" : "s"}`,
      approval: {
        requestId: randomUUID(),
        requestKind: "boundary",
        decision: "approved",
        risk: "significant",
      },
    });
  });
  handleMainFrameIpc(desktopIpc.recordCommandPreviewDecision, async (
    _event,
    input: {
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly previewId: string;
      readonly origin: CommandOrigin;
      readonly risk: CommandRisk;
      readonly decision: "approved" | "denied";
      readonly command: string;
      readonly cwd: string;
    },
  ) => {
    assertSessionTargetAvailable(input.workspaceId, input.sessionId);
    if (!taskEvidenceLedger || !input.previewId.trim() || !input.command.trim()) return;
    const workspacePath = store.getWorkspacePath(input.workspaceId);
    if (!workspacePath || path.resolve(input.cwd) !== path.resolve(workspacePath)) {
      throw new Error("Command preview working directory does not match the selected checkout.");
    }
    await taskEvidenceLedger.append({
      schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
      id: randomUUID(),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      timestamp: new Date().toISOString(),
      kind: "approval",
      source: "user",
      authority: "user-declared",
      status: input.decision === "approved" ? "passed" : "cancelled",
      summary: `${commandOriginLabel(input.origin)} ${input.decision}: ${input.risk} command`,
      correlation: { commandId: input.previewId },
      approval: {
        requestId: input.previewId,
        requestKind: "permission",
        decision: input.decision,
        risk: input.risk === "routine" ? "routine" : input.risk === "destructive" ? "destructive" : "significant",
      },
      verification: {
        scope: "package",
        command: redactCommandEnvironment(input.command),
        cwd: input.cwd,
      },
    });
  });
  handleMainFrameIpc(desktopIpc.addWorkspacePath, async (_event, workspacePath: string) => {
    await store.addWorkspace(workspacePath);
  });
  handleMainFrameIpc(desktopIpc.pickWorkspace, async () => {
    await pickWorkspaceViaDialog();
  });
  handleMainFrameIpc(desktopIpc.selectWorkspace, async (_event, workspaceId: string) => {
    await store.selectWorkspace(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.renameWorkspace, async (_event, workspaceId: string, displayName: string) => {
    await store.renameWorkspace(workspaceId, displayName);
  });
  handleMainFrameIpc(desktopIpc.removeWorkspace, async (_event, workspaceId: string) => {
    await store.removeWorkspace(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.reorderWorkspaces, async (_event, order: readonly string[]) => {
    await store.reorderWorkspaces(order);
  });
  handleMainFrameIpc(desktopIpc.openWorkspaceInFinder, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await shell.openPath(workspacePath);
  });
  handleMainFrameIpc(desktopIpc.openWorkspaceInVSCode, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await shell.openExternal(`vscode://file${workspacePath}`);
  });
  handleMainFrameIpc(desktopIpc.createWorktree, async (_event, input: CreateWorktreeInput) => {
    await store.createWorktree(input);
  });
  handleMainFrameIpc(desktopIpc.removeWorktree, async (_event, input: RemoveWorktreeInput) => {
    await store.removeWorktree(input);
  });
  handleMainFrameIpc(desktopIpc.syncCurrentWorkspace, async () => {
    await store.syncCurrentWorkspace();
  });
  handleMainFrameIpc(desktopIpc.selectSession, async (_event, target: WorkspaceSessionTarget) => {
    await store.selectSession(target);
  });
  handleMainFrameIpc(desktopIpc.renameSession, async (_event, target: WorkspaceSessionTarget, title: string) => {
    await store.renameSession(target, title);
  });
  handleMainFrameIpc(desktopIpc.ensureVSCodeServer, (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    return ensureVSCodeServer(workspaceId, workspacePath);
  });
  handleMainFrameIpc(desktopIpc.killVSCodeServer, (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    killVSCodeServer(workspaceId, workspacePath);
  });
  handleMainFrameIpc(desktopIpc.archiveSession, async (_event, target: WorkspaceSessionTarget) => {
    await store.archiveSession(target);
  });
  handleMainFrameIpc(desktopIpc.unarchiveSession, async (_event, target: WorkspaceSessionTarget) => {
    await store.unarchiveSession(target);
  });
  handleMainFrameIpc(desktopIpc.setActiveView, async (_event, activeView: AppView) => {
    await store.setActiveView(activeView);
  });
  handleMainFrameIpc(desktopIpc.setSidebarCollapsed, async (_event, collapsed: boolean) => {
    await store.setSidebarCollapsed(collapsed);
  });
  handleMainFrameIpc(desktopIpc.setShowThinking, async (_event, showThinking: boolean) => {
    await store.setShowThinking(showThinking);
  });
  handleMainFrameIpc(desktopIpc.setFastMode, async (_event, enabled: boolean) => {
    await store.setFastMode(enabled);
  });
  handleMainFrameIpc(desktopIpc.refreshRuntime, async (_event, workspaceId?: string) => {
    if (nextRuntimeRefreshError) {
      const message = nextRuntimeRefreshError;
      nextRuntimeRefreshError = undefined;
      await store.withError(new Error(message));
      return;
    }
    await store.refreshRuntime(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.setModelSettingsScopeMode, async (_event, mode: ModelSettingsScopeMode) => {
    await store.setModelSettingsScopeMode(mode);
  });
  handleMainFrameIpc(desktopIpc.setSessionModel, async (_event, workspaceId: string, sessionId: string, provider: string, modelId: string) => {
    await store.setSessionModel({ workspaceId, sessionId }, provider, modelId);
  });
  handleMainFrameIpc(desktopIpc.setDefaultModel, async (_event, workspaceId: string, provider: string, modelId: string) => {
    await store.setDefaultModel(workspaceId, provider, modelId);
  });
  handleMainFrameIpc(
    desktopIpc.setDefaultThinkingLevel,
    async (_event, workspaceId: string, thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => {
      await store.setDefaultThinkingLevel(workspaceId, thinkingLevel);
    },
  );
  handleMainFrameIpc(
    desktopIpc.setSessionThinkingLevel,
    async (
      _event,
      workspaceId: string,
      sessionId: string,
      thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
    ) => {
      await store.setSessionThinkingLevel({ workspaceId, sessionId }, thinkingLevel);
    },
  );
  handleMainFrameIpc(
    desktopIpc.setSessionToolAccess,
    async (_event, workspaceId: string, sessionId: string, toolAccess: ToolAccessSelection) => {
      await store.setSessionToolAccess({ workspaceId, sessionId }, toolAccess);
    },
  );
  handleMainFrameIpc(desktopIpc.loginProvider, async (_event, workspaceId: string, providerId: string) => {
    await store.loginProvider(workspaceId, providerId, createRuntimeLoginCallbacks());
  });
  handleMainFrameIpc(desktopIpc.logoutProvider, async (_event, workspaceId: string, providerId: string) => {
    await store.logoutProvider(workspaceId, providerId);
  });
  handleMainFrameIpc(desktopIpc.setProviderApiKey, async (_event, workspaceId: string, providerId: string, apiKey: string) => {
    await store.setProviderApiKey(workspaceId, providerId, apiKey);
  });
  handleMainFrameIpc(desktopIpc.setEnableSkillCommands, async (_event, workspaceId: string, enabled: boolean) => {
    await store.setEnableSkillCommands(workspaceId, enabled);
  });
  handleMainFrameIpc(desktopIpc.setScopedModelPatterns, async (_event, workspaceId: string, patterns: readonly string[]) => {
    await store.setScopedModelPatterns(workspaceId, patterns);
  });
  handleMainFrameIpc(desktopIpc.setSkillEnabled, async (_event, workspaceId: string, filePath: string, enabled: boolean) => {
    await store.setSkillEnabled(workspaceId, filePath, enabled);
  });
  handleMainFrameIpc(desktopIpc.setSkillMode, async (_event, workspaceId: string, filePath: string, mode: "auto" | "manual" | "off") => {
    await store.setSkillMode(workspaceId, filePath, mode);
  });
  handleMainFrameIpc(desktopIpc.setActiveSkillProfile, async (_event, workspaceId: string, profileId: string) => {
    await store.setActiveSkillProfile(workspaceId, profileId);
  });
  handleMainFrameIpc(desktopIpc.saveSkillProfile, async (_event, workspaceId: string, profile: RuntimeSkillProfileRecord) => {
    await store.saveSkillProfile(workspaceId, profile);
  });
  handleMainFrameIpc(desktopIpc.deleteSkillProfile, async (_event, workspaceId: string, profileId: string) => {
    await store.deleteSkillProfile(workspaceId, profileId);
  });
  handleMainFrameIpc(desktopIpc.setExtensionEnabled, async (_event, workspaceId: string, filePath: string, enabled: boolean) => {
    await store.setExtensionEnabled(workspaceId, filePath, enabled);
  });
  handleMainFrameIpc(desktopIpc.respondToHostUiRequest, async (_event, workspaceId: string, sessionId: string, response: HostUiResponse) => {
    await store.respondToHostUiRequest({ workspaceId, sessionId }, response);
    await taskEvidenceLedger?.append({
      schemaVersion: TASK_EVIDENCE_SCHEMA_VERSION,
      id: randomUUID(),
      workspaceId,
      sessionId,
      timestamp: new Date().toISOString(),
      kind: "approval",
      source: "user",
      authority: "user-declared",
      status: "passed",
      summary: "confirmed" in response
        ? `Approval request ${response.confirmed ? "approved once" : "denied"}`
        : "cancelled" in response
          ? "Approval request denied"
          : "Approval request answered",
      approval: {
        requestId: response.requestId,
        requestKind: "confirm",
        decision: "confirmed" in response
          ? response.confirmed ? "approved" : "denied"
          : "cancelled" in response ? "denied" : "approved",
        risk: "routine",
      },
    });
  });
  handleMainFrameIpc(desktopIpc.setNotificationPreferences, async (_event, preferences: Partial<NotificationPreferences>) => {
    await store.setNotificationPreferences(preferences);
  });
  handleMainFrameIpc(desktopIpc.setDiagnosticReportingPreferences, async (_event, preferences: Partial<DiagnosticReportingPreferences>) => {
    await store.setDiagnosticReportingPreferences(preferences);
    if (preferences.nativeCrashReportsEnabled === true) {
      startNativeCrashReporter("settings-opt-in");
    } else if (preferences.nativeCrashReportsEnabled === false && isNativeCrashReporterStarted()) {
      logIgnoredError(
        "diagnostic-reporting.native-crash-reports-disable",
        new Error("Native crash reporter is active until restart after opt-out."),
      );
    }
  });
  handleMainFrameIpc(desktopIpc.setDesktopCustomInstructions, async (_event, input: Partial<DesktopCustomInstructionsRecord>) => {
    await store.setDesktopCustomInstructions(input);
  });
  handleMainFrameIpc(desktopIpc.setIntegratedTerminalShell, async (_event, shellPath: string) => {
    await store.setIntegratedTerminalShell(shellPath);
  });
  handleMainFrameIpc(desktopIpc.terminalEnsurePanel, (event, workspaceId: string, terminalScopeId: string, size?: Partial<TerminalSize>) => {
    return getTerminalService().ensurePanel(event.sender, workspaceId, terminalScopeId, size);
  });
  handleMainFrameIpc(desktopIpc.terminalCreateSession, (event, workspaceId: string, terminalScopeId: string, size?: Partial<TerminalSize>) => {
    return getTerminalService().createSession(event.sender, workspaceId, terminalScopeId, size);
  });
  handleMainFrameIpc(desktopIpc.terminalSetActiveSession, (event, workspaceId: string, terminalScopeId: string, terminalId: string) => {
    return getTerminalService().setActiveSession(event.sender, workspaceId, terminalScopeId, terminalId);
  });
  handleMainFrameIpc(desktopIpc.terminalWrite, (event, terminalId: string, data: string) => {
    terminalService?.write(event.sender, terminalId, data);
  });
  handleMainFrameIpc(desktopIpc.terminalResize, (event, terminalId: string, size: TerminalSize) => {
    terminalService?.resize(event.sender, terminalId, size);
  });
  handleMainFrameIpc(desktopIpc.terminalRestartSession, (event, terminalId: string, size?: Partial<TerminalSize>) => {
    return getTerminalService().restart(event.sender, terminalId, size);
  });
  handleMainFrameIpc(desktopIpc.terminalCloseSession, (event, terminalId: string) => {
    return getTerminalService().close(event.sender, terminalId);
  });
  handleMainFrameIpc(desktopIpc.terminalSetTitle, (event, terminalId: string, title: string) => {
    terminalService?.setTitle(event.sender, terminalId, title);
  });
  onMainFrameIpc(desktopIpc.terminalSetFocused, (event, focused: boolean) => {
    if (focused) {
      terminalFocusedWebContentsIds.add(event.sender.id);
    } else {
      terminalFocusedWebContentsIds.delete(event.sender.id);
    }
  });
  handleMainFrameIpc(desktopIpc.getNotificationPermissionStatus, () =>
    notificationPermissionService?.getCurrentStatus() ?? Promise.resolve("unknown"),
  );
  handleMainFrameIpc(desktopIpc.requestNotificationPermission, () =>
    notificationPermissionService?.requestPermission() ?? Promise.resolve("unknown"),
  );
  handleMainFrameIpc(desktopIpc.openSystemNotificationSettings, () =>
    notificationPermissionService?.openSystemSettings() ?? Promise.resolve(),
  );
  handleMainFrameIpc(desktopIpc.updateStatusRequest, () => getUpdateStatus());
  handleMainFrameIpc(desktopIpc.checkForUpdates, () => checkForUpdate({ manual: true }));
  handleMainFrameIpc(desktopIpc.installUpdate, () => installDownloadedUpdate());
  handleMainFrameIpc(desktopIpc.copyText, (_event, text: string) => {
    clipboard.writeText(text);
  });
  handleMainFrameIpc(desktopIpc.createSession, async (_event, input: CreateSessionInput) => {
    await store.createSession(input);
  });
  handleMainFrameIpc(desktopIpc.startThread, async (_event, input: StartThreadInput) => {
    await store.startThread(input);
  });
  handleMainFrameIpc(desktopIpc.openSkillInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getSkillFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown skill: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  handleMainFrameIpc(desktopIpc.openExtensionInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getExtensionFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown extension: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  handleMainFrameIpc(desktopIpc.cancelCurrentRun, async () => {
    await store.cancelCurrentRun();
  });
  handleMainFrameIpc(desktopIpc.cancelSessionRun, async (_event, target: WorkspaceSessionTarget) => {
    await store.cancelSessionRun(target);
  });
  handleMainFrameIpc(desktopIpc.stopRuntimeJob, async (_event, target: WorkspaceSessionTarget, jobId: string) => {
    await store.stopRuntimeJob(target, jobId);
  });
  handleMainFrameIpc(desktopIpc.refreshRuntimeJobs, async (_event, target: WorkspaceSessionTarget) => {
    await store.refreshRuntimeJobs(target);
  });
  handleMainFrameIpc(desktopIpc.pickComposerAttachments, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "Attach files",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return;
    }
    const attachments = await Promise.all(result.filePaths.map(async (filePath) => {
      try {
        return await readComposerAttachment(filePath);
      } catch (error) {
        return {
          id: randomUUID(),
          kind: "file" as const,
          name: path.basename(filePath),
          mimeType: mimeTypeForPath(filePath),
          fsPath: filePath,
          source: "workspace-reference" as const,
          status: "failed" as const,
          error: error instanceof Error ? error.message : "Attachment processing failed.",
        };
      }
    }));
    await store.addComposerAttachments(attachments);
  });
  handleMainFrameIpc(desktopIpc.readClipboardImage, () => readClipboardImageAttachment());
  handleMainFrameIpc(desktopIpc.readSubagentTranscript, async (_event, transcriptPath: string) =>
    readSubagentTranscriptPreview(transcriptPath),
  );
  handleMainFrameIpc(desktopIpc.addComposerAttachments, async (_event, attachments: readonly ComposerAttachment[]) => {
    const validated = attachments.flatMap(validateComposerAttachmentPayload);
    await store.addComposerAttachments(validated);
  });
  handleMainFrameIpc(desktopIpc.removeComposerAttachment, async (_event, attachmentId: string) => {
    await store.removeComposerAttachment(attachmentId);
  });
  handleMainFrameIpc(desktopIpc.editQueuedComposerMessage, async (_event, messageId: string, currentDraft?: string) => {
    await store.editQueuedComposerMessage(messageId, currentDraft);
  });
  handleMainFrameIpc(desktopIpc.cancelQueuedComposerEdit, async () => {
    await store.cancelQueuedComposerEdit();
  });
  handleMainFrameIpc(desktopIpc.removeQueuedComposerMessage, async (_event, messageId: string) => {
    await store.removeQueuedComposerMessage(messageId);
  });
  handleMainFrameIpc(desktopIpc.steerQueuedComposerMessage, async (_event, messageId: string) => {
    await store.steerQueuedComposerMessage(messageId);
  });
  handleMainFrameIpc(desktopIpc.setQueuedComposerMessageDelivery, async (
    _event,
    messageId: string,
    mode: "steer" | "followUp",
  ) => {
    await store.setQueuedComposerMessageDelivery(messageId, mode);
  });
  handleMainFrameIpc(desktopIpc.moveQueuedComposerMessage, async (
    _event,
    messageId: string,
    direction: "up" | "down",
  ) => {
    await store.moveQueuedComposerMessage(messageId, direction);
  });
  handleMainFrameIpc(desktopIpc.sendNextQueuedComposerMessage, async (_event, messageId: string) => {
    await store.sendNextQueuedComposerMessage(messageId);
  });
  handleMainFrameIpc(
    desktopIpc.updateComposerDraft,
    async (
      _event,
      target: WorkspaceSessionTarget,
      composerDraft: string,
      options?: { readonly syncToEditor?: boolean },
    ) => {
      await store.updateComposerDraft(target, composerDraft, options);
    },
  );
  handleMainFrameIpc(
    desktopIpc.submitComposer,
    async (_event, text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly messageMetadata?: unknown }) => {
      await store.submitComposer(text, options);
    },
  );
  handleMainFrameIpc(
    desktopIpc.submitComposerToSession,
    async (
      _event,
      target: WorkspaceSessionTarget,
      text: string,
      options?: {
        readonly attachments?: readonly ComposerAttachment[];
        readonly deliverAs?: "steer" | "followUp";
        readonly messageMetadata?: unknown;
      },
    ) => {
      const attachments = options?.attachments?.flatMap(validateComposerAttachmentPayload) ?? [];
      const state = await store.submitComposerToSession(target, text, {
        ...options,
        attachments,
      });
      return state.lastError
        ? { accepted: false, error: state.lastError }
        : { accepted: true };
    },
  );
  handleMainFrameIpc(desktopIpc.getSessionComposerState, (_event, target: WorkspaceSessionTarget) =>
    store.getSessionComposerState(target),
  );
  handleMainFrameIpc(
    desktopIpc.setSessionComposerAttachments,
    async (_event, target: WorkspaceSessionTarget, attachments: readonly ComposerAttachment[]) => {
      const validated = attachments.flatMap(validateComposerAttachmentPayload);
      await store.setSessionComposerAttachments(target, validated);
    },
  );
  handleMainFrameIpc(desktopIpc.getSessionTree, (_event, target: WorkspaceSessionTarget) =>
    store.getSessionTree(target),
  );
  handleMainFrameIpc(
    desktopIpc.navigateSessionTree,
    (_event, target: WorkspaceSessionTarget, targetId: string, options?: NavigateSessionTreeOptions) =>
      store.navigateSessionTree(target, targetId, options),
  );
  handleMainFrameIpc(desktopIpc.listWorkspaceFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return listWorkspaceFiles(workspacePath);
  });
  handleMainFrameIpc(desktopIpc.inspectWorkspaceArtifact, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) throw new Error("Workspace is unavailable.");
    const metadata = await stat(resolvePathInsideWorkspace(workspacePath, filePath));
    if (!metadata.isFile()) throw new Error("Artifact is not a file.");
    return {
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    };
  });
  handleMainFrameIpc(desktopIpc.snapshotWorkspaceArtifact, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) throw new Error("Workspace is unavailable.");
    const sourcePath = resolvePathInsideWorkspace(workspacePath, filePath);
    const [realWorkspacePath, realSourcePath] = await Promise.all([realpath(workspacePath), realpath(sourcePath)]);
    if (realSourcePath !== realWorkspacePath && !realSourcePath.startsWith(`${realWorkspacePath}${path.sep}`)) {
      throw new Error("Artifact symlink resolves outside the workspace.");
    }
    const metadata = await stat(realSourcePath);
    if (!metadata.isFile()) throw new Error("Artifact is not a file.");
    const snapshotDir = path.join(app.getPath("userData"), "artifact-snapshots", encodeURIComponent(workspaceId));
    await mkdir(snapshotDir, { recursive: true });
    const safeName = path.basename(realSourcePath).replace(/[^A-Za-z0-9._-]+/g, "-") || "artifact";
    const snapshotPath = path.join(snapshotDir, `${Date.now()}-${randomUUID()}-${safeName}`);
    await copyFile(realSourcePath, snapshotPath, fsConstants.COPYFILE_FICLONE);
    return {
      fsPath: snapshotPath,
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    };
  });
  handleMainFrameIpc(desktopIpc.revealWorkspacePath, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) throw new Error("Workspace is unavailable.");
    const resolved = resolvePathInsideWorkspace(workspacePath, filePath);
    shell.showItemInFolder(resolved);
  });
  handleMainFrameIpc(desktopIpc.saveWorkspaceHandoff, async (_event, workspaceId: string, content: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) throw new Error("Workspace is unavailable.");
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) {
      throw new Error("Handoff content is empty or too large.");
    }
    const handoffDir = resolvePathInsideWorkspace(workspacePath, ".pi-gui/handoffs");
    await mkdir(handoffDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const relativePath = `.pi-gui/handoffs/handoff-${timestamp}.md`;
    await writeFile(resolvePathInsideWorkspace(workspacePath, relativePath), content, { encoding: "utf8", flag: "wx" });
    return relativePath;
  });
  handleMainFrameIpc(desktopIpc.getChangedFiles, async (_event, workspaceId: string) => {
    store.recordDisplayModeChangedFilesRequest();
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return getChangedFiles(workspacePath);
  });
  handleMainFrameIpc(desktopIpc.getCurrentBranch, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return undefined;
    }
    try {
      return await currentBranch(workspacePath);
    } catch {
      return undefined;
    }
  });
  handleMainFrameIpc(desktopIpc.getFileDiff, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return "";
    }
    return getFileDiff(workspacePath, filePath);
  });
  handleMainFrameIpc(desktopIpc.listAgentDefinitions, async (_event, workspaceId: string) => {
    return listAgentDefinitions(store.getWorkspacePath(workspaceId));
  });
  handleMainFrameIpc(desktopIpc.saveAgentDefinition, async (_event, workspaceId: string, input: SaveAgentDefinitionInput) => {
    return saveAgentDefinition(store.getWorkspacePath(workspaceId), input);
  });
  handleMainFrameIpc(desktopIpc.resetAgentDefinition, async (_event, workspaceId: string, input: ResetAgentDefinitionInput) => {
    return resetAgentDefinition(store.getWorkspacePath(workspaceId), input);
  });
  handleMainFrameIpc(desktopIpc.deleteAgentDefinition, async (_event, workspaceId: string, input: DeleteAgentDefinitionInput) => {
    return deleteAgentDefinition(store.getWorkspacePath(workspaceId), input);
  });
  handleMainFrameIpc(desktopIpc.listSubagentWorkflows, async (_event, workspaceId: string) => {
    return listSubagentWorkflows(store.getWorkspacePath(workspaceId));
  });
  handleMainFrameIpc(desktopIpc.saveSubagentWorkflow, async (_event, workspaceId: string, input: SaveSubagentWorkflowInput) => {
    return saveSubagentWorkflow(store.getWorkspacePath(workspaceId), input);
  });
  handleMainFrameIpc(desktopIpc.deleteSubagentWorkflow, async (_event, workspaceId: string, input: DeleteSubagentWorkflowInput) => {
    return deleteSubagentWorkflow(store.getWorkspacePath(workspaceId), input);
  });
  handleMainFrameIpc(desktopIpc.listSubagentRuns, async (_event, workspaceId: string) => {
    await subagentRuns.listRuns(workspaceId, store.getWorkspacePath(workspaceId));
    await subagentAuditAdapter?.replay(async (event) => {
      const changedTargets = await subagentRuns.applyAuditEvent(event);
      for (const target of changedTargets) {
        publishSubagentRunsChanged(target.workspaceId, target.sessionId);
      }
    });
    await subagentRuns.reconcileInterruptedRuns(
      workspaceId,
      (target) => store.sessionFromState(target)?.status === "running",
    );
    return subagentRuns.listRuns(workspaceId, store.getWorkspacePath(workspaceId));
  });
  handleMainFrameIpc(desktopIpc.runSubagentWorkflow, async (_event, workspaceId: string, input: RunSubagentWorkflowInput) => {
    if (input.target.workspaceId !== workspaceId) {
      throw new Error("Subagent workflow target workspace does not match the active settings workspace.");
    }
    const dryRunRole = roleFromDryRunWorkflowId(input.workflowId);
    if (dryRunRole) {
      const definitions = await listAgentDefinitions(store.getWorkspacePath(workspaceId));
      const definition = definitions.agents.find((agent) => agent.name === dryRunRole && agent.config.enabled);
      if (!definition) throw new Error(`Enabled agent role not found: ${dryRunRole}`);
      return subagentRuns.runWorkflow(store, {
        ...input,
        userInstruction: "Perform a read-only definition check. Reply with one short sentence confirming the role is usable. Do not edit files or run shell commands.",
      }, dryRunSubagentWorkflow(dryRunRole));
    }
    const workflow = await resolveSubagentWorkflow(store.getWorkspacePath(workspaceId), input.workflowId);
    return subagentRuns.runWorkflow(store, input, workflow);
  });
  handleMainFrameIpc(desktopIpc.cancelSubagentRun, async (_event, workspaceId: string, runId: string) => {
    return subagentRuns.cancelRun(store, workspaceId, runId);
  });
  handleMainFrameIpc(desktopIpc.stageFile, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await stageFile(workspacePath, filePath);
  });
  handleMainFrameIpc(desktopIpc.stageAllFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await stageAllFiles(workspacePath);
  });
  handleMainFrameIpc(desktopIpc.commitChanges, async (_event, workspaceId: string, message: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await commitChanges(workspacePath, message);
  });
  handleMainFrameIpc(desktopIpc.pushBranch, async (_event, workspaceId: string, options?: { readonly setUpstream?: boolean }) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await pushBranch(workspacePath, options);
  });
  handleMainFrameIpc(desktopIpc.createPullRequest, async (_event, workspaceId: string, input: { readonly title: string; readonly body: string; readonly base: string }) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    return createPullRequest(workspacePath, input);
  });
  handleMainFrameIpc(desktopIpc.createReviewSnapshot, async (_event, workspaceId: string, options?: CreateReviewSnapshotOptions) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    return createReviewSnapshot(workspaceId, workspacePath, options);
  });
  handleMainFrameIpc(desktopIpc.runReviewAgentPreReview, async (_event, workspaceId: string, sessionId: string, snapshot: ReviewSnapshot) => {
    const sessionRef = { workspaceId, sessionId };
    await store.driver.sendUserMessage(sessionRef, { text: buildAgentPreReviewPrompt(snapshot) });
    await store.reloadTranscriptFromDriver(sessionRef);
    const transcript = await store.driver.getTranscript(sessionRef);
    const assistantText = [...transcript].reverse().find((message) => message.kind === "message" && message.role === "assistant")?.text ?? "";
    return parseAgentPreReviewComments(snapshot, assistantText);
  });
  handleMainFrameIpc(desktopIpc.toggleWindowMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });

  mainWindow = createWindow();
  stopMemoryMonitor = startMemoryMonitor({
    userDataDir: configuredUserDataDir,
    getWindow: () => mainWindow,
    getStoreSnapshot: () => store.getMemoryMonitorSnapshot(),
  });
  notificationManager.trackWindow(mainWindow);
  notificationPermissionService.trackWindow(mainWindow);
  themeManager.setWindow(mainWindow);
  attachStatePublisher(mainWindow);
  attachViewedSessionTracking(mainWindow);
  void notificationPermissionService.getCurrentStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      notificationManager?.trackWindow(mainWindow);
      notificationPermissionService?.trackWindow(mainWindow);
      themeManager.setWindow(mainWindow);
      attachStatePublisher(mainWindow);
      attachViewedSessionTracking(mainWindow);
      void notificationPermissionService?.getCurrentStatus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopNotifications?.();
    stopNotifications = undefined;
    notificationManager = undefined;
    notificationPermissionService?.dispose();
    notificationPermissionService = undefined;
    stopUpdateChecker?.();
    stopUpdateChecker = undefined;
    stopUpdateStatusEvents?.();
    stopUpdateStatusEvents = undefined;
    stopPruningTerminals?.();
    stopPruningTerminals = undefined;
    stopMemoryMonitor?.();
    stopMemoryMonitor = undefined;
    subagentRunsStore?.dispose();
    subagentRunsStore = undefined;
    subagentAuditAdapter?.dispose();
    subagentAuditAdapter = undefined;
    terminalService?.dispose();
    terminalService = undefined;
    app.quit();
  }
});

app.on("before-quit", (event) => {
  killAllVSCodeServers();
  stopNotifications?.();
  stopNotifications = undefined;
  notificationManager = undefined;
  notificationPermissionService?.dispose();
  notificationPermissionService = undefined;
  stopUpdateChecker?.();
  stopUpdateChecker = undefined;
  stopUpdateStatusEvents?.();
  stopUpdateStatusEvents = undefined;
  stopPruningTerminals?.();
  stopPruningTerminals = undefined;
  stopMemoryMonitor?.();
  stopMemoryMonitor = undefined;
  subagentRunsStore?.dispose();
  subagentRunsStore = undefined;
  subagentAuditAdapter?.dispose();
  subagentAuditAdapter = undefined;
  checkpointObserver = undefined;
  taskEvidenceObserver = undefined;
  terminalService?.dispose();
  terminalService = undefined;
  if (quittingAfterStoreFlush || !store) {
    return;
  }

  event.preventDefault();
  quittingAfterStoreFlush = true;
  void Promise.all([
    store.flushPersistence(),
    taskEvidenceLedger?.flush() ?? Promise.resolve(),
    executionBoundaryStore?.flush() ?? Promise.resolve(),
    checkpointStore?.flush() ?? Promise.resolve(),
    contextManifestStore?.flush() ?? Promise.resolve(),
  ])
    .catch((error) => logIgnoredError("app.before-quit.flushPersistence", error))
    .finally(() => {
      taskEvidenceLedger = undefined;
      executionBoundaryStore = undefined;
      checkpointStore = undefined;
      contextManifestStore = undefined;
      app.quit();
    });
});

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw !== undefined) {
    return raw
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function resolvePathInsideWorkspace(workspacePath: string, filePath: string): string {
  const root = path.resolve(workspacePath);
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path escapes workspace.");
  }
  return resolved;
}

async function resolveCheckpointWorkspaceIdentity(workspaceId: string) {
  const state = await store.getState();
  const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return undefined;
  const rootWorkspace = state.workspaces.find(
    (candidate) => candidate.id === workspace.rootWorkspaceId,
  );
  return {
    workspaceId,
    rootPath: rootWorkspace?.path ?? workspace.path,
    checkoutPath: workspace.path,
  };
}

function assertSessionTargetAvailable(workspaceId: string, sessionId: string): void {
  if (!store.sessionFromState({ workspaceId, sessionId })) {
    throw new Error("The execution boundary thread is no longer available.");
  }
}

async function readComposerAttachment(filePath: string): Promise<ComposerAttachment> {
  const mimeType = mimeTypeForPath(filePath);
  if (mimeType.startsWith("image/")) {
    return readComposerImageAttachment(filePath, mimeType);
  }

  const stats = await stat(filePath);
  return {
    id: randomUUID(),
    kind: "file",
    name: path.basename(filePath),
    mimeType,
    fsPath: filePath,
    ...(typeof stats.size === "number" ? { sizeBytes: stats.size } : {}),
    source: "workspace-reference",
    status: "ready",
  };
}

async function readComposerImageAttachment(filePath: string, mimeType: string): Promise<ComposerImageAttachment> {
  const buffer = await readFile(filePath);
  return {
    id: randomUUID(),
    kind: "image",
    name: path.basename(filePath),
    mimeType,
    data: buffer.toString("base64"),
    source: "copied",
    status: "ready",
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const supported = SUPPORTED_IMAGE_TYPES.find((type) => type.extension === extension);
  if (supported) {
    return supported.mimeType;
  }
  return "application/octet-stream";
}

function validateComposerAttachmentPayload(attachment: ComposerAttachment): ComposerAttachment[] {
  if (attachment.kind === "image") {
    if (typeof attachment.data !== "string" || typeof attachment.mimeType !== "string" || !SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return [];
    }
    return [
      {
        ...attachment,
        kind: "image",
        source: "copied",
        status: attachment.status === "pending" || attachment.status === "failed"
          ? attachment.status
          : "ready",
      },
    ];
  }

  if (
    attachment.kind !== "file" ||
    typeof attachment.fsPath !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.name !== "string"
  ) {
    return [];
  }

  const normalized: ComposerFileAttachment = {
    ...attachment,
    kind: "file",
    fsPath: attachment.fsPath.trim(),
    name: attachment.name.trim() || path.basename(attachment.fsPath),
    source: "workspace-reference",
    status: attachment.status === "pending" || attachment.status === "missing" || attachment.status === "failed"
      ? attachment.status
      : "ready",
  };
  if (!normalized.fsPath) {
    return [];
  }
  return [normalized];
}

function createRuntimeLoginCallbacks() {
  return {
    onAuth: async ({ url, instructions: _instructions }: { readonly url: string; readonly instructions?: string }) => {
      await shell.openExternal(url);
    },
    onPrompt: async ({ message, placeholder }: { readonly message: string; readonly placeholder?: string }) =>
      promptForText(message, placeholder),
  };
}

async function promptForText(message: string, placeholder = ""): Promise<string> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    throw new Error("Main window is not available for login.");
  }
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(
    `window.prompt(${JSON.stringify(message)}, ${JSON.stringify(placeholder)})`,
    true,
  );
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new Error("Login cancelled.");
  }
  return result.trim();
}
