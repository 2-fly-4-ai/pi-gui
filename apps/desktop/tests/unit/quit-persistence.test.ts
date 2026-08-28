import { describe, expect, it, vi } from "vitest";
import { flushBeforeQuit } from "../../electron/quit-persistence";

describe("quit persistence", () => {
  it("waits for every durable flush", async () => {
    await expect(flushBeforeQuit([Promise.resolve(), Promise.resolve("done")], 1_000)).resolves.toBeUndefined();
  });

  it("propagates a store failure", async () => {
    await expect(flushBeforeQuit([Promise.reject(new Error("write failed"))], 1_000)).rejects.toThrow("write failed");
  });

  it("bounds a store that never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = flushBeforeQuit([new Promise(() => undefined)], 250);
      const assertion = expect(result).rejects.toThrow("Quit persistence exceeded 250ms");
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
