import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_PANEL_LAYOUT,
  readWorkspacePanelLayout,
  resetWorkspacePanelLayout,
  updateWorkspacePanelLayout,
} from "../../src/product-experience/workspace-layout";

describe("workspace panel layout", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("keeps layouts isolated per workspace and resets explicitly", () => {
    updateWorkspacePanelLayout("one", { terminalOpen: true, browserWidth: 700 });
    updateWorkspacePanelLayout("two", { logsOpen: true });
    expect(readWorkspacePanelLayout("one")).toMatchObject({ terminalOpen: true, logsOpen: false, browserWidth: 700 });
    expect(readWorkspacePanelLayout("two")).toMatchObject({ terminalOpen: false, logsOpen: true });
    expect(resetWorkspacePanelLayout("one")).toEqual(DEFAULT_WORKSPACE_PANEL_LAYOUT);
    expect(readWorkspacePanelLayout("one")).toEqual(DEFAULT_WORKSPACE_PANEL_LAYOUT);
  });

  it("clamps stale persisted sizes", () => {
    updateWorkspacePanelLayout("one", { browserWidth: 20_000, vsCodeWidth: -2, terminalHeight: 9_000 });
    expect(readWorkspacePanelLayout("one")).toMatchObject({
      browserWidth: 960,
      vsCodeWidth: 280,
      terminalHeight: 720,
    });
  });
});
