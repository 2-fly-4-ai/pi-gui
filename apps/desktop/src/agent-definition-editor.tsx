import { useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { AgentDefinitionConfig, AgentDefinitionScope, SaveAgentDefinitionInput } from "./agent-definitions";
import { AGENT_TOOL_OPTIONS } from "./agent-definitions";
import {
  buildAgentDefinitionConfig,
  createAgentDefinitionFormState,
  toggleAgentTool,
  validateAgentDefinitionForm,
  type AgentDefinitionFormState,
} from "./agent-definition-form";
import { THINKING_LEVELS, labelForThinking } from "./settings-utils";

interface AgentDefinitionEditorProps {
  readonly mode: "create" | "edit";
  readonly config: AgentDefinitionConfig;
  readonly runtime?: RuntimeSnapshot;
  readonly defaultScope: AgentDefinitionScope;
  readonly builtin: boolean;
  readonly pending?: boolean;
  readonly onClose: () => void;
  readonly onSave: (input: SaveAgentDefinitionInput) => Promise<void> | void;
}

export function AgentDefinitionEditor({ mode, config, runtime, defaultScope, builtin, pending = false, onClose, onSave }: AgentDefinitionEditorProps) {
  const title = mode === "create" ? "New role" : `Edit ${config.name}`;
  const titleId = `agent-definition-editor-title-${mode}-${config.name || "new"}`;
  const [form, setForm] = useState<AgentDefinitionFormState>(() => createAgentDefinitionFormState({ mode, config, scope: defaultScope, builtin }));
  const [attemptedSave, setAttemptedSave] = useState(false);
  const validation = validateAgentDefinitionForm(form);
  const enabledModels = useMemo(() => (runtime?.models ?? []).filter((model) => model.available), [runtime]);

  const update = <Key extends keyof AgentDefinitionFormState>(key: Key, value: AgentDefinitionFormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    setAttemptedSave(true);
    if (!validation.valid) return;
    void Promise.resolve(onSave({ scope: form.scope, config: buildAgentDefinitionConfig(form) })).catch(() => undefined);
  };

  return (
    <div className="action-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby={titleId} aria-modal="true" className="action-dialog agent-definition-editor agent-definition-editor--wide" data-testid="agent-definition-editor" role="dialog">
        <header className="agent-definition-editor__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>Create and tune subagent role definitions without editing markdown by hand.</p>
          </div>
          <label className="agent-definition-editor__enabled">
            <input aria-label="Enabled" checked={form.enabled} type="checkbox" onChange={(event) => update("enabled", event.target.checked)} />
            <span>Enabled</span>
          </label>
        </header>

        {attemptedSave && !validation.valid ? (
          <div className="settings-warning" role="alert">
            {validation.errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        ) : null}

        <div className="agent-definition-editor__grid">
          <label className="action-dialog__field">
            <span>Role name</span>
            <input aria-label="Role name" disabled={mode === "edit"} value={form.name} onChange={(event) => update("name", event.target.value)} />
          </label>
          <label className="action-dialog__field">
            <span>Display name</span>
            <input aria-label="Display name" value={form.displayName} onChange={(event) => update("displayName", event.target.value)} />
          </label>
          <label className="action-dialog__field agent-definition-editor__span">
            <span>Description</span>
            <input aria-label="Description" value={form.description} onChange={(event) => update("description", event.target.value)} />
          </label>
          <label className="action-dialog__field">
            <span>Role</span>
            <select aria-label="Role" className="settings-select" value={form.role} onChange={(event) => update("role", event.target.value)}>
              <option value="">Infer from name</option>
              <option value="delegate">Delegate</option>
              <option value="scout">Scout</option>
              <option value="planner">Planner</option>
              <option value="worker">Worker</option>
              <option value="reviewer">Reviewer</option>
              <option value="oracle">Oracle</option>
              <option value="researcher">Researcher</option>
              <option value="context-builder">Context Builder</option>
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Context</span>
            <select aria-label="Context mode" className="settings-select" value={form.contextMode} onChange={(event) => update("contextMode", event.target.value as AgentDefinitionFormState["contextMode"])}>
              <option value="">Default</option>
              <option value="fresh">Fresh</option>
              <option value="fork">Fork current thread</option>
              <option value="project">Project context</option>
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Output</span>
            <select aria-label="Output" className="settings-select" value={form.output} onChange={(event) => update("output", event.target.value as AgentDefinitionFormState["output"])}>
              <option value="">Default</option>
              <option value="message">Message</option>
              <option value="artifact">Artifact</option>
              <option value="both">Message + artifact</option>
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Progress</span>
            <select aria-label="Progress" className="settings-select" value={form.defaultProgress} onChange={(event) => update("defaultProgress", event.target.value as AgentDefinitionFormState["defaultProgress"])}>
              <option value="">Default</option>
              <option value="silent">Silent</option>
              <option value="summary">Summary</option>
              <option value="stream">Stream</option>
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Scope</span>
            <select aria-label="Scope" className="settings-select" value={form.scope} onChange={(event) => update("scope", event.target.value as AgentDefinitionScope)}>
              <option value="global">Global — all projects</option>
              <option value="project">Project — this workspace</option>
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Model</span>
            <select aria-label="Model" className="settings-select" value={form.modelValue} onChange={(event) => update("modelValue", event.target.value)}>
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
            <select aria-label="Reasoning" className="settings-select" value={form.thinkingValue} onChange={(event) => update("thinkingValue", event.target.value as AgentDefinitionFormState["thinkingValue"])}>
              <option value="inherit">Inherit</option>
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              {THINKING_LEVELS.map((level) => <option key={level} value={level}>{labelForThinking(level)}</option>)}
            </select>
          </label>
          <label className="action-dialog__field">
            <span>Prompt mode</span>
            <select aria-label="Prompt mode" className="settings-select" value={form.promptMode} onChange={(event) => update("promptMode", event.target.value as "append" | "replace")}>
              <option value="replace">Replace — standalone agent prompt</option>
              <option value="append">Append — parent-twin prompt</option>
            </select>
          </label>
          <label className="action-dialog__field">
            <span>System prompt mode</span>
            <select aria-label="System prompt mode" className="settings-select" value={form.systemPromptMode} onChange={(event) => update("systemPromptMode", event.target.value as AgentDefinitionFormState["systemPromptMode"])}>
              <option value="">Default</option>
              <option value="replace">Replace</option>
              <option value="append">Append</option>
            </select>
          </label>
        </div>

        <label className="action-dialog__field">
          <span>System prompt</span>
          <textarea aria-label="System prompt" className="agent-definition-editor__prompt" value={form.systemPrompt} onChange={(event) => update("systemPrompt", event.target.value)} />
        </label>

        <section className="agent-definition-editor__panel">
          <h3>Tools and context</h3>
          <div className="agent-definition-editor__checks">
            {AGENT_TOOL_OPTIONS.map((tool) => (
              <label className="agent-definition-editor__check" key={tool.name}>
                <input
                  aria-label={`Tool: ${tool.name}`}
                  checked={form.tools.includes(tool.name)}
                  type="checkbox"
                  onChange={(event) => update("tools", toggleAgentTool(form.tools, tool.name, event.target.checked))}
                />
                <span><strong>{tool.label}</strong><small>{tool.description}</small></span>
              </label>
            ))}
          </div>
          <div className="agent-definition-editor__grid agent-definition-editor__grid--compact">
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Extensions" checked={form.extensions} type="checkbox" onChange={(event) => update("extensions", event.target.checked)} />
              <span>Extensions</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Skills" checked={form.skills} type="checkbox" onChange={(event) => update("skills", event.target.checked)} />
              <span>Skills</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Inherit context" checked={form.inheritContext} type="checkbox" onChange={(event) => update("inheritContext", event.target.checked)} />
              <span>Inherit context</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Run in background" checked={form.runInBackground} type="checkbox" onChange={(event) => update("runInBackground", event.target.checked)} />
              <span>Run in background</span>
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Isolated" checked={form.isolated} type="checkbox" onChange={(event) => update("isolated", event.target.checked)} />
              <span>Isolated</span>
            </label>
            <label className="action-dialog__field">
              <span>Isolation</span>
              <select aria-label="Isolation" className="settings-select" value={form.isolation} onChange={(event) => update("isolation", event.target.value as "" | "worktree")}>
                <option value="">None</option>
                <option value="worktree">Worktree</option>
              </select>
            </label>
            <label className="action-dialog__field">
              <span>Max turns</span>
              <input aria-label="Max turns" inputMode="numeric" value={form.maxTurns} onChange={(event) => update("maxTurns", event.target.value)} />
            </label>
            <label className="action-dialog__field">
              <span>Fallback models</span>
              <input aria-label="Fallback models" placeholder="openai/gpt-5, anthropic/claude-sonnet-4-5" value={form.fallbackModels} onChange={(event) => update("fallbackModels", event.target.value)} />
            </label>
            <label className="action-dialog__field">
              <span>Default reads</span>
              <input aria-label="Default reads" placeholder="README.md, AGENTS.md" value={form.defaultReads} onChange={(event) => update("defaultReads", event.target.value)} />
            </label>
            <label className="action-dialog__field">
              <span>Max subagent depth</span>
              <input aria-label="Max subagent depth" inputMode="numeric" value={form.maxSubagentDepth} onChange={(event) => update("maxSubagentDepth", event.target.value)} />
            </label>
            <label className="agent-definition-editor__inline-check">
              <input aria-label="Inherit project context" checked={form.inheritProjectContext} type="checkbox" onChange={(event) => update("inheritProjectContext", event.target.checked)} />
              <span>Inherit project context</span>
            </label>
          </div>
        </section>

        <div className="action-dialog__actions">
          <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" disabled={pending} type="button" onClick={save}>{mode === "create" ? "Create role" : "Save"}</button>
        </div>
      </section>
    </div>
  );
}
