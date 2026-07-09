import type { ReactNode } from "react";
import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { AgentDefinitionsSnapshot, DeleteAgentDefinitionInput, ResetAgentDefinitionInput, SaveAgentDefinitionInput } from "./agent-definitions";
import type {
  DesktopCustomInstructionsRecord,
  DiagnosticReportingPreferences,
  ModelSettingsScopeMode,
  NotificationPreferences,
  WorkspaceRecord,
} from "./desktop-state";
import type { DesktopNotificationPermissionStatus } from "./ipc";
import type { RunSubagentWorkflowInput, SubagentRunRecord } from "./subagent-workflows";
import { SettingsAgentsSection } from "./settings-agents-section";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsGeneralSection } from "./settings-general-section";
import { SettingsModelsSection } from "./settings-models-section";
import { SettingsNotificationsSection } from "./settings-notifications-section";
import { SettingsProvidersSection } from "./settings-providers-section";
import { type SettingsSection, sectionTitle, sectionDescription } from "./settings-utils";

export type { SettingsSection } from "./settings-utils";

interface SettingsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly section: SettingsSection;
  readonly notificationPreferences: NotificationPreferences;
  readonly diagnosticReporting: DiagnosticReportingPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly agentDefinitions?: AgentDefinitionsSnapshot;
  readonly agentDefinitionsPending: boolean;
  readonly agentDefinitionsError?: string;
  readonly selectedSessionId?: string;
  readonly subagentRuns: readonly SubagentRunRecord[];
  readonly subagentRunsPending: boolean;
  readonly subagentRunsError?: string;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly desktopCustomInstructions: DesktopCustomInstructionsRecord;
  readonly themeMode: "system" | "light" | "dark";
  readonly headerAccessory?: ReactNode;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetScopedModelPatterns: (patterns: readonly string[]) => void;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly onRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSetDiagnosticReportingPreferences: (preferences: Partial<DiagnosticReportingPreferences>) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onSetDesktopCustomInstructions: (input: Partial<DesktopCustomInstructionsRecord>) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: "system" | "light" | "dark") => void;
  readonly onSaveAgentDefinition: (input: SaveAgentDefinitionInput) => Promise<void>;
  readonly onResetAgentDefinition: (input: ResetAgentDefinitionInput) => Promise<void>;
  readonly onDeleteAgentDefinition: (input: DeleteAgentDefinitionInput) => Promise<void>;
  readonly onRunWorkflow: (input: RunSubagentWorkflowInput) => Promise<void>;
  readonly onCancelSubagentRun: (runId: string) => Promise<void>;
  readonly onOpenRunTarget: (target: SubagentRunRecord["target"]) => void;
  readonly onOpenRunArtifact: (input: { readonly target: SubagentRunRecord["target"]; readonly path: string }) => void;
  readonly onOpenAgentsSettings: () => void;
}

export function SettingsView({
  workspace,
  runtime,
  section,
  notificationPreferences,
  diagnosticReporting,
  notificationPermissionStatus,
  notificationPermissionPending,
  agentDefinitions,
  agentDefinitionsPending,
  agentDefinitionsError,
  selectedSessionId,
  subagentRuns,
  subagentRunsPending,
  subagentRunsError,
  modelSettingsScopeMode,
  integratedTerminalShell,
  desktopCustomInstructions,
  themeMode,
  headerAccessory,
  onSetModelSettingsScopeMode,
  onSetDefaultModel,
  onSetThinkingLevel,
  onToggleSkillCommands,
  onSetScopedModelPatterns,
  onLoginProvider,
  onLogoutProvider,
  onSetProviderApiKey,
  onRemoveProviderApiKey,
  onSetNotificationPreferences,
  onSetDiagnosticReportingPreferences,
  onSetIntegratedTerminalShell,
  onSetDesktopCustomInstructions,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
  onSetThemeMode,
  onSaveAgentDefinition,
  onResetAgentDefinition,
  onDeleteAgentDefinition,
  onRunWorkflow,
  onCancelSubagentRun,
  onOpenRunTarget,
  onOpenRunArtifact,
  onOpenAgentsSettings,
}: SettingsViewProps) {
  if (!workspace && section !== "general" && section !== "notifications" && section !== "appearance") {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">Settings</div>
          <h1>Select a workspace</h1>
          <p>Provider and skill settings need a selected workspace.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation settings-view">
        <header className="view-header settings-view__header">
          <div>
            <div className="chat-header__eyebrow">Settings</div>
            <h1 className="view-header__title">{sectionTitle(section)}</h1>
            <p className="view-header__body">
              {sectionDescription(section, workspace?.name ?? "this workspace")}
            </p>
          </div>
          {headerAccessory ? <div className="settings-view__header-accessory">{headerAccessory}</div> : null}
        </header>

        <div className="settings-grid">
          {section === "appearance" ? (
            <SettingsAppearanceSection
              themeMode={themeMode}
              onSetThemeMode={onSetThemeMode}
            />
          ) : null}

          {section === "general" ? (
            <SettingsGeneralSection
              runtime={runtime}
              modelSettingsScopeMode={modelSettingsScopeMode}
              integratedTerminalShell={integratedTerminalShell}
              desktopCustomInstructions={desktopCustomInstructions}
              diagnosticReporting={diagnosticReporting}
              onSetModelSettingsScopeMode={onSetModelSettingsScopeMode}
              onSetIntegratedTerminalShell={onSetIntegratedTerminalShell}
              onSetDesktopCustomInstructions={onSetDesktopCustomInstructions}
              onSetDiagnosticReportingPreferences={onSetDiagnosticReportingPreferences}
              onToggleSkillCommands={onToggleSkillCommands}
            />
          ) : null}

          {section === "providers" ? (
            <SettingsProvidersSection
              runtime={runtime}
              onLoginProvider={onLoginProvider}
              onLogoutProvider={onLogoutProvider}
              onSetProviderApiKey={onSetProviderApiKey}
              onRemoveProviderApiKey={onRemoveProviderApiKey}
            />
          ) : null}

          {section === "models" ? (
            <SettingsModelsSection
              runtime={runtime}
              onSetDefaultModel={onSetDefaultModel}
              onSetScopedModelPatterns={onSetScopedModelPatterns}
              onSetThinkingLevel={onSetThinkingLevel}
              onOpenAgentsSettings={onOpenAgentsSettings}
            />
          ) : null}

          {section === "agents" ? (
            <SettingsAgentsSection
              runtime={runtime}
              snapshot={agentDefinitions}
              pending={agentDefinitionsPending}
              error={agentDefinitionsError}
              workspaceId={workspace?.id}
              selectedSessionId={selectedSessionId}
              subagentRuns={subagentRuns}
              subagentRunsPending={subagentRunsPending}
              subagentRunsError={subagentRunsError}
              onSave={onSaveAgentDefinition}
              onReset={onResetAgentDefinition}
              onDelete={onDeleteAgentDefinition}
              onRunWorkflow={onRunWorkflow}
              onCancelRun={onCancelSubagentRun}
              onOpenRunTarget={onOpenRunTarget}
              onOpenRunArtifact={onOpenRunArtifact}
            />
          ) : null}

          {section === "notifications" ? (
            <SettingsNotificationsSection
              notificationPreferences={notificationPreferences}
              notificationPermissionStatus={notificationPermissionStatus}
              notificationPermissionPending={notificationPermissionPending}
              onSetNotificationPreferences={onSetNotificationPreferences}
              onRequestNotificationPermission={onRequestNotificationPermission}
              onOpenSystemNotificationSettings={onOpenSystemNotificationSettings}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
