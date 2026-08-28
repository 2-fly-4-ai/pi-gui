import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ComposerAttachment, DesktopAppState, WorkspaceSessionTarget } from "../../desktop-state";
import type { PromptShelfEntrySummary, PromptShelfRestorePreview, StashPromptInput } from "../../prompt-shelf-types";

interface UsePromptShelfOptions {
  readonly api: NonNullable<typeof window.piApp> | undefined;
  readonly attachments: readonly ComposerAttachment[];
  readonly draft: string;
  readonly selectedTarget?: WorkspaceSessionTarget;
  readonly setComposerDraft: (value: string) => void;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}

export function usePromptShelf({ api, attachments, draft, selectedTarget, setComposerDraft, setSnapshot }: UsePromptShelfOptions) {
  const [entries, setEntries] = useState<readonly PromptShelfEntrySummary[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    if (!api) return [];
    const next = await api.listPromptShelf();
    setEntries(next);
    return next;
  }, [api]);

  useEffect(() => {
    let active = true;
    if (!api) return () => { active = false; };
    void api.listPromptShelf().then((next) => { if (active) setEntries(next); }).catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [api]);

  const stashPrompt = useCallback(async (
    input: StashPromptInput,
    clearAfterPersist: () => Promise<void> | void,
  ) => {
    if (!api || (!input.text.trim() && input.attachments.length === 0)) return false;
    setError(undefined);
    try {
      const next = await api.stashPrompt(input);
      // The durable main-owned write above must succeed before any composer field is cleared.
      await clearAfterPersist();
      setEntries(next);
      setNotice("Prompt stashed. Model, access, branch, and boundary settings were not captured.");
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }, [api]);

  const stashCurrentPrompt = useCallback(async () => {
    if (!api || !selectedTarget) return false;
    return stashPrompt({ text: draft, attachments, source: selectedTarget }, async () => {
      await api.updateComposerDraft(selectedTarget, "", { syncToEditor: true });
      await api.setSessionComposerAttachments(selectedTarget, []);
      setComposerDraft("");
      setSnapshot(await api.getState());
    });
  }, [api, attachments, draft, selectedTarget, setComposerDraft, setSnapshot, stashPrompt]);

  const previewRestore = useCallback(async (entryId: string) => {
    if (!api) throw new Error("Prompt Shelf is unavailable.");
    return api.previewPromptShelfRestore(entryId);
  }, [api]);

  const restorePrompt = useCallback(async (preview: PromptShelfRestorePreview, target: WorkspaceSessionTarget, mode: "copy" | "move") => {
    if (!api) return false;
    setError(undefined);
    try {
      await api.setSessionComposerAttachments(target, preview.attachments);
      await api.updateComposerDraft(target, preview.text, { syncToEditor: true });
      if (mode === "move") setEntries(await api.completePromptShelfRestore(preview.entry.id));
      setSnapshot(await api.getState());
      if (selectedTarget?.workspaceId === target.workspaceId && selectedTarget.sessionId === target.sessionId) setComposerDraft(preview.text);
      setNotice(`${mode === "move" ? "Moved" : "Copied"} prompt into the selected task.`);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }, [api, selectedTarget, setComposerDraft, setSnapshot]);

  const rename = useCallback(async (entryId: string, label: string) => {
    if (!api) return;
    try { setEntries(await api.renamePromptShelfEntry(entryId, label)); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [api]);
  const reorder = useCallback(async (orderedIds: readonly string[]) => {
    if (!api) return;
    try { setEntries(await api.reorderPromptShelf(orderedIds)); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [api]);
  const remove = useCallback(async (entryId: string) => {
    if (!api) return;
    try { setEntries(await api.deletePromptShelfEntry(entryId)); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [api]);

  return { entries, error, notice, previewRestore, refresh, remove, rename, reorder, restorePrompt, stashCurrentPrompt, stashPrompt };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
