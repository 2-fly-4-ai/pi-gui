import type { ReviewDraftComment, ReviewSnapshot } from "../../src/review/review-types";

export function buildAgentPreReviewPrompt(snapshot: ReviewSnapshot): string {
  const anchors = snapshot.files.flatMap((file) =>
    file.anchors.map((anchor) => ({
      id: anchor.id,
      filePath: anchor.filePath,
      kind: anchor.kind,
      lineKind: anchor.lineKind,
      oldLineNumber: anchor.oldLineNumber,
      newLineNumber: anchor.newLineNumber,
    })),
  );

  return [
    "Review this frozen diff snapshot and return structured review comments.",
    "",
    "Rules:",
    "- Do not edit files.",
    "- You may inspect current files if needed, but comments must target anchors from the frozen snapshot.",
    "- Return only JSON in this exact shape: {\"comments\":[{\"anchorId\":\"...\",\"body\":\"...\"}]}",
    "- Use exact anchorId values from the anchor catalog.",
    "- Keep comments actionable and specific.",
    "- Return an empty comments array if there is nothing useful to flag.",
    "",
    `Snapshot source: ${snapshot.source.kind === "base" ? `against ${snapshot.source.base}` : "working tree"}`,
    "",
    "Anchor catalog:",
    JSON.stringify(anchors, null, 2),
    "",
    "Diffs:",
    ...snapshot.files.map((file) => [`## ${file.path}`, "```diff", file.diff, "```"].join("\n")),
  ].join("\n");
}

export function parseAgentPreReviewComments(snapshot: ReviewSnapshot, assistantText: string): readonly ReviewDraftComment[] {
  const payload = parseJsonPayload(assistantText);
  const rawComments = Array.isArray(payload?.comments) ? payload.comments : [];
  const validAnchors = new Map(snapshot.files.flatMap((file) => file.anchors.map((anchor) => [anchor.id, anchor.filePath] as const)));
  const now = new Date().toISOString();
  const comments: ReviewDraftComment[] = [];

  for (const raw of rawComments) {
    if (!isRawAgentComment(raw)) continue;
    const filePath = validAnchors.get(raw.anchorId);
    const body = raw.body.trim();
    if (!filePath || !body) continue;
    comments.push({
      id: crypto.randomUUID(),
      anchorId: raw.anchorId,
      filePath,
      body,
      createdAt: now,
      updatedAt: now,
      source: "agent",
    });
  }

  return comments.slice(0, 50);
}

function parseJsonPayload(text: string): { readonly comments?: unknown } | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = fenced ?? extractObject(text);
  if (!candidate) return undefined;
  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === "object" && parsed !== null ? parsed as { readonly comments?: unknown } : undefined;
  } catch {
    return undefined;
  }
}

function extractObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

function isRawAgentComment(value: unknown): value is { readonly anchorId: string; readonly body: string } {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly anchorId?: unknown }).anchorId === "string" &&
    typeof (value as { readonly body?: unknown }).body === "string";
}
