import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AppView, DesktopAppState, WorkspaceRecord } from "../../desktop-state";

export type SettingsSection = "appearance" | "general" | "providers" | "models" | "agents" | "notifications";

interface UseSettingsRoutingOptions {
  readonly api: typeof window.piApp;
  readonly activeView: AppView | undefined;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly onLeaveReviewSurface: () => void;
  readonly onLeaveDisplayModeSurface: () => void;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}

export function useSettingsRouting({
  api,
  activeView,
  rootWorkspaceOptions,
  onLeaveReviewSurface,
  onLeaveDisplayModeSurface,
  setSnapshot,
}: UseSettingsRoutingOptions) {
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsReturnView, setSettingsReturnView] = useState<AppView>("threads");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState("");
  const [skillsWorkspaceId, setSkillsWorkspaceId] = useState("");
  const [extensionsWorkspaceId, setExtensionsWorkspaceId] = useState("");

  const settingsWorkspace = settingsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === settingsWorkspaceId)
    : undefined;
  const skillsWorkspace = skillsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === skillsWorkspaceId)
    : undefined;
  const extensionsWorkspace = extensionsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === extensionsWorkspaceId)
    : undefined;

  const workspaceOptionIds = useMemo(
    () => new Set(rootWorkspaceOptions.map((workspace) => workspace.id)),
    [rootWorkspaceOptions],
  );

  const openSettings = useCallback((workspaceId?: string, section?: SettingsSection) => {
    if (!api) {
      return;
    }
    const nextWorkspaceId =
      workspaceId && workspaceOptionIds.has(workspaceId)
        ? workspaceId
        : settingsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSettingsWorkspaceId(nextWorkspaceId);
    }
    if (section) {
      setSettingsSection(section);
    }
    if (activeView && !isSecondarySurfaceView(activeView)) {
      setSettingsReturnView(activeView);
    }
    setSnapshot((current) => current ? { ...current, activeView: "settings", lastError: undefined } : current);
    void api.setActiveView("settings");
  }, [activeView, api, rootWorkspaceOptions, setSnapshot, settingsWorkspace?.id, workspaceOptionIds]);

  const openSkills = useCallback((workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && workspaceOptionIds.has(workspaceId)
        ? workspaceId
        : skillsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSkillsWorkspaceId(nextWorkspaceId);
    }
    if (!api) {
      return;
    }
    onLeaveReviewSurface();
    onLeaveDisplayModeSurface();
    setSnapshot((current) => current ? { ...current, activeView: "skills", lastError: undefined } : current);
    void api.setActiveView("skills");
  }, [api, onLeaveDisplayModeSurface, onLeaveReviewSurface, rootWorkspaceOptions, setSnapshot, skillsWorkspace?.id, workspaceOptionIds]);

  const openExtensions = useCallback((workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && workspaceOptionIds.has(workspaceId)
        ? workspaceId
        : extensionsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setExtensionsWorkspaceId(nextWorkspaceId);
    }
    if (!api) {
      return;
    }
    onLeaveReviewSurface();
    onLeaveDisplayModeSurface();
    setSnapshot((current) => current ? { ...current, activeView: "extensions", lastError: undefined } : current);
    void api.setActiveView("extensions");
  }, [api, extensionsWorkspace?.id, onLeaveDisplayModeSurface, onLeaveReviewSurface, rootWorkspaceOptions, setSnapshot, workspaceOptionIds]);

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setSettingsWorkspaceId("");
      setSkillsWorkspaceId("");
      setExtensionsWorkspaceId("");
      return;
    }
    setSettingsWorkspaceId((current) =>
      workspaceOptionIds.has(current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setSkillsWorkspaceId((current) =>
      workspaceOptionIds.has(current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setExtensionsWorkspaceId((current) =>
      workspaceOptionIds.has(current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
  }, [rootWorkspaceOptions, workspaceOptionIds]);

  return {
    extensionsWorkspace,
    extensionsWorkspaceId,
    openExtensions,
    openSettings,
    openSkills,
    setExtensionsWorkspaceId,
    setSettingsSection,
    setSettingsWorkspaceId,
    setSkillsWorkspaceId,
    settingsSection,
    settingsReturnView,
    settingsWorkspace,
    settingsWorkspaceId,
    skillsWorkspace,
    skillsWorkspaceId,
  };
}

function isSecondarySurfaceView(view: AppView): boolean {
  return view === "settings" || view === "skills" || view === "extensions" || view === "review";
}
