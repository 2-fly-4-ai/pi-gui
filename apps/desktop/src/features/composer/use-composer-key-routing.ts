import { type KeyboardEvent } from "react";
import type { ComposerAttachment, ComposerImageAttachment } from "../../desktop-state";

interface ComposerMentionKeyHandler {
  readonly handleMentionKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

interface ComposerSlashKeyHandler {
  readonly handleSlashKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

interface UseSessionComposerKeyRoutingOptions {
  readonly attachments: readonly ComposerAttachment[];
  readonly draft: string;
  readonly handleClipboardImageShortcut: (
    event: KeyboardEvent<HTMLTextAreaElement>,
    onClipboardImage: (clipboardImage: ComposerImageAttachment) => void,
  ) => boolean;
  readonly mentionMenu: ComposerMentionKeyHandler;
  readonly modelSelectionRequired: boolean;
  readonly onAddClipboardImage: (clipboardImage: ComposerImageAttachment) => void;
  readonly sessionStatus: "idle" | "running" | "failed" | undefined;
  readonly slashMenu: ComposerSlashKeyHandler;
  readonly submitDraft: (options?: { readonly deliverAs?: "steer" | "followUp" }) => void;
}

interface UseNewThreadComposerKeyRoutingOptions {
  readonly attachments: readonly ComposerAttachment[];
  readonly draft: string;
  readonly handleClipboardImageShortcut: (
    event: KeyboardEvent<HTMLTextAreaElement>,
    onClipboardImage: (clipboardImage: ComposerImageAttachment) => void,
  ) => boolean;
  readonly mentionMenu: ComposerMentionKeyHandler;
  readonly modelSelectionRequired: boolean;
  readonly onAddClipboardImage: (clipboardImage: ComposerImageAttachment) => void;
  readonly onStartThread: () => void;
  readonly slashMenu: ComposerSlashKeyHandler;
}

export function createSessionComposerKeyHandler({
  attachments,
  draft,
  handleClipboardImageShortcut,
  mentionMenu,
  modelSelectionRequired,
  onAddClipboardImage,
  sessionStatus,
  slashMenu,
  submitDraft,
}: UseSessionComposerKeyRoutingOptions): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
  return (event) => {
    if (handleClipboardImageShortcut(event, onAddClipboardImage)) {
      return;
    }

    if (mentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (slashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && sessionStatus === "running") {
      event.preventDefault();
      submitDraft({ deliverAs: "steer" });
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!draft.trim() && attachments.length === 0) {
      return;
    }
    if (modelSelectionRequired) {
      return;
    }

    submitDraft();
  };
}

export function createNewThreadComposerKeyHandler({
  attachments,
  draft,
  handleClipboardImageShortcut,
  mentionMenu,
  modelSelectionRequired,
  onAddClipboardImage,
  onStartThread,
  slashMenu,
}: UseNewThreadComposerKeyRoutingOptions): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
  return (event) => {
    if (handleClipboardImageShortcut(event, onAddClipboardImage)) {
      return;
    }

    if (mentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (slashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!draft.trim() && attachments.length === 0) {
      return;
    }
    if (modelSelectionRequired) {
      return;
    }

    onStartThread();
  };
}
