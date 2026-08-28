import { nativeTheme, type BrowserWindow } from "electron";
import { desktopIpc } from "../src/ipc";
import type { ThemeMode } from "../src/desktop-state";
import { JsonFileStore } from "./json-file-store";

interface PersistedThemeMode {
  readonly version: 1;
  readonly mode: ThemeMode;
}

export class ThemeManager {
  private mode: ThemeMode = "system";
  private window: BrowserWindow | null = null;
  private store: JsonFileStore<PersistedThemeMode> | undefined;

  constructor() {
    nativeTheme.on("updated", () => {
      this.broadcast();
    });
  }

  async initialize(userDataDir: string): Promise<void> {
    this.store = new JsonFileStore<PersistedThemeMode>(userDataDir, "appearance");
    const persisted = await this.store.read("theme-mode");
    this.applyMode(normalizeThemeMode(persisted?.version === 1 ? persisted.mode : undefined));
  }

  setWindow(win: BrowserWindow) {
    this.window = win;
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  getResolvedTheme(): "light" | "dark" {
    if (this.mode === "system") {
      return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    }
    return this.mode;
  }

  async setMode(mode: ThemeMode): Promise<void> {
    this.applyMode(normalizeThemeMode(mode));
    await this.store?.write("theme-mode", { version: 1, mode: this.mode });
  }

  private applyMode(mode: ThemeMode): void {
    this.mode = mode;
    nativeTheme.themeSource = mode;
    this.broadcast();
  }

  private broadcast() {
    this.window?.webContents.send(desktopIpc.themeChanged, this.getResolvedTheme());
  }
}

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}
