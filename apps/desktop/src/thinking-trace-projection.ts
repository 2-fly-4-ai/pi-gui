import type { TranscriptMessage } from "./timeline-types";

/**
 * Providers may emit a fresh reasoning summary before every tool round. Keep
 * the raw transcript untouched, but show only the newest reasoning card in
 * each user run so repeated THINKING panels do not overwhelm the timeline.
 */
export function projectLatestThinkingPerRun(
  transcript: readonly TranscriptMessage[],
): readonly TranscriptMessage[] {
  const projected: TranscriptMessage[] = [];
  let foundThinkingInRun = false;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (!item) continue;

    if (isRunBoundary(item)) {
      foundThinkingInRun = false;
      projected.push(item);
      continue;
    }

    if (item.kind === "thinking") {
      if (foundThinkingInRun) continue;
      foundThinkingInRun = true;
    }
    projected.push(item);
  }

  projected.reverse();
  return projected.length === transcript.length ? transcript : projected;
}

function isRunBoundary(item: TranscriptMessage): boolean {
  return (
    (item.kind === "message" && item.role === "user")
    || (item.kind === "summary" && item.presentation === "divider")
  );
}
