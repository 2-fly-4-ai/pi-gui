import type { SessionRecord } from "../desktop-state";
import {
  canSupportTrustedVerification,
  type TaskEvidenceRecord,
} from "./task-evidence";

export type ProductPersonalityState = "empty" | "working" | "waiting" | "success" | "failure" | "subagent";

export interface ProductStatePresentation {
  readonly state: ProductPersonalityState;
  readonly label: string;
}

export function deriveProductPersonalityState(
  records: readonly TaskEvidenceRecord[],
  sessionStatus: SessionRecord["status"],
): ProductStatePresentation {
  const latestCompletion = records.find((record) => record.kind === "completion");
  const active = records.find((record) => record.status === "running" || record.status === "pending");
  if (active?.source === "subagent" || active?.activity?.type === "waiting-subagent") {
    return { state: "subagent", label: "Subagent activity" };
  }
  if (active?.kind === "approval" || active?.activity?.type === "waiting-approval" || active?.activity?.type === "waiting-provider") {
    return { state: "waiting", label: "Waiting" };
  }
  if (
    latestCompletion?.completion?.outcome === "failed"
    || latestCompletion?.completion?.outcome === "blocked"
    || records.some((record) => record.kind === "error" && record.status === "failed")
  ) {
    return { state: "failure", label: "Needs attention" };
  }
  if (isEvidenceBackedTerminalSuccess(records, latestCompletion)) {
    return { state: "success", label: "Verified completion" };
  }
  if (sessionStatus === "running" || active) {
    return { state: "working", label: "Working" };
  }
  return { state: "empty", label: "Ready" };
}

export function isEvidenceBackedTerminalSuccess(
  records: readonly TaskEvidenceRecord[],
  completion = records.find((record) => record.kind === "completion"),
): boolean {
  if (
    !completion
    || completion.authority === "assistant-narrative"
    || completion.completion?.outcome !== "completed"
    || completion.status === "failed"
    || (completion.completion.blockerEvidenceIds?.length ?? 0) > 0
  ) {
    return false;
  }
  const requiredIds = completion.completion.verificationEvidenceIds ?? [];
  if (requiredIds.length === 0) {
    return !records.some((record) => (
      (record.kind === "test" || record.kind === "verification")
      && (record.status === "failed" || record.status === "blocked")
    ));
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  return requiredIds.every((id) => {
    const record = byId.get(id);
    return Boolean(record && record.status === "passed" && canSupportTrustedVerification(record));
  });
}

export function canAnimateProductDelight(root: Document = document): boolean {
  if (root.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (root.getSelection()?.toString()) return false;
  if (root.querySelector("[data-testid='review-surface']")) return false;
  const active = root.activeElement;
  return !(active instanceof HTMLInputElement
    || active instanceof HTMLTextAreaElement
    || (active instanceof HTMLElement && active.isContentEditable));
}
