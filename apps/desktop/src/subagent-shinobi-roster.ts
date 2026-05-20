import { useEffect, useState } from "react";
import { canonicalRoleForAgentName } from "./agent-definitions";
import subAgent01Url from "./assets/sub-agents-pngs/sub-agent-01.png";
import subAgent02Url from "./assets/sub-agents-pngs/sub-agent-02.png";
import subAgent03Url from "./assets/sub-agents-pngs/sub-agent-03.png";
import subAgent04Url from "./assets/sub-agents-pngs/sub-agent-04.png";
import subAgent05Url from "./assets/sub-agents-pngs/sub-agent-05.png";
import subAgent06Url from "./assets/sub-agents-pngs/sub-agent-06.png";
import subAgent07Url from "./assets/sub-agents-pngs/sub-agent-07.png";
import subAgent08Url from "./assets/sub-agents-pngs/sub-agent-08.png";
import subAgent09Url from "./assets/sub-agents-pngs/sub-agent-09.png";
import subAgent10Url from "./assets/sub-agents-pngs/sub-agent-10.png";
import subAgent11Url from "./assets/sub-agents-pngs/sub-agent-11.png";
import subAgent12Url from "./assets/sub-agents-pngs/sub-agent-12.png";
import subAgent13Url from "./assets/sub-agents-pngs/sub-agent-13.png";
import subAgent14Url from "./assets/sub-agents-pngs/sub-agent-14.png";
import subAgent15Url from "./assets/sub-agents-pngs/sub-agent-15.png";
import subAgent16Url from "./assets/sub-agents-pngs/sub-agent-16.png";
import subAgent17Url from "./assets/sub-agents-pngs/sub-agent-17.png";
import subAgent18Url from "./assets/sub-agents-pngs/sub-agent-18.png";
import subAgent19Url from "./assets/sub-agents-pngs/sub-agent-19.png";
import subAgent20Url from "./assets/sub-agents-pngs/sub-agent-20.png";
import subAgent21Url from "./assets/sub-agents-pngs/sub-agent-21.png";

export interface SubagentShinobiOption {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  readonly meaning: string;
  readonly imageUrl: string;
  readonly customImage?: boolean;
}

export const SUBAGENT_SHINOBI_STORAGE_KEY = "pi-gui:subagent-shinobi-map";
export const SUBAGENT_SHINOBI_CHANGED_EVENT = "pi-gui:subagent-shinobi-changed";

export const SUBAGENT_SHINOBI_ROSTER: readonly SubagentShinobiOption[] = [
  { id: "sub-agent-01", role: "scout", name: "Kagemi", meaning: "Shadow Watcher", imageUrl: subAgent01Url },
  { id: "sub-agent-02", role: "researcher", name: "Fumikage", meaning: "Shadow of Written Knowledge", imageUrl: subAgent02Url },
  { id: "sub-agent-03", role: "planner", name: "Sakusen", meaning: "Tactician", imageUrl: subAgent03Url },
  { id: "sub-agent-04", role: "worker", name: "Teshita", meaning: "Skilled Hands Beneath", imageUrl: subAgent04Url },
  { id: "sub-agent-05", role: "reviewer", name: "Mejiri", meaning: "Eye of the Rear Guard", imageUrl: subAgent05Url },
  { id: "sub-agent-06", role: "context-builder", name: "Jiban", meaning: "Ground Layer / Foundation", imageUrl: subAgent06Url },
  { id: "sub-agent-07", role: "oracle", name: "Shireisha", meaning: "Commander of Truth", imageUrl: subAgent07Url },
  { id: "sub-agent-08", role: "delegate", name: "Kogarashi", meaning: "Little Wind Messenger", imageUrl: subAgent08Url },
  { id: "sub-agent-09", role: "architect", name: "Sekkei", meaning: "The Designer / Blueprint Mind", imageUrl: subAgent09Url },
  { id: "sub-agent-11", role: "debugger", name: "Naoshi", meaning: "The Fixer / Corrector", imageUrl: subAgent11Url },
  { id: "sub-agent-12", role: "archivist", name: "Kiroku", meaning: "Keeper of Records", imageUrl: subAgent12Url },
  { id: "sub-agent-13", role: "guardian", name: "Mamori", meaning: "Protector / Keeper of the Gate", imageUrl: subAgent13Url },
  { id: "sub-agent-15", role: "crawler", name: "Tobikage", meaning: "Flying Shadow", imageUrl: subAgent15Url },
  { id: "sub-agent-16", role: "coverage", name: "Mezame", meaning: "The Awakening Eye", imageUrl: subAgent16Url },
  { id: "sub-agent-17", role: "contract", name: "Keiyaku", meaning: "Keeper of Promises", imageUrl: subAgent17Url },
  { id: "sub-agent-18", role: "changelog", name: "Kiseki", meaning: "Tracer of Paths", imageUrl: subAgent18Url },
  { id: "sub-agent-14", role: "monitor", name: "Metsuke", meaning: "Eye of the Keep", imageUrl: subAgent14Url },
  { id: "sub-agent-19", role: "docs-writer", name: "TBD", meaning: "Writes and maintains documentation", imageUrl: subAgent19Url },
  { id: "sub-agent-20", role: "testing", name: "TBD", meaning: "Runs tests and surfaces flaky failures", imageUrl: subAgent20Url },
  { id: "sub-agent-21", role: "stream-shadow", name: "Nagarekage", meaning: "Stream Shadow", imageUrl: subAgent21Url },
];

const DEFAULT_SUBAGENT_SHINOBI: SubagentShinobiOption = SUBAGENT_SHINOBI_ROSTER[0] ?? {
  id: "sub-agent-01",
  role: "scout",
  name: "Kagemi",
  meaning: "Shadow Watcher",
  imageUrl: subAgent01Url,
};

export function defaultShinobiForSubagentRole(role: string): SubagentShinobiOption {
  const canonicalRole = canonicalRoleForAgentName(baseSubagentRole(role), baseSubagentRole(role));
  return SUBAGENT_SHINOBI_ROSTER.find((option) => option.role === canonicalRole) ?? DEFAULT_SUBAGENT_SHINOBI;
}

export function getSubagentShinobiById(id: string | undefined): SubagentShinobiOption | undefined {
  return SUBAGENT_SHINOBI_ROSTER.find((option) => option.id === id);
}

export function baseSubagentRole(role: string): string {
  return role.split("/")[0]?.trim() || role;
}

export function readSubagentShinobiMap(): Readonly<Record<string, string>> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SUBAGENT_SHINOBI_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function resolveSubagentShinobiFromMap(
  map: Readonly<Record<string, string>>,
  agentKey: string,
  role: string,
): SubagentShinobiOption {
  const baseRole = baseSubagentRole(role);
  const canonicalRole = canonicalRoleForAgentName(baseRole, baseRole);
  const defaultShinobi = defaultShinobiForSubagentRole(canonicalRole);
  const configured = map[agentKey] ?? map[baseRole] ?? map[canonicalRole];
  if (!configured) return defaultShinobi;

  if (configured.startsWith("data:image/")) {
    return { ...defaultShinobi, imageUrl: configured, customImage: true };
  }

  return getSubagentShinobiById(configured) ?? defaultShinobi;
}

export function resolveSubagentShinobi(agentKey: string, role: string): SubagentShinobiOption {
  return resolveSubagentShinobiFromMap(readSubagentShinobiMap(), agentKey, role);
}

export function writeSubagentShinobiImage(agentKey: string, imageUrl: string): void {
  if (typeof window === "undefined") return;
  const current = readSubagentShinobiMap();
  const next = { ...current, [agentKey]: imageUrl };
  window.localStorage.setItem(SUBAGENT_SHINOBI_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SUBAGENT_SHINOBI_CHANGED_EVENT, { detail: { agentKey } }));
}

export function resetSubagentShinobiImage(agentKey: string): void {
  if (typeof window === "undefined") return;
  const { [agentKey]: _removed, ...next } = readSubagentShinobiMap();
  void _removed;
  window.localStorage.setItem(SUBAGENT_SHINOBI_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SUBAGENT_SHINOBI_CHANGED_EVENT, { detail: { agentKey } }));
}

export function useSubagentShinobiMap(): readonly [
  Readonly<Record<string, string>>,
  (agentKey: string, imageUrl: string) => void,
  (agentKey: string) => void,
] {
  const [map, setMap] = useState<Readonly<Record<string, string>>>(() => readSubagentShinobiMap());

  useEffect(() => {
    const refresh = () => setMap(readSubagentShinobiMap());
    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === SUBAGENT_SHINOBI_STORAGE_KEY) refresh();
    };
    window.addEventListener(SUBAGENT_SHINOBI_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refreshFromStorage);
    return () => {
      window.removeEventListener(SUBAGENT_SHINOBI_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refreshFromStorage);
    };
  }, []);

  const selectImage = (agentKey: string, imageUrl: string) => {
    writeSubagentShinobiImage(agentKey, imageUrl);
    setMap(readSubagentShinobiMap());
  };

  const resetImage = (agentKey: string) => {
    resetSubagentShinobiImage(agentKey);
    setMap(readSubagentShinobiMap());
  };

  return [map, selectImage, resetImage];
}
