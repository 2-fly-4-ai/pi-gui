import { spawn, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

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
const preferredPort = 19538;

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

async function getVSCodePort(): Promise<number> {
  if (await canListenOnPort(preferredPort)) {
    return preferredPort;
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
  } catch {
    try { entry.process.kill(); } catch { /* ignore */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortRelease(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canListenOnPort(port)) {
      return;
    }
    await sleep(100);
  }
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

function ensureVSCodeDefaultSettings(settingsPath: string): void {
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  const defaults: Record<string, unknown> = {
    "telemetry.telemetryLevel": "off",
    "workbench.colorTheme": "Default Dark Modern",
    "workbench.startupEditor": "none",
    "workbench.welcomePage.walkthroughs.openOnInstall": false,
    "security.workspace.trust.enabled": false,
    "security.workspace.trust.startupPrompt": "never",
    "security.workspace.trust.banner": "never",
    "security.workspace.trust.emptyWindow": false,
    "security.workspace.trust.untrustedFiles": "open",
  };

  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in settings)) {
      settings[key] = value;
      changed = true;
    }
  }

  if (changed || !fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
}

function prepareVSCodeDataDirs(): VSCodeDataDirs {
  const baseDir = process.env["PI_APP_USER_DATA_DIR"] ?? path.join(os.homedir(), "Library", "Application Support", "pi");
  const rootDir = path.join(baseDir, "vscode-serve-web");
  const serverDataDir = path.join(rootDir, "server");
  const userDataDir = path.join(rootDir, "user-data");
  const userDir = path.join(userDataDir, "User");
  const settingsPath = path.join(userDir, "settings.json");
  fs.mkdirSync(userDir, { recursive: true });

  if (!fs.existsSync(settingsPath)) {
    const legacySettingsPath = findMostRecentLegacySettings(rootDir);
    if (legacySettingsPath && legacySettingsPath !== settingsPath) {
      fs.copyFileSync(legacySettingsPath, settingsPath);
    }
  }

  ensureVSCodeDefaultSettings(settingsPath);
  return { serverDataDir, userDataDir };
}

export async function ensureVSCodeServer(workspaceId: string, folderPath: string): Promise<number> {
  const existing = [...servers.values()][0];
  if (existing && existing.workspaceId === workspaceId && existing.folderPath === folderPath) {
    if (isProcessAlive(existing)) {
      try {
        await waitForVSCodeWebReady(existing.port, 10_000);
        return existing.port;
      } catch {
        stopServer(existing);
      }
    }
    servers.delete(existing.workspaceId);
  }
  for (const entry of servers.values()) {
    stopServer(entry);
  }
  servers.clear();
  await waitForPortRelease(preferredPort, 2_000);

  const install = findVSCodeServerInstall();
  if (!install) {
    throw new Error("VS Code web server binary not found. Open VS Code's serve-web once so it can install its server runtime.");
  }

  const port = await getVSCodePort();
  const { serverDataDir, userDataDir } = prepareVSCodeDataDirs();

  // Launch the downloaded code-server directly. The code-tunnel serve-web
  // wrapper serves the workbench HTML but drops the remote-agent websocket
  // handshake on this VS Code build, which leaves Explorer spinning forever.
  const proc = spawn(install.serverBin, [
    "--port", String(port),
    "--host", "127.0.0.1",
    "--without-connection-token",
    "--accept-server-license-terms",
    "--server-data-dir", serverDataDir,
    "--user-data-dir", userDataDir,
    "--default-folder", folderPath,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  servers.set(workspaceId, { port, process: proc, workspaceId, folderPath });

  // Wait for VS Code's own ready signal before loading the webview. A TCP
  // listener appears earlier and can make the workbench fail its backend socket.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("VS Code server startup timed out after 45s")), 45_000);
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve();
    };

    const handleOutput = (chunk: Buffer) => {
      if (chunk.toString().includes("Web UI available at")) {
        done();
      }
    };

    proc.stdout?.on("data", handleOutput);
    proc.stderr?.on("data", handleOutput);
    proc.on("error", (err) => done(err));
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) done(new Error(`VS Code server exited with code ${String(code)}`));
    });
  });
  await waitForVSCodeWebReady(port, 15_000);
  await sleep(500);

  return port;
}

export function killVSCodeServer(workspaceId: string, folderPath: string): void {
  void workspaceId;
  void folderPath;
}

export function killAllVSCodeServers(): void {
  for (const entry of servers.values()) {
    stopServer(entry);
  }
  servers.clear();
}
