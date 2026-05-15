import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, SettingsIcon } from "./icons";
import {
  BUILT_IN_TOOLS,
  BUILT_IN_TOOL_LABELS,
  DEFAULT_TOOL_ACCESS,
  READ_ONLY_TOOLS,
  TOOL_ACCESS_MODE_LABELS,
  getToolAccessLabel,
  normalizeToolAccess,
  type ToolAccessMode,
  type ToolAccessSelection,
} from "./tool-access";

interface ToolAccessSelectorProps {
  readonly value: ToolAccessSelection | undefined;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onChange: (value: ToolAccessSelection) => void;
}

export function ToolAccessSelector({ value, disabled, disabledReason, onChange }: ToolAccessSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selection = useMemo(() => normalizeToolAccess(value), [value]);

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
    <div className="tool-access-selector" ref={rootRef}>
      <button
        aria-expanded={open}
        className="model-selector__badge model-selector__badge--composer"
        data-testid="tool-access-trigger"
        disabled={disabled}
        title={disabledReason}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="model-selector__badge-icon"><SettingsIcon /></span>
        <span>Supervised · {getToolAccessLabel(selection)}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div className="tool-access-selector__popover" data-testid="tool-access-popover" onWheel={(event) => event.stopPropagation()}>
          <div className="tool-access-selector__title">Tool access</div>
          <div className="tool-access-selector__modes">
            {(["full", "read-only", "no-tools", "custom"] as const).map((mode) => {
              const active = selection.mode === mode;
              return (
                <button
                  className={`tool-access-selector__mode${active ? " tool-access-selector__mode--active" : ""}`}
                  key={mode}
                  type="button"
                  onClick={() => onChange(selectionForMode(mode, selection))}
                >
                  <span className="tool-access-selector__check">{active ? "✓" : ""}</span>
                  <span>{TOOL_ACCESS_MODE_LABELS[mode]}</span>
                </button>
              );
            })}
          </div>
          {selection.mode === "custom" ? (
            <div className="tool-access-selector__custom">
              <div className="tool-access-selector__subtitle">Custom tools</div>
              <div className="tool-access-selector__tool-grid">
                {BUILT_IN_TOOLS.map((tool) => {
                  const checked = selection.tools.includes(tool);
                  return (
                    <label className="tool-access-selector__tool" key={tool}>
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...selection.tools, tool]
                            : selection.tools.filter((entry) => entry !== tool);
                          onChange({ mode: "custom", tools: BUILT_IN_TOOLS.filter((entry) => next.includes(entry)) });
                        }}
                      />
                      <span>{BUILT_IN_TOOL_LABELS[tool]}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function selectionForMode(mode: ToolAccessMode, current: ToolAccessSelection): ToolAccessSelection {
  if (mode === "full") return DEFAULT_TOOL_ACCESS;
  if (mode === "read-only") return { mode, tools: READ_ONLY_TOOLS };
  if (mode === "no-tools") return { mode, tools: [] };
  return { mode, tools: current.mode === "custom" ? current.tools : BUILT_IN_TOOLS };
}
