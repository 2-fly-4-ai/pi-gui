import type { RuntimeSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";

export type AgentDefinitionScope = "global" | "project";
export type AgentDefinitionSource = "builtin" | "global" | "project";
export type AgentDefinitionModelMode = "inherit" | "fixed";
export type AgentDefinitionThinkingMode = "inherit" | "fixed";
export type AgentToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";

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

export const BUILTIN_AGENT_NAMES = ["general-purpose", "Explore", "Plan"] as const;

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

export const BUILTIN_AGENT_CONFIGS: readonly AgentDefinitionConfig[] = [
  {
    name: "general-purpose",
    displayName: "Agent",
    description: "General-purpose agent for complex, multi-step tasks",
    modelMode: "inherit",
    thinkingMode: "inherit",
    extensions: true,
    skills: true,
    promptMode: "append",
    enabled: true,
    systemPrompt: DEFAULT_GENERAL_PURPOSE_PROMPT,
  },
  {
    name: "Explore",
    displayName: "Explore",
    description: "Fast codebase exploration agent (read-only)",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: DEFAULT_EXPLORE_PROMPT,
  },
  {
    name: "Plan",
    displayName: "Plan",
    description: "Software architect for implementation planning (read-only)",
    modelMode: "inherit",
    thinkingMode: "inherit",
    tools: READ_ONLY_AGENT_TOOLS,
    extensions: true,
    skills: true,
    promptMode: "replace",
    enabled: true,
    systemPrompt: DEFAULT_PLAN_PROMPT,
  },
];
