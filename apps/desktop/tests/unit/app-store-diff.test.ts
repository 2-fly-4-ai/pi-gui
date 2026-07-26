import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getChangedFiles } from "../../electron/app-store-diff";

const execFileAsync = promisify(execFile);

describe("changed file discovery", () => {
  it("lists nested untracked files individually and resolves rename destinations", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-gui-diff-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: workspace });
    await execFileAsync("git", ["config", "user.email", "pi-gui@example.test"], { cwd: workspace });
    await execFileAsync("git", ["config", "user.name", "Pi GUI Tests"], { cwd: workspace });
    await writeFile(join(workspace, "before.ts"), "export const before = true;\n");
    await execFileAsync("git", ["add", "before.ts"], { cwd: workspace });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspace });

    await mkdir(join(workspace, "src", "nested"), { recursive: true });
    await writeFile(join(workspace, "src", "nested", "new.test.ts"), "test('nested', () => {});\n");
    await rename(join(workspace, "before.ts"), join(workspace, "after.ts"));
    await execFileAsync("git", ["add", "-A"], { cwd: workspace });
    await writeFile(join(workspace, "src", "nested", "later.ts"), "export const later = true;\n");

    const files = await getChangedFiles(workspace);
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "after.ts", status: "modified", staged: true }),
      expect.objectContaining({ path: "src/nested/new.test.ts", status: "added", staged: true }),
      expect.objectContaining({ path: "src/nested/later.ts", status: "untracked", staged: false }),
    ]));
    expect(files.some((file) => file.path.endsWith("/"))).toBe(false);
  });
});
