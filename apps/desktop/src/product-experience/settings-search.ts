type SettingsSection = "appearance" | "general" | "providers" | "models" | "agents" | "notifications";

export interface SettingsSearchEntry {
  readonly id: string;
  readonly section: SettingsSection;
  readonly label: string;
  readonly description: string;
  readonly synonyms: readonly string[];
  readonly rowText: string;
}

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "appearance-density",
    section: "appearance",
    label: "Make text bigger",
    description: "Open appearance density and transcript font controls.",
    synonyms: ["font size", "larger text", "zoom", "density", "compact", "comfortable"],
    rowText: "Transcript text",
  },
  {
    id: "appearance-theme",
    section: "appearance",
    label: "Change light or dark theme",
    description: "Open the app theme control.",
    synonyms: ["dark mode", "light mode", "color scheme", "theme"],
    rowText: "Theme",
  },
  {
    id: "agents-model",
    section: "agents",
    label: "Choose a subagent model",
    description: "Open per-role subagent model overrides.",
    synonyms: ["subagent model", "agent model", "delegation model", "role model"],
    rowText: "Model",
  },
  {
    id: "general-crash-reports",
    section: "general",
    label: "Turn off crash reports",
    description: "Open the local native crash artifact preference.",
    synonyms: ["disable diagnostics", "crash reports", "telemetry", "privacy", "native crash"],
    rowText: "Native crash",
  },
  {
    id: "general-terminal-shell",
    section: "general",
    label: "Change terminal shell",
    description: "Open the integrated terminal shell setting.",
    synonyms: ["bash", "zsh", "terminal", "shell path"],
    rowText: "Terminal shell",
  },
  {
    id: "models-default",
    section: "models",
    label: "Change the default model",
    description: "Open the workspace model picker.",
    synonyms: ["default model", "chat model", "provider model", "thinking"],
    rowText: "Default model",
  },
  {
    id: "providers-auth",
    section: "providers",
    label: "Connect or disconnect a provider",
    description: "Open provider authentication controls.",
    synonyms: ["login", "api key", "oauth", "credentials", "provider"],
    rowText: "Provider",
  },
  {
    id: "notifications-background",
    section: "notifications",
    label: "Change background notifications",
    description: "Open completion, failure, and attention alerts.",
    synonyms: ["alerts", "turn off notifications", "completion notification", "macos notification"],
    rowText: "Background",
  },
] as const;

export function searchSettings(query: string): readonly SettingsSearchEntry[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [];
  return SETTINGS_SEARCH_ENTRIES
    .map((entry) => ({
      entry,
      haystack: normalize([entry.label, entry.description, entry.section, ...entry.synonyms].join(" ")),
    }))
    .filter(({ haystack }) => terms.every((term) => haystack.includes(term)))
    .map(({ entry }) => entry);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
