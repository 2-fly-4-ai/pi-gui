import type { Dispatch, SetStateAction } from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  DesktopAppState,
  ExtensionCommandCompatibilityRecord,
  WorkspaceSessionTarget,
} from "../../desktop-state";
import type { DisplayModeViewProps } from "../../display-mode-view";
import type { PiDesktopApi } from "../../ipc";
import type { SettingsSection } from "../../settings-utils";
import type { FastModeSelection } from "../../fast-mode-selector";

interface CreateDisplayModePropsOptions {
  readonly api: PiDesktopApi;
  readonly commandCompatibilityByWorkspace: Readonly<Record<string, readonly ExtensionCommandCompatibilityRecord[]>>;
  readonly displayModeInitialPinnedThreadKey: string;
  readonly fastMode: FastModeSelection;
  readonly fastModeAvailable: boolean;
  readonly dmDrawerOpen: boolean;
  readonly handleSelectSession: (target: WorkspaceSessionTarget) => void;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly openSkillProfiles: (workspaceId?: string) => void;
  readonly openVsCodeForWorkspace: (workspaceId: string, folderPath: string) => void;
  readonly runtimeByWorkspace: Readonly<Record<string, RuntimeSnapshot>>;
  readonly sessionCommandsBySession: Readonly<Record<string, readonly RuntimeCommandRecord[]>>;
  readonly sessionExtensionUiBySession: DesktopAppState["sessionExtensionUiBySession"];
  readonly setSharedVsCodeWidth: (width: number) => void;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly setVsCodeSlotElement: Dispatch<SetStateAction<HTMLElement | null>>;
  readonly showThinking: boolean;
  readonly threadVsCodeWidth: number;
  readonly toggleDmDrawer: () => void;
  readonly toggleVsCode: () => void;
  readonly vsCodeFolderPath: string | null;
  readonly vsCodeOpen: boolean;
  readonly vsCodeWorkspaceId: string | null;
}

export function createDisplayModeProps({
  api,
  commandCompatibilityByWorkspace,
  displayModeInitialPinnedThreadKey,
  fastMode,
  fastModeAvailable,
  dmDrawerOpen,
  handleSelectSession,
  openSettings,
  openSkillProfiles,
  openVsCodeForWorkspace,
  runtimeByWorkspace,
  sessionCommandsBySession,
  sessionExtensionUiBySession,
  setSharedVsCodeWidth,
  setSnapshot,
  setVsCodeSlotElement,
  showThinking,
  threadVsCodeWidth,
  toggleDmDrawer,
  toggleVsCode,
  vsCodeFolderPath,
  vsCodeOpen,
  vsCodeWorkspaceId,
}: CreateDisplayModePropsOptions): DisplayModeViewProps {
  return {
    api,
    drawerOpen: dmDrawerOpen,
    onToggleDrawer: toggleDmDrawer,
    vsCodeOpen,
    vsCodeWorkspaceId,
    vsCodeFolderPath,
    vsCodeWidth: threadVsCodeWidth,
    onVsCodeWidthChange: setSharedVsCodeWidth,
    onToggleVsCode: toggleVsCode,
    onOpenVsCodeForWorkspace: openVsCodeForWorkspace,
    initialPinnedThreadKey: displayModeInitialPinnedThreadKey,
    fastMode,
    fastModeAvailable,
    showThinking,
    vscodeSlotRef: setVsCodeSlotElement,
    runtimeByWorkspace,
    sessionCommandsBySession,
    sessionExtensionUiBySession,
    commandCompatibilityByWorkspace,
    setSnapshot,
    openSettings,
    openSkillProfiles,
    onOpenThread: handleSelectSession,
  };
}
