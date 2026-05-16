export interface TerminalSelectionContextInput {
  readonly selection: string;
  readonly title: string;
  readonly cwd: string;
}

export function normalizeTerminalSelection(selection: string): string {
  const lines = selection
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));

  while (lines.length > 0 && lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function markdownFenceFor(text: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

function headingPart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildTerminalSelectionComposerText(input: TerminalSelectionContextInput): string {
  const selection = normalizeTerminalSelection(input.selection);
  if (!selection) {
    return "";
  }

  const title = headingPart(input.title) || "Terminal";
  const cwd = headingPart(input.cwd);
  const heading = cwd ? `Terminal context from ${title} (${cwd})` : `Terminal context from ${title}`;
  const fence = markdownFenceFor(selection);
  return `${heading}:\n\n${fence}terminal\n${selection}\n${fence}`;
}

export function appendComposerContext(currentDraft: string, context: string): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) {
    return currentDraft;
  }
  const trimmedDraft = currentDraft.trimEnd();
  return trimmedDraft ? `${trimmedDraft}\n\n${trimmedContext}` : trimmedContext;
}
