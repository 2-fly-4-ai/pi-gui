import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

export type SkillInvocationMode = "auto" | "manual" | "off";

export interface SkillCatalogEntry {
  readonly summary?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly mode?: SkillInvocationMode;
}

export interface SkillCatalogFile {
  readonly skills?: Readonly<Record<string, SkillCatalogEntry>>;
  readonly bySource?: Readonly<Record<string, SkillCatalogEntry>>;
  readonly byPath?: Readonly<Record<string, SkillCatalogEntry>>;
}

export interface SkillCatalogMatch extends SkillCatalogEntry {
  readonly source: "default" | "user" | "merged";
}

const DEFAULT_SKILL_CATALOG: SkillCatalogFile = {
  skills: {
    "using-superpowers": {
      summary: "Load the right workflow skill before acting.",
      category: "workflow",
      tags: ["workflow", "must-use", "guardrail"],
      mode: "auto",
    },
    brainstorming: {
      summary: "Turn a rough feature idea into an approved design.",
      category: "planning",
      tags: ["planning", "requirements", "high-ceremony"],
      mode: "auto",
    },
    "writing-plans": {
      summary: "Write a step-by-step implementation plan.",
      category: "planning",
      tags: ["planning", "implementation", "handoff"],
    },
    "new-task": {
      summary: "Define scope, non-goals, and acceptance criteria.",
      category: "planning",
      tags: ["scope", "acceptance-criteria", "workflow"],
    },
    verify: {
      summary: "Run the right checks before calling work done.",
      category: "verification",
      tags: ["testing", "playwright", "electron"],
    },
    diagnose: {
      summary: "Debug hard bugs with a disciplined diagnosis loop.",
      category: "debug",
      tags: ["debugging", "regression", "instrumentation"],
    },
    review: {
      summary: "Review changes against standards and spec.",
      category: "review",
      tags: ["code-review", "standards", "spec"],
      mode: "manual",
    },
    "code-simplify": {
      summary: "Refactor working code for clarity without behavior changes.",
      category: "code",
      tags: ["refactor", "readability", "cleanup"],
    },
    "refactor-code": {
      summary: "Improve code structure while preserving behavior.",
      category: "code",
      tags: ["refactor", "architecture", "tests"],
    },
    "frontend-design": {
      summary: "Design and build distinctive production frontend UI.",
      category: "frontend",
      tags: ["frontend", "design", "react"],
    },
    handoff: {
      summary: "Compress the current work into a handoff document.",
      category: "workflow",
      tags: ["handoff", "context", "session"],
      mode: "manual",
    },
    cloudflare: {
      summary: "Use Cloudflare platform docs and best practices.",
      category: "cloudflare",
      tags: ["cloudflare", "workers", "docs"],
    },
    wrangler: {
      summary: "Use Wrangler commands correctly for Cloudflare projects.",
      category: "cloudflare",
      tags: ["wrangler", "cloudflare", "cli"],
    },
    "durable-objects": {
      summary: "Build and review Cloudflare Durable Objects.",
      category: "cloudflare",
      tags: ["durable-objects", "sqlite", "workers"],
    },
    "workers-best-practices": {
      summary: "Review Cloudflare Workers for production anti-patterns.",
      category: "cloudflare",
      tags: ["workers", "best-practices", "review"],
    },
    "agents-sdk": {
      summary: "Build stateful agents on Cloudflare Workers.",
      category: "cloudflare",
      tags: ["agents-sdk", "workers", "stateful"],
    },
    "pi-cli-workspace": {
      summary: "Work on Pi CLI settings, sessions, and workspace behavior.",
      category: "pi",
      tags: ["pi", "cli", "settings"],
    },
    "pi-extension-authoring": {
      summary: "Build Pi extensions, commands, tools, and package hooks.",
      category: "pi",
      tags: ["pi", "extensions", "typescript"],
    },
    "pi-package-authoring": {
      summary: "Package and distribute Pi skills, extensions, themes, and prompts.",
      category: "pi",
      tags: ["pi", "packages", "distribution"],
    },
    "pi-rpc-sdk": {
      summary: "Integrate with Pi RPC, JSON mode, and SDK sessions.",
      category: "pi",
      tags: ["pi", "rpc", "sdk"],
    },
    "pi-tui": {
      summary: "Build or debug Pi terminal UI components.",
      category: "pi",
      tags: ["pi", "tui", "terminal"],
    },
  },
};

export class SkillCatalogStore {
  private readonly filePath: string | undefined;
  private cachedUserCatalog: SkillCatalogFile | undefined;

  constructor(filePath?: string) {
    this.filePath = filePath;
  }

  async reload(): Promise<void> {
    this.cachedUserCatalog = await this.readUserCatalog();
  }

  getEntry(skill: Pick<Skill, "name" | "filePath"> & { readonly source?: string }): SkillCatalogMatch | undefined {
    const defaults = findCatalogEntry(DEFAULT_SKILL_CATALOG, skill);
    const user = findCatalogEntry(this.cachedUserCatalog ?? {}, skill);
    const merged = mergeEntries(defaults, user);
    if (!merged) {
      return undefined;
    }
    return {
      ...merged,
      source: defaults && user ? "merged" : user ? "user" : "default",
    };
  }

  modeForSkill(skill: Pick<Skill, "name" | "filePath" | "disableModelInvocation"> & { readonly source?: string }): SkillInvocationMode {
    const overrideMode = this.getEntry(skill)?.mode;
    if (overrideMode) {
      return overrideMode;
    }
    return skill.disableModelInvocation ? "manual" : "auto";
  }

  async setSkillMode(skill: Pick<Skill, "name" | "filePath"> & { readonly source?: string }, mode: SkillInvocationMode): Promise<void> {
    if (!this.filePath) {
      throw new Error("Skill catalog file path is not configured");
    }
    const current = await this.readUserCatalog();
    const byPath = { ...(current.byPath ?? {}) };
    const key = resolve(skill.filePath);
    byPath[key] = {
      ...(byPath[key] ?? {}),
      mode,
    };
    const next: SkillCatalogFile = {
      ...(current.skills ? { skills: current.skills } : {}),
      ...(current.bySource ? { bySource: current.bySource } : {}),
      byPath,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    this.cachedUserCatalog = next;
  }

  applyToSkills(skills: readonly Skill[]): Skill[] {
    return skills.flatMap((skill) => {
      const mode = this.modeForSkill(toCatalogSkill(skill));
      if (mode === "off") {
        return [];
      }
      return [{ ...skill, disableModelInvocation: mode === "manual" }];
    });
  }

  private async readUserCatalog(): Promise<SkillCatalogFile> {
    if (!this.filePath) {
      return {};
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeCatalogFile(JSON.parse(raw));
    } catch {
      return {};
    }
  }
}

export function toCatalogSkill(skill: Skill): Pick<Skill, "name" | "filePath" | "disableModelInvocation"> & { readonly source?: string } {
  return {
    name: skill.name,
    filePath: resolve(skill.filePath),
    disableModelInvocation: skill.disableModelInvocation,
    source: skill.sourceInfo.source,
  };
}

function findCatalogEntry(
  catalog: SkillCatalogFile,
  skill: Pick<Skill, "name" | "filePath"> & { readonly source?: string },
): SkillCatalogEntry | undefined {
  const pathEntry = catalog.byPath?.[resolve(skill.filePath)] ?? catalog.byPath?.[skill.filePath];
  const sourceEntry = skill.source ? catalog.bySource?.[`${skill.source}:${skill.name}`] : undefined;
  const nameEntry = catalog.skills?.[skill.name];
  return mergeEntries(nameEntry, sourceEntry, pathEntry);
}

function mergeEntries(...entries: Array<SkillCatalogEntry | undefined>): SkillCatalogEntry | undefined {
  const merged: { summary?: string; category?: string; tags?: readonly string[]; mode?: SkillInvocationMode } = {};
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.summary) merged.summary = entry.summary;
    if (entry.category) merged.category = entry.category;
    if (entry.tags) merged.tags = entry.tags;
    if (entry.mode) merged.mode = entry.mode;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeCatalogFile(value: unknown): SkillCatalogFile {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as { readonly skills?: unknown; readonly bySource?: unknown; readonly byPath?: unknown };
  return {
    ...(isEntryRecord(record.skills) ? { skills: record.skills } : {}),
    ...(isEntryRecord(record.bySource) ? { bySource: record.bySource } : {}),
    ...(isEntryRecord(record.byPath) ? { byPath: record.byPath } : {}),
  };
}

function isEntryRecord(value: unknown): value is Readonly<Record<string, SkillCatalogEntry>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as SkillCatalogEntry;
    return (!candidate.mode || candidate.mode === "auto" || candidate.mode === "manual" || candidate.mode === "off")
      && (!candidate.tags || Array.isArray(candidate.tags));
  });
}
