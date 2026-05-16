import { useEffect, useRef, useState } from "react";
import { GitCommitIcon, GitHubIcon, GitPushIcon } from "./icons";

interface GitQuickActionsProps {
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onCommit: () => void;
  readonly onPush: () => void;
  readonly onCreatePr: () => void;
}

export function GitQuickActions({ disabled = false, disabledReason, onCommit, onPush, onCreatePr }: GitQuickActionsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="git-quick-actions" data-testid="git-quick-actions" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="GitHub actions"
        className="git-quick-actions__trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <GitHubIcon />
      </button>
      {open ? (
        <div className="git-quick-actions__menu">
          {disabled && disabledReason ? <div className="git-quick-actions__note">{disabledReason}</div> : null}
          <button className="git-quick-actions__item" disabled={disabled} type="button" onClick={() => { setOpen(false); onCommit(); }}>
            <GitCommitIcon />Commit
          </button>
          <button className="git-quick-actions__item" disabled={disabled} type="button" onClick={() => { setOpen(false); onPush(); }}>
            <GitPushIcon />Push
          </button>
          <button className="git-quick-actions__item" disabled={disabled} type="button" onClick={() => { setOpen(false); onCreatePr(); }}>
            <GitHubIcon />Create PR
          </button>
        </div>
      ) : null}
    </div>
  );
}
