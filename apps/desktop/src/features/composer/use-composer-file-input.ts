import { useCallback, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import { appendComposerAttachments, type ComposerImageAttachment, type DesktopAppState } from "../../desktop-state";
import {
  extractFilesFromDataTransfer,
  extractImageFilesFromClipboardData,
} from "../../composer-attachments";

interface UseComposerFileInputOptions {
  readonly api: typeof window.piApp;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly newThreadComposerRef: RefObject<HTMLTextAreaElement | null>;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly addAttachmentsToSessionComposer: (files: File[]) => Promise<void>;
  readonly addNewThreadClipboardImage: (attachment: ComposerImageAttachment) => void;
  readonly handleNewThreadAddAttachments: (files: File[]) => void;
}

export function useComposerFileInput({
  api,
  composerRef,
  newThreadComposerRef,
  setSnapshot,
  addAttachmentsToSessionComposer,
  addNewThreadClipboardImage,
  handleNewThreadAddAttachments,
}: UseComposerFileInputOptions) {
  const handleImagePaste = useCallback((event: ClipboardEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    onFiles(files);
  }, []);

  const handleAttachmentDrop = useCallback((event: DragEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    event.preventDefault();
    const files = extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    onFiles(files);
  }, []);

  const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, (files) => {
      void addAttachmentsToSessionComposer(files);
    });
  }, [addAttachmentsToSessionComposer, handleImagePaste]);

  const handleNewThreadComposerPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, handleNewThreadAddAttachments);
  }, [handleImagePaste, handleNewThreadAddAttachments]);

  const handleComposerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, (files) => {
      void addAttachmentsToSessionComposer(files);
    });
  }, [addAttachmentsToSessionComposer, handleAttachmentDrop]);

  const handleNewThreadComposerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, handleNewThreadAddAttachments);
  }, [handleAttachmentDrop, handleNewThreadAddAttachments]);

  const handlePastedClipboardImage = useCallback((clipboardImage: ComposerImageAttachment) => {
    const activeElement = document.activeElement;
    if (activeElement === composerRef.current) {
      if (!api) {
        return;
      }
      setSnapshot((current) => current ? appendComposerAttachments(current, [clipboardImage]) : current);
      void api.addComposerAttachments([clipboardImage]);
      return;
    }

    if (activeElement === newThreadComposerRef.current) {
      addNewThreadClipboardImage(clipboardImage);
    }
  }, [addNewThreadClipboardImage, api, composerRef, newThreadComposerRef, setSnapshot]);

  const handleClipboardImageShortcut = useCallback((
    event: KeyboardEvent<HTMLTextAreaElement>,
    onImage: (attachment: ComposerImageAttachment) => void,
  ): boolean => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "v") {
      return false;
    }

    if (!api) {
      return false;
    }

    event.preventDefault();
    void api.readClipboardImage().then((clipboardImage) => {
      if (clipboardImage) {
        onImage(clipboardImage);
      }
    });
    return true;
  }, [api]);

  return {
    handleClipboardImageShortcut,
    handleComposerDrop,
    handleComposerPaste,
    handleNewThreadComposerDrop,
    handleNewThreadComposerPaste,
    handlePastedClipboardImage,
  };
}
