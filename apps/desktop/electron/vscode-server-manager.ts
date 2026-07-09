import { BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { logIgnoredError } from "./diagnostics";

interface ServerEntry {
  port: number;
  process: ChildProcess;
  workspaceId: string;
  folderPath: string;
}

interface VSCodeServerInstall {
  serverBin: string;
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
let startupQueue: Promise<void> = Promise.resolve();

function getServerKey(workspaceId: string, folderPath: string): string {
  return `${workspaceId}:${path.resolve(folderPath)}`;
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
      return { serverBin, mtimeMs: fs.statSync(serverBin).mtimeMs };
    })
    .filter((entry): entry is { serverBin: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const latest = candidates[0];
  if (latest) {
    return { serverBin: latest.serverBin };
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
    process.kill(-entry.process.pid);
  } catch (error) {
    logIgnoredError("vscode-server.stop-process-group", error);
    try {
      entry.process.kill();
    } catch (fallbackError) {
      logIgnoredError("vscode-server.stop-process", fallbackError);
    }
  }
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

function waitForVSCodeServerReadySignal(proc: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("VS Code server startup timed out after 45s")), 45_000);
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
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
      if (chunk.toString().includes("Web UI available at")) {
        done();
      }
    };

    const handleError = (err: Error) => done(err);

    const handleExit = (code: number | null) => {
      if (code !== 0 && code !== null) {
        done(new Error(`VS Code server exited with code ${String(code)}`));
      }
    };

    proc.stdout?.on("data", handleOutput);
    proc.stderr?.on("data", handleOutput);
    proc.once("error", handleError);
    proc.once("exit", handleExit);
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
const legacyVSCodeThemeIds = new Set(["Default Dark Modern"]);

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

function hasExplicitStringSetting(settings: Record<string, unknown>, key: string): boolean {
  const value = settings[key];
  return typeof value === "string" && value.trim().length > 0;
}

function shouldRewriteThemeSetting(settings: Record<string, unknown>, key: string): boolean {
  const value = settings[key];
  return !hasExplicitStringSetting(settings, key) || (typeof value === "string" && legacyVSCodeThemeIds.has(value));
}

function getVSCodeBrowserSettings(): Record<string, unknown> {
  return {
    "telemetry.telemetryLevel": "off",
    "window.autoDetectColorScheme": false,
    "workbench.colorTheme": defaultVSCodeTheme,
    "workbench.preferredDarkColorTheme": defaultVSCodeTheme,
    "workbench.preferredLightColorTheme": defaultVSCodeTheme,
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
  return {
    baseTheme: "vs-dark",
    colorInfo: {
      foreground: "#cccccc",
      background: "#1f1f1f",
      editorBackground: "#1f1f1f",
      titleBarBackground: "#181818",
      titleBarBorder: "#2b2b2b",
      activityBarBackground: "#181818",
      activityBarBorder: "#2b2b2b",
      sideBarBackground: "#181818",
      sideBarBorder: "#2b2b2b",
      statusBarBackground: "#181818",
      statusBarBorder: "#2b2b2b",
      statusBarNoFolderBackground: "#181818",
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

function ensureVSCodeDefaultSettings(settingsPath: string): void {
  const settings = readVSCodeSettings(settingsPath);

  const defaults = getVSCodeBrowserSettings();

  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (
      key === "workbench.colorTheme" ||
      key === "workbench.preferredDarkColorTheme" ||
      key === "workbench.preferredLightColorTheme"
    ) {
      if (shouldRewriteThemeSetting(settings, key)) {
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
  const baseDir = process.env["PI_APP_USER_DATA_DIR"] ?? path.join(os.homedir(), "Library", "Application Support", "pi");
  const rootDir = path.join(baseDir, "vscode-serve-web");

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

  const port = await getVSCodePort(folderPath);
  const { serverDataDir, userDataDir } = prepareVSCodeDataDirs(folderPath);

  // Launch the downloaded code-server directly. The code-tunnel serve-web
  // wrapper serves the workbench HTML but drops the remote-agent websocket
  // handshake on this VS Code build, which leaves Explorer spinning forever.
  const proc = spawn(install.serverBin, [
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
    detached: true,
  });

  const entry = { port, process: proc, workspaceId, folderPath };
  servers.set(serverKey, entry);
  proc.once("exit", () => {
    const current = servers.get(serverKey);
    if (current?.process === proc) {
      servers.delete(serverKey);
    }
  });

  try {
    // Wait for VS Code's own ready signal before loading the webview. A TCP
    // listener appears earlier and can make the workbench fail its backend socket.
    await waitForVSCodeServerReadySignal(proc);
    await waitForVSCodeWebReady(port, 15_000);
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
  const entry = servers.get(serverKey);
  if (!entry) {
    return;
  }
  stopServer(entry);
  servers.delete(serverKey);
}

export function killAllVSCodeServers(): void {
  for (const entry of servers.values()) {
    stopServer(entry);
  }
  servers.clear();
}
