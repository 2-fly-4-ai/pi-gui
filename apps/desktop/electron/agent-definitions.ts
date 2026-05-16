import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type {
  AgentDefinitionConfig,
  AgentDefinitionRecord,
  AgentDefinitionScope,
  AgentDefinitionsSnapshot,
  AgentThinkingLevel,
  AgentToolName,
  ResetAgentDefinitionInput,
  SaveAgentDefinitionInput,
} from "../src/agent-definitions";
import { BUILTIN_AGENT_CONFIGS } from "../src/agent-definitions";

const BUILTIN_TOOL_NAMES: readonly AgentToolName[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_LEVELS: readonly AgentThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

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
  const frontmatter = match ? parseFrontmatter(match[1] ?? "") : {};
  const body = match ? (match[2] ?? "").trim() : raw.trim();
  const model = typeof frontmatter.model === "string" ? parseModel(frontmatter.model) : undefined;
  const thinking = typeof frontmatter.thinking === "string" && isThinkingLevel(frontmatter.thinking)
    ? frontmatter.thinking
    : undefined;

  return {
    name,
    ...(typeof frontmatter.display_name === "string" ? { displayName: frontmatter.display_name } : {}),
    description: typeof frontmatter.description === "string" ? frontmatter.description : name,
    modelMode: model ? "fixed" : "inherit",
    ...(model ? { model } : {}),
    thinkingMode: thinking ? "fixed" : "inherit",
    ...(thinking ? { thinking } : {}),
    ...(typeof frontmatter.tools === "string" ? { tools: parseTools(frontmatter.tools) } : {}),
    extensions: frontmatter.extensions === "false" || frontmatter.extensions === false ? false : true,
    skills: frontmatter.skills === "false" || frontmatter.skills === false ? false : true,
    promptMode: frontmatter.prompt_mode === "append" ? "append" : "replace",
    ...(typeof frontmatter.max_turns === "string" && parsePositiveInteger(frontmatter.max_turns) ? { maxTurns: parsePositiveInteger(frontmatter.max_turns) } : {}),
    ...(typeof frontmatter.inherit_context === "boolean" ? { inheritContext: frontmatter.inherit_context } : {}),
    ...(typeof frontmatter.run_in_background === "boolean" ? { runInBackground: frontmatter.run_in_background } : {}),
    ...(typeof frontmatter.isolated === "boolean" ? { isolated: frontmatter.isolated } : {}),
    ...(typeof frontmatter.isolation === "string" ? { isolation: frontmatter.isolation } : {}),
    enabled: frontmatter.enabled === "false" || frontmatter.enabled === false ? false : true,
    systemPrompt: body,
  };
}

function parseFrontmatter(source: string): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const line of source.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    if (rawValue === "true") result[key] = true;
    else if (rawValue === "false") result[key] = false;
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

function serializeAgentDefinition(config: AgentDefinitionConfig): string {
  const lines = ["---"];
  lines.push(`description: ${quoteFrontmatterString(config.description)}`);
  if (config.displayName) lines.push(`display_name: ${quoteFrontmatterString(config.displayName)}`);
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

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
  if (config.maxTurns !== undefined && (!Number.isInteger(config.maxTurns) || config.maxTurns <= 0)) throw new Error("Agent max turns must be a positive integer.");
  if (config.systemPrompt.length > 200_000) throw new Error("Agent system prompt is too large.");
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
  if (name === "general-purpose") return 0;
  if (name === "Explore") return 1;
  if (name === "Plan") return 2;
  return 10;
}
