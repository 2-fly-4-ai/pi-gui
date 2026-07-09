import { describe, expect, it } from "vitest";
import {
  buildSlashCommandSections,
  flattenSlashSections,
  hasRuntimeSlashCommand,
  incompleteComposerCommandMessage,
  isExactSlashCommand,
  parseComposerCommand,
  resolveRuntimeCommands,
  resolveRuntimeSlashCommand,
} from "../../src/composer-commands";

const sourceInfo = {
  path: "/workspace/.codex/skills/review/SKILL.md",
  source: "project",
  scope: "project",
  origin: "top-level",
} as const;

const runtime = {
  workspace: { path: "/workspace" },
  providers: [],
  models: [],
  skills: [
    {
      name: "Review",
      description: "Review the active diff",
      filePath: "/workspace/.codex/skills/review/SKILL.md",
      baseDir: "/workspace/.codex/skills/review",
      source: "project",
      enabled: true,
      disableModelInvocation: false,
      slashCommand: "/review",
      mode: "manual",
    },
    {
      name: "Disabled",
      description: "Should stay hidden",
      filePath: "/workspace/.codex/skills/disabled/SKILL.md",
      baseDir: "/workspace/.codex/skills/disabled",
      source: "project",
      enabled: false,
      disableModelInvocation: false,
      slashCommand: "/disabled",
      mode: "manual",
    },
  ],
  skillProfiles: [],
  activeSkillProfileId: "default",
  extensions: [],
  settings: {
    enableSkillCommands: true,
    enabledModelPatterns: [],
  },
} as const;

const sessionCommands = [
  {
    name: "explain",
    description: "Explain the current selection",
    source: "prompt",
    sourceInfo,
  },
] as const;

describe("parseComposerCommand", () => {
  it("parses host commands with arguments", () => {
    expect(parseComposerCommand("/model openai gpt-5")).toEqual({
      type: "model",
      provider: "openai",
      modelId: "gpt-5",
    });
    expect(parseComposerCommand("/model openai:gpt-5")).toEqual({
      type: "model",
      provider: "openai",
      modelId: "gpt-5",
    });
    expect(parseComposerCommand("/compact keep the important decisions")).toEqual({
      type: "compact",
      customInstructions: "keep the important decisions",
    });
    expect(parseComposerCommand("/name Phase 4 planning")).toEqual({
      type: "name",
      title: "Phase 4 planning",
    });
  });

  it("rejects incomplete commands that need a selected option", () => {
    expect(parseComposerCommand("/model")).toBeUndefined();
    expect(parseComposerCommand("/thinking")).toBeUndefined();
    expect(incompleteComposerCommandMessage("/model")).toContain("Choose a provider and model");
  });
});

describe("runtime slash commands", () => {
  it("merges enabled skill commands with session commands", () => {
    expect(resolveRuntimeCommands(runtime, sessionCommands).map((command) => command.name)).toEqual([
      "explain",
      "review",
    ]);
  });

  it("respects the skill-command setting", () => {
    expect(
      resolveRuntimeCommands({ ...runtime, settings: { ...runtime.settings, enableSkillCommands: false } }, [
        ...sessionCommands,
        { name: "skill:existing", description: "Existing", source: "skill", sourceInfo },
      ]).map((command) => command.name),
    ).toEqual(["explain"]);
  });

  it("resolves slash text back to runtime commands", () => {
    expect(hasRuntimeSlashCommand("/review now", runtime, sessionCommands)).toBe(true);
    expect(resolveRuntimeSlashCommand("/explain selection", runtime, sessionCommands)?.name).toBe("explain");
  });
});

describe("buildSlashCommandSections", () => {
  it("filters host and runtime commands by slash query", () => {
    const sections = buildSlashCommandSections("/rev", runtime, sessionCommands);

    expect(flattenSlashSections(sections).map((command) => command.command)).toEqual(["/review", "/review"]);
  });

  it("can omit tree command where the surface cannot show it", () => {
    const commands = flattenSlashSections(buildSlashCommandSections("/tree", runtime, sessionCommands, [], {
      allowTreeCommand: false,
    }));

    expect(commands).toEqual([]);
  });

  it("matches exact commands case-insensitively", () => {
    const compact = flattenSlashSections(buildSlashCommandSections("/compact", runtime, sessionCommands))[0]!;

    expect(isExactSlashCommand(" /COMPACT ", compact)).toBe(true);
  });
});
