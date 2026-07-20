import { useState, type CSSProperties } from "react";
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
  BUILTIN_AGENT_CONFIGS,
  canonicalRoleForAgentName,
  createDefaultCustomAgentConfig,
  duplicateAgentConfig,
  legacyAgentAliasForName,
} from "./agent-definitions";
import { AgentDefinitionEditor } from "./agent-definition-editor";
import {
  builtinSubagentWorkflowRecords,
  baseWorkflowRole,
  type DeleteSubagentWorkflowInput,
  type RunSubagentWorkflowInput,
  type SaveSubagentWorkflowInput,
  type SubagentRunRecord,
  type SubagentWorkflowRecord,
  type SubagentWorkflowSnapshot,
  type SubagentWorkflowTemplate,
  validateSubagentWorkflowRoles,
} from "./subagent-workflows";
import { resolveSubagentShinobiFromMap, useSubagentShinobiMap } from "./subagent-shinobi-roster";
import { resolveSubagentRoleColor, useSubagentRoleColorMap } from "./subagent-role-colors";
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
  readonly subagentWorkflows?: SubagentWorkflowSnapshot;
  readonly subagentWorkflowsPending: boolean;
  readonly subagentWorkflowsError?: string;
  readonly onSave: (input: SaveAgentDefinitionInput) => Promise<void>;
  readonly onReset: (input: ResetAgentDefinitionInput) => Promise<void>;
  readonly onDelete: (input: DeleteAgentDefinitionInput) => Promise<void>;
  readonly onSaveWorkflow: (input: SaveSubagentWorkflowInput) => Promise<void>;
  readonly onDeleteWorkflow: (input: DeleteSubagentWorkflowInput) => Promise<void>;
  readonly onRunWorkflow: (input: RunSubagentWorkflowInput) => Promise<void>;
  readonly onCancelRun: (runId: string) => Promise<void>;
  readonly onOpenRunTarget: (target: SubagentRunRecord["target"]) => void;
  readonly onOpenRunArtifact: (input: { readonly target: SubagentRunRecord["target"]; readonly path: string }) => void;
}

type EditorState =
  | { readonly mode: "create"; readonly config: AgentDefinitionConfig; readonly scope: "global" | "project" }
  | { readonly mode: "edit"; readonly record: AgentDefinitionRecord }
  | undefined;

type WorkflowEditorState =
  | { readonly mode: "create"; readonly workflow: SubagentWorkflowTemplate; readonly scope: "global" | "project" }
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
  subagentWorkflows,
  subagentWorkflowsPending,
  subagentWorkflowsError,
  onSave,
  onReset,
  onDelete,
  onSaveWorkflow,
  onDeleteWorkflow,
  onRunWorkflow,
  onCancelRun,
  onOpenRunTarget,
  onOpenRunArtifact,
}: SettingsAgentsSectionProps) {
  const [editor, setEditor] = useState<EditorState>();
  const [workflowEditor, setWorkflowEditor] = useState<WorkflowEditorState>();
  const [deleteWorkflowTarget, setDeleteWorkflowTarget] = useState<SubagentWorkflowRecord | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<AgentDefinitionRecord | undefined>();
  const [tab, setTab] = useState<"roles" | "workflows" | "runs">("roles");
  const [subagentShinobiMap] = useSubagentShinobiMap();
  const [subagentRoleColorMap] = useSubagentRoleColorMap();
  const agents = snapshot?.agents ?? [];
  const workflows = subagentWorkflows?.workflows ?? builtinSubagentWorkflowRecords();

  const openNew = () => setEditor({ mode: "create", config: createDefaultCustomAgentConfig(), scope: "global" });
  const openDuplicate = (agent: AgentDefinitionRecord) => setEditor({ mode: "create", config: duplicateAgentConfig(agent.config), scope: agent.scope ?? "global" });
  const openNewWorkflow = () => setWorkflowEditor({
    mode: "create",
    scope: "global",
    workflow: {
      id: "custom-workflow",
      title: "Custom workflow",
      description: "Describe when to run this workflow.",
      roles: ["scout", "planner"],
      artifacts: ["context.md", "plan.md"],
    },
  });

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
              const role = canonicalRoleForAgentName(agent.name, agent.config.role);
              const selectedShinobi = resolveSubagentShinobiFromMap(subagentShinobiMap, agent.name, role);
              const roleColor = resolveSubagentRoleColor(subagentRoleColorMap, agent.name, role);
              return (
                <div className="agent-definition-row agent-definition-row--with-shinobi" data-testid={`agent-definition-row-${agent.name}`} key={agent.name} style={{ "--role-accent": roleColor } as CSSProperties}>
                  <div className="agent-definition-row__header">
                    <div className="agent-definition-row__identity">
                      <div className="agent-definition-row__shinobi-portrait" aria-hidden="true">
                        <img src={selectedShinobi.imageUrl} alt="" />
                      </div>
                      <div className="agent-definition-row__main">
                        <div className="agent-definition-row__title"><span>{agent.config.displayName || agent.name}</span><span className="agent-definition-row__color-dot" aria-hidden="true" /></div>
                        <div className="agent-definition-row__description">{agent.config.description}</div>
                        <div className="agent-definition-row__shinobi-copy">
                          <strong>{selectedShinobi.name}</strong>
                          <em>{selectedShinobi.meaning}</em>
                          {selectedShinobi.customImage ? <span>Custom image</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="agent-definition-row__actions">
                      <button
                        className="button button--secondary button--small"
                        disabled={pending || subagentRunsPending || !workspaceId || !selectedSessionId || !agent.config.enabled}
                        title={!agent.config.enabled ? "Enable this role before dry-running it." : "Run a bounded read-only definition check in the selected thread."}
                        type="button"
                        onClick={() => workspaceId && selectedSessionId ? onRunWorkflow({
                          workflowId: `dry-run:${agent.name}`,
                          target: { workspaceId, sessionId: selectedSessionId },
                        }) : undefined}
                      >
                        Dry run
                      </button>
                      <button className="button button--secondary button--small" disabled={pending} type="button" onClick={() => setEditor({ mode: "edit", record: agent })}>Edit</button>
                      <button className="button button--secondary button--small" disabled={pending} type="button" onClick={() => openDuplicate(agent)}>Duplicate</button>
                      {agent.source !== "builtin" && agent.scope ? (
                        agent.builtin ? (
                          <button className="button button--secondary button--small" disabled={pending} type="button" onClick={() => void onReset({ scope: agent.scope!, name: agent.name })}>Reset</button>
                        ) : (
                          <button className="button button--danger button--small" disabled={pending} type="button" onClick={() => setDeleteTarget(agent)}>Delete</button>
                        )
                      ) : null}
                    </div>
                  </div>
                  <div className="agent-definition-row__content">
                    <div className="agent-definition-row__meta">
                      <span>{agent.source === "builtin" ? "Built-in" : agent.source === "project" ? "Project override" : "Global override"}</span>
                      <span>Name: {agent.name}</span>
                      <span>Role: {role}</span>
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
                </div>
              );
            })}
          </div>
        </SettingsGroup>
      ) : null}

      {tab === "workflows" ? (
        <>
          <div className="settings-row">
            <div className="settings-row__label">
              <div className="settings-row__title">Workflow templates</div>
              <div className="settings-row__description">Create reusable role handoffs as markdown workflow files next to your agent definitions.</div>
            </div>
            <div className="settings-row__control">
              <button className="button button--primary" disabled={subagentWorkflowsPending} type="button" onClick={openNewWorkflow}>New workflow</button>
            </div>
          </div>
          {subagentWorkflowsError ? <div className="settings-warning" role="alert">{subagentWorkflowsError}</div> : null}
          {!subagentWorkflows ? <div className="settings-hint">Loading workflow templates…</div> : null}
          <div className="subagent-workflow-grid">
            {workflows.map((workflow) => {
              const validation = validateSubagentWorkflowRoles(workflow, agents);
              const hasMissingRoles = validation.missingRoles.length > 0;
              const repairInputs = repairMissingWorkflowRoleInputs(validation.missingRoles, agents);
              return (
                <article className="subagent-workflow-card" data-testid={`subagent-workflow-${workflow.id}`} key={`${workflow.source}:${workflow.id}`}>
                  <div className="subagent-workflow-card__header">
                    <div>
                      <h3>{workflow.title}</h3>
                      <div className="agent-definition-row__meta">
                        <span>{workflowSourceLabel(workflow)}</span>
                        <span>ID: {workflow.id}</span>
                      </div>
                    </div>
                    {workflow.source !== "builtin" && workflow.scope ? (
                      <button
                        className="button button--danger button--small"
                        disabled={subagentWorkflowsPending}
                        type="button"
                        onClick={() => setDeleteWorkflowTarget(workflow)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <p>{workflow.description}</p>
                  <div className="agent-definition-row__meta">
                    <span>{workflow.roles.join(" → ")}</span>
                    <span>Artifacts: {workflow.artifacts.length ? workflow.artifacts.join(", ") : "None"}</span>
                  </div>
                  {workflow.warnings.map((warning) => <div className="settings-warning" key={warning}>{warning}</div>)}
                  {hasMissingRoles ? (
                    <div className="settings-warning" role="alert">
                      Missing enabled role{validation.missingRoles.length === 1 ? "" : "s"}: {validation.missingRoles.join(", ")}
                    </div>
                  ) : null}
                  {repairInputs.length > 0 ? (
                    <button
                      className="button button--secondary"
                      disabled={pending}
                      type="button"
                      onClick={async () => {
                        for (const input of repairInputs) {
                          await onReset(input);
                        }
                      }}
                    >
                      {repairWorkflowButtonLabel(repairInputs)}
                    </button>
                  ) : null}
                  <button
                    className="button button--primary"
                    disabled={pending || subagentRunsPending || !workspaceId || !selectedSessionId || hasMissingRoles || workflow.roles.length === 0}
                    title={hasMissingRoles ? "Enable or create the missing roles before running this workflow." : undefined}
                    type="button"
                    onClick={() =>
                      workspaceId && selectedSessionId && !hasMissingRoles
                        ? onRunWorkflow({ workflowId: workflow.id, target: { workspaceId, sessionId: selectedSessionId } })
                        : undefined
                    }
                  >
                    Run workflow
                  </button>
                </article>
              );
            })}
          </div>
        </>
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
                  <div className="agent-definition-row__description">
                    {run.status}{run.summary ? ` · ${run.summary}` : run.error ? ` · ${run.error}` : ""}
                  </div>
                  <div className="agent-definition-row__meta">
                    <span>{run.roles.join(" → ")}</span>
                    {run.childRuns ? <span>Agent runs: {run.childRuns.length}/{run.roles.length}</span> : null}
                    <span>Artifacts: {run.artifacts.join(", ")}</span>
                    {run.toolUseCount !== undefined ? <span>Tool uses: {run.toolUseCount}</span> : null}
                    {run.elapsedMs !== undefined ? <span>Elapsed: {formatRunElapsed(run.elapsedMs)}</span> : null}
                    {run.transcriptPath ? <span title={run.transcriptPath}>Transcript: {run.transcriptPath}</span> : null}
                    <span>{new Date(run.submittedAt).toLocaleString()}</span>
                  </div>
                  {run.childRuns?.length ? (
                    <div className="agent-definition-row__meta" aria-label="Agent run statuses">
                      {run.childRuns.map((child) => (
                        <span key={child.id}>
                          {child.role ?? child.agentName ?? "Agent"}: {child.status}
                          {child.toolUseCount !== undefined ? ` · ${child.toolUseCount} tools` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {run.artifactPaths?.length ? (
                    <div className="agent-definition-row__meta" aria-label="Produced artifacts">
                      <span>Produced artifacts:</span>
                      {run.artifactPaths.map((path) => (
                        <button
                          className="button button--secondary button--small"
                          key={path}
                          title={path}
                          type="button"
                          onClick={() => onOpenRunArtifact({ target: run.target, path })}
                        >
                          {path}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="agent-definition-row__actions">
                  {isActiveSubagentRun(run) ? (
                    <button
                      className="button button--secondary"
                      disabled={subagentRunsPending}
                      type="button"
                      onClick={() => onCancelRun(run.id)}
                    >
                      Cancel workflow
                    </button>
                  ) : null}
                  {isTerminalSubagentRun(run) ? (
                    <button
                      className="button button--secondary"
                      disabled={subagentRunsPending}
                      type="button"
                      onClick={() => onRunWorkflow({ workflowId: run.workflowId, target: run.target })}
                    >
                      Retry workflow
                    </button>
                  ) : null}
                  <button className="button button--secondary" type="button" onClick={() => onOpenRunTarget(run.target)}>Open transcript</button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {editor?.mode === "create" ? (
        <AgentDefinitionEditor mode="create" config={editor.config} agentKey={editor.config.name} runtime={runtime} defaultScope={editor.scope} builtin={false} pending={pending} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {editor?.mode === "edit" ? (
        <AgentDefinitionEditor mode="edit" config={editor.record.config} agentKey={editor.record.name} runtime={runtime} defaultScope={editor.record.scope ?? "global"} builtin={editor.record.builtin} pending={pending} onClose={() => setEditor(undefined)} onSave={async (input) => { await onSave(input); setEditor(undefined); }} />
      ) : null}
      {workflowEditor?.mode === "create" ? (
        <WorkflowDefinitionEditor
          defaultScope={workflowEditor.scope}
          pending={subagentWorkflowsPending}
          workflow={workflowEditor.workflow}
          onClose={() => setWorkflowEditor(undefined)}
          onSave={async (input) => {
            await onSaveWorkflow(input);
            setWorkflowEditor(undefined);
          }}
        />
      ) : null}
      {deleteWorkflowTarget?.scope ? (
        <div className="action-dialog-backdrop" role="presentation">
          <section aria-label="Delete workflow" aria-modal="true" className="action-dialog" role="dialog">
            <h2>Delete workflow</h2>
            <p>This removes the {deleteWorkflowTarget.scope} markdown workflow template. Built-in fallback workflows remain available unless this file was overriding one.</p>
            <div className="action-dialog__actions">
              <button className="button button--secondary" type="button" onClick={() => setDeleteWorkflowTarget(undefined)}>Cancel</button>
              <button
                className="button button--danger"
                disabled={subagentWorkflowsPending}
                type="button"
                onClick={async () => {
                  await onDeleteWorkflow({ scope: deleteWorkflowTarget.scope!, id: deleteWorkflowTarget.id });
                  setDeleteWorkflowTarget(undefined);
                }}
              >
                Delete workflow
              </button>
            </div>
          </section>
        </div>
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

interface WorkflowDefinitionEditorProps {
  readonly workflow: SubagentWorkflowTemplate;
  readonly defaultScope: "global" | "project";
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSave: (input: SaveSubagentWorkflowInput) => Promise<void>;
}

function WorkflowDefinitionEditor({
  workflow,
  defaultScope,
  pending,
  onClose,
  onSave,
}: WorkflowDefinitionEditorProps) {
  const [scope, setScope] = useState<"global" | "project">(defaultScope);
  const [id, setId] = useState(workflow.id);
  const [title, setTitle] = useState(workflow.title);
  const [description, setDescription] = useState(workflow.description);
  const [roles, setRoles] = useState(workflow.roles.join(" -> "));
  const [artifacts, setArtifacts] = useState(workflow.artifacts.join(", "));
  const [error, setError] = useState<string | undefined>();

  return (
    <div className="action-dialog-backdrop" role="presentation">
      <section aria-label="New workflow" aria-modal="true" className="action-dialog" role="dialog">
        <h2>New workflow</h2>
        {error ? <div className="settings-warning" role="alert">{error}</div> : null}
        <label className="action-dialog__field">
          <span>Scope</span>
          <select className="settings-select" value={scope} onChange={(event) => setScope(event.currentTarget.value as "global" | "project")}>
            <option value="global">Global</option>
            <option value="project">Project</option>
          </select>
        </label>
        <label className="action-dialog__field">
          <span>Workflow ID</span>
          <input value={id} onChange={(event) => setId(event.currentTarget.value)} />
        </label>
        <label className="action-dialog__field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        </label>
        <label className="action-dialog__field">
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
        </label>
        <label className="action-dialog__field">
          <span>Roles</span>
          <input value={roles} onChange={(event) => setRoles(event.currentTarget.value)} />
        </label>
        <label className="action-dialog__field">
          <span>Artifacts</span>
          <input value={artifacts} onChange={(event) => setArtifacts(event.currentTarget.value)} />
        </label>
        <div className="action-dialog__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="button button--primary"
            disabled={pending}
            type="button"
            onClick={async () => {
              const parsedRoles = parseWorkflowListInput(roles);
              const parsedArtifacts = parseWorkflowListInput(artifacts);
              if (!id.trim() || !title.trim() || !description.trim() || parsedRoles.length === 0) {
                setError("Workflow ID, title, description, and at least one role are required.");
                return;
              }
              setError(undefined);
              await onSave({
                scope,
                workflow: {
                  id: id.trim(),
                  title: title.trim(),
                  description: description.trim(),
                  roles: parsedRoles,
                  artifacts: parsedArtifacts,
                },
              });
            }}
          >
            Save workflow
          </button>
        </div>
      </section>
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

const BUILTIN_AGENT_NAMES = new Set(BUILTIN_AGENT_CONFIGS.map((config) => config.name));

function repairMissingWorkflowRoleInputs(
  missingRoles: readonly string[],
  agents: readonly AgentDefinitionRecord[],
): readonly ResetAgentDefinitionInput[] {
  const inputs = new Map<string, ResetAgentDefinitionInput>();
  for (const role of missingRoles) {
    const name = baseWorkflowRole(role);
    if (!BUILTIN_AGENT_NAMES.has(name)) continue;
    const visibleAgent = agents.find((agent) => agent.name === name);
    const scope = visibleAgent?.scope ?? "global";
    inputs.set(`${scope}:${name}`, { scope, name });
  }
  return [...inputs.values()];
}

function repairWorkflowButtonLabel(inputs: readonly ResetAgentDefinitionInput[]): string {
  const first = inputs[0];
  return inputs.length === 1 && first ? `Restore ${first.name}` : "Restore missing roles";
}

function workflowSourceLabel(workflow: SubagentWorkflowRecord): string {
  if (workflow.source === "builtin") return "Built-in";
  const scopeLabel = workflow.source === "project" ? "Project" : "Global";
  return workflow.overridden ? `${scopeLabel} override` : `${scopeLabel} custom`;
}

function parseWorkflowListInput(value: string): readonly string[] {
  return value
    .split(/(?:\s*->\s*|,)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isTerminalSubagentRun(run: SubagentRunRecord): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

function isActiveSubagentRun(run: SubagentRunRecord): boolean {
  return run.status === "submitted" || run.status === "running";
}

function formatRunElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  return `${Math.round(elapsedMs / 1000)}s`;
}
