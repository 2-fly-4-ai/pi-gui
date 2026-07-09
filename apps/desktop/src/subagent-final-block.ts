export const SUBAGENT_FINAL_BLOCK_VERSION = 1;
export const SUBAGENT_FINAL_BLOCK_TAG = "pi-subagent-result-v1";

export const SUBAGENT_FINAL_STATUSES = [
  "DONE",
  "DONE_WITH_CONCERNS",
  "NEEDS_CONTEXT",
  "BLOCKED",
  "APPROVED",
  "CHANGES_REQUESTED",
] as const;

export type SubagentFinalStatus = (typeof SUBAGENT_FINAL_STATUSES)[number];

export interface SubagentFinalBlock {
  readonly version: typeof SUBAGENT_FINAL_BLOCK_VERSION;
  readonly status: SubagentFinalStatus;
  readonly summary?: string;
  readonly issues?: string;
  readonly tests?: string;
  readonly artifacts?: string;
  readonly rawBlock: string;
}

export const SUBAGENT_FINAL_BLOCK_CONTRACT = `# Final Response Contract
End your final answer with exactly one versioned result block:

<${SUBAGENT_FINAL_BLOCK_TAG}>
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | APPROVED | CHANGES_REQUESTED
SUMMARY: One concise paragraph with the outcome.
ISSUES: none, or a concise list of blocking/non-blocking issues.
TESTS: checks run, or "not run" with the reason.
ARTIFACTS: file paths or links produced, or "none".
</${SUBAGENT_FINAL_BLOCK_TAG}>

Use only the allowed STATUS values. Keep the block plain text, not JSON.`;

const FINAL_BLOCK_PATTERN = new RegExp(`<${SUBAGENT_FINAL_BLOCK_TAG}>\\s*([\\s\\S]*?)\\s*</${SUBAGENT_FINAL_BLOCK_TAG}>`, "gi");
const FIELD_PATTERN = /^([A-Z][A-Z_]*):\s*(.*)$/;

export function parseSubagentFinalBlock(text: string): SubagentFinalBlock | undefined {
  const normalized = normalizeSubagentFinalBlockText(text);
  const matches = [...normalized.matchAll(FINAL_BLOCK_PATTERN)];
  const lastMatch = matches.at(-1);
  const body = lastMatch?.[1]?.trim();
  if (!body) {
    return undefined;
  }

  const fields = parseFields(body);
  const rawStatus = fields.get("STATUS")?.trim();
  if (!isSubagentFinalStatus(rawStatus)) {
    return undefined;
  }

  return {
    version: SUBAGENT_FINAL_BLOCK_VERSION,
    status: rawStatus,
    ...optionalField("summary", fields.get("SUMMARY")),
    ...optionalField("issues", fields.get("ISSUES")),
    ...optionalField("tests", fields.get("TESTS")),
    ...optionalField("artifacts", fields.get("ARTIFACTS")),
    rawBlock: body,
  };
}

export function formatSubagentFinalBlockSummary(result: SubagentFinalBlock): string {
  return [
    `STATUS: ${result.status}`,
    result.summary ? `SUMMARY: ${result.summary}` : undefined,
    result.issues ? `ISSUES: ${result.issues}` : undefined,
    result.tests ? `TESTS: ${result.tests}` : undefined,
    result.artifacts ? `ARTIFACTS: ${result.artifacts}` : undefined,
  ].filter((line): line is string => Boolean(line?.trim())).join("\n");
}

export function isSubagentFinalStatus(value: string | undefined): value is SubagentFinalStatus {
  return SUBAGENT_FINAL_STATUSES.includes(value as SubagentFinalStatus);
}

function parseFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentKey: string | undefined;

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(FIELD_PATTERN);
    if (match) {
      const key = match[1];
      if (!key) {
        continue;
      }
      currentKey = key;
      fields.set(key, match[2]?.trim() ?? "");
      continue;
    }
    if (!currentKey) {
      continue;
    }
    const current = fields.get(currentKey) ?? "";
    fields.set(currentKey, [current, line.trimEnd()].filter(Boolean).join("\n"));
  }

  return fields;
}

function optionalField<Key extends "summary" | "issues" | "tests" | "artifacts">(
  key: Key,
  value: string | undefined,
): Partial<Record<Key, string>> {
  const trimmed = value?.trim();
  return trimmed ? { [key]: trimmed } as Partial<Record<Key, string>> : {};
}

function normalizeSubagentFinalBlockText(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\"/g, "\"");
}
