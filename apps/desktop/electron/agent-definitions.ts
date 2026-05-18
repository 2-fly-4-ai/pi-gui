import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type {
  AgentDefinitionConfig,
  AgentDefinitionRecord,
  AgentDefinitionScope,
  DeleteAgentDefinitionInput,
  AgentDefinitionsSnapshot,
  AgentThinkingLevel,
  AgentToolName,
  ResetAgentDefinitionInput,
  SaveAgentDefinitionInput,
} from "../src/agent-definitions";
import { BUILTIN_AGENT_CONFIGS, CANONICAL_SUBAGENT_ROLES, LEGACY_AGENT_ALIAS_ORDER } from "../src/agent-definitions";

type FrontmatterValue = string | boolean | number | readonly string[];
type FrontmatterRecord = Record<string, FrontmatterValue>;

const BUILTIN_TOOL_NAMES: readonly AgentToolName[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_LEVELS: readonly AgentThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const AGENT_SORT_ORDER: readonly string[] = [...CANONICAL_SUBAGENT_ROLES, ...LEGACY_AGENT_ALIAS_ORDER];
const KNOWN_FRONTMATTER_KEYS = new Set([
  "description",
  "display_name",
  "tools",
  "extensions",
  "skills",
  "model",
  "thinking",
  "prompt_mode",
  "system_prompt_mode",
  "context_mode",
  "inherit_project_context",
  "fallback_models",
  "output",
  "default_reads",
  "default_progress",
  "max_turns",
  "max_subagent_depth",
  "inherit_context",
  "run_in_background",
  "isolated",
  "isolation",
  "enabled",
  "role",
]);

export async function listAgentDefinitions(workspacePath: string | undefined): Promise<AgentDefinitionsSnapshot> {
  const globalAgentsDir = join(resolveAgentDir(), "agents");
  const projectAgentsDir = workspacePath ? join(workspacePath, ".pi", "agents") : undefined;
  const globalRecords = await readAgentDir(globalAgentsDir, "global");
  const projectRecords = projectAgentsDir ? await readAgentDir(projectAgentsDir, "project") : [];

  const merged = new Map<string, AgentDefinitionRecord>();
  for (const config of BUILTIN_AGENT_CONFIGS) {
    merged.set(config.name, {
      name: config.name,
      source: "builtin",
      builtin: true,
      overridden: false,
      config,
      warnings: [],
    });
  }
  for (const record of globalRecords) merged.set(record.name, record);
  for (const record of projectRecords) merged.set(record.name, record);

  return {
    globalAgentsDir,
    ...(projectAgentsDir ? { projectAgentsDir } : {}),
    agents: [...merged.values()].sort(
      (left, right) => rankAgent(left.name) - rankAgent(right.name) || left.name.localeCompare(right.name),
    ),
  };
}

export async function saveAgentDefinition(
  workspacePath: string | undefined,
  input: SaveAgentDefinitionInput,
): Promise<AgentDefinitionsSnapshot> {
  validateSaveInput(input);
  const dir = resolveScopeDir(workspacePath, input.scope);
  const path = safeAgentPath(dir, input.config.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path, serializeAgentDefinition(input.config), "utf8");
  return listAgentDefinitions(workspacePath);
}

export async function resetAgentDefinition(
  workspacePath: string | undefined,
  input: ResetAgentDefinitionInput,
): Promise<AgentDefinitionsSnapshot> {
  validateResetInput(input);
  const dir = resolveScopeDir(workspacePath, input.scope);
  const path = safeAgentPath(dir, input.name);
  await rm(path, { force: true });
  return listAgentDefinitions(workspacePath);
}

export async function deleteAgentDefinition(
  workspacePath: string | undefined,
  input: DeleteAgentDefinitionInput,
): Promise<AgentDefinitionsSnapshot> {
  validateResetInput(input);
  if (isBuiltin(input.name)) {
    throw new Error("Built-in agents can be reset, not deleted.");
  }
  const dir = resolveScopeDir(workspacePath, input.scope);
  const path = safeAgentPath(dir, input.name);
  await rm(path, { force: true });
  return listAgentDefinitions(workspacePath);
}

function resolveAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent");
}

function resolveScopeDir(workspacePath: string | undefined, scope: AgentDefinitionScope): string {
  if (scope === "global") {
    return join(resolveAgentDir(), "agents");
  }
  if (!workspacePath) {
    throw new Error("Project agent settings require a workspace.");
  }
  return join(workspacePath, ".pi", "agents");
}

function safeAgentPath(dir: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid agent name: ${name}`);
  }
  const resolvedDir = resolve(dir);
  const resolvedPath = resolve(resolvedDir, `${name}.md`);
  if (!resolvedPath.startsWith(resolvedDir + sep)) {
    throw new Error("Agent path escapes agent directory.");
  }
  return resolvedPath;
}

async function readAgentDir(dir: string, scope: AgentDefinitionScope): Promise<AgentDefinitionRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const records: AgentDefinitionRecord[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    const name = basename(entry, ".md");
    const path = safeAgentPath(dir, name);
    try {
      const raw = await readFile(path, "utf8");
      const config = parseAgentDefinition(name, raw);
      records.push({
        name,
        source: scope,
        scope,
        path,
        builtin: isBuiltin(name),
        overridden: isBuiltin(name),
        config,
        warnings: [],
      });
    } catch (error) {
      records.push({
        name,
        source: scope,
        scope,
        path,
        builtin: isBuiltin(name),
        overridden: isBuiltin(name),
        config: fallbackConfig(name),
        warnings: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return records;
}

function parseAgentDefinition(name: string, raw: string): AgentDefinitionConfig {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatterSource = match?.[1] ?? "";
  const frontmatter = match ? parseFrontmatter(frontmatterSource) : {};
  const body = match ? (match[2] ?? "").trim() : raw.trim();
  const model = typeof frontmatter.model === "string" ? parseModel(frontmatter.model) : undefined;
  const thinking = typeof frontmatter.thinking === "string" && isThinkingLevel(frontmatter.thinking)
    ? frontmatter.thinking
    : undefined;
  const extraFrontmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => !KNOWN_FRONTMATTER_KEYS.has(key)),
  );
  const extraFrontmatterLines = collectUnknownFrontmatterLines(frontmatterSource);
  const contextMode = parseContextMode(frontmatter.context_mode);
  const output = parseOutputMode(frontmatter.output);
  const defaultProgress = parseProgressMode(frontmatter.default_progress);
  const maxSubagentDepth = parseOptionalMaxSubagentDepth(frontmatter.max_subagent_depth);
  const maxTurns = parsePositiveInteger(frontmatter.max_turns);

  return {
    name,
    ...(typeof frontmatter.display_name === "string" ? { displayName: frontmatter.display_name } : {}),
    description: typeof frontmatter.description === "string" ? frontmatter.description : name,
    modelMode: model ? "fixed" : "inherit",
    ...(model ? { model } : {}),
    thinkingMode: thinking ? "fixed" : "inherit",
    ...(thinking ? { thinking } : {}),
    ...(typeof frontmatter.tools === "string" ? { tools: parseTools(frontmatter.tools) } : {}),
    extensions: isFalseFrontmatterValue(frontmatter.extensions) ? false : true,
    skills: isFalseFrontmatterValue(frontmatter.skills) ? false : true,
    promptMode: frontmatter.prompt_mode === "append" ? "append" : "replace",
    ...(typeof frontmatter.role === "string" ? { role: frontmatter.role } : {}),
    ...(frontmatter.system_prompt_mode === "append" || frontmatter.system_prompt_mode === "replace"
      ? { systemPromptMode: frontmatter.system_prompt_mode }
      : {}),
    ...(contextMode ? { contextMode } : {}),
    ...(typeof frontmatter.inherit_project_context === "boolean"
      ? { inheritProjectContext: frontmatter.inherit_project_context }
      : {}),
    ...(typeof frontmatter.fallback_models === "string"
      ? { fallbackModels: parseModelList(frontmatter.fallback_models) }
      : {}),
    ...(output ? { output } : {}),
    ...(typeof frontmatter.default_reads === "string"
      ? { defaultReads: parseStringList(frontmatter.default_reads) }
      : {}),
    ...(defaultProgress ? { defaultProgress } : {}),
    ...(maxSubagentDepth !== undefined ? { maxSubagentDepth } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(typeof frontmatter.inherit_context === "boolean" ? { inheritContext: frontmatter.inherit_context } : {}),
    ...(typeof frontmatter.run_in_background === "boolean" ? { runInBackground: frontmatter.run_in_background } : {}),
    ...(typeof frontmatter.isolated === "boolean" ? { isolated: frontmatter.isolated } : {}),
    ...(typeof frontmatter.isolation === "string" ? { isolation: frontmatter.isolation } : {}),
    ...(Object.keys(extraFrontmatter).length > 0 ? { extraFrontmatter } : {}),
    ...(extraFrontmatterLines.length > 0 ? { extraFrontmatterLines } : {}),
    enabled: isFalseFrontmatterValue(frontmatter.enabled) ? false : true,
    systemPrompt: body,
  };
}

function collectUnknownFrontmatterLines(source: string): readonly string[] {
  const lines = source.split("\n");
  const preserved: string[] = [];
  let preservingUnknownBlock = false;

  for (const line of lines) {
    const topLevelKey = parseTopLevelFrontmatterKey(line);
    if (topLevelKey) {
      preservingUnknownBlock = !KNOWN_FRONTMATTER_KEYS.has(topLevelKey);
    }
    if (preservingUnknownBlock) {
      preserved.push(line);
    }
  }

  return preserved;
}

function parseTopLevelFrontmatterKey(line: string): string | undefined {
  if (/^\s/.test(line)) return undefined;
  const index = line.indexOf(":");
  if (index <= 0) return undefined;
  const key = line.slice(0, index).trim();
  return key || undefined;
}

function parseFrontmatter(source: string): FrontmatterRecord {
  const result: FrontmatterRecord = {};
  for (const line of source.split("\n")) {
    if (/^\s/.test(line)) continue;
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    if (!key) continue;
    if (rawValue === "true") result[key] = true;
    else if (rawValue === "false") result[key] = false;
    else if (/^-?\d+$/.test(rawValue)) result[key] = Number.parseInt(rawValue, 10);
    else result[key] = parseFrontmatterString(rawValue);
  }
  return result;
}

function parseModel(value: string): { providerId: string; modelId: string } | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0) return undefined;
  const providerId = value.slice(0, slash);
  const modelId = value.slice(slash + 1);
  return providerId && modelId ? { providerId, modelId } : undefined;
}

function parseTools(value: string): readonly AgentToolName[] {
  if (value.trim() === "none") return [];
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool): tool is AgentToolName => BUILTIN_TOOL_NAMES.includes(tool as AgentToolName));
}

function parseStringList(value: string): readonly string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseModelList(value: string): readonly { providerId: string; modelId: string }[] | undefined {
  const models = parseStringList(value).flatMap((entry) => {
    const parsed = parseModel(entry);
    return parsed ? [parsed] : [];
  });
  return models.length ? models : undefined;
}

function parseContextMode(value: FrontmatterValue | undefined): "fresh" | "fork" | "project" | undefined {
  return value === "fresh" || value === "fork" || value === "project" ? value : undefined;
}

function parseOutputMode(value: FrontmatterValue | undefined): "message" | "artifact" | "both" | undefined {
  return value === "message" || value === "artifact" || value === "both" ? value : undefined;
}

function parseProgressMode(value: FrontmatterValue | undefined): "silent" | "summary" | "stream" | undefined {
  return value === "silent" || value === "summary" || value === "stream" ? value : undefined;
}

function parseOptionalMaxSubagentDepth(value: FrontmatterValue | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parsePositiveIntegerValue(value);
  if (parsed === undefined) {
    throw new Error("Invalid max_subagent_depth frontmatter value.");
  }
  return parsed;
}

function parsePositiveIntegerValue(value: FrontmatterValue | undefined): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : undefined;
  if (typeof value === "string") {
    if (!/^(0|[1-9]\d*)$/.test(value)) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

function serializeAgentDefinition(config: AgentDefinitionConfig): string {
  const lines = ["---"];
  lines.push(`description: ${quoteFrontmatterString(config.description)}`);
  if (config.displayName) lines.push(`display_name: ${quoteFrontmatterString(config.displayName)}`);
  if (config.role) lines.push(`role: ${quoteFrontmatterScalar(config.role)}`);
  if (config.systemPromptMode) lines.push(`system_prompt_mode: ${config.systemPromptMode}`);
  if (config.contextMode) lines.push(`context_mode: ${config.contextMode}`);
  if (config.inheritProjectContext !== undefined) lines.push(`inherit_project_context: ${config.inheritProjectContext}`);
  if (config.fallbackModels?.length) lines.push(`fallback_models: ${config.fallbackModels.map((model) => `${model.providerId}/${model.modelId}`).join(", ")}`);
  if (config.output) lines.push(`output: ${config.output}`);
  if (config.defaultReads?.length) lines.push(`default_reads: ${config.defaultReads.join(", ")}`);
  if (config.defaultProgress) lines.push(`default_progress: ${config.defaultProgress}`);
  if (config.maxSubagentDepth !== undefined) lines.push(`max_subagent_depth: ${config.maxSubagentDepth}`);
  if (config.extraFrontmatterLines?.length) {
    lines.push(...config.extraFrontmatterLines);
  } else {
    for (const [key, value] of Object.entries(config.extraFrontmatter ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`${key}: ${formatFrontmatterValue(value)}`);
    }
  }
  if (config.tools) lines.push(`tools: ${config.tools.length ? config.tools.join(", ") : "none"}`);
  if (!config.extensions) lines.push("extensions: false");
  if (!config.skills) lines.push("skills: false");
  if (config.modelMode === "fixed" && config.model) lines.push(`model: ${config.model.providerId}/${config.model.modelId}`);
  if (config.thinkingMode === "fixed" && config.thinking) lines.push(`thinking: ${config.thinking}`);
  lines.push(`prompt_mode: ${config.promptMode}`);
  if (config.maxTurns !== undefined) lines.push(`max_turns: ${config.maxTurns}`);
  if (config.inheritContext !== undefined) lines.push(`inherit_context: ${config.inheritContext}`);
  if (config.runInBackground !== undefined) lines.push(`run_in_background: ${config.runInBackground}`);
  if (config.isolated !== undefined) lines.push(`isolated: ${config.isolated}`);
  if (config.isolation) lines.push(`isolation: ${quoteFrontmatterString(config.isolation)}`);
  if (!config.enabled) lines.push("enabled: false");
  lines.push("---", "", config.systemPrompt.trim(), "");
  return lines.join("\n");
}

function parseFrontmatterString(value: string): string {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value.replace(/^"|"$/g, "");
    }
  }
  return value;
}

function quoteFrontmatterString(value: string): string {
  return JSON.stringify(value);
}

function quoteFrontmatterScalar(value: string): string {
  return value === value.trim() && !/["\n#{}[\]]|:\s|^[-?&*!%@`]|^(?:true|false|null|~|-?\d+(?:\.\d+)?)$/i.test(value)
    ? value
    : JSON.stringify(value);
}

function formatFrontmatterValue(value: string | boolean | number | readonly string[]): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return quoteFrontmatterScalar(value);
  return value.join(", ");
}

function parsePositiveInteger(value: FrontmatterValue | undefined): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && !/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isFalseFrontmatterValue(value: FrontmatterValue | undefined): boolean {
  return value === false || value === "false";
}

function validateSaveInput(input: SaveAgentDefinitionInput): void {
  validateScope(input.scope);
  const config = input.config;
  safeAgentPath("/tmp", config.name);
  if (!config.description || config.description.length > 1_000) throw new Error("Agent description must be 1-1000 characters.");
  if (config.displayName && config.displayName.length > 200) throw new Error("Agent display name is too long.");
  if (config.modelMode !== "inherit" && config.modelMode !== "fixed") throw new Error("Invalid agent model mode.");
  if (config.modelMode === "fixed" && (!config.model?.providerId || !config.model.modelId)) throw new Error("Fixed agent model requires provider and model IDs.");
  if (config.thinkingMode !== "inherit" && config.thinkingMode !== "fixed") throw new Error("Invalid agent thinking mode.");
  if (config.thinking && !isThinkingLevel(config.thinking)) throw new Error("Invalid agent thinking level.");
  if (config.promptMode !== "append" && config.promptMode !== "replace") throw new Error("Invalid agent prompt mode.");
  if (config.systemPromptMode && config.systemPromptMode !== "append" && config.systemPromptMode !== "replace") throw new Error("Invalid subagent system prompt mode.");
  if (config.contextMode && !["fresh", "fork", "project"].includes(config.contextMode)) throw new Error("Invalid subagent context mode.");
  if (config.output && !["message", "artifact", "both"].includes(config.output)) throw new Error("Invalid subagent output mode.");
  if (config.defaultProgress && !["silent", "summary", "stream"].includes(config.defaultProgress)) throw new Error("Invalid subagent progress mode.");
  if (config.fallbackModels?.some((model) => !model.providerId || !model.modelId)) throw new Error("Fallback models require provider and model IDs.");
  for (const model of config.fallbackModels ?? []) {
    validateFrontmatterListScalar(model.providerId, "fallback model provider");
    validateFrontmatterListScalar(model.modelId, "fallback model ID");
  }
  for (const entry of config.defaultReads ?? []) {
    validateFrontmatterListScalar(entry, "default read");
  }
  if (config.tools?.some((tool) => !BUILTIN_TOOL_NAMES.includes(tool))) throw new Error("Invalid agent tool.");
  if (config.isolation && config.isolation !== "worktree") throw new Error("Invalid isolation mode.");
  if (config.enabled !== true && config.enabled !== false) throw new Error("Invalid enabled value.");
  if (config.extensions !== true && config.extensions !== false) throw new Error("Invalid extensions value.");
  if (config.skills !== true && config.skills !== false) throw new Error("Invalid skills value.");
  if (config.maxSubagentDepth !== undefined && (!Number.isInteger(config.maxSubagentDepth) || config.maxSubagentDepth < 0)) throw new Error("Max subagent depth must be a non-negative integer.");
  validateExtraFrontmatter(config);
  if (config.maxTurns !== undefined && (!Number.isInteger(config.maxTurns) || config.maxTurns <= 0)) throw new Error("Agent max turns must be a positive integer.");
  if (config.systemPrompt.length > 200_000) throw new Error("Agent system prompt is too large.");
}

function validateFrontmatterListScalar(value: string, label: string): void {
  if (/[\r\n,]/.test(value) || value.trim() === "---" || value.includes("---")) {
    throw new Error(`Invalid ${label} frontmatter value.`);
  }
}

function validateExtraFrontmatter(config: AgentDefinitionConfig): void {
  for (const key of Object.keys(config.extraFrontmatter ?? {})) {
    validateExtraFrontmatterKey(key);
  }
  for (const line of config.extraFrontmatterLines ?? []) {
    if (/[\r\n]/.test(line) || /^\s*(?:-\s*)?---\s*$/.test(line)) {
      throw new Error("Invalid preserved frontmatter line.");
    }
    const key = parseTopLevelFrontmatterKey(line);
    if (key) validateExtraFrontmatterKey(key);
  }
}

function validateExtraFrontmatterKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) || KNOWN_FRONTMATTER_KEYS.has(key)) {
    throw new Error(`Invalid preserved frontmatter key: ${key}`);
  }
}

function validateResetInput(input: ResetAgentDefinitionInput): void {
  validateScope(input.scope);
  safeAgentPath("/tmp", input.name);
}

function validateScope(scope: string): asserts scope is AgentDefinitionScope {
  if (scope !== "global" && scope !== "project") throw new Error("Invalid agent definition scope.");
}

function fallbackConfig(name: string): AgentDefinitionConfig {
  return {
    name,
    description: name,
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: "",
  };
}

function isBuiltin(name: string): boolean {
  return BUILTIN_AGENT_CONFIGS.some((agent) => agent.name === name);
}

function isThinkingLevel(value: string): value is AgentThinkingLevel {
  return THINKING_LEVELS.includes(value as AgentThinkingLevel);
}

function rankAgent(name: string): number {
  const index = AGENT_SORT_ORDER.indexOf(name);
  return index === -1 ? 100 : index;
}
