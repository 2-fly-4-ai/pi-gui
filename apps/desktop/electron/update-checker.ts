import { app, net, Notification, shell } from "electron";
import { realpathSync } from "node:fs";
import type { AppUpdater } from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { logIgnoredError } from "./diagnostics";
import type { DesktopUpdateStatus } from "../src/ipc";

const RELEASES_URL =
  "https://api.github.com/repos/minghinmatthewlam/pi-gui/releases?per_page=1";
const RELEASES_PAGE =
  "https://github.com/minghinmatthewlam/pi-gui/releases/latest";
const HOMEBREW_COMMAND = "brew upgrade --cask pi-gui";
const PACKAGE_VERSION = "0.1.0";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 15_000; // 15 seconds after launch

export type UpdateCheckResult = DesktopUpdateStatus;

type UpdateStatusListener = (status: DesktopUpdateStatus) => void;

let currentStatus: DesktopUpdateStatus = createIdleStatus();
const listeners = new Set<UpdateStatusListener>();
let configured = false;
let autoUpdater: AppUpdater | undefined;

export function getUpdateStatus(): DesktopUpdateStatus {
  return currentStatus;
}

export function onUpdateStatusChanged(listener: UpdateStatusListener): () => void {
  listeners.add(listener);
  listener(currentStatus);
  return () => {
    listeners.delete(listener);
  };
}

export async function checkForUpdate(options: { readonly manual?: boolean } = {}): Promise<UpdateCheckResult> {
  if (process.env.PI_APP_TEST_UPDATER_SOURCE === "homebrew" || isHomebrewManagedInstall()) {
    return checkHomebrewUpdateStatus();
  }

  if (!canUseElectronUpdater()) {
    return checkReleasePageStatus(options);
  }

  const updater = await configureElectronUpdater();
  publishStatus({
    status: "checking",
    currentVersion: currentAppVersion(),
    source: "direct",
  });

  try {
    const result = await updater.checkForUpdates();
    if (!result) {
      publishStatus({
        status: "error",
        currentVersion: currentAppVersion(),
        source: "direct",
        message: "Auto-update is not available for this build.",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publishStatus({
      status: "error",
      currentVersion: currentAppVersion(),
      source: "direct",
      message,
    });
  }

  return currentStatus;
}

export function installDownloadedUpdate(): void {
  if (currentStatus.status !== "ready" || currentStatus.source !== "direct") {
    return;
  }
  autoUpdater?.quitAndInstall(false, true);
}

export function setUpdateStatusForTest(status: DesktopUpdateStatus): void {
  publishStatus(status);
}

export function initUpdateChecker(): () => void {
  const reportFailure = (error: unknown) => {
    logIgnoredError("update-checker.checkForUpdate", error);
  };

  const timeout = setTimeout(() => {
    void checkForUpdate().catch(reportFailure);
  }, INITIAL_DELAY_MS);
  const interval = setInterval(() => {
    void checkForUpdate().catch(reportFailure);
  }, CHECK_INTERVAL_MS);

  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}

async function configureElectronUpdater(): Promise<AppUpdater> {
  const updater = await loadAutoUpdater();
  if (configured) {
    return updater;
  }
  configured = true;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = currentAppVersion().includes("-");
  updater.logger = null;

  updater.on("checking-for-update", () => {
    publishStatus({
      status: "checking",
      currentVersion: currentAppVersion(),
      source: "direct",
    });
  });

  updater.on("update-not-available", (info: UpdateInfo) => {
    publishStatus({
      status: "up-to-date",
      currentVersion: currentAppVersion(),
      latestVersion: info.version,
      source: "direct",
    });
  });

  updater.on("update-available", (info: UpdateInfo) => {
    publishStatus({
      status: "downloading",
      currentVersion: currentAppVersion(),
      latestVersion: info.version,
      source: "direct",
    });
  });

  updater.on("download-progress", (progress: ProgressInfo) => {
    const previous = currentStatus.status === "downloading" ? currentStatus : undefined;
    publishStatus({
      status: "downloading",
      currentVersion: currentAppVersion(),
      latestVersion: previous?.latestVersion ?? currentAppVersion(),
      source: "direct",
      percent: Math.max(0, Math.min(100, progress.percent)),
    });
  });

  updater.on("update-downloaded", (event) => {
    publishStatus({
      status: "ready",
      currentVersion: currentAppVersion(),
      latestVersion: event.version,
      source: "direct",
    });
    showUpdateReadyNotification(event.version);
  });

  updater.on("error", (error) => {
    publishStatus({
      status: "error",
      currentVersion: currentAppVersion(),
      source: "direct",
      message: error.message,
    });
  });

  return updater;
}

async function loadAutoUpdater(): Promise<AppUpdater> {
  if (autoUpdater) {
    return autoUpdater;
  }
  const updaterModule = await import("electron-updater");
  autoUpdater = updaterModule.autoUpdater;
  return autoUpdater;
}

async function checkHomebrewUpdateStatus(): Promise<DesktopUpdateStatus> {
  const release = await readLatestReleaseVersion();
  if (release.status === "error") {
    publishStatus({
      status: "error",
      currentVersion: currentAppVersion(),
      source: "homebrew",
      message: release.message,
    });
    return currentStatus;
  }

  if (release.latestVersion !== currentAppVersion()) {
    publishStatus({
      status: "homebrew-update-available",
      currentVersion: currentAppVersion(),
      latestVersion: release.latestVersion,
      source: "homebrew",
      command: HOMEBREW_COMMAND,
    });
    showHomebrewUpdateNotification(currentAppVersion(), release.latestVersion);
    return currentStatus;
  }

  publishStatus({
    status: "up-to-date",
    currentVersion: currentAppVersion(),
    latestVersion: release.latestVersion,
    source: "homebrew",
  });
  return currentStatus;
}

async function checkReleasePageStatus(options: { readonly manual?: boolean }): Promise<DesktopUpdateStatus> {
  const release = await readLatestReleaseVersion();
  if (release.status === "error") {
    publishStatus({
      status: "error",
      currentVersion: currentAppVersion(),
      source: "direct",
      message: release.message,
    });
    return currentStatus;
  }

  if (release.latestVersion !== currentAppVersion()) {
    publishStatus({
      status: "update-available",
      currentVersion: currentAppVersion(),
      latestVersion: release.latestVersion,
      source: "direct",
      releasePageUrl: RELEASES_PAGE,
    });
    if (!options.manual) {
      showReleasePageNotification(currentAppVersion(), release.latestVersion);
    }
    return currentStatus;
  }

  publishStatus({
    status: "up-to-date",
    currentVersion: currentAppVersion(),
    latestVersion: release.latestVersion,
    source: "direct",
  });
  return currentStatus;
}

async function readLatestReleaseVersion(): Promise<
  | { readonly status: "ok"; readonly latestVersion: string }
  | { readonly status: "error"; readonly message: string }
> {
  const res = await net.fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) {
    return {
      status: "error",
      message: `GitHub Releases returned ${res.status}.`,
    };
  }

  const releases = (await res.json()) as Array<{ tag_name: string }>;
  const release = releases[0];
  if (!release?.tag_name) {
    return {
      status: "error",
      message: "GitHub Releases did not return any published versions.",
    };
  }

  return {
    status: "ok",
    latestVersion: release.tag_name.replace(/^v/, ""),
  };
}

function canUseElectronUpdater(): boolean {
  return process.platform === "darwin" && Boolean(app?.isPackaged);
}

function isHomebrewManagedInstall(): boolean {
  const forced = process.env.PI_APP_INSTALL_SOURCE;
  if (forced === "homebrew") {
    return true;
  }
  if (forced === "direct") {
    return false;
  }

  if (!app?.getPath) {
    return false;
  }

  const executablePath = safeRealpath(app.getPath("exe"));
  const resourcePath = safeRealpath(process.resourcesPath ?? "");
  return isHomebrewPath(executablePath) || isHomebrewPath(resourcePath);
}

function isHomebrewPath(candidate: string): boolean {
  return candidate.includes("/Caskroom/pi-gui/") || candidate.includes("/homebrew-cask/Caskroom/pi-gui/");
}

function safeRealpath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function createIdleStatus(): DesktopUpdateStatus {
  return {
    status: "idle",
    currentVersion: currentAppVersion(),
    source: "direct",
  };
}

function currentAppVersion(): string {
  return app?.getVersion?.() ?? PACKAGE_VERSION;
}

function publishStatus(status: DesktopUpdateStatus): void {
  currentStatus = status;
  for (const listener of listeners) {
    listener(status);
  }
}

function showUpdateReadyNotification(latestVersion: string): void {
  const notification = new Notification({
    title: "pi-gui Update Ready",
    body: `Version ${latestVersion} is ready. Click to restart and install.`,
  });
  notification.on("click", () => {
    installDownloadedUpdate();
  });
  notification.show();
}

function showReleasePageNotification(currentVersion: string, latestVersion: string): void {
  const notification = new Notification({
    title: "pi-gui Release Available",
    body: `Version ${latestVersion} is available (you have ${currentVersion}). Click to view the release.`,
  });
  notification.on("click", () => {
    void shell.openExternal(RELEASES_PAGE);
  });
  notification.show();
}

function showHomebrewUpdateNotification(currentVersion: string, latestVersion: string): void {
  const notification = new Notification({
    title: "pi-gui Update Available",
    body: `Version ${latestVersion} is available (you have ${currentVersion}). Update with ${HOMEBREW_COMMAND}.`,
  });
  notification.show();
}
