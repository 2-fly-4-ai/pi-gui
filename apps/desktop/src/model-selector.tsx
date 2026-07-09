import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_DESCRIPTION,
  MODEL_OPTIONS_EMPTY_TITLE,
  THINKING_OPTIONS,
  type ComposerModelOption,
} from "./composer-commands";
import { ChevronDownIcon, ModelIcon } from "./icons";

interface ModelSelectorProps {
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly disabled?: boolean;
  readonly dropdownPlacement?: "above" | "below";
  readonly showEmptyModelControl?: boolean;
  readonly unselectedModelLabel?: string;
  readonly emptyModelLabel?: string;
  readonly emptyModelTitle?: string;
  readonly emptyModelDescription?: string;
  readonly variant?: "inline" | "composer";
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
}

type OpenDropdown = "none" | "model" | "thinking";

export function ModelSelector({
  runtime,
  provider,
  modelId,
  thinkingLevel,
  disabled,
  dropdownPlacement = "above",
  showEmptyModelControl = false,
  unselectedModelLabel = "Choose model",
  emptyModelLabel = "Choose model",
  emptyModelTitle = MODEL_OPTIONS_EMPTY_TITLE,
  emptyModelDescription = MODEL_OPTIONS_EMPTY_DESCRIPTION,
  variant = "inline",
  onSetModel,
  onSetThinking,
}: ModelSelectorProps) {
  const [open, setOpen] = useState<OpenDropdown>("none");
  const [modelQuery, setModelQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);
  const groupedModels = useMemo(() => groupByProvider(filterModelOptions(modelOptions, modelQuery)), [modelOptions, modelQuery]);
  const hasModelControl = Boolean(provider && modelId) || modelOptions.length > 0;
  const shouldRenderModelControl = hasModelControl || showEmptyModelControl;
  const modelBadgeLabel = provider && modelId
    ? variant === "composer"
      ? formatComposerModelLabel(provider, modelId, `${provider}:${modelId}`)
      : `${provider}:${modelId}`
    : modelOptions.length > 0
      ? unselectedModelLabel
      : emptyModelLabel;

  useEffect(() => {
    if (open === "none") return undefined;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen("none");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen("none");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open !== "model") {
      setModelQuery("");
    }
  }, [open]);

  if (!shouldRenderModelControl && !thinkingLevel) {
    return null;
  }

  return (
    <span className="model-selector" ref={containerRef}>
      {shouldRenderModelControl ? (
        <span className="model-selector__anchor">
          <button
            aria-label={provider && modelId ? `${provider}:${modelId}` : modelBadgeLabel}
            className={`model-selector__badge${variant === "composer" ? " model-selector__badge--composer" : ""}`}
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "model" ? "none" : "model")}
          >
            {variant === "composer" ? <span className="model-selector__badge-icon"><ModelIcon /></span> : null}
            <span>{modelBadgeLabel}</span>
            {variant === "composer" ? <ChevronDownIcon /> : null}
          </button>
          {open === "model" ? (
            <div
              className={`model-selector__dropdown model-selector__dropdown--models ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`}
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="model-selector__provider-heading">
                <span className="model-selector__provider-mark"><ModelIcon /></span>
                <span>{providerLabelFor(runtime, provider)}</span>
              </div>
              <label className="model-selector__search">
                <span aria-hidden="true">⌕</span>
                <input
                  autoFocus
                  placeholder="Search models..."
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                />
              </label>
              {groupedModels.map((group) => (
                <div className="model-selector__model-group" key={group.provider}>
                  <div className="model-selector__group-title">{group.provider}</div>
                  {group.items.map((option, index) => {
                    const isActive = option.providerId === provider && option.modelId === modelId;
                    return (
                      <button
                        className={`model-selector__item model-selector__model-item${isActive ? " model-selector__item--active" : ""}`}
                        key={`${option.providerId}:${option.modelId}`}
                        type="button"
                        onClick={() => {
                          if (!isActive) {
                            onSetModel(option.providerId, option.modelId);
                          }
                          setOpen("none");
                        }}
                      >
                        <span aria-hidden="true" className="model-selector__favorite">☆</span>
                        <span className="model-selector__item-label">{formatComposerModelLabel(option.providerId, option.modelId, option.label)}</span>
                        {isActive ? <span className="model-selector__item-meta">active</span> : <span className="model-selector__rank">⌘{index + 1}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              {modelOptions.length === 0 ? (
                <div className="model-selector__empty">
                  <strong>{emptyModelTitle}</strong>
                  <span>{emptyModelDescription}</span>
                </div>
              ) : null}
              {modelOptions.length > 0 && groupedModels.length === 0 ? (
                <div className="model-selector__empty">No models match “{modelQuery}”.</div>
              ) : null}
            </div>
          ) : null}
        </span>
      ) : null}
      {thinkingLevel ? (
        <span className="model-selector__anchor">
          <button
            className={`model-selector__badge${variant === "composer" ? " model-selector__badge--composer" : ""}`}
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "thinking" ? "none" : "thinking")}
          >
            <span>{thinkingLevel}</span>
            {variant === "composer" ? <ChevronDownIcon /> : null}
          </button>
          {open === "thinking" ? (
            <div
              className={`model-selector__dropdown ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`}
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="model-selector__group-title">Thinking Level</div>
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
                      setOpen("none");
                    }}
                  >
                    <span className="model-selector__item-label">{option.label}</span>
                    <span className="model-selector__item-meta">{option.description}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

interface ModelGroup {
  readonly provider: string;
  readonly items: readonly ComposerModelOption[];
}

function filterModelOptions(options: readonly ComposerModelOption[], query: string): readonly ComposerModelOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return options;
  }
  return options.filter((option) =>
    [option.label, option.description, option.providerId, option.modelId].some((value) => value.toLowerCase().includes(normalized)),
  );
}

function groupByProvider(options: readonly ComposerModelOption[]): readonly ModelGroup[] {
  const groups = new Map<string, ComposerModelOption[]>();
  for (const option of options) {
    const existing = groups.get(option.providerId);
    if (existing) {
      existing.push(option);
    } else {
      groups.set(option.providerId, [option]);
    }
  }
  return Array.from(groups.entries()).map(([provider, items]) => ({ provider, items }));
}

function providerLabelFor(runtime: RuntimeSnapshot | undefined, providerId: string | undefined): string {
  const provider = runtime?.providers.find((entry) => entry.id === providerId);
  if (provider) {
    return provider.name;
  }
  if (providerId) {
    return providerId;
  }
  return "Models";
}

function formatComposerModelLabel(provider: string | undefined, modelId: string | undefined, fallback: string): string {
  const [, providedLabel] = fallback.split(" · ");
  if (providedLabel) {
    return providedLabel;
  }
  if (!provider || !modelId) {
    return fallback;
  }

  if (/^gpt-/i.test(modelId)) {
    return modelId
      .replace(/^gpt-/i, "GPT-")
      .replace(/-turbo$/i, " Turbo")
      .replace(/-mini$/i, " Mini");
  }
  if (/^claude-/i.test(modelId)) {
    return modelId.replace(/^claude-/i, "Claude ");
  }
  return fallback;
}
