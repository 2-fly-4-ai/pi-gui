import { useEffect, useState } from "react";
import { canonicalRoleForAgentName } from "./agent-definitions";

export const SUBAGENT_ROLE_COLOR_STORAGE_KEY = "pi-gui:subagent-role-colors";
export const SUBAGENT_ROLE_COLOR_CHANGED_EVENT = "pi-gui:subagent-role-color-changed";

const DEFAULT_ROLE_COLORS: Readonly<Record<string, string>> = {
  delegate: "#2563eb",
  scout: "#06b6d4",
  researcher: "#0ea5e9",
  planner: "#8b5cf6",
  worker: "#f59e0b",
  reviewer: "#22c55e",
  oracle: "#ec4899",
  "context-builder": "#14b8a6",
  architect: "#6366f1",
  debugger: "#ef4444",
  archivist: "#a16207",
  guardian: "#84cc16",
  crawler: "#f97316",
  coverage: "#10b981",
  contract: "#eab308",
  changelog: "#38bdf8",
  monitor: "#f43f5e",
  "docs-writer": "#c084fc",
  testing: "#2dd4bf",
  "stream-shadow": "#0f766e",
};

const FALLBACK_ROLE_COLOR = "#58a6ff";

export function defaultColorForSubagentRole(role: string): string {
  return DEFAULT_ROLE_COLORS[canonicalBaseRole(role)] ?? FALLBACK_ROLE_COLOR;
}

export function baseRole(role: string): string {
  return role.split("/")[0]?.trim().toLowerCase() || role.toLowerCase();
}

export function readSubagentRoleColorMap(): Readonly<Record<string, string>> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SUBAGENT_ROLE_COLOR_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function canonicalBaseRole(role: string): string {
  const base = baseRole(role);
  return canonicalRoleForAgentName(base, base);
}

export function resolveSubagentRoleColor(map: Readonly<Record<string, string>>, agentKey: string, role: string): string {
  const canonicalRole = canonicalBaseRole(role);
  return map[agentKey] ?? map[baseRole(role)] ?? map[canonicalRole] ?? defaultColorForSubagentRole(canonicalRole);
}

export function writeSubagentRoleColor(agentKey: string, color: string): void {
  if (typeof window === "undefined") return;
  const current = readSubagentRoleColorMap();
  const next = { ...current, [agentKey]: color };
  window.localStorage.setItem(SUBAGENT_ROLE_COLOR_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SUBAGENT_ROLE_COLOR_CHANGED_EVENT, { detail: { agentKey, color } }));
}

export function resetSubagentRoleColor(agentKey: string): void {
  if (typeof window === "undefined") return;
  const { [agentKey]: _removed, ...next } = readSubagentRoleColorMap();
  void _removed;
  window.localStorage.setItem(SUBAGENT_ROLE_COLOR_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SUBAGENT_ROLE_COLOR_CHANGED_EVENT, { detail: { agentKey } }));
}

export function useSubagentRoleColorMap(): readonly [
  Readonly<Record<string, string>>,
  (agentKey: string, color: string) => void,
  (agentKey: string) => void,
] {
  const [map, setMap] = useState<Readonly<Record<string, string>>>(() => readSubagentRoleColorMap());

  useEffect(() => {
    const refresh = () => setMap(readSubagentRoleColorMap());
    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === SUBAGENT_ROLE_COLOR_STORAGE_KEY) refresh();
    };
    window.addEventListener(SUBAGENT_ROLE_COLOR_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refreshFromStorage);
    return () => {
      window.removeEventListener(SUBAGENT_ROLE_COLOR_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refreshFromStorage);
    };
  }, []);

  const setColor = (agentKey: string, color: string) => {
    writeSubagentRoleColor(agentKey, color);
    setMap(readSubagentRoleColorMap());
  };

  const resetColor = (agentKey: string) => {
    resetSubagentRoleColor(agentKey);
    setMap(readSubagentRoleColorMap());
  };

  return [map, setColor, resetColor];
}
