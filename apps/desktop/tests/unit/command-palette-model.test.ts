import { describe, expect, it } from "vitest";
import {
  COMMAND_PALETTE_RESULT_LIMIT,
  type CommandPaletteAction,
  filterCommandPaletteActions,
  firstEnabledAction,
  resolveCommandPaletteActions,
} from "../../src/command-palette-model";

const noop = () => undefined;

const actions: readonly CommandPaletteAction[] = [
  {
    id: "new",
    title: "New Thread",
    subtitle: "Start fresh",
    keywords: ["compose", "session"],
    run: noop,
  },
  {
    id: "settings",
    title: "Settings",
    subtitle: "Models and providers",
    keywords: ["preferences", "auth"],
    run: noop,
  },
  {
    id: "disabled",
    title: "Disabled Action",
    keywords: ["hidden"],
    disabled: true,
    run: noop,
  },
];

describe("filterCommandPaletteActions", () => {
  it("returns every action for an empty query", () => {
    expect(filterCommandPaletteActions(actions, "   ")).toBe(actions);
  });

  it("matches query terms across title, subtitle, and keywords", () => {
    expect(filterCommandPaletteActions(actions, "model provider").map((action) => action.id)).toEqual(["settings"]);
    expect(filterCommandPaletteActions(actions, "fresh compose").map((action) => action.id)).toEqual(["new"]);
  });

  it("normalizes case and whitespace", () => {
    expect(filterCommandPaletteActions(actions, "  NEW   session ").map((action) => action.id)).toEqual(["new"]);
  });

  it("bounds rendered results while searching a large command index", () => {
    const largeIndex = Array.from({ length: 20_000 }, (_, index): CommandPaletteAction => ({
      id: `thread-${index}`,
      title: `Indexed thread ${index}`,
      subtitle: "Large history fixture",
      category: "Threads",
      keywords: ["workspace", `branch-${index}`],
      run: noop,
    }));

    const empty = resolveCommandPaletteActions(largeIndex, "");
    expect(empty.actions).toHaveLength(COMMAND_PALETTE_RESULT_LIMIT);
    expect(empty.hasMore).toBe(true);

    const broad = resolveCommandPaletteActions(largeIndex, "indexed thread");
    expect(broad.actions).toHaveLength(COMMAND_PALETTE_RESULT_LIMIT);
    expect(broad.hasMore).toBe(true);
    expect(broad.actions[0]?.id).toBe("thread-0");

    const narrow = resolveCommandPaletteActions(largeIndex, "branch-19999");
    expect(narrow.actions.map((action) => action.id)).toEqual(["thread-19999"]);
    expect(narrow.hasMore).toBe(false);
  });
});

describe("firstEnabledAction", () => {
  it("skips disabled actions", () => {
    expect(firstEnabledAction([actions[2]!, actions[0]!, actions[1]!])?.id).toBe("new");
  });
});
