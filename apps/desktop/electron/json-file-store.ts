import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class JsonFileStore<T> {
  private readonly rootDir: string;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(userDataDir: string, subdir: string) {
    this.rootDir = join(userDataDir, subdir);
  }

  async read(sessionKey: string): Promise<T | undefined> {
    try {
      const raw = await readFile(this.filePath(sessionKey), "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      if (!isMissingFileError(error)) {
        reportStoreError("read", error);
      }
      return undefined;
    }
  }

  async write(sessionKey: string, data: T): Promise<void> {
    const filePath = this.filePath(sessionKey);
    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    const previous = this.writeQueues.get(sessionKey) ?? Promise.resolve();
    const next = previous
      .catch((error) => reportStoreError("write.previous", error))
      .then(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporaryPath, serialized, "utf8");
          await rename(temporaryPath, filePath);
        } finally {
          await rm(temporaryPath, { force: true }).catch((error) =>
            reportStoreError("write.cleanup", error),
          );
        }
      })
      .finally(() => {
        if (this.writeQueues.get(sessionKey) === next) {
          this.writeQueues.delete(sessionKey);
        }
      });
    this.writeQueues.set(sessionKey, next);
    await next;
  }

  private filePath(sessionKey: string): string {
    return join(this.rootDir, `${encodeURIComponent(sessionKey)}.json`);
  }
}

function reportStoreError(operation: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[json-file-store.${operation}] ${detail}`);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}
