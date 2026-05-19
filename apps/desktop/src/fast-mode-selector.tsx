import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, LightningIcon } from "./icons";

export type FastModeSelection = "auto" | "on" | "off";

interface FastModeSelectorProps {
  readonly value?: FastModeSelection;
  readonly available?: boolean;
  readonly disabled?: boolean;
  readonly onSetFastMode?: (mode: FastModeSelection) => void;
}

const FAST_MODE_ACTIONS: readonly {
  readonly value: Exclude<FastModeSelection, "auto">;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "on", label: "On", description: "Priority tier for eligible Codex requests" },
  { value: "off", label: "Off", description: "Standard tier" },
];

function labelForFastMode(mode: FastModeSelection): string {
  switch (mode) {
    case "on":
      return "On";
    case "off":
      return "Off";
    case "auto":
    default:
      return "Auto";
  }
}

export function FastModeSelector({ value, available = true, disabled, onSetFastMode }: FastModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedMode = value ?? "off";
  const label = `Fast: ${labelForFastMode(selectedMode)}`;
  const modeClass = `fast-mode-selector__trigger--${selectedMode}`;

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
    <div className="model-selector fast-mode-selector" ref={rootRef}>
      <span className="model-selector__anchor">
        <button
          aria-label="Fast Mode"
          className={`model-selector__badge model-selector__badge--composer fast-mode-selector__trigger ${modeClass}${available ? "" : " fast-mode-selector__trigger--missing"}`}
          data-testid="fast-mode-selector-trigger"
          disabled={disabled}
          title="OpenAI/Codex Fast Mode"
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="model-selector__badge-icon fast-mode-selector__bolt"><LightningIcon /></span>
          <span>{label}</span>
          <ChevronDownIcon />
        </button>
        {open ? (
          <div className="model-selector__dropdown fast-mode-selector__dropdown" onWheel={(event) => event.stopPropagation()}>
            <div className="model-selector__group-title fast-mode-selector__title">Fast Mode</div>
            {FAST_MODE_ACTIONS.map((action) => {
              const active = action.value === selectedMode;
              return (
                <button
                  className={`model-selector__item fast-mode-selector__item${active ? " model-selector__item--active" : ""}`}
                  disabled={disabled}
                  key={action.value}
                  type="button"
                  onClick={() => {
                    onSetFastMode?.(action.value);
                    setOpen(false);
                  }}
                >
                  <span className="reasoning-selector__check">{active ? "✓" : ""}</span>
                  <span className="model-selector__item-label">{action.label}</span>
                  <span className="model-selector__item-meta">{action.description}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </span>
    </div>
  );
}
