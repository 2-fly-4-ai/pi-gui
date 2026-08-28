import { useMemo, useState } from "react";
import type { SessionRecord, WorkspaceRecord } from "../../desktop-state";
import type { PullRequestDetail, SourceControlMutation } from "../../source-control-types";
import { LoadingState } from "../../loading-state";
import { SecondarySurface } from "../../secondary-surface";
import { usePullRequests } from "./use-pull-requests";

type PullRequestTab = "summary" | "checks" | "reviews" | "files";

interface PullRequestsViewProps {
  readonly api: NonNullable<typeof window.piApp>;
  readonly workspace?: WorkspaceRecord;
  readonly session?: SessionRecord;
  readonly workspaceOptions: readonly WorkspaceRecord[];
  readonly commandPalette: React.ReactNode;
  readonly onBack: () => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSubmitPrompt: (prompt: string) => void;
}

export function PullRequestsView({ api, workspace, session, workspaceOptions, commandPalette, onBack, onSelectWorkspace, onSubmitPrompt }: PullRequestsViewProps) {
  const state = usePullRequests({ api, workspaceId: workspace?.id, sessionId: session?.id });
  const [tab, setTab] = useState<PullRequestTab>("summary");
  const [formMode, setFormMode] = useState<"comment" | "edit-comment" | "edit" | "create">();
  const [editingCommentId, setEditingCommentId] = useState<string>();
  const [comment, setComment] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const snapshot = state.snapshot;
  const detail = state.detail;
  const selectPullRequest = (pullRequestNumber: number) => {
    state.setSelectedNumber(pullRequestNumber);
    setTab("summary");
    setFormMode(undefined);
  };

  const openEdit = () => {
    if (!detail) return;
    setTitle(detail.title);
    setBody(detail.body);
    setBase(detail.baseRefName);
    setFormMode("edit");
  };

  const submitForm = () => {
    let mutation: SourceControlMutation | undefined;
    if (formMode === "comment" && state.selectedNumber) mutation = { kind: "comment", pullRequestNumber: state.selectedNumber, body: comment };
    if (formMode === "edit-comment" && state.selectedNumber && editingCommentId) mutation = { kind: "edit-comment", pullRequestNumber: state.selectedNumber, commentId: editingCommentId, body: comment };
    if (formMode === "edit" && state.selectedNumber) mutation = { kind: "edit", pullRequestNumber: state.selectedNumber, title, body, base };
    if (formMode === "create") mutation = { kind: "create", title, body, base };
    if (mutation) void state.requestMutation(mutation);
  };

  const sendToPi = (prompt: string) => {
    onSubmitPrompt(prompt);
    onBack();
  };

  return (
    <>
      {commandPalette}
      <SecondarySurface onBack={onBack} testId="pull-requests-surface" title="Pull requests">
        <div className="pr-workbench" data-testid="pull-request-workbench">
          <header className="pr-workbench__toolbar">
            <label className="surface-toolbar__field surface-toolbar__field--inline">
              <span>Workspace</span>
              <select aria-label="Pull request workspace" value={workspace?.id ?? ""} onChange={(event) => onSelectWorkspace(event.target.value)}>
                {workspaceOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            <div className="pr-workbench__toolbar-actions">
              <button type="button" disabled={state.loading} onClick={() => void state.refresh(true)}>Refresh</button>
              <button type="button" disabled={snapshot?.auth.state !== "ready"} onClick={() => { setTitle(""); setBody(""); setBase(snapshot?.defaultBranch ?? "main"); setFormMode("create"); }}>New pull request</button>
            </div>
          </header>

          {state.error ? <div className="pr-workbench__error" role="alert">{state.error}</div> : null}
          {!snapshot || state.loading && !snapshot ? <LoadingState label="Loading pull requests" detail="Checking repository and GitHub CLI state…" /> : null}
          {snapshot && snapshot.auth.state !== "ready" ? (
            <section className="pr-workbench__empty" aria-live="polite">
              <h2>GitHub isn’t ready for this workspace</h2>
              <p>{snapshot.auth.message}</p>
              {snapshot.repository ? <p>{snapshot.repository.owner}/{snapshot.repository.name} on {snapshot.repository.host}</p> : null}
              <button type="button" onClick={() => void state.refresh(true)}>Check again</button>
            </section>
          ) : null}

          {snapshot?.auth.state === "ready" ? (
            <div className="pr-workbench__layout">
              <aside className="pr-workbench__list" aria-label="Open pull requests">
                <div className="pr-workbench__repo">
                  <strong>{snapshot.repository?.owner}/{snapshot.repository?.name}</strong>
                  <span>{snapshot.currentBranch ?? "Detached HEAD"}</span>
                </div>
                {snapshot.openPullRequests.length ? snapshot.openPullRequests.map((pullRequest) => (
                  <button
                    aria-current={state.selectedNumber === pullRequest.number ? "true" : undefined}
                    className="pr-workbench__list-item"
                    key={pullRequest.number}
                    type="button"
                    onClick={() => selectPullRequest(pullRequest.number)}
                  >
                    <span>#{pullRequest.number} {pullRequest.title}</span>
                    <small>{pullRequest.headRefName} → {pullRequest.baseRefName}</small>
                    <small>{pullRequest.checksSummary.failure ? `${pullRequest.checksSummary.failure} failed` : pullRequest.checksSummary.pending ? `${pullRequest.checksSummary.pending} pending` : `${pullRequest.checksSummary.success} passed`}</small>
                  </button>
                )) : <p className="pr-workbench__muted">No open pull requests.</p>}
              </aside>

              <main className="pr-workbench__detail">
                {state.detailLoading ? <LoadingState label="Loading pull request" detail="Fetching checks, reviews, files, and commits…" /> : null}
                {!state.detailLoading && !detail ? <section className="pr-workbench__empty"><h2>Select a pull request</h2><p>Review repository activity without leaving Pi.</p></section> : null}
                {detail ? (
                  <>
                    <header className="pr-workbench__detail-header">
                      <div><span className="pr-workbench__eyebrow">#{detail.number} · {detail.state}{detail.isDraft ? " · Draft" : ""}</span><h2>{detail.title}</h2><p>{detail.headRefName} → {detail.baseRefName}</p></div>
                      <div className="pr-workbench__actions">
                        <button type="button" onClick={() => void api.openExternal(detail.url)}>Open on GitHub</button>
                        <button type="button" disabled={state.pending || !session} onClick={() => void state.toggleLink()}>{state.link?.pullRequestNumber === detail.number ? "Unlink task" : "Link task"}</button>
                        <button type="button" disabled={state.pending} onClick={() => void state.requestMutation({ kind: "checkout", pullRequestNumber: detail.number })}>Checkout</button>
                        <button type="button" disabled={state.pending} onClick={() => void state.requestMutation({ kind: "update-branch", pullRequestNumber: detail.number })}>Update branch</button>
                      </div>
                    </header>
                    <nav className="pr-workbench__tabs" aria-label="Pull request details">
                      {(["summary", "checks", "reviews", "files"] as const).map((nextTab) => <button aria-pressed={tab === nextTab} key={nextTab} type="button" onClick={() => setTab(nextTab)}>{nextTab[0]?.toUpperCase()}{nextTab.slice(1)}</button>)}
                    </nav>
                    {state.link?.pullRequestNumber === detail.number && detail.state !== "OPEN" ? (
                      <div className="pr-workbench__completion" role="status">
                        <span>Linked pull request #{detail.number} is {detail.state.toLowerCase()}.</span>
                        <button type="button" onClick={() => sendToPi(`Pull request #${detail.number} is ${detail.state.toLowerCase()}. Verify the task is actually complete and summarize any remaining local work before I decide whether to archive it.`)}>Review task completion</button>
                      </div>
                    ) : null}
                    <PullRequestTabContent detail={detail} tab={tab} viewerLogin={snapshot.viewerLogin} onEditComment={(commentId, commentBody) => { setEditingCommentId(commentId); setComment(commentBody); setFormMode("edit-comment"); }} onSendToPi={sendToPi} />
                    <div className="pr-workbench__footer-actions">
                      <button type="button" onClick={() => { setComment(""); setFormMode("comment"); }}>Comment</button>
                      {snapshot.viewerLogin && detail.author?.login.toLowerCase() === snapshot.viewerLogin.toLowerCase() ? <button type="button" onClick={openEdit}>Edit details</button> : null}
                      <button type="button" onClick={() => sendToPi(`Review GitHub pull request #${detail.number} (${detail.url}). Focus on failing checks, unresolved review feedback, and risky file changes. Do not post or mutate GitHub without asking me first.`)}>Ask Pi to review</button>
                    </div>
                  </>
                ) : null}
              </main>
            </div>
          ) : null}
        </div>
      </SecondarySurface>

      {formMode ? (
        <div className="modal-backdrop" role="presentation">
          <form className="dialog pr-workbench__dialog" onSubmit={(event) => { event.preventDefault(); submitForm(); }}>
            <h2>{formMode === "comment" ? "Comment on pull request" : formMode === "edit-comment" ? "Edit your comment" : formMode === "edit" ? "Edit pull request" : "Create pull request"}</h2>
            {formMode === "edit" || formMode === "create" ? <><label>Title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Base branch<input value={base} onChange={(event) => setBase(event.target.value)} /></label></> : null}
            <label>{formMode === "comment" || formMode === "edit-comment" ? "Comment" : "Description"}<textarea autoFocus={formMode === "comment" || formMode === "edit-comment"} rows={10} value={formMode === "comment" || formMode === "edit-comment" ? comment : body} onChange={(event) => formMode === "comment" || formMode === "edit-comment" ? setComment(event.target.value) : setBody(event.target.value)} /></label>
            <div className="dialog__actions"><button type="button" onClick={() => setFormMode(undefined)}>Cancel</button><button type="submit">Preview</button></div>
          </form>
        </div>
      ) : null}

      {state.preview ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" className="dialog pr-workbench__dialog" role="dialog" aria-labelledby="pr-mutation-title">
            <h2 id="pr-mutation-title">{state.preview.details.title}</h2>
            <p>{state.preview.details.summary}</p>
            <p><strong>Action:</strong> {state.preview.details.commandDescription}</p>
            <ul>{state.preview.details.consequences.map((item) => <li key={item}>{item}</li>)}</ul>
            <div className="dialog__actions"><button disabled={state.pending} type="button" onClick={() => state.setPreview(undefined)}>Cancel</button><button disabled={state.pending} type="button" onClick={() => void state.confirmMutation()}>{state.pending ? "Working…" : "Confirm"}</button></div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function PullRequestTabContent({ detail, tab, viewerLogin, onEditComment, onSendToPi }: { readonly detail: PullRequestDetail; readonly tab: PullRequestTab; readonly viewerLogin?: string; readonly onEditComment: (commentId: string, body: string) => void; readonly onSendToPi: (prompt: string) => void }) {
  const summary = useMemo(() => ({ additions: detail.additions, deletions: detail.deletions, files: detail.changedFiles, commits: detail.commits.length }), [detail]);
  if (tab === "summary") return <section className="pr-workbench__content"><div className="pr-workbench__stats"><span>+{summary.additions}</span><span>−{summary.deletions}</span><span>{summary.files} files</span><span>{summary.commits} commits</span></div><p className="pr-workbench__body">{detail.body || "No description provided."}</p></section>;
  if (tab === "checks") return <section className="pr-workbench__content"><h3>Checks</h3>{detail.checks.length ? <ul className="pr-workbench__rows">{detail.checks.map((check) => <li key={check.id}><span className={`pr-workbench__status pr-workbench__status--${check.state.toLowerCase()}`}>{check.state}</span><strong>{check.name}</strong>{check.workflow ? <small>{check.workflow}</small> : null}</li>)}</ul> : <p>No checks reported.</p>}</section>;
  if (tab === "reviews") return <section className="pr-workbench__content"><h3>Reviews and comments</h3>{[...detail.reviews, ...detail.comments].length ? <ul className="pr-workbench__rows">{detail.reviews.map((review) => <li key={`review:${review.id}`}><strong>{review.author?.login ?? "Unknown reviewer"}</strong><span>{review.state.replaceAll("_", " ")}</span><p>{review.body || "No review body."}</p><button type="button" onClick={() => onSendToPi(`Address this review feedback on pull request #${detail.number} from ${review.author?.login ?? "a reviewer"}:\n\n> ${review.body.replaceAll("\n", "\n> ")}\n\nInspect the relevant code first. Do not post or mutate GitHub without asking me.`)}>Ask Pi</button></li>)}{detail.comments.map((comment) => <li key={`comment:${comment.id}`}><strong>{comment.author?.login ?? "Unknown author"}</strong><p>{comment.body}</p>{viewerLogin && comment.author?.login.toLowerCase() === viewerLogin.toLowerCase() ? <button type="button" onClick={() => onEditComment(comment.id, comment.body)}>Edit your comment</button> : null}<button type="button" onClick={() => onSendToPi(`Investigate this pull request #${detail.number} comment from ${comment.author?.login ?? "a collaborator"}:\n\n> ${comment.body.replaceAll("\n", "\n> ")}\n\nExplain what action is needed. Do not post or mutate GitHub without asking me.`)}>Ask Pi</button></li>)}</ul> : <p>No reviews or comments yet.</p>}</section>;
  return <section className="pr-workbench__content"><h3>Changed files</h3><ul className="pr-workbench__rows">{detail.files.map((file) => <li key={file.path}><code>{file.path}</code><span>+{file.additions} −{file.deletions}</span><button type="button" onClick={() => onSendToPi(`Inspect ${file.path} in the context of GitHub pull request #${detail.number}. Explain the change, identify risks, and suggest verification. Do not mutate GitHub without asking me first.`)}>Ask Pi</button></li>)}</ul></section>;
}
