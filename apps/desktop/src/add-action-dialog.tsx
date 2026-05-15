import { useEffect, useRef, useState } from "react";
import { CloseIcon, PlusIcon } from "./icons";
import type { ProjectActionRecord } from "./project-actions";

interface AddActionDialogProps {
  readonly initialAction?: ProjectActionRecord;
  readonly onClose: () => void;
  readonly onSave: (action: {
    readonly name: string;
    readonly command: string;
    readonly keybinding?: string;
    readonly runOnWorktreeCreation: boolean;
  }) => void;
}

export function AddActionDialog({ initialAction, onClose, onSave }: AddActionDialogProps) {
  const [name, setName] = useState(initialAction?.name ?? "");
  const [keybinding, setKeybinding] = useState(initialAction?.keybinding ?? "");
  const [command, setCommand] = useState(initialAction?.command ?? "");
  const [runOnWorktreeCreation, setRunOnWorktreeCreation] = useState(initialAction?.runOnWorktreeCreation ?? false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const canSave = name.trim().length > 0 && command.trim().length > 0;

  useEffect(() => {
    window.requestAnimationFrame(() => nameRef.current?.focus());
  }, []);

  return (
    <div className="action-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="add-action-title">
        <button className="action-dialog__close" type="button" aria-label="Close add action" onClick={onClose}>
          <CloseIcon />
        </button>
        <div>
          <h2 id="add-action-title">Add Action</h2>
          <p>Actions are project-scoped commands you can run from the top bar or keybindings.</p>
        </div>

        <label className="action-dialog__field">
          <span>Name</span>
          <div className="action-dialog__input-row">
            <span className="action-dialog__leading-icon"><PlusIcon /></span>
            <input
              ref={nameRef}
              value={name}
              placeholder="Test"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </label>

        <label className="action-dialog__field">
          <span>Keybinding</span>
          <input
            value={keybinding}
            placeholder="Press shortcut"
            onChange={(event) => setKeybinding(event.target.value)}
          />
          <small>Press a shortcut. Use Backspace to clear.</small>
        </label>

        <label className="action-dialog__field">
          <span>Command</span>
          <textarea
            value={command}
            placeholder="bun test"
            onChange={(event) => setCommand(event.target.value)}
          />
        </label>

        <label className="action-dialog__toggle-row">
          <span>Run automatically on worktree creation</span>
          <input
            checked={runOnWorktreeCreation}
            type="checkbox"
            onChange={(event) => setRunOnWorktreeCreation(event.target.checked)}
          />
        </label>

        <div className="action-dialog__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="button button--primary"
            type="button"
            disabled={!canSave}
            onClick={() => onSave({
              name,
              command,
              ...(keybinding.trim() ? { keybinding } : {}),
              runOnWorktreeCreation,
            })}
          >
            Save action
          </button>
        </div>
      </section>
    </div>
  );
}
