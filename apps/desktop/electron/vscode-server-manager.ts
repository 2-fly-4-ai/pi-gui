import { BrowserWindow } from "electron";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { logIgnoredError } from "./diagnostics";
import { VSCODE_WEBVIEW_PARTITION } from "../src/vscode-constants";
import type { ResourceRuntimeRoot } from "../src/resource-inspector-types";
import type { SemanticThemePalette } from "../src/theme-types";

interface ServerEntry {
  port: number;
  process: ChildProcess;
  workspaceId: string;
  folderPath: string;
  serverBin: string;
  startedAt: number;
  leasePath: string;
}

interface OwnedServerLease {
  readonly version: 1;
  readonly pid: number;
  readonly ownerPid: number;
  readonly port: number;
  readonly workspaceId: string;
  readonly folderPath: string;
  readonly serverBin: string;
  readonly serverDataDir: string;
  readonly processStartIdentity?: string;
  readonly createdAt: string;
}

export interface VSCodeServerInstall {
  serverBin: string;
  serverMain: string;
}

interface VSCodeDataDirs {
  serverDataDir: string;
  userDataDir: string;
}

const servers = new Map<string, ServerEntry>();
const serverStartups = new Map<string, Promise<number>>();
const browserSettingsSeeds = new Map<number, Promise<void>>();
const stableWorkspacePortStart = 19_538;
const stableWorkspacePortCount = 4_000;
const MAX_OWNED_VSCODE_SERVERS = 4;
const PANEL_UNMOUNT_GRACE_MS = 1_500;
let startupQueue: Promise<void> = Promise.resolve();

export class DeferredStopRegistry {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly delayMs: number) {}

  schedule(key: string, stop: () => void): void {
    if (this.timers.has(key)) return;
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      stop();
    }, this.delayMs));
  }

  cancel(key: string): boolean {
    const timer = this.timers.get(key);
    if (!timer) return false;
    clearTimeout(timer);
    this.timers.delete(key);
    return true;
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

const scheduledServerStops = new DeferredStopRegistry(PANEL_UNMOUNT_GRACE_MS);

function getServerKey(workspaceId: string, folderPath: string): string {
  return `${workspaceId}:${path.resolve(folderPath)}`;
}

export function resolveVSCodeServerInstall(serverBin: string): VSCodeServerInstall | null {
  const installRoot = path.dirname(path.dirname(serverBin));
  const nodeBin = path.join(installRoot, process.platform === "win32" ? "node.exe" : "node");
  const serverMain = path.join(installRoot, "out", "server-main.js");
  if (!fs.existsSync(serverBin) || !fs.existsSync(nodeBin) || !fs.existsSync(serverMain)) {
    return null;
  }
  return { serverBin: nodeBin, serverMain };
}

function findVSCodeServerInstall(): VSCodeServerInstall | null {
  const cliDir = path.join(os.homedir(), ".vscode", "cli", "serve-web");
  if (!fs.existsSync(cliDir)) {
    return null;
  }

  const candidates = fs.readdirSync(cliDir)
    .map((commit) => {
      const serverBin = path.join(cliDir, commit, "bin", "code-server");
      if (!fs.existsSync(serverBin)) {
        return null;
      }
      const install = resolveVSCodeServerInstall(serverBin);
      if (!install) {
        return null;
      }
      return { ...install, mtimeMs: fs.statSync(serverBin).mtimeMs };
    })
    .filter((entry): entry is VSCodeServerInstall & { mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const latest = candidates[0];
  if (latest) {
    return { serverBin: latest.serverBin, serverMain: latest.serverMain };
  }

  return null;
}

function canListenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => {
      srv.close(() => resolve(true));
    });
  });
}

function stablePortOffset(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % stableWorkspacePortCount;
}

async function getVSCodePort(folderPath: string): Promise<number> {
  const resolvedFolderPath = path.resolve(folderPath);
  const startOffset = stablePortOffset(resolvedFolderPath);
  for (let attempt = 0; attempt < stableWorkspacePortCount; attempt += 1) {
    const port = stableWorkspacePortStart + ((startOffset + attempt) % stableWorkspacePortCount);
    if (await canListenOnPort(port)) {
      return port;
    }
  }

  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("Could not allocate free port"));
      });
    });
  });
}

function isProcessAlive(entry: ServerEntry): boolean {
  if (!entry.process.pid || entry.process.exitCode !== null || entry.process.signalCode !== null) {
    return false;
  }
  try {
    process.kill(entry.process.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopServer(entry: ServerEntry): void {
  if (!entry.process.pid) {
    return;
  }
  try {
    entry.process.kill("SIGTERM");
  } catch (error) {
    logIgnoredError("vscode-server.stop-process", error);
  }
  removeLease(entry.leasePath);
}

function vscodeDataRoot(): string {
  const baseDir = process.env["PI_APP_USER_DATA_DIR"]
    ?? path.join(os.homedir(), "Library", "Application Support", "pi");
  return path.join(baseDir, "vscode-serve-web");
}

function leaseDirectory(): string {
  return path.join(vscodeDataRoot(), "owned-processes");
}

function leasePathFor(workspaceId: string, folderPath: string): string {
  const safeWorkspaceId = workspaceId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "workspace";
  return path.join(leaseDirectory(), `${safeWorkspaceId}-${stablePortOffset(path.resolve(folderPath))}.json`);
}

function processStartIdentity(pid: number): string | undefined {
  if (process.platform === "win32") return undefined;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 2_000,
  });
  const value = result.status === 0 ? result.stdout.trim() : "";
  return value || undefined;
}

function processCommand(pid: number): string | undefined {
  if (process.platform === "win32") return undefined;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
    timeout: 2_000,
  });
  const value = result.status === 0 ? result.stdout.trim() : "";
  return value || undefined;
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLease(leasePath: string, lease: OwnedServerLease): void {
  fs.mkdirSync(path.dirname(leasePath), { recursive: true });
  const temporaryPath = `${leasePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, leasePath);
}

function removeLease(leasePath: string): void {
  try {
    fs.rmSync(leasePath, { force: true });
  } catch (error) {
    logIgnoredError("vscode-server.remove-lease", error);
  }
}

function readLease(filePath: string): OwnedServerLease | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<OwnedServerLease>;
    if (
      value.version !== 1
      || !Number.isSafeInteger(value.pid)
      || !Number.isSafeInteger(value.ownerPid)
      || !Number.isSafeInteger(value.port)
      || typeof value.workspaceId !== "string"
      || typeof value.folderPath !== "string"
      || typeof value.serverBin !== "string"
      || typeof value.serverDataDir !== "string"
      || typeof value.createdAt !== "string"
    ) {
      return undefined;
    }
    return value as OwnedServerLease;
  } catch {
    return undefined;
  }
}

function canReclaimOwnedLease(lease: OwnedServerLease): boolean {
  if (lease.ownerPid === process.pid || pidIsAlive(lease.ownerPid) || !pidIsAlive(lease.pid)) {
    return false;
  }
  const expectedRoot = path.resolve(vscodeDataRoot());
  const serverDataDir = path.resolve(lease.serverDataDir);
  if (serverDataDir !== expectedRoot && !serverDataDir.startsWith(`${expectedRoot}${path.sep}`)) {
    return false;
  }
  const command = processCommand(lease.pid);
  if (
    !command
    || !command.includes(path.basename(lease.serverBin))
    || !command.includes("--server-data-dir")
    || !command.includes(lease.serverDataDir)
    || !command.includes(`--port ${lease.port}`)
  ) {
    return false;
  }
  const identity = processStartIdentity(lease.pid);
  return Boolean(
    lease.processStartIdentity
    && identity
    && lease.processStartIdentity === identity,
  );
}

export function reclaimStaleVSCodeServers(): number {
  const directory = leaseDirectory();
  if (!fs.existsSync(directory)) return 0;
  let reclaimed = 0;
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(directory, name);
    const lease = readLease(filePath);
    if (!lease) {
      continue;
    }
    if (!pidIsAlive(lease.pid)) {
      removeLease(filePath);
      continue;
    }
    if (!canReclaimOwnedLease(lease)) {
      continue;
    }
    try {
      process.kill(lease.pid, "SIGTERM");
      reclaimed += 1;
      removeLease(filePath);
    } catch (error) {
      logIgnoredError("vscode-server.reclaim-stale", error);
    }
  }
  return reclaimed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeVSCodeWeb(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        timeout: 1_500,
      },
      (response) => {
        response.resume();
        resolve((response.statusCode ?? 500) < 500);
      },
    );
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => resolve(false));
    request.end();
  });
}

async function waitForVSCodeWebReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeVSCodeWeb(port)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`VS Code web server did not respond on port ${port} within ${timeoutMs}ms`);
}

async function withStartupLock<T>(start: () => Promise<T>): Promise<T> {
  const previousStartup = startupQueue;
  let release!: () => void;
  startupQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previousStartup;
  try {
    return await start();
  } finally {
    release();
  }
}

function waitForVSCodeServerReady(proc: ChildProcess, port: number, timeoutMs = 45_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let recentOutput = "";

    const cleanup = () => {
      if (probeTimer) clearTimeout(probeTimer);
      proc.stdout?.off("data", handleOutput);
      proc.stderr?.off("data", handleOutput);
      proc.off("error", handleError);
      proc.off("exit", handleExit);
    };

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err); else resolve();
    };

    const handleOutput = (chunk: Buffer) => {
      recentOutput = `${recentOutput}${chunk.toString()}`.slice(-4_000);
    };

    const handleError = (err: Error) => done(err);

    const handleExit = (code: number | null) => {
      done(new Error(`VS Code server exited before becoming ready (code ${String(code)})${recentOutput.trim() ? `: ${recentOutput.trim()}` : ""}`));
    };

    const deadline = Date.now() + timeoutMs;
    const probe = async () => {
      if (settled) return;
      if (await probeVSCodeWeb(port)) {
        done();
        return;
      }
      if (Date.now() >= deadline) {
        done(new Error(`VS Code web server did not respond on port ${port} within ${timeoutMs}ms${recentOutput.trim() ? `: ${recentOutput.trim()}` : ""}`));
        return;
      }
      probeTimer = setTimeout(() => { void probe(); }, 250);
    };

    proc.stdout?.on("data", handleOutput);
    proc.stderr?.on("data", handleOutput);
    proc.once("error", handleError);
    proc.once("exit", handleExit);
    if (proc.exitCode !== null || proc.signalCode !== null) {
      handleExit(proc.exitCode);
      return;
    }
    void probe();
  });
}

function findMostRecentLegacySettings(rootDir: string): string | null {
  if (!fs.existsSync(rootDir)) {
    return null;
  }

  let latestPath: string | null = null;
  let latestMtimeMs = -1;
  const visit = (dir: string, depth: number) => {
    if (depth > 8) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
      } else if (entry.name === "settings.json" && path.basename(path.dirname(entryPath)) === "User") {
        const mtimeMs = fs.statSync(entryPath).mtimeMs;
        if (mtimeMs > latestMtimeMs) {
          latestPath = entryPath;
          latestMtimeMs = mtimeMs;
        }
      }
    }
  };

  visit(rootDir, 0);
  return latestPath;
}

const defaultVSCodeTheme = "Dark Modern";
let embeddedVSCodePalette: SemanticThemePalette = {
  window: "#181818", sidebar: "#181818", main: "#1f1f1f", surface: "#252526",
  surfaceMuted: "#2a2d2e", line: "#2b2b2b", lineStrong: "#3c3c3c",
  text: "#cccccc", textStrong: "#ffffff", muted: "#a7a7a7", mutedStrong: "#b8b8b8",
  accent: "#7c6cff", link: "#75beff", error: "#f48771", errorInk: "#f48771",
  success: "#89d185", warning: "#cca700",
};

function getVSCodeColorCustomizations(): Record<string, string> {
  const palette = embeddedVSCodePalette;
  return {
    "activityBar.background": palette.window,
    "activityBar.foreground": palette.textStrong,
    "activityBar.border": palette.line,
    "sideBar.background": palette.sidebar,
    "sideBar.foreground": palette.text,
    "sideBar.border": palette.line,
    "editor.background": palette.main,
    "editor.foreground": palette.text,
    "editorWidget.background": palette.surface,
    "editorWidget.border": palette.lineStrong,
    "input.background": palette.surfaceMuted,
    "input.foreground": palette.text,
    "focusBorder": palette.accent,
    "textLink.foreground": palette.link,
    "errorForeground": palette.errorInk,
    "statusBar.background": palette.window,
    "statusBar.foreground": palette.text,
    "titleBar.activeBackground": palette.window,
    "titleBar.activeForeground": palette.textStrong,
  };
}

function readVSCodeSettings(settingsPath: string): Record<string, unknown> {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getVSCodeBrowserSettings(): Record<string, unknown> {
  return {
    "telemetry.telemetryLevel": "off",
    "window.autoDetectColorScheme": false,
    "workbench.colorTheme": defaultVSCodeTheme,
    "workbench.preferredDarkColorTheme": defaultVSCodeTheme,
    "workbench.preferredLightColorTheme": defaultVSCodeTheme,
    "workbench.colorCustomizations": getVSCodeColorCustomizations(),
    "workbench.startupEditor": "none",
    "workbench.welcomePage.walkthroughs.openOnInstall": false,
    "security.workspace.trust.enabled": false,
    "security.workspace.trust.startupPrompt": "never",
    "security.workspace.trust.banner": "never",
    "security.workspace.trust.emptyWindow": false,
    "security.workspace.trust.untrustedFiles": "open",
  };
}

function getVSCodeDarkSplash(): Record<string, unknown> {
  const palette = embeddedVSCodePalette;
  return {
    baseTheme: "vs-dark",
    colorInfo: {
      foreground: palette.text,
      background: palette.main,
      editorBackground: palette.main,
      titleBarBackground: palette.window,
      titleBarBorder: palette.line,
      activityBarBackground: palette.window,
      activityBarBorder: palette.line,
      sideBarBackground: palette.sidebar,
      sideBarBorder: palette.line,
      statusBarBackground: palette.window,
      statusBarBorder: palette.line,
      statusBarNoFolderBackground: palette.window,
    },
    layoutInfo: {
      sideBarSide: "left",
      editorPartMinWidth: 220,
      titleBarHeight: 35,
      activityBarWidth: 48,
      sideBarWidth: 200,
      auxiliaryBarWidth: 200,
      statusBarHeight: 22,
      windowBorder: false,
    },
  };
}

export function ensureVSCodeDefaultSettings(settingsPath: string): void {
  const settings = readVSCodeSettings(settingsPath);

  const defaults = getVSCodeBrowserSettings();

  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (
      key === "workbench.colorTheme" ||
      key === "workbench.preferredDarkColorTheme" ||
      key === "workbench.preferredLightColorTheme" ||
      key === "workbench.colorCustomizations"
    ) {
      if (settings[key] !== value) {
        settings[key] = value;
        changed = true;
      }
      continue;
    }

    if (key === "window.autoDetectColorScheme") {
      if (settings[key] !== value) {
        settings[key] = value;
        changed = true;
      }
      continue;
    }

    if (!(key in settings)) {
      settings[key] = value;
      changed = true;
    }
  }

  if (changed || !fs.existsSync(settingsPath)) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
}

export async function setEmbeddedVSCodePalette(palette: SemanticThemePalette): Promise<void> {
  embeddedVSCodePalette = palette;
  const rootDir = vscodeDataRoot();
  const settingsRoots = [
    path.join(rootDir, "user-data"),
    path.join(rootDir, "Users"),
  ];
  for (const root of settingsRoots) ensureVSCodeSettingsUnder(root, 12);
  await Promise.all([...servers.values()].map((entry) => seedVSCodeBrowserSettings(entry.port)));
}

function ensureVSCodeSettingsUnder(rootDir: string, maxDepth: number): void {
  if (!fs.existsSync(rootDir)) {
    return;
  }

  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
      } else if (entry.name === "settings.json") {
        ensureVSCodeDefaultSettings(entryPath);
      }
    }
  };

  visit(rootDir, 0);
}

function getWorkspaceDataDir(rootDir: string, folderPath: string): string {
  const resolved = path.resolve(folderPath);
  const parsed = path.parse(resolved);
  const relative = resolved.slice(parsed.root.length);
  return path.join(rootDir, "Users", ...relative.split(path.sep).filter(Boolean));
}

async function seedVSCodeBrowserSettings(port: number): Promise<void> {
  const existingSeed = browserSettingsSeeds.get(port);
  if (existingSeed) {
    return existingSeed;
  }

  const seed = (async () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      const win = new BrowserWindow({
        show: false,
        width: 400,
        height: 300,
        backgroundColor: "#1f1f1f",
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: VSCODE_WEBVIEW_PARTITION,
        },
      });

      try {
        await win.loadURL(`http://${host}:${port}/?ew=true`);
        await win.webContents.executeJavaScript(`
          (async () => {
            const settings = ${JSON.stringify(JSON.stringify(getVSCodeBrowserSettings(), null, 2))};
            const splash = ${JSON.stringify(JSON.stringify(getVSCodeDarkSplash()))};
            localStorage.setItem("monaco-parts-splash", splash);
            const db = await new Promise((resolve, reject) => {
              const request = indexedDB.open("vscode-web-db");
              request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains("vscode-userdata-store")) {
                  database.createObjectStore("vscode-userdata-store");
                }
              };
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve(request.result);
            });

            if (!db.objectStoreNames.contains("vscode-userdata-store")) {
              const nextVersion = db.version + 1;
              db.close();
              await new Promise((resolve, reject) => {
                const request = indexedDB.open("vscode-web-db", nextVersion);
                request.onupgradeneeded = () => {
                  const database = request.result;
                  if (!database.objectStoreNames.contains("vscode-userdata-store")) {
                    database.createObjectStore("vscode-userdata-store");
                  }
                };
                request.onerror = () => reject(request.error);
                request.onsuccess = () => { request.result.close(); resolve(undefined); };
              });
            } else {
              db.close();
            }

            const writeDb = await new Promise((resolve, reject) => {
              const request = indexedDB.open("vscode-web-db");
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve(request.result);
            });
            await new Promise((resolve, reject) => {
              const tx = writeDb.transaction("vscode-userdata-store", "readwrite");
              tx.objectStore("vscode-userdata-store").put(settings, "/User/settings.json");
              tx.onerror = () => reject(tx.error);
              tx.oncomplete = () => resolve(undefined);
            });
            writeDb.close();
          })();
        `, true);
      } finally {
        if (!win.isDestroyed()) {
          win.close();
        }
      }
    }
  })();

  browserSettingsSeeds.set(port, seed);
  try {
    await seed;
  } finally {
    if (browserSettingsSeeds.get(port) === seed) {
      browserSettingsSeeds.delete(port);
    }
  }
}

function prepareVSCodeDataDirs(folderPath: string): VSCodeDataDirs {
  const rootDir = vscodeDataRoot();

  // Keep global defaults for migration/tests, but do not run every embedded VS Code
  // server against this shared profile. Multiple serve-web processes sharing one
  // user-data-dir race over VS Code's profile/storage DBs and can reset the web
  // workbench back to a light theme when switching pinned threads/workspaces.
  const sharedUserDataDir = path.join(rootDir, "user-data");
  const sharedUserDir = path.join(sharedUserDataDir, "User");
  const sharedMachineDir = path.join(sharedUserDataDir, "Machine");
  const sharedSettingsPath = path.join(sharedUserDir, "settings.json");
  const sharedMachineSettingsPath = path.join(sharedMachineDir, "settings.json");
  fs.mkdirSync(sharedUserDir, { recursive: true });
  fs.mkdirSync(sharedMachineDir, { recursive: true });
  ensureVSCodeDefaultSettings(sharedSettingsPath);
  ensureVSCodeSettingsUnder(path.join(rootDir, "Users"), 10);
  if (!fs.existsSync(sharedMachineSettingsPath)) {
    fs.copyFileSync(sharedSettingsPath, sharedMachineSettingsPath);
  }
  ensureVSCodeDefaultSettings(sharedMachineSettingsPath);

  const workspaceDataDir = getWorkspaceDataDir(rootDir, folderPath);
  const serverDataDir = path.join(workspaceDataDir, "server");
  const userDataDir = path.join(workspaceDataDir, "user-data");
  const userDir = path.join(userDataDir, "User");
  const machineDir = path.join(userDataDir, "Machine");
  const settingsPath = path.join(userDir, "settings.json");
  const machineSettingsPath = path.join(machineDir, "settings.json");
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(machineDir, { recursive: true });

  if (!fs.existsSync(settingsPath)) {
    const legacyWorkspaceSettingsPath = path.join(workspaceDataDir, "User", "settings.json");
    if (fs.existsSync(legacyWorkspaceSettingsPath)) {
      fs.copyFileSync(legacyWorkspaceSettingsPath, settingsPath);
    } else {
      const legacySettingsPath = findMostRecentLegacySettings(rootDir);
      if (legacySettingsPath && legacySettingsPath !== settingsPath) {
        fs.copyFileSync(legacySettingsPath, settingsPath);
      }
    }
  }

  ensureVSCodeDefaultSettings(settingsPath);
  ensureVSCodeSettingsUnder(path.join(userDir, "profiles"), 4);
  ensureVSCodeSettingsUnder(path.join(workspaceDataDir, "User"), 4);
  if (!fs.existsSync(machineSettingsPath)) {
    fs.copyFileSync(settingsPath, machineSettingsPath);
  }
  ensureVSCodeDefaultSettings(machineSettingsPath);
  return { serverDataDir, userDataDir };
}

export async function ensureVSCodeServer(workspaceId: string, folderPath: string): Promise<number> {
  const serverKey = getServerKey(workspaceId, folderPath);
  scheduledServerStops.cancel(serverKey);
  const pendingStartup = serverStartups.get(serverKey);
  if (pendingStartup) {
    return pendingStartup;
  }

  const startup = withStartupLock(() => startVSCodeServer(serverKey, workspaceId, folderPath));
  serverStartups.set(serverKey, startup);
  try {
    return await startup;
  } finally {
    if (serverStartups.get(serverKey) === startup) {
      serverStartups.delete(serverKey);
    }
  }
}

async function startVSCodeServer(serverKey: string, workspaceId: string, folderPath: string): Promise<number> {
  const existing = servers.get(serverKey);

  if (existing) {
    if (isProcessAlive(existing)) {
      try {
        await waitForVSCodeWebReady(existing.port, 10_000);
        await seedVSCodeBrowserSettings(existing.port);
        return existing.port;
      } catch {
        stopServer(existing);
      }
    }
    servers.delete(serverKey);
  }

  const install = findVSCodeServerInstall();
  if (!install) {
    throw new Error("VS Code web server binary not found. Open VS Code's serve-web once so it can install its server runtime.");
  }
  if (servers.size >= MAX_OWNED_VSCODE_SERVERS) {
    throw new Error(`Close an embedded VS Code panel before opening another one (maximum ${MAX_OWNED_VSCODE_SERVERS}).`);
  }

  const port = await getVSCodePort(folderPath);
  const { serverDataDir, userDataDir } = prepareVSCodeDataDirs(folderPath);

  // Launch the downloaded code-server directly. The code-tunnel serve-web
  // wrapper serves the workbench HTML but drops the remote-agent websocket
  // handshake on this VS Code build, which leaves Explorer spinning forever.
  const proc = spawn(install.serverBin, [
    install.serverMain,
    "--port", String(port),
    "--host", "127.0.0.1",
    "--without-connection-token",
    "--accept-server-license-terms",
    "--disable-workspace-trust",
    "--server-data-dir", serverDataDir,
    "--user-data-dir", userDataDir,
    "--default-folder", folderPath,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    // Keep the editor server in the desktop app's process tree. Detached
    // servers survive renderer/main crashes and were accumulating as orphaned
    // multi-hundred-MB processes across dev launches.
    detached: false,
  });

  const leasePath = leasePathFor(workspaceId, folderPath);
  const entry: ServerEntry = {
    port,
    process: proc,
    workspaceId,
    folderPath,
    serverBin: install.serverBin,
    startedAt: Date.now(),
    leasePath,
  };
  servers.set(serverKey, entry);
  if (proc.pid) {
    writeLease(leasePath, {
      version: 1,
      pid: proc.pid,
      ownerPid: process.pid,
      port,
      workspaceId,
      folderPath: path.resolve(folderPath),
      serverBin: install.serverBin,
      serverDataDir,
      ...(processStartIdentity(proc.pid) ? { processStartIdentity: processStartIdentity(proc.pid) } : {}),
      createdAt: new Date().toISOString(),
    });
  }
  proc.once("exit", () => {
    const current = servers.get(serverKey);
    if (current?.process === proc) {
      servers.delete(serverKey);
    }
    removeLease(leasePath);
  });

  try {
    // Probe the actual web endpoint instead of relying on a log phrase that can
    // be emitted before listeners attach or change between VS Code releases.
    await waitForVSCodeServerReady(proc, port);
    // The readiness listeners are removed once the endpoint responds. Keep both
    // streams drained so a verbose server cannot block on a full pipe.
    proc.stdout?.resume();
    proc.stderr?.resume();
    await seedVSCodeBrowserSettings(port);
    await sleep(500);
  } catch (err) {
    const current = servers.get(serverKey);
    if (current?.process === proc) {
      servers.delete(serverKey);
      stopServer(entry);
    }
    throw err;
  }

  return port;
}

export function killVSCodeServer(workspaceId: string, folderPath: string): void {
  const serverKey = getServerKey(workspaceId, folderPath);
  // React development mode intentionally mounts, cleans up, and remounts
  // effects. Stopping immediately here kills the first VS Code startup and
  // makes the remounted panel inherit a doomed promise. A real panel close is
  // still released promptly, while an immediate remount cancels this timer.
  scheduledServerStops.schedule(serverKey, () => {
    const entry = servers.get(serverKey);
    if (!entry) return;
    stopServer(entry);
    servers.delete(serverKey);
  });
}

export function killAllVSCodeServers(): void {
  scheduledServerStops.clear();
  for (const entry of servers.values()) {
    stopServer(entry);
  }
  servers.clear();
}

export function listOwnedVSCodeServerRoots(): readonly ResourceRuntimeRoot[] {
  return [...servers.values()].flatMap((entry) => {
    const pid = entry.process.pid;
    if (!pid || !isProcessAlive(entry)) return [];
    return [{
      ownerKind: "vscode" as const,
      ownerId: `vscode:${entry.workspaceId}:${entry.startedAt}`,
      label: "VS Code server",
      pid,
      startedAt: new Date(entry.startedAt).toISOString(),
      workspaceId: entry.workspaceId,
    }];
  });
}
