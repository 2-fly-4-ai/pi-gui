import type { ToolAccessSelection } from "@pi-gui/session-driver";
import { buildModelOptions } from "../../composer-commands";
import type { DesktopAppState, SessionRecord, WorkspaceRecord } from "../../desktop-state";
import { deriveModelOnboardingState } from "../../model-onboarding";
import { getEffectiveModelRuntime } from "../../model-settings";
import { normalizeToolAccess } from "../../tool-access";

interface UseRuntimeSelectionsOptions {
  readonly snapshot: DesktopAppState | null;
  readonly selectedWorkspace?: WorkspaceRecord;
  readonly selectedSession?: SessionRecord;
  readonly settingsWorkspace?: WorkspaceRecord;
  readonly skillsWorkspace?: WorkspaceRecord;
  readonly extensionsWorkspace?: WorkspaceRecord;
  readonly newThreadWorkspace?: WorkspaceRecord;
  readonly newThreadProvider?: string;
  readonly newThreadModelId?: string;
  readonly newThreadThinkingLevel?: string;
  readonly newThreadToolAccess: ToolAccessSelection;
}

export function useRuntimeSelections({
  snapshot,
  selectedWorkspace,
  selectedSession,
  settingsWorkspace,
  skillsWorkspace,
  extensionsWorkspace,
  newThreadWorkspace,
  newThreadProvider,
  newThreadModelId,
  newThreadThinkingLevel,
  newThreadToolAccess,
}: UseRuntimeSelectionsOptions) {
  const selectedRuntime = selectedWorkspace ? snapshot?.runtimeByWorkspace[selectedWorkspace.id] : undefined;
  const selectedModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, selectedWorkspace) : undefined;
  const settingsRuntime = settingsWorkspace ? snapshot?.runtimeByWorkspace[settingsWorkspace.id] : undefined;
  const settingsModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, settingsWorkspace) : undefined;
  const skillsRuntime = skillsWorkspace ? snapshot?.runtimeByWorkspace[skillsWorkspace.id] : undefined;
  const extensionsRuntime = extensionsWorkspace ? snapshot?.runtimeByWorkspace[extensionsWorkspace.id] : undefined;
  const extensionsCommandCompatibility = extensionsWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[extensionsWorkspace.id] ?? []
    : [];
  const newThreadRuntime = snapshot ? getEffectiveModelRuntime(snapshot, newThreadWorkspace) : undefined;

  const newThreadDefaultEnabled = buildModelOptions(newThreadRuntime).some(
    (model) => model.providerId === newThreadRuntime?.settings.defaultProvider && model.modelId === newThreadRuntime?.settings.defaultModelId,
  );
  const selectedDefaultEnabled = buildModelOptions(selectedModelRuntime).some(
    (model) => model.providerId === selectedModelRuntime?.settings.defaultProvider && model.modelId === selectedModelRuntime?.settings.defaultModelId,
  );

  const resolvedSessionProvider =
    selectedSession?.config?.provider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    selectedSession?.config?.modelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    selectedSession?.config?.thinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const resolvedNewThreadProvider =
    newThreadProvider ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultProvider : undefined);
  const resolvedNewThreadModelId =
    newThreadModelId ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultModelId : undefined);
  const resolvedNewThreadThinkingLevel = newThreadThinkingLevel ?? newThreadRuntime?.settings.defaultThinkingLevel;
  const resolvedNewThreadToolAccess = normalizeToolAccess(newThreadToolAccess);
  const resolvedSessionToolAccess = normalizeToolAccess(selectedSession?.config?.toolAccess);

  return {
    extensionsCommandCompatibility,
    extensionsRuntime,
    newThreadModelOnboarding: deriveModelOnboardingState(newThreadRuntime, {
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
    }),
    newThreadRuntime,
    resolvedNewThreadModelId,
    resolvedNewThreadProvider,
    resolvedNewThreadThinkingLevel,
    resolvedNewThreadToolAccess,
    resolvedSessionModelId,
    resolvedSessionProvider,
    resolvedSessionThinkingLevel,
    resolvedSessionToolAccess,
    selectedModelRuntime,
    selectedRuntime,
    selectedSessionModelOnboarding: deriveModelOnboardingState(selectedModelRuntime, {
      provider: resolvedSessionProvider,
      modelId: resolvedSessionModelId,
    }),
    settingsModelRuntime,
    settingsRuntime,
    skillsRuntime,
  };
}
