import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { platform } from "node:os";
import { spawn as spawnPty, type IPty } from "node-pty";
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
          options.onLifecycle?.({
            token,
            command,
            cwd,
            timestamp: new Date().toISOString(),
            ...event,
          });
        };
        let pty: IPty | undefined;
        let settled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;
        let killEscalationHandle: NodeJS.Timeout | undefined;
        let abortedLifecycleEmitted = false;

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

        try {
          pty = spawnPty(shell, args, {
            name: "xterm-256color",
            cols: options.cols ?? 120,
            rows: options.rows ?? 40,
            cwd,
            env: buildPtyEnv(env),
          });
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
          return;
        }

        emitLifecycle({ event: "spawned", pid: pty.pid });

        pty.onData((chunk) => {
          onData(Buffer.from(chunk));
          emitLifecycle({ event: "output", pid: pty?.pid, outputText: chunk });
        });

        pty.onExit(({ exitCode }) => {
          emitLifecycle({ event: "exited", pid: pty?.pid, exitCode });
          finish(() => {
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
