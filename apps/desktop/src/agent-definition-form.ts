import type { AgentDefinitionConfig, AgentDefinitionScope, AgentThinkingLevel, AgentToolName } from "./agent-definitions";

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
  readonly systemPrompt: string;
  readonly tools: readonly AgentToolName[];
  readonly extensions: boolean;
  readonly skills: boolean;
  readonly maxTurns: string;
  readonly inheritContext: boolean;
  readonly runInBackground: boolean;
  readonly isolated: boolean;
  readonly isolation: "" | "worktree";
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
    systemPrompt: input.config.systemPrompt,
    tools: input.config.tools ?? [],
    extensions: input.config.extensions,
    skills: input.config.skills,
    maxTurns: input.config.maxTurns ? String(input.config.maxTurns) : "",
    inheritContext: input.config.inheritContext ?? false,
    runInBackground: input.config.runInBackground ?? false,
    isolated: input.config.isolated ?? false,
    isolation: input.config.isolation === "worktree" ? "worktree" : "",
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
  return { valid: errors.length === 0, errors };
}

export function buildAgentDefinitionConfig(state: AgentDefinitionFormState): AgentDefinitionConfig {
  const modelParts = state.modelValue === "inherit" ? [] : state.modelValue.split(":");
  const providerId = modelParts[0] ?? "";
  const modelId = modelParts.slice(1).join(":");
  const maxTurns = state.maxTurns.trim() ? Number.parseInt(state.maxTurns, 10) : undefined;
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
    maxTurns,
    inheritContext: state.inheritContext || undefined,
    runInBackground: state.runInBackground || undefined,
    isolated: state.isolated || undefined,
    isolation: state.isolation || undefined,
    enabled: state.enabled,
    systemPrompt: state.systemPrompt.trim(),
  };
}

export function toggleAgentTool(tools: readonly AgentToolName[], tool: AgentToolName, checked: boolean): readonly AgentToolName[] {
  if (checked) {
    return tools.includes(tool) ? tools : [...tools, tool];
  }
  return tools.filter((entry) => entry !== tool);
}
