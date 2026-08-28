import { describe, expect, it } from "vitest";
import { withStartupTimeout } from "../../electron/startup-guard";

describe("withStartupTimeout", () => {
  it("returns a completed startup operation", async () => {
    await expect(withStartupTimeout(Promise.resolve("ready"), "test", 20)).resolves.toBe("ready");
  });

  it("preserves an operation failure", async () => {
    await expect(withStartupTimeout(Promise.reject(new Error("broken")), "test", 20)).rejects.toThrow("broken");
  });

  it("rejects a startup operation that never settles", async () => {
    await expect(withStartupTimeout(new Promise(() => undefined), "catalog sync", 5)).rejects.toThrow(
      'Desktop startup stage "catalog sync" exceeded 5ms.',
    );
  });
});
