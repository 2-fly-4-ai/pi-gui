import type { ObservabilityEvent } from "./observability-types";

const ISSUE_URL = "https://github.com/minghinmatthewlam/pi-gui/issues/new";
const MAX_EVENTS = 8;
const MAX_FIELD_LENGTH = 360;
const MAX_BODY_LENGTH = 6_000;

export interface DiagnosticIssueDraftInput {
  readonly events: readonly ObservabilityEvent[];
  readonly selectedEvent?: ObservabilityEvent;
  readonly versions: NodeJS.ProcessVersions;
  readonly platform: NodeJS.Platform;
}

export interface DiagnosticIssueDraft {
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

export function buildDiagnosticIssueDraft(input: DiagnosticIssueDraftInput): DiagnosticIssueDraft {
  const failures = input.events.filter((event) => event.severity === "error");
  const anchor = input.selectedEvent ?? failures[0] ?? input.events[0];
  const title = `Diagnostics report: ${anchor ? anchor.title : "App logs"}`;
  const body = truncateBody([
    "## Summary",
    "",
    "- What happened:",
    "- What I expected:",
    "- Can reproduce:",
    "",
    "## App",
    "",
    `- Platform: ${input.platform}`,
    `- Electron: ${input.versions.electron ?? "unknown"}`,
    `- Chrome: ${input.versions.chrome ?? "unknown"}`,
    `- Node: ${input.versions.node ?? "unknown"}`,
    "",
    "## Diagnostics",
    "",
    `- Events included: ${Math.min(input.events.length, MAX_EVENTS)} of ${input.events.length}`,
    `- Failures in current filter: ${failures.length}`,
    "",
    ...input.events.slice(0, MAX_EVENTS).flatMap(formatEvent),
    "",
    "_Generated from App Logs. Raw payloads, paths, transcripts, prompts, file contents, and secrets are excluded or redacted._",
  ].join("\n"));

  const params = new URLSearchParams({
    title,
    body,
  });

  return {
    title,
    body,
    url: `${ISSUE_URL}?${params.toString()}`,
  };
}

function formatEvent(event: ObservabilityEvent, index: number): readonly string[] {
  return [
    `### ${index + 1}. ${redact(event.title)}`,
    "",
    `- Time: ${redact(event.timestamp)}`,
    `- Severity: ${event.severity}`,
    `- Category: ${event.category}`,
    `- Event: ${redact(event.event)}`,
    ...(event.message ? [`- Message: ${redact(event.message)}`] : []),
    "",
  ];
}

function redact(value: string): string {
  const redacted = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:sk|pk|rk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_=-]{16,}\b/g, "[secret]")
    .replace(/\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*["']?[^"',\s)]+/gi, "$1=[secret]")
    .replace(/(?:\/Users|\/private|\/var|\/tmp|\/Volumes|[A-Za-z]:\\)[^\s"',)]+/g, "[path]")
    .replace(/\b(?:[A-Za-z0-9._-]+\/){2,}[A-Za-z0-9._-]+\b/g, "[path]");
  return redacted.length > MAX_FIELD_LENGTH ? `${redacted.slice(0, MAX_FIELD_LENGTH)}...` : redacted;
}

function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_LENGTH) {
    return body;
  }
  return `${body.slice(0, MAX_BODY_LENGTH)}\n\n_Additional events were omitted from the draft._`;
}
