export const STARTUP_OPERATION_TIMEOUT_MS = 15_000;

/**
 * Bound pre-window startup work so a stalled filesystem, catalog, or helper
 * operation cannot leave the desktop process alive with no recoverable UI.
 */
export async function withStartupTimeout<T>(
  operation: Promise<T>,
  stage: string,
  timeoutMs = STARTUP_OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Desktop startup stage "${stage}" exceeded ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
