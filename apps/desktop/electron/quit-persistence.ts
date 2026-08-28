export const QUIT_PERSISTENCE_TIMEOUT_MS = 10_000;

/**
 * Give durable stores a bounded opportunity to flush during Electron shutdown.
 * A stuck filesystem/store promise must not leave the desktop process immortal.
 */
export async function flushBeforeQuit(
  flushes: readonly Promise<unknown>[],
  timeoutMs = QUIT_PERSISTENCE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Quit persistence exceeded ${timeoutMs}ms.`)), timeoutMs);
  });
  try {
    await Promise.race([Promise.all(flushes), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
