# T3-Inspired Composer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Pi's composer around the T3 Code chatbox pattern: a calm rounded input, first-class model/reasoning/mode/supervision controls, subtle checkout row, better attachment drop UX, and a context-window indicator.

**Architecture:** Split the composer footer into focused control components instead of embedding model state in hint text. Keep the transport/session behavior unchanged for visual controls first, then add explicit tool-access settings as session config. The context-window indicator starts from available runtime/session metadata and gracefully shows an estimated/unknown state until true token-window usage exists.

**Tech Stack:** React, TypeScript, Electron renderer IPC, existing Pi session driver/runtime driver, CSS in `apps/desktop/src/styles/main.css`, Playwright Electron tests.

---

## Important Product Decisions

1. **Visual design:** Copy the spirit of T3 Code, not exact internals. Pi keeps its own composer behavior, slash commands, session tree, model settings, and checkout selector.
2. **Context window:** Add the UI affordance now. If exact token/window telemetry is unavailable, show `Context window` with `Usage unavailable` and a helpful explanation. Do not fake precise percentages.
3. **Supervised mode:** Add a `Supervised` control that maps to tool access presets:
   - `Full`: all default built-ins available.
   - `Read-only`: `read`, `grep`, `find`, `ls`.
   - `No tools`: no tools.
   - `Custom`: user-selected built-ins from `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
4. **Runtime mapping:** Pi runtime already has `tools` plumbing in the SDK driver path. Use that for allow-list mode. Add explicit no-tools/no-builtin mode only where the underlying runtime supports it; otherwise represent `No tools` as an empty allow-list and test the behavior.
5. **Scope control:** Do not add branch switching, prompt-mode semantics, or fake token telemetry in this pass.

## File Structure

- Create `apps/desktop/src/composer-control-bar.tsx`: grouped bottom toolbar for model, reasoning, task mode, supervision, context-window, attach, and send controls.
- Create `apps/desktop/src/tool-access.ts`: renderer-safe types, presets, labels, built-in tool IDs, local default helpers.
- Create `apps/desktop/src/tool-access-selector.tsx`: `Supervised` dropdown with preset and custom checkbox UI.
- Create `apps/desktop/src/context-window-indicator.tsx`: compact info icon/button plus popover matching the screenshot.
- Modify `apps/desktop/src/model-selector.tsx`: add a `variant="composer"` display mode and support combined `Medium · Normal`-style label for thinking where appropriate.
- Modify `apps/desktop/src/composer-surface.tsx`: improve drag/drop overlay and attachment tray, accept a richer footer/control bar.
- Modify `apps/desktop/src/composer-panel.tsx`: replace hint-string footer with the new control bar for existing threads.
- Modify `apps/desktop/src/new-thread-view.tsx`: use the same control bar for new threads.
- Modify `apps/desktop/src/App.tsx`: hold tool-access selection, pass context-window data, wire tool access into start/session paths.
- Modify `apps/desktop/src/desktop-state.ts`, `packages/session-driver/src/types.ts`, and pi-sdk driver types if needed: add `toolAccess` to session config/start options.
- Modify `packages/pi-sdk-driver/src/npm-package-fallback.ts` and session creation/supervisor files: pass selected tools/no-tools into `createAgentSessionFromServices`.
- Modify `apps/desktop/src/styles/main.css`: T3-inspired composer shell/control styling, context popover, tool access dropdown, improved attachments/drop overlay.
- Modify tests:
  - `apps/desktop/tests/core/composer-controls.spec.ts`
  - `apps/desktop/tests/core/new-thread-composer.spec.ts`
  - `apps/desktop/tests/core/composer-drag-drop.spec.ts`
  - add targeted tool-access test if runtime state is exposed.

---

## Task 1: Extract Composer Control Bar UI

**Files:**
- Create: `apps/desktop/src/composer-control-bar.tsx`
- Modify: `apps/desktop/src/composer-panel.tsx`
- Modify: `apps/desktop/src/new-thread-view.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/composer-controls.spec.ts`, `apps/desktop/tests/core/new-thread-composer.spec.ts`

- [ ] **Step 1: Create `ComposerControlBar` component**

```tsx
import type { ReactNode } from "react";
import { ArrowUpIcon, PlusIcon, StopSquareIcon } from "./icons";

interface ComposerControlBarProps {
  readonly modelControl: ReactNode;
  readonly reasoningControl: ReactNode;
  readonly modeControl: ReactNode;
  readonly supervisionControl: ReactNode;
  readonly contextControl: ReactNode;
  readonly sendLabel: string;
  readonly sendDisabled: boolean;
  readonly stopMode: boolean;
  readonly onAttach: () => void;
  readonly onSubmit: () => void;
}

export function ComposerControlBar({
  modelControl,
  reasoningControl,
  modeControl,
  supervisionControl,
  contextControl,
  sendLabel,
  sendDisabled,
  stopMode,
  onAttach,
  onSubmit,
}: ComposerControlBarProps) {
  return (
    <div className="composer-control-bar">
      <div className="composer-control-bar__left">
        {modelControl}
        <span className="composer-control-bar__separator" aria-hidden="true" />
        {reasoningControl}
        <span className="composer-control-bar__separator" aria-hidden="true" />
        {modeControl}
        <span className="composer-control-bar__separator" aria-hidden="true" />
        {supervisionControl}
      </div>
      <div className="composer-control-bar__right">
        {contextControl}
        <button aria-label="Attach files" className="icon-button composer__attach" type="button" onClick={onAttach}>
          <PlusIcon />
        </button>
        <button
          aria-label={sendLabel}
          className="button button--primary button--cta-icon"
          data-testid="send"
          type="button"
          disabled={sendDisabled}
          onClick={onSubmit}
        >
          {stopMode ? <StopSquareIcon /> : <ArrowUpIcon />}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace old hint/footer layout in existing-thread composer**

In `apps/desktop/src/composer-panel.tsx`, remove the hint text from the footer and render `ComposerControlBar` inside `.composer__footer`. Keep the existing running/queue shortcut text as a small secondary line only when needed:

```tsx
<footer={(
  <div className="composer__footer">
    <ComposerControlBar
      modelControl={...}
      reasoningControl={...}
      modeControl={<ComposerModeControl value="Build" />}
      supervisionControl={...}
      contextControl={...}
      sendLabel={primaryActionIsStop ? "Stop run" : "Send message"}
      sendDisabled={!primaryActionIsStop && ((!composerDraft.trim() && attachments.length === 0) || modelOnboarding.requiresModelSelection)}
      stopMode={primaryActionIsStop}
      onAttach={onPickAttachments}
      onSubmit={onSubmit}
    />
  </div>
)}
```

- [ ] **Step 3: Replace new-thread footer layout**

In `apps/desktop/src/new-thread-view.tsx`, use the same `ComposerControlBar`. Keep the hidden file input in the new-thread footer and wire `onAttach` to `fileInputRef.current?.click()`.

- [ ] **Step 4: Style the control bar**

Add CSS:

```css
.composer-control-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
}

.composer-control-bar__left,
.composer-control-bar__right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.composer-control-bar__separator {
  width: 1px;
  height: 18px;
  background: var(--line);
  opacity: 0.75;
}

.composer-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 7px;
  border-radius: 8px;
  color: var(--muted-strong);
  font-size: 13px;
}

.composer-control:hover:not(:disabled) {
  background: rgba(128, 128, 128, 0.08);
  color: var(--text-strong);
}
```

- [ ] **Step 5: Update tests**

Assert the composer footer exposes model, reasoning, Build, and Supervised controls.

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/composer-controls.spec.ts apps/desktop/tests/core/new-thread-composer.spec.ts
```

Expected: PASS after implementation.

---

## Task 2: Restyle Model and Reasoning Controls

**Files:**
- Modify: `apps/desktop/src/model-selector.tsx`
- Create or modify: `apps/desktop/src/reasoning-selector.tsx`
- Modify: `apps/desktop/src/composer-panel.tsx`
- Modify: `apps/desktop/src/new-thread-view.tsx`
- Modify: `apps/desktop/src/styles/main.css`

- [ ] **Step 1: Add composer variant to model selector**

Extend props:

```ts
readonly variant?: "inline" | "composer";
```

Use `composer-control model-selector__badge--composer` for the button when `variant === "composer"`.

- [ ] **Step 2: Shorten labels**

Add helper:

```ts
function formatComposerModelLabel(provider: string | undefined, modelId: string | undefined, fallback: string): string {
  if (!provider || !modelId) return fallback;
  return modelId.replace(/^gpt-/i, "GPT-").replace(/^claude-/i, "Claude ");
}
```

Use the compact label in composer variant only.

- [ ] **Step 3: Add reasoning selector**

Create a small wrapper around existing `THINKING_OPTIONS` that renders `Medium · Normal` style labels:

```tsx
export function ReasoningSelector({ thinkingLevel, disabled, onSetThinking }: Props) {
  return <ModelSelector ... onlyThinking variant="composer" />;
}
```

If modifying `ModelSelector` for only-thinking is too invasive, create a separate dropdown using `THINKING_OPTIONS`.

- [ ] **Step 4: Verify existing model tests**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/composer-controls.spec.ts apps/desktop/tests/core/new-thread-composer.spec.ts
```

Expected: PASS.

---

## Task 3: Add Supervised Tool Access Control

**Files:**
- Create: `apps/desktop/src/tool-access.ts`
- Create: `apps/desktop/src/tool-access-selector.tsx`
- Modify: `apps/desktop/src/desktop-state.ts`
- Modify: `packages/session-driver/src/types.ts`
- Modify: `packages/pi-sdk-driver/src/npm-package-fallback.ts`
- Modify: pi-sdk/session supervisor creation path as needed
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/composer-controls.spec.ts`

- [ ] **Step 1: Define tool access types**

```ts
export type BuiltInToolId = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
export type ToolAccessMode = "full" | "read-only" | "no-tools" | "custom";

export interface ToolAccessSelection {
  readonly mode: ToolAccessMode;
  readonly tools: readonly BuiltInToolId[];
}

export const BUILT_IN_TOOLS: readonly BuiltInToolId[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const READ_ONLY_TOOLS: readonly BuiltInToolId[] = ["read", "grep", "find", "ls"];
export const DEFAULT_TOOL_ACCESS: ToolAccessSelection = { mode: "full", tools: BUILT_IN_TOOLS };
```

- [ ] **Step 2: Build dropdown UI**

`ToolAccessSelector` shows:

```text
Supervised ▾
Tool access
✓ Full
  Read-only
  No tools
  Custom
Custom tools
[x] read [x] bash [x] edit [x] write [x] grep [x] find [x] ls
```

Only show checkboxes when `mode === "custom"`.

- [ ] **Step 3: Add app state**

In `App.tsx`, hold selected access for new thread and active thread session:

```ts
const [newThreadToolAccess, setNewThreadToolAccess] = useState<ToolAccessSelection>(DEFAULT_TOOL_ACCESS);
```

For existing sessions, use current session config when available; otherwise default to full.

- [ ] **Step 4: Extend session config**

In `packages/session-driver/src/types.ts`:

```ts
export interface SessionConfig {
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  readonly toolAccess?: ToolAccessSelection;
}
```

If importing renderer type is not appropriate, duplicate the minimal serializable type in a shared runtime-types file.

- [ ] **Step 5: Map selection to runtime options**

Create helper:

```ts
function resolveToolsForRuntime(selection: ToolAccessSelection): readonly string[] | undefined {
  if (selection.mode === "full") return undefined;
  if (selection.mode === "read-only") return READ_ONLY_TOOLS;
  if (selection.mode === "no-tools") return [];
  return selection.tools;
}
```

Pass this to existing `options.tools` where `createAgentSessionFromServices` is called.

- [ ] **Step 6: Add tests**

Test opening `Supervised`, choosing `Read-only`, and seeing the label update. If runtime config is inspectable, assert the new session carries the selected tool access.

---

## Task 4: Add Context Window Indicator

**Files:**
- Create: `apps/desktop/src/context-window-indicator.tsx`
- Modify: `apps/desktop/src/composer-control-bar.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/composer-controls.spec.ts`

- [ ] **Step 1: Create component**

```tsx
interface ContextWindowIndicatorProps {
  readonly percentUsed?: number;
  readonly tokensUsed?: number;
  readonly tokenLimit?: number;
  readonly compactionEnabled: boolean;
}

export function ContextWindowIndicator({ percentUsed, tokensUsed, tokenLimit, compactionEnabled }: ContextWindowIndicatorProps) {
  const hasUsage = percentUsed !== undefined && tokensUsed !== undefined && tokenLimit !== undefined;
  return (
    <div className="context-window-indicator">
      <button aria-label="Context window" className="context-window-indicator__button" type="button">i</button>
      <div className="context-window-indicator__popover" role="tooltip">
        <div className="context-window-indicator__title">CONTEXT WINDOW</div>
        <div className="context-window-indicator__usage">
          {hasUsage ? `${percentUsed.toFixed(1)}% · ${formatTokenCount(tokensUsed)}/${formatTokenCount(tokenLimit)} context used` : "Usage unavailable"}
        </div>
        <div className="context-window-indicator__body">
          {compactionEnabled ? "Automatically compacts its context when needed." : "Use /compact when the conversation gets long."}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add token formatting**

```ts
function formatTokenCount(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
```

- [ ] **Step 3: Wire current state**

If exact token usage is unavailable, pass only `compactionEnabled={true}` and no numbers. The popover must say `Usage unavailable` instead of fake `1.5%`.

- [ ] **Step 4: Style like screenshot**

Small circular info button at far right of composer bar, popover above it:

```css
.context-window-indicator {
  position: relative;
}

.context-window-indicator__button {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted-strong);
}

.context-window-indicator__popover {
  position: absolute;
  right: -10px;
  bottom: 34px;
  width: 322px;
  padding: 14px 18px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
}
```

- [ ] **Step 5: Test popover**

Click/hover info button and assert `CONTEXT WINDOW` and compaction copy are visible.

---

## Task 5: Improve Attachment Drop UX

**Files:**
- Modify: `apps/desktop/src/composer-surface.tsx`
- Modify: `apps/desktop/src/styles/main.css`
- Test: `apps/desktop/tests/core/composer-drag-drop.spec.ts`

- [ ] **Step 1: Upgrade drop overlay**

Replace the small inline indicator with a full composer overlay:

```tsx
{isDragActive ? (
  <div className="composer__drop-overlay" data-testid="composer-drop-indicator">
    <div className="composer__drop-card">
      <FileIcon />
      <strong>Drop files to attach</strong>
      <span>Images, screenshots, and project files are added to this message.</span>
    </div>
  </div>
) : null}
```

- [ ] **Step 2: Improve attachment chips**

Make images larger, file chips clearer, and remove button visible on hover/focus.

- [ ] **Step 3: Keep existing behavior**

Do not alter attachment data format or paste/drop handlers unless tests reveal a bug.

- [ ] **Step 4: Verify drag/drop**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/composer-drag-drop.spec.ts
```

Expected: PASS.

---

## Task 6: Final Verification and Commit

- [ ] **Step 1: Typecheck**

```bash
pnpm --filter @pi-gui/desktop typecheck
```

Expected: PASS.

- [ ] **Step 2: Targeted composer tests**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/composer-controls.spec.ts apps/desktop/tests/core/new-thread-composer.spec.ts apps/desktop/tests/core/composer-drag-drop.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Real Electron verification**

Start/reload desktop app and manually verify:

- existing thread composer layout
- new-thread composer layout
- model dropdown
- reasoning dropdown
- Build control
- Supervised tool-access dropdown
- context-window popover
- checkout selector remains subtle below composer
- drag image
- drag file
- paste image
- dark mode

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src apps/desktop/tests/core packages/session-driver/src packages/pi-sdk-driver/src
git commit -m "Redesign composer controls"
```

## Self-Review

- Spec coverage: includes model/reasoning controls, supervised/tool access, context-window popover, improved drag/drop attachments, and T3-like styling.
- Placeholder scan: no fake token usage; context window explicitly handles unavailable telemetry.
- Scope check: large but coherent composer-focused feature. Runtime tool access can be split into a second commit if it becomes too invasive.
- Type consistency: tool-access types are serializable and can be shared or duplicated in runtime-safe modules.

---

## Task 7: Restore GitHub Quick Actions Menu with Commit/Push/PR Dialogs

**Files:**
- Create/restore: `apps/desktop/src/git-quick-actions.tsx`
- Create: `apps/desktop/src/git-action-dialogs.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/icons.tsx`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/app-store-files.ts` or adjacent git helper module
- Modify: `apps/desktop/src/styles/main.css`
- Test: add/modify `apps/desktop/tests/core/git-quick-actions.spec.ts` or extend composer controls if no separate seam exists.

**Goal:** Add the T3-style GitHub actions button in the top/right thread header area with dropdown actions: `Commit`, `Push`, and `Create PR`, each opening polished dialogs rather than directly firing blind commands.

- [ ] **Step 1: Restore/recreate `GitQuickActions` trigger and menu**

Use the previous quick-actions component as a starting point, but update menu items to match the screenshot:

```tsx
export function GitQuickActions({ api, workspaceId, onCommit, onPush, onCreatePr }: GitQuickActionsProps) {
  return (
    <div className="git-quick-actions" data-testid="git-quick-actions">
      <button aria-label="GitHub actions" className="git-quick-actions__trigger" type="button">
        <GitHubIcon />
        <ChevronDownIcon />
      </button>
      <div className="git-quick-actions__menu">
        <button type="button" onClick={onCommit}><GitCommitIcon />Commit</button>
        <button type="button" onClick={onPush}><GitPushIcon />Push</button>
        <button type="button" onClick={onCreatePr}><GitHubIcon />Create PR</button>
      </div>
    </div>
  );
}
```

Keep the trigger compact beside VS Code / terminal-style top controls. Use click-outside and Escape behavior.

- [ ] **Step 2: Add icons**

Add if missing:

```tsx
export function GitHubIcon() { ... }
export function GitCommitIcon() { ... }
export function GitPushIcon() { ... }
export function ChevronDownIcon() { ... }
```

- [ ] **Step 3: Add Commit dialog**

`Commit` opens a modal/dialog:

Fields:
- title: `Commit changes`
- changed file summary
- commit message textarea
- optional checkbox: `Stage all changed files before committing`
- buttons: `Cancel`, `Commit`

Behavior:
- If checkbox enabled, call `stageAllFiles(workspaceId)` first.
- Then call new IPC `commitChanges(workspaceId, message)`.
- Disable commit when message is empty.
- Show success/failure inline or toast.

- [ ] **Step 4: Add Push dialog**

`Push` opens a confirmation dialog:

- title: `Push branch`
- body: current branch/remotes if available, otherwise generic copy
- buttons: `Cancel`, `Push`

Behavior:
- call new IPC `pushBranch(workspaceId)`.
- If git reports upstream missing, show the exact error and a follow-up button `Push with upstream` that calls `pushBranch(workspaceId, { setUpstream: true })` if implemented.

- [ ] **Step 5: Add Create PR dialog**

`Create PR` opens a dialog:

Fields:
- title input
- body textarea
- base branch input default `main`
- checkbox `Open in browser after creating`
- buttons: `Cancel`, `Create PR`

Behavior:
- Prefer GitHub CLI if available: `gh pr create --title ... --body ... --base ...`.
- If `gh` is unavailable, show a helpful error: `GitHub CLI is required to create PRs from Pi. Install gh or create the PR in GitHub.`
- If successful and a URL is returned, call `openExternal(url)` when checkbox enabled.

- [ ] **Step 6: Add narrow IPC methods**

In `ipc.ts` add:

```ts
commitChanges(workspaceId: string, message: string): Promise<void>;
pushBranch(workspaceId: string, options?: { readonly setUpstream?: boolean }): Promise<void>;
createPullRequest(workspaceId: string, input: { readonly title: string; readonly body: string; readonly base: string }): Promise<{ readonly url?: string }>;
```

Expose them in preload and handle them in main. Use narrow workspace-id-based handlers only; do not expose arbitrary shell execution.

- [ ] **Step 7: Implement Electron git helpers**

Use `execFile` with `cwd` set to the workspace path:

```ts
git add -A
git commit -m <message>
git push
gh pr create --title <title> --body <body> --base <base>
```

Return clean errors from stderr. Never delete files or run destructive git commands.

- [ ] **Step 8: Mount in the UI**

Place `GitQuickActions` in the thread chat header action row where the previous quick-action button lived, near VS Code / changes controls. It should only render for a selected workspace/thread. If the current workspace is not a git repo, keep the button but disable actions with explanatory text, or hide it; prefer disabled actions with explanation.

- [ ] **Step 9: Style like the screenshot**

Use compact dark/light menu styling:

```css
.git-quick-actions__trigger {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.git-quick-actions__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 126px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 18px 50px rgba(0,0,0,.24);
}
```

- [ ] **Step 10: Tests**

Add Playwright coverage:

- button is visible on thread view
- opening menu shows `Commit`, `Push`, `Create PR`
- `Commit` opens commit dialog and disables submit until message exists
- `Create PR` opens PR dialog

Avoid actually pushing/creating PRs in core tests; mock or assert dialog only unless test helpers have safe git remotes.

- [ ] **Step 11: Verify**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/git-quick-actions.spec.ts apps/desktop/tests/core/composer-controls.spec.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src apps/desktop/electron apps/desktop/tests/core
git commit -m "Restore GitHub quick actions"
```
