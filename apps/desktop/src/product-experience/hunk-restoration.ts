export interface PiAttributedHunk {
  readonly id: string;
  readonly beforeStart: number;
  readonly afterStart: number;
  readonly beforeLines: readonly string[];
  readonly afterLines: readonly string[];
  readonly leadingContext: readonly string[];
  readonly trailingContext: readonly string[];
}

export interface HunkRestoreAnalysis extends PiAttributedHunk {
  readonly status: "safe" | "conflict" | "already-restored";
  readonly currentStart?: number;
  readonly reason: string;
}

export interface HunkRestorePreview {
  readonly hunks: readonly HunkRestoreAnalysis[];
  readonly safeCount: number;
  readonly conflictCount: number;
  readonly alreadyRestoredCount: number;
}

export interface CheckpointHunkPreview {
  readonly checkpointId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly ownership: "pi" | "user" | "pre-existing" | "external" | "unknown";
  readonly available: boolean;
  readonly reason: string;
  readonly preview?: HunkRestorePreview;
}

export interface RejectCheckpointHunksRequest {
  readonly checkpointId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly hunkIds: readonly string[];
}

export interface RejectCheckpointHunksResult {
  readonly checkpointId: string;
  readonly rollbackCheckpointId: string;
  readonly path: string;
  readonly rejectedHunkIds: readonly string[];
}

type DiffOperation =
  | { readonly type: "equal"; readonly line: string }
  | { readonly type: "delete"; readonly line: string }
  | { readonly type: "insert"; readonly line: string };

const CONTEXT_LINES = 2;
const MAX_DIFF_CELLS = 2_000_000;

export function computePiAttributedHunks(
  beforeText: string,
  piAfterText: string,
): readonly PiAttributedHunk[] {
  const before = splitLines(beforeText);
  const after = splitLines(piAfterText);
  const operations = diffLines(before, after);
  const hunks: PiAttributedHunk[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  let cursor = 0;

  while (cursor < operations.length) {
    const operation = operations[cursor];
    if (!operation) break;
    if (operation.type === "equal") {
      beforeIndex += 1;
      afterIndex += 1;
      cursor += 1;
      continue;
    }
    const beforeStart = beforeIndex;
    const afterStart = afterIndex;
    const beforeLines: string[] = [];
    const afterLines: string[] = [];
    while (cursor < operations.length && operations[cursor]?.type !== "equal") {
      const change = operations[cursor];
      if (!change) break;
      if (change.type === "delete") {
        beforeLines.push(change.line);
        beforeIndex += 1;
      } else if (change.type === "insert") {
        afterLines.push(change.line);
        afterIndex += 1;
      }
      cursor += 1;
    }
    const leadingContext = after.slice(Math.max(0, afterStart - CONTEXT_LINES), afterStart);
    const trailingStart = afterStart + afterLines.length;
    const trailingContext = after.slice(trailingStart, trailingStart + CONTEXT_LINES);
    hunks.push({
      id: `${beforeStart}:${afterStart}:${hashLines(beforeLines)}:${hashLines(afterLines)}`,
      beforeStart,
      afterStart,
      beforeLines,
      afterLines,
      leadingContext,
      trailingContext,
    });
  }
  return hunks;
}

export function buildHunkRestorePreview(
  beforeText: string,
  piAfterText: string,
  currentText: string,
): HunkRestorePreview {
  const hunks = computePiAttributedHunks(beforeText, piAfterText);
  const current = splitLines(currentText);
  const before = splitLines(beforeText);
  const analyzed = hunks.map((hunk) => analyzeHunk(hunk, current, before));
  return {
    hunks: analyzed,
    safeCount: analyzed.filter((hunk) => hunk.status === "safe").length,
    conflictCount: analyzed.filter((hunk) => hunk.status === "conflict").length,
    alreadyRestoredCount: analyzed.filter((hunk) => hunk.status === "already-restored").length,
  };
}

export function applyHunkRejections(
  currentText: string,
  preview: HunkRestorePreview,
  selectedHunkIds: readonly string[],
): string {
  const selected = new Set(selectedHunkIds);
  const candidates = preview.hunks.filter((hunk) => selected.has(hunk.id));
  const unavailable = candidates.find((hunk) => hunk.status !== "safe" || hunk.currentStart === undefined);
  if (unavailable) {
    throw new Error(`Hunk is unavailable for one-click rejection: ${unavailable.id}`);
  }
  const current = splitLines(currentText);
  const descending = [...candidates].sort((left, right) =>
    (right.currentStart ?? 0) - (left.currentStart ?? 0));
  for (const hunk of descending) {
    current.splice(hunk.currentStart ?? 0, hunk.afterLines.length, ...hunk.beforeLines);
  }
  return current.join("");
}

function analyzeHunk(
  hunk: PiAttributedHunk,
  current: readonly string[],
  fullBefore: readonly string[],
): HunkRestoreAnalysis {
  const safeLocations = findHunkLocations(current, hunk, hunk.afterLines);
  if (safeLocations.length === 1) {
    return {
      ...hunk,
      status: "safe",
      currentStart: safeLocations[0],
      reason: "The Pi-attributed lines and surrounding context are unchanged.",
    };
  }
  const beforeLeading = fullBefore.slice(Math.max(0, hunk.beforeStart - CONTEXT_LINES), hunk.beforeStart);
  const beforeTrailingStart = hunk.beforeStart + hunk.beforeLines.length;
  const beforeTrailing = fullBefore.slice(beforeTrailingStart, beforeTrailingStart + CONTEXT_LINES);
  const restoredLocations = findHunkLocations(current, {
    ...hunk,
    leadingContext: beforeLeading,
    trailingContext: beforeTrailing,
  }, hunk.beforeLines);
  if (restoredLocations.length === 1) {
    return {
      ...hunk,
      status: "already-restored",
      currentStart: restoredLocations[0],
      reason: "This hunk already matches the checkpoint state.",
    };
  }
  return {
    ...hunk,
    status: "conflict",
    reason: safeLocations.length > 1
      ? "The Pi-attributed lines occur more than once, so the target is ambiguous."
      : "Later edits overlap this hunk or its surrounding context.",
  };
}

function findHunkLocations(
  current: readonly string[],
  hunk: PiAttributedHunk,
  targetLines: readonly string[],
): readonly number[] {
  const matches: number[] = [];
  for (let start = 0; start <= current.length - targetLines.length; start += 1) {
    if (!linesEqual(current.slice(start, start + targetLines.length), targetLines)) continue;
    const leadingStart = start - hunk.leadingContext.length;
    if (leadingStart < 0 || !linesEqual(
      current.slice(leadingStart, start),
      hunk.leadingContext,
    )) continue;
    const trailingStart = start + targetLines.length;
    if (!linesEqual(
      current.slice(trailingStart, trailingStart + hunk.trailingContext.length),
      hunk.trailingContext,
    )) continue;
    matches.push(start);
  }
  return matches;
}

function diffLines(before: readonly string[], after: readonly string[]): readonly DiffOperation[] {
  if (before.length * after.length > MAX_DIFF_CELLS) {
    throw new Error("Text is too large for safe hunk computation.");
  }
  const matrix = Array.from({ length: before.length + 1 }, () =>
    new Uint32Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    const row = matrix[left];
    const nextRow = matrix[left + 1];
    if (!row || !nextRow) continue;
    for (let right = after.length - 1; right >= 0; right -= 1) {
      row[right] = before[left] === after[right]
        ? (nextRow[right + 1] ?? 0) + 1
        : Math.max(nextRow[right] ?? 0, row[right + 1] ?? 0);
    }
  }
  const operations: DiffOperation[] = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      operations.push({ type: "equal", line: before[left] ?? "" });
      left += 1;
      right += 1;
    } else if (
      right < after.length
      && (left >= before.length || (matrix[left]?.[right + 1] ?? 0) >= (matrix[left + 1]?.[right] ?? 0))
    ) {
      operations.push({ type: "insert", line: after[right] ?? "" });
      right += 1;
    } else {
      operations.push({ type: "delete", line: before[left] ?? "" });
      left += 1;
    }
  }
  return operations;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function linesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function hashLines(lines: readonly string[]): string {
  let hash = 2166136261;
  for (const line of lines) {
    for (let index = 0; index < line.length; index += 1) {
      hash ^= line.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}
