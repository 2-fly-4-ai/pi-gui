import { describe, expect, it } from "vitest";
import {
  type CommandPaletteAction,
  filterCommandPaletteActions,
  firstEnabledAction,
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
});

describe("firstEnabledAction", () => {
  it("skips disabled actions", () => {
    expect(firstEnabledAction([actions[2]!, actions[0]!, actions[1]!])?.id).toBe("new");
  });
});
