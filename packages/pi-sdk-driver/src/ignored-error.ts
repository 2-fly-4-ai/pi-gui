export function logIgnoredError(scope: string, error: unknown): void {
  const serialized = serializeError(error);
  console.warn("[pi-sdk-driver] ignored error", {
    scope,
    ...serialized,
  });
}

function serializeError(error: unknown): { readonly message: string; readonly stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    message: String(error),
  };
}
