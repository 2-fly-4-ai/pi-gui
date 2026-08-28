import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeferredStopRegistry,
  ensureVSCodeDefaultSettings,
  reclaimStaleVSCodeServers,
  resolveVSCodeServerInstall,
  setEmbeddedVSCodePalette,
} from "../../electron/vscode-server-manager";
import { VSCODE_WEBVIEW_PARTITION } from "../../src/vscode-constants";

const temporaryDirectories: string[] = [];
const children: ChildProcess[] = [];
const previousUserDataDir = process.env.PI_APP_USER_DATA_DIR;

afterEach(async () => {
  vi.useRealTimers();
  for (const child of children.splice(0)) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  if (previousUserDataDir === undefined) {
    delete process.env.PI_APP_USER_DATA_DIR;
  } else {
    process.env.PI_APP_USER_DATA_DIR = previousUserDataDir;
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function startIdentity(pid: number): string {
  return spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  }).stdout.trim();
}

describe("VS Code owned-process leases", () => {
  it("cancels a development remount stop before it kills the shared startup", () => {
    vi.useFakeTimers();
    const stopped = vi.fn();
    const registry = new DeferredStopRegistry(1_500);
    registry.schedule("workspace", stopped);
    expect(registry.cancel("workspace")).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(stopped).not.toHaveBeenCalled();
  });

  it("launches the real Node server instead of the shell wrapper", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-gui-vscode-install-"));
    temporaryDirectories.push(root);
    const serverBin = join(root, "bin", "code-server");
    const nodeBin = join(root, process.platform === "win32" ? "node.exe" : "node");
    const serverMain = join(root, "out", "server-main.js");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "out"), { recursive: true });
    await Promise.all([
      writeFile(serverBin, "wrapper", "utf8"),
      writeFile(nodeBin, "node", "utf8"),
      writeFile(serverMain, "server", "utf8"),
    ]);

    expect(resolveVSCodeServerInstall(serverBin)).toEqual({ serverBin: nodeBin, serverMain });
  });

  it("forces the embedded profile back to dark mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-gui-vscode-theme-"));
    temporaryDirectories.push(root);
    const settingsPath = join(root, "User", "settings.json");
    await mkdir(join(root, "User"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      "window.autoDetectColorScheme": true,
      "workbench.colorTheme": "Light Modern",
      "workbench.preferredDarkColorTheme": "Default Dark Modern",
      "workbench.preferredLightColorTheme": "Light Modern",
    }), "utf8");

    ensureVSCodeDefaultSettings(settingsPath);
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(settings).toMatchObject({
      "window.autoDetectColorScheme": false,
      "workbench.colorTheme": "Dark Modern",
      "workbench.preferredDarkColorTheme": "Dark Modern",
      "workbench.preferredLightColorTheme": "Dark Modern",
    });
    expect(VSCODE_WEBVIEW_PARTITION).toBe("persist:pi-vscode");
  });

  it("maps the selected semantic dark palette into bounded VS Code color customizations", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-gui-vscode-palette-"));
    temporaryDirectories.push(root);
    process.env.PI_APP_USER_DATA_DIR = root;
    const settingsPath = join(root, "vscode-serve-web", "user-data", "User", "settings.json");
    await mkdir(join(root, "vscode-serve-web", "user-data", "User"), { recursive: true });
    await writeFile(settingsPath, "{}", "utf8");

    await setEmbeddedVSCodePalette({
      window: "#101010", sidebar: "#111111", main: "#121212", surface: "#131313",
      surfaceMuted: "#141414", line: "#202020", lineStrong: "#303030",
      text: "#dedede", textStrong: "#ffffff", muted: "#aaaaaa", mutedStrong: "#bbbbbb",
      accent: "#7766ff", link: "#66aaff", error: "#dd5555", errorInk: "#ff7777",
      success: "#55bb77", warning: "#ddaa44",
    });

    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(settings["workbench.colorTheme"]).toBe("Dark Modern");
    expect(settings["workbench.colorCustomizations"]).toMatchObject({
      "editor.background": "#121212",
      "editor.foreground": "#dedede",
      "focusBorder": "#7766ff",
      "sideBar.background": "#111111",
    });
  });

  it("reclaims only a stale process whose command and start identity match its lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-gui-vscode-lease-"));
    temporaryDirectories.push(root);
    process.env.PI_APP_USER_DATA_DIR = root;
    const dataRoot = join(root, "vscode-serve-web");
    const serverDataDir = join(dataRoot, "Users", "fixture", "server");
    const leaseDir = join(dataRoot, "owned-processes");
    const serverBin = join(root, "code-server");
    await mkdir(leaseDir, { recursive: true });
    await writeFile(serverBin, "#!/bin/sh\nsleep 60\n", "utf8");
    await chmod(serverBin, 0o755);

    const child = spawn(serverBin, [
      "--port", "20555",
      "--server-data-dir", serverDataDir,
    ], { stdio: "ignore" });
    children.push(child);
    if (!child.pid) throw new Error("Fixture process did not start");

    await writeFile(join(leaseDir, "fixture.json"), JSON.stringify({
      version: 1,
      pid: child.pid,
      ownerPid: 999_999_999,
      port: 20555,
      workspaceId: "workspace-1",
      folderPath: root,
      serverBin,
      serverDataDir,
      processStartIdentity: startIdentity(child.pid),
      createdAt: new Date().toISOString(),
    }), "utf8");

    expect(reclaimStaleVSCodeServers()).toBe(1);
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect(child.signalCode).toBe("SIGTERM");
  });
});
