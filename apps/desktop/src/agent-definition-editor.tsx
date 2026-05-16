import { useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { AgentDefinitionConfig, AgentDefinitionScope, SaveAgentDefinitionInput } from "./agent-definitions";
import { THINKING_LEVELS, labelForThinking } from "./settings-utils";

interface AgentDefinitionEditorProps {
  readonly config: AgentDefinitionConfig;
  readonly runtime?: RuntimeSnapshot;
  readonly defaultScope: AgentDefinitionScope;
  readonly onClose: () => void;
  readonly onSave: (input: SaveAgentDefinitionInput) => void;
}

export function AgentDefinitionEditor({ config, runtime, defaultScope, onClose, onSave }: AgentDefinitionEditorProps) {
  const titleId = `agent-definition-editor-title-${config.name}`;
  const [scope, setScope] = useState<AgentDefinitionScope>(defaultScope);
  const [modelValue, setModelValue] = useState(
    config.modelMode === "fixed" && config.model ? `${config.model.providerId}:${config.model.modelId}` : "inherit",
  );
  const [thinkingValue, setThinkingValue] = useState(
    config.thinkingMode === "fixed" && config.thinking ? config.thinking : "inherit",
  );
  const enabledModels = useMemo(() => (runtime?.models ?? []).filter((model) => model.available), [runtime]);

  const save = () => {
    const modelParts = modelValue === "inherit" ? [] : modelValue.split(":");
    const providerId = modelParts[0] ?? "";
    const modelId = modelParts.slice(1).join(":");
    const nextConfig: AgentDefinitionConfig = {
      ...config,
      modelMode: modelValue === "inherit" ? "inherit" : "fixed",
      model: modelValue === "inherit" ? undefined : { providerId, modelId },
      thinkingMode: thinkingValue === "inherit" ? "inherit" : "fixed",
      thinking: thinkingValue === "inherit" ? undefined : (thinkingValue as AgentDefinitionConfig["thinking"]),
    };
    onSave({ scope, config: nextConfig });
  };

  return (
    <div className="action-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby={titleId} aria-modal="true" className="action-dialog agent-definition-editor" data-testid="agent-definition-editor" role="dialog">
        <h2 id={titleId}>Edit {config.name}</h2>
        <p>Configure the model and reasoning this subagent uses when Pi launches it automatically.</p>
        <label className="action-dialog__field">
          <span>Scope</span>
          <select aria-label="Scope" className="settings-select" value={scope} onChange={(event) => setScope(event.target.value as AgentDefinitionScope)}>
            <option value="global">Global — all projects</option>
            <option value="project">Project — this workspace</option>
          </select>
        </label>
        <label className="action-dialog__field">
          <span>Model</span>
          <select aria-label="Model" className="settings-select" value={modelValue} onChange={(event) => setModelValue(event.target.value)}>
            <option value="inherit">Inherit current thread</option>
            {enabledModels.map((model) => (
              <option key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}>
                {model.providerName} · {model.label}
              </option>
            ))}
          </select>
        </label>
        <label className="action-dialog__field">
          <span>Reasoning</span>
          <select aria-label="Reasoning" className="settings-select" value={thinkingValue} onChange={(event) => setThinkingValue(event.target.value)}>
            <option value="inherit">Inherit</option>
            <option value="off">Off</option>
            <option value="minimal">Minimal</option>
            {THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>{labelForThinking(level)}</option>
            ))}
          </select>
        </label>
        <details className="settings-disclosure">
          <summary className="settings-disclosure__summary">
            <span>Definition details</span>
            <span>{config.promptMode}</span>
          </summary>
          <div className="settings-disclosure__body">
            <label className="action-dialog__field">
              <span>System prompt</span>
              <textarea readOnly value={config.systemPrompt} />
            </label>
          </div>
        </details>
        <div className="action-dialog__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="button" onClick={save}>Save</button>
        </div>
      </section>
    </div>
  );
}
