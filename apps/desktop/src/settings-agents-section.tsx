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
import {
  canonicalRoleForAgentName,
  createDefaultCustomAgentConfig,
  duplicateAgentConfig,
  legacyAgentAliasForName,
} from "./agent-definitions";
import { AgentDefinitionEditor } from "./agent-definition-editor";
import {
  BUILTIN_SUBAGENT_WORKFLOWS,
  type RunSubagentWorkflowInput,
  type SubagentRunRecord,
} from "./subagent-workflows";
import { SettingsGroup, settingsPill } from "./settings-utils";

interface SettingsAgentsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly snapshot?: AgentDefinitionsSnapshot;
  readonly pending: boolean;
  readonly error?: string;
  readonly workspaceId?: string;
  readonly selectedSessionId?: string;
  readonly subagentRuns: readonly SubagentRunRecord[];
  readonly subagentRunsPending: boolean;
  readonly subagentRunsError?: string;
  readonly onSave: (input: SaveAgentDefinitionInput) => Promise<void>;
  readonly onReset: (input: ResetAgentDefinitionInput) => Promise<void>;
  readonly onDelete: (input: DeleteAgentDefinitionInput) => Promise<void>;
  readonly onRunWorkflow: (input: RunSubagentWorkflowInput) => Promise<void>;
  readonly onOpenRunTarget: (target: SubagentRunRecord["target"]) => void;
}

type EditorState =
  | { readonly mode: "create"; readonly config: AgentDefinitionConfig; readonly scope: "global" | "project"; readonly builtin: false }
  | { readonly mode: "edit"; readonly record: AgentDefinitionRecord }
  | undefined;

export function SettingsAgentsSection({
  runtime,
  snapshot,
  pending,
  error,
  workspaceId,
  selectedSessionId,
  subagentRuns,
  subagentRunsPending,
  subagentRunsError,
  onSave,
  onReset,
  onDelete,
  onRunWorkflow,
  onOpenRunTarget,
}: SettingsAgentsSectionProps) {
  const [editor, setEditor] = useState<EditorState>();
  const [deleteTarget, setDeleteTarget] = useState<AgentDefinitionRecord | undefined>();
  const [tab, setTab] = useState<"roles" | "workflows" | "runs">("roles");
  const agents = snapshot?.agents ?? [];

  const openNew = () => setEditor({ mode: "create", config: createDefaultCustomAgentConfig(), scope: "global", builtin: false });
  const openDuplicate = (agent: AgentDefinitionRecord) => setEditor({ mode: "create", config: duplicateAgentConfig(agent.config), scope: agent.scope ?? "global", builtin: false });

  return (
    <div data-testid="settings-agents-section">
      <div aria-label="Subagents" className="settings-tabs" role="tablist">
        {([
          ["roles", "Roles"],
          ["workflows", "Workflows"],
          ["runs", "Runs"],
        ] as const).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            className={settingsPill(tab === value)}
            key={value}
            role="tab"
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "roles" ? (
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
            {agents.map((agent) => {
              const legacyAlias = legacyAgentAliasForName(agent.name);
              return (
                <div className="agent-definition-row" data-testid={`agent-definition-row-${agent.name}`} key={agent.name}>
                  <div className="agent-definition-row__main">
                    <div className="agent-definition-row__title">{agent.config.displayName || agent.name}</div>
                    <div className="agent-definition-row__description">{agent.config.description}</div>
                    <div className="agent-definition-row__meta">
                      <span>{agent.source === "builtin" ? "Built-in" : agent.source === "project" ? "Project override" : "Global override"}</span>
                      <span>Name: {agent.name}</span>
                      <span>Role: {canonicalRoleForAgentName(agent.name, agent.config.role)}</span>
                      {legacyAlias ? <span>Legacy alias for {legacyAlias}</span> : null}
                      {agent.config.contextMode ? <span>Context: {agent.config.contextMode}</span> : null}
                      {agent.config.output ? <span>Output: {agent.config.output}</span> : null}
                      {agent.config.defaultProgress ? <span>Progress: {agent.config.defaultProgress}</span> : null}
                      {agent.config.maxSubagentDepth !== undefined ? <span>Max depth: {agent.config.maxSubagentDepth}</span> : null}
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
              );
            })}
          </div>
        </SettingsGroup>
      ) : null}

      {tab === "workflows" ? (
        <div className="subagent-workflow-grid">
          {BUILTIN_SUBAGENT_WORKFLOWS.map((workflow) => (
            <article className="subagent-workflow-card" data-testid={`subagent-workflow-${workflow.id}`} key={workflow.id}>
              <h3>{workflow.title}</h3>
              <p>{workflow.description}</p>
              <div className="agent-definition-row__meta">
                <span>{workflow.roles.join(" → ")}</span>
                <span>Artifacts: {workflow.artifacts.join(", ")}</span>
              </div>
              <button
                className="button button--primary"
                disabled={pending || subagentRunsPending || !workspaceId || !selectedSessionId}
                type="button"
                onClick={() =>
                  workspaceId && selectedSessionId
                    ? onRunWorkflow({ workflowId: workflow.id, target: { workspaceId, sessionId: selectedSessionId } })
                    : undefined
                }
              >
                Run workflow
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {tab === "runs" ? (
        <>
          {subagentRunsError ? <div className="settings-warning" role="alert">{subagentRunsError}</div> : null}
          <div className="agent-definitions-list">
            {subagentRuns.length === 0 ? <div className="settings-hint">No subagent workflow runs submitted yet.</div> : null}
            {subagentRuns.map((run) => (
              <div className="agent-definition-row" data-testid="subagent-run-row" key={run.id}>
                <div className="agent-definition-row__main">
                  <div className="agent-definition-row__title">{run.title}</div>
                  <div className="agent-definition-row__description">{run.status}{run.error ? ` · ${run.error}` : ""}</div>
                  <div className="agent-definition-row__meta">
                    <span>{run.roles.join(" → ")}</span>
                    <span>Artifacts: {run.artifacts.join(", ")}</span>
                    <span>{new Date(run.submittedAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="agent-definition-row__actions">
                  <button className="button button--secondary" type="button" onClick={() => onOpenRunTarget(run.target)}>Open transcript</button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {editor?.mode === "create" ? (
        <AgentDefinitionEditor mode="create" config={editor.config} runtime={runtime} defaultScope={editor.scope} builtin={false} pending={pending} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {editor?.mode === "edit" ? (
        <AgentDefinitionEditor mode="edit" config={editor.record.config} runtime={runtime} defaultScope={editor.record.scope ?? "global"} builtin={editor.record.builtin} pending={pending} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {deleteTarget?.scope ? (
        <div className="action-dialog-backdrop" role="presentation">
          <section aria-label="Delete role" aria-modal="true" className="action-dialog" role="dialog">
            <h2>Delete role</h2>
            <p>This removes the {deleteTarget.scope} markdown role definition file. This cannot delete built-in fallback roles.</p>
            <div className="action-dialog__actions">
              <button className="button button--secondary" type="button" onClick={() => setDeleteTarget(undefined)}>Cancel</button>
              <button className="button button--danger" type="button" onClick={async () => { await onDelete({ scope: deleteTarget.scope!, name: deleteTarget.name }); setDeleteTarget(undefined); }}>Delete role</button>
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
