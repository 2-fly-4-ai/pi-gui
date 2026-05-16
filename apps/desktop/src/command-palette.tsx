import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { filterCommandPaletteActions, firstEnabledAction, type CommandPaletteAction } from "./command-palette-model";

interface CommandPaletteProps {
  readonly actions: readonly CommandPaletteAction[];
  readonly onClose: () => void;
}

export function CommandPalette({ actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const filteredActions = useMemo(() => filterCommandPaletteActions(actions, query), [actions, query]);
  const selectedAction = filteredActions[selectedIndex] ?? firstEnabledAction(filteredActions);
  const selectedActionId = selectedAction ? `${listboxId}-${selectedAction.id}` : undefined;

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(filteredActions.length - 1, 0)));
  }, [filteredActions.length]);

  const runAction = (action: CommandPaletteAction | undefined) => {
    if (!action || action.disabled) return;
    action.run();
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, Math.max(filteredActions.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runAction(selectedAction);
      return;
    }
    if (event.key === "Tab") {
      const focusableElements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not(:disabled)") ?? []);
      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements[focusableElements.length - 1];

      if (!firstFocusableElement || !lastFocusableElement) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    }
  };

  return (
    <div className="command-palette-backdrop" data-testid="command-palette" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="command-palette__input"
          placeholder="Search commands…"
          value={query}
          aria-controls={listboxId}
          aria-activedescendant={selectedActionId}
          aria-expanded="true"
          aria-autocomplete="list"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div id={listboxId} className="command-palette__list" role="listbox" aria-label="Commands">
          {filteredActions.length === 0 ? (
            <div className="command-palette__empty">No commands found.</div>
          ) : filteredActions.map((action, index) => (
            <button
              key={action.id}
              id={`${listboxId}-${action.id}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              disabled={action.disabled}
              className={`command-palette__item${index === selectedIndex ? " command-palette__item--selected" : ""}`}
              onFocus={() => setSelectedIndex(index)}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => runAction(action)}
            >
              <span className="command-palette__item-title">{action.title}</span>
              {action.subtitle ? <span className="command-palette__item-subtitle">{action.subtitle}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
