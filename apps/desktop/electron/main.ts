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
  type ContextMenuParams,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type Session,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, readFileSync } from "node:fs";
import { copyFile, mkdir, open as openFile, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopAppStore } from "./app-store";
import { getChangedFiles, getFileDiff, stageFile } from "./app-store-diff";
import { commitChanges, currentBranch, pushBranch, stageAllFiles } from "./git-actions";
import { SourceControlService } from "./source-control-service";
import { UsageIndexService } from "./usage-index-service";
import { ProjectActionStore } from "./project-action-store";
import { PromptShelfStore } from "./prompt-shelf-store";
import { ThemeGalleryService } from "./theme-gallery-service";
import { LoopbackRemoteService } from "./loopback-remote-service";
import { flushBeforeQuit } from "./quit-persistence";
import { withStartupTimeout } from "./startup-guard";
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
import {
  ensureVSCodeServer,
  killAllVSCodeServers,
  killVSCodeServer,
  listOwnedVSCodeServerRoots,
  reclaimStaleVSCodeServers,
  setEmbeddedVSCodePalette,
} from "./vscode-server-manager";
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
import { startMemoryPressureGuard } from "./memory-pressure-guard";
import { ResourceInspectorService } from "./resource-inspector-service";
import type { ResourceRuntimeRoot } from "../src/resource-inspector-types";
import type { SourceControlMutation } from "../src/source-control-types";
import type { UsageQuery } from "../src/usage-types";
import type { LegacyProjectAction, SaveProjectActionInput } from "../src/project-actions";
import type { StashPromptInput } from "../src/prompt-shelf-types";
import { canStopRuntimeJob } from "../src/runtime-jobs";
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
  type SelectedTranscriptRequestOptions,
  type StatePatchEvent,
  type SubagentTranscriptPreview,
  type TerminalSize,
  type TranscriptResetRequest,
  type TranscriptSyncEvent,
} from "../src/ipc";
import {
  MAX_COMPOSER_IMAGE_BYTES,
  MAX_COMPOSER_IMAGE_DIMENSION,
  SUPPORTED_COMPOSER_IMAGE_TYPES,
  validateComposerAttachmentLimits,
  validateComposerMessageMetadata,
  validateComposerText,
} from "../src/composer-attachments";
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
import type { SessionRef, WorkspaceRef } from "@pi-gui/session-driver";
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

// Stock Electron's pointer-compressed V8 build has an effective old-generation
// ceiling of roughly 4 GiB. Requests above that are silently capped (the
// renderer reports about 3.76 GB through performance.memory), so advertising
// an 8/16 GiB setting would create false confidence. Keep the explicit flag
// within the runtime's real supported range; projection/resource bounds are
// the correctness mechanism.
const requestedRendererHeapMb = Number.parseInt(process.env.PI_APP_RENDERER_HEAP_MB ?? "4096", 10);
const rendererHeapMb = Number.isFinite(requestedRendererHeapMb)
  ? Math.min(4_096, Math.max(2_048, requestedRendererHeapMb))
  : 4_096;
app.commandLine.appendSwitch("js-flags", `--max-old-space-size=${rendererHeapMb}`);

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const windowTestMode = resolveWindowTestMode();
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
interface StartupDiagnostics {
  stage: string;
  stageStartedAt: number;
  stageHistory: Array<{ readonly stage: string; readonly at: number }>;
  hasSingleInstanceLock?: boolean;
}
const startupDiagnostics: StartupDiagnostics = {
  stage: "module-loaded",
  stageStartedAt: Date.now(),
  stageHistory: [{ stage: "module-loaded", at: Date.now() }],
};

function recordStartupStage(stage: string): void {
  const at = Date.now();
  startupDiagnostics.stage = stage;
  startupDiagnostics.stageStartedAt = at;
  startupDiagnostics.stageHistory.push({ stage, at });
  if (startupDiagnostics.stageHistory.length > 24) startupDiagnostics.stageHistory.shift();
}

if (process.env.PI_APP_TEST_MODE) {
  Object.assign(globalThis, { __PI_APP_STARTUP_DIAGNOSTICS: startupDiagnostics });
}
let store: DesktopAppStore;
const recentStartThreadRequests = new Map<string, Promise<void>>();
let activeStartThreadRequest: Promise<void> | undefined;
const START_THREAD_REQUEST_RETENTION_MS = 60_000;

function retainStartThreadRequest(requestId: string, request: Promise<void>): void {
  recentStartThreadRequests.set(requestId, request);
  const retentionTimer = setTimeout(() => {
    if (recentStartThreadRequests.get(requestId) === request) {
      recentStartThreadRequests.delete(requestId);
    }
  }, START_THREAD_REQUEST_RETENTION_MS);
  retentionTimer.unref();
}
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
let stopMemoryPressureGuard: (() => void) | undefined;
let resourceInspectorService: ResourceInspectorService | undefined;
let sourceControlService: SourceControlService | undefined;
let usageIndexService: UsageIndexService | undefined;
let projectActionStore: ProjectActionStore | undefined;
let promptShelfStore: PromptShelfStore | undefined;
let themeGalleryService: ThemeGalleryService | undefined;
let loopbackRemoteService: LoopbackRemoteService | undefined;
let retainedTerminalWorkspacePathSignature = "";
let nextRuntimeRefreshError: string | undefined;
const terminalFocusedWebContentsIds = new Set<number>();
let quittingAfterStoreFlush = false;

const SUPPORTED_IMAGE_TYPES = SUPPORTED_COMPOSER_IMAGE_TYPES;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_TYPES.map((type) => type.mimeType));
const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";
const CHECK_FOR_UPDATES_MENU_ITEM_ID = "app.check-for-updates";
const MAX_CLIPBOARD_IMAGE_BYTES = MAX_COMPOSER_IMAGE_BYTES;
const MAX_CLIPBOARD_IMAGE_DIMENSION = MAX_COMPOSER_IMAGE_DIMENSION;
const MAX_ARTIFACT_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_ARTIFACT_SNAPSHOTS_PER_WORKSPACE = 20;
const MAX_ARTIFACT_SNAPSHOT_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_SUBAGENT_TRANSCRIPT_PREVIEW_BYTES = 256 * 1024;
const SIDE_BROWSER_PARTITION = "persist:pi-side-browser";

async function syncEmbeddedVSCodePalette(themeId?: string): Promise<void> {
  if (!themeGalleryService) return;
  const snapshot = await themeGalleryService.snapshot();
  const targetId = themeId ?? snapshot.selectedThemeId;
  const theme = [...snapshot.builtIns, ...snapshot.installed].find((candidate) => candidate.id === targetId);
  if (!theme) throw new Error("Theme was not found while synchronizing embedded VS Code.");
  // The embedded editor intentionally remains dark, matching the product-level VS Code contract,
  // while consuming the selected gallery palette's semantic dark colors.
  await setEmbeddedVSCodePalette(theme.palettes.dark);
}

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

async function listResourceRuntimeRoots(): Promise<readonly ResourceRuntimeRoot[]> {
  const state = await store.getState();
  const runtimeRoots = state.workspaces.flatMap((workspace) => workspace.sessions.flatMap((session) =>
    (session.runtimeSummary?.jobs ?? []).flatMap((job) => {
      const pid = job.process?.pid;
      if (!pid || (job.status !== "running" && job.status !== "background")) return [];
      return [{
        ownerKind: "runtime" as const,
        ownerId: job.id,
        label: job.title || "Runtime job",
        pid,
        startedAt: job.process?.startedAt ?? job.startedAt,
        workspaceId: workspace.id,
        sessionId: session.id,
        runtimeJobId: job.id,
        stoppable: canStopRuntimeJob(job),
      }];
    }),
  ));
  return [
    ...runtimeRoots,
    ...(terminalService?.getResourceRoots() ?? []),
    ...listOwnedVSCodeServerRoots(),
  ];
}

async function listResourceProviderWaits() {
  const state = await store.getState();
  return state.workspaces.flatMap((workspace) => workspace.sessions.flatMap((session) => {
    if (session.status !== "running" || !session.runningSince || !/waiting\s+for\s+provider/i.test(session.preview)) return [];
    return [{ id: `${workspace.id}:${session.id}`, label: session.title || "Task", startedAt: session.runningSince, workspaceId: workspace.id, sessionId: session.id }];
  }));
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
    throw new Error(`Clipboard images must be ${MAX_CLIPBOARD_IMAGE_DIMENSION.toLocaleString()} pixels or smaller per side.`);
  }

  const png = image.toPNG();
  if (png.length === 0 || png.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error("Clipboard images must be 10 MB or smaller.");
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

function installTextContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params: ContextMenuParams) => {
    const { editFlags } = params;
    const template: MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: "undo", enabled: editFlags.canUndo },
          { role: "redo", enabled: editFlags.canRedo },
          { type: "separator" },
          { role: "cut", enabled: editFlags.canCut },
          { role: "copy", enabled: editFlags.canCopy },
          { role: "paste", enabled: editFlags.canPaste },
          { type: "separator" },
          { role: "selectAll", enabled: editFlags.canSelectAll },
        ]
      : params.selectionText.trim()
        ? [
            { role: "copy", enabled: editFlags.canCopy },
            { type: "separator" },
            { role: "selectAll", enabled: editFlags.canSelectAll },
          ]
        : [];

    if (template.length === 0) {
      return;
    }
    Menu.buildFromTemplate(template).popup({ window });
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
  installMainRendererCrashRecovery(window);
  installMainWindowSecurityPolicies(window);
  installTextContextMenu(window);

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

function installMainRendererCrashRecovery(window: BrowserWindow): void {
  let recoveryInFlight = false;
  let recoveryWindowStartedAt = 0;
  let recoveryAttempts = 0;

  window.webContents.on("render-process-gone", (_event, details) => {
    if (
      details.reason !== "crashed"
      && details.reason !== "oom"
      && details.reason !== "killed"
      && details.reason !== "memory-eviction"
    ) {
      return;
    }

    const now = Date.now();
    if (recoveryInFlight) {
      return;
    }
    if (now - recoveryWindowStartedAt > 5 * 60_000) {
      recoveryWindowStartedAt = now;
      recoveryAttempts = 0;
    }
    recoveryAttempts += 1;
    if (recoveryAttempts > 2) {
      const recoveryPage = encodeURIComponent(`<!doctype html>
        <meta charset="utf-8">
        <meta name="color-scheme" content="dark light">
        <title>Pi recovery</title>
        <style>
          body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1f2023;color:#f3f4f6;font:15px system-ui}
          main{max-width:560px;padding:36px;border:1px solid #3b3d43;border-radius:16px;background:#292b30}
          h1{margin:0 0 12px;font-size:22px}p{line-height:1.55;color:#c7c9d1}
        </style>
        <main><h1>Pi stopped the renderer recovery loop</h1>
        <p>The renderer crashed repeatedly, so Pi did not keep reloading the same task. Your task history and draft remain stored. Close and reopen Pi; the task will start with its bounded recent-history view.</p></main>`);
      void window.loadURL(`data:text/html;charset=utf-8,${recoveryPage}`);
      return;
    }
    recoveryInFlight = true;

    window.webContents.once("did-finish-load", () => {
      recoveryInFlight = false;
      if (mainWindow === window && canPublishToWindow(window)) {
        attachStatePublisher(window);
      }
    });

    setTimeout(() => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        recoveryInFlight = false;
        return;
      }
      const currentUrl = window.webContents.getURL();
      let recoveryUrl = currentUrl;
      try {
        const parsed = new URL(currentUrl);
        parsed.searchParams.set("rendererRecovery", "1");
        recoveryUrl = parsed.toString();
      } catch {
        // A normal app URL is expected; reload remains a safe fallback.
      }
      void store.withError(
        "Pi recovered the renderer in safe mode. This task is showing a bounded recent-history window; the complete transcript remains stored on disk.",
      ).finally(() => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          void window.loadURL(recoveryUrl);
        }
      });
    }, 250);
  });
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
  const unsubscribeState = store.subscribeToStatePatches((event) => {
    statePatchPublisher.publish(event);
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
startupDiagnostics.hasSingleInstanceLock = hasSingleInstanceLock;
recordStartupStage(hasSingleInstanceLock ? "single-instance-lock-acquired" : "single-instance-lock-denied");
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

  recordStartupStage("app-ready");

  // On macOS, packaged builds already render the dock icon from `icon.icns`
  // in the app bundle. In dev we override the generic Electron dock icon with
  // the real PNG so the running app looks right end-to-end.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }
  registerProcessDiagnostics();
  recordStartupStage("reclaim-stale-vscode-servers");
  reclaimStaleVSCodeServers();
  recordStartupStage("install-permission-handler");
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
    onInitializationStage: recordStartupStage,
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
  const subagentSessionByToolCall = new Map<string, SessionRef>();
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
  recordStartupStage("store:initialize");
  await store.initialize();
  sourceControlService = new SourceControlService(
    configuredUserDataDir,
    (workspaceId) => store.getWorkspacePath(workspaceId),
  );
  usageIndexService = new UsageIndexService(
    configuredUserDataDir,
    () => store.driver.listSessions(),
  );
  projectActionStore = new ProjectActionStore(
    configuredUserDataDir,
    (workspaceId) => store.getWorkspacePath(workspaceId),
  );
  promptShelfStore = new PromptShelfStore(configuredUserDataDir);
  themeGalleryService = new ThemeGalleryService(configuredUserDataDir);
  recordStartupStage("theme:sync-embedded-vscode-palette");
  await withStartupTimeout(syncEmbeddedVSCodePalette(), "synchronize embedded VS Code theme").catch((error) => {
    recordStartupStage("theme:sync-failed-nonfatal");
    logIgnoredError("startup.sync-embedded-vscode-palette", error);
  });
  recordStartupStage("services:initialize");
  loopbackRemoteService = new LoopbackRemoteService();
  resourceInspectorService = new ResourceInspectorService({
    getWindow: () => mainWindow,
    getRuntimeRoots: listResourceRuntimeRoots,
    getProviderWaits: listResourceProviderWaits,
    getDiagnostics: () => ({ ...store.getDiagnostics() }),
    getAppSummary: async () => {
      const state = await store.getState();
      const runtimes = Object.values(state.runtimeByWorkspace);
      const resourceRoots = await listResourceRuntimeRoots();
      return {
        activeView: state.activeView,
        workspaceCount: state.workspaces.length,
        sessionCount: state.workspaces.reduce((total, workspace) => total + workspace.sessions.length, 0),
        connectedProviderCount: runtimes.reduce((total, runtime) => total + runtime.providers.filter((provider) => provider.hasAuth).length, 0),
        availableModelCount: runtimes.reduce((total, runtime) => total + runtime.models.filter((model) => model.available).length, 0),
        terminalCount: resourceRoots.filter((root) => root.ownerKind === "terminal").length,
        vscodeServerCount: resourceRoots.filter((root) => root.ownerKind === "vscode").length,
        ...(state.selectedWorkspaceId ? { selectedWorkspaceId: state.selectedWorkspaceId } : {}),
        ...(state.selectedSessionId ? { selectedSessionId: state.selectedSessionId } : {}),
      };
    },
    getRecentFailureTitles: async () => {
      const page = await listObservabilityEvents({ severity: ["error"], limit: 10, includeGlobal: false });
      return page.events.map((event) => event.title);
    },
  });
  store.subscribeToSessionEvents(async (event) => {
    await checkpointObserver?.observe(event);
    taskEvidenceObserver?.observe(event);
    const changedTarget = await subagentRuns.applySessionEvent(event);
    if (changedTarget) {
      publishSubagentRunsChanged(changedTarget.workspaceId, changedTarget.sessionId);
    }
    if (event.type === "subagentRunUpdated") {
      if (event.toolCallId) {
        if (event.status === "started" || event.status === "progress") {
          subagentSessionByToolCall.set(event.toolCallId, event.parentSession);
        } else {
          subagentSessionByToolCall.delete(event.toolCallId);
        }
      }
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
      const correlatedSession = event.parentToolCallId
        ? subagentSessionByToolCall.get(event.parentToolCallId)
        : undefined;
      if (correlatedSession && event.parentToolCallId) {
        await store.emitExternalSessionEvent({
          type: "subagentRunUpdated",
          sessionRef: correlatedSession,
          parentSession: correlatedSession,
          timestamp: event.timestamp,
          // Keep the lifecycle identity stable from tool start through audit
          // completion. The child process ID remains audit metadata; changing
          // IDs here would make evidence count one child twice.
          subagentRunId: event.parentToolCallId,
          toolCallId: event.parentToolCallId,
          status: event.status,
          ...(event.role ? { role: event.role, agentName: event.role } : {}),
          ...(event.description ? { description: event.description } : {}),
          ...(event.toolUseCount !== undefined ? { toolUseCount: event.toolUseCount } : {}),
          ...(event.elapsedMs !== undefined ? { elapsedMs: event.elapsedMs } : {}),
          ...(event.summary ? { summary: event.summary } : {}),
        });
        if (event.status === "completed" || event.status === "failed" || event.status === "cancelled") {
          subagentSessionByToolCall.delete(event.parentToolCallId);
        }
      }
      const changedTargets = await subagentRuns.applyAuditEvent(event);
      for (const target of changedTargets) {
        if (!correlatedSession) {
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
        }
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
        forceRendererCrash: () => {
          mainWindow?.webContents.forcefullyCrashRenderer();
        },
        crashLoopbackRemote: () => loopbackRemoteService?.simulateChildCrashForTest(),
        testLoopbackCancellation: async () => {
          if (!loopbackRemoteService) throw new Error("Loopback service unavailable.");
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20);
          try { await loopbackRemoteService.request("health", { delayMs: 250 }, 1_000, controller.signal); return "unexpected-success"; }
          catch (error) { return error instanceof Error ? error.message : String(error); }
          finally { clearTimeout(timer); }
        },
        testLoopbackTimeout: async () => {
          if (!loopbackRemoteService) throw new Error("Loopback service unavailable.");
          try { await loopbackRemoteService.request("health", { delayMs: 250 }, 50); return "unexpected-success"; }
          catch (error) { return error instanceof Error ? error.message : String(error); }
        },
        seedOpenVsxThemeFixture: () => themeGalleryService?.useDeterministicOpenVsxFixtureForTest(),
        flushPersistence: () => store.flushPersistence(),
        activateWindow: () => store.handleWindowActivation(),
        getDiagnostics: () => store.getDiagnostics(),
        relieveMemoryPressure: (level: "warning" | "critical" = "critical") =>
          store.relieveMemoryPressure(level),
        seedDisplayModeScaleFixture: (options?: { readonly count?: number; readonly legacyCount?: number }) =>
          store.seedDisplayModeScaleFixtureForTest(options),
        seedSessionDormancyFixture: (count?: number) =>
          store.seedSessionDormancyFixtureForTest(count),
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
  handleMainFrameIpc(desktopIpc.selectedTranscriptRequest, (_event, options: SelectedTranscriptRequestOptions | undefined) =>
    store.getSelectedTranscript(options));
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
  handleMainFrameIpc(desktopIpc.getResourceInspectorSnapshot, () => {
    if (!resourceInspectorService) throw new Error("Resource Inspector is unavailable.");
    return resourceInspectorService.getSnapshot();
  });
  handleMainFrameIpc(desktopIpc.setResourceInspectorVisible, (_event, visible: boolean) => {
    resourceInspectorService?.setVisible(visible === true);
  });
  handleMainFrameIpc(desktopIpc.getDiagnosticBundle, () => {
    if (!resourceInspectorService) throw new Error("Diagnose Pi is unavailable.");
    return resourceInspectorService.buildDiagnosticBundle();
  });
  handleMainFrameIpc(desktopIpc.openDiagnosticLogsFolder, async () => {
    await mkdir(path.join(configuredUserDataDir, "logs"), { recursive: true });
    await shell.openPath(path.join(configuredUserDataDir, "logs"));
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
    return store.getSelectedTranscript({ target });
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
    const requestId = input.requestId?.trim();
    if (requestId && requestId.length > 200) {
      throw new Error("Invalid start-thread request ID.");
    }

    const existing = requestId ? recentStartThreadRequests.get(requestId) : undefined;
    if (existing) {
      await existing;
      return;
    }

    // Starting a task is a single foreground action. Treat any second request
    // received while the first is still creating its session as the same
    // action, even if a renderer remount generated a fresh request ID.
    if (activeStartThreadRequest) {
      if (requestId) {
        retainStartThreadRequest(requestId, activeStartThreadRequest);
      }
      await activeStartThreadRequest;
      return;
    }

    const pending = store.startThread(input).then(() => undefined);
    activeStartThreadRequest = pending;
    if (requestId) {
      retainStartThreadRequest(requestId, pending);
    }
    try {
      await pending;
    } finally {
      if (activeStartThreadRequest === pending) {
        activeStartThreadRequest = undefined;
      }
    }
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
    await store.addComposerAttachments(validateComposerAttachmentsPayload(attachments));
  });
  handleMainFrameIpc(desktopIpc.readClipboardImage, () => readClipboardImageAttachment());
  handleMainFrameIpc(desktopIpc.readSubagentTranscript, async (_event, transcriptPath: string) =>
    readSubagentTranscriptPreview(transcriptPath),
  );
  handleMainFrameIpc(desktopIpc.addComposerAttachments, async (_event, attachments: readonly ComposerAttachment[]) => {
    const validated = validateComposerAttachmentsPayload(attachments);
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
      options?: { readonly syncToEditor?: boolean; readonly baseSyncNonce?: number },
    ) => {
      await store.updateComposerDraft(target, validateComposerText(composerDraft), options);
    },
  );
  handleMainFrameIpc(
    desktopIpc.submitComposer,
    async (_event, text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly messageMetadata?: unknown }) => {
      await store.submitComposer(validateComposerText(text), {
        ...options,
        messageMetadata: validateComposerMessageMetadata(options?.messageMetadata),
      });
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
      const attachments = validateComposerAttachmentsPayload(options?.attachments ?? []);
      const state = await store.submitComposerToSession(target, validateComposerText(text), {
        ...options,
        attachments,
        messageMetadata: validateComposerMessageMetadata(options?.messageMetadata),
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
      const validated = validateComposerAttachmentsPayload(attachments);
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
    if (metadata.size > MAX_ARTIFACT_SNAPSHOT_BYTES) {
      throw new Error("Artifact snapshots must be 100 MB or smaller.");
    }
    const snapshotDir = path.join(app.getPath("userData"), "artifact-snapshots", encodeURIComponent(workspaceId));
    await mkdir(snapshotDir, { recursive: true });
    const safeName = path.basename(realSourcePath).replace(/[^A-Za-z0-9._-]+/g, "-") || "artifact";
    const snapshotPath = path.join(snapshotDir, `${Date.now()}-${randomUUID()}-${safeName}`);
    await copyFile(realSourcePath, snapshotPath, fsConstants.COPYFILE_FICLONE);
    await pruneArtifactSnapshots(snapshotDir, snapshotPath);
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
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    const result = await sourceControlService.runMutation(workspaceId, { kind: "create", ...input });
    return result.url ? { url: result.url } : {};
  });
  handleMainFrameIpc(desktopIpc.getSourceControlSnapshot, async (_event, workspaceId: string, forceRefresh?: boolean) => {
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    return sourceControlService.getSnapshot(workspaceId, forceRefresh === true);
  });
  handleMainFrameIpc(desktopIpc.getPullRequestDetail, async (_event, workspaceId: string, pullRequestNumber: number) => {
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    return sourceControlService.getPullRequestDetail(workspaceId, pullRequestNumber);
  });
  handleMainFrameIpc(desktopIpc.previewSourceControlMutation, async (_event, mutation: SourceControlMutation) => {
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    return sourceControlService.previewMutation(mutation);
  });
  handleMainFrameIpc(desktopIpc.runSourceControlMutation, async (_event, workspaceId: string, mutation: SourceControlMutation) => {
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    return sourceControlService.runMutation(workspaceId, mutation);
  });
  handleMainFrameIpc(desktopIpc.getTaskPullRequestLink, async (_event, workspaceId: string, sessionId: string) => {
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    return sourceControlService.getTaskPullRequestLink(workspaceId, sessionId);
  });
  handleMainFrameIpc(desktopIpc.linkTaskPullRequest, async (_event, workspaceId: string, sessionId: string, pullRequestNumber: number) => {
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    return sourceControlService.linkTaskPullRequest(workspaceId, sessionId, pullRequestNumber);
  });
  handleMainFrameIpc(desktopIpc.unlinkTaskPullRequest, async (_event, workspaceId: string, sessionId: string) => {
    if (!sourceControlService) throw new Error("Source control service is unavailable.");
    await sourceControlService.unlinkTaskPullRequest(workspaceId, sessionId);
  });
  handleMainFrameIpc(desktopIpc.getUsageDashboard, async (_event, query: UsageQuery, forceRefresh?: boolean) => {
    if (!usageIndexService) throw new Error("Usage index is unavailable.");
    return usageIndexService.getDashboard(query, forceRefresh === true);
  });
  handleMainFrameIpc(desktopIpc.listProjectActions, async (_event, workspaceId: string) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.list(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.saveProjectAction, async (_event, input: SaveProjectActionInput) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.save(input);
  });
  handleMainFrameIpc(desktopIpc.deleteProjectAction, async (_event, workspaceId: string, actionId: string) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.remove(workspaceId, actionId);
  });
  handleMainFrameIpc(desktopIpc.reorderProjectActions, async (_event, workspaceId: string, orderedIds: readonly string[]) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.reorder(workspaceId, orderedIds);
  });
  handleMainFrameIpc(desktopIpc.migrateLegacyProjectActions, async (_event, input: Readonly<Record<string, readonly LegacyProjectAction[]>>) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.migrateLegacy(input);
  });
  handleMainFrameIpc(desktopIpc.discoverProjectActions, async (_event, workspaceId: string) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.discover(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.previewProjectActionsImport, async (_event, workspaceId: string) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.previewImport(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.previewProjectActionsExport, async (_event, workspaceId: string) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.previewExport(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.exportProjectActions, async (_event, workspaceId: string) => {
    if (!projectActionStore) throw new Error("Project action store is unavailable.");
    return projectActionStore.export(workspaceId);
  });
  handleMainFrameIpc(desktopIpc.listPromptShelf, async () => {
    if (!promptShelfStore) throw new Error("Prompt Shelf is unavailable.");
    return promptShelfStore.list();
  });
  handleMainFrameIpc(desktopIpc.stashPrompt, async (_event, input: StashPromptInput) => {
    if (!promptShelfStore) throw new Error("Prompt Shelf is unavailable.");
    const validated: StashPromptInput = { ...input, text: validateComposerText(input.text), attachments: validateComposerAttachmentsPayload(input.attachments) };
    return promptShelfStore.stash(validated);
  });
  handleMainFrameIpc(desktopIpc.previewPromptShelfRestore, async (_event, entryId: string) => {
    if (!promptShelfStore) throw new Error("Prompt Shelf is unavailable.");
    const preview = await promptShelfStore.previewRestore(entryId);
    return { ...preview, attachments: validateComposerAttachmentsPayload(preview.attachments) };
  });
  handleMainFrameIpc(desktopIpc.completePromptShelfRestore, async (_event, entryId: string) => {
    if (!promptShelfStore) throw new Error("Prompt Shelf is unavailable.");
    return promptShelfStore.completeRestore(entryId);
  });
  handleMainFrameIpc(desktopIpc.renamePromptShelfEntry, async (_event, entryId: string, label: string) => {
    if (!promptShelfStore) throw new Error("Prompt Shelf is unavailable.");
    return promptShelfStore.rename(entryId, label);
  });
  handleMainFrameIpc(desktopIpc.reorderPromptShelf, async (_event, orderedIds: readonly string[]) => {
    if (!promptShelfStore) throw new Error("Prompt Shelf is unavailable.");
    return promptShelfStore.reorder(orderedIds);
  });
  handleMainFrameIpc(desktopIpc.deletePromptShelfEntry, async (_event, entryId: string) => {
    if (!promptShelfStore) throw new Error("Prompt Shelf is unavailable.");
    return promptShelfStore.remove(entryId);
  });
  handleMainFrameIpc(desktopIpc.getThemeGallery, async () => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    return themeGalleryService.snapshot();
  });
  handleMainFrameIpc(desktopIpc.selectThemePalette, async (_event, themeId: string) => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    const snapshot = await themeGalleryService.select(themeId);
    await syncEmbeddedVSCodePalette(themeId);
    return snapshot;
  });
  handleMainFrameIpc(desktopIpc.previewThemePalette, async (_event, themeId: string) => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    await syncEmbeddedVSCodePalette(themeId);
  });
  handleMainFrameIpc(desktopIpc.resetThemePalette, async () => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    const snapshot = await themeGalleryService.reset();
    await syncEmbeddedVSCodePalette(snapshot.selectedThemeId);
    return snapshot;
  });
  handleMainFrameIpc(desktopIpc.importVsCodeTheme, async () => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    const result = await dialog.showOpenDialog({
      title: "Import a VS Code color theme",
      properties: ["openFile"],
      filters: [{ name: "VS Code themes", extensions: ["json", "jsonc"] }],
    });
    const selected = result.filePaths[0];
    return result.canceled || !selected ? undefined : themeGalleryService.importVsCodeTheme(selected);
  });
  handleMainFrameIpc(desktopIpc.removeThemePalette, async (_event, themeId: string) => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    const snapshot = await themeGalleryService.remove(themeId);
    await syncEmbeddedVSCodePalette(snapshot.selectedThemeId);
    return snapshot;
  });
  handleMainFrameIpc(desktopIpc.searchOpenVsxThemes, async (_event, query: string) => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    return themeGalleryService.searchOpenVsx(query);
  });
  handleMainFrameIpc(desktopIpc.installOpenVsxTheme, async (_event, namespace: string, name: string, version: string) => {
    if (!themeGalleryService) throw new Error("Theme gallery is unavailable.");
    return themeGalleryService.installOpenVsx(namespace, name, version);
  });
  handleMainFrameIpc(desktopIpc.getLoopbackRemoteSnapshot, async () => {
    if (!loopbackRemoteService) throw new Error("Loopback remote prototype is unavailable.");
    return loopbackRemoteService.snapshot();
  });
  handleMainFrameIpc(desktopIpc.launchLoopbackRemote, async (_event, workspaceId: string) => {
    if (!loopbackRemoteService) throw new Error("Loopback remote prototype is unavailable.");
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) throw new Error("Workspace was not found.");
    return loopbackRemoteService.launch(workspacePath);
  });
  handleMainFrameIpc(desktopIpc.probeLoopbackRemote, async (_event, relativePath?: string) => {
    if (!loopbackRemoteService) throw new Error("Loopback remote prototype is unavailable.");
    return loopbackRemoteService.probe(typeof relativePath === "string" ? relativePath.slice(0, 1_000) : ".");
  });
  handleMainFrameIpc(desktopIpc.shutdownLoopbackRemote, async () => {
    if (!loopbackRemoteService) throw new Error("Loopback remote prototype is unavailable.");
    return loopbackRemoteService.shutdown();
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

  recordStartupStage("window:create");
  mainWindow = createWindow();
  recordStartupStage("window:created");
  resourceInspectorService.start();
  stopMemoryMonitor = startMemoryMonitor({
    userDataDir: configuredUserDataDir,
    getWindow: () => mainWindow,
    getStoreSnapshot: () => store.getMemoryMonitorSnapshot(),
  });
  stopMemoryPressureGuard = startMemoryPressureGuard({
    getWindow: () => mainWindow,
    onPressure: (level) => store.relieveMemoryPressure(level),
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
  killAllVSCodeServers();
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
    stopMemoryPressureGuard?.();
    stopMemoryPressureGuard = undefined;
    resourceInspectorService?.dispose();
    resourceInspectorService = undefined;
    sourceControlService?.dispose();
    sourceControlService = undefined;
    usageIndexService = undefined;
    projectActionStore = undefined;
    promptShelfStore = undefined;
    themeGalleryService = undefined;
    loopbackRemoteService?.dispose();
    loopbackRemoteService = undefined;
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
  stopMemoryPressureGuard?.();
  stopMemoryPressureGuard = undefined;
  resourceInspectorService?.dispose();
  resourceInspectorService = undefined;
  sourceControlService?.dispose();
  sourceControlService = undefined;
  usageIndexService = undefined;
  projectActionStore = undefined;
  promptShelfStore = undefined;
  themeGalleryService = undefined;
  loopbackRemoteService?.dispose();
  loopbackRemoteService = undefined;
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
  void flushBeforeQuit([
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

async function pruneArtifactSnapshots(snapshotDir: string, protectedPath: string): Promise<void> {
  const names = await readdir(snapshotDir).catch(() => []);
  const entries = (await Promise.all(names.map(async (name) => {
    const filePath = path.join(snapshotDir, name);
    const metadata = await stat(filePath).catch(() => undefined);
    return metadata?.isFile()
      ? { filePath, size: metadata.size, modifiedAt: metadata.mtimeMs }
      : undefined;
  })))
    .filter((entry): entry is { filePath: string; size: number; modifiedAt: number } => Boolean(entry))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  let retainedBytes = 0;
  let retainedCount = 0;
  for (const entry of entries) {
    const keep = entry.filePath === protectedPath || (
      retainedCount < MAX_ARTIFACT_SNAPSHOTS_PER_WORKSPACE
      && retainedBytes + entry.size <= MAX_ARTIFACT_SNAPSHOT_TOTAL_BYTES
    );
    if (keep) {
      retainedCount += 1;
      retainedBytes += entry.size;
      continue;
    }
    await unlink(entry.filePath).catch((error) =>
      logIgnoredError("artifact-snapshot.retention", error),
    );
  }
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
  const stats = await stat(filePath);
  if (!stats.isFile() || stats.size > MAX_COMPOSER_IMAGE_BYTES) {
    throw new Error("Images must be 10 MB or smaller.");
  }
  const buffer = await readFile(filePath);
  validateDecodedComposerImage(buffer);
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
    const encodedBytes = typeof attachment.data === "string"
      ? approximateBase64Bytes(attachment.data)
      : Number.POSITIVE_INFINITY;
    if (
      typeof attachment.data !== "string"
      || typeof attachment.mimeType !== "string"
      || !SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType)
      || encodedBytes > MAX_COMPOSER_IMAGE_BYTES
    ) {
      return [];
    }
    validateDecodedComposerImage(Buffer.from(attachment.data, "base64"));
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

function validateDecodedComposerImage(buffer: Buffer): void {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) {
    throw new Error("The selected image could not be decoded.");
  }
  const size = image.getSize();
  if (size.width > MAX_COMPOSER_IMAGE_DIMENSION || size.height > MAX_COMPOSER_IMAGE_DIMENSION) {
    throw new Error(`Images must be ${MAX_COMPOSER_IMAGE_DIMENSION.toLocaleString()} pixels or smaller per side.`);
  }
}

function validateComposerAttachmentsPayload(
  attachments: readonly ComposerAttachment[],
): ComposerAttachment[] {
  if (!Array.isArray(attachments)) {
    throw new Error("Attachments must be an array.");
  }
  const validated: ComposerAttachment[] = [];
  for (const attachment of attachments) {
    const candidate = validateComposerAttachmentPayload(attachment)[0];
    if (!candidate) {
      throw new Error("An attachment is invalid or unsupported.");
    }
    validated.push(candidate);
  }
  validateComposerAttachmentLimits(validated);
  return validated;
}

function approximateBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
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
