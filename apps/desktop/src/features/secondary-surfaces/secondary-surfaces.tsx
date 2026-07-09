import type { ComponentProps, ReactNode } from "react";
import type {
  RuntimeSkillMode,
  RuntimeSkillProfileRecord,
  RuntimeSkillRecord,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import type { AppView, ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "../../desktop-state";
import { ExtensionsView } from "../../extensions-view";
import { ReviewSurface } from "../../review/ReviewSurface";
import type { ReviewSnapshot } from "../../review/review-types";
import { SecondarySurface } from "../../secondary-surface";
import { SettingsView } from "../../settings-view";
import type { SettingsSection } from "../../settings-utils";
import { SkillsView } from "../../skills-view";
import type { SkillUsageByPath } from "../../skill-usage";

const SETTINGS_NAV = [
  { id: "appearance", label: "Appearance" },
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "agents", label: "Subagents" },
  { id: "notifications", label: "Notifications" },
] as const;

type SettingsViewProps = ComponentProps<typeof SettingsView>;

interface SettingsSecondarySurfaceProps {
  readonly commandPalette: ReactNode;
  readonly section: SettingsSection;
  readonly viewProps: Omit<SettingsViewProps, "headerAccessory" | "section">;
  readonly workspaceOptions: readonly WorkspaceRecord[];
  readonly onBack: () => void;
  readonly onSelectSection: (section: SettingsSection) => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
}

export function SettingsSecondarySurface({
  commandPalette,
  section,
  viewProps,
  workspaceOptions,
  onBack,
  onSelectSection,
  onSelectWorkspace,
}: SettingsSecondarySurfaceProps) {
  const showDiscoveryWorkspaceControl =
    section === "providers" ||
    section === "agents" ||
    (section === "models" && viewProps.modelSettingsScopeMode === "per-repo");

  return (
    <>
      {commandPalette}
      <SecondarySurface
        activeNavId={section}
        navItems={SETTINGS_NAV}
        onBack={onBack}
        onSelectNav={(nextSection) => onSelectSection(nextSection as SettingsSection)}
        testId="settings-surface"
        title="Settings"
      >
        <SettingsView
          {...viewProps}
          section={section}
          headerAccessory={showDiscoveryWorkspaceControl ? (
            <label className="surface-toolbar__field surface-toolbar__field--inline">
              <span>Discovery workspace</span>
              <select value={viewProps.workspace?.id ?? ""} onChange={(event) => onSelectWorkspace(event.target.value)}>
                {workspaceOptions.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined}
        />
      </SecondarySurface>
    </>
  );
}

interface ReviewSecondarySurfaceProps {
  readonly commandPalette: ReactNode;
  readonly loading: boolean;
  readonly snapshot?: ReviewSnapshot;
  readonly onBack: () => void;
  readonly onSubmitPrompt: (prompt: string) => void;
}

export function ReviewSecondarySurface({
  commandPalette,
  loading,
  snapshot,
  onBack,
  onSubmitPrompt,
}: ReviewSecondarySurfaceProps) {
  return (
    <>
      {commandPalette}
      <SecondarySurface onBack={onBack} testId="review-surface-shell" title="Review changes">
        {loading || !snapshot ? (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Review</div>
              <h1>Loading review...</h1>
              <p>Freezing the current working-tree diff.</p>
            </div>
          </section>
        ) : (
          <ReviewSurface snapshot={snapshot} onCancel={onBack} onSubmitPrompt={onSubmitPrompt} />
        )}
      </SecondarySurface>
    </>
  );
}

interface SkillsSecondarySurfaceProps {
  readonly commandPalette: ReactNode;
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly usageByPath: SkillUsageByPath;
  readonly workspaceOptions: readonly WorkspaceRecord[];
  readonly onBack: () => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onRefresh: () => void;
  readonly onOpenSkillFolder: (filePath: string) => void;
  readonly onSetSkillMode: (filePath: string, mode: RuntimeSkillMode) => void;
  readonly onSetActiveProfile: (profileId: string) => void;
  readonly onSaveProfile: (profile: RuntimeSkillProfileRecord) => void;
  readonly onDeleteProfile: (profileId: string) => void;
  readonly onTrySkill: (skill: RuntimeSkillRecord) => void;
}

export function SkillsSecondarySurface({
  commandPalette,
  workspace,
  runtime,
  usageByPath,
  workspaceOptions,
  onBack,
  onSelectWorkspace,
  onRefresh,
  onOpenSkillFolder,
  onSetSkillMode,
  onSetActiveProfile,
  onSaveProfile,
  onDeleteProfile,
  onTrySkill,
}: SkillsSecondarySurfaceProps) {
  return (
    <>
      {commandPalette}
      <SecondarySurface onBack={onBack} testId="skills-surface" title="Skills">
        <SkillsView
          workspace={workspace}
          runtime={runtime}
          usageByPath={usageByPath}
          discoveryWorkspaceControl={workspaceOptions.length > 1 ? (
            <label className="skills-discovery-select" title="Project-local skills are loaded from the selected workspace.">
              <span>Project skills</span>
              <select
                aria-label="Project-local skill workspace"
                value={workspace?.id ?? ""}
                onChange={(event) => onSelectWorkspace(event.target.value)}
              >
                {workspaceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined}
          onOpenSkillFolder={onOpenSkillFolder}
          onRefresh={onRefresh}
          onSetSkillMode={onSetSkillMode}
          onSetActiveProfile={onSetActiveProfile}
          onSaveProfile={onSaveProfile}
          onDeleteProfile={onDeleteProfile}
          onTrySkill={onTrySkill}
        />
      </SecondarySurface>
    </>
  );
}

interface ExtensionsSecondarySurfaceProps {
  readonly commandPalette: ReactNode;
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly workspaceOptions: readonly WorkspaceRecord[];
  readonly onBack: () => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
}

export function ExtensionsSecondarySurface({
  commandPalette,
  workspace,
  runtime,
  commandCompatibility,
  workspaceOptions,
  onBack,
  onSelectWorkspace,
  onRefresh,
  onOpenExtensionFolder,
  onToggleExtension,
}: ExtensionsSecondarySurfaceProps) {
  return (
    <>
      {commandPalette}
      <SecondarySurface onBack={onBack} testId="extensions-surface" title="Extensions">
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>Workspace</span>
            <select value={workspace?.id ?? ""} onChange={(event) => onSelectWorkspace(event.target.value)}>
              {workspaceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ExtensionsView
          workspace={workspace}
          runtime={runtime}
          commandCompatibility={commandCompatibility}
          onOpenExtensionFolder={onOpenExtensionFolder}
          onRefresh={onRefresh}
          onToggleExtension={onToggleExtension}
        />
      </SecondarySurface>
    </>
  );
}

export interface ActiveSecondarySurfaceProps {
  readonly activeView: AppView;
  readonly commandPalette: ReactNode;
  readonly settings: Omit<SettingsSecondarySurfaceProps, "commandPalette">;
  readonly review: Omit<ReviewSecondarySurfaceProps, "commandPalette">;
  readonly skills: Omit<SkillsSecondarySurfaceProps, "commandPalette">;
  readonly extensions: Omit<ExtensionsSecondarySurfaceProps, "commandPalette">;
}

export function ActiveSecondarySurface({
  activeView,
  commandPalette,
  settings,
  review,
  skills,
  extensions,
}: ActiveSecondarySurfaceProps) {
  if (activeView === "settings") {
    return <SettingsSecondarySurface commandPalette={commandPalette} {...settings} />;
  }

  if (activeView === "review") {
    return <ReviewSecondarySurface commandPalette={commandPalette} {...review} />;
  }

  if (activeView === "skills") {
    return <SkillsSecondarySurface commandPalette={commandPalette} {...skills} />;
  }

  if (activeView === "extensions") {
    return <ExtensionsSecondarySurface commandPalette={commandPalette} {...extensions} />;
  }

  return null;
}
