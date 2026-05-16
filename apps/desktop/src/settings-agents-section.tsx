import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  AgentDefinitionRecord,
  AgentDefinitionsSnapshot,
  ResetAgentDefinitionInput,
  SaveAgentDefinitionInput,
} from "./agent-definitions";
import { AgentDefinitionEditor } from "./agent-definition-editor";
import { SettingsGroup } from "./settings-utils";

interface SettingsAgentsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly snapshot?: AgentDefinitionsSnapshot;
  readonly onSave: (input: SaveAgentDefinitionInput) => void;
  readonly onReset: (input: ResetAgentDefinitionInput) => void;
}

export function SettingsAgentsSection({ runtime, snapshot, onSave, onReset }: SettingsAgentsSectionProps) {
  const [editing, setEditing] = useState<AgentDefinitionRecord | undefined>();
  const agents = snapshot?.agents ?? [];

  return (
    <div data-testid="settings-agents-section">
      <SettingsGroup
        title="Subagent definitions"
        description="Agents are launched naturally by Pi during chat. Configure what model, reasoning, and definition each agent type uses."
      >
        <div className="settings-row">
          <div className="settings-row__label">
            <div className="settings-row__title">Custom agent builder</div>
            <div className="settings-row__description">Create new specialist agents with custom tools and prompts. Built-in overrides are available now; full custom creation is staged next.</div>
          </div>
          <div className="settings-row__control">
            <button className="button button--secondary" disabled type="button">New agent</button>
          </div>
        </div>
        <div className="agent-definitions-list">
          {agents.map((agent) => (
            <div className="agent-definition-row" data-testid={`agent-definition-row-${agent.name}`} key={agent.name}>
              <div className="agent-definition-row__main">
                <div className="agent-definition-row__title">{agent.name}</div>
                <div className="agent-definition-row__description">{agent.config.description}</div>
                <div className="agent-definition-row__meta">
                  <span>{agent.source === "builtin" ? "Built-in" : agent.source === "project" ? "Project override" : "Global override"}</span>
                  <span>Model: {formatModel(agent)}</span>
                  <span>Reasoning: {formatThinking(agent)}</span>
                  <span>Prompt: {agent.config.promptMode}</span>
                </div>
                {agent.warnings.map((warning) => <div className="settings-warning" key={warning}>{warning}</div>)}
                {!modelAvailable(runtime, agent) ? (
                  <div className="settings-warning">Configured model is not currently available. The extension may fall back or fail until the provider is connected.</div>
                ) : null}
              </div>
              <div className="agent-definition-row__actions">
                <button className="button button--secondary" type="button" onClick={() => setEditing(agent)}>Edit</button>
                {agent.source !== "builtin" && agent.scope ? (
                  <button className="button button--secondary" type="button" onClick={() => onReset({ scope: agent.scope!, name: agent.name })}>Reset</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>
      {editing ? (
        <AgentDefinitionEditor
          config={editing.config}
          runtime={runtime}
          defaultScope={editing.scope ?? "global"}
          onClose={() => setEditing(undefined)}
          onSave={(input) => {
            onSave(input);
            setEditing(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function formatModel(agent: AgentDefinitionRecord): string {
  return agent.config.modelMode === "fixed" && agent.config.model
    ? `${agent.config.model.providerId}/${agent.config.model.modelId}`
    : "Inherit current thread";
}

function formatThinking(agent: AgentDefinitionRecord): string {
  if (agent.config.thinkingMode !== "fixed" || !agent.config.thinking) return "Inherit";
  if (agent.config.thinking === "xhigh") return "Extra High";
  return agent.config.thinking.charAt(0).toUpperCase() + agent.config.thinking.slice(1);
}

function modelAvailable(runtime: RuntimeSnapshot | undefined, agent: AgentDefinitionRecord): boolean {
  if (agent.config.modelMode !== "fixed" || !agent.config.model) return true;
  if (!runtime) return true;
  return runtime.models.some((model) =>
    model.available &&
    model.providerId === agent.config.model?.providerId &&
    model.modelId === agent.config.model?.modelId,
  );
}
