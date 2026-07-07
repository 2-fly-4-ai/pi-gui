# Integrated Review Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class in-app review mode for `apps/desktop` that lets users review current Git changes, add file/line comments, and submit a curated prompt into the composer without opening an external Glimpse window.

**Architecture:** Keep Git/diff snapshot work in Electron main behind narrow IPC methods, keep review parsing/prompt generation in pure shared modules, and render the review experience as a new desktop secondary surface. V1 supports working-tree changes only; branch-vs-base and agent pre-review are explicit follow-ups after the core loop is verified on the real Electron surface.

**Tech Stack:** Electron main/preload IPC, React renderer, TypeScript, existing `InlineDiff`/diff panel styles, Playwright Electron tests.

---

## Success Criteria

- User can run `/review` or click a Review action to open an in-app review surface.
- Review surface shows a frozen snapshot of current working-tree changes.
- User can add file-level and line-level comments.
- User can edit/delete comments before submission.
- Submit writes a Markdown review prompt into the selected session composer and returns to the thread view; it does not auto-send.
- Existing diff panel behavior remains unchanged.
- Verified with a core Electron Playwright spec on the real desktop surface.

## Non-goals for V1

- No external Glimpse window.
- No `/review --agent` pre-review yet.
- No branch/base selector yet.
- No applying review comments automatically.
- No persistent review sessions after app restart. Drafts can live in renderer state for V1.

## File Structure

### New files

- `electron/review/review-snapshot.ts`
  - Main-process Git snapshot service. Produces one immutable review snapshot from the current working tree.
- `src/review/review-types.ts`
  - Shared renderer-facing review types: snapshot, file, line, anchor, draft comment.
- `src/review/review-diff-parser.ts`
  - Pure parser that turns unified diffs into display lines with stable anchor IDs.
- `src/review/review-prompt.ts`
  - Pure prompt builder that converts curated comments into composer Markdown.
- `src/review/ReviewSurface.tsx`
  - Full in-app review surface: file list, diff viewer, comment editor, submit/cancel.
- `tests/core/integrated-review-mode.spec.ts`
  - Electron Playwright coverage for `/review`, comment creation, prompt submission.

### Modified files

- `src/desktop-state.ts`
  - Add `review` to `AppView`.
- `src/ipc.ts`
  - Add `createReviewSnapshot(workspaceId)` to the typed desktop API.
- `electron/main.ts`
  - Register the `createReviewSnapshot` IPC handler.
- `electron/preload.ts`
  - Expose `createReviewSnapshot` through the narrow preload API.
- `electron/app-store-composer.ts`
  - Handle `/review` as a host command that switches to the review surface.
- `src/composer-commands.ts`
  - Add `/review` to slash menu.
- `src/App.tsx`
  - Render `ReviewSurface` when `activeView === "review"`; wire snapshot loading and composer injection.
- `src/diff-inline.tsx`
  - Export or reuse diff parsing carefully, without breaking existing `InlineDiff` behavior.
- `src/styles.css`
  - Add review surface styles.

---

### Task 1: Add pure review types and diff parser

**Files:**
- Create: `src/review/review-types.ts`
- Create: `src/review/review-diff-parser.ts`
- Test: `tests/core/integrated-review-mode.spec.ts` later covers UI; parser can be tested by a small colocated unit if a unit-test lane exists. If not, keep parser pure and cover through Electron test in Task 6.

- [ ] **Step 1: Create shared review types**

Create `src/review/review-types.ts`:

```ts
export type ReviewLineKind = "added" | "removed" | "context" | "header";

export interface ReviewSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly files: readonly ReviewFileSnapshot[];
}

export interface ReviewFileSnapshot {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly diff: string;
  readonly anchors: readonly ReviewAnchor[];
}

export interface ReviewAnchor {
  readonly id: string;
  readonly filePath: string;
  readonly kind: "file" | "line";
  readonly lineKind?: ReviewLineKind;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

export interface ReviewDisplayLine {
  readonly anchorId: string;
  readonly kind: ReviewLineKind;
  readonly content: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

export interface ReviewDraftComment {
  readonly id: string;
  readonly anchorId: string;
  readonly filePath: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

- [ ] **Step 2: Create unified diff parser with stable anchors**

Create `src/review/review-diff-parser.ts`:

```ts
import type { ReviewAnchor, ReviewDisplayLine, ReviewLineKind } from "./review-types";

export function fileAnchorId(filePath: string): string {
  return `file:${encodeURIComponent(filePath)}`;
}

export function lineAnchorId(filePath: string, oldLineNumber: number | undefined, newLineNumber: number | undefined, index: number): string {
  const oldPart = oldLineNumber === undefined ? "" : String(oldLineNumber);
  const newPart = newLineNumber === undefined ? "" : String(newLineNumber);
  return `line:${encodeURIComponent(filePath)}:${oldPart}:${newPart}:${index}`;
}

export function parseReviewDiff(filePath: string, diff: string): { readonly lines: readonly ReviewDisplayLine[]; readonly anchors: readonly ReviewAnchor[] } {
  const lines: ReviewDisplayLine[] = [];
  const anchors: ReviewAnchor[] = [{ id: fileAnchorId(filePath), filePath, kind: "file" }];
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of diff.split("\n")) {
    if (rawLine.startsWith("diff --git") || rawLine.startsWith("index ") || rawLine.startsWith("---") || rawLine.startsWith("+++")) {
      continue;
    }

    if (rawLine.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      const anchorId = lineAnchorId(filePath, undefined, undefined, lines.length);
      lines.push({ anchorId, kind: "header", content: rawLine });
      continue;
    }

    let kind: ReviewLineKind | undefined;
    let oldLineNumber: number | undefined;
    let newLineNumber: number | undefined;
    let content = rawLine;

    if (rawLine.startsWith("+")) {
      kind = "added";
      content = rawLine.slice(1);
      newLineNumber = newLine;
      newLine += 1;
    } else if (rawLine.startsWith("-")) {
      kind = "removed";
      content = rawLine.slice(1);
      oldLineNumber = oldLine;
      oldLine += 1;
    } else if (rawLine.startsWith(" ") || rawLine === "") {
      kind = "context";
      content = rawLine.startsWith(" ") ? rawLine.slice(1) : "";
      oldLineNumber = oldLine;
      newLineNumber = newLine;
      oldLine += 1;
      newLine += 1;
    }

    if (!kind) continue;

    const anchorId = lineAnchorId(filePath, oldLineNumber, newLineNumber, lines.length);
    lines.push({ anchorId, kind, content, oldLineNumber, newLineNumber });
    anchors.push({ id: anchorId, filePath, kind: "line", lineKind: kind, oldLineNumber, newLineNumber });
  }

  return { lines, anchors };
}
```

- [ ] **Step 3: Run typecheck to catch syntax errors**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm typecheck
```

Expected: either PASS, or existing unrelated failures. Any failure in the new `src/review/*` files must be fixed before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/review/review-types.ts src/review/review-diff-parser.ts
git commit -m "feat(desktop): add review diff model"
```

---

### Task 2: Add Electron review snapshot IPC

**Files:**
- Create: `electron/review/review-snapshot.ts`
- Modify: `src/ipc.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Create main-process snapshot service**

Create `electron/review/review-snapshot.ts`:

```ts
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ReviewFileSnapshot, ReviewSnapshot } from "../../src/review/review-types";
import { parseReviewDiff } from "../../src/review/review-diff-parser";
import { getChangedFiles } from "../app-store-diff";

const execFileAsync = promisify(execFile);

export async function createReviewSnapshot(workspaceId: string, workspacePath: string): Promise<ReviewSnapshot> {
  const changedFiles = await getChangedFiles(workspacePath);
  const files: ReviewFileSnapshot[] = [];

  for (const file of changedFiles) {
    const diff = await getFrozenFileDiff(workspacePath, file.path);
    if (!diff.trim()) continue;
    const parsed = parseReviewDiff(file.path, diff);
    files.push({
      path: file.path,
      status: file.status,
      diff,
      anchors: parsed.anchors,
    });
  }

  return {
    id: randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    files,
  };
}

async function getFrozenFileDiff(workspacePath: string, filePath: string): Promise<string> {
  const unstaged = await runGitDiff(workspacePath, ["diff", "--", filePath]);
  if (unstaged.trim()) return unstaged;

  const staged = await runGitDiff(workspacePath, ["diff", "--cached", "--", filePath]);
  if (staged.trim()) return staged;

  return runGitDiff(workspacePath, ["diff", "--no-index", "--", "/dev/null", filePath], true);
}

async function runGitDiff(workspacePath: string, args: readonly string[], allowExitOne = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (allowExitOne && isExpectedNoIndexDiff(error)) {
      return error.stdout;
    }
    return "";
  }
}

function isExpectedNoIndexDiff(error: unknown): error is { readonly code: number; readonly stdout: string } {
  return typeof error === "object" && error !== null && "code" in error && "stdout" in error && (error as { code: number }).code === 1;
}
```

- [ ] **Step 2: Add IPC type definitions**

In `src/ipc.ts`, import the type and add the channel/API entries:

```ts
import type { ReviewSnapshot } from "./review/review-types";
```

Add to `desktopIpc`:

```ts
createReviewSnapshot: "pi-gui:create-review-snapshot",
```

Add to `PiDesktopApi`:

```ts
createReviewSnapshot(workspaceId: string): Promise<ReviewSnapshot>;
```

- [ ] **Step 3: Register main handler**

In `electron/main.ts`, add import:

```ts
import { createReviewSnapshot } from "./review/review-snapshot";
```

Near the existing diff IPC handlers, add:

```ts
ipcMain.handle(desktopIpc.createReviewSnapshot, async (_event, workspaceId: string) => {
  const workspacePath = store.getWorkspacePath(workspaceId);
  if (!workspacePath) {
    throw new Error(`Unknown workspace: ${workspaceId}`);
  }
  return createReviewSnapshot(workspaceId, workspacePath);
});
```

- [ ] **Step 4: Expose preload method**

In `electron/preload.ts`, add to the exposed API object:

```ts
createReviewSnapshot: (workspaceId: string) =>
  ipcRenderer.invoke(desktopIpc.createReviewSnapshot, workspaceId) as Promise<ReviewSnapshot>,
```

If `ReviewSnapshot` is not in scope, add:

```ts
import type { ReviewSnapshot } from "../src/review/review-types";
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm typecheck
```

Expected: PASS or only pre-existing unrelated failures. Fix all new IPC/type failures.

- [ ] **Step 6: Commit**

```bash
git add electron/review/review-snapshot.ts src/ipc.ts electron/main.ts electron/preload.ts
git commit -m "feat(desktop): expose review snapshots"
```

---

### Task 3: Add review prompt builder

**Files:**
- Create: `src/review/review-prompt.ts`

- [ ] **Step 1: Create prompt builder**

Create `src/review/review-prompt.ts`:

```ts
import type { ReviewDraftComment, ReviewSnapshot } from "./review-types";

export function buildReviewPrompt(snapshot: ReviewSnapshot, comments: readonly ReviewDraftComment[]): string {
  const commentsByFile = new Map<string, ReviewDraftComment[]>();
  for (const comment of comments) {
    const list = commentsByFile.get(comment.filePath) ?? [];
    list.push(comment);
    commentsByFile.set(comment.filePath, list);
  }

  const sections = snapshot.files
    .map((file) => {
      const fileComments = commentsByFile.get(file.path) ?? [];
      if (fileComments.length === 0) return undefined;
      const commentLines = fileComments.map((comment) => {
        const anchor = file.anchors.find((entry) => entry.id === comment.anchorId);
        const location = anchor?.kind === "line"
          ? formatLineLocation(anchor.oldLineNumber, anchor.newLineNumber)
          : "file";
        return `- ${location}: ${comment.body.trim()}`;
      });
      return [`### ${file.path}`, ...commentLines].join("\n");
    })
    .filter(Boolean);

  return [
    "Please address this review of the current working-tree changes.",
    "",
    "Treat each comment as user feedback on the frozen diff snapshot. Do not assume the files are unchanged; inspect current files before editing.",
    "",
    ...sections,
  ].join("\n").trim() + "\n";
}

function formatLineLocation(oldLineNumber: number | undefined, newLineNumber: number | undefined): string {
  if (newLineNumber !== undefined) return `line ${newLineNumber}`;
  if (oldLineNumber !== undefined) return `removed line ${oldLineNumber}`;
  return "hunk";
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm typecheck
```

Expected: PASS or only pre-existing unrelated failures.

- [ ] **Step 3: Commit**

```bash
git add src/review/review-prompt.ts
git commit -m "feat(desktop): build review prompt"
```

---

### Task 4: Add `/review` command and app view routing

**Files:**
- Modify: `src/desktop-state.ts`
- Modify: `src/composer-commands.ts`
- Modify: `electron/app-store-composer.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add review app view**

In `src/desktop-state.ts`, change `AppView` to include review:

```ts
export type AppView = "threads" | "new-thread" | "display-mode" | "skills" | "extensions" | "settings" | "review";
```

- [ ] **Step 2: Add slash menu entry**

In `src/composer-commands.ts`, add a host slash command next to `/reload`:

```ts
{
  id: "host:review",
  kind: "review",
  command: "/review",
  template: "/review",
  title: "Review changes",
  description: "Open an in-app review surface for current Git changes",
  submitMode: "immediate",
  section: "host",
},
```

If the command kind union does not include `review`, add it to the relevant union types and parser return type:

```ts
| "review"
```

and parser result:

```ts
| { type: "review" }
```

- [ ] **Step 3: Parse `/review`**

In `src/composer-commands.ts`, add to `parseTreeComposerCommand` or the equivalent parser:

```ts
if (trimmed === "/review") {
  return { type: "review" };
}
```

- [ ] **Step 4: Switch app to review view from host command**

In `electron/app-store-composer.ts`, inside `runComposerCommand`, add:

```ts
if (parsed.type === "review") {
  store.state = {
    ...store.state,
    activeView: "review",
    composerDraft: "",
    composerDraftSyncSource: "command",
    composerDraftSyncNonce: store.state.composerDraftSyncNonce + 1,
    composerAttachments: [],
    lastError: undefined,
    revision: store.state.revision + 1,
  };
  store.schedulePersistUiState();
  return store.emit();
}
```

- [ ] **Step 5: Add temporary review placeholder surface**

In `src/App.tsx`, before the existing secondary views, add a temporary branch:

```tsx
if (snapshot.activeView === "review") {
  return (
    <SecondarySurface onBack={() => setActiveView("threads")} testId="review-surface" title="Review changes">
      <section className="canvas">
        <div className="conversation">
          <h1>Review changes</h1>
          <p>Review surface loading.</p>
        </div>
      </section>
    </SecondarySurface>
  );
}
```

- [ ] **Step 6: Run typecheck**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm typecheck
```

Expected: PASS or only pre-existing unrelated failures.

- [ ] **Step 7: Commit**

```bash
git add src/desktop-state.ts src/composer-commands.ts electron/app-store-composer.ts src/App.tsx
git commit -m "feat(desktop): route review command"
```

---

### Task 5: Implement the in-app review surface

**Files:**
- Create: `src/review/ReviewSurface.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Create review surface component**

Create `src/review/ReviewSurface.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { PiDesktopApi } from "../ipc";
import { extensionToLanguage } from "../syntax-highlight";
import { HighlightedReviewDiff } from "./HighlightedReviewDiff";
import { buildReviewPrompt } from "./review-prompt";
import { fileAnchorId, parseReviewDiff } from "./review-diff-parser";
import type { ReviewDraftComment, ReviewSnapshot } from "./review-types";

interface ReviewSurfaceProps {
  readonly api: PiDesktopApi;
  readonly snapshot: ReviewSnapshot;
  readonly onCancel: () => void;
  readonly onSubmitPrompt: (prompt: string) => void;
}

export function ReviewSurface({ api: _api, snapshot, onCancel, onSubmitPrompt }: ReviewSurfaceProps) {
  const [selectedPath, setSelectedPath] = useState(snapshot.files[0]?.path ?? "");
  const [drafts, setDrafts] = useState<readonly ReviewDraftComment[]>([]);
  const selectedFile = snapshot.files.find((file) => file.path === selectedPath) ?? snapshot.files[0];
  const parsed = useMemo(
    () => selectedFile ? parseReviewDiff(selectedFile.path, selectedFile.diff) : { lines: [], anchors: [] },
    [selectedFile],
  );

  const addComment = (anchorId: string, filePath: string) => {
    const body = window.prompt("Review comment");
    if (!body?.trim()) return;
    const now = new Date().toISOString();
    setDrafts((current) => [
      ...current,
      { id: crypto.randomUUID(), anchorId, filePath, body: body.trim(), createdAt: now, updatedAt: now },
    ]);
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
          <button className="button button--primary" type="button" disabled={drafts.length === 0} onClick={submit}>Submit {drafts.length} comments</button>
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
                <span>{drafts.filter((comment) => comment.filePath === file.path).length}</span>
              </button>
            ))}
          </aside>

          {selectedFile ? (
            <main className="review-mode__diff">
              <div className="review-mode__file-header">
                <strong>{selectedFile.path}</strong>
                <button className="button button--secondary" type="button" onClick={() => addComment(fileAnchorId(selectedFile.path), selectedFile.path)}>File comment</button>
              </div>
              <HighlightedReviewDiff
                language={extensionToLanguage(selectedFile.path)}
                lines={parsed.lines}
                onAddComment={(anchorId) => addComment(anchorId, selectedFile.path)}
              />
              <section className="review-mode__comments">
                <h2>Comments</h2>
                {drafts.filter((comment) => comment.filePath === selectedFile.path).map((comment) => (
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
```

- [ ] **Step 2: Create review diff renderer used by the surface**

Create `src/review/HighlightedReviewDiff.tsx`:

```tsx
import { useMemo, type ReactNode } from "react";
import { MAX_HIGHLIGHTED_LINES, highlightLine, type HighlightLine } from "../syntax-highlight";
import type { ReviewDisplayLine } from "./review-types";

export function HighlightedReviewDiff({
  lines,
  language,
  onAddComment,
}: {
  readonly lines: readonly ReviewDisplayLine[];
  readonly language?: string;
  readonly onAddComment: (anchorId: string) => void;
}) {
  const highlightActive = language !== undefined && lines.length <= MAX_HIGHLIGHTED_LINES;

  return (
    <pre className="diff-inline review-mode__inline-diff" data-language={highlightActive ? language : undefined}>
      {lines.map((line) => (
        <div className={`diff-line diff-line--${line.kind} review-mode__line`} key={line.anchorId}>
          <button className="review-mode__line-comment" type="button" aria-label="Add line comment" onClick={() => onAddComment(line.anchorId)}>+</button>
          <span className="diff-line__number">{line.newLineNumber ?? line.oldLineNumber ?? ""}</span>
          <span className="diff-line__content">
            {highlightActive && line.kind !== "header" ? <HighlightedContent content={line.content} language={language!} /> : line.content}
          </span>
        </div>
      ))}
    </pre>
  );
}

function HighlightedContent({ content, language }: { readonly content: string; readonly language: string }) {
  const tokens = useMemo(() => highlightLine(content, language), [content, language]);
  return <>{renderTokens(tokens)}</>;
}

function renderTokens(tokens: HighlightLine): ReactNode {
  return tokens.map((token, index) => typeof token === "string" ? token : <span className={token.className} key={index}>{renderTokens(token.children)}</span>);
}
```

- [ ] **Step 3: Wire surface into App**

In `src/App.tsx`, import the new surface:

```ts
import { ReviewSurface } from "./review/ReviewSurface";
```

Add local state near other view state:

```ts
const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | undefined>();
const [reviewLoading, setReviewLoading] = useState(false);
```

Add the type import:

```ts
import type { ReviewSnapshot } from "./review/review-types";
```

When `snapshot.activeView === "review"`, load snapshot for selected workspace:

```tsx
if (snapshot.activeView === "review") {
  const workspaceId = selectedWorkspace?.id;
  if (workspaceId && !reviewSnapshot && !reviewLoading) {
    setReviewLoading(true);
    void api.createReviewSnapshot(workspaceId).then((next) => {
      setReviewSnapshot(next);
      setReviewLoading(false);
    });
  }

  return (
    <SecondarySurface onBack={() => { setReviewSnapshot(undefined); setActiveView("threads"); }} testId="review-surface" title="Review changes">
      {reviewLoading || !reviewSnapshot ? (
        <section className="canvas"><div className="empty-panel"><h1>Loading review…</h1></div></section>
      ) : (
        <ReviewSurface
          api={api}
          snapshot={reviewSnapshot}
          onCancel={() => { setReviewSnapshot(undefined); setActiveView("threads"); }}
          onSubmitPrompt={(prompt) => {
            setReviewSnapshot(undefined);
            setComposerDraftFromExternalSource(prompt);
            setActiveView("threads");
          }}
        />
      )}
    </SecondarySurface>
  );
}
```

If `setComposerDraftFromExternalSource` does not exist, add a small helper in `App.tsx` that mirrors extension editor text behavior:

```ts
const setComposerDraftFromExternalSource = (text: string) => {
  setSnapshot((current) => current ? {
    ...current,
    composerDraft: text,
    composerDraftSyncSource: "command",
    composerDraftSyncNonce: current.composerDraftSyncNonce + 1,
  } : current);
};
```

- [ ] **Step 4: Add basic styles**

In `src/styles.css`, add:

```css
.review-mode {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
  padding: 20px;
}
.review-mode__header,
.review-mode__file-header,
.review-mode__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.review-mode__layout {
  display: grid;
  grid-template-columns: minmax(220px, 280px) 1fr;
  min-height: 0;
  flex: 1;
  gap: 16px;
}
.review-mode__files,
.review-mode__diff {
  min-height: 0;
  overflow: auto;
}
.review-mode__file {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
}
.review-mode__file--selected {
  background: var(--surface-elevated);
}
.review-mode__line {
  display: grid;
  grid-template-columns: 24px 56px 1fr;
}
.review-mode__line-comment {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.review-mode__line-comment:hover {
  color: var(--text-primary);
}
.review-mode__comments {
  margin-top: 16px;
}
.review-mode__comment {
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
}
```

Use actual CSS variables present in `src/styles.css`; if any variable above does not exist, replace with the nearest existing token.

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm typecheck
```

Expected: PASS or only pre-existing unrelated failures. Fix new React/type errors.

- [ ] **Step 6: Commit**

```bash
git add src/review/ReviewSurface.tsx src/review/HighlightedReviewDiff.tsx src/App.tsx src/styles.css
git commit -m "feat(desktop): add in-app review surface"
```

---

### Task 6: Add Electron verification coverage

**Files:**
- Create: `tests/core/integrated-review-mode.spec.ts`

- [ ] **Step 1: Write failing Electron test**

Create `tests/core/integrated-review-mode.spec.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  commitAllInGitRepo,
  createNamedThread,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

async function seedWorkspace(): Promise<string> {
  const workspacePath = await makeWorkspace("integrated-review-mode");
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src", "example.ts"), "export const value = 1;\n", "utf8");
  await commitAllInGitRepo(workspacePath, "init");
  await writeFile(join(workspacePath, "src", "example.ts"), "export const value = 2;\n", "utf8");
  return workspacePath;
}

test("/review opens in-app review surface and submits comments into composer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await seedWorkspace();
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();

  try {
    await createNamedThread(window, "Integrated review mode");
    const composer = window.getByTestId("composer");
    await composer.fill("/review");
    await composer.press("Enter");

    const reviewSurface = window.getByTestId("review-surface");
    await expect(reviewSurface).toBeVisible();
    await expect(reviewSurface.getByText("src/example.ts")).toBeVisible();

    await reviewSurface.locator(".review-mode__line-comment").first().click();
    await window.keyboard.type("Please avoid changing this constant without a named domain reason.");
    await window.keyboard.press("Enter");

    await reviewSurface.getByRole("button", { name: /Submit 1 comments/ }).click();
    await expect(composer).toHaveValue(/Please address this review/);
    await expect(composer).toHaveValue(/src\/example\.ts/);
    await expect(composer).toHaveValue(/Please avoid changing this constant/);
  } finally {
    await harness.close();
  }
});
```

If `window.prompt` cannot be driven reliably by Playwright, change Task 5 to use an inline textarea instead of `window.prompt`, then update this test to fill that textarea.

- [ ] **Step 2: Run test and verify it fails for missing behavior or passes after implementation**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm playwright test tests/core/integrated-review-mode.spec.ts --project=electron-core
```

Expected before Task 5: FAIL because `/review` or surface is missing. Expected after Task 5: PASS.

- [ ] **Step 3: Fix testability issue if needed**

If Playwright cannot interact with `window.prompt`, replace prompt usage in `ReviewSurface` with component state:

```tsx
<textarea aria-label="Review comment" value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
<button type="button" onClick={saveComment}>Save comment</button>
```

Then update the test to use:

```ts
await reviewSurface.getByLabel("Review comment").fill("Please avoid changing this constant without a named domain reason.");
await reviewSurface.getByRole("button", { name: "Save comment" }).click();
```

- [ ] **Step 4: Run owning core lane**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm playwright test tests/core/review-ux.spec.ts tests/core/integrated-review-mode.spec.ts --project=electron-core
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/core/integrated-review-mode.spec.ts src/review/ReviewSurface.tsx
git commit -m "test(desktop): cover integrated review mode"
```

---

### Task 7: Simplify and harden before handoff

**Files:**
- Review all files touched above.

- [ ] **Step 1: Run simplify pass**

Inspect for duplicated parsing, renderer/main boundary leaks, and large React component complexity. If `ReviewSurface.tsx` is too large, split it into focused components:

```text
src/review/ReviewFileList.tsx
src/review/ReviewCommentList.tsx
src/review/HighlightedReviewDiff.tsx
```

- [ ] **Step 2: Verify no broad Node exposure**

Confirm renderer only calls:

```ts
api.createReviewSnapshot(workspaceId)
```

and does not import `node:*`, call `git`, or read workspace files directly.

- [ ] **Step 3: Run final verification**

Run:

```bash
cd /Users/brianfarley/Desktop/Githhub-project/pi-gui/apps/desktop
pnpm typecheck
pnpm playwright test tests/core/review-ux.spec.ts tests/core/integrated-review-mode.spec.ts --project=electron-core
```

Expected: PASS.

- [ ] **Step 4: Manual Electron smoke**

Run the desktop app normally, create a tiny tracked-file change, then verify on the real surface:

```text
/review
```

Expected:

- Review opens in the app, not Glimpse.
- A changed file appears.
- A line comment can be added.
- Submit returns to the thread and fills the composer.
- Nothing is sent automatically.

- [ ] **Step 5: Commit cleanup**

```bash
git add src/review src/App.tsx src/styles.css electron src/ipc.ts tests/core/integrated-review-mode.spec.ts
git commit -m "chore(desktop): harden review mode"
```

---

## Follow-up Plan Seeds

After V1 ships, write separate plans for:

1. Branch/base review snapshots: `/review --base main` and UI base selector.
2. Agent pre-review: visible agent review pass that seeds comments for user approval.
3. Persisted review sessions: survive navigation/reload and show review events in timeline.
4. Better comment UX: inline popovers instead of simple prompts/textareas.

## Self-Review

- **Spec coverage:** Covers in-app review surface, frozen working-tree snapshot, file/line comments, prompt injection, no auto-send, and Electron verification. Agent pre-review and branch review are intentionally follow-ups.
- **Placeholder scan:** No TBD/TODO/fill-later placeholders. Follow-ups are explicitly out of V1 scope.
- **Type consistency:** `ReviewSnapshot`, `ReviewFileSnapshot`, `ReviewAnchor`, and `ReviewDraftComment` are used consistently across snapshot, parser, prompt builder, and renderer tasks.
