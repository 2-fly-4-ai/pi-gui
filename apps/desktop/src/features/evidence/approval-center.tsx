import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  DesktopAppState,
  SessionExtensionDialogRecord,
  WorkspaceSessionTarget,
} from "../../desktop-state";
import type { PiDesktopApi } from "../../ipc";
import { formatRelativeTime } from "../../string-utils";

interface ApprovalCenterProps {
  readonly api: PiDesktopApi;
  readonly state: DesktopAppState;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly onOpenThread: (target: WorkspaceSessionTarget) => void;
}

interface OwnedApproval {
  readonly dialog: SessionExtensionDialogRecord;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly workspaceName: string;
  readonly sessionTitle: string;
  readonly expired: boolean;
}

export function ApprovalCenter({
  api,
  state,
  setSnapshot,
  onOpenThread,
}: ApprovalCenterProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const approvals = useMemo(() => collectApprovals(state, now), [now, state]);

  useEffect(() => {
    const hasTimedRequest = Object.values(state.sessionExtensionUiBySession).some((uiState) =>
      uiState.pendingDialogs.some((dialog) => dialog.timeoutMs));
    if (!hasTimedRequest) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state.sessionExtensionUiBySession]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (approvals.length === 0) return null;

  const respond = async (approval: OwnedApproval, approved: boolean) => {
    if (approval.expired) return;
    const response = approval.dialog.kind === "confirm"
      ? { requestId: approval.dialog.requestId, confirmed: approved }
      : { requestId: approval.dialog.requestId, cancelled: true as const };
    await api.respondToHostUiRequest(approval.workspaceId, approval.sessionId, response);
    setSnapshot(await api.getState());
  };

  return (
    <div className="approval-center" ref={rootRef}>
      <button
        aria-expanded={open}
        className="topbar__attention-button"
        data-testid="approval-center-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {approvals.length} waiting
      </button>
      {open ? (
        <section
          aria-label="Approval center"
          className="approval-center__popover"
          data-testid="approval-center"
          role="dialog"
        >
          <header>
            <div>
              <strong>Needs attention</strong>
              <span>{approvals.length} request{approvals.length === 1 ? "" : "s"} across threads</span>
            </div>
            <button aria-label="Close approval center" type="button" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="approval-center__list">
            {approvals.map((approval) => (
              <article
                className={`approval-center__item${approval.expired ? " approval-center__item--expired" : ""}`}
                key={`${approval.workspaceId}:${approval.sessionId}:${approval.dialog.requestId}`}
              >
                <div>
                  <strong>{approval.dialog.title}</strong>
                  <span>{approval.workspaceName} · {approval.sessionTitle}</span>
                  <small>
                    Runtime extension · thread scope
                    {approval.dialog.runId ? ` · run ${approval.dialog.runId.slice(0, 8)}` : ""}
                    {" · "}
                    {approval.dialog.risk ?? "routine"} risk
                    {" · "}
                    {approval.dialog.receivedAt ? formatRelativeTime(approval.dialog.receivedAt) : "age unavailable"}
                  </small>
                  {approval.expired ? <em>Expired — the runtime may no longer accept a response</em> : null}
                </div>
                <div className="approval-center__actions">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenThread({ workspaceId: approval.workspaceId, sessionId: approval.sessionId });
                      setOpen(false);
                    }}
                  >
                    Open thread
                  </button>
                  <button disabled={approval.expired} type="button" onClick={() => void respond(approval, false)}>
                    Deny
                  </button>
                  {approval.dialog.kind === "confirm" ? (
                    <button disabled={approval.expired} type="button" onClick={() => void respond(approval, true)}>
                      Approve once
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <p className="approval-center__notice">
            Inline request cards remain the source for input, selection, and editor responses.
            Approval Center never creates a persistent “always approve” rule.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function collectApprovals(state: DesktopAppState, now: number): readonly OwnedApproval[] {
  const approvals: OwnedApproval[] = [];
  for (const uiState of Object.values(state.sessionExtensionUiBySession)) {
    for (const dialog of uiState.pendingDialogs) {
      if (!dialog.workspaceId || !dialog.sessionId) continue;
      const workspace = state.workspaces.find((candidate) => candidate.id === dialog.workspaceId);
      const session = workspace?.sessions.find((candidate) => candidate.id === dialog.sessionId);
      if (!workspace || !session) continue;
      const receivedAtMs = dialog.receivedAt ? Date.parse(dialog.receivedAt) : Number.NaN;
      const expired = Boolean(
        dialog.timeoutMs
        && Number.isFinite(receivedAtMs)
        && now >= receivedAtMs + dialog.timeoutMs,
      );
      approvals.push({
        dialog,
        workspaceId: workspace.id,
        sessionId: session.id,
        workspaceName: workspace.name,
        sessionTitle: session.title,
        expired,
      });
    }
  }
  return approvals.sort((left, right) =>
    Date.parse(left.dialog.receivedAt ?? "") - Date.parse(right.dialog.receivedAt ?? ""));
}
