import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { RuntimeSkillProfileRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { DesktopAppState, WorkspaceRecord } from "../../desktop-state";
import type { DesktopNotificationPermissionStatus } from "../../ipc";
import type { SettingsSection } from "./use-settings-routing";

interface UseSettingsActionsOptions {
  readonly activeView: DesktopAppState["activeView"] | undefined;
  readonly api: typeof window.piApp;
  readonly extensionsWorkspace: WorkspaceRecord | undefined;
  readonly openSkills: (workspaceId?: string) => void;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly settingsSection: SettingsSection;
  readonly settingsWorkspace: WorkspaceRecord | undefined;
  readonly skillsWorkspace: WorkspaceRecord | undefined;
}

export function useSettingsActions({
  activeView,
  api,
  extensionsWorkspace,
  openSkills,
  setSnapshot,
  settingsSection,
  settingsWorkspace,
  skillsWorkspace,
}: UseSettingsActionsOptions) {
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">("system");
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<DesktopNotificationPermissionStatus>("unknown");
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi.getResolvedTheme().then((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    void piApi.getThemeMode().then((mode) => {
      setThemeMode(mode);
    });

    const unsub = piApi.onThemeChanged((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    return unsub;
  }, []);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onNotificationPermissionStatusChanged) {
      return;
    }

    return piApi.onNotificationPermissionStatusChanged((status) => {
      setNotificationPermissionStatus(status);
    });
  }, []);

  const refreshNotificationPermissionStatus = useCallback(() => {
    if (!api?.getNotificationPermissionStatus) {
      return Promise.resolve("unknown" as DesktopNotificationPermissionStatus);
    }

    return api.getNotificationPermissionStatus().then((status) => {
      setNotificationPermissionStatus(status);
      return status;
    });
  }, [api]);

  useEffect(() => {
    if (activeView !== "settings" || settingsSection !== "notifications") {
      return undefined;
    }

    void refreshNotificationPermissionStatus();
    return undefined;
  }, [activeView, refreshNotificationPermissionStatus, settingsSection]);

  const handleSetDefaultModel = (provider: string, modelId: string) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    void api.setDefaultModel(settingsWorkspace.id, provider, modelId);
  };

  const handleSetThinkingLevel = (thinkingLevel: RuntimeSnapshot["settings"]["defaultThinkingLevel"]) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    void api.setDefaultThinkingLevel(settingsWorkspace.id, thinkingLevel);
  };

  const handleToggleSkillCommands = (enabled: boolean) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    void api.setEnableSkillCommands(settingsWorkspace.id, enabled);
  };

  const handleSetScopedModelPatterns = (patterns: readonly string[]) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    void api.setScopedModelPatterns(settingsWorkspace.id, patterns);
  };

  const handleSetModelSettingsScopeMode = (mode: "app-global" | "per-repo") => {
    if (!api) {
      return;
    }
    setSnapshot((current) => current ? { ...current, modelSettingsScopeMode: mode, lastError: undefined } : current);
    void api.setModelSettingsScopeMode(mode);
  };

  const handleLoginProvider = (providerId: string) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    void api.loginProvider(settingsWorkspace.id, providerId).then(() => refreshSnapshot(api, setSnapshot));
  };

  const handleLogoutProvider = (providerId: string) => {
    if (!api || !settingsWorkspace) {
      return;
    }
    void api.logoutProvider(settingsWorkspace.id, providerId).then(() => refreshSnapshot(api, setSnapshot));
  };

  const handleSetProviderApiKey = async (providerId: string, apiKey: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    await api.setProviderApiKey(settingsWorkspace.id, providerId, apiKey);
    const state = await refreshSnapshot(api, setSnapshot);
    return state.lastError;
  };

  const handleRemoveProviderApiKey = async (providerId: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    await api.logoutProvider(settingsWorkspace.id, providerId);
    const state = await refreshSnapshot(api, setSnapshot);
    return state.lastError;
  };

  const handleSetSkillMode = (filePath: string, mode: "auto" | "manual" | "off") => {
    if (!api || !skillsWorkspace) {
      return;
    }
    void api.setSkillMode(skillsWorkspace.id, filePath, mode);
  };

  const handleSetActiveSkillProfile = (workspaceId: string | undefined, profileId: string) => {
    if (!api || !workspaceId) {
      return;
    }
    void api.setActiveSkillProfile(workspaceId, profileId);
  };

  const handleSaveSkillProfile = (workspaceId: string | undefined, profile: RuntimeSkillProfileRecord) => {
    if (!api || !workspaceId) {
      return;
    }
    void api.saveSkillProfile(workspaceId, profile);
  };

  const handleDeleteSkillProfile = (workspaceId: string | undefined, profileId: string) => {
    if (!api || !workspaceId) {
      return;
    }
    void api.deleteSkillProfile(workspaceId, profileId);
  };

  const openSkillProfiles = (workspaceId?: string) => {
    openSkills(workspaceId);
  };

  const handleOpenSkillFolder = (filePath: string) => {
    if (!api || !skillsWorkspace) {
      return;
    }
    void api.openSkillInFinder(skillsWorkspace.id, filePath);
  };

  const handleToggleExtension = (filePath: string, enabled: boolean) => {
    if (!api || !extensionsWorkspace) {
      return;
    }
    void api.setExtensionEnabled(extensionsWorkspace.id, filePath, enabled);
  };

  const handleOpenExtensionFolder = (filePath: string) => {
    if (!api || !extensionsWorkspace) {
      return;
    }
    void api.openExtensionInFinder(extensionsWorkspace.id, filePath);
  };

  const handleSetThemeMode = (mode: "system" | "light" | "dark") => {
    if (!api) return;
    setThemeMode(mode);
    void api.setThemeMode(mode);
  };

  const handleSetNotificationPreferences = (preferences: Partial<DesktopAppState["notificationPreferences"]>) => {
    if (!api) {
      return;
    }
    setSnapshot((current) =>
      current
        ? {
            ...current,
            notificationPreferences: {
              ...current.notificationPreferences,
              ...preferences,
            },
          }
        : current,
    );
    void api.setNotificationPreferences(preferences);
  };

  const handleSetDiagnosticReportingPreferences = (preferences: Partial<DesktopAppState["diagnosticReporting"]>) => {
    if (!api) {
      return;
    }
    setSnapshot((current) =>
      current
        ? {
            ...current,
            diagnosticReporting: {
              ...current.diagnosticReporting,
              ...preferences,
            },
          }
        : current,
    );
    void api.setDiagnosticReportingPreferences(preferences);
  };

  const handleSetIntegratedTerminalShell = (shellPath: string) => {
    if (!api) {
      return;
    }
    setSnapshot((current) => current ? { ...current, integratedTerminalShell: shellPath } : current);
    void api.setIntegratedTerminalShell(shellPath);
  };

  const handleSetDesktopCustomInstructions = (input: Partial<DesktopAppState["desktopCustomInstructions"]>) => {
    if (!api) {
      return;
    }
    setSnapshot((current) =>
      current
        ? {
            ...current,
            desktopCustomInstructions: {
              ...current.desktopCustomInstructions,
              ...input,
            },
          }
        : current,
    );
    void api.setDesktopCustomInstructions(input);
  };

  const handleRequestNotificationPermission = () => {
    if (!api?.requestNotificationPermission) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .requestNotificationPermission()
      .then((status) => {
        setNotificationPermissionStatus(status);
      })
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleOpenSystemNotificationSettings = () => {
    if (!api?.openSystemNotificationSettings) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .openSystemNotificationSettings()
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  return {
    handleDeleteSkillProfile,
    handleLoginProvider,
    handleLogoutProvider,
    handleOpenExtensionFolder,
    handleOpenSkillFolder,
    handleOpenSystemNotificationSettings,
    handleRemoveProviderApiKey,
    handleRequestNotificationPermission,
    handleSaveSkillProfile,
    handleSetActiveSkillProfile,
    handleSetDefaultModel,
    handleSetDesktopCustomInstructions,
    handleSetDiagnosticReportingPreferences,
    handleSetIntegratedTerminalShell,
    handleSetModelSettingsScopeMode,
    handleSetNotificationPreferences,
    handleSetProviderApiKey,
    handleSetScopedModelPatterns,
    handleSetSkillMode,
    handleSetThemeMode,
    handleSetThinkingLevel,
    handleToggleExtension,
    handleToggleSkillCommands,
    notificationPermissionPending,
    notificationPermissionStatus,
    openSkillProfiles,
    themeMode,
  };
}

async function refreshSnapshot(
  api: NonNullable<typeof window.piApp>,
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
): Promise<DesktopAppState> {
  const state = await api.getState();
  setSnapshot(state);
  return state;
}
