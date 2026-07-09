import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ComposerImageAttachment } from "../../desktop-state";
import { desktopCommands, getDesktopCommandFromShortcut, getDesktopShortcutLabel, type PiDesktopCommand } from "../../ipc";
import type { CommandPaletteAction } from "../../command-palette-model";

interface ThreadSearchControls {
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
}

interface UseCommandPaletteOptions {
  readonly api: typeof window.piApp;
  readonly selectedRootWorkspaceId: string | undefined;
  readonly hasSelectedSession: boolean;
  readonly hasSelectedWorkspace: boolean;
  readonly threadSearch: ThreadSearchControls;
  readonly handlePastedClipboardImage: (clipboardImage: ComposerImageAttachment) => void;
  readonly handleTogglePrimarySidebar: () => boolean;
  readonly openExtensions: (workspaceId?: string) => void;
  readonly openNewThreadSurface: (workspaceId?: string) => void;
  readonly openSettings: (workspaceId?: string) => void;
  readonly openSkills: (workspaceId?: string) => void;
  readonly resetNewThreadSurface: (workspaceId?: string) => void;
  readonly setPendingNewThreadWorkspaceId: Dispatch<SetStateAction<string>>;
  readonly toggleDiffPanel: () => void;
  readonly toggleTerminal: () => void;
}

function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("[data-pi-terminal]"));
}

export function useCommandPalette({
  api,
  selectedRootWorkspaceId,
  hasSelectedSession,
  hasSelectedWorkspace,
  threadSearch,
  handlePastedClipboardImage,
  handleTogglePrimarySidebar,
  openExtensions,
  openNewThreadSurface,
  openSettings,
  openSkills,
  resetNewThreadSurface,
  setPendingNewThreadWorkspaceId,
  toggleDiffPanel,
  toggleTerminal,
}: UseCommandPaletteOptions) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "B") : "";
  const commandPaletteActions = useMemo<readonly CommandPaletteAction[]>(
    () => [
      {
        id: "new-thread",
        title: "New thread",
        subtitle: "Start a new pi session",
        keywords: ["chat", "session", "thread"],
        run: () => openNewThreadSurface(selectedRootWorkspaceId),
      },
      {
        id: "toggle-terminal",
        title: "Toggle terminal",
        subtitle: "Show or hide the integrated terminal",
        keywords: ["terminal", "shell", "command line"],
        disabled: !hasSelectedSession,
        run: toggleTerminal,
      },
      {
        id: "toggle-changes",
        title: "Toggle changes",
        subtitle: "Show or hide the workspace diff panel",
        keywords: ["diff", "changes", "files"],
        disabled: !hasSelectedWorkspace,
        run: toggleDiffPanel,
      },
      {
        id: "settings",
        title: "Settings",
        subtitle: "Configure pi and model providers",
        keywords: ["preferences", "configuration", "model"],
        run: () => openSettings(selectedRootWorkspaceId),
      },
      {
        id: "skills",
        title: "Skills",
        subtitle: "Manage available pi skills",
        keywords: ["skills", "slash commands", "capabilities"],
        run: () => openSkills(selectedRootWorkspaceId),
      },
      {
        id: "extensions",
        title: "Extensions",
        subtitle: "Manage pi extensions",
        keywords: ["extensions", "plugins", "integrations"],
        run: () => openExtensions(selectedRootWorkspaceId),
      },
    ],
    [
      hasSelectedSession,
      hasSelectedWorkspace,
      openExtensions,
      openNewThreadSurface,
      openSettings,
      openSkills,
      selectedRootWorkspaceId,
      toggleDiffPanel,
      toggleTerminal,
    ],
  );

  useEffect(() => {
    const handleCommand = (command: PiDesktopCommand): boolean => {
      if (command === desktopCommands.openCommandPalette) {
        setCommandPaletteOpen(true);
        return true;
      } else if (command === desktopCommands.openSettings) {
        openSettings(selectedRootWorkspaceId);
        return true;
      } else if (command === desktopCommands.openNewThread) {
        openNewThreadSurface(selectedRootWorkspaceId);
        return true;
      } else if (command === desktopCommands.toggleTerminal) {
        toggleTerminal();
        return true;
      } else if (command === desktopCommands.toggleSidebar) {
        return handleTogglePrimarySidebar();
      }
      return false;
    };

    const removeCommandListener = window.piApp?.onCommand?.(handleCommand);
    const removeWorkspacePickedListener = window.piApp?.onWorkspacePicked?.((workspaceId) => {
      setPendingNewThreadWorkspaceId(workspaceId);
      resetNewThreadSurface();
    });
    const removeClipboardImageListener = window.piApp?.onClipboardImagePasted?.(handlePastedClipboardImage);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEventInsideTerminal(event)) {
        const command = getDesktopCommandFromShortcut({
          modifier: event.metaKey || event.ctrlKey,
          shift: event.shiftKey,
          key: event.key,
          code: event.code,
        });
        if (command === desktopCommands.toggleTerminal || command === desktopCommands.openCommandPalette) {
          event.preventDefault();
          handleCommand(command);
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        if (threadSearch.isOpen) {
          threadSearch.close();
        } else {
          threadSearch.open();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !event.shiftKey) {
        event.preventDefault();
        toggleDiffPanel();
        return;
      }
      const command = getDesktopCommandFromShortcut({
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        key: event.key,
        code: event.code,
      });
      if (command && handleCommand(command)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      removeCommandListener?.();
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    api,
    handlePastedClipboardImage,
    handleTogglePrimarySidebar,
    openNewThreadSurface,
    openSettings,
    resetNewThreadSurface,
    selectedRootWorkspaceId,
    setPendingNewThreadWorkspaceId,
    threadSearch,
    toggleDiffPanel,
    toggleTerminal,
  ]);

  return {
    commandPaletteActions,
    commandPaletteOpen,
    setCommandPaletteOpen,
    sidebarToggleShortcutLabel,
  };
}
