import type { ReviewAnchor, ReviewDisplayLine, ReviewLineKind } from "./review-types";

export function fileAnchorId(filePath: string): string {
  return `file:${encodeURIComponent(filePath)}`;
}

export function lineAnchorId(
  filePath: string,
  oldLineNumber: number | undefined,
  newLineNumber: number | undefined,
  index: number,
): string {
  const oldPart = oldLineNumber === undefined ? "" : String(oldLineNumber);
  const newPart = newLineNumber === undefined ? "" : String(newLineNumber);
  return `line:${encodeURIComponent(filePath)}:${oldPart}:${newPart}:${index}`;
}

export function parseReviewDiff(
  filePath: string,
  diff: string,
): { readonly lines: readonly ReviewDisplayLine[]; readonly anchors: readonly ReviewAnchor[] } {
  const lines: ReviewDisplayLine[] = [];
  const anchors: ReviewAnchor[] = [{ id: fileAnchorId(filePath), filePath, kind: "file" }];
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of diff.split("\n")) {
    if (
      rawLine.startsWith("diff --git") ||
      rawLine.startsWith("index ") ||
      rawLine.startsWith("---") ||
      rawLine.startsWith("+++")
    ) {
      continue;
    }

    if (rawLine.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      const anchorId = lineAnchorId(filePath, undefined, undefined, lines.length);
      lines.push({ anchorId, kind: "header", content: rawLine });
      continue;
    }

    let kind: ReviewLineKind | undefined;
    let oldLineNumber: number | undefined;
    let newLineNumber: number | undefined;
    let content = rawLine;

    if (rawLine.startsWith("+")) {
      kind = "added";
      content = rawLine.slice(1);
      newLineNumber = newLine;
      newLine += 1;
    } else if (rawLine.startsWith("-")) {
      kind = "removed";
      content = rawLine.slice(1);
      oldLineNumber = oldLine;
      oldLine += 1;
    } else if (rawLine.startsWith(" ") || rawLine === "") {
      kind = "context";
      content = rawLine.startsWith(" ") ? rawLine.slice(1) : "";
      oldLineNumber = oldLine;
      newLineNumber = newLine;
      oldLine += 1;
      newLine += 1;
    }

    if (!kind) {
      continue;
    }

    const anchorId = lineAnchorId(filePath, oldLineNumber, newLineNumber, lines.length);
    lines.push({ anchorId, kind, content, oldLineNumber, newLineNumber });
    anchors.push({ id: anchorId, filePath, kind: "line", lineKind: kind, oldLineNumber, newLineNumber });
  }

  return { lines, anchors };
}
