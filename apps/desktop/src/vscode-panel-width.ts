export const VSCODE_SIDE_PANEL_WIDTH_KEY = "vscode:sidePanelWidth";
const LEGACY_VSCODE_WIDTH_KEYS = ["threads:vsCodeWidth", "dm:vsCodeWidth"] as const;

export function getInitialVsCodeSidePanelWidth(fallbackContainerWidth?: number): number {
  const containerWidth = fallbackContainerWidth ?? (typeof window === "undefined" ? 1440 : window.innerWidth);
  const target = Math.floor(containerWidth / 3);
  const saved = getStoredVsCodeSidePanelWidth(target);
  return clampVsCodeSidePanelWidth(saved, containerWidth);
}

export function getStoredVsCodeSidePanelWidth(fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(VSCODE_SIDE_PANEL_WIDTH_KEY));
    if (Number.isFinite(saved) && saved > 0) {
      return saved;
    }
    for (const key of LEGACY_VSCODE_WIDTH_KEYS) {
      const legacy = Number(localStorage.getItem(key));
      if (Number.isFinite(legacy) && legacy > 0) {
        localStorage.setItem(VSCODE_SIDE_PANEL_WIDTH_KEY, String(legacy));
        return legacy;
      }
    }
  } catch {
    // Ignore storage failures; callers receive the provided fallback.
  }
  return fallback;
}

export function storeVsCodeSidePanelWidth(width: number): void {
  try {
    localStorage.setItem(VSCODE_SIDE_PANEL_WIDTH_KEY, String(width));
  } catch {
    // Ignore storage failures; width still applies for the current session.
  }
}

export function getMinVsCodeSidePanelWidth(containerWidth: number): number {
  return Math.min(360, Math.max(280, Math.floor(containerWidth * 0.3)));
}

export function getMaxVsCodeSidePanelWidth(containerWidth: number): number {
  return Math.max(getMinVsCodeSidePanelWidth(containerWidth), Math.floor(containerWidth * 0.7));
}

export function clampVsCodeSidePanelWidth(width: number, containerWidth: number): number {
  return Math.max(
    getMinVsCodeSidePanelWidth(containerWidth),
    Math.min(getMaxVsCodeSidePanelWidth(containerWidth), width),
  );
}
