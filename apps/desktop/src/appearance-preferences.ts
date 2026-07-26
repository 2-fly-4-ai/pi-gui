export type InterfaceDensity = "comfortable" | "compact";
export type TimelineCompressionMode = "automatic" | "compact" | "expanded";

export interface AppearancePreferences {
  readonly density: InterfaceDensity;
  readonly transcriptFontSize: number;
  readonly monoFontSize: number;
  readonly timelineCompression: TimelineCompressionMode;
  readonly timelineMinimap: boolean;
  readonly successMoments: boolean;
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  density: "comfortable",
  transcriptFontSize: 15,
  monoFontSize: 13,
  timelineCompression: "automatic",
  timelineMinimap: false,
  successMoments: true,
};

const STORAGE_KEY = "pi-gui:appearance-preferences:v1";

function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.round(value)))
    : fallback;
}

export function readAppearancePreferences(): AppearancePreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<AppearancePreferences>;
    return normalizeAppearancePreferences(parsed);
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
}

export function normalizeAppearancePreferences(parsed: Partial<AppearancePreferences>): AppearancePreferences {
  return {
    density: parsed.density === "compact" ? "compact" : "comfortable",
    transcriptFontSize: bounded(parsed.transcriptFontSize, 13, 18, DEFAULT_APPEARANCE_PREFERENCES.transcriptFontSize),
    monoFontSize: bounded(parsed.monoFontSize, 11, 16, DEFAULT_APPEARANCE_PREFERENCES.monoFontSize),
    timelineCompression:
      parsed.timelineCompression === "compact" || parsed.timelineCompression === "expanded"
        ? parsed.timelineCompression
        : "automatic",
    timelineMinimap: parsed.timelineMinimap === true,
    successMoments: parsed.successMoments !== false,
  };
}

export function applyAppearancePreferences(
  preferences: AppearancePreferences,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.density = preferences.density;
  root.style.setProperty("--transcript-font-size", `${preferences.transcriptFontSize}px`);
  root.style.setProperty("--mono-font-size", `${preferences.monoFontSize}px`);
}

export function saveAppearancePreferences(preferences: AppearancePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Applying the selection for this window still provides a usable fallback.
  }
  applyAppearancePreferences(preferences);
  window.dispatchEvent(new CustomEvent("pi-gui:appearance-preferences-changed", { detail: preferences }));
}
