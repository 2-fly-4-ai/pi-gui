export type ThemePaletteMode = "light" | "dark";
export type ThemeSourceKind = "built-in" | "vscode-file" | "open-vsx";

export interface SemanticThemePalette {
  readonly window: string;
  readonly sidebar: string;
  readonly main: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly line: string;
  readonly lineStrong: string;
  readonly text: string;
  readonly textStrong: string;
  readonly muted: string;
  readonly mutedStrong: string;
  readonly accent: string;
  readonly link: string;
  readonly error: string;
  readonly errorInk: string;
  readonly success: string;
  readonly warning: string;
}

export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: ThemeSourceKind;
  readonly sourceLabel: string;
  readonly version?: string;
  readonly license?: string;
  readonly installedAt?: string;
  readonly palettes: Readonly<Record<ThemePaletteMode, SemanticThemePalette>>;
}

export interface ThemeGallerySnapshot {
  readonly selectedThemeId: string;
  readonly builtIns: readonly ThemeDefinition[];
  readonly installed: readonly ThemeDefinition[];
  readonly countLimit: number;
  readonly byteLimit: number;
}

export interface OpenVsxThemeSearchResult {
  readonly namespace: string;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly license?: string;
  readonly downloadUrl: string;
  readonly sha256?: string;
  readonly verified: boolean;
}

const CSS_VARIABLES: Readonly<Record<keyof SemanticThemePalette, string>> = {
  window: "--window", sidebar: "--sidebar", main: "--main", surface: "--surface",
  surfaceMuted: "--surface-muted", line: "--line", lineStrong: "--line-strong",
  text: "--text", textStrong: "--text-strong", muted: "--muted", mutedStrong: "--muted-strong",
  accent: "--accent", link: "--link", error: "--error", errorInk: "--error-ink",
  success: "--success", warning: "--warning",
};

export function applyThemeDefinition(theme: ThemeDefinition, mode: ThemePaletteMode): void {
  const palette = theme.palettes[mode];
  for (const [key, variable] of Object.entries(CSS_VARIABLES) as [keyof SemanticThemePalette, string][]) {
    document.documentElement.style.setProperty(variable, palette[key]);
  }
  document.documentElement.dataset.paletteId = theme.id;
  window.dispatchEvent(new CustomEvent("pi-gui:theme-palette-changed", { detail: { themeId: theme.id, mode } }));
}

export function clearThemeDefinition(): void {
  for (const variable of Object.values(CSS_VARIABLES)) document.documentElement.style.removeProperty(variable);
  delete document.documentElement.dataset.paletteId;
}
