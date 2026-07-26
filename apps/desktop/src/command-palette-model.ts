export interface CommandPaletteAction {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly category?: string;
  readonly shortcut?: string;
  readonly keywords: readonly string[];
  readonly disabled?: boolean;
  readonly significant?: boolean;
  readonly run: () => void;
}

export const COMMAND_PALETTE_RESULT_LIMIT = 120;

export interface CommandPaletteResults {
  readonly actions: readonly CommandPaletteAction[];
  readonly hasMore: boolean;
}

export function filterCommandPaletteActions(
  actions: readonly CommandPaletteAction[],
  query: string,
  limit = COMMAND_PALETTE_RESULT_LIMIT,
): readonly CommandPaletteAction[] {
  return resolveCommandPaletteActions(actions, query, limit).actions;
}

export function resolveCommandPaletteActions(
  actions: readonly CommandPaletteAction[],
  query: string,
  limit = COMMAND_PALETTE_RESULT_LIMIT,
): CommandPaletteResults {
  const boundedLimit = Math.max(1, Math.floor(limit));
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return {
      actions: actions.length <= boundedLimit ? actions : actions.slice(0, boundedLimit),
      hasMore: actions.length > boundedLimit,
    };
  }
  const terms = normalizedQuery.split(" ").filter(Boolean);
  const matches: CommandPaletteAction[] = [];
  let hasMore = false;
  for (const action of actions) {
    const haystack = normalize([action.title, action.subtitle ?? "", ...action.keywords].join(" "));
    if (!terms.every((term) => haystack.includes(term))) continue;
    if (matches.length < boundedLimit) {
      matches.push(action);
    } else {
      hasMore = true;
    }
  }
  return { actions: matches, hasMore };
}

export function firstEnabledAction(actions: readonly CommandPaletteAction[]): CommandPaletteAction | undefined {
  return actions.find((action) => !action.disabled);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
