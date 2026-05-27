import type { RuntimeJobSnapshot } from "@pi-gui/session-driver";

export function isRuntimeJobActive(job: RuntimeJobSnapshot): boolean {
  return job.status === "running" || job.status === "background";
}

export function canStopRuntimeJob(job: RuntimeJobSnapshot): boolean {
  return isRuntimeJobActive(job)
    && (job.confidence === "tracked" || job.confidence === "survived")
    && Boolean(job.process?.pid);
}
