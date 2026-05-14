import { execSync, spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";

interface ServerEntry {
  port: number;
  process: ChildProcess;
  folderPath: string;
}

const servers = new Map<string, ServerEntry>();

function findCodeCli(): string | null {
  const candidates = [
    "/usr/local/bin/code",
    "/opt/homebrew/bin/code",
    "/usr/bin/code",
    `${process.env["HOME"] ?? ""}/bin/code`,
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
  ];
  try {
    const found = execSync("which code 2>/dev/null", { encoding: "utf8" }).trim();
    if (found) return found;
  } catch { /* not in PATH */ }
  for (const c of candidates) {
    try { execSync(`test -f "${c}"`, { stdio: "ignore" }); return c; } catch { /* skip */ }
  }
  return null;
}

function getFreePort(): Promise<number> {
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

export async function ensureVSCodeServer(workspaceId: string, folderPath: string): Promise<number> {
  const existing = servers.get(workspaceId);
  if (existing && existing.folderPath === folderPath) return existing.port;
  if (existing) { try { existing.process.kill(); } catch { /* ignore */ } servers.delete(workspaceId); }

  const cli = findCodeCli();
  if (!cli) throw new Error("VS Code CLI not found. Open VS Code → Command Palette → 'Install code command in PATH'.");

  const port = await getFreePort();

  const proc = spawn(cli, [
    "serve-web",
    "--port", String(port),
    "--host", "127.0.0.1",
    "--without-connection-token",
    "--folder-uri", `file://${folderPath}`,
    "--accept-server-license-terms",
  ], { stdio: ["ignore", "pipe", "pipe"], detached: false });

  servers.set(workspaceId, { port, process: proc, folderPath });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("VS Code server startup timed out after 20s")), 20_000);
    const check = (chunk: Buffer) => {
      if (chunk.toString().includes("localhost")) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on("data", check);
    proc.stderr?.on("data", check);
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) { clearTimeout(timer); reject(new Error(`code serve-web exited with code ${String(code)}`)); }
    });
  });

  return port;
}

export function killAllVSCodeServers(): void {
  for (const entry of servers.values()) {
    try { entry.process.kill(); } catch { /* ignore */ }
  }
  servers.clear();
}
