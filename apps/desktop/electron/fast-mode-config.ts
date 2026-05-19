import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { FastModeStateRecord } from "../src/desktop-state";

const PI_CODEX_FAST_CONFIG_NAME = "pi-codex-fast.json";
const DEFAULT_FAST_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
] as const;

interface FastModeConfigFile {
  readonly enabled?: unknown;
  readonly models?: unknown;
  readonly style?: unknown;
}

export function readFastModeState(): FastModeStateRecord {
  const agentDir = resolveAgentDir();
  const configPath = getFastModeConfigPath(agentDir);
  const config = readFastModeConfig(configPath);

  return {
    backend: "pi-codex-fast",
    available: true,
    enabled: config.enabled === true,
    configPath,
  };
}

export function writeFastModeEnabled(enabled: boolean): FastModeStateRecord {
  const agentDir = resolveAgentDir();
  const configPath = getFastModeConfigPath(agentDir);
  const current = readFastModeConfig(configPath);
  const next = {
    enabled,
    models: normalizeModels(current.models),
    ...(typeof current.style === "string" ? { style: current.style } : {}),
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return readFastModeState();
}

function resolveAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent");
}

function getFastModeConfigPath(agentDir: string): string {
  return join(agentDir, "extensions", PI_CODEX_FAST_CONFIG_NAME);
}

function readFastModeConfig(configPath: string): FastModeConfigFile {
  if (!existsSync(configPath)) {
    return { enabled: false, models: [...DEFAULT_FAST_MODELS] };
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : { enabled: false, models: [...DEFAULT_FAST_MODELS] };
  } catch {
    return { enabled: false, models: [...DEFAULT_FAST_MODELS] };
  }
}

function normalizeModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_FAST_MODELS];
  }
  const normalized = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return normalized.length > 0 ? normalized : [...DEFAULT_FAST_MODELS];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
