import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./icons";

export interface ChangedFileSummaryItem {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

interface DialogFrameProps {
  readonly testId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

function DialogFrame({ testId, title, subtitle, onClose, children }: DialogFrameProps) {
  const titleId = `${testId}-title`;
  return (
    <div className="action-dialog-backdrop git-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section aria-labelledby={titleId} aria-modal="true" className="action-dialog git-dialog" data-testid={testId} role="dialog">
        <button aria-label={`Close ${title}`} className="action-dialog__close" type="button" onClick={onClose}>
          <CloseIcon />
        </button>
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
      </section>
    </div>
  );
}

interface CommitDialogProps {
  readonly files: readonly ChangedFileSummaryItem[];
  readonly pending: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSubmit: (input: { readonly message: string; readonly stageAll: boolean }) => void;
}

export function CommitDialog({ files, pending, error, onClose, onSubmit }: CommitDialogProps) {
  const [message, setMessage] = useState("");
  const [stageAll, setStageAll] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  return (
    <DialogFrame
      testId="git-commit-dialog"
      title="Commit changes"
      subtitle="Review the current working tree, stage safely, and write a focused commit message."
      onClose={onClose}
    >
      <div className="git-dialog__file-summary">
        <div className="git-dialog__section-title">Changed files</div>
        <div className="git-dialog__file-list">
          {files.length > 0 ? files.map((file) => (
            <div className="git-dialog__file-row" key={file.path}>
              <span>{file.path}</span>
              <span>{file.staged ? "staged" : file.status}</span>
            </div>
          )) : <div className="git-dialog__empty">No changed files found.</div>}
        </div>
      </div>
      <label className="action-dialog__field">
        <span>Commit message</span>
        <textarea ref={inputRef} value={message} onChange={(event) => setMessage(event.target.value)} />
      </label>
      <label className="action-dialog__toggle-row git-dialog__toggle-row">
        <span>Stage all changed files before committing</span>
        <input checked={stageAll} type="checkbox" onChange={(event) => setStageAll(event.target.checked)} />
      </label>
      {error ? <p className="extension-dialog__body settings-warning">{error}</p> : null}
      <div className="action-dialog__actions">
        <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>Cancel</button>
        <button className="button button--primary" disabled={pending || message.trim().length === 0} type="button" onClick={() => onSubmit({ message, stageAll })}>
          {pending ? "Committing…" : "Commit"}
        </button>
      </div>
    </DialogFrame>
  );
}

interface PushDialogProps {
  readonly branchName?: string;
  readonly pending: boolean;
  readonly error?: string;
  readonly allowSetUpstream: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (options?: { readonly setUpstream?: boolean }) => void;
}

export function PushDialog({ branchName, pending, error, allowSetUpstream, onClose, onSubmit }: PushDialogProps) {
  return (
    <DialogFrame
      testId="git-push-dialog"
      title="Push branch"
      subtitle={branchName ? `Push ${branchName} to its remote branch.` : "Push the current branch to its remote."}
      onClose={onClose}
    >
      {error ? <p className="extension-dialog__body settings-warning">{error}</p> : null}
      <div className="action-dialog__actions">
        <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>Cancel</button>
        {allowSetUpstream ? (
          <button className="button button--secondary" disabled={pending} type="button" onClick={() => onSubmit({ setUpstream: true })}>
            Push with upstream
          </button>
        ) : null}
        <button className="button button--primary" disabled={pending} type="button" onClick={() => onSubmit()}>
          {pending ? "Pushing…" : "Push"}
        </button>
      </div>
    </DialogFrame>
  );
}

interface CreatePrDialogProps {
  readonly branchName?: string;
  readonly pending: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSubmit: (input: { readonly title: string; readonly body: string; readonly base: string; readonly openInBrowser: boolean }) => void;
}

export function CreatePrDialog({ branchName, pending, error, onClose, onSubmit }: CreatePrDialogProps) {
  const [title, setTitle] = useState(branchName ? `PR: ${branchName}` : "");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("main");
  const [openInBrowser, setOpenInBrowser] = useState(true);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  return (
    <DialogFrame
      testId="git-create-pr-dialog"
      title="Create PR"
      subtitle="Use GitHub CLI to open a pull request from the current branch."
      onClose={onClose}
    >
      <label className="action-dialog__field">
        <span>Title</span>
        <input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="action-dialog__field">
        <span>Body</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <label className="action-dialog__field">
        <span>Base branch</span>
        <input value={base} onChange={(event) => setBase(event.target.value)} />
      </label>
      <label className="action-dialog__toggle-row git-dialog__toggle-row">
        <span>Open in browser after creating</span>
        <input checked={openInBrowser} type="checkbox" onChange={(event) => setOpenInBrowser(event.target.checked)} />
      </label>
      {error ? <p className="extension-dialog__body settings-warning">{error}</p> : null}
      <div className="action-dialog__actions">
        <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>Cancel</button>
        <button
          className="button button--primary"
          disabled={pending || title.trim().length === 0 || base.trim().length === 0}
          type="button"
          onClick={() => onSubmit({ title: title.trim(), body, base: base.trim(), openInBrowser })}
        >
          {pending ? "Creating…" : "Create PR"}
        </button>
      </div>
    </DialogFrame>
  );
}

export function isSetUpstreamError(message: string | undefined): boolean {
  return /upstream|set-upstream|has no upstream branch/i.test(message ?? "");
}
