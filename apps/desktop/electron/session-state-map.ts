import type { RuntimeJobSnapshot, SessionConfig, SessionRef } from "@pi-gui/session-driver";
import { createEmptyExtensionUiState as createBaseExtensionUiState, type ExtensionUiState } from "@pi-gui/pi-sdk-driver";
import type { RuntimeCommandRecord } from "@pi-gui/session-driver/runtime-types";
import type {
  ComposerAttachment,
  QueuedComposerMessage,
  SessionExtensionDialogRecord,
  SessionExtensionUiStateRecord,
  TranscriptMessage,
} from "../src/desktop-state";
import type { RunMetrics } from "./app-store-timeline";

export interface MutableSessionExtensionUiState extends ExtensionUiState {
  pendingDialogs: SessionExtensionDialogRecord[];
}

export interface PendingAutoTitle {
  readonly requestToken: string;
  readonly cancel: () => void;
}

export interface QueuedComposerEditState {
  readonly messageId: string;
  readonly restoreDraft: string;
  readonly restoreAttachments: readonly ComposerAttachment[];
}

export const FULL_TRANSCRIPT_CACHE_MAX_ENTRIES = 6;
export const FULL_TRANSCRIPT_CACHE_MAX_BYTES = 96 * 1024 * 1024;

/**
 * Consolidates all per-session Maps (and one Set) that DesktopAppStore
 * maintains for runtime session state.  Having them in a single class
 * makes pruning and deletion consistent — every map is cleaned in one
 * place instead of manually repeating the list across call sites.
 */
export class SessionStateMap {
  readonly transcriptCache = new Map<string, TranscriptMessage[]>();
  readonly composerDraftsBySession = new Map<string, string>();
  readonly composerAttachmentsBySession = new Map<string, ComposerAttachment[]>();
  readonly queuedComposerMessagesBySession = new Map<string, QueuedComposerMessage[]>();
  readonly queuedComposerEditsBySession = new Map<string, QueuedComposerEditState>();
  readonly sessionConfigBySession = new Map<string, SessionConfig>();
  readonly lastViewedAtBySession = new Map<string, string>();
  readonly sessionErrorsBySession = new Map<string, string>();
  readonly sessionSubscriptions = new Map<string, () => void>();
  readonly sessionRefsByKey = new Map<string, SessionRef>();
  readonly activeAssistantMessageBySession = new Map<string, string>();
  readonly activeThinkingItemBySession = new Map<string, string>();
  readonly runningSinceBySession = new Map<string, string>();
  readonly runMetricsBySession = new Map<string, RunMetrics>();
  readonly activeWorkingActivityBySession = new Map<string, string>();
  readonly runtimeJobsBySession = new Map<string, RuntimeJobSnapshot[]>();
  readonly sessionCommandsBySession = new Map<string, RuntimeCommandRecord[]>();
  readonly extensionUiBySession = new Map<string, MutableSessionExtensionUiState>();
  readonly pendingAutoTitleBySession = new Map<string, PendingAutoTitle>();
  readonly loadedTranscriptKeys = new Set<string>();

  pruneTranscriptCache(
    protectedKeys: ReadonlySet<string>,
    maxEntries = FULL_TRANSCRIPT_CACHE_MAX_ENTRIES,
    maxBytes = FULL_TRANSCRIPT_CACHE_MAX_BYTES,
  ): readonly string[] {
    const sizes = new Map(
      [...this.transcriptCache].map(([key, transcript]) => [key, approximateStructuredBytes(transcript)] as const),
    );
    let totalBytes = [...sizes.values()].reduce((total, bytes) => total + bytes, 0);
    const evicted: string[] = [];

    for (const [key] of this.transcriptCache) {
      if (this.transcriptCache.size <= maxEntries && totalBytes <= maxBytes) {
        break;
      }
      if (protectedKeys.has(key)) {
        continue;
      }
      totalBytes -= sizes.get(key) ?? 0;
      this.transcriptCache.delete(key);
      this.loadedTranscriptKeys.delete(key);
      evicted.push(key);
    }

    return evicted;
  }

  /**
   * Remove entries for session keys that are no longer active.
   * Calls the unsubscribe callback for any stale subscription before deleting it.
   */
  prune(activeKeys: Set<string>): void {
    for (const [key, unsubscribe] of this.sessionSubscriptions) {
      if (!activeKeys.has(key)) {
        unsubscribe();
        this.deleteSession(key);
      }
    }
  }

  /** Remove all state for a single session key. */
  deleteSession(key: string): void {
    const pendingAutoTitle = this.pendingAutoTitleBySession.get(key);
    this.sessionSubscriptions.delete(key);
    this.sessionRefsByKey.delete(key);
    this.activeAssistantMessageBySession.delete(key);
    this.activeThinkingItemBySession.delete(key);
    this.runningSinceBySession.delete(key);
    this.runMetricsBySession.delete(key);
    this.activeWorkingActivityBySession.delete(key);
    this.runtimeJobsBySession.delete(key);
    this.composerDraftsBySession.delete(key);
    this.composerAttachmentsBySession.delete(key);
    this.queuedComposerMessagesBySession.delete(key);
    this.queuedComposerEditsBySession.delete(key);
    this.sessionConfigBySession.delete(key);
    this.lastViewedAtBySession.delete(key);
    this.sessionErrorsBySession.delete(key);
    this.sessionCommandsBySession.delete(key);
    this.extensionUiBySession.delete(key);
    this.pendingAutoTitleBySession.delete(key);
    pendingAutoTitle?.cancel();
    this.loadedTranscriptKeys.delete(key);
    this.transcriptCache.delete(key);
  }
}

function approximateStructuredBytes(value: unknown): number {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      totalBytes += Buffer.byteLength(current, "utf8");
    } else if (typeof current === "number" || typeof current === "bigint") {
      totalBytes += 8;
    } else if (typeof current === "boolean") {
      totalBytes += 4;
    } else if (current && typeof current === "object" && !seen.has(current)) {
      seen.add(current);
      if (Array.isArray(current)) {
        pending.push(...current);
      } else {
        for (const [key, nested] of Object.entries(current)) {
          totalBytes += Buffer.byteLength(key, "utf8");
          pending.push(nested);
        }
      }
    }
  }
  return totalBytes;
}

export function createEmptyExtensionUiState(): MutableSessionExtensionUiState {
  return {
    ...createBaseExtensionUiState(),
    pendingDialogs: [],
  };
}

export function serializeExtensionUiState(state: MutableSessionExtensionUiState): SessionExtensionUiStateRecord {
  return {
    statuses: [...state.statuses.entries()].map(([key, text]) => ({ key, text })),
    widgets: [...state.widgets.values()],
    pendingDialogs: [...state.pendingDialogs],
    ...(state.title ? { title: state.title } : {}),
    ...(state.editorText ? { editorText: state.editorText } : {}),
  };
}
