import type {
  AgentDefinitionConfig,
  AgentDefinitionScope,
  AgentThinkingLevel,
  AgentToolName,
  SubagentContextMode,
  SubagentOutputMode,
  SubagentProgressMode,
} from "./agent-definitions";

export interface AgentDefinitionFormState {
  readonly mode: "create" | "edit";
  readonly originalName?: string;
  readonly builtin: boolean;
  readonly scope: AgentDefinitionScope;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly modelValue: string;
  readonly thinkingValue: "inherit" | AgentThinkingLevel;
  readonly promptMode: "append" | "replace";
  readonly systemPromptMode: "" | "append" | "replace";
  readonly role: string;
  readonly contextMode: "" | SubagentContextMode;
  readonly output: "" | SubagentOutputMode;
  readonly defaultProgress: "" | SubagentProgressMode;
  readonly systemPrompt: string;
  readonly tools: readonly AgentToolName[];
  readonly extensions: boolean;
  readonly skills: boolean;
  readonly maxTurns: string;
  readonly inheritContext: boolean;
  readonly inheritProjectContext: boolean;
  readonly inheritProjectContextConfigured: boolean;
  readonly runInBackground: boolean;
  readonly isolated: boolean;
  readonly isolation: "" | "worktree";
  readonly maxSubagentDepth: string;
  readonly fallbackModels: string;
  readonly defaultReads: string;
  readonly extraFrontmatter: AgentDefinitionConfig["extraFrontmatter"];
  readonly extraFrontmatterLines: AgentDefinitionConfig["extraFrontmatterLines"];
}

export interface AgentDefinitionFormValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function createAgentDefinitionFormState(input: {
  readonly mode: "create" | "edit";
  readonly config: AgentDefinitionConfig;
  readonly scope: AgentDefinitionScope;
  readonly builtin: boolean;
}): AgentDefinitionFormState {
  return {
    mode: input.mode,
    originalName: input.mode === "edit" ? input.config.name : undefined,
    builtin: input.builtin,
    scope: input.scope,
    name: input.config.name,
    displayName: input.config.displayName ?? "",
    description: input.config.description,
    enabled: input.config.enabled,
    modelValue: input.config.modelMode === "fixed" && input.config.model ? `${input.config.model.providerId}:${input.config.model.modelId}` : "inherit",
    thinkingValue: input.config.thinkingMode === "fixed" && input.config.thinking ? input.config.thinking : "inherit",
    promptMode: input.config.promptMode,
    systemPromptMode: input.config.systemPromptMode ?? "",
    role: input.config.role ?? "",
    contextMode: input.config.contextMode ?? "",
    output: input.config.output ?? "",
    defaultProgress: input.config.defaultProgress ?? "",
    systemPrompt: input.config.systemPrompt,
    tools: input.config.tools ?? [],
    extensions: input.config.extensions,
    skills: input.config.skills,
    maxTurns: input.config.maxTurns ? String(input.config.maxTurns) : "",
    inheritContext: input.config.inheritContext ?? false,
    inheritProjectContext: input.config.inheritProjectContext ?? false,
    inheritProjectContextConfigured: input.config.inheritProjectContext !== undefined,
    runInBackground: input.config.runInBackground ?? false,
    isolated: input.config.isolated ?? false,
    isolation: input.config.isolation === "worktree" ? "worktree" : "",
    maxSubagentDepth: input.config.maxSubagentDepth !== undefined ? String(input.config.maxSubagentDepth) : "",
    fallbackModels: input.config.fallbackModels?.map((model) => `${model.providerId}/${model.modelId}`).join(", ") ?? "",
    defaultReads: input.config.defaultReads?.join(", ") ?? "",
    extraFrontmatter: input.config.extraFrontmatter,
    extraFrontmatterLines: input.config.extraFrontmatterLines,
  };
}

export function validateAgentDefinitionForm(state: AgentDefinitionFormState): AgentDefinitionFormValidation {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(state.name)) {
    errors.push("Agent name must start with a letter or number and use only letters, numbers, dots, underscores, or dashes.");
  }
  if (!state.description.trim()) {
    errors.push("Description is required.");
  }
  if (!state.systemPrompt.trim()) {
    errors.push("System prompt is required.");
  }
  if (state.modelValue !== "inherit") {
    const [providerId, ...modelParts] = state.modelValue.split(":");
    if (!providerId || !modelParts.join(":")) {
      errors.push("Fixed model requires a provider and model.");
    }
  }
  if (state.maxTurns.trim()) {
    const parsed = Number.parseInt(state.maxTurns, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push("Max turns must be a positive integer.");
    }
  }
  if (state.maxSubagentDepth.trim()) {
    if (!/^(0|[1-9]\d*)$/.test(state.maxSubagentDepth.trim())) {
      errors.push("Max subagent depth must be zero or a positive integer.");
    }
  }
  for (const model of splitCommaList(state.fallbackModels)) {
    if (!/^[^/]+\/.+$/.test(model) || hasUnsafeFrontmatterListValue(model)) {
      errors.push("Fallback models must use safe provider/model values.");
      break;
    }
  }
  for (const entry of splitCommaList(state.defaultReads)) {
    if (hasUnsafeFrontmatterListValue(entry)) {
      errors.push("Default reads must not contain frontmatter delimiters or line breaks.");
      break;
    }
  }
  return { valid: errors.length === 0, errors };
}

export function buildAgentDefinitionConfig(state: AgentDefinitionFormState): AgentDefinitionConfig {
  const modelParts = state.modelValue === "inherit" ? [] : state.modelValue.split(":");
  const providerId = modelParts[0] ?? "";
  const modelId = modelParts.slice(1).join(":");
  const maxTurns = state.maxTurns.trim() ? Number.parseInt(state.maxTurns, 10) : undefined;
  const fallbackModels = splitCommaList(state.fallbackModels).map((entry) => {
    const slash = entry.indexOf("/");
    return { providerId: entry.slice(0, slash), modelId: entry.slice(slash + 1) };
  });
  const defaultReads = splitCommaList(state.defaultReads);
  const maxSubagentDepth = state.maxSubagentDepth.trim() ? Number.parseInt(state.maxSubagentDepth, 10) : undefined;

  return {
    name: state.name.trim(),
    displayName: state.displayName.trim() || undefined,
    description: state.description.trim(),
    modelMode: state.modelValue === "inherit" ? "inherit" : "fixed",
    model: state.modelValue === "inherit" ? undefined : { providerId, modelId },
    thinkingMode: state.thinkingValue === "inherit" ? "inherit" : "fixed",
    thinking: state.thinkingValue === "inherit" ? undefined : state.thinkingValue,
    tools: state.tools,
    extensions: state.extensions,
    skills: state.skills,
    promptMode: state.promptMode,
    role: state.role.trim() || undefined,
    systemPromptMode: state.systemPromptMode || (state.mode === "create" ? state.promptMode : undefined),
    contextMode: state.contextMode || undefined,
    inheritProjectContext: state.inheritProjectContext || state.inheritProjectContextConfigured ? state.inheritProjectContext : undefined,
    fallbackModels: fallbackModels.length ? fallbackModels : undefined,
    output: state.output || undefined,
    defaultReads: defaultReads.length ? defaultReads : undefined,
    defaultProgress: state.defaultProgress || undefined,
    maxSubagentDepth,
    extraFrontmatter: state.extraFrontmatter,
    extraFrontmatterLines: state.extraFrontmatterLines,
    maxTurns,
    inheritContext: state.inheritContext || undefined,
    runInBackground: state.runInBackground || undefined,
    isolated: state.isolated || undefined,
    isolation: state.isolation || undefined,
    enabled: state.enabled,
    systemPrompt: state.systemPrompt.trim(),
  };
}

function splitCommaList(value: string): readonly string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function hasUnsafeFrontmatterListValue(value: string): boolean {
  return /[\r\n,]/.test(value) || value.trim() === "---" || value.includes("---");
}

export function toggleAgentTool(tools: readonly AgentToolName[], tool: AgentToolName, checked: boolean): readonly AgentToolName[] {
  if (checked) {
    return tools.includes(tool) ? tools : [...tools, tool];
  }
  return tools.filter((entry) => entry !== tool);
}
