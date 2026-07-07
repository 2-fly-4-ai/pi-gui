# Persistent VS Code Sidepanel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make embedded VS Code behave as one persistent, project-scoped sidepanel experience across Threads and Display Mode, without killing other project VS Code servers when switching projects.

**Architecture:** Keep a VS Code web server per workspace/folder in the Electron main process, keyed by workspace id plus folder path. Replace the duplicate Threads and Display Mode iframe implementations with one reusable renderer component and one shared visibility/selection model in `App.tsx`; closing the panel hides it, while an explicit hard-close IPC kills the current project server.

**Tech Stack:** Electron main/preload IPC, React 19 renderer, VS Code `serve-web`/`code-server`, Playwright Electron core tests, TypeScript.

---

## File Structure

- Modify: `apps/desktop/electron/vscode-server-manager.ts`
  - Responsibility: lifecycle of VS Code server child processes. Change from single-server global replacement to multi-server project persistence. Add `killVSCodeServer(workspaceId, folderPath?)`.
- Modify: `apps/desktop/src/ipc.ts`
  - Responsibility: renderer/main API contract. Add `killVSCodeServer(workspaceId, folderPath): Promise<void>`.
- Modify: `apps/desktop/electron/preload.ts`
  - Responsibility: expose the narrow hard-close IPC to the renderer.
- Modify: `apps/desktop/electron/main.ts`
  - Responsibility: wire hard-close IPC and keep app-quit cleanup killing all servers.
- Modify: `apps/desktop/src/vscode-panel.tsx`
  - Responsibility: become the single shared VS Code sidepanel body used by Threads and Display Mode. Add optional resize/action controls and hard-close callback support.
- Modify: `apps/desktop/src/display-mode-view.tsx`
  - Responsibility: remove duplicated VS Code boot/iframe logic and render the shared `VSCodePanel` inside the Display Mode side column.
- Modify: `apps/desktop/src/App.tsx`
  - Responsibility: single VS Code open/target state, project switching behavior, hard-close handler, Threads sidepanel integration.
- Modify: `apps/desktop/src/styles/main.css`
  - Responsibility: Threads sidepanel resize styling if shared component needs common classes.
- Modify: `apps/desktop/src/styles/display-mode.css` if present, otherwise Display Mode styles in current CSS files
  - Responsibility: keep Display Mode sidepanel sizing compatible with shared component.
- Modify: `apps/desktop/tests/core/display-mode.spec.ts`
  - Responsibility: regression coverage for persistent servers, shared sidepanel behavior, trust/theme defaults.
- Optional create: `apps/desktop/tests/core/vscode-panel.spec.ts`
  - Responsibility: focused regression test if adding the scenario to `display-mode.spec.ts` makes it too large.

## Behavioral Decisions Locked In

- Pressing VS Code while a workspace/thread is selected opens the sidepanel for that workspace.
- If the sidepanel is already open and the user selects another project/thread, the sidepanel remains open and retargets to the newly selected project.
- Retargeting does not kill the previous project's VS Code server.
- Pressing the visible close/toggle button hides the sidepanel only.
- Hard close is explicit and kills only the current sidepanel project's VS Code server.
- App quit still kills all VS Code server child processes.
- VS Code user data remains shared and stable under `vscode-serve-web/user-data`, so user theme/settings persist. Defaults are only inserted when missing.
- Workspace trust prompts stay disabled by default via existing settings.

---

### Task 1: Add hard-close IPC contract

**Files:**
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/electron/main.ts`

- [ ] **Step 1: Add IPC channel and renderer API type**

In `apps/desktop/src/ipc.ts`, add the channel immediately after `ensureVSCodeServer`:

```ts
  ensureVSCodeServer: "pi-gui:ensure-vscode-server",
  killVSCodeServer: "pi-gui:kill-vscode-server",
```

In the `PiDesktopApi` interface, add the method immediately after `ensureVSCodeServer(...)`:

```ts
  ensureVSCodeServer(workspaceId: string, folderPath: string): Promise<number>;
  killVSCodeServer(workspaceId: string, folderPath: string): Promise<void>;
```

- [ ] **Step 2: Expose the preload method**

In `apps/desktop/electron/preload.ts`, add immediately after `ensureVSCodeServer`:

```ts
  ensureVSCodeServer: (workspaceId: string, folderPath: string) =>
    ipcRenderer.invoke(desktopIpc.ensureVSCodeServer, workspaceId, folderPath) as Promise<number>,
  killVSCodeServer: (workspaceId: string, folderPath: string) =>
    ipcRenderer.invoke(desktopIpc.killVSCodeServer, workspaceId, folderPath) as Promise<void>,
```

- [ ] **Step 3: Wire main IPC handler**

In `apps/desktop/electron/main.ts`, change the import:

```ts
import { ensureVSCodeServer, killAllVSCodeServers, killVSCodeServer } from "./vscode-server-manager";
```

Then add the handler immediately after `ensureVSCodeServer`:

```ts
  ipcMain.handle(desktopIpc.ensureVSCodeServer, (_event, workspaceId: string, folderPath: string) =>
    ensureVSCodeServer(workspaceId, folderPath),
  );
  ipcMain.handle(desktopIpc.killVSCodeServer, (_event, workspaceId: string, folderPath: string) => {
    killVSCodeServer(workspaceId, folderPath);
  });
```

- [ ] **Step 4: Typecheck this contract**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: TypeScript succeeds, or only reports pre-existing unrelated errors. If it fails on `killVSCodeServer`, fix the exact import/export/API mismatch before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ipc.ts apps/desktop/electron/preload.ts apps/desktop/electron/main.ts
git commit -m "feat(desktop): add VS Code hard-close IPC"
```

---

### Task 2: Make VS Code servers persistent per workspace

**Files:**
- Modify: `apps/desktop/electron/vscode-server-manager.ts`

- [ ] **Step 1: Add a stable server key helper**

Add below `const preferredPort = 19538;`:

```ts
function getServerKey(workspaceId: string, folderPath: string): string {
  return `${workspaceId}:${path.resolve(folderPath)}`;
}
```

- [ ] **Step 2: Replace single-server reuse/kill logic in `ensureVSCodeServer`**

Replace the opening block of `ensureVSCodeServer` through `await waitForPortRelease(preferredPort, 2_000);` with:

```ts
export async function ensureVSCodeServer(workspaceId: string, folderPath: string): Promise<number> {
  const serverKey = getServerKey(workspaceId, folderPath);
  const existing = servers.get(serverKey);

  if (existing) {
    if (isProcessAlive(existing)) {
      try {
        await waitForVSCodeWebReady(existing.port, 10_000);
        return existing.port;
      } catch {
        stopServer(existing);
      }
    }
    servers.delete(serverKey);
  }

  if (await canListenOnPort(preferredPort)) {
    await waitForPortRelease(preferredPort, 2_000);
  }
```

This removes the old behavior that stopped every other server.

- [ ] **Step 3: Store entries by server key**

Replace:

```ts
  servers.set(workspaceId, { port, process: proc, workspaceId, folderPath });
```

with:

```ts
  servers.set(serverKey, { port, process: proc, workspaceId, folderPath });
```

- [ ] **Step 4: Delete dead entries when child process exits**

Immediately after `servers.set(...)`, add:

```ts
  proc.once("exit", () => {
    const current = servers.get(serverKey);
    if (current?.process === proc) {
      servers.delete(serverKey);
    }
  });
```

- [ ] **Step 5: Add single-server hard close export**

Add before `killAllVSCodeServers()`:

```ts
export function killVSCodeServer(workspaceId: string, folderPath: string): void {
  const serverKey = getServerKey(workspaceId, folderPath);
  const entry = servers.get(serverKey);
  if (!entry) {
    return;
  }
  stopServer(entry);
  servers.delete(serverKey);
}
```

- [ ] **Step 6: Preserve all-server cleanup on app quit**

Ensure `killAllVSCodeServers()` still reads:

```ts
export function killAllVSCodeServers(): void {
  for (const entry of servers.values()) {
    stopServer(entry);
  }
  servers.clear();
}
```

- [ ] **Step 7: Typecheck server manager**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/vscode-server-manager.ts
git commit -m "fix(desktop): keep VS Code servers alive per project"
```

---

### Task 3: Turn `VSCodePanel` into the shared sidepanel body

**Files:**
- Modify: `apps/desktop/src/vscode-panel.tsx`

- [ ] **Step 1: Extend props**

Replace the props interface with:

```ts
interface VSCodePanelProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly folderPath: string;
  readonly className?: string;
  readonly testId?: string;
  readonly title?: string;
  readonly onHardClose?: () => void;
}
```

- [ ] **Step 2: Update component signature and aside class/test id**

Replace:

```ts
export function VSCodePanel({ api, workspaceId, folderPath }: VSCodePanelProps) {
```

with:

```ts
export function VSCodePanel({
  api,
  workspaceId,
  folderPath,
  className = "thread-vscode-panel",
  testId = "thread-vscode-panel",
  title = "VS Code",
  onHardClose,
}: VSCodePanelProps) {
```

Replace the opening aside with:

```tsx
    <aside className={className} data-testid={testId}>
```

- [ ] **Step 3: Add optional action header**

Immediately inside the `<aside>` before loading/error/content branches, render:

```tsx
      {onHardClose ? (
        <div className="vscode-panel__header">
          <div className="vscode-panel__title">{title}</div>
          <button
            type="button"
            className="button button--ghost vscode-panel__hard-close"
            onClick={onHardClose}
          >
            Hard close
          </button>
        </div>
      ) : null}
```

Keep the existing loading/error/iframe branches after this header.

- [ ] **Step 4: Keep iframe reload scoped to workspace/folder changes**

Ensure the existing effect dependency remains:

```ts
  }, [api, workspaceId, folderPath]);
```

- [ ] **Step 5: Typecheck component**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/vscode-panel.tsx
git commit -m "refactor(desktop): share embedded VS Code panel component"
```

---

### Task 4: Replace Display Mode's duplicate VS Code implementation

**Files:**
- Modify: `apps/desktop/src/display-mode-view.tsx`

- [ ] **Step 1: Import shared panel**

Add near other imports:

```ts
import { VSCodePanel } from "./vscode-panel";
```

- [ ] **Step 2: Remove local VS Code loading state**

Delete these local state declarations if present:

```ts
  const [vsCodePort, setVsCodePort] = useState<number | null>(null);
  const [vsCodeLoading, setVsCodeLoading] = useState(false);
  const [vsCodeFrameLoaded, setVsCodeFrameLoaded] = useState(false);
  const [vsCodeError, setVsCodeError] = useState<string | null>(null);
```

- [ ] **Step 3: Remove duplicated boot effect**

Delete the effect headed by:

```ts
  // Boot VS Code server whenever the workspace changes
  useEffect(() => {
    if (!vsCodeOpen || !vsCodeWorkspaceId || !vsCodeFolderPath) return;
```

The shared `VSCodePanel` will boot/reuse the server.

- [ ] **Step 4: Replace Display Mode aside contents**

Replace the contents of:

```tsx
      <aside className={`display-mode-vscode${vsCodeOpen ? "" : " display-mode-vscode--hidden"}`}>
```

with:

```tsx
        {vsCodeOpen && vsCodeWorkspaceId && vsCodeFolderPath ? (
          <VSCodePanel
            api={api}
            workspaceId={vsCodeWorkspaceId}
            folderPath={vsCodeFolderPath}
            className="display-mode-vscode__panel"
            testId="display-mode-vscode-panel"
          />
        ) : (
          <div className="display-mode-vscode__loading">Open a workspace to start VS Code.</div>
        )}
```

The outer `display-mode-vscode` aside remains responsible for column sizing and hidden state.

- [ ] **Step 5: Typecheck Display Mode**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: PASS. If CSS selectors in tests look for `.display-mode-vscode__webview`, keep the iframe class unchanged in `VSCodePanel`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/display-mode-view.tsx
git commit -m "refactor(desktop): use shared VS Code panel in display mode"
```

---

### Task 5: Make Threads VS Code sidepanel resizable and persistent on project switch

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/main.css`

- [ ] **Step 1: Add Threads VS Code width state and refs**

Near existing VS Code state in `App.tsx`, add:

```ts
  const [threadVsCodeWidth, setThreadVsCodeWidth] = useState(() => {
    const saved = Number(localStorage.getItem("threads:vsCodeWidth"));
    return Number.isFinite(saved) && saved > 0 ? saved : 520;
  });
  const threadVsCodeWidthRef = useRef(threadVsCodeWidth);
```

Add effect:

```ts
  useEffect(() => {
    threadVsCodeWidthRef.current = threadVsCodeWidth;
    try { localStorage.setItem("threads:vsCodeWidth", String(threadVsCodeWidth)); } catch {}
  }, [threadVsCodeWidth]);
```

- [ ] **Step 2: Add resize handler**

Add near other callbacks:

```ts
  const startThreadVsCodeResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = threadVsCodeWidthRef.current;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.max(360, Math.min(900, startWidth + delta));
      threadVsCodeWidthRef.current = nextWidth;
      setThreadVsCodeWidth(nextWidth);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setThreadVsCodeWidth(threadVsCodeWidthRef.current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);
```

- [ ] **Step 3: Retarget visible sidepanel when selected project changes**

Add an effect after `selectedWorkspace` is defined:

```ts
  useEffect(() => {
    if (!vsCodeOpen || !selectedWorkspace || snapshot?.activeView !== "threads") {
      return;
    }
    setVsCodeWorkspaceId(selectedWorkspace.id);
    setVsCodeFolderPath(selectedWorkspace.path);
  }, [selectedWorkspace?.id, selectedWorkspace?.path, snapshot?.activeView, vsCodeOpen]);
```

This keeps the sidepanel open when switching projects and points it at the new selected workspace.

- [ ] **Step 4: Add hard close handler**

Add near `openVsCodeForWorkspace`:

```ts
  const hardCloseCurrentVsCode = useCallback(() => {
    if (!api || !vsCodeWorkspaceId || !vsCodeFolderPath) return;
    void api.killVSCodeServer(vsCodeWorkspaceId, vsCodeFolderPath).finally(() => {
      setVsCodeOpen(false);
      setVsCodeWorkspaceId(null);
      setVsCodeFolderPath(null);
    });
  }, [api, vsCodeFolderPath, vsCodeWorkspaceId]);
```

- [ ] **Step 5: Render resize handle before Threads panel**

Replace the Threads VS Code render block with:

```tsx
        {showThreadVsCodePanel && vsCodeWorkspaceId && vsCodeFolderPath ? (
          <>
            <div
              className="thread-vscode-resize-handle"
              role="separator"
              aria-label="Resize VS Code panel"
              onPointerDown={startThreadVsCodeResize}
            />
            <VSCodePanel
              api={api}
              workspaceId={vsCodeWorkspaceId}
              folderPath={vsCodeFolderPath}
              onHardClose={hardCloseCurrentVsCode}
              title="VS Code"
            />
          </>
        ) : null}
```

Set the main CSS variable on `<main>` if not already present:

```tsx
      <main
        className={mainClassName}
        style={{ "--thread-vscode-width": `${threadVsCodeWidth}px` } as React.CSSProperties}
      >
```

If `main` already has a `style` prop, merge this property into the existing object.

- [ ] **Step 6: Add CSS for Threads resize**

In `apps/desktop/src/styles/main.css`, update the VS Code grid width rules to use the variable:

```css
.main--with-vscode {
  grid-template-columns: minmax(0, 1fr) 5px var(--thread-vscode-width, 520px);
}
```

Add handle/header styles:

```css
.thread-vscode-resize-handle {
  grid-column: 2;
  cursor: col-resize;
  background: transparent;
}

.thread-vscode-resize-handle:hover {
  background: color-mix(in srgb, var(--accent, #7c3aed) 25%, transparent);
}

.vscode-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.2));
}

.vscode-panel__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
}

.vscode-panel__hard-close {
  font-size: 12px;
}
```

Ensure `.main--with-vscode > .thread-vscode-panel` uses `grid-column: 3;` so the handle sits in column 2.

- [ ] **Step 7: Typecheck renderer**

Run:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/styles/main.css
git commit -m "feat(desktop): keep thread VS Code sidepanel open across projects"
```

---

### Task 6: Add Playwright regression coverage

**Files:**
- Modify: `apps/desktop/tests/core/display-mode.spec.ts`

- [ ] **Step 1: Add a server persistence assertion to the existing VS Code test**

In the existing test that opens VS Code, create a second workspace using the existing helper pattern in this file. Use two temp folders with `README.md` files containing distinct text:

```ts
await writeFile(join(workspacePath, "README.md"), "first workspace readme");
const secondWorkspacePath = join(tmpDir, "second-workspace");
await mkdir(secondWorkspacePath, { recursive: true });
await writeFile(join(secondWorkspacePath, "README.md"), "second workspace readme");
await window.evaluate((workspacePath) => window.piApp?.addWorkspacePath(workspacePath), secondWorkspacePath);
```

- [ ] **Step 2: Verify switching projects does not close the sidepanel**

After opening Threads VS Code for the first workspace, select the second workspace using the visible sidebar/workspace control already used in this spec. Then assert:

```ts
await expect(window.getByTestId("thread-vscode-panel")).toBeVisible();
const secondFrame = window.frameLocator(".thread-vscode-panel .display-mode-vscode__webview");
await expect(secondFrame.getByText("second workspace readme")).toBeVisible({ timeout: 45_000 });
```

- [ ] **Step 3: Verify returning to first project reuses first server**

Select the first workspace again and assert:

```ts
await expect(window.getByTestId("thread-vscode-panel")).toBeVisible();
const firstFrameAgain = window.frameLocator(".thread-vscode-panel .display-mode-vscode__webview");
await expect(firstFrameAgain.getByText("first workspace readme")).toBeVisible({ timeout: 45_000 });
```

- [ ] **Step 4: Verify Display Mode uses shared panel**

Update the Display Mode assertion from `.display-mode-vscode__webview` to still pass with the shared component:

```ts
await expect(window.locator(".display-mode-vscode .display-mode-vscode__webview")).toHaveAttribute("title", "VS Code");
```

- [ ] **Step 5: Verify trust/theme defaults still persist**

Keep the existing assertions:

```ts
expect(settings["security.workspace.trust.enabled"]).toBe(false);
expect(settings["workbench.colorTheme"]).toBe("Default Dark Modern");
await expect(displayVsCodeFrame.getByText("Do you trust the authors")).toHaveCount(0);
```

- [ ] **Step 6: Run targeted spec**

Run:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/display-mode.spec.ts
```

Expected: PASS. The test exercises the Electron renderer surface, opens embedded VS Code, switches workspaces, and confirms the panel remains visible.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/tests/core/display-mode.spec.ts
git commit -m "test(desktop): cover persistent embedded VS Code panels"
```

---

### Task 7: Final verification and simplification pass

**Files:**
- Potentially modify touched files only if simplification finds local complexity.

- [ ] **Step 1: Run typecheck**

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run targeted core spec**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/display-mode.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run full core lane**

```bash
pnpm --filter @pi-gui/desktop run test:e2e:core
```

Expected: PASS.

- [ ] **Step 4: Real Electron surface smoke**

Run:

```bash
pnpm --filter @pi-gui/desktop run dev
```

Manual smoke in the real Electron window:

1. Open project A.
2. Click VS Code on Threads.
3. Open a terminal/editor inside VS Code.
4. Switch to project B while panel is open.
5. Confirm panel remains open and shows project B.
6. Switch back to project A.
7. Confirm project A's VS Code returns without a full server restart.
8. Change VS Code theme.
9. Hide panel, reopen, and confirm theme remains.
10. Click Hard close and confirm panel hides.
11. Reopen VS Code and confirm it starts cleanly.

- [ ] **Step 5: Simplify local code**

Review only touched files for avoidable duplication:

```bash
git diff -- apps/desktop/electron/vscode-server-manager.ts apps/desktop/src/App.tsx apps/desktop/src/display-mode-view.tsx apps/desktop/src/vscode-panel.tsx
```

Acceptable final shape:

- one server lifecycle implementation,
- one iframe/loading/error component,
- one explicit hard-close path,
- no Display Mode duplicate boot effect.

- [ ] **Step 6: Commit simplification if any code changed**

```bash
git add apps/desktop/electron/vscode-server-manager.ts apps/desktop/src/App.tsx apps/desktop/src/display-mode-view.tsx apps/desktop/src/vscode-panel.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/display-mode.spec.ts
git commit -m "refactor(desktop): simplify persistent VS Code sidepanel"
```

Only run this commit if Step 5 produced changes.

---

## Self-Review

- Spec coverage: persistent per-project servers are covered by Task 2; unified Threads/Display Mode panel by Tasks 3-5; hide vs hard-close by Tasks 1 and 5; trust/theme persistence by Tasks 2 and 6; real Electron proof by Task 7.
- Placeholder scan: no TBD/TODO/later placeholders remain. Each task lists exact files, commands, expected result, and concrete code snippets.
- Type consistency: IPC name is consistently `killVSCodeServer`; renderer API signature is `killVSCodeServer(workspaceId: string, folderPath: string): Promise<void>`; server manager export is `killVSCodeServer(workspaceId: string, folderPath: string): void`.
