import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  AgentDefinitionConfig,
  AgentDefinitionRecord,
  AgentDefinitionsSnapshot,
  DeleteAgentDefinitionInput,
  ResetAgentDefinitionInput,
  SaveAgentDefinitionInput,
} from "./agent-definitions";
import { createDefaultCustomAgentConfig, duplicateAgentConfig } from "./agent-definitions";
import { AgentDefinitionEditor } from "./agent-definition-editor";
import { SettingsGroup } from "./settings-utils";

interface SettingsAgentsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly snapshot?: AgentDefinitionsSnapshot;
  readonly pending: boolean;
  readonly error?: string;
  readonly onSave: (input: SaveAgentDefinitionInput) => Promise<void>;
  readonly onReset: (input: ResetAgentDefinitionInput) => Promise<void>;
  readonly onDelete: (input: DeleteAgentDefinitionInput) => Promise<void>;
}

type EditorState =
  | { readonly mode: "create"; readonly config: AgentDefinitionConfig; readonly scope: "global" | "project"; readonly builtin: false }
  | { readonly mode: "edit"; readonly record: AgentDefinitionRecord }
  | undefined;

export function SettingsAgentsSection({ runtime, snapshot, pending, error, onSave, onReset, onDelete }: SettingsAgentsSectionProps) {
  const [editor, setEditor] = useState<EditorState>();
  const [deleteTarget, setDeleteTarget] = useState<AgentDefinitionRecord | undefined>();
  const agents = snapshot?.agents ?? [];

  const openNew = () => setEditor({ mode: "create", config: createDefaultCustomAgentConfig(), scope: "global", builtin: false });
  const openDuplicate = (agent: AgentDefinitionRecord) => setEditor({ mode: "create", config: duplicateAgentConfig(agent.config), scope: agent.scope ?? "global", builtin: false });

  return (
    <div data-testid="settings-agents-section">
      <SettingsGroup title="Subagent roles" description="Roles define the specialists Pi can delegate to. Existing .pi/agents markdown files still work.">
        <div className="settings-row">
          <div className="settings-row__label">
            <div className="settings-row__title">Role builder</div>
            <div className="settings-row__description">Create specialist roles as markdown definitions under the selected global or project agents folder.</div>
          </div>
          <div className="settings-row__control">
            <button className="button button--primary" disabled={pending} type="button" onClick={openNew}>New role</button>
          </div>
        </div>
        {error ? <div className="settings-warning" role="alert">{error}</div> : null}
        {!snapshot ? <div className="settings-hint">Loading agent definitions…</div> : null}
        <div className="agent-definitions-list">
          {agents.map((agent) => (
            <div className="agent-definition-row" data-testid={`agent-definition-row-${agent.name}`} key={agent.name}>
              <div className="agent-definition-row__main">
                <div className="agent-definition-row__title">{agent.config.displayName || agent.name}</div>
                <div className="agent-definition-row__description">{agent.config.description}</div>
                <div className="agent-definition-row__meta">
                  <span>{agent.source === "builtin" ? "Built-in" : agent.source === "project" ? "Project override" : "Global override"}</span>
                  <span>Name: {agent.name}</span>
                  <span>Model: {formatModel(agent)}</span>
                  <span>Reasoning: {formatThinking(agent)}</span>
                  <span>Tools: {agent.config.tools?.length ? agent.config.tools.join(", ") : "Inherited/default"}</span>
                  <span>Prompt: {agent.config.promptMode}</span>
                </div>
                {agent.warnings.map((warning) => <div className="settings-warning" key={warning}>{warning}</div>)}
                {!modelAvailable(runtime, agent) ? <div className="settings-warning">Configured model is not currently available. The extension may fall back or fail until the provider is connected.</div> : null}
              </div>
              <div className="agent-definition-row__actions">
                <button className="button button--secondary" disabled={pending} type="button" onClick={() => setEditor({ mode: "edit", record: agent })}>Edit</button>
                <button className="button button--secondary" disabled={pending} type="button" onClick={() => openDuplicate(agent)}>Duplicate</button>
                {agent.source !== "builtin" && agent.scope ? (
                  agent.builtin ? (
                    <button className="button button--secondary" disabled={pending} type="button" onClick={() => void onReset({ scope: agent.scope!, name: agent.name })}>Reset</button>
                  ) : (
                    <button className="button button--danger" disabled={pending} type="button" onClick={() => setDeleteTarget(agent)}>Delete</button>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>

      {editor?.mode === "create" ? (
        <AgentDefinitionEditor mode="create" config={editor.config} runtime={runtime} defaultScope={editor.scope} builtin={false} pending={pending} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {editor?.mode === "edit" ? (
        <AgentDefinitionEditor mode="edit" config={editor.record.config} runtime={runtime} defaultScope={editor.record.scope ?? "global"} builtin={editor.record.builtin} pending={pending} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {deleteTarget?.scope ? (
        <div className="action-dialog-backdrop" role="presentation">
          <section aria-label="Delete agent" aria-modal="true" className="action-dialog" role="dialog">
            <h2>Delete {deleteTarget.name}?</h2>
            <p>This removes the {deleteTarget.scope} markdown definition file. This cannot delete built-in fallback agents.</p>
            <div className="action-dialog__actions">
              <button className="button button--secondary" type="button" onClick={() => setDeleteTarget(undefined)}>Cancel</button>
              <button className="button button--danger" type="button" onClick={async () => { await onDelete({ scope: deleteTarget.scope!, name: deleteTarget.name }); setDeleteTarget(undefined); }}>Delete agent</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function formatModel(agent: AgentDefinitionRecord): string {
  return agent.config.modelMode === "fixed" && agent.config.model ? `${agent.config.model.providerId}/${agent.config.model.modelId}` : "Inherit current thread";
}

function formatThinking(agent: AgentDefinitionRecord): string {
  if (agent.config.thinkingMode !== "fixed" || !agent.config.thinking) return "Inherit";
  if (agent.config.thinking === "xhigh") return "Extra High";
  return agent.config.thinking.charAt(0).toUpperCase() + agent.config.thinking.slice(1);
}

function modelAvailable(runtime: RuntimeSnapshot | undefined, agent: AgentDefinitionRecord): boolean {
  if (agent.config.modelMode !== "fixed" || !agent.config.model) return true;
  if (!runtime) return true;
  return runtime.models.some((model) => model.available && model.providerId === agent.config.model?.providerId && model.modelId === agent.config.model?.modelId);
}
