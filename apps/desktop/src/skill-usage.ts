import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { resolveRuntimeSlashCommand } from "./composer-commands";

export interface SkillUsageRecord {
  readonly count: number;
  readonly lastUsedAt?: string;
}

export type SkillUsageByPath = Readonly<Record<string, SkillUsageRecord>>;

const SKILL_USAGE_STORAGE_KEY = "pi-gui:skill-usage:v1";

export function loadSkillUsage(): SkillUsageByPath {
  try {
    const raw = window.localStorage.getItem(SKILL_USAGE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const records: Record<string, SkillUsageRecord> = {};
    for (const [path, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const candidate = value as { readonly count?: unknown; readonly lastUsedAt?: unknown };
      const count = typeof candidate.count === "number" && Number.isFinite(candidate.count)
        ? Math.max(0, Math.floor(candidate.count))
        : 0;
      const lastUsedAt = typeof candidate.lastUsedAt === "string" ? candidate.lastUsedAt : undefined;
      records[path] = lastUsedAt ? { count, lastUsedAt } : { count };
    }
    return records;
  } catch {
    return {};
  }
}

export function saveSkillUsage(records: SkillUsageByPath): void {
  try {
    window.localStorage.setItem(SKILL_USAGE_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage failures; usage stats are helpful UI metadata, not critical state.
  }
}

export function findSubmittedSkillPath(
  text: string,
  runtime: RuntimeSnapshot | undefined,
): string | undefined {
  const command = resolveRuntimeSlashCommand(text, runtime, []);
  if (command?.source !== "skill") {
    return undefined;
  }
  return command.sourceInfo.path;
}

export function recordSkillUse(
  records: SkillUsageByPath,
  filePath: string,
  usedAt = new Date(),
): SkillUsageByPath {
  const current = records[filePath];
  return {
    ...records,
    [filePath]: {
      count: (current?.count ?? 0) + 1,
      lastUsedAt: usedAt.toISOString(),
    },
  };
}
