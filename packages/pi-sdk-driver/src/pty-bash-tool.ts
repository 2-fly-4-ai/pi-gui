import crypto from "node:crypto";
import { closeSync, existsSync, fstatSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { platform } from "node:os";
import { spawn as spawnPty, type IDisposable, type IPty } from "node-pty";
import { createBashToolDefinition, defineTool, type BashOperations } from "@earendil-works/pi-coding-agent";

export interface PtyBashLifecycleEvent {
  readonly token: string;
  readonly command: string;
  readonly cwd: string;
  readonly pid?: number;
  readonly timestamp: string;
  readonly event: "spawned" | "output" | "exited" | "aborted";
  readonly exitCode?: number | null;
  readonly outputText?: string;
}

type PtyBashLifecycleListener = (event: PtyBashLifecycleEvent) => void;

interface PtyBashOptions {
  readonly shellPath?: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly killGraceMs?: number;
  readonly onLifecycle?: PtyBashLifecycleListener;
}

export function createPtyBashToolDefinition(cwd: string, options: PtyBashOptions = {}) {
  return defineTool(createBashToolDefinition(cwd, {
    operations: createPtyBashOperations(options),
    ...(options.shellPath !== undefined ? { shellPath: options.shellPath } : {}),
  }));
}

function isPowerShell(shell: string): boolean {
  const executable = basename(shell).toLowerCase();
  return executable === "powershell.exe" || executable === "powershell" || executable === "pwsh.exe" || executable === "pwsh";
}

const DEFAULT_KILL_GRACE_MS = 1_500;
const HOST_APP_ENV_KEYS_TO_DROP = [
  "NODE_ENV",
  "ELECTRON_RENDERER_URL",
  "VITE_DEV_SERVER_URL",
] as const;

export function buildPtyEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const ptyEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    // Tool runs are non-interactive. Prevent commands like `git show` from
    // opening `less` inside the PTY and waiting forever at a pager prompt.
    PAGER: "cat",
    GIT_PAGER: "cat",
    LESS: "FRX",
  };

  // Pi GUI often runs under Electron/Vite development process state. Tool
  // shells execute user repo commands, so they must not inherit host app mode.
  for (const key of HOST_APP_ENV_KEYS_TO_DROP) {
    delete ptyEnv[key];
  }

  return ptyEnv;
}

function trySignalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (platform() === "win32" || pid === undefined || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function trySignalPty(pty: IPty | undefined, signal: NodeJS.Signals): boolean {
  if (!pty) return false;
  if (trySignalProcessGroup(pty.pid, signal)) return true;
  try {
    pty.kill(signal);
    return true;
  } catch {
    return false;
  }
}

type DestroyablePty = IPty & { readonly destroy?: () => void };
type PtyWithFd = IPty & { readonly fd?: number };

function captureOpenDarwinPtmxFds(): ReadonlySet<number> | undefined {
  if (platform() !== "darwin") {
    return undefined;
  }
  try {
    const fds = new Set<number>();
    for (const entry of readdirSync("/dev/fd")) {
      const fd = Number(entry);
      if (Number.isInteger(fd) && isDarwinPtmxFd(fd)) {
        fds.add(fd);
      }
    }
    return fds;
  } catch {
    return undefined;
  }
}

function closeNewDarwinPtmxFds(before: ReadonlySet<number> | undefined, pty: IPty | undefined): void {
  if (platform() !== "darwin" || !before) {
    return;
  }
  const retainedFd = (pty as PtyWithFd | undefined)?.fd;
  let currentEntries: readonly string[];
  try {
    currentEntries = readdirSync("/dev/fd");
  } catch {
    return;
  }
  for (const entry of currentEntries) {
    const fd = Number(entry);
    if (!Number.isInteger(fd) || before.has(fd) || fd === retainedFd || !isDarwinPtmxFd(fd)) {
      continue;
    }
    try {
      closeSync(fd);
    } catch {
      // Best-effort cleanup for node-pty's macOS low-fd guard leak.
    }
  }
}

function isDarwinPtmxFd(fd: number): boolean {
  try {
    const stats = fstatSync(fd);
    // Darwin PTY master devices use major 15. This catches the extra
    // posix_openpt fd that node-pty's macOS spawn path leaves open, while the
    // real PTY master is retained via PtyWithFd.fd.
    return (stats.mode & 0o170000) === 0o020000 && Math.floor(stats.rdev / 0x1000000) === 15;
  } catch {
    return false;
  }
}

function destroyPty(pty: IPty | undefined): void {
  if (!pty) return;
  const destroy = (pty as DestroyablePty).destroy;
  if (typeof destroy === "function") {
    try {
      destroy.call(pty);
      return;
    } catch {
      // Fall back to kill below. Cleanup is best-effort because the child may
      // already have exited by the time we release the master side.
    }
  }
  try {
    pty.kill();
  } catch {
    // Best-effort cleanup.
  }
}

export function createPtyBashOperations(options: PtyBashOptions = {}): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout, env }) {
      return new Promise((resolve, reject) => {
        if (!existsSync(cwd)) {
          reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
          return;
        }

        const shell = options.shellPath ?? process.env.SHELL ?? (platform() === "win32" ? "powershell.exe" : "/bin/bash");
        const args = isPowerShell(shell) ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-lc", command];
        const token = crypto.randomUUID();
        const emitLifecycle = (event: Omit<PtyBashLifecycleEvent, "token" | "command" | "cwd" | "timestamp">) => {
          if (!options.onLifecycle) return;
          try {
            options.onLifecycle({
              token,
              command,
              cwd,
              timestamp: new Date().toISOString(),
              ...event,
            });
          } catch {
            // Lifecycle callbacks are observability only.
          }
        };
        let pty: IPty | undefined;
        let dataSubscription: IDisposable | undefined;
        let exitSubscription: IDisposable | undefined;
        let settled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;
        let killEscalationHandle: NodeJS.Timeout | undefined;
        let abortedLifecycleEmitted = false;

        const cleanupPty = () => {
          dataSubscription?.dispose();
          exitSubscription?.dispose();
          dataSubscription = undefined;
          exitSubscription = undefined;
          const currentPty = pty;
          pty = undefined;
          destroyPty(currentPty);
        };

        const finish = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (killEscalationHandle) {
            clearTimeout(killEscalationHandle);
          }
          signal?.removeEventListener("abort", abort);
          callback();
        };

        const abort = () => {
          if (settled) return;
          trySignalPty(pty, "SIGTERM");
          if (!abortedLifecycleEmitted) {
            abortedLifecycleEmitted = true;
            const pid = pty?.pid;
            emitLifecycle(pid === undefined ? { event: "aborted" } : { event: "aborted", pid });
          }
          if (killEscalationHandle) return;
          killEscalationHandle = setTimeout(() => {
            if (!settled) trySignalPty(pty, "SIGKILL");
          }, options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
          killEscalationHandle.unref?.();
        };

        const darwinPtmxFdsBeforeSpawn = captureOpenDarwinPtmxFds();
        try {
          pty = spawnPty(shell, args, {
            name: "xterm-256color",
            cols: options.cols ?? 120,
            rows: options.rows ?? 40,
            cwd,
            env: buildPtyEnv(env),
          });
          closeNewDarwinPtmxFds(darwinPtmxFdsBeforeSpawn, pty);
        } catch (error) {
          closeNewDarwinPtmxFds(darwinPtmxFdsBeforeSpawn, undefined);
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
          return;
        }

        emitLifecycle(pty.pid !== undefined ? { event: "spawned", pid: pty.pid } : { event: "spawned" });

        dataSubscription = pty.onData((chunk) => {
          onData(Buffer.from(chunk));
          emitLifecycle(pty?.pid !== undefined ? { event: "output", pid: pty.pid, outputText: chunk } : { event: "output", outputText: chunk });
        });

        exitSubscription = pty.onExit(({ exitCode }) => {
          const pid = pty?.pid;
          emitLifecycle(pid !== undefined ? { event: "exited", pid, exitCode } : { event: "exited", exitCode });
          finish(() => {
            cleanupPty();
            if (signal?.aborted) {
              reject(new Error("aborted"));
              return;
            }
            if (timedOut) {
              reject(new Error(`timeout:${timeout}`));
              return;
            }
            resolve({ exitCode });
          });
        });

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            abort();
          }, timeout * 1000);
        }

        if (signal?.aborted) {
          abort();
        } else {
          signal?.addEventListener("abort", abort, { once: true });
        }
      });
    },
  };
}
