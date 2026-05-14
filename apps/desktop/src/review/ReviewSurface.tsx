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
  const [selectedPath, setSelectedPath] = useState(snapshot.files[0]?.path ?? "");
  const [selectedAnchorId, setSelectedAnchorId] = useState(snapshot.files[0] ? fileAnchorId(snapshot.files[0].path) : "");
  const [commentDraft, setCommentDraft] = useState("");
  const [drafts, setDrafts] = useState<readonly ReviewDraftComment[]>([]);
  const selectedFile = snapshot.files.find((file) => file.path === selectedPath) ?? snapshot.files[0];
  const selectedFileDrafts = selectedFile ? drafts.filter((comment) => comment.filePath === selectedFile.path) : [];
  const parsed = useMemo(
    () => (selectedFile ? parseReviewDiff(selectedFile.path, selectedFile.diff) : { lines: [], anchors: [] }),
    [selectedFile],
  );

  useEffect(() => {
    if (!selectedFile) return;
    setSelectedAnchorId(fileAnchorId(selectedFile.path));
    setCommentDraft("");
  }, [selectedFile]);

  const saveComment = () => {
    if (!selectedFile || !selectedAnchorId || !commentDraft.trim()) return;
    const now = new Date().toISOString();
    setDrafts((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        anchorId: selectedAnchorId,
        filePath: selectedFile.path,
        body: commentDraft.trim(),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setCommentDraft("");
  };

  const deleteComment = (id: string) => {
    setDrafts((current) => current.filter((comment) => comment.id !== id));
  };

  const submit = () => {
    onSubmitPrompt(buildReviewPrompt(snapshot, drafts));
  };

  return (
    <section className="review-mode" data-testid="review-surface">
      <header className="review-mode__header">
        <div>
          <div className="chat-header__eyebrow">Review</div>
          <h1>Review changes</h1>
          <p>{snapshot.files.length} changed files · frozen {new Date(snapshot.createdAt).toLocaleTimeString()}</p>
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
                <button className="button button--primary" type="button" disabled={!commentDraft.trim()} onClick={saveComment}>Save comment</button>
              </section>
              <section className="review-mode__comments">
                <h2>Comments</h2>
                {selectedFileDrafts.length === 0 ? <p>No comments for this file yet.</p> : null}
                {selectedFileDrafts.map((comment) => (
                  <article className="review-mode__comment" key={comment.id}>
                    <p>{comment.body}</p>
                    <button className="button button--secondary" type="button" onClick={() => deleteComment(comment.id)}>Delete</button>
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
