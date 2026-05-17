import { existsSync } from "node:fs";
import { platform } from "node:os";
import { spawn as spawnPty, type IPty } from "node-pty";
import { createBashToolDefinition, defineTool, type BashOperations } from "@earendil-works/pi-coding-agent";

interface PtyBashOptions {
  readonly shellPath?: string;
  readonly cols?: number;
  readonly rows?: number;
}

export function createPtyBashToolDefinition(cwd: string, options: PtyBashOptions = {}) {
  return defineTool(createBashToolDefinition(cwd, {
    operations: createPtyBashOperations(options),
    shellPath: options.shellPath,
  }));
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
        const args = shell.endsWith("powershell.exe") ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-lc", command];
        let pty: IPty | undefined;
        let settled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        const finish = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          signal?.removeEventListener("abort", abort);
          callback();
        };

        const abort = () => {
          try {
            pty?.kill();
          } catch {
            // node-pty kill can throw if process already exited; ignore because exit handles settlement.
          }
        };

        try {
          pty = spawnPty(shell, args, {
            name: "xterm-256color",
            cols: options.cols ?? 120,
            rows: options.rows ?? 40,
            cwd,
            env: env ?? process.env,
          });
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
          return;
        }

        pty.onData((chunk) => {
          onData(Buffer.from(chunk));
        });

        pty.onExit(({ exitCode }) => {
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
