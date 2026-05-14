import type { ReviewAnchor, ReviewDraftComment, ReviewSnapshot } from "./review-types";

export function buildReviewPrompt(snapshot: ReviewSnapshot, comments: readonly ReviewDraftComment[]): string {
  const commentsByFile = new Map<string, ReviewDraftComment[]>();
  for (const comment of comments) {
    const list = commentsByFile.get(comment.filePath) ?? [];
    list.push(comment);
    commentsByFile.set(comment.filePath, list);
  }

  const sections = snapshot.files
    .map((file) => {
      const fileComments = commentsByFile.get(file.path) ?? [];
      if (fileComments.length === 0) {
        return undefined;
      }

      const commentLines = fileComments.map((comment) => {
        const anchor = file.anchors.find((entry) => entry.id === comment.anchorId);
        const location = formatAnchorLocation(anchor);
        return `- ${location}: ${comment.body.trim()}`;
      });

      return [`### ${file.path}`, ...commentLines].join("\n");
    })
    .filter((section): section is string => Boolean(section));

  return [
    snapshot.source.kind === "base"
      ? `Please address this review of the changes against ${snapshot.source.base}.`
      : "Please address this review of the current working-tree changes.",
    "",
    "Treat each comment as user feedback on the frozen diff snapshot. Do not assume the files are unchanged; inspect current files before editing.",
    "",
    ...sections,
  ].join("\n").trim() + "\n";
}

function formatAnchorLocation(anchor: ReviewAnchor | undefined): string {
  if (!anchor || anchor.kind === "file") {
    return "file";
  }
  if (anchor.newLineNumber !== undefined) {
    return `line ${anchor.newLineNumber}`;
  }
  if (anchor.oldLineNumber !== undefined) {
    return `removed line ${anchor.oldLineNumber}`;
  }
  return "hunk";
}
