const TOOL_CONTENT_TEXT_HARD_LIMIT = 12_000;

export function formatElapsed(startedAt: string, now = Date.now()): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) {
    return "0s";
  }
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export function shortenPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) {
    return filePath;
  }
  return parts.slice(-3).join("/");
}

export function shortenCommand(command: string): string {
  const singleLine = command.replace(/\s+/g, " ").trim();
  return singleLine.length > 96 ? `${singleLine.slice(0, 93)}…` : singleLine;
}

export function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

export function formatToolContent(input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) {
    parts.push(typeof input === "string" ? input : JSON.stringify(input, null, 2));
  }
  if (output !== undefined) {
    parts.push(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  }
  return capToolContentText(parts.join("\n\n"));
}

export function capToolContentText(text: string, limit = TOOL_CONTENT_TEXT_HARD_LIMIT): string {
  if (text.length <= limit) {
    return text;
  }
  return [
    text.slice(0, limit),
    "",
    `[Output truncated for chat: showing first ${limit.toLocaleString()} of ${text.length.toLocaleString()} characters.]`,
  ].join("\n");
}

export function statusLabel(status: "running" | "success" | "error") {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

export function renderRuntimeJobElapsed(startedAt: string, active: boolean, endedAt: string): string {
  if (active) {
    return formatElapsed(startedAt);
  }
  return formatElapsed(startedAt, Date.parse(endedAt));
}
