import { useEffect, useMemo, useState } from "react";
import { extensionToLanguage } from "../syntax-highlight";
import { HighlightedReviewDiff } from "./HighlightedReviewDiff";
import { buildReviewPrompt } from "./review-prompt";
import { fileAnchorId, parseReviewDiff } from "./review-diff-parser";
import type { ReviewDraftComment, ReviewSnapshot } from "./review-types";
import {
  buildChangeReviewGroups,
  type ChangeReviewGroup,
} from "../product-experience/change-intelligence";
import type { TaskEvidenceRecord } from "../product-experience/task-evidence";
import { activeDecisions } from "../product-experience/project-knowledge";
import { loadReviewed, saveReviewed } from "../reviewed-files-store";
import type {
  CheckpointHunkPreview,
  RejectCheckpointHunksResult,
} from "../product-experience/hunk-restoration";
import {
  readReviewQuestions,
  remapReviewQuestion,
  saveReviewQuestion,
} from "./review-questions";
import {
  pruneOpenFileHistory,
  readOpenFileHistory,
  recordOpenedFile,
  type OpenFileHistoryEntry,
} from "../open-file-history";

interface ReviewSurfaceProps {
  readonly snapshot: ReviewSnapshot;
  readonly onCancel: () => void;
  readonly onSubmitPrompt: (prompt: string) => void;
  readonly onRefresh: () => void;
}

export function ReviewSurface({ snapshot, onCancel, onRefresh, onSubmitPrompt }: ReviewSurfaceProps) {
  const storageKey = reviewDraftStorageKey(snapshot);
  const [selectedPath, setSelectedPath] = useState(snapshot.files[0]?.path ?? "");
  const [selectedAnchorId, setSelectedAnchorId] = useState(snapshot.files[0] ? fileAnchorId(snapshot.files[0].path) : "");
  const [rangeEndAnchorId, setRangeEndAnchorId] = useState<string>();
  const [editingCommentId, setEditingCommentId] = useState<string | undefined>();
  const [commentDraft, setCommentDraft] = useState("");
  const [drafts, setDrafts] = useState<readonly ReviewDraftComment[]>(() => loadStoredDrafts(storageKey, snapshot));
  const [evidence, setEvidence] = useState<readonly TaskEvidenceRecord[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedTestId, setSelectedTestId] = useState<string>();
  const [questionNotice, setQuestionNotice] = useState<string>();
  const [hunkPreview, setHunkPreview] = useState<CheckpointHunkPreview>();
  const [hunkSelection, setHunkSelection] = useState<ReadonlySet<string>>(new Set());
  const [hunkError, setHunkError] = useState<string>();
  const [hunkResult, setHunkResult] = useState<RejectCheckpointHunksResult>();
  const [questionRevision, setQuestionRevision] = useState(0);
  const [recentFiles, setRecentFiles] = useState<readonly OpenFileHistoryEntry[]>([]);
  const groups = useMemo(
    () => buildChangeReviewGroups(snapshot.files, evidence),
    [evidence, snapshot.files],
  );
  const selectedGroup = groups.find((group) => group.id === selectedGroupId)
    ?? groups.find((group) => group.files.some(({ file }) => file.path === selectedPath))
    ?? groups[0];
  const selectedIntelligence = selectedGroup?.files.find(({ file }) => file.path === selectedPath);
  const selectedFile = snapshot.files.find((file) => file.path === selectedPath) ?? snapshot.files[0];
  const selectedFileDrafts = selectedFile ? drafts.filter((comment) => comment.filePath === selectedFile.path) : [];
  const parsed = useMemo(
    () => (selectedFile ? parseReviewDiff(selectedFile.path, selectedFile.diff) : { lines: [], anchors: [] }),
    [selectedFile],
  );
  const selectedRangeAnchorIds = useMemo(
    () => rangeAnchorIds(parsed.lines, selectedAnchorId, rangeEndAnchorId),
    [parsed.lines, rangeEndAnchorId, selectedAnchorId],
  );

  useEffect(() => {
    if (!selectedFile) return;
    setSelectedAnchorId(fileAnchorId(selectedFile.path));
    setRangeEndAnchorId(undefined);
    setEditingCommentId(undefined);
    setCommentDraft("");
  }, [selectedFile]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(drafts));
  }, [drafts, storageKey]);

  useEffect(() => {
    let active = true;
    void window.piApp?.getState().then(async (state) => {
      if (!active) return;
      const nextSessionId = state.selectedWorkspaceId === snapshot.workspaceId
        ? state.selectedSessionId ?? ""
        : "";
      setSessionId(nextSessionId);
      setReviewed(loadReviewed(snapshot.workspaceId, nextSessionId));
      const page = await window.piApp?.listTaskEvidence({
        workspaceId: snapshot.workspaceId,
        ...(nextSessionId ? { sessionId: nextSessionId } : {}),
        limit: 1_000,
      });
      if (active) setEvidence(page?.records ?? []);
    });
    return () => {
      active = false;
    };
  }, [snapshot.id, snapshot.workspaceId]);

  useEffect(() => {
    if (!selectedPath) return;
    recordOpenedFile({
      workspaceId: snapshot.workspaceId,
      path: selectedPath,
      source: "review",
    });
    setRecentFiles(readOpenFileHistory(snapshot.workspaceId).slice(0, 6));
  }, [selectedPath, snapshot.workspaceId]);

  useEffect(() => {
    void window.piApp?.listWorkspaceFiles(snapshot.workspaceId).then((paths) => {
      pruneOpenFileHistory(snapshot.workspaceId, new Set(paths));
      setRecentFiles(readOpenFileHistory(snapshot.workspaceId).slice(0, 6));
    });
  }, [snapshot.id, snapshot.workspaceId]);

  useEffect(() => {
    if (selectedGroup && !selectedGroup.files.some(({ file }) => file.path === selectedPath)) {
      const first = selectedGroup.files[0]?.file.path;
      if (first) setSelectedPath(first);
    }
  }, [selectedGroup, selectedPath]);

  useEffect(() => {
    setHunkPreview(undefined);
    setHunkSelection(new Set());
    setHunkError(undefined);
    setHunkResult(undefined);
    if (!selectedIntelligence?.checkpointId || selectedIntelligence.attribution !== "pi") return;
    let active = true;
    void window.piApp?.previewCheckpointHunks(
      selectedIntelligence.checkpointId,
      snapshot.workspaceId,
      selectedIntelligence.file.path,
    ).then((preview) => {
      if (active) setHunkPreview(preview);
    }).catch((cause: unknown) => {
      if (active) setHunkError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [selectedIntelligence?.attribution, selectedIntelligence?.checkpointId, selectedIntelligence?.file.path, snapshot.workspaceId]);

  const saveComment = () => {
    if (!selectedFile || !selectedAnchorId || !commentDraft.trim()) return;
    const now = new Date().toISOString();
    if (editingCommentId) {
      setDrafts((current) => current.map((comment) => comment.id === editingCommentId ? { ...comment, body: commentDraft.trim(), updatedAt: now } : comment));
      setEditingCommentId(undefined);
      setCommentDraft("");
      return;
    }

    setDrafts((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        anchorId: selectedAnchorId,
        filePath: selectedFile.path,
        body: commentDraft.trim(),
        createdAt: now,
        updatedAt: now,
        source: "user",
      },
    ]);
    setCommentDraft("");
  };

  const deleteComment = (id: string) => {
    setDrafts((current) => current.filter((comment) => comment.id !== id));
    if (editingCommentId === id) {
      setEditingCommentId(undefined);
      setCommentDraft("");
    }
  };

  const editComment = (comment: ReviewDraftComment) => {
    setSelectedAnchorId(comment.anchorId);
    setRangeEndAnchorId(undefined);
    setEditingCommentId(comment.id);
    setCommentDraft(comment.body);
  };

  const submit = () => {
    onSubmitPrompt(buildReviewPrompt(snapshot, drafts));
  };

  const toggleReviewed = (path: string) => {
    const next = new Set(reviewed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setReviewed(next);
    saveReviewed(snapshot.workspaceId, sessionId, next);
  };
  const moveGroup = (direction: -1 | 1) => {
    if (!selectedGroup || groups.length < 2) return;
    const currentIndex = groups.findIndex((group) => group.id === selectedGroup.id);
    const next = groups[(currentIndex + direction + groups.length) % groups.length];
    const firstPath = next?.files[0]?.file.path;
    if (!next || !firstPath) return;
    setSelectedGroupId(next.id);
    setSelectedPath(firstPath);
  };

  const askAboutSelection = () => {
    if (!selectedFile || !selectedAnchorId) return;
    const anchor = selectedFile.anchors.find((candidate) => candidate.id === selectedAnchorId);
    const rangeEndAnchor = rangeEndAnchorId
      ? selectedFile.anchors.find((candidate) => candidate.id === rangeEndAnchorId)
      : undefined;
    const location = anchor?.newLineNumber ?? anchor?.oldLineNumber;
    const rangeEndLocation = rangeEndAnchor?.newLineNumber ?? rangeEndAnchor?.oldLineNumber;
    const prompt = [
      "Answer a review question about this exact frozen change location.",
      `File: ${selectedFile.path}`,
      `Review snapshot: ${snapshot.id}`,
      `Revision frozen: ${snapshot.createdAt}`,
      location
        ? `Lines: ${location}${rangeEndLocation && rangeEndLocation !== location ? `–${rangeEndLocation}` : ""}`
        : "Scope: whole file",
      "Re-read the current file before answering and state if this mapping is stale.",
    ].join("\n");
    saveReviewQuestion({
      id: crypto.randomUUID(),
      workspaceId: snapshot.workspaceId,
      snapshotId: snapshot.id,
      filePath: selectedFile.path,
      anchorId: selectedAnchorId,
      ...(rangeEndAnchorId ? { rangeEndAnchorId } : {}),
      prompt,
      createdAt: new Date().toISOString(),
    });
    setQuestionRevision((value) => value + 1);
    setQuestionNotice("Question attached to this frozen review location. Opening it in the thread…");
    onSubmitPrompt(prompt);
  };

  return (
    <section className="review-mode" data-testid="review-surface">
      <header className="review-mode__header">
        <div>
          <div className="chat-header__eyebrow">Review</div>
          <h1>{snapshot.source.agent ? "Agent pre-review" : "Review changes"}</h1>
          <p>{snapshot.files.length} changed files · {formatReviewSource(snapshot)} · frozen {new Date(snapshot.createdAt).toLocaleTimeString()}</p>
          <p>
            {reviewed.size === snapshot.files.length && snapshot.files.length > 0
              ? "Review complete · all files accepted as reviewed"
              : `${reviewed.size} of ${snapshot.files.length} files reviewed`}
          </p>
        </div>
        <div className="review-mode__actions">
          <button className="button button--secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="button button--primary" type="button" disabled={drafts.length === 0} onClick={submit}>
            Submit {drafts.length} {drafts.length === 1 ? "comment" : "comments"}
          </button>
        </div>
      </header>

      {snapshot.files.length === 0 ? (
        <div className="empty-state"><h2>No changes found</h2><p>Create a working-tree change, then run /review again.</p></div>
      ) : (
        <div className="review-mode__layout">
          <aside className="review-mode__files">
            {recentFiles.length ? (
              <details className="review-mode__recent-files">
                <summary>Recent files</summary>
                {recentFiles.map((entry) => (
                  <button key={entry.path} type="button" onClick={() => {
                    if (snapshot.files.some((file) => file.path === entry.path)) setSelectedPath(entry.path);
                  }}>
                    <span>{entry.path}</span>
                    <small>{entry.source}</small>
                  </button>
                ))}
              </details>
            ) : null}
            {groups.map((group) => (
              <ReviewGroupNav
                drafts={drafts}
                group={group}
                key={group.id}
                reviewed={reviewed}
                selected={group.id === selectedGroup?.id}
                selectedTestId={selectedTestId}
                selectedPath={selectedFile?.path}
                onSelectFile={(path) => {
                  setSelectedGroupId(group.id);
                  setSelectedPath(path);
                }}
              />
            ))}
          </aside>

          {selectedFile ? (
            <main className="review-mode__diff">
              <div className="review-mode__file-header">
                <div>
                  <strong>{selectedFile.path}</strong>
                  {selectedGroup ? (
                    <small>
                      {selectedGroup.intent} · risk {selectedGroup.risk} · {selectedGroup.verification}
                    </small>
                  ) : null}
                </div>
                <button
                  aria-pressed={reviewed.has(selectedFile.path)}
                  className="button button--secondary"
                  type="button"
                  onClick={() => toggleReviewed(selectedFile.path)}
                >
                  {reviewed.has(selectedFile.path) ? "Reviewed ✓" : "Accept as reviewed"}
                </button>
                <button
                  aria-label="Previous change group"
                  className="button button--secondary"
                  disabled={groups.length < 2}
                  type="button"
                  onClick={() => moveGroup(-1)}
                >
                  Previous group
                </button>
                <button
                  aria-label="Next change group"
                  className="button button--secondary"
                  disabled={groups.length < 2}
                  type="button"
                  onClick={() => moveGroup(1)}
                >
                  Next group
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => {
                    setSelectedAnchorId(fileAnchorId(selectedFile.path));
                    setRangeEndAnchorId(undefined);
                  }}
                >
                  File comment
                </button>
              </div>
              <HighlightedReviewDiff
                language={extensionToLanguage(selectedFile.path)}
                lines={parsed.lines}
                selectedAnchorId={selectedAnchorId}
                selectedRangeAnchorIds={selectedRangeAnchorIds}
                onSelectAnchor={(anchorId, extendRange) => {
                  if (extendRange && selectedAnchorId.startsWith("line:")) {
                    setRangeEndAnchorId(anchorId);
                    return;
                  }
                  setSelectedAnchorId(anchorId);
                  setRangeEndAnchorId(undefined);
                }}
              />
              <div className="review-mode__location-actions">
                <button className="button button--secondary" type="button" onClick={askAboutSelection}>
                  Ask Pi about selected location
                </button>
                <span>Only file, frozen snapshot, and selected line metadata are attached.</span>
              </div>
              {questionNotice ? <p role="status">{questionNotice}</p> : null}
              <ReviewQuestions
                anchorId={selectedAnchorId}
                rangeEndAnchorId={rangeEndAnchorId}
                checkpointId={selectedIntelligence?.checkpointId}
                filePath={selectedFile.path}
                questionRevision={questionRevision}
                snapshot={snapshot}
                onRemap={(id) => {
                  remapReviewQuestion(snapshot.workspaceId, id, {
                    snapshotId: snapshot.id,
                    anchorId: selectedAnchorId,
                    ...(rangeEndAnchorId ? { rangeEndAnchorId } : {}),
                  });
                  setQuestionRevision((value) => value + 1);
                }}
              />
              {selectedGroup ? (
                <ReviewGroupEvidence
                  decisions={activeDecisions({ workspaceId: snapshot.workspaceId, ...(sessionId ? { sessionId } : {}) }).length}
                  group={selectedGroup}
                  selectedTestId={selectedTestId}
                  onSelectTest={setSelectedTestId}
                />
              ) : null}
              {hunkPreview ? (
                <HunkReviewControl
                  error={hunkError}
                  preview={hunkPreview}
                  result={hunkResult}
                  selected={hunkSelection}
                  onToggle={(id) => {
                    const next = new Set(hunkSelection);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    setHunkSelection(next);
                  }}
                  onReject={() => {
                    if (!hunkPreview.preview || hunkSelection.size === 0) return;
                    const summary = hunkPreview.preview.hunks
                      .filter((hunk) => hunkSelection.has(hunk.id))
                      .map((hunk) => `• restore ${hunk.beforeLines.length} line(s), remove ${hunk.afterLines.length} line(s)`)
                      .join("\n");
                    if (!window.confirm(`Reject ${hunkSelection.size} Pi-attributed hunk(s)?\n\n${summary}\n\nA rollback checkpoint will be created first.`)) return;
                    setHunkError(undefined);
                    void window.piApp?.rejectCheckpointHunks({
                      checkpointId: hunkPreview.checkpointId,
                      workspaceId: hunkPreview.workspaceId,
                      path: hunkPreview.path,
                      hunkIds: [...hunkSelection],
                    }).then((result) => {
                      setHunkResult(result);
                      onRefresh();
                    }).catch((cause: unknown) => {
                      setHunkError(cause instanceof Error ? cause.message : String(cause));
                    });
                  }}
                />
              ) : null}
              <section className="review-mode__composer">
                <label htmlFor="review-comment">Comment for selected {selectedAnchorId.startsWith("file:") ? "file" : "line"}</label>
                <textarea
                  id="review-comment"
                  aria-label="Review comment"
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                />
                <div className="review-mode__composer-actions">
                  {editingCommentId ? <button className="button button--secondary" type="button" onClick={() => { setEditingCommentId(undefined); setCommentDraft(""); }}>Cancel edit</button> : null}
                  <button className="button button--primary" type="button" disabled={!commentDraft.trim()} onClick={saveComment}>{editingCommentId ? "Update comment" : "Save comment"}</button>
                </div>
              </section>
              <section className="review-mode__comments">
                <h2>Comments</h2>
                {snapshot.source.agent && !snapshot.agentComments ? <p>Agent review is running. Comments will appear here when it returns structured feedback.</p> : null}
                {selectedFileDrafts.length === 0 ? <p>No comments for this file yet.</p> : null}
                {selectedFileDrafts.map((comment) => (
                  <article className="review-mode__comment" key={comment.id}>
                    <div className="review-mode__comment-header">
                      <span>{comment.source === "agent" ? "Agent" : "User"}</span>
                    </div>
                    <p>{comment.body}</p>
                    <div className="review-mode__comment-actions">
                      <button className="button button--secondary" type="button" onClick={() => editComment(comment)}>Edit</button>
                      <button className="button button--secondary" type="button" onClick={() => deleteComment(comment.id)}>Delete</button>
                    </div>
                  </article>
                ))}
              </section>
            </main>
          ) : null}
        </div>
      )}
    </section>
  );
}

function countFileComments(comments: readonly ReviewDraftComment[], filePath: string): number {
  return comments.reduce((count, comment) => count + (comment.filePath === filePath ? 1 : 0), 0);
}

function rangeAnchorIds(
  lines: readonly { readonly anchorId: string }[],
  startAnchorId: string,
  endAnchorId: string | undefined,
): ReadonlySet<string> {
  if (!endAnchorId) return new Set();
  const startIndex = lines.findIndex((line) => line.anchorId === startAnchorId);
  const endIndex = lines.findIndex((line) => line.anchorId === endAnchorId);
  if (startIndex < 0 || endIndex < 0) return new Set();
  const from = Math.min(startIndex, endIndex);
  const to = Math.max(startIndex, endIndex);
  return new Set(lines.slice(from, to + 1).map((line) => line.anchorId));
}

function reviewDraftStorageKey(snapshot: ReviewSnapshot): string {
  return ["review-drafts", snapshot.workspaceId, snapshot.source.kind, snapshot.source.base ?? "working-tree"].join(":");
}

function loadStoredDrafts(storageKey: string, snapshot: ReviewSnapshot): readonly ReviewDraftComment[] {
  const stored = readStoredDrafts(storageKey);
  return stored.length > 0 ? stored : snapshot.agentComments ?? [];
}

function readStoredDrafts(storageKey: string): readonly ReviewDraftComment[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isReviewDraftComment) : [];
  } catch {
    return [];
  }
}

function isReviewDraftComment(value: unknown): value is ReviewDraftComment {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ReviewDraftComment>;
  return typeof candidate.id === "string" &&
    typeof candidate.anchorId === "string" &&
    typeof candidate.filePath === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string";
}

function formatReviewSource(snapshot: ReviewSnapshot): string {
  return snapshot.source.kind === "base" ? `against ${snapshot.source.base}` : "working tree";
}

function ReviewGroupNav({
  group,
  drafts,
  reviewed,
  selected,
  selectedTestId,
  selectedPath,
  onSelectFile,
}: {
  readonly group: ChangeReviewGroup;
  readonly drafts: readonly ReviewDraftComment[];
  readonly reviewed: ReadonlySet<string>;
  readonly selected: boolean;
  readonly selectedTestId: string | undefined;
  readonly selectedPath: string | undefined;
  readonly onSelectFile: (path: string) => void;
}) {
  return (
    <section className={[
      "review-mode__group",
      selected ? "review-mode__group--selected" : "",
      selectedTestId && group.files.some((file) => file.relatedTests.some((test) => test.id === selectedTestId))
        ? "review-mode__group--test-related"
        : "",
    ].filter(Boolean).join(" ")}>
      <header>
        <strong>{group.intent}</strong>
        <span>{group.files.length} · {group.verification}</span>
      </header>
      {group.files.map(({ file, attribution }) => (
        <button
          className={`review-mode__file ${file.path === selectedPath ? "review-mode__file--selected" : ""}`}
          key={file.path}
          type="button"
          onClick={() => onSelectFile(file.path)}
        >
          <span>{reviewed.has(file.path) ? "✓ " : ""}{file.path}</span>
          <span>{attribution} · {countFileComments(drafts, file.path)}</span>
        </button>
      ))}
    </section>
  );
}

function ReviewGroupEvidence({
  decisions,
  group,
  selectedTestId,
  onSelectTest,
}: {
  readonly decisions: number;
  readonly group: ChangeReviewGroup;
  readonly selectedTestId: string | undefined;
  readonly onSelectTest: (id: string | undefined) => void;
}) {
  const files = group.files;
  const tests = [...new Map(files.flatMap((file) => file.relatedTests).map((test) => [test.id, test])).values()];
  return (
    <section className="review-mode__group-evidence" data-testid="review-group-evidence">
      <h2>Change group evidence</h2>
      <div>
        <span>{files.length} file(s)</span>
        <span>Risk · {group.risk}</span>
        <span>Verification · {group.verification}</span>
        <span>{decisions} related active workspace decision(s)</span>
      </div>
      {files.map((file) => (
        <article key={file.file.path}>
          <strong>{file.file.path} · {file.attribution}</strong>
          <span>{file.verificationReason}</span>
          <small>
            {file.runId ? `run ${file.runId}` : "run unknown"}
            {" · "}{file.toolCallId ? `tool ${file.toolCallId}` : "tool unknown"}
            {" · "}{file.checkpointId ? `checkpoint ${file.checkpointId}` : "checkpoint unavailable"}
            {" · "}{file.originatingUserRequestId ? `request ${file.originatingUserRequestId}` : "request unknown"}
            {" · "}{file.subagentRunId ? `subagent ${file.subagentRunId}` : "subagent none observed"}
          </small>
        </article>
      ))}
      {tests.length ? (
        <div className="review-mode__related-tests">
          <strong>Explicitly linked tests</strong>
          {tests.map((test) => (
            <button
              aria-pressed={selectedTestId === test.id}
              key={test.id}
              type="button"
              onClick={() => onSelectTest(selectedTestId === test.id ? undefined : test.id)}
            >
              {test.status ?? "unknown"} · {test.verification?.command ?? test.summary}
              <small>{test.verification?.relatedPaths?.join(", ") ?? "Coverage paths unknown"}</small>
            </button>
          ))}
        </div>
      ) : (
        <p>No explicitly linked tests. Passing unrelated tests are not treated as coverage.</p>
      )}
      {group.verification !== "verified" ? (
        <button
          className="button button--secondary"
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("pi-gui:preview-shell-snippet", {
            detail: "pnpm test",
          }))}
        >
          Preview suggested verification
        </button>
      ) : null}
    </section>
  );
}

function HunkReviewControl({
  preview,
  selected,
  error,
  result,
  onToggle,
  onReject,
}: {
  readonly preview: CheckpointHunkPreview;
  readonly selected: ReadonlySet<string>;
  readonly error: string | undefined;
  readonly result: RejectCheckpointHunksResult | undefined;
  readonly onToggle: (id: string) => void;
  readonly onReject: () => void;
}) {
  return (
    <section className="review-mode__hunk-control" data-testid="hunk-review-control">
      <h2>Pi-attributed hunk recovery</h2>
      <p>{preview.reason}</p>
      {!preview.available || !preview.preview ? (
        <div className="review-mode__hunk-unavailable">
          Reject is unavailable. Accept remains a review marker and never changes the filesystem.
        </div>
      ) : (
        <>
          {preview.preview.hunks.map((hunk, index) => (
            <article className={`review-mode__hunk review-mode__hunk--${hunk.status}`} key={hunk.id}>
              <label>
                <input
                  checked={selected.has(hunk.id)}
                  disabled={hunk.status !== "safe"}
                  type="checkbox"
                  onChange={() => onToggle(hunk.id)}
                />
                <strong>Hunk {index + 1} · {hunk.status}</strong>
              </label>
              <span>{hunk.reason}</span>
              <details>
                <summary>Preview resulting reversal</summary>
                <div>
                  <pre><code>{hunk.afterLines.join("") || "(no Pi-added lines)"}</code></pre>
                  <span aria-hidden="true">→</span>
                  <pre><code>{hunk.beforeLines.join("") || "(remove created lines)"}</code></pre>
                </div>
              </details>
            </article>
          ))}
          <button
            className="button button--secondary"
            disabled={selected.size === 0}
            type="button"
            onClick={onReject}
          >
            Preview confirmed · Reject {selected.size || ""} hunk{selected.size === 1 ? "" : "s"}
          </button>
        </>
      )}
      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {result ? (
        <p role="status">
          Rejected {result.rejectedHunkIds.length} hunk(s). Rollback checkpoint {result.rollbackCheckpointId} is available.
        </p>
      ) : null}
    </section>
  );
}

function ReviewQuestions({
  snapshot,
  filePath,
  anchorId,
  rangeEndAnchorId,
  checkpointId,
  questionRevision: _questionRevision,
  onRemap,
}: {
  readonly snapshot: ReviewSnapshot;
  readonly filePath: string;
  readonly anchorId: string;
  readonly rangeEndAnchorId: string | undefined;
  readonly checkpointId: string | undefined;
  readonly questionRevision: number;
  readonly onRemap: (id: string) => void;
}) {
  const questions = readReviewQuestions(snapshot.workspaceId).filter((question) => question.filePath === filePath);
  if (questions.length === 0) return null;
  return (
    <section className="review-mode__questions" data-testid="review-questions">
      <h2>Questions attached to this change</h2>
      {questions.map((question) => {
        const stale = question.snapshotId !== snapshot.id
          || !snapshot.files.some((file) => file.path === question.filePath
            && file.anchors.some((candidate) => candidate.id === question.anchorId)
            && (!question.rangeEndAnchorId || file.anchors.some((candidate) => candidate.id === question.rangeEndAnchorId)));
        return (
          <article key={question.id}>
            <strong>{stale ? "Stale line mapping" : "Current mapping"}</strong>
            <span>{question.prompt.split("\n")[0]}</span>
            <small>{question.filePath} · {question.anchorId} · snapshot {question.snapshotId}</small>
            {question.answer ? (
              <blockquote>{question.answer.text}</blockquote>
            ) : (
              <p>Waiting for an assistant answer to be attached from the timeline.</p>
            )}
            {stale ? (
              <div>
                <button type="button" onClick={() => onRemap(question.id)}>Refresh mapping to selected line</button>
                <button
                  type="button"
                  disabled={!checkpointId}
                  onClick={() => document.querySelector<HTMLElement>('[data-testid="hunk-review-control"]')?.scrollIntoView({ block: "start" })}
                >
                  {checkpointId ? "Open original checkpoint view" : "Original checkpoint unavailable"}
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
      <small>Current selected anchor: {anchorId}</small>
      {rangeEndAnchorId ? <small>Range end anchor: {rangeEndAnchorId}</small> : null}
    </section>
  );
}
