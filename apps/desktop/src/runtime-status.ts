import type { RuntimeSummarySnapshot } from "@pi-gui/session-driver";
import type { SessionRecord } from "./desktop-state";

export function runtimeStatusLabel(session: SessionRecord | undefined): string {
  if (!session) {
    return "No session";
  }

  const summary = session.runtimeSummary;
  const activeToolCount = getCount(summary, "activeToolCount");
  if (activeToolCount > 0) {
    return `Tool running · ${activeToolCount}`;
  }

  const backgroundJobCount = getCount(summary, "backgroundJobCount");
  const unknownJobCount = getCount(summary, "unknownJobCount");
  if (unknownJobCount > 0 && backgroundJobCount > 0) {
    return `Agent idle · ${backgroundJobCount} background job${backgroundJobCount === 1 ? "" : "s"} · ${unknownJobCount} unknown`;
  }

  if (unknownJobCount > 0) {
    return "Unknown background activity";
  }

  if (backgroundJobCount > 0) {
    return `Agent idle · ${backgroundJobCount} background job${backgroundJobCount === 1 ? "" : "s"}`;
  }

  const agentStatus = summary?.agentStatus ?? session.status;

  if (agentStatus === "running") {
    return "Agent running";
  }

  if (agentStatus === "failed") {
    return "Failed";
  }

  return summary ? "Agent idle · no tools running" : "Idle";
}

export function topbarRuntimeStatusLabel(session: SessionRecord | undefined): string {
  const label = runtimeStatusLabel(session);
  return label === "Agent idle · no tools running" ? "Idle" : label;
}

export function runtimeBadgeCount(session: SessionRecord | undefined): number {
  const summary = session?.runtimeSummary;
  return getCount(summary, "activeToolCount") + getCount(summary, "backgroundJobCount") + getCount(summary, "unknownJobCount");
}

function getCount(summary: RuntimeSummarySnapshot | undefined, key: "activeToolCount" | "backgroundJobCount" | "unknownJobCount"): number {
  return summary?.[key] ?? 0;
}
