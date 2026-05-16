export interface CommandPaletteAction {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords: readonly string[];
  readonly disabled?: boolean;
  readonly run: () => void;
}

export function filterCommandPaletteActions(
  actions: readonly CommandPaletteAction[],
  query: string,
): readonly CommandPaletteAction[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return actions;
  }
  const terms = normalizedQuery.split(" ").filter(Boolean);
  return actions.filter((action) => {
    const haystack = normalize([action.title, action.subtitle ?? "", ...action.keywords].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

export function firstEnabledAction(actions: readonly CommandPaletteAction[]): CommandPaletteAction | undefined {
  return actions.find((action) => !action.disabled);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
