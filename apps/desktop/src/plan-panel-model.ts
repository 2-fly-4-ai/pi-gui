import type { TranscriptMessage } from "./desktop-state";

export interface DetectedPlan {
  readonly messageId: string;
  readonly title: string;
  readonly markdown: string;
}

const PLAN_HEADING_RE = /^#{1,3}\s+(.*\bplan\b.*)$/im;
const TASK_LIST_RE = /^\s*- \[[ xX]\]\s+\S+/m;
const NUMBERED_TASK_RE = /^\s*\d+\.\s+\S+/m;

export function detectLatestPlan(transcript: readonly TranscriptMessage[]): DetectedPlan | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind !== "message" || item.role !== "assistant") {
      continue;
    }
    const markdown = item.text.trim();
    if (!looksLikePlan(markdown)) {
      continue;
    }
    return {
      messageId: item.id,
      title: extractPlanTitle(markdown),
      markdown,
    };
  }
  return null;
}

export function buildImplementPlanPrompt(plan: DetectedPlan): string {
  return `Please implement this plan:\n\n${plan.markdown}`;
}

export function looksLikePlan(markdown: string): boolean {
  const lower = markdown.toLowerCase();
  if (PLAN_HEADING_RE.test(markdown)) return true;
  if (lower.includes("implementation plan") || lower.includes("proposed plan")) return true;
  return TASK_LIST_RE.test(markdown) && NUMBERED_TASK_RE.test(markdown);
}

function extractPlanTitle(markdown: string): string {
  const heading = markdown.match(PLAN_HEADING_RE)?.[1]?.trim();
  if (heading) return heading;
  const firstHeading = markdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return firstHeading || "Latest plan";
}
