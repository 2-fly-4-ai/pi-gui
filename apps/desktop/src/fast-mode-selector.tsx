import { useEffect, useRef, useState } from "react";
import type { RuntimeCommandRecord } from "@pi-gui/session-driver/runtime-types";
import { ChevronDownIcon, LightningIcon } from "./icons";

export type FastModeSelection = "auto" | "on" | "off";

interface FastModeSelectorProps {
  readonly commands?: readonly RuntimeCommandRecord[];
  readonly value?: FastModeSelection;
  readonly disabled?: boolean;
  readonly onRunFastCommand?: (command: string) => void;
  readonly onSetFastMode?: (mode: FastModeSelection) => void;
}

type FastModeAction = "status" | "on" | "off" | "auto" | "toggle";

const SESSION_FAST_MODE_ACTIONS: readonly {
  readonly value: FastModeAction;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "on", label: "On", description: "Priority tier for eligible GPT-5.4/5.5" },
  { value: "off", label: "Off", description: "Disable for this session" },
  { value: "auto", label: "Auto", description: "Use configured default" },
  { value: "toggle", label: "Toggle", description: "Flip for this session" },
  { value: "status", label: "Status", description: "Check current state" },
];

const NEW_THREAD_FAST_MODE_ACTIONS: readonly {
  readonly value: FastModeSelection;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "auto", label: "Auto", description: "Use configured default" },
  { value: "on", label: "On", description: "Enable Codex Fast before the first prompt" },
  { value: "off", label: "Off", description: "Disable before first prompt" },
];

export function FastModeSelector({ commands, value, disabled, onRunFastCommand, onSetFastMode }: FastModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const commandMode = Boolean(onRunFastCommand);
  const hasFastCommand = !commandMode || (commands ?? []).some((command) => command.name === "fast");
  const isDisabled = disabled || !hasFastCommand;
  const label = value && value !== "auto" ? `Fast ${value === "on" ? "On" : "Off"}` : "Fast";

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
          className={`model-selector__badge model-selector__badge--composer fast-mode-selector__trigger${hasFastCommand ? "" : " fast-mode-selector__trigger--missing"}`}
          data-testid="fast-mode-selector-trigger"
          disabled={disabled}
          title={hasFastCommand ? "OpenAI Codex Fast Mode" : "Install @diegopetrucci/pi-openai-fast to enable Fast Mode"}
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="model-selector__badge-icon fast-mode-selector__bolt"><LightningIcon /></span>
          <span>{label}</span>
          <ChevronDownIcon />
        </button>
        {open ? (
          <div className="model-selector__dropdown fast-mode-selector__dropdown" onWheel={(event) => event.stopPropagation()}>
            <div className="model-selector__group-title">Fast Mode</div>
            {!hasFastCommand ? (
              <div className="model-selector__empty">
                Install <code>@diegopetrucci/pi-openai-fast</code>, then reload Pi to use Codex Fast Mode.
              </div>
            ) : null}
            {commandMode ? SESSION_FAST_MODE_ACTIONS.map((action) => (
              <button
                className="model-selector__item fast-mode-selector__item"
                disabled={isDisabled}
                key={action.value}
                type="button"
                onClick={() => {
                  onRunFastCommand?.(`/fast ${action.value}`);
                  setOpen(false);
                }}
              >
                <span className="model-selector__item-label">{action.label}</span>
                <span className="model-selector__item-meta">{action.description}</span>
              </button>
            )) : NEW_THREAD_FAST_MODE_ACTIONS.map((action) => {
              const active = action.value === (value ?? "auto");
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
