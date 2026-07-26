import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeDecisions,
  confirmDecision,
  hasLikelySecret,
  readProjectKnowledge,
  resolveInjectableMemory,
  saveDecision,
  saveMemory,
} from "../../src/product-experience/project-knowledge";

describe("project knowledge", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("window", new EventTarget());
  });

  it("stores only explicit records and applies scope precedence through the manifest resolver", () => {
    saveMemory({ key: "style", text: "Global", scope: "global" });
    saveMemory({ key: "style", text: "Workspace", scope: "workspace", workspaceId: "w1" });
    saveMemory({ key: "style", text: "Thread", scope: "thread", workspaceId: "w1", sessionId: "s1" });
    expect(resolveInjectableMemory({ workspaceId: "w1", sessionId: "s1" })).toHaveLength(3);
    expect(readProjectKnowledge().memory).toHaveLength(3);
  });

  it("requires confirmation before an assistant proposal influences context", () => {
    const proposal = saveDecision({
      kind: "decision",
      text: "Use the existing driver.",
      workspaceId: "w1",
      affectedScope: "Runtime",
      createdBy: "assistant-proposal",
    });
    expect(activeDecisions({ workspaceId: "w1" })).toEqual([]);
    confirmDecision(proposal.id);
    expect(activeDecisions({ workspaceId: "w1" })).toHaveLength(1);
  });

  it("rejects secret-like fixtures before persistence", () => {
    expect(hasLikelySecret("OPENAI_API_KEY=sk-abcdefghijklmnop")).toBe(true);
    expect(() => saveMemory({
      key: "provider",
      text: "OPENAI_API_KEY=sk-abcdefghijklmnop",
      scope: "global",
    })).toThrow(/not stored/);
    expect(readProjectKnowledge().memory).toEqual([]);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}
