import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { expect, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import type { PiDesktopApi, TranscriptSyncEvent } from "../../src/ipc";
import type {
  DesktopAppState,
  NewThreadEnvironment,
  SelectedTranscriptRecord,
  SessionRecord,
  WorkspaceRecord,
} from "../../src/desktop-state";
import { flushBeforeQuit } from "../../electron/quit-persistence";

const desktopDir = resolve(__dirname, "..", "..");
const packagedReleaseDir = join(desktopDir, "release");
const nativeClipboardImagePath = resolve(__dirname, "..", "..", "..", "website", "public", "og.png");
const execFileAsync = promisify(execFile);
const REAL_AUTH_ENV_VAR = "PI_APP_REAL_AUTH";
const REAL_AUTH_SOURCE_DIR_ENV_VAR = "PI_APP_REAL_AUTH_SOURCE_DIR";
const REQUIRED_REAL_AUTH_FILES = ["auth.json"] as const;
const OPTIONAL_REAL_AUTH_FILES = ["settings.json", "models.json"] as const;
const OPTIONAL_REAL_AUTH_DIRECTORIES = ["agents"] as const;
const PROVIDER_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export type PiAppWindow = Window & { piApp?: PiDesktopApi };
export type DesktopTestMode = "foreground" | "background";
const desktopModifierKey = process.platform === "darwin" ? "Meta" : "Control";

export interface DesktopHarness {
  electronApp: ElectronApplication;
  firstWindow(): Promise<Page>;
  focusWindow(): Promise<void>;
  close(): Promise<void>;
}

interface ElectronStartupDiagnostics {
  readonly appReady: boolean;
  readonly windowCount: number;
  readonly processUptimeSeconds: number;
  readonly startup?: {
    readonly stage?: string;
    readonly stageStartedAt?: number;
    readonly stageHistory?: readonly { readonly stage: string; readonly at: number }[];
    readonly hasSingleInstanceLock?: boolean;
  };
}

class ElectronWindowStartupError extends Error {
  constructor(
    readonly diagnostics: ElectronStartupDiagnostics | { readonly diagnosticError: string },
    cause: unknown,
  ) {
    super(`Electron did not create its first window. Startup diagnostics: ${JSON.stringify(diagnostics)}`, { cause });
  }
}

export async function toggleTopbarPanel(
  window: Page,
  panel: "Browser" | "App logs" | "Preview panel" | "VS Code",
): Promise<void> {
  await window.getByRole("button", { name: "Open panels menu" }).click();
  await window
    .getByRole("menu", { name: "Panels and tools" })
    .getByRole("menuitemcheckbox")
    .filter({ hasText: panel })
    .click();
}

export async function runTopbarTool(window: Page, tool: "Add folder"): Promise<void> {
  await window.getByRole("button", { name: "Open panels menu" }).click();
  await window.getByRole("menu", { name: "Panels and tools" }).getByRole("menuitem", { name: tool }).click();
}

export interface AppDiagnosticsSnapshot {
  readonly selectedTranscriptPublishCount: number;
  readonly statePublishCount: number;
  readonly assistantDeltaFlushCount: number;
  readonly stateChangedIpcCount: number;
  readonly stateChangedIpcBytes: number;
  readonly stateChangedLastIpcBytes: number;
  readonly selectedTranscriptChangedIpcCount: number;
  readonly selectedTranscriptChangedIpcBytes: number;
  readonly selectedTranscriptChangedLastIpcBytes: number;
  readonly transcriptEventIpcCount: number;
  readonly transcriptEventIpcBytes: number;
  readonly transcriptEventLastIpcBytes: number;
  readonly statePatchChangedIpcCount: number;
  readonly statePatchChangedIpcBytes: number;
  readonly statePatchChangedLastIpcBytes: number;
  readonly displayModeProjectionRequests: number;
  readonly displayModeProjectionHits: number;
  readonly displayModeProjectionNotModified: number;
  readonly displayModeProjectionBytes: number;
  readonly displayModeProjectionSidecarReads: number;
  readonly displayModeProjectionSidecarWrites: number;
  readonly displayModeLegacyTranscriptReads: number;
  readonly displayModeProjectionEvents: number;
  readonly displayModeChangedFilesRequests: number;
  readonly displayModeProjectionMisses: number;
  readonly displayModeLegacyProjectionBuilds: number;
  readonly fullTranscriptCacheEntries: number;
  readonly fullTranscriptCacheBytes: number;
  readonly activeTranscriptTailEntries: number;
  readonly activeTranscriptTailBytes: number;
  readonly sessionSubscriptionCount: number;
  readonly residentSessionRuntimeCount: number;
  readonly managedSessionCount: number;
  readonly runningSessionRuntimeCount: number;
  readonly residentWorkspaceRuntimeCount: number;
  readonly dormantSessionEvictions: number;
  readonly memoryPressureWarningCount: number;
  readonly memoryPressureCriticalCount: number;
  readonly driverEventsReceived: number;
  readonly driverEventsEmitted: number;
  readonly driverEventsCoalesced: number;
  readonly maxDriverEventsPending: number;
  readonly currentDriverEventsPending: number;
}

export interface DisplayModeScaleFixture {
  readonly count: number;
  readonly sidecarCount: number;
  readonly legacyCount: number;
  readonly draftTarget: SessionRef;
  readonly attachmentTarget: SessionRef;
}

export interface LaunchDesktopOptions {
  readonly initialWorkspaces?: readonly string[];
  readonly notificationLogPath?: string;
  readonly testMode?: DesktopTestMode;
  readonly agentDir?: string;
  readonly realAuthSourceDir?: string;
  readonly scrubProviderEnv?: boolean;
  readonly envOverrides?: Readonly<Record<string, string | undefined>>;
  readonly inheritParentEnv?: boolean;
}

export interface SeedAgentDirOptions {
  readonly withOpenAiAuth?: boolean;
  readonly withDefaultModel?: boolean;
  readonly enabledModels?: readonly string[];
}

export interface RealAuthConfig {
  readonly enabled: boolean;
  readonly sourceDir?: string;
  readonly skipReason?: string;
}

export function getRealAuthConfig(): RealAuthConfig {
  if (process.env[REAL_AUTH_ENV_VAR] !== "1") {
    return {
      enabled: false,
      skipReason: `Set ${REAL_AUTH_ENV_VAR}=1 and ${REAL_AUTH_SOURCE_DIR_ENV_VAR}=/absolute/path/to/agent to run this spec.`,
    };
  }

  const sourceDir = process.env[REAL_AUTH_SOURCE_DIR_ENV_VAR]?.trim();
  if (!sourceDir) {
    return {
      enabled: false,
      skipReason: `Set ${REAL_AUTH_SOURCE_DIR_ENV_VAR}=/absolute/path/to/agent when ${REAL_AUTH_ENV_VAR}=1.`,
    };
  }

  return {
    enabled: true,
    sourceDir: resolve(sourceDir),
  };
}

export async function launchDesktop(
  userDataDir: string,
  options: readonly string[] | LaunchDesktopOptions = [],
): Promise<DesktopHarness> {
  const normalized = Array.isArray(options) ? { initialWorkspaces: options } : options;
  const agentDir = await prepareAgentDir(userDataDir, normalized);
  const env = buildDesktopLaunchEnv(userDataDir, agentDir, normalized);
  return launchDesktopHarnessWithReadyRetry(() => electron.launch({
    args: [desktopDir],
    cwd: desktopDir,
    env,
  }));
}

export async function launchPackagedDesktop(
  userDataDir: string,
  options: readonly string[] | LaunchDesktopOptions = [],
): Promise<DesktopHarness> {
  const normalized = Array.isArray(options) ? { initialWorkspaces: options } : options;
  const agentDir = await prepareAgentDir(userDataDir, normalized);
  const env = buildDesktopLaunchEnv(userDataDir, agentDir, normalized);
  const releaseDir = resolvePackagedReleaseDir(process.env.PI_APP_TEST_RELEASE_DIR);
  const executablePath = await resolvePackagedAppExecutable(releaseDir);
  return launchDesktopExecutable(executablePath, env);
}

export async function launchDesktopByExecutable(
  executablePath: string,
  userDataDir: string,
  options: readonly string[] | LaunchDesktopOptions = [],
): Promise<DesktopHarness> {
  const normalized = Array.isArray(options) ? { initialWorkspaces: options } : options;
  const agentDir = await prepareAgentDir(userDataDir, normalized);
  const env = buildDesktopLaunchEnv(userDataDir, agentDir, normalized);
  return launchDesktopExecutable(executablePath, env);
}

async function launchDesktopExecutable(
  executablePath: string,
  env: NodeJS.ProcessEnv,
): Promise<DesktopHarness> {
  return launchDesktopHarnessWithReadyRetry(() => electron.launch({
    executablePath,
    args: [],
    cwd: dirname(executablePath),
    env,
  }));
}

async function launchDesktopHarnessWithReadyRetry(
  launch: () => Promise<ElectronApplication>,
): Promise<DesktopHarness> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const harness = createDesktopHarness(await launch());
    try {
      await harness.firstWindow();
      return harness;
    } catch (error) {
      lastError = error;
      const runtimeStalledBeforeAppReady = error instanceof ElectronWindowStartupError
        && "appReady" in error.diagnostics
        && !error.diagnostics.appReady
        && error.diagnostics.windowCount === 0;
      if (runtimeStalledBeforeAppReady) {
        const process = harness.electronApp.process();
        if (!hasChildExited(process)) process.kill("SIGKILL");
        await waitForChildExit(process, 5_000).catch(() => undefined);
      } else {
        await harness.close().catch(() => undefined);
      }
      if (!runtimeStalledBeforeAppReady || attempt > 0) throw error;
    }
  }
  throw lastError;
}

function createDesktopHarness(electronApp: ElectronApplication): DesktopHarness {
  let page: Page | undefined;

  async function getWindow(): Promise<Page> {
    if (!page) {
      try {
        page = await electronApp.firstWindow();
      } catch (error) {
        const diagnostics = await electronApp.evaluate(({ app, BrowserWindow }) => {
          const startup = (globalThis as {
            __PI_APP_STARTUP_DIAGNOSTICS?: {
              readonly stage?: string;
              readonly stageStartedAt?: number;
              readonly stageHistory?: readonly { readonly stage: string; readonly at: number }[];
              readonly hasSingleInstanceLock?: boolean;
            };
          }).__PI_APP_STARTUP_DIAGNOSTICS;
          return {
            appReady: app.isReady(),
            windowCount: BrowserWindow.getAllWindows().length,
            processUptimeSeconds: Math.round(process.uptime()),
            startup,
          };
        }).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
        throw new ElectronWindowStartupError(diagnostics, error);
      }
      await page.waitForLoadState("domcontentloaded");
      await page.waitForFunction(() => Boolean((window as PiAppWindow).piApp), undefined, {
        timeout: 15_000,
      });
    }
    return page;
  }

  return {
    electronApp,
    firstWindow: () => getWindow(),
    focusWindow: async () => {
      await electronApp.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        const window = BrowserWindow.getAllWindows()[0];
        window?.restore();
        window?.show();
        window?.focus();
      });
      await (await getWindow()).bringToFront();
      await expect
        .poll(
          () =>
            electronApp.evaluate(({ BrowserWindow }) => {
              const window = BrowserWindow.getAllWindows()[0];
              return window?.isFocused() ?? false;
            }),
          { timeout: 5_000 },
        )
        .toBe(true);
    },
    close: async () => {
      const process = electronApp.process();
      const testFlush = electronApp.evaluate(async () => {
        const hooks = (globalThis as {
          __PI_APP_TEST_HOOKS?: { flushPersistence?: () => Promise<void> };
        }).__PI_APP_TEST_HOOKS;
        await hooks?.flushPersistence?.();
      });
      // A deliberately adversarial test event can strand the store's event
      // chain. Give it a bounded best-effort flush, then exercise the same
      // bounded application shutdown used in production.
      await flushBeforeQuit([testFlush], 5_000).catch(() => undefined);
      const close = electronApp.close();
      await flushBeforeQuit([close], 15_000).catch(() => {
        if (!hasChildExited(process)) process.kill("SIGKILL");
      });
      // `ElectronApplication.close()` can reject or time out before the OS has
      // reaped the child. Returning while that process still owns the
      // single-instance lock makes an immediate relaunch exit without ever
      // creating a BrowserWindow. Always observe the real child exit before
      // handing control back to restart-heavy specs.
      await waitForChildExit(process, 5_000);
    },
  };
}

function hasChildExited(process: ChildProcess): boolean {
  return process.exitCode !== null || process.signalCode !== null;
}

async function waitForChildExit(process: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasChildExited(process)) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve) => process.once("exit", () => resolve())),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Electron process did not exit within ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildDesktopLaunchEnv(
  userDataDir: string,
  agentDir: string,
  options: LaunchDesktopOptions,
): NodeJS.ProcessEnv {
  const baseEnv = options.inheritParentEnv === false ? {} : process.env;
  const env = {
    ...baseEnv,
    PI_APP_USER_DATA_DIR: userDataDir,
    PI_APP_INITIAL_WORKSPACES: (options.initialWorkspaces ?? []).join(delimiter),
    PI_APP_TEST_MODE: options.testMode ?? process.env.PI_APP_TEST_MODE ?? "foreground",
    PI_CODING_AGENT_DIR: agentDir,
    ...(options.notificationLogPath ? { PI_APP_NOTIFICATION_LOG_PATH: options.notificationLogPath } : {}),
    PI_APP_OPEN_DEVTOOLS: "0",
    ...(options.envOverrides ?? {}),
  };

  delete env.ELECTRON_RUN_AS_NODE;

  if (options.scrubProviderEnv || options.realAuthSourceDir) {
    for (const key of PROVIDER_ENV_VARS) {
      delete env[key];
    }
  }

  return env;
}

function resolvePackagedReleaseDir(rawPath: string | undefined): string | undefined {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolve(desktopDir, trimmed);
}

async function prepareAgentDir(
  userDataDir: string,
  options: LaunchDesktopOptions,
): Promise<string> {
  if (options.agentDir && options.realAuthSourceDir) {
    throw new Error("Pass either agentDir or realAuthSourceDir to the desktop launch helper, not both.");
  }

  if (options.agentDir) {
    return options.agentDir;
  }

  const agentDir = join(userDataDir, "agent");
  if (options.realAuthSourceDir) {
    await seedAgentDirFromRealAuth(agentDir, options.realAuthSourceDir);
    return agentDir;
  }

  await seedAgentDir(agentDir);
  return agentDir;
}

async function seedAgentDirFromRealAuth(agentDir: string, sourceDir: string): Promise<void> {
  const resolvedSourceDir = resolve(sourceDir);
  await mkdir(agentDir, { recursive: true });

  for (const fileName of REQUIRED_REAL_AUTH_FILES) {
    await copyAgentFile(resolvedSourceDir, agentDir, fileName, true);
  }

  for (const fileName of OPTIONAL_REAL_AUTH_FILES) {
    await copyAgentFile(resolvedSourceDir, agentDir, fileName, false);
  }

  for (const directoryName of OPTIONAL_REAL_AUTH_DIRECTORIES) {
    const sourcePath = join(resolvedSourceDir, directoryName);
    try {
      await cp(sourcePath, join(agentDir, directoryName), { recursive: true });
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
}

async function copyAgentFile(
  sourceDir: string,
  targetDir: string,
  fileName: string,
  required: boolean,
): Promise<void> {
  const sourcePath = join(sourceDir, fileName);
  try {
    await copyFile(sourcePath, join(targetDir, fileName));
  } catch (error) {
    if (required && isMissingPathError(error)) {
      throw new Error(
        `Real-auth source dir is missing required file ${fileName}: ${sourcePath}. ` +
          `Set ${REAL_AUTH_SOURCE_DIR_ENV_VAR} to an agent dir with the full provider state.`,
      );
    }

    if (!required && isMissingPathError(error)) {
      return;
    }

    throw error;
  }
}

export async function resolvePackagedAppBundle(releaseDir = packagedReleaseDir): Promise<string> {
  let appBundles: string[];
  try {
    appBundles = await findAppBundles(releaseDir);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(
        `Packaged release directory not found: ${releaseDir}. Run pnpm --filter @pi-gui/desktop run package:dir first.`,
      );
    }
    throw error;
  }

  const appBundle = appBundles.find((candidate) => basename(candidate) === "pi-gui.app") ?? appBundles[0];
  if (!appBundle) {
    throw new Error(`No .app bundle found under ${releaseDir}. Run pnpm --filter @pi-gui/desktop run package:dir first.`);
  }

  return appBundle;
}

export async function resolvePackagedAppExecutable(releaseDir = packagedReleaseDir): Promise<string> {
  return resolveAppBundleExecutable(await resolvePackagedAppBundle(releaseDir));
}

export async function resolveAppBundleExecutable(appBundle: string): Promise<string> {
  const macOsDir = join(appBundle, "Contents", "MacOS");
  const entries = await readdir(macOsDir, { withFileTypes: true });
  const expectedExecutableName = basename(appBundle, ".app");
  const executableEntry =
    entries.find((entry) => entry.isFile() && entry.name === expectedExecutableName) ??
    entries.find((entry) => entry.isFile());

  if (!executableEntry) {
    throw new Error(`No packaged executable found under ${macOsDir}.`);
  }

  return join(macOsDir, executableEntry.name);
}

export async function resolvePackagedReleaseZip(releaseDir = packagedReleaseDir): Promise<string> {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const zipEntry =
    entries.find((entry) => entry.isFile() && entry.name.endsWith("-arm64.zip")) ??
    entries.find((entry) => entry.isFile() && entry.name.endsWith("-mac.zip")) ??
    entries.find((entry) => entry.isFile() && entry.name.endsWith(".zip"));

  if (!zipEntry) {
    throw new Error(`No packaged macOS release zip found under ${releaseDir}. Run pnpm --filter @pi-gui/desktop run package first.`);
  }

  return join(releaseDir, zipEntry.name);
}

export async function extractPackagedReleaseZipAppBundle(
  releaseDir = packagedReleaseDir,
  appName = "pi-gui 2.app",
): Promise<string> {
  const zipPath = await resolvePackagedReleaseZip(releaseDir);
  return extractAppBundleFromReleaseZip(zipPath, appName);
}

export async function extractAppBundleFromReleaseZip(
  zipPath: string,
  appName = "pi-gui 2.app",
): Promise<string> {
  const extractionDir = await mkdtemp(join(tmpdir(), "pi-gui-release-zip-"));
  await execFileAsync("ditto", ["-x", "-k", zipPath, extractionDir]);

  const extractedAppBundle = await resolvePackagedAppBundle(extractionDir);
  const renamedBundle = join(extractionDir, appName);

  if (extractedAppBundle !== renamedBundle) {
    try {
      await rename(extractedAppBundle, renamedBundle);
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EXDEV") {
        throw error;
      }

      await cp(extractedAppBundle, renamedBundle, { recursive: true });
    }
  }

  return realpath(renamedBundle);
}

export async function copyAppBundle(sourceAppBundle: string, targetAppBundle: string): Promise<void> {
  await execFileAsync("ditto", [sourceAppBundle, targetAppBundle]);
}

async function findAppBundles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const bundles: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = join(rootDir, entry.name);
    if (entry.name.endsWith(".app")) {
      bundles.push(fullPath);
      continue;
    }

    bundles.push(...(await findAppBundles(fullPath)));
  }

  return bundles;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function makeUserDataDir(prefix = "pi-gui-user-data-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function seedAgentDir(agentDir: string, options: SeedAgentDirOptions = {}): Promise<void> {
  const {
    withOpenAiAuth = true,
    withDefaultModel = true,
    enabledModels = ["openai/gpt-5", "openai/gpt-4o"],
  } = options;
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify(
      withOpenAiAuth
        ? {
            openai: { type: "api_key", key: "test-openai-key" },
          }
        : {},
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        ...(withDefaultModel ? { defaultProvider: "openai", defaultModel: "gpt-5" } : {}),
        defaultThinkingLevel: "medium",
        enabledModels,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function seedBranchedTreeSessionFixture(
  agentDir: string,
  workspacePath: string,
): Promise<{
  readonly sessionId: string;
  readonly title: "Tree fixture session";
}> {
  const { SessionManager } = (await import(
    "../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js"
  )) as {
    SessionManager: {
      create(cwd: string): {
        appendMessage(message: { role: "user" | "assistant"; content: string; timestamp: number }): string;
        appendModelChange(provider: string, modelId: string): string;
        appendSessionInfo(name: string): string;
        appendThinkingLevelChange(thinkingLevel: string): string;
        branch(entryId: string): void;
        getSessionId(): string;
      };
    };
  };

  return withAgentDirEnv(agentDir, async () => {
    const sessionManager = SessionManager.create(workspacePath);
    let timestamp = Date.now();
    const nextTimestamp = () => {
      timestamp += 1_000;
      return timestamp;
    };
    const appendUser = (content: string) =>
      sessionManager.appendMessage({
        role: "user",
        content,
        timestamp: nextTimestamp(),
      });
    const appendAssistant = (content: string) =>
      sessionManager.appendMessage({
        role: "assistant",
        content,
        timestamp: nextTimestamp(),
      });

    sessionManager.appendModelChange("openai", "gpt-5.4");
    sessionManager.appendThinkingLevelChange("high");
    appendUser("Root question");
    const rootAnswerId = appendAssistant("Root answer");
    appendUser("Branch alpha");
    appendAssistant("Alpha answer");

    sessionManager.branch(rootAnswerId);
    appendUser("Branch beta");
    const betaAnswerId = appendAssistant("Beta answer");
    appendUser("Beta detail one");
    appendAssistant("Beta detail answer one");
    appendUser("Beta detail two");
    appendAssistant("Beta detail answer two");
    for (let index = 3; index <= 40; index += 1) {
      appendUser(`Beta detail ${index}`);
      appendAssistant(`Beta detail answer ${index}`);
    }

    sessionManager.branch(betaAnswerId);
    sessionManager.appendSessionInfo("Tree fixture session");

    return {
      sessionId: sessionManager.getSessionId(),
      title: "Tree fixture session",
    };
  });
}

export async function seedLargeHistorySessionFixture(
  agentDir: string,
  workspacePath: string,
  messageCount = 1_000,
): Promise<{
  readonly sessionId: string;
  readonly title: "Large live history";
}> {
  const { SessionManager } = (await import(
    "../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js"
  )) as {
    SessionManager: {
      create(cwd: string): {
        appendMessage(message: { role: "user" | "assistant"; content: string; timestamp: number }): string;
        appendSessionInfo(name: string): string;
        getSessionId(): string;
      };
    };
  };

  return withAgentDirEnv(agentDir, async () => {
    const sessionManager = SessionManager.create(workspacePath);
    const normalizedCount = Math.max(2, Math.floor(messageCount / 2) * 2);
    const startedAt = Date.now() - normalizedCount * 1_000;
    for (let index = 0; index < normalizedCount; index += 1) {
      sessionManager.appendMessage({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Historical context row ${index}.`,
        timestamp: startedAt + index * 1_000,
      });
    }
    sessionManager.appendSessionInfo("Large live history");
    return {
      sessionId: sessionManager.getSessionId(),
      title: "Large live history",
    };
  });
}

export async function seedCompactedSessionFixture(
  agentDir: string,
  workspacePath: string,
  title: string,
  summary: string,
): Promise<{
  readonly sessionId: string;
  readonly title: string;
}> {
  const { SessionManager } = (await import(
    "../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js"
  )) as {
    SessionManager: {
      create(cwd: string): {
        appendMessage(message: { role: "user" | "assistant"; content: string; timestamp: number }): string;
        appendCompaction(
          summary: string,
          firstKeptEntryId: string,
          tokensBefore: number,
          details?: unknown,
          fromHook?: boolean,
        ): string;
        appendSessionInfo(name: string): string;
        getSessionId(): string;
      };
    };
  };

  return withAgentDirEnv(agentDir, async () => {
    const sessionManager = SessionManager.create(workspacePath);
    const firstKeptEntryId = sessionManager.appendMessage({
      role: "user",
      content: "Original prompt before compaction",
      timestamp: Date.now(),
    });
    sessionManager.appendMessage({
      role: "assistant",
      content: "Original answer before compaction",
      timestamp: Date.now() + 1_000,
    });
    sessionManager.appendCompaction(summary, firstKeptEntryId, 123_456);
    sessionManager.appendSessionInfo(title);

    return {
      sessionId: sessionManager.getSessionId(),
      title,
    };
  });
}

export async function seedToolResultTreeSessionFixture(
  agentDir: string,
  workspacePath: string,
): Promise<{
  readonly sessionId: string;
  readonly title: "Tree tool fixture session";
}> {
  const { SessionManager } = (await import(
    "../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js"
  )) as {
    SessionManager: {
      create(cwd: string): {
        appendMessage(message: Record<string, unknown>): string;
        appendSessionInfo(name: string): string;
        getSessionId(): string;
      };
    };
  };

  return withAgentDirEnv(agentDir, async () => {
    const sessionManager = SessionManager.create(workspacePath);
    let timestamp = Date.now();
    const nextTimestamp = () => {
      timestamp += 1_000;
      return timestamp;
    };

    sessionManager.appendMessage({
      role: "user",
      content: "Inspect README",
      timestamp: nextTimestamp(),
    });

    sessionManager.appendMessage({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "read-readme-call",
          name: "read",
          arguments: {
            path: join(workspacePath, "README.md"),
            offset: 1,
            limit: 20,
          },
        },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.4",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "toolUse",
      timestamp: nextTimestamp(),
    });

    sessionManager.appendMessage({
      role: "toolResult",
      toolCallId: "read-readme-call",
      toolName: "read",
      content: [{ type: "text", text: "# tree-command-workspace" }],
      isError: false,
      timestamp: nextTimestamp(),
    });

    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "README inspected." }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.4",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp: nextTimestamp(),
    });

    sessionManager.appendSessionInfo("Tree tool fixture session");

    return {
      sessionId: sessionManager.getSessionId(),
      title: "Tree tool fixture session",
    };
  });
}

export async function seedUsageSessionFixture(
  agentDir: string,
  workspacePath: string,
): Promise<{ readonly sessionId: string; readonly title: string }> {
  const { SessionManager } = (await import(
    "@earendil-works/pi-coding-agent"
  )) as unknown as {
    SessionManager: {
      create(path: string): {
        appendMessage(message: unknown): string;
        appendSessionInfo(name: string): string;
        getSessionId(): string;
      };
    };
  };
  return withAgentDirEnv(agentDir, async () => {
    const manager = SessionManager.create(workspacePath);
    manager.appendMessage({ role: "user", content: "Measure this turn", timestamp: Date.now() - 1_000 });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Usage recorded." }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-test",
      usage: {
        input: 100,
        output: 40,
        reasoning: 12,
        cacheRead: 80,
        cacheWrite: 5,
        totalTokens: 225,
        cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.0033 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const title = "Usage dashboard fixture";
    manager.appendSessionInfo(title);
    return { sessionId: manager.getSessionId(), title };
  });
}

async function withAgentDirEnv<T>(agentDir: string, action: () => Promise<T>): Promise<T> {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return await action();
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
}

export async function makeWorkspace(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-workspace-"));
  const workspacePath = join(root, name);
  await mkdir(workspacePath, { recursive: true });
  await writeFile(join(workspacePath, "README.md"), `# ${name}\n`, "utf8");
  return realpath(workspacePath);
}

export async function makeGitWorkspace(name: string): Promise<string> {
  const workspacePath = await makeWorkspace(name);
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  return workspacePath;
}

export async function writeProjectExtension(
  workspacePath: string,
  fileName: string,
  source: string,
): Promise<string> {
  const extensionsDir = join(workspacePath, ".pi", "extensions");
  await mkdir(extensionsDir, { recursive: true });
  const extensionPath = join(extensionsDir, fileName);
  await writeFile(extensionPath, source, "utf8");
  return extensionPath;
}

export async function initGitRepo(workspacePath: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: workspacePath });
  await execFileAsync("git", ["config", "user.name", "Pi App Tests"], { cwd: workspacePath });
  await execFileAsync("git", ["config", "user.email", "pi-gui-tests@example.com"], { cwd: workspacePath });
}

export async function commitAllInGitRepo(workspacePath: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd: workspacePath });
  await execFileAsync("git", ["commit", "-m", message], { cwd: workspacePath });
}

export async function writeTinyPng(filePath: string): Promise<void> {
  await writeFile(filePath, Buffer.from(TINY_PNG_BASE64, "base64"));
}

export async function writeTextFile(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents, "utf8");
}

export function desktopShortcut(keyChord: string): string {
  return `${desktopModifierKey}+${keyChord}`;
}

export async function pasteTinyPngViaClipboard(
  harness: DesktopHarness,
  window: Page,
  composerTestId = "composer",
): Promise<void> {
  const composer = window.getByTestId(composerTestId);
  await composer.click();
  await expect(composer).toBeFocused();
  await harness.electronApp.evaluate(({ clipboard, nativeImage }, imagePath) => {
    clipboard.writeImage(nativeImage.createFromPath(imagePath));
  }, nativeClipboardImagePath);
  await composer.press(desktopShortcut("V"));
  await expect(window.locator(".composer-attachment")).toBeVisible();
}

export async function pasteTinyPngFromClipboardFiles(
  window: Page,
  fileName = "screenshot.png",
  composerTestId = "composer",
): Promise<void> {
  await dispatchTinyPngPaste(window, fileName, composerTestId, "files");
}

export async function pasteTinyPng(
  window: Page,
  fileName = "screenshot.png",
  composerTestId = "composer",
): Promise<void> {
  await dispatchTinyPngPaste(window, fileName, composerTestId, "data-transfer");
}

export async function dragFilesOverComposer(
  window: Page,
  filePaths: readonly string[],
  composerSurfaceTestId = "composer-surface",
): Promise<void> {
  const files = await Promise.all(filePaths.map(loadComposerDragFile));
  await dispatchComposerDragEvent(window, "dragenter", files, composerSurfaceTestId);
  await dispatchComposerDragEvent(window, "dragover", files, composerSurfaceTestId);
}

export async function dropFilesOnComposer(
  window: Page,
  filePaths: readonly string[],
  composerSurfaceTestId = "composer-surface",
): Promise<void> {
  const files = await Promise.all(filePaths.map(loadComposerDragFile));
  await dispatchComposerDragEvent(window, "drop", files, composerSurfaceTestId);
}

export async function leaveComposerDrag(
  window: Page,
  composerSurfaceTestId = "composer-surface",
): Promise<void> {
  await window.evaluate((surfaceTestId) => {
    const surface = document.querySelector<HTMLElement>(`[data-testid='${surfaceTestId}']`);
    if (!surface) {
      throw new Error(`Composer surface was unavailable for test id: ${surfaceTestId}`);
    }
    surface.dispatchEvent(new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      relatedTarget: null,
    }));
  }, composerSurfaceTestId);
}

async function dispatchTinyPngPaste(
  window: Page,
  fileName: string,
  composerTestId: string,
  mode: "files" | "data-transfer",
): Promise<void> {
  await window.evaluate(({ encodedPng, name, testId, clipboardMode }) => {
    const composer = document.querySelector<HTMLTextAreaElement>(`[data-testid='${testId}']`);
    if (!composer) {
      throw new Error(`Composer was unavailable for test id: ${testId}`);
    }

    const bytes = Uint8Array.from(atob(encodedPng), (char) => char.charCodeAt(0));
    const file = new File([bytes], name, { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    const clipboardData =
      clipboardMode === "files"
        ? {
            items: [],
            files: [file],
            types: ["Files"],
          }
        : (() => {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            return transfer;
          })();

    Object.defineProperty(event, "clipboardData", {
      configurable: true,
      value: clipboardData,
    });

    composer.focus();
    composer.dispatchEvent(event);
  }, { encodedPng: TINY_PNG_BASE64, name: fileName, testId: composerTestId, clipboardMode: mode });
}

async function dispatchComposerDragEvent(
  window: Page,
  eventType: "dragenter" | "dragover" | "drop",
  files: readonly {
    readonly encoded: string;
    readonly mimeType: string;
    readonly name: string;
    readonly path: string;
  }[],
  composerSurfaceTestId: string,
): Promise<void> {
  await window.evaluate(({ eventName, entries, surfaceTestId }) => {
    const surface = document.querySelector<HTMLElement>(`[data-testid='${surfaceTestId}']`);
    if (!surface) {
      throw new Error(`Composer surface was unavailable for test id: ${surfaceTestId}`);
    }

    const transfer = new DataTransfer();
    for (const entry of entries) {
      const bytes = Uint8Array.from(atob(entry.encoded), (char) => char.charCodeAt(0));
      const file = new File([bytes], entry.name, { type: entry.mimeType });
      Object.defineProperty(file, "path", {
        configurable: true,
        value: entry.path,
      });
      transfer.items.add(file);
    }

    const event = new Event(eventName, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: transfer,
    });
    surface.dispatchEvent(event);
  }, { eventName: eventType, entries: files, surfaceTestId: composerSurfaceTestId });
}

async function loadComposerDragFile(filePath: string): Promise<{
  readonly encoded: string;
  readonly mimeType: string;
  readonly name: string;
  readonly path: string;
}> {
  const buffer = await readFile(filePath);
  return {
    encoded: buffer.toString("base64"),
    mimeType: mimeTypeForTestFile(filePath),
    name: basename(filePath),
    path: filePath,
  };
}

function mimeTypeForTestFile(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".txt":
    case ".md":
      return "text/plain";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

export async function stubNextOpenDialogResult(
  harness: DesktopHarness,
  result: { readonly canceled: boolean; readonly filePaths: readonly string[] },
): Promise<void> {
  await harness.electronApp.evaluate(({ dialog }, nextResult) => {
    const original = dialog.showOpenDialog;
    (globalThis as { __PI_TEST_OPEN_DIALOG_COUNT?: number }).__PI_TEST_OPEN_DIALOG_COUNT = 0;
    dialog.showOpenDialog = async (..._args: Parameters<typeof dialog.showOpenDialog>) => {
      dialog.showOpenDialog = original;
      const globals = globalThis as { __PI_TEST_OPEN_DIALOG_COUNT?: number };
      globals.__PI_TEST_OPEN_DIALOG_COUNT = (globals.__PI_TEST_OPEN_DIALOG_COUNT ?? 0) + 1;
      return { canceled: nextResult.canceled, filePaths: [...nextResult.filePaths] };
    };
  }, result);
}

export async function stubNextOpenDialog(
  harness: DesktopHarness,
  filePaths: readonly string[],
): Promise<void> {
  await stubNextOpenDialogResult(harness, { canceled: false, filePaths });
}

export async function getOpenDialogInvocationCount(harness: DesktopHarness): Promise<number> {
  return harness.electronApp.evaluate(() => {
    return (globalThis as { __PI_TEST_OPEN_DIALOG_COUNT?: number }).__PI_TEST_OPEN_DIALOG_COUNT ?? 0;
  });
}

export async function triggerNativeOpenFolderShortcut(harness: DesktopHarness): Promise<void> {
  await harness.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "o",
      modifiers: ["meta"],
    });
  });
}

export async function getApplicationMenuItemInfo(
  harness: DesktopHarness,
  menuItemId: string,
): Promise<{ id: string; label: string; accelerator: string; parentLabel: string | null } | null> {
  return harness.electronApp.evaluate(({ Menu }, targetId) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) {
      return null;
    }

    const stack = menu.items.map((item) => ({ item, parentLabel: item.label ?? null }));
    while (stack.length > 0) {
      const entry = stack.shift();
      if (!entry) {
        continue;
      }
      const { item, parentLabel } = entry;
      if (item.id === targetId) {
        return {
          id: item.id,
          label: item.label,
          accelerator: item.accelerator ? String(item.accelerator) : "",
          parentLabel,
        };
      }
      for (const child of item.submenu?.items ?? []) {
        stack.push({ item: child, parentLabel: item.label || parentLabel });
      }
    }

    return null;
  }, menuItemId);
}

export async function triggerApplicationMenuItem(harness: DesktopHarness, menuItemId: string): Promise<boolean> {
  return harness.electronApp.evaluate(({ BrowserWindow, Menu }, targetId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(targetId);
    if (!item?.click) {
      return false;
    }
    item.click(item, BrowserWindow.getFocusedWindow() ?? undefined, {} as never);
    return true;
  }, menuItemId);
}

export async function getDesktopState(window: Page): Promise<DesktopAppState> {
  const state = await window.evaluate(() => {
    const app = (window as PiAppWindow).piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }
    return app.getState();
  });

  if (!state) {
    throw new Error("Desktop state was unavailable");
  }

  return state;
}

export async function getSelectedTranscript(window: Page): Promise<SelectedTranscriptRecord | null> {
  return window.evaluate(async () => {
    const app = (window as PiAppWindow).piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }
    return app.getSelectedTranscript();
  });
}

export interface TimelineScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly remainingFromBottom: number;
}

export async function getTimelineScrollMetrics(window: Page): Promise<TimelineScrollMetrics> {
  return window.evaluate(() => {
    const pane = document.querySelector<HTMLDivElement>("[data-testid='timeline-pane']");
    if (!pane) {
      throw new Error("Timeline pane was unavailable");
    }

    return {
      scrollTop: pane.scrollTop,
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
      remainingFromBottom: pane.scrollHeight - pane.scrollTop - pane.clientHeight,
    };
  });
}

export async function jumpTimelineToBottom(window: Page): Promise<void> {
  await window.evaluate(async () => {
    type TestTimelinePane = HTMLDivElement & {
      __legendListRef?: {
        scrollToEnd?: (options?: { animated?: boolean }) => Promise<void> | void;
        scrollToIndex?: (params: { animated?: boolean; index: number; viewPosition?: number }) => Promise<void> | void;
        getState?: () => {
          readonly reprocessCurrentScroll?: () => void;
          readonly triggerCalculateItemsInView?: (params?: Record<string, unknown>) => void;
        };
      } | null;
    };

    const pane = document.querySelector<TestTimelinePane>("[data-testid='timeline-pane']");
    if (!pane) {
      throw new Error("Timeline pane was unavailable");
    }

    const app = (window as PiAppWindow).piApp;
    const transcript = (await app?.getSelectedTranscript())?.transcript ?? [];
    const targetIndex = transcript.length - 1;
    const targetId = transcript.at(-1)?.id;
    const waitFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const clickJumpToLatest = () => {
      document.querySelector<HTMLButtonElement>("[data-testid='timeline-jump']")?.click();
    };
    const isTargetVisible = () => {
      if (!targetId) {
        return true;
      }
      const row = pane.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(targetId)}"]`);
      if (!row) {
        return false;
      }
      const paneRect = pane.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return rowRect.bottom > paneRect.top + 1 && rowRect.top < paneRect.bottom - 1;
    };

    for (let attempt = 0; attempt < 12; attempt += 1) {
      clickJumpToLatest();
      await waitFrame();
      if (targetIndex >= 0) {
        await pane.__legendListRef?.scrollToIndex?.({
          animated: false,
          index: targetIndex,
          viewPosition: 1,
        });
      }
      await pane.__legendListRef?.scrollToEnd?.({ animated: false });
      pane.scrollTop = pane.scrollHeight;
      const state = pane.__legendListRef?.getState?.();
      state?.reprocessCurrentScroll?.();
      state?.triggerCalculateItemsInView?.();
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
      await waitFrame();
      if (pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 32 && isTargetVisible()) {
        return;
      }
    }
  });
}

export async function scrollTimelineAwayFromBottom(window: Page, pixels = 160): Promise<void> {
  const pane = window.getByTestId("timeline-pane");
  const box = await pane.boundingBox();
  if (!box) {
    throw new Error("Timeline pane was unavailable");
  }
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const metrics = await getTimelineScrollMetrics(window);
    if (metrics.remainingFromBottom >= pixels - 8) {
      return;
    }
    const remainingDistance = Math.max(1, pixels - metrics.remainingFromBottom);
    await window.mouse.wheel(0, -Math.max(40, Math.ceil(remainingDistance / 2)));
    await window.waitForTimeout(50);
  }
  await window.evaluate((distance) => {
    const paneElement = document.querySelector<HTMLDivElement>("[data-testid='timeline-pane']");
    if (!paneElement) {
      throw new Error("Timeline pane was unavailable");
    }
    paneElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    paneElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -distance }));
    paneElement.scrollTop = Math.max(0, paneElement.scrollHeight - paneElement.clientHeight - distance);
    paneElement.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, pixels);
}

export async function emitTestSessionEvent(
  harness: DesktopHarness,
  event: SessionDriverEvent,
): Promise<void> {
  await harness.electronApp.evaluate(async (_, payload) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { emitSessionEvent?: (event: SessionDriverEvent) => Promise<void> };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.emitSessionEvent) {
      throw new Error("Test session-event hook is unavailable");
    }
    await hooks.emitSessionEvent(payload);
  }, event);
}

export async function emitTestSessionEventNoWait(
  harness: DesktopHarness,
  event: SessionDriverEvent,
): Promise<void> {
  await harness.electronApp.evaluate((_, payload) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { emitSessionEvent?: (event: SessionDriverEvent) => Promise<void> };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.emitSessionEvent) {
      throw new Error("Test session-event hook is unavailable");
    }
    void hooks.emitSessionEvent(payload).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const globalWithErrors = globalThis as typeof globalThis & {
        __PI_APP_TEST_HOOK_ERRORS?: string[];
      };
      globalWithErrors.__PI_APP_TEST_HOOK_ERRORS = [
        ...(globalWithErrors.__PI_APP_TEST_HOOK_ERRORS ?? []),
        errorMessage,
      ];
      console.error("Test session-event hook failed", error);
    });
  }, event);
}

export async function emitTestTranscriptEvent(
  harness: DesktopHarness,
  event: TranscriptSyncEvent,
): Promise<void> {
  await harness.electronApp.evaluate(async (_, payload) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { emitTranscriptEvent?: (event: TranscriptSyncEvent) => Promise<void> };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.emitTranscriptEvent) {
      throw new Error("Test transcript-event hook is unavailable");
    }
    await hooks.emitTranscriptEvent(payload);
  }, event);
}

export async function flushTestPersistence(harness: DesktopHarness): Promise<void> {
  await harness.electronApp.evaluate(async () => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { flushPersistence?: () => Promise<void> };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.flushPersistence) {
      throw new Error("Test persistence flush hook is unavailable");
    }
    await hooks.flushPersistence();
  });
}

export async function getAppDiagnostics(harness: DesktopHarness): Promise<AppDiagnosticsSnapshot> {
  return harness.electronApp.evaluate(() => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { getDiagnostics?: () => AppDiagnosticsSnapshot };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.getDiagnostics) {
      throw new Error("Test diagnostics hook is unavailable");
    }
    return hooks.getDiagnostics();
  });
}

export async function seedDisplayModeScaleFixture(
  harness: DesktopHarness,
  options: { readonly count?: number; readonly legacyCount?: number } = {},
): Promise<DisplayModeScaleFixture> {
  return harness.electronApp.evaluate(async (_, { count, legacyCount }) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: {
        seedDisplayModeScaleFixture?: (input: {
          readonly count?: number;
          readonly legacyCount?: number;
        }) => Promise<DisplayModeScaleFixture>;
      };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.seedDisplayModeScaleFixture) {
      throw new Error("Display Mode scale fixture hook is unavailable");
    }
    return hooks.seedDisplayModeScaleFixture({ count, legacyCount });
  }, options);
}

export async function updateDisplayModeFixtureSession(
  harness: DesktopHarness,
  target: SessionRef,
  patch: { readonly status?: "idle" | "running" | "failed"; readonly preview?: string },
): Promise<void> {
  await harness.electronApp.evaluate(async (_, { target, patch }) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: {
        updateDisplayModeFixtureSession?: (
          target: SessionRef,
          patch: { readonly status?: "idle" | "running" | "failed"; readonly preview?: string },
        ) => Promise<void>;
      };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.updateDisplayModeFixtureSession) {
      throw new Error("Display Mode fixture update hook is unavailable");
    }
    await hooks.updateDisplayModeFixtureSession(target, patch);
  }, { target, patch });
}

export async function setDeferredThreadTitleMode(harness: DesktopHarness): Promise<void> {
  await harness.electronApp.evaluate(async () => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { setDeferredThreadTitleMode?: () => void };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.setDeferredThreadTitleMode) {
      throw new Error("Deferred thread-title hook is unavailable");
    }
    hooks.setDeferredThreadTitleMode();
  });
}

export async function resolveDeferredThreadTitleEventually(
  harness: DesktopHarness,
  title: string,
  timeout = 15_000,
): Promise<void> {
  let resolved = false;
  await expect
    .poll(
      async () => {
        if (resolved) {
          return "resolved";
        }
        try {
          await resolveDeferredThreadTitle(harness, title);
          resolved = true;
          return "resolved";
        } catch (error) {
          if (String(error).includes("Deferred thread-title request is unavailable")) {
            return "pending";
          }
          throw error;
        }
      },
      { timeout },
    )
    .toBe("resolved");
}

export async function resolveDeferredThreadTitle(harness: DesktopHarness, title: string): Promise<void> {
  await harness.electronApp.evaluate(async (_, nextTitle) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { resolveDeferredThreadTitle?: (title: string) => void };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.resolveDeferredThreadTitle) {
      throw new Error("Deferred thread-title resolve hook is unavailable");
    }
    hooks.resolveDeferredThreadTitle(nextTitle);
  }, title);
}

export async function rejectDeferredThreadTitle(harness: DesktopHarness): Promise<void> {
  await harness.electronApp.evaluate(async () => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: { rejectDeferredThreadTitle?: () => void };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.rejectDeferredThreadTitle) {
      throw new Error("Deferred thread-title reject hook is unavailable");
    }
    hooks.rejectDeferredThreadTitle();
  });
}

export async function seedTranscriptMessages(
  harness: DesktopHarness,
  window: Page,
  options: {
    readonly count: number;
    readonly textFactory?: (index: number) => string;
  },
): Promise<{ readonly sessionRef: SessionRef; readonly messages: readonly string[] }> {
  const state = await getDesktopState(window);
  const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
  const selectedSession = selectedWorkspace?.sessions.find((session) => session.id === state.selectedSessionId);
  assertExists(selectedWorkspace, "Expected selected workspace while seeding transcript");
  assertExists(selectedSession, "Expected selected session while seeding transcript");

  const sessionRef = {
    workspaceId: selectedWorkspace.id,
    sessionId: selectedSession.id,
  } satisfies SessionRef;
  const workspace = {
    workspaceId: selectedWorkspace.id,
    path: selectedWorkspace.path,
    displayName: selectedWorkspace.name,
  };
  const messages = Array.from({ length: options.count }, (_, index) =>
    options.textFactory ? options.textFactory(index) : `seeded transcript row ${index}`,
  );

  for (const [index, text] of messages.entries()) {
    const startedAt = new Date(Date.now() + index * 2_000).toISOString();
    const completedAt = new Date(Date.now() + index * 2_000 + 1_000).toISOString();
    const runId = `test-run-${index}`;

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp: startedAt,
      runId,
      snapshot: {
        ref: sessionRef,
        workspace,
        title: selectedSession.title,
        status: "running",
        updatedAt: startedAt,
        preview: text,
        runningRunId: runId,
      },
    });
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp: startedAt,
      runId,
      text,
    });
    await emitSuccessfulRunCompletion(harness, {
      sessionRef,
      workspace,
      title: selectedSession.title,
      runId,
      completedAt,
      preview: text,
    });
  }

  await flushTestPersistence(harness);
  await jumpTimelineToBottom(window);

  return { sessionRef, messages };
}

export async function streamAssistantDeltas(
  harness: DesktopHarness,
  window: Page,
  chunks: readonly string[],
  runId = `stream-run-${Date.now()}`,
): Promise<{ readonly sessionRef: SessionRef; readonly fullText: string }> {
  const state = await getDesktopState(window);
  const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
  const selectedSession = selectedWorkspace?.sessions.find((session) => session.id === state.selectedSessionId);
  assertExists(selectedWorkspace, "Expected selected workspace while streaming transcript");
  assertExists(selectedSession, "Expected selected session while streaming transcript");

  const sessionRef = {
    workspaceId: selectedWorkspace.id,
    sessionId: selectedSession.id,
  } satisfies SessionRef;
  const workspace = {
    workspaceId: selectedWorkspace.id,
    path: selectedWorkspace.path,
    displayName: selectedWorkspace.name,
  };
  const startedAt = new Date().toISOString();
  const completedAt = new Date(Date.now() + chunks.length * 1_000 + 1_000).toISOString();
  const fullText = chunks.join("");

  await emitTestSessionEvent(harness, {
    type: "sessionUpdated",
    sessionRef,
    timestamp: startedAt,
    runId,
    snapshot: {
      ref: sessionRef,
      workspace,
      title: selectedSession.title,
      status: "running",
      updatedAt: startedAt,
      preview: fullText,
      runningRunId: runId,
    },
  });

  for (const [index, chunk] of chunks.entries()) {
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp: new Date(Date.now() + index * 1_000).toISOString(),
      runId,
      text: chunk,
    });
  }

  await emitSuccessfulRunCompletion(harness, {
    sessionRef,
    workspace,
    title: selectedSession.title,
    runId,
    completedAt,
    preview: fullText,
  });

  return { sessionRef, fullText };
}

async function emitSuccessfulRunCompletion(
  harness: DesktopHarness,
  options: {
    readonly sessionRef: SessionRef;
    readonly workspace: {
      readonly workspaceId: string;
      readonly path: string;
      readonly displayName: string;
    };
    readonly title: string;
    readonly runId: string;
    readonly completedAt: string;
    readonly preview: string;
  },
): Promise<void> {
  const { completedAt, preview, runId, sessionRef, title, workspace } = options;

  await emitTestSessionEvent(harness, {
    type: "runCompleted",
    sessionRef,
    timestamp: completedAt,
    runId,
    snapshot: {
      ref: sessionRef,
      workspace,
      title,
      status: "idle",
      updatedAt: completedAt,
      preview,
    },
  });
}

export function persistedSessionDataPaths(
  userDataDir: string,
  sessionRef: SessionRef,
): {
  transcriptPath: string;
  attachmentPath: string;
  encodedSessionKey: string;
  rawSessionKey: string;
} {
  const rawSessionKey = `${sessionRef.workspaceId}:${sessionRef.sessionId}`;
  const encodedSessionKey = encodeURIComponent(rawSessionKey);
  return {
    transcriptPath: join(userDataDir, "transcripts", `${encodedSessionKey}.json`),
    attachmentPath: join(userDataDir, "attachments", `${encodedSessionKey}.json`),
    encodedSessionKey,
    rawSessionKey,
  };
}

export function assertExists<T>(value: T | undefined | null, message: string): asserts value is T {
  if (value == null) {
    throw new Error(message);
  }
}

export async function waitForWorkspaceByPath(
  window: Page,
  workspacePath: string,
  timeout = 15_000,
): Promise<WorkspaceRecord> {
  await expect
    .poll(async () => {
      const state = await getDesktopState(window);
      return state.workspaces.find((workspace) => workspace.path === workspacePath) ?? null;
    }, { timeout })
    .not.toBeNull();

  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((entry) => entry.path === workspacePath);
  assertExists(workspace, `Expected workspace for path ${workspacePath}`);
  return workspace;
}

export async function addWorkspaceViaIpc(window: Page, workspacePath: string): Promise<void> {
  await window.evaluate(async (pathValue) => {
    const app = (window as PiAppWindow).piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }
    await app.addWorkspacePath(pathValue);
  }, workspacePath);
}

export async function waitForSessionByTitle(
  window: Page,
  workspaceId: string,
  title: string,
  timeout = 15_000,
): Promise<SessionRecord> {
  await expect
    .poll(async () => {
      const state = await getDesktopState(window);
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      return workspace?.sessions.find((session) => session.title === title) ?? null;
    }, { timeout })
    .not.toBeNull();

  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  const session = workspace?.sessions.find((entry) => entry.title === title);
  assertExists(session, `Expected session ${title}`);
  return session;
}

export async function selectSession(window: Page, sessionTitle: string): Promise<void> {
  await clickSession(window, sessionTitle);
  await expect(window.locator(".topbar__session")).toHaveText(sessionTitle);
}

export async function clickSession(window: Page, sessionTitle: string): Promise<void> {
  await window.locator(".session-row__select", { hasText: sessionTitle }).click();
}

export async function openNewThread(window: Page): Promise<void> {
  const composer = window.getByTestId("new-thread-composer");
  if (await composer.isVisible().catch(() => false)) {
    return;
  }
  const button = window.locator(".sidebar").getByRole("button", { name: "New thread", exact: true });
  await expect(button).toBeVisible({ timeout: 15_000 });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
  await expect(composer).toBeVisible({ timeout: 15_000 });
}

export async function expectNewThreadWorkspace(window: Page, workspacePath: string): Promise<void> {
  const workspace = await waitForWorkspaceByPath(window, workspacePath);
  await expect(window.getByTestId("new-thread-composer")).toBeVisible({ timeout: 15_000 });
  await expect(window.locator(".new-thread__workspace")).toHaveValue(workspace.id);
}

export async function startThreadFromSurface(
  window: Page,
  options: {
    readonly environment?: NewThreadEnvironment;
    readonly prompt?: string;
    readonly workspaceName?: string;
  } = {},
): Promise<void> {
  const {
    environment = "local",
    prompt = "Start thread",
    workspaceName,
  } = options;

  await openNewThread(window);
  if (workspaceName) {
    await window.locator(".new-thread__workspace").selectOption({ label: workspaceName });
  }
  if (environment === "worktree") {
    await window.getByRole("button", { name: "Worktree", exact: true }).click();
  } else {
    await window.getByRole("button", { name: "Local", exact: true }).click();
  }
  const startButton = window.getByRole("button", { name: "Start thread" });
  if (prompt) {
    await window.getByLabel("New thread prompt").fill(prompt);
  }
  await expect(startButton).toBeEnabled({ timeout: 15_000 });
  await startButton.click();
  await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
  await expect(window.getByTestId("composer")).toBeFocused({ timeout: 15_000 });
}

export async function startThreadViaIpc(
  window: Page,
  options: {
    readonly environment?: NewThreadEnvironment;
    readonly prompt?: string;
    readonly workspaceName?: string;
  } = {},
): Promise<void> {
  const {
    environment = "local",
    prompt = "Start thread",
    workspaceName,
  } = options;

  const rootWorkspaceId = await window.evaluate(
    async ({ requestedWorkspaceName }) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }

      const state = await app.getState();
      const targetWorkspace = requestedWorkspaceName
        ? state.workspaces.find((workspace) => workspace.name === requestedWorkspaceName)
        : state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
      if (!targetWorkspace) {
        throw new Error(
          requestedWorkspaceName
            ? `Workspace not found: ${requestedWorkspaceName}`
            : "No selected workspace while starting thread",
        );
      }
      return targetWorkspace.rootWorkspaceId ?? targetWorkspace.id;
    },
    { requestedWorkspaceName: workspaceName },
  );

  await window.evaluate(
    async ({ rootWorkspaceId, nextEnvironment, nextPrompt }) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.startThread({
        requestId: crypto.randomUUID(),
        rootWorkspaceId,
        environment: nextEnvironment,
        prompt: nextPrompt,
      });
    },
    {
      rootWorkspaceId,
      nextEnvironment: environment,
      nextPrompt: prompt,
    },
  );
  await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
}

export async function createNamedThread(
  window: Page,
  title: string,
  options: {
    readonly environment?: NewThreadEnvironment;
    readonly workspaceName?: string;
  } = {},
): Promise<void> {
  const { environment = "local", workspaceName } = options;
  if (environment !== "local") {
    await startThreadFromSurface(window, {
      environment,
      prompt: title,
      workspaceName,
    });
    return;
  }

  const targetWorkspaceId = await window.evaluate(
    ({ requestedWorkspaceName }) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      return app.getState().then((state) => {
        if (requestedWorkspaceName) {
          const namedWorkspace = state.workspaces.find((workspace) => workspace.name === requestedWorkspaceName);
          if (!namedWorkspace) {
            throw new Error(`Workspace not found: ${requestedWorkspaceName}`);
          }
          return namedWorkspace.id;
        }

        if (!state.selectedWorkspaceId) {
          throw new Error("No selected workspace");
        }

        return state.selectedWorkspaceId;
      });
    },
    { requestedWorkspaceName: workspaceName },
  );

  await createSessionViaIpc(window, targetWorkspaceId, title);
  await selectSession(window, title);
  const composer = window.getByTestId("composer");
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.click();
  await expect(composer).toBeFocused({ timeout: 15_000 });
}

export async function createSessionViaIpc(window: Page, workspaceIdOrPath: string, title: string): Promise<void> {
  await window.evaluate(async ({ workspaceTarget, targetTitle }) => {
    const app = (window as PiAppWindow).piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const state = await app.getState();
      const workspace = state.workspaces.find((entry) => entry.id === workspaceTarget || entry.path === workspaceTarget);
      if (workspace) {
        await app.createSession({ workspaceId: workspace.id, title: targetTitle });
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }

    throw new Error(`Workspace not found: ${workspaceTarget}`);
  }, { workspaceTarget: workspaceIdOrPath, targetTitle: title });

  await expect(window.locator(".session-row__select", { hasText: title })).toBeVisible({ timeout: 15_000 });
}
