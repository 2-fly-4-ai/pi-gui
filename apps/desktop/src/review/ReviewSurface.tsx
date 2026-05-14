import { useEffect, useMemo, useState } from "react";
import { extensionToLanguage } from "../syntax-highlight";
import { HighlightedReviewDiff } from "./HighlightedReviewDiff";
import { buildReviewPrompt } from "./review-prompt";
import { fileAnchorId, parseReviewDiff } from "./review-diff-parser";
import type { ReviewDraftComment, ReviewSnapshot } from "./review-types";

interface ReviewSurfaceProps {
  readonly snapshot: ReviewSnapshot;
  readonly onCancel: () => void;
  readonly onSubmitPrompt: (prompt: string) => void;
}

export function ReviewSurface({ snapshot, onCancel, onSubmitPrompt }: ReviewSurfaceProps) {
  const storageKey = reviewDraftStorageKey(snapshot);
  const [selectedPath, setSelectedPath] = useState(snapshot.files[0]?.path ?? "");
  const [selectedAnchorId, setSelectedAnchorId] = useState(snapshot.files[0] ? fileAnchorId(snapshot.files[0].path) : "");
  const [editingCommentId, setEditingCommentId] = useState<string | undefined>();
  const [commentDraft, setCommentDraft] = useState("");
  const [drafts, setDrafts] = useState<readonly ReviewDraftComment[]>(() => loadStoredDrafts(storageKey, snapshot));
  const selectedFile = snapshot.files.find((file) => file.path === selectedPath) ?? snapshot.files[0];
  const selectedFileDrafts = selectedFile ? drafts.filter((comment) => comment.filePath === selectedFile.path) : [];
  const parsed = useMemo(
    () => (selectedFile ? parseReviewDiff(selectedFile.path, selectedFile.diff) : { lines: [], anchors: [] }),
    [selectedFile],
  );

  useEffect(() => {
    if (!selectedFile) return;
    setSelectedAnchorId(fileAnchorId(selectedFile.path));
    setEditingCommentId(undefined);
    setCommentDraft("");
  }, [selectedFile]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(drafts));
  }, [drafts, storageKey]);

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
    setEditingCommentId(comment.id);
    setCommentDraft(comment.body);
  };

  const submit = () => {
    onSubmitPrompt(buildReviewPrompt(snapshot, drafts));
  };

  return (
    <section className="review-mode" data-testid="review-surface">
      <header className="review-mode__header">
        <div>
          <div className="chat-header__eyebrow">Review</div>
          <h1>{snapshot.source.agent ? "Agent pre-review" : "Review changes"}</h1>
          <p>{snapshot.files.length} changed files · {formatReviewSource(snapshot)} · frozen {new Date(snapshot.createdAt).toLocaleTimeString()}</p>
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
            {snapshot.files.map((file) => (
              <button
                className={`review-mode__file ${file.path === selectedFile?.path ? "review-mode__file--selected" : ""}`}
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
              >
                <span>{file.path}</span>
                <span>{countFileComments(drafts, file.path)}</span>
              </button>
            ))}
          </aside>

          {selectedFile ? (
            <main className="review-mode__diff">
              <div className="review-mode__file-header">
                <strong>{selectedFile.path}</strong>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setSelectedAnchorId(fileAnchorId(selectedFile.path))}
                >
                  File comment
                </button>
              </div>
              <HighlightedReviewDiff
                language={extensionToLanguage(selectedFile.path)}
                lines={parsed.lines}
                selectedAnchorId={selectedAnchorId}
                onSelectAnchor={setSelectedAnchorId}
              />
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
