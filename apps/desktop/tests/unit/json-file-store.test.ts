import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonFileStore } from "../../electron/json-file-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-json-store-"));
  temporaryDirectories.push(root);
  return {
    root,
    store: new JsonFileStore<{ readonly revision: number; readonly value: string }>(
      root,
      "records",
    ),
  };
}

describe("JsonFileStore", () => {
  it("serializes concurrent writes per key so an older completion cannot win", async () => {
    const { store } = await setup();

    const first = store.write("workspace/session", {
      revision: 1,
      value: "first".repeat(100_000),
    });
    const second = store.write("workspace/session", {
      revision: 2,
      value: "latest",
    });
    await Promise.all([first, second]);

    await expect(store.read("workspace/session")).resolves.toEqual({
      revision: 2,
      value: "latest",
    });
  });

  it("leaves only the complete destination file after an atomic write", async () => {
    const { root, store } = await setup();
    await store.write("session", { revision: 1, value: "complete" });

    const names = await readdir(join(root, "records"));
    expect(names).toEqual(["session.json"]);
    expect(JSON.parse(await readFile(join(root, "records", "session.json"), "utf8")))
      .toEqual({ revision: 1, value: "complete" });
  });

  it("reports malformed JSON without replacing or deleting the original bytes", async () => {
    const { root, store } = await setup();
    await store.write("session", { revision: 1, value: "complete" });
    const filePath = join(root, "records", "session.json");
    const malformed = "{ definitely-not-json";
    await writeFile(filePath, malformed, "utf8");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(store.read("session")).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("json-file-store.read"));
    await expect(readFile(filePath, "utf8")).resolves.toBe(malformed);
  });
});
