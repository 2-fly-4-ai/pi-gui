import type { RuntimeSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";

export type AgentDefinitionScope = "global" | "project";
export type AgentDefinitionSource = "builtin" | "global" | "project";
export type AgentDefinitionModelMode = "inherit" | "fixed";
export type AgentDefinitionThinkingMode = "inherit" | "fixed";
export type AgentToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
export const CANONICAL_SUBAGENT_ROLES = [
  "delegate",
  "scout",
  "planner",
  "worker",
  "reviewer",
  "oracle",
  "researcher",
  "context-builder",
] as const;

export type CanonicalSubagentRoleName = (typeof CANONICAL_SUBAGENT_ROLES)[number];
// Custom markdown definitions may declare non-canonical role names; helpers below only treat known presets as canonical.
export type SubagentRoleName = CanonicalSubagentRoleName | string;
export type SubagentContextMode = "fresh" | "fork" | "project";
export type SubagentOutputMode = "message" | "artifact" | "both";
export type SubagentProgressMode = "silent" | "summary" | "stream";

export interface SubagentModelRef {
  readonly providerId: string;
  readonly modelId: string;
}

export interface AgentDefinitionExtraFrontmatter {
  readonly [key: string]: string | boolean | number | readonly string[];
}

export type AgentThinkingLevel = NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]> | "off" | "minimal";

export interface AgentDefinitionConfig {
  readonly name: string;
  readonly displayName?: string;
  readonly description: string;
  readonly modelMode: AgentDefinitionModelMode;
  readonly model?: {
    readonly providerId: string;
    readonly modelId: string;
  };
  readonly thinkingMode: AgentDefinitionThinkingMode;
  readonly thinking?: AgentThinkingLevel;
  readonly tools?: readonly AgentToolName[];
  readonly extensions: true | false;
  readonly skills: true | false;
  readonly promptMode: "append" | "replace";
  readonly role?: SubagentRoleName;
  readonly systemPromptMode?: "append" | "replace";
  readonly contextMode?: SubagentContextMode;
  readonly inheritProjectContext?: boolean;
  readonly fallbackModels?: readonly SubagentModelRef[];
  readonly output?: SubagentOutputMode;
  readonly defaultReads?: readonly string[];
  readonly defaultProgress?: SubagentProgressMode;
  readonly maxSubagentDepth?: number;
  readonly extraFrontmatter?: AgentDefinitionExtraFrontmatter;
  readonly maxTurns?: number;
  readonly inheritContext?: boolean;
  readonly runInBackground?: boolean;
  readonly isolated?: boolean;
  readonly isolation?: string;
  readonly enabled: boolean;
  readonly systemPrompt: string;
}

export interface AgentDefinitionRecord {
  readonly name: string;
  readonly source: AgentDefinitionSource;
  readonly scope?: AgentDefinitionScope;
  readonly path?: string;
  readonly builtin: boolean;
  readonly overridden: boolean;
  readonly config: AgentDefinitionConfig;
  readonly warnings: readonly string[];
}

export interface AgentDefinitionsSnapshot {
  readonly globalAgentsDir: string;
  readonly projectAgentsDir?: string;
  readonly agents: readonly AgentDefinitionRecord[];
}

export interface SaveAgentDefinitionInput {
  readonly scope: AgentDefinitionScope;
  readonly config: AgentDefinitionConfig;
}

export interface ResetAgentDefinitionInput {
  readonly scope: AgentDefinitionScope;
  readonly name: string;
}

export interface DeleteAgentDefinitionInput {
  readonly scope: AgentDefinitionScope;
  readonly name: string;
}

export const LEGACY_AGENT_ALIAS_ORDER = ["general-purpose", "Explore", "Plan"] as const;

export const LEGACY_AGENT_ALIASES: Readonly<Record<(typeof LEGACY_AGENT_ALIAS_ORDER)[number], CanonicalSubagentRoleName>> = {
  "general-purpose": "delegate",
  Explore: "scout",
  Plan: "planner",
};

export function isCanonicalSubagentRoleName(role: string | undefined): role is CanonicalSubagentRoleName {
  return CANONICAL_SUBAGENT_ROLES.includes(role as CanonicalSubagentRoleName);
}

export function legacyAgentAliasForName(name: string): CanonicalSubagentRoleName | undefined {
  return LEGACY_AGENT_ALIAS_ORDER.includes(name as (typeof LEGACY_AGENT_ALIAS_ORDER)[number])
    ? LEGACY_AGENT_ALIASES[name as (typeof LEGACY_AGENT_ALIAS_ORDER)[number]]
    : undefined;
}

export function canonicalRoleForAgentName(name: string, configuredRole?: string): string {
  return isCanonicalSubagentRoleName(configuredRole) ? configuredRole : legacyAgentAliasForName(name) || name;
}

export const BUILTIN_AGENT_NAMES = [...CANONICAL_SUBAGENT_ROLES, ...LEGACY_AGENT_ALIAS_ORDER] as const;

export const READ_ONLY_AGENT_TOOLS: readonly AgentToolName[] = ["read", "bash", "grep", "find", "ls"];

export const AGENT_TOOL_OPTIONS: readonly { readonly name: AgentToolName; readonly label: string; readonly description: string }[] = [
  { name: "read", label: "Read", description: "Read files" },
  { name: "bash", label: "Bash", description: "Run shell commands" },
  { name: "grep", label: "Grep", description: "Search file contents" },
  { name: "find", label: "Find", description: "Find files by glob" },
  { name: "ls", label: "List", description: "List directories" },
  { name: "edit", label: "Edit", description: "Edit files" },
  { name: "write", label: "Write", description: "Create or overwrite files" },
];

export const DEFAULT_CUSTOM_AGENT_PROMPT = `You are a focused specialist agent.

Use the repository context and available tools to complete the delegated task.
Be concise, cite files when relevant, and stop when the task is complete.`;

export function createDefaultCustomAgentConfig(): AgentDefinitionConfig {
  return {
    name: "",
    displayName: "",
    description: "Specialist agent for delegated tasks",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: DEFAULT_CUSTOM_AGENT_PROMPT,
  };
}

export function duplicateAgentConfig(config: AgentDefinitionConfig): AgentDefinitionConfig {
  return {
    ...config,
    name: "",
    displayName: config.displayName ? `${config.displayName} Copy` : `${config.name} Copy`,
    description: config.description,
  };
}

export const DEFAULT_GENERAL_PURPOSE_PROMPT = "";

export const DEFAULT_EXPLORE_PROMPT = `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a file search specialist. You excel at thoroughly navigating and exploring codebases.
Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Use Bash ONLY for read-only operations: ls, git status, git log, git diff, find, cat, head, tail.

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations
- Make independent tool calls in parallel for efficiency
- Adapt search approach based on thoroughness level specified

# Output
- Use absolute file paths in all references
- Report findings as regular messages
- Do not use emojis
- Be thorough and precise`;

export const DEFAULT_PLAN_PROMPT = `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a software architect and planning specialist.
Your role is EXCLUSIVELY to explore the codebase and design implementation plans.
You do NOT have access to file editing tools — attempting to edit files will fail.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

# Planning Process
1. Understand requirements
2. Explore thoroughly (read files, find patterns, understand architecture)
3. Design solution based on your assigned perspective
4. Detail the plan with step-by-step implementation strategy

# Requirements
- Consider trade-offs and architectural decisions
- Identify dependencies and sequencing
- Anticipate potential challenges
- Follow existing patterns where appropriate

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations

# Output Format
- Use absolute file paths
- Do not use emojis
- End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- /absolute/path/to/file.ts - [Brief reason]`;

export const DEFAULT_WORKER_PROMPT = `You are a focused implementation worker.

Complete the delegated task in the current repository. Keep changes small, follow existing patterns, run targeted verification when possible, and report exactly what changed.`;

export const DEFAULT_REVIEWER_PROMPT = `You are a strict code reviewer.

Review the delegated diff, plan, or artifact for correctness, tests, maintainability, and product fit. Return findings with severity, file references, and concrete fixes. Do not modify files.`;

export const DEFAULT_ORACLE_PROMPT = `You are an oracle agent for second opinions.

Challenge assumptions, identify hidden risks, compare alternatives, and recommend a path. Do not modify files unless explicitly asked.`;

export const DEFAULT_RESEARCHER_PROMPT = `You are a research specialist.

Find relevant documentation and source-backed facts, summarize them concisely, and cite links or file paths. Avoid implementation unless explicitly asked.`;

export const DEFAULT_CONTEXT_BUILDER_PROMPT = `You are a context builder.

Create a compact handoff artifact that captures goals, constraints, decisions, touched files, verification, and remaining risks for another agent.`;

export const BUILTIN_AGENT_CONFIGS: readonly AgentDefinitionConfig[] = [
  {
    name: "delegate",
    displayName: "Delegate",
    role: "delegate",
    description: "General-purpose delegated agent for complex tasks",
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "append",
    systemPromptMode: "append",
    contextMode: "fork",
    output: "message",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_GENERAL_PURPOSE_PROMPT,
  },
  {
    name: "scout",
    displayName: "Scout",
    role: "scout",
    description: "Fast read-only codebase reconnaissance",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "project",
    output: "artifact",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_EXPLORE_PROMPT,
  },
  {
    name: "planner",
    displayName: "Planner",
    role: "planner",
    description: "Read-only implementation planning specialist",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "project",
    output: "artifact",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_PLAN_PROMPT,
  },
  {
    name: "worker",
    displayName: "Worker",
    role: "worker",
    description: "Focused implementation specialist for delegated tasks",
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "fork",
    output: "message",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_WORKER_PROMPT,
  },
  {
    name: "reviewer",
    displayName: "Reviewer",
    role: "reviewer",
    description: "Strict review specialist for diffs, plans, and artifacts",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "project",
    output: "artifact",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_REVIEWER_PROMPT,
  },
  {
    name: "oracle",
    displayName: "Oracle",
    role: "oracle",
    description: "Second-opinion specialist for risks and alternatives",
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "fork",
    output: "message",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_ORACLE_PROMPT,
  },
  {
    name: "researcher",
    displayName: "Researcher",
    role: "researcher",
    description: "Source-backed research specialist for docs and facts",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "project",
    output: "artifact",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_RESEARCHER_PROMPT,
  },
  {
    name: "context-builder",
    displayName: "Context Builder",
    role: "context-builder",
    description: "Handoff specialist for compact project context artifacts",
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "fork",
    output: "artifact",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_CONTEXT_BUILDER_PROMPT,
  },
  {
    name: "general-purpose",
    displayName: "Agent (legacy)",
    role: "delegate",
    description: "General-purpose agent for complex, multi-step tasks",
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "append",
    systemPromptMode: "append",
    contextMode: "fork",
    output: "message",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_GENERAL_PURPOSE_PROMPT,
  },
  {
    name: "Explore",
    displayName: "Explore (legacy)",
    role: "scout",
    description: "Fast codebase exploration agent (read-only)",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "project",
    output: "artifact",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_EXPLORE_PROMPT,
  },
  {
    name: "Plan",
    displayName: "Plan (legacy)",
    role: "planner",
    description: "Software architect for implementation planning (read-only)",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    systemPromptMode: "replace",
    contextMode: "project",
    output: "artifact",
    defaultProgress: "summary",
    enabled: true,
    systemPrompt: DEFAULT_PLAN_PROMPT,
  },
];
