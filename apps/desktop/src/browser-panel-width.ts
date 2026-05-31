export const BROWSER_SIDE_PANEL_WIDTH_KEY = "browser:sidePanelWidth";

const DEFAULT_BROWSER_SIDE_PANEL_WIDTH = 560;
const MIN_BROWSER_SIDE_PANEL_WIDTH = 360;
const MAX_BROWSER_SIDE_PANEL_WIDTH_RATIO = 0.72;

export function getDefaultBrowserSidePanelWidth(): number {
  const stored = Number(window.localStorage.getItem(BROWSER_SIDE_PANEL_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_BROWSER_SIDE_PANEL_WIDTH;
}

export function getMinBrowserSidePanelWidth(containerWidth: number): number {
  return Math.min(MIN_BROWSER_SIDE_PANEL_WIDTH, Math.max(280, Math.floor(containerWidth * 0.45)));
}

export function getMaxBrowserSidePanelWidth(containerWidth: number): number {
  return Math.max(getMinBrowserSidePanelWidth(containerWidth), Math.floor(containerWidth * MAX_BROWSER_SIDE_PANEL_WIDTH_RATIO));
}

export function clampBrowserSidePanelWidth(width: number, containerWidth: number): number {
  const min = getMinBrowserSidePanelWidth(containerWidth);
  const max = getMaxBrowserSidePanelWidth(containerWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function storeBrowserSidePanelWidth(width: number): void {
  window.localStorage.setItem(BROWSER_SIDE_PANEL_WIDTH_KEY, String(Math.round(width)));
}
