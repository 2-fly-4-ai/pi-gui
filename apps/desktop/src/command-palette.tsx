import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  resolveCommandPaletteActions,
  type CommandPaletteAction,
} from "./command-palette-model";
import {
  applyAdaptiveRecommendation,
  deriveAdaptiveRecommendation,
  dismissAdaptiveRecommendation,
  readAdaptiveUsage,
  recordAdaptiveAction,
  resetAdaptiveRecommendations,
} from "./product-experience/adaptive-interface";

interface CommandPaletteProps {
  readonly actions: readonly CommandPaletteAction[];
  readonly onClose: () => void;
  readonly storageScope?: string;
}

function firstEnabledIndex(actions: readonly CommandPaletteAction[]): number {
  const index = actions.findIndex((action) => !action.disabled);
  return index >= 0 ? index : 0;
}

function nextEnabledIndex(actions: readonly CommandPaletteAction[], current: number, direction: 1 | -1): number {
  if (actions.length === 0) return 0;
  for (let offset = 1; offset <= actions.length; offset += 1) {
    const index = (current + direction * offset + actions.length) % actions.length;
    if (!actions[index]?.disabled) return index;
  }
  return current;
}

export function CommandPalette({ actions, onClose, storageScope = "global" }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => readIds(`pins:${storageScope}`));
  const [recentIds, setRecentIds] = useState<readonly string[]>(() => [...readIds(`recent:${storageScope}`)]);
  const [adaptiveUsage, setAdaptiveUsage] = useState(() => readAdaptiveUsage(storageScope));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const orderedActions = useMemo(() => {
    if (query.trim()) return actions;
    const recency = new Map(recentIds.map((id, index) => [id, index]));
    return [...actions].sort((left, right) => (
      Number(pinnedIds.has(right.id)) - Number(pinnedIds.has(left.id))
      || (recency.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (recency.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [actions, pinnedIds, query, recentIds]);
  const paletteResults = useMemo(
    () => resolveCommandPaletteActions(orderedActions, query),
    [orderedActions, query],
  );
  const filteredActions = paletteResults.actions;
  const selectedAction = filteredActions[selectedIndex];
  const selectedActionId = selectedAction ? `${listboxId}-${selectedAction.id}` : undefined;
  const recommendation = deriveAdaptiveRecommendation(
    adaptiveUsage,
    new Set(actions.map((action) => action.id)),
    pinnedIds,
  );
  const recommendedAction = recommendation
    ? actions.find((action) => action.id === recommendation.actionId)
    : undefined;

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    setSelectedIndex(firstEnabledIndex(filteredActions));
  }, [filteredActions]);

  const runAction = (action: CommandPaletteAction | undefined) => {
    if (!action || action.disabled) return;
    const nextRecent = [action.id, ...recentIds.filter((id) => id !== action.id)].slice(0, 12);
    setRecentIds(nextRecent);
    writeIds(`recent:${storageScope}`, nextRecent);
    setAdaptiveUsage(recordAdaptiveAction(storageScope, action.id));
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
      setSelectedIndex((current) => nextEnabledIndex(filteredActions, current, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => nextEnabledIndex(filteredActions, current, -1));
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
        {recommendation && recommendedAction ? (
          <aside className="command-palette__recommendation" data-testid="adaptive-recommendation">
            <div>
              <strong>Pin {recommendedAction.title}?</strong>
              <span>{recommendation.reason}</span>
              <small>Usage stays on this device. Nothing moves unless you apply it.</small>
            </div>
            <button type="button" onClick={() => {
              const nextPins = new Set(pinnedIds).add(recommendedAction.id);
              setPinnedIds(nextPins);
              writeIds(`pins:${storageScope}`, [...nextPins]);
              setAdaptiveUsage(applyAdaptiveRecommendation(storageScope, recommendedAction.id));
            }}>Apply</button>
            <button type="button" onClick={() => {
              setAdaptiveUsage(dismissAdaptiveRecommendation(storageScope, recommendedAction.id));
            }}>Dismiss</button>
          </aside>
        ) : null}
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
              <span className="command-palette__item-title">
                {action.title}
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
              </span>
              {action.subtitle ? <span className="command-palette__item-subtitle">{action.subtitle}</span> : null}
              <span className="command-palette__item-meta">
                {action.category ?? "Command"}
                {action.significant ? " · preview required" : ""}
                {pinnedIds.has(action.id) ? " · pinned" : ""}
              </span>
            </button>
          ))}
        </div>
        {paletteResults.hasMore ? (
          <small className="command-palette__result-limit" role="status">
            More results are available. Refine your search to narrow the list.
          </small>
        ) : null}
        {selectedAction ? (
          <button
            className="command-palette__pin"
            type="button"
            onClick={() => {
              const next = new Set(pinnedIds);
              if (next.has(selectedAction.id)) next.delete(selectedAction.id);
              else next.add(selectedAction.id);
              setPinnedIds(next);
              writeIds(`pins:${storageScope}`, [...next]);
            }}
          >
            {pinnedIds.has(selectedAction.id) ? "Unpin selected command" : "Pin selected command"}
          </button>
        ) : null}
        <small className="command-palette__hint">
          ⌘K opens this palette anywhere.
          <button type="button" onClick={() => {
            resetAdaptiveRecommendations(storageScope);
            setAdaptiveUsage(readAdaptiveUsage(storageScope));
          }}>Reset recommendations</button>
        </small>
      </div>
    </div>
  );
}

function readIds(key: string): ReadonlySet<string> {
  try {
    const value = JSON.parse(localStorage.getItem(`pi-gui:command-palette:${key}`) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: readonly string[]): void {
  try {
    localStorage.setItem(`pi-gui:command-palette:${key}`, JSON.stringify(ids));
  } catch {
    // Palette recency is an optional convenience.
  }
}
