export interface AdaptiveUsageState {
  readonly counts: Readonly<Record<string, number>>;
  readonly dismissed: readonly string[];
  readonly applied: readonly string[];
}

export interface AdaptiveRecommendation {
  readonly actionId: string;
  readonly count: number;
  readonly reason: string;
}

const EMPTY_STATE: AdaptiveUsageState = {
  counts: {},
  dismissed: [],
  applied: [],
};

export function readAdaptiveUsage(scope: string): AdaptiveUsageState {
  if (!scope || typeof localStorage === "undefined") return EMPTY_STATE;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(scope)) ?? "{}") as Partial<AdaptiveUsageState>;
    return {
      counts: normalizeCounts(value.counts),
      dismissed: normalizeIds(value.dismissed),
      applied: normalizeIds(value.applied),
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function recordAdaptiveAction(scope: string, actionId: string): AdaptiveUsageState {
  const current = readAdaptiveUsage(scope);
  const next = {
    ...current,
    counts: {
      ...current.counts,
      [actionId]: Math.min(10_000, (current.counts[actionId] ?? 0) + 1),
    },
  };
  write(scope, next);
  return next;
}

export function deriveAdaptiveRecommendation(
  state: AdaptiveUsageState,
  availableActionIds: ReadonlySet<string>,
  pinnedActionIds: ReadonlySet<string>,
): AdaptiveRecommendation | undefined {
  const dismissed = new Set(state.dismissed);
  const applied = new Set(state.applied);
  const candidate = Object.entries(state.counts)
    .filter(([id, count]) => (
      count >= 3
      && availableActionIds.has(id)
      && !pinnedActionIds.has(id)
      && !dismissed.has(id)
      && !applied.has(id)
    ))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  if (!candidate) return undefined;
  return {
    actionId: candidate[0],
    count: candidate[1],
    reason: `You opened this command ${candidate[1]} times in this workspace. Pinning keeps it near the top.`,
  };
}

export function dismissAdaptiveRecommendation(scope: string, actionId: string): AdaptiveUsageState {
  return updateDisposition(scope, actionId, "dismissed");
}

export function applyAdaptiveRecommendation(scope: string, actionId: string): AdaptiveUsageState {
  return updateDisposition(scope, actionId, "applied");
}

export function resetAdaptiveRecommendations(scope: string): void {
  if (scope && typeof localStorage !== "undefined") localStorage.removeItem(storageKey(scope));
}

function updateDisposition(
  scope: string,
  actionId: string,
  field: "dismissed" | "applied",
): AdaptiveUsageState {
  const current = readAdaptiveUsage(scope);
  const next = {
    ...current,
    [field]: [...new Set([...current[field], actionId])],
  };
  write(scope, next);
  return next;
}

function normalizeCounts(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, count]) => (
    typeof count === "number" && Number.isFinite(count) && count > 0
      ? [[id, Math.min(10_000, Math.floor(count))]]
      : []
  )));
}

function normalizeIds(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id)))]
    : [];
}

function write(scope: string, state: AdaptiveUsageState): void {
  if (!scope || typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey(scope), JSON.stringify(state));
}

function storageKey(scope: string): string {
  return `pi-gui:adaptive-interface:v1:${scope}`;
}
