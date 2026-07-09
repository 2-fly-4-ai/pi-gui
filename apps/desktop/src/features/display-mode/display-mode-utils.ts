import type { SessionRecord } from "../../desktop-state";
export { summarizeDisplayModeSubagents, type DisplayModeSubagentActivity } from "../../display-mode-subagent-activity";
import { logIgnoredError } from "../../renderer-diagnostics";
import type { ChangedFile, ColumnMode, DisplayModeFilter } from "./display-mode-types";

export function threadKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

export function matchesFilter(session: SessionRecord, filter: DisplayModeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return session.status === "running";
  if (filter === "error") return session.status === "failed";
  return false;
}

export function filterLabel(filter: DisplayModeFilter): string {
  if (filter === "running") return "Running";
  if (filter === "waiting") return "Waiting";
  if (filter === "error") return "Error";
  return "All";
}

export function statusTone(session: SessionRecord): "running" | "waiting" | "error" | "idle" {
  if (session.status === "running") return "running";
  if (session.status === "failed") return "error";
  if (session.hasUnseenUpdate) return "waiting";
  return "idle";
}

export function statusLabel(session: SessionRecord): string {
  const tone = statusTone(session);
  if (tone === "running") return "Running";
  if (tone === "waiting") return "Needs reply";
  if (tone === "error") return "Error";
  return "Idle";
}

export function fileBadge(status: ChangedFile["status"]): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "untracked") return "U";
  return "M";
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function gridTemplateColumnsForMode(mode: ColumnMode): string {
  return mode === "auto"
    ? "repeat(auto-fit, minmax(min(380px, 100%), 1fr))"
    : `repeat(${mode}, minmax(0, 1fr))`;
}

export function lsGetNum(key: string, fallback: number): number {
  try {
    const value = localStorage.getItem(key);
    return value !== null ? Number(value) : fallback;
  } catch {
    return fallback;
  }
}

export function lsGetColumnMode(key: string, fallback: ColumnMode): ColumnMode {
  try {
    const value = localStorage.getItem(key);
    if (value === "auto") return "auto";
    if (value === null) return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 8 ? numeric : fallback;
  } catch {
    return fallback;
  }
}

export function lsGetBool(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value !== null ? value === "true" : fallback;
  } catch (error) {
    logIgnoredError("display-mode.readLocalStorage", error);
    return fallback;
  }
}

export function lsSet(key: string, value: number | boolean | string): void {
  try {
    localStorage.setItem(key, String(value));
  } catch (error) {
    logIgnoredError("display-mode.writeLocalStorage", error);
  }
}
