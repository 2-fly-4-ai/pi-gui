import type { SessionExtensionUiStateRecord } from "./desktop-state";

export const CODEX_USAGE_EXTENSION_STATUS_KEY = "aa-codex-usage";

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function codexUsageStatusFrom(
  uiState: SessionExtensionUiStateRecord | undefined,
): string | undefined {
  const text = uiState?.statuses.find(
    (status) => status.key === CODEX_USAGE_EXTENSION_STATUS_KEY,
  )?.text;
  const normalized = text?.replace(ANSI_ESCAPE_PATTERN, "").trim();
  return normalized || undefined;
}
