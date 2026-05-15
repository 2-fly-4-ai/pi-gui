import { useEffect, useMemo, useRef, useState } from "react";
import { THINKING_OPTIONS } from "./composer-commands";
import { ChevronDownIcon, ReasoningIcon } from "./icons";

interface ReasoningSelectorProps {
  readonly thinkingLevel: string | undefined;
  readonly disabled?: boolean;
  readonly onSetThinking: (thinkingLevel: string) => void;
}

export function ReasoningSelector({ thinkingLevel, disabled, onSetThinking }: ReasoningSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const label = useMemo(() => formatThinkingLabel(thinkingLevel), [thinkingLevel]);

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
    <div className="model-selector" ref={rootRef}>
      <span className="model-selector__anchor">
        <button
          className="model-selector__badge model-selector__badge--composer"
          data-testid="reasoning-selector-trigger"
          disabled={disabled}
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="model-selector__badge-icon"><ReasoningIcon /></span>
          <span>{label}</span>
          <ChevronDownIcon />
        </button>
        {open ? (
          <div className="model-selector__dropdown" onWheel={(event) => event.stopPropagation()}>
            <div className="model-selector__group-title">Reasoning</div>
            {THINKING_OPTIONS.map((option) => {
              const isActive = option.value === thinkingLevel;
              return (
                <button
                  className={`model-selector__item${isActive ? " model-selector__item--active" : ""}`}
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (!isActive) {
                      onSetThinking(option.value);
                    }
                    setOpen(false);
                  }}
                >
                  <span className="model-selector__item-label">{formatThinkingLabel(option.value)}</span>
                  <span className="model-selector__item-meta">{option.description}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </span>
    </div>
  );
}

function formatThinkingLabel(value: string | undefined): string {
  const matched = THINKING_OPTIONS.find((option) => option.value === value);
  return `${matched?.label ?? "Medium"} · Normal`;
}
