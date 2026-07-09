import type { ReactNode } from "react";
import type { RuntimeSkillProfileRecord, RuntimeSkillRecord } from "@pi-gui/session-driver/runtime-types";
import type { AppView, DesktopAppState, SessionRecord, WorkspaceRecord, WorkspaceSessionTarget } from "../../desktop-state";
import type { SettingsSection } from "../../settings-utils";
import type { SkillUsageByPath } from "../../skill-usage";
import type { ReviewSnapshot } from "../../review/review-types";
import { ActiveSecondarySurface } from "../secondary-surfaces/secondary-surfaces";
import type { useAgents } from "../agents/use-agents";
import type { useRuntimeSelections } from "../models/use-runtime-selections";
import type { useSettingsActions } from "../settings/use-settings-actions";
import { createSecondarySurfaceProps, isSecondarySurfaceActive } from "./secondary-surface-props";

interface AppSecondarySurfaceProps {
  readonly activeView: AppView;
  readonly agents: ReturnType<typeof useAgents>;
  readonly commandPalette: ReactNode;
  readonly extensionsWorkspace: WorkspaceRecord | undefined;
  readonly onRefreshExtensionsRuntime: () => void;
  readonly onRefreshSkillsRuntime: () => void;
  readonly onOpenSubagentRunTarget: (target: WorkspaceSessionTarget) => void;
  readonly onOpenSubagentRunArtifact: (input: { readonly target: WorkspaceSessionTarget; readonly path: string }) => void;
  readonly onSelectExtensionsWorkspace: (workspaceId: string) => void;
  readonly onSelectSettingsSection: (section: SettingsSection) => void;
  readonly onSelectSettingsWorkspace: (workspaceId: string) => void;
  readonly onSelectSkillsWorkspace: (workspaceId: string) => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onSubmitReviewPrompt: (prompt: string) => void;
  readonly onTrySkill: (skill: RuntimeSkillRecord) => void;
  readonly reviewLoading: boolean;
  readonly reviewSnapshot: ReviewSnapshot | undefined;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly runtimeSelections: ReturnType<typeof useRuntimeSelections>;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly settingsActions: ReturnType<typeof useSettingsActions>;
  readonly settingsSection: SettingsSection;
  readonly settingsReturnView: AppView;
  readonly settingsWorkspace: WorkspaceRecord | undefined;
  readonly skillsUsageByPath: SkillUsageByPath;
  readonly skillsWorkspace: WorkspaceRecord | undefined;
  readonly snapshot: DesktopAppState;
}

export function AppSecondarySurface({
  activeView,
  agents,
  commandPalette,
  extensionsWorkspace,
  onRefreshExtensionsRuntime,
  onRefreshSkillsRuntime,
  onOpenSubagentRunTarget,
  onOpenSubagentRunArtifact,
  onSelectExtensionsWorkspace,
  onSelectSettingsSection,
  onSelectSettingsWorkspace,
  onSelectSkillsWorkspace,
  onSetActiveView,
  onSubmitReviewPrompt,
  onTrySkill,
  reviewLoading,
  reviewSnapshot,
  rootWorkspaceOptions,
  runtimeSelections,
  selectedSession,
  selectedWorkspace,
  settingsActions,
  settingsSection,
  settingsReturnView,
  settingsWorkspace,
  skillsUsageByPath,
  skillsWorkspace,
  snapshot,
}: AppSecondarySurfaceProps) {
  if (!isSecondarySurfaceActive(activeView)) {
    return null;
  }

  return (
    <ActiveSecondarySurface
      {...createSecondarySurfaceProps({
        activeView,
        commandPalette,
        settings: {
          section: settingsSection,
          workspaceOptions: rootWorkspaceOptions,
          onBack: () => onSetActiveView(settingsReturnView),
          onSelectSection: onSelectSettingsSection,
          onSelectWorkspace: onSelectSettingsWorkspace,
          viewProps: {
            workspace: settingsWorkspace,
            runtime: settingsSection === "models" || settingsSection === "agents"
              ? runtimeSelections.settingsModelRuntime
              : runtimeSelections.settingsRuntime,
            notificationPreferences: snapshot.notificationPreferences,
            diagnosticReporting: snapshot.diagnosticReporting,
            agentDefinitions: agents.agentDefinitions,
            agentDefinitionsPending: agents.agentDefinitionsPending,
            agentDefinitionsError: agents.agentDefinitionsError,
            selectedSessionId: selectedWorkspace?.id === settingsWorkspace?.id ? selectedSession?.id : undefined,
            subagentRuns: agents.subagentRuns,
            subagentRunsPending: agents.subagentRunsPending,
            subagentRunsError: agents.subagentRunsError,
            subagentWorkflows: agents.subagentWorkflows,
            subagentWorkflowsPending: agents.subagentWorkflowsPending,
            subagentWorkflowsError: agents.subagentWorkflowsError,
            notificationPermissionStatus: settingsActions.notificationPermissionStatus,
            notificationPermissionPending: settingsActions.notificationPermissionPending,
            modelSettingsScopeMode: snapshot.modelSettingsScopeMode,
            integratedTerminalShell: snapshot.integratedTerminalShell,
            desktopCustomInstructions: snapshot.desktopCustomInstructions,
            themeMode: settingsActions.themeMode,
            onLoginProvider: settingsActions.handleLoginProvider,
            onLogoutProvider: settingsActions.handleLogoutProvider,
            onSetProviderApiKey: settingsActions.handleSetProviderApiKey,
            onRemoveProviderApiKey: settingsActions.handleRemoveProviderApiKey,
            onSetModelSettingsScopeMode: settingsActions.handleSetModelSettingsScopeMode,
            onSetDefaultModel: settingsActions.handleSetDefaultModel,
            onSetNotificationPreferences: settingsActions.handleSetNotificationPreferences,
            onSetDiagnosticReportingPreferences: settingsActions.handleSetDiagnosticReportingPreferences,
            onSetIntegratedTerminalShell: settingsActions.handleSetIntegratedTerminalShell,
            onSetDesktopCustomInstructions: settingsActions.handleSetDesktopCustomInstructions,
            onRequestNotificationPermission: settingsActions.handleRequestNotificationPermission,
            onOpenSystemNotificationSettings: settingsActions.handleOpenSystemNotificationSettings,
            onSetScopedModelPatterns: settingsActions.handleSetScopedModelPatterns,
            onSetThemeMode: settingsActions.handleSetThemeMode,
            onSetThinkingLevel: settingsActions.handleSetThinkingLevel,
            onToggleSkillCommands: settingsActions.handleToggleSkillCommands,
            onSaveAgentDefinition: agents.handleSaveAgentDefinition,
            onResetAgentDefinition: agents.handleResetAgentDefinition,
            onDeleteAgentDefinition: agents.handleDeleteAgentDefinition,
            onSaveSubagentWorkflow: agents.handleSaveSubagentWorkflow,
            onDeleteSubagentWorkflow: agents.handleDeleteSubagentWorkflow,
            onRunWorkflow: agents.handleRunSubagentWorkflow,
            onCancelSubagentRun: agents.handleCancelSubagentRun,
            onOpenRunTarget: onOpenSubagentRunTarget,
            onOpenRunArtifact: onOpenSubagentRunArtifact,
            onOpenAgentsSettings: () => onSelectSettingsSection("agents"),
          },
        },
        review: {
          loading: reviewLoading,
          snapshot: reviewSnapshot,
          onBack: () => onSetActiveView("threads"),
          onSubmitPrompt: onSubmitReviewPrompt,
        },
        skills: {
          workspace: skillsWorkspace,
          runtime: runtimeSelections.skillsRuntime,
          usageByPath: skillsUsageByPath,
          workspaceOptions: rootWorkspaceOptions,
          onBack: () => onSetActiveView("threads"),
          onSelectWorkspace: onSelectSkillsWorkspace,
          onRefresh: onRefreshSkillsRuntime,
          onOpenSkillFolder: settingsActions.handleOpenSkillFolder,
          onSetSkillMode: settingsActions.handleSetSkillMode,
          onSetActiveProfile: (profileId: string) => settingsActions.handleSetActiveSkillProfile(skillsWorkspace?.id, profileId),
          onSaveProfile: (profile: RuntimeSkillProfileRecord) => settingsActions.handleSaveSkillProfile(skillsWorkspace?.id, profile),
          onDeleteProfile: (profileId: string) => settingsActions.handleDeleteSkillProfile(skillsWorkspace?.id, profileId),
          onTrySkill,
        },
        extensions: {
          workspace: extensionsWorkspace,
          runtime: runtimeSelections.extensionsRuntime,
          commandCompatibility: runtimeSelections.extensionsCommandCompatibility,
          workspaceOptions: rootWorkspaceOptions,
          onBack: () => onSetActiveView("threads"),
          onSelectWorkspace: onSelectExtensionsWorkspace,
          onRefresh: onRefreshExtensionsRuntime,
          onOpenExtensionFolder: settingsActions.handleOpenExtensionFolder,
          onToggleExtension: settingsActions.handleToggleExtension,
        },
      })}
    />
  );
}
