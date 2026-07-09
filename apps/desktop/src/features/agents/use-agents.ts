import { useCallback, useEffect, useState } from "react";
import type { AgentDefinitionsSnapshot, DeleteAgentDefinitionInput, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "../../agent-definitions";
import type {
  DeleteSubagentWorkflowInput,
  RunSubagentWorkflowInput,
  SaveSubagentWorkflowInput,
  SubagentRunRecord,
  SubagentWorkflowSnapshot,
} from "../../subagent-workflows";
import type { AppView } from "../../desktop-state";

type SettingsSection = "appearance" | "general" | "providers" | "models" | "agents" | "notifications";

interface UseAgentsOptions {
  readonly api: typeof window.piApp;
  readonly activeView: AppView | undefined;
  readonly settingsSection: SettingsSection;
  readonly settingsWorkspaceId: string | undefined;
}

export function useAgents({
  api,
  activeView,
  settingsSection,
  settingsWorkspaceId,
}: UseAgentsOptions) {
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinitionsSnapshot | undefined>();
  const [agentDefinitionsPending, setAgentDefinitionsPending] = useState(false);
  const [agentDefinitionsError, setAgentDefinitionsError] = useState<string | undefined>();
  const [subagentRuns, setSubagentRuns] = useState<readonly SubagentRunRecord[]>([]);
  const [subagentRunsPending, setSubagentRunsPending] = useState(false);
  const [subagentRunsError, setSubagentRunsError] = useState<string | undefined>();
  const [subagentWorkflows, setSubagentWorkflows] = useState<SubagentWorkflowSnapshot | undefined>();
  const [subagentWorkflowsPending, setSubagentWorkflowsPending] = useState(false);
  const [subagentWorkflowsError, setSubagentWorkflowsError] = useState<string | undefined>();

  const loadAgentDefinitions = useCallback((workspaceId?: string) => {
    if (!api || !workspaceId) {
      setAgentDefinitions(undefined);
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    void api.listAgentDefinitions(workspaceId).then(setAgentDefinitions).catch((error) => {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to load agent definitions", error);
    }).finally(() => setAgentDefinitionsPending(false));
  }, [api]);

  const loadSubagentRuns = useCallback((workspaceId?: string) => {
    if (!api || !workspaceId) {
      setSubagentRuns([]);
      setSubagentRunsError(undefined);
      setSubagentRunsPending(false);
      return;
    }
    setSubagentRunsPending(true);
    setSubagentRunsError(undefined);
    void api.listSubagentRuns(workspaceId).then(setSubagentRuns).catch((error) => {
      setSubagentRunsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to load subagent runs", error);
    }).finally(() => setSubagentRunsPending(false));
  }, [api]);

  const loadSubagentWorkflows = useCallback((workspaceId?: string) => {
    if (!api || !workspaceId) {
      setSubagentWorkflows(undefined);
      setSubagentWorkflowsError(undefined);
      setSubagentWorkflowsPending(false);
      return;
    }
    setSubagentWorkflowsPending(true);
    setSubagentWorkflowsError(undefined);
    void api.listSubagentWorkflows(workspaceId).then(setSubagentWorkflows).catch((error) => {
      setSubagentWorkflowsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to load subagent workflows", error);
    }).finally(() => setSubagentWorkflowsPending(false));
  }, [api]);

  useEffect(() => {
    if (activeView === "settings" && settingsSection === "agents") {
      loadAgentDefinitions(settingsWorkspaceId);
      loadSubagentWorkflows(settingsWorkspaceId);
      loadSubagentRuns(settingsWorkspaceId);
    }
  }, [activeView, loadAgentDefinitions, loadSubagentRuns, loadSubagentWorkflows, settingsSection, settingsWorkspaceId]);

  useEffect(() => {
    if (!api || activeView !== "settings" || settingsSection !== "agents" || !settingsWorkspaceId) {
      return undefined;
    }
    return api.onSubagentRunsChanged((workspaceId) => {
      if (workspaceId === settingsWorkspaceId) {
        loadSubagentRuns(settingsWorkspaceId);
      }
    });
  }, [activeView, api, loadSubagentRuns, settingsSection, settingsWorkspaceId]);

  const handleSaveAgentDefinition = async (input: SaveAgentDefinitionInput) => {
    if (!api || !settingsWorkspaceId) {
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    try {
      setAgentDefinitions(await api.saveAgentDefinition(settingsWorkspaceId, input));
    } catch (error) {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to save agent definition", error);
      throw error;
    } finally {
      setAgentDefinitionsPending(false);
    }
  };

  const handleResetAgentDefinition = async (input: ResetAgentDefinitionInput) => {
    if (!api || !settingsWorkspaceId) {
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    try {
      setAgentDefinitions(await api.resetAgentDefinition(settingsWorkspaceId, input));
    } catch (error) {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to reset agent definition", error);
      throw error;
    } finally {
      setAgentDefinitionsPending(false);
    }
  };

  const handleDeleteAgentDefinition = async (input: DeleteAgentDefinitionInput) => {
    if (!api || !settingsWorkspaceId) {
      return;
    }
    setAgentDefinitionsPending(true);
    setAgentDefinitionsError(undefined);
    try {
      setAgentDefinitions(await api.deleteAgentDefinition(settingsWorkspaceId, input));
    } catch (error) {
      setAgentDefinitionsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to delete agent definition", error);
      throw error;
    } finally {
      setAgentDefinitionsPending(false);
    }
  };

  const handleRunSubagentWorkflow = async (input: RunSubagentWorkflowInput) => {
    if (!api || !settingsWorkspaceId) {
      return;
    }
    setSubagentRunsPending(true);
    setSubagentRunsError(undefined);
    try {
      setSubagentRuns(await api.runSubagentWorkflow(settingsWorkspaceId, input));
    } catch (error) {
      setSubagentRunsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to run subagent workflow", error);
      throw error;
    } finally {
      setSubagentRunsPending(false);
    }
  };

  const handleSaveSubagentWorkflow = async (input: SaveSubagentWorkflowInput) => {
    if (!api || !settingsWorkspaceId) {
      return;
    }
    setSubagentWorkflowsPending(true);
    setSubagentWorkflowsError(undefined);
    try {
      setSubagentWorkflows(await api.saveSubagentWorkflow(settingsWorkspaceId, input));
    } catch (error) {
      setSubagentWorkflowsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to save subagent workflow", error);
      throw error;
    } finally {
      setSubagentWorkflowsPending(false);
    }
  };

  const handleDeleteSubagentWorkflow = async (input: DeleteSubagentWorkflowInput) => {
    if (!api || !settingsWorkspaceId) {
      return;
    }
    setSubagentWorkflowsPending(true);
    setSubagentWorkflowsError(undefined);
    try {
      setSubagentWorkflows(await api.deleteSubagentWorkflow(settingsWorkspaceId, input));
    } catch (error) {
      setSubagentWorkflowsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to delete subagent workflow", error);
      throw error;
    } finally {
      setSubagentWorkflowsPending(false);
    }
  };

  const handleCancelSubagentRun = async (runId: string) => {
    if (!api || !settingsWorkspaceId) {
      return;
    }
    setSubagentRunsPending(true);
    setSubagentRunsError(undefined);
    try {
      setSubagentRuns(await api.cancelSubagentRun(settingsWorkspaceId, runId));
    } catch (error) {
      setSubagentRunsError(error instanceof Error ? error.message : String(error));
      console.warn("Failed to cancel subagent workflow run", error);
      throw error;
    } finally {
      setSubagentRunsPending(false);
    }
  };

  return {
    agentDefinitions,
    agentDefinitionsError,
    agentDefinitionsPending,
    handleDeleteAgentDefinition,
    handleDeleteSubagentWorkflow,
    handleCancelSubagentRun,
    handleResetAgentDefinition,
    handleRunSubagentWorkflow,
    handleSaveAgentDefinition,
    handleSaveSubagentWorkflow,
    subagentRuns,
    subagentRunsError,
    subagentRunsPending,
    subagentWorkflows,
    subagentWorkflowsError,
    subagentWorkflowsPending,
  };
}
