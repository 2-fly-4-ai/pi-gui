import { useEffect, useRef, useState } from "react";
import type { SessionRecord } from "../../desktop-state";
import type { PiDesktopApi } from "../../ipc";
import { formatExactLocalTime } from "../../string-utils";
import { deriveTaskEvidencePresentation } from "./task-evidence-presentation";
import { useTaskEvidence } from "./use-task-evidence";
import { TaskErrorRecovery } from "./task-error-recovery";
import { canSupportTrustedVerification } from "../../product-experience/task-evidence";
import { CheckpointRecovery } from "./checkpoint-recovery";
import { useStableTaskActivity } from "./use-stable-task-activity";
import { activeDecisions } from "../../product-experience/project-knowledge";
import {
  canAnimateProductDelight,
  deriveProductPersonalityState,
  isEvidenceBackedTerminalSuccess,
} from "../../product-experience/product-delight";
import { readAppearancePreferences } from "../../appearance-preferences";
import { useSelectedShuriken } from "../../shuriken-roster";

interface TaskEvidenceSurfaceProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly sessionStatus: SessionRecord["status"];
  readonly onOpenLogs: () => void;
  readonly onOpenSettings: () => void;
  readonly onRetry: (prompt: string) => void;
  readonly onReviewChanges: (path: string) => void;
  readonly onCommit: () => void;
}

export function TaskEvidenceSurface({
  api,
  workspaceId,
  sessionId,
  sessionStatus,
  onOpenLogs,
  onOpenSettings,
  onRetry,
  onReviewChanges,
  onCommit,
}: TaskEvidenceSurfaceProps) {
  const { records, loading, refresh } = useTaskEvidence(api, workspaceId, sessionId);
  const resumeLoadResolvedRef = useRef(false);
  const [resumeEligible, setResumeEligible] = useState(false);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [resumeChangedPaths, setResumeChangedPaths] = useState<readonly string[]>([]);
  const [resumeRefreshedAt, setResumeRefreshedAt] = useState<string>();
  const [contextEntryCount, setContextEntryCount] = useState(0);
  const [successMomentsEnabled, setSuccessMomentsEnabled] = useState(() => readAppearancePreferences().successMoments);
  const [successMomentVisible, setSuccessMomentVisible] = useState(false);
  const [animateSuccessMoment, setAnimateSuccessMoment] = useState(false);
  const lastCelebratedCompletionRef = useRef("");
  const [selectedShuriken] = useSelectedShuriken();
  const presentation = deriveTaskEvidencePresentation(records, sessionStatus);
  const activity = useStableTaskActivity(presentation.activity, sessionStatus);
  const completion = presentation.completion;
  const verificationRecords = records.filter((record) => (
    record.kind === "test" || record.kind === "verification"
  ));
  const checkpointRecords = records.filter((record) => (
    record.kind === "checkpoint" && record.correlation?.checkpointId
  ));
  const productState = deriveProductPersonalityState(records, sessionStatus);
  const terminalSuccess = isEvidenceBackedTerminalSuccess(records, completion);
  const latestRecordId = records[0]?.id;
  useEffect(() => {
    const refreshPreference = () => setSuccessMomentsEnabled(readAppearancePreferences().successMoments);
    window.addEventListener("pi-gui:appearance-preferences-changed", refreshPreference);
    return () => window.removeEventListener("pi-gui:appearance-preferences-changed", refreshPreference);
  }, []);
  useEffect(() => {
    if (
      !successMomentsEnabled
      || !terminalSuccess
      || !completion
      || lastCelebratedCompletionRef.current === completion.id
    ) return undefined;
    lastCelebratedCompletionRef.current = completion.id;
    setAnimateSuccessMoment(canAnimateProductDelight());
    setSuccessMomentVisible(true);
    const timer = window.setTimeout(() => {
      setSuccessMomentVisible(false);
      setAnimateSuccessMoment(false);
    }, 2_400);
    return () => window.clearTimeout(timer);
  }, [completion, successMomentsEnabled, terminalSuccess]);
  useEffect(() => {
    resumeLoadResolvedRef.current = false;
    setResumeEligible(false);
    setResumeDismissed(sessionStorage.getItem(`pi-gui.resume-dismissed.${workspaceId}:${sessionId}`) === "true");
  }, [sessionId, workspaceId]);
  useEffect(() => {
    if (loading || resumeLoadResolvedRef.current) return;
    resumeLoadResolvedRef.current = true;
    setResumeEligible(records.some((record) => (
      record.kind === "completion"
      || record.kind === "error"
      || record.kind === "test"
      || record.kind === "file-write"
    )));
  }, [loading, records]);
  const refreshResume = () => {
    refresh();
    void api.getChangedFiles(workspaceId).then((files) => {
      setResumeChangedPaths(files.map((file) => file.path));
      setResumeRefreshedAt(new Date().toISOString());
    }).catch(() => {
      setResumeChangedPaths([]);
      setResumeRefreshedAt(new Date().toISOString());
    });
  };
  useEffect(() => {
    if (resumeEligible && !resumeDismissed) refreshResume();
  // Refresh only when a pre-existing resume state becomes eligible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeEligible, resumeDismissed, sessionId, workspaceId]);
  useEffect(() => {
    let active = true;
    void api.listContextManifests(workspaceId, sessionId).then((snapshots) => {
      if (active) setContextEntryCount(snapshots[0]?.manifest.entries.length ?? 0);
    }).catch(() => {
      if (active) setContextEntryCount(0);
    });
    return () => {
      active = false;
    };
  }, [api, latestRecordId, sessionId, workspaceId]);
  const healthItems = [
    presentation.changedPathCount > 0 ? { key: "changed", label: `${presentation.changedPathCount} changed`, action: "changes" } : undefined,
    presentation.failedCount > 0 ? { key: "failed", label: `${presentation.failedCount} failed`, action: "logs" } : undefined,
    presentation.runningJobCount > 0 ? { key: "jobs", label: `${presentation.runningJobCount} running`, action: "logs" } : undefined,
    presentation.unknownJobCount > 0 ? { key: "unknown-jobs", label: `${presentation.unknownJobCount} unknown`, action: "logs" } : undefined,
    contextEntryCount > 0 ? { key: "context", label: `${contextEntryCount} context`, action: "context" } : undefined,
    presentation.pendingApprovalCount > 0 ? { key: "approvals", label: `${presentation.pendingApprovalCount} waiting`, action: "activity" } : undefined,
    presentation.childRunCount > 0 ? { key: "children", label: `${presentation.childRunCount} subagent${presentation.childRunCount === 1 ? "" : "s"}`, action: "activity" } : undefined,
    ...presentation.confidence.failedScopes.map((scope) => ({ key: `failed-${scope}`, label: `${scopeLabel(scope)} failed`, action: "logs" })),
    ...presentation.confidence.blockedScopes.map((scope) => ({ key: `blocked-${scope}`, label: `${scopeLabel(scope)} blocked`, action: "logs" })),
    ...presentation.confidence.passedScopes.slice(-1).map((scope) => ({ key: `passed-${scope}`, label: `${scopeLabel(scope)} verified`, action: "evidence" })),
    presentation.stale ? { key: "stale", label: "Refresh stale state", action: "refresh" } : undefined,
  ].filter((item): item is { key: string; label: string; action: string } => Boolean(item));

  const navigateToActivity = () => {
    const toolCallId = activity?.toolCallId;
    if (!toolCallId) return;
    const target = document.querySelector<HTMLElement>(`[data-tool-call-id="${CSS.escape(toolCallId)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.querySelector<HTMLButtonElement>(".timeline-tool__header")?.click();
  };
  const navigateToCompletion = () => {
    document.querySelector<HTMLElement>('[data-testid="completion-card"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const navigateToEvidence = () => {
    const details = document.querySelector<HTMLDetailsElement>(".completion-card__details");
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const navigateToContext = () => {
    document.querySelector<HTMLButtonElement>('[data-testid="context-inspector-trigger"]')?.click();
  };

  return (
    <div
      className={`task-evidence-surface${successMomentVisible ? " task-evidence-surface--success-moment" : ""}${animateSuccessMoment ? " task-evidence-surface--success-moment-animated" : ""}`}
      data-product-state={productState.state}
      data-testid="task-evidence-surface"
    >
      {productState.state !== "empty" ? (
        <span className={`product-state-accent product-state-accent--${productState.state}`} aria-hidden="true" title={productState.label}>
          <img src={selectedShuriken.imageUrl} alt="" />
        </span>
      ) : null}
      {resumeEligible && !resumeDismissed && sessionStatus !== "running" ? (
        <ResumeCard
          decisions={activeDecisions({ workspaceId, sessionId }).length}
          records={records}
          changedPaths={resumeChangedPaths}
          refreshedAt={resumeRefreshedAt}
          onContinue={() => onRetry("Continue from the observed thread state. Preserve completed work and address remaining blockers.")}
          onDismiss={() => {
            sessionStorage.setItem(`pi-gui.resume-dismissed.${workspaceId}:${sessionId}`, "true");
            setResumeDismissed(true);
          }}
          onInspectContext={navigateToContext}
          onRefresh={refreshResume}
          onRetry={() => onRetry("Retry the latest observed failure once after checking whether its blocker changed.")}
          onReview={() => onReviewChanges(resumeChangedPaths[0] ?? presentation.changedPaths[0] ?? "")}
        />
      ) : null}
      {activity ? (
        <button
          className={`task-activity task-activity--${activity.tone}`}
          data-testid="task-activity"
          type="button"
          disabled={!activity.toolCallId}
          onClick={navigateToActivity}
        >
          <span className="task-activity__pulse" aria-hidden="true" />
          <strong role="status">{activity.label}</strong>
          {activity.detail ? <span>{activity.detail}</span> : null}
        </button>
      ) : null}
      {!activity && !completion && !presentation.error && healthItems.length > 0 ? (
        <div aria-label="Thread health" className="thread-health-strip" data-testid="thread-health-strip">
          {healthItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={
                item.action === "logs"
                  ? onOpenLogs
                  : item.action === "activity"
                    ? navigateToActivity
                    : item.action === "context"
                      ? navigateToContext
                      : item.action === "refresh"
                        ? refresh
                    : item.action === "evidence"
                      ? navigateToEvidence
                      : navigateToCompletion
              }
              title={item.action === "changes" ? "Observed changed paths are listed in the completion card." : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {!loading && sessionStatus !== "running" && presentation.error ? (
        <TaskErrorRecovery
          api={api}
          message={presentation.error.summary}
          attemptCount={presentation.error.error?.attemptCount}
          onOpenLogs={onOpenLogs}
          onOpenSettings={onOpenSettings}
          onRetry={onRetry}
        />
      ) : null}
      {!loading && sessionStatus !== "running" && completion ? (
        <section className={`completion-card completion-card--${completion.completion?.outcome ?? "completed"}`} data-testid="completion-card">
          <details className="completion-card__details">
            <summary>
              <span className="completion-card__eyebrow">Observed completion</span>
              <strong>{completionTitle(completion.completion?.outcome)}</strong>
              <span className="completion-card__summary-health" data-testid="thread-health-strip">
                {completionHealthSummary({
                  presentation,
                  contextEntryCount,
                  checkpointCount: new Set(checkpointRecords.map((record) => record.correlation?.checkpointId)).size,
                })}
              </span>
              <time dateTime={completion.timestamp} title={formatExactLocalTime(completion.timestamp)}>
                {formatExactLocalTime(completion.timestamp)}
              </time>
            </summary>
            <div className="completion-card__body">
              <div className="completion-card__facts">
                <span>{presentation.changedPathCount > 0 ? `${presentation.changedPathCount} files changed` : "Changed files unknown"}</span>
                <span>{verificationSummary(presentation.confidence)}</span>
                <span>{presentation.childRunCount > 0 ? `${presentation.childRunCount} child runs` : "No child runs observed"}</span>
                <span>{formatElapsed(completion.completion?.elapsedMs)}</span>
                <span>{completion.completion?.checkoutPath ? `Checkout ${completion.completion.checkoutPath}` : "Checkout unknown"}</span>
                <span>{presentation.pendingApprovalCount > 0 ? `${presentation.pendingApprovalCount} approval requests observed` : "No approvals observed"}</span>
              </div>
              <p>Structured desktop/runtime evidence only. Assistant narrative is not promoted to verified status.</p>
              <div className="completion-card__actions">
                {presentation.changedPaths[0] ? (
                  <button type="button" onClick={() => onReviewChanges(presentation.changedPaths[0] ?? "")}>
                    Review changes
                  </button>
                ) : null}
                {presentation.failedCount > 0 || completion.completion?.outcome === "failed" ? (
                  <button type="button" onClick={onOpenLogs}>Open failed test or log</button>
                ) : null}
                {presentation.changedPathCount > 0
                  && ["completed", "partial"].includes(completion.completion?.outcome ?? "completed") ? (
                    <button type="button" onClick={onCommit}>Commit</button>
                  ) : null}
                {["partial", "cancelled", "interrupted", "blocked"].includes(
                  completion.completion?.outcome ?? "",
                ) ? (
                  <button
                    type="button"
                    onClick={() => onRetry("Continue this thread from its observed partial or interrupted state. Inspect the completion evidence and preserve completed work.")}
                  >
                    Continue
                  </button>
                ) : null}
                {completion.completion?.outcome === "failed"
                  && (presentation.error?.error?.attemptCount ?? 1) < 3 ? (
                    <button
                      type="button"
                      onClick={() => onRetry("Retry the failed run once after inspecting its evidence. Do not repeat the same failed action if the condition persists.")}
                    >
                      Retry
                    </button>
                  ) : null}
              </div>
              {verificationRecords.length > 0 ? (
                <div className="completion-card__evidence">
                  <strong>Verification evidence</strong>
                  <div>
                    {verificationRecords.map((record) => (
                      <article key={record.id}>
                        <strong>
                          {canSupportTrustedVerification(record) ? scopeLabel(record.verification?.scope ?? "unknown") : "Declared · not verified"}
                          {" · "}
                          {record.status ?? "unknown"}
                        </strong>
                        <span>{record.verification?.command ?? "Exact command unavailable"}</span>
                        <span>
                          {record.verification?.cwd ? `cwd ${record.verification.cwd} · ` : ""}
                          {record.verification?.exitCode !== undefined ? `exit ${record.verification.exitCode ?? "unknown"} · ` : ""}
                          {formatExactLocalTime(record.timestamp)} · {record.source}
                        </span>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {checkpointRecords.length > 0 ? (
                <CheckpointRecovery api={api} workspaceId={workspaceId} />
              ) : null}
            </div>
          </details>
        </section>
      ) : null}
    </div>
  );
}

function ResumeCard({
  decisions,
  records,
  changedPaths,
  refreshedAt,
  onContinue,
  onDismiss,
  onInspectContext,
  onRefresh,
  onRetry,
  onReview,
}: {
  readonly decisions: number;
  readonly records: readonly import("../../product-experience/task-evidence").TaskEvidenceRecord[];
  readonly changedPaths: readonly string[];
  readonly refreshedAt?: string;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
  readonly onInspectContext: () => void;
  readonly onRefresh: () => void;
  readonly onRetry: () => void;
  readonly onReview: () => void;
}) {
  const completed = records.filter((record) => record.kind === "completion" && record.status !== "failed").length;
  const failed = records.filter((record) => record.status === "failed" || record.kind === "error").length;
  const blockers = records.filter((record) => record.completion?.outcome === "blocked").length;
  return (
    <section className="resume-card" data-testid="resume-card">
      <div className="resume-card__header">
        <div>
          <span>Resume thread</span>
          <strong>Observed state since this thread was last active</strong>
        </div>
        <button aria-label="Dismiss resume card for this session" type="button" onClick={onDismiss}>×</button>
      </div>
      <div className="resume-card__facts">
        <span>{completed ? `${completed} completion record(s)` : "No completed run recorded"}</span>
        <span>Remaining plan items unavailable</span>
        <span>{failed ? `${failed} failure record(s)` : "No failures observed"}</span>
        <span>{blockers ? `${blockers} blocker(s)` : "No blockers observed"}</span>
        <span>{decisions ? `${decisions} active decision(s)` : "No active decisions"}</span>
        <span>{changedPaths.length ? `${changedPaths.length} currently dirty path(s)` : "Checkout clean or unavailable"}</span>
      </div>
      <p>
        Current checkout state was rechecked safely. Provider-side or remote state is not assumed.
        {refreshedAt ? ` Refreshed ${formatExactLocalTime(refreshedAt)}.` : " Refresh pending."}
      </p>
      <div className="resume-card__actions">
        <button type="button" onClick={onContinue}>Continue</button>
        {changedPaths.length ? <button type="button" onClick={onReview}>Review changes</button> : null}
        {failed ? <button type="button" onClick={onRetry}>Retry failure</button> : null}
        <button type="button" onClick={onInspectContext}>Inspect context</button>
        <button type="button" onClick={onRefresh}>Refresh</button>
      </div>
    </section>
  );
}

function completionTitle(outcome: string | undefined): string {
  switch (outcome) {
    case "failed": return "Run failed";
    case "cancelled": return "Run cancelled";
    case "partial": return "Run partially completed";
    case "interrupted": return "Run interrupted";
    case "blocked": return "Run blocked";
    default: return "Run completed";
  }
}

function verificationSummary(confidence: ReturnType<typeof deriveTaskEvidencePresentation>["confidence"]): string {
  if (confidence.failedScopes.length > 0) return `${confidence.failedScopes.length} verification scopes failed`;
  if (confidence.passedScopes.length > 0) return `${confidence.passedScopes.length} verification scopes passed`;
  return "Verification not observed";
}

function scopeLabel(scope: string): string {
  return scope.replace("electron-", "Electron ");
}

function formatElapsed(elapsedMs: number | undefined): string {
  if (elapsedMs === undefined) return "Elapsed time unknown";
  if (elapsedMs < 1_000) return `${elapsedMs}ms elapsed`;
  const seconds = Math.round(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s elapsed`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}

function completionHealthSummary(input: {
  readonly presentation: ReturnType<typeof deriveTaskEvidencePresentation>;
  readonly contextEntryCount: number;
  readonly checkpointCount: number;
}): string {
  const { presentation } = input;
  const items = [
    presentation.changedPathCount > 0 ? `${presentation.changedPathCount} changed` : "Changes unknown",
    presentation.failedCount > 0 ? `${presentation.failedCount} failed` : undefined,
    presentation.runningJobCount > 0 ? `${presentation.runningJobCount} running` : undefined,
    presentation.unknownJobCount > 0 ? `${presentation.unknownJobCount} unknown` : undefined,
    input.contextEntryCount > 0 ? `${input.contextEntryCount} context` : undefined,
    presentation.pendingApprovalCount > 0 ? `${presentation.pendingApprovalCount} waiting` : undefined,
    presentation.childRunCount > 0 ? `${presentation.childRunCount} subagent${presentation.childRunCount === 1 ? "" : "s"}` : undefined,
    presentation.confidence.highestPassedScope
      ? `${scopeLabel(presentation.confidence.highestPassedScope)} verified`
      : verificationSummary(presentation.confidence),
    input.checkpointCount > 0 ? `${input.checkpointCount} checkpoint${input.checkpointCount === 1 ? "" : "s"}` : undefined,
    presentation.stale ? "State stale" : undefined,
  ].filter((item): item is string => Boolean(item));
  return items.join(" · ");
}
