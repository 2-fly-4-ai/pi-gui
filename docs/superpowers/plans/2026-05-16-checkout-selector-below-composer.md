# Checkout Selector Below Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact T3 Code-style checkout selector below the chat composer that shows the current local checkout/branch and allows picking the local checkout or an existing Pi worktree.

**Architecture:** Introduce a focused `CheckoutSelector` renderer component that receives current workspace/worktree state and delegates selection to existing workspace-menu actions. Render it below the regular thread composer and new-thread composer without adding true git branch switching yet.

**Tech Stack:** React, TypeScript, existing `DesktopAppState` workspace/worktree records, Playwright Electron tests, CSS in `apps/desktop/src/styles/main.css`.

---

## File Structure

- Create `apps/desktop/src/checkout-selector.tsx`: compact checkout/ref selector with searchable popover.
- Modify `apps/desktop/src/composer-panel.tsx`: accept optional `checkoutSelector` slot and render below `ComposerSurface`.
- Modify `apps/desktop/src/new-thread-view.tsx`: accept optional `checkoutSelector` slot and render below new-thread `ComposerSurface`.
- Modify `apps/desktop/src/App.tsx`: build selector models for active thread and new-thread surfaces using existing `selectedWorkspace`, `rootWorkspace`, `activeWorktrees`, `workspaces`, and `wsMenu.selectWorkspace`.
- Modify `apps/desktop/src/styles/main.css`: T3-like dark compact row, popover, search input, current label, light/dark styles.
- Modify tests in `apps/desktop/tests/core/composer-controls.spec.ts` and `apps/desktop/tests/core/new-thread-composer.spec.ts`: cover visibility and popover behavior.

## Task 1: Add CheckoutSelector component

**Files:**
- Create: `apps/desktop/src/checkout-selector.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useMemo, useRef, useState } from "react";

export interface CheckoutSelectorOption {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly current: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

interface CheckoutSelectorProps {
  readonly label: string;
  readonly currentRef: string;
  readonly options: readonly CheckoutSelectorOption[];
}

export function CheckoutSelector({ label, currentRef, options }: CheckoutSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(normalized));
  }, [options, query]);

  return (
    <div className="checkout-selector" ref={rootRef}>
      <div className="checkout-selector__bar">
        <span className="checkout-selector__label">{label}</span>
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className="checkout-selector__button"
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span>{currentRef}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      {open ? (
        <div className="checkout-selector__popover" role="listbox" aria-label="Checkout refs">
          <input
            className="checkout-selector__search"
            placeholder="Search refs…"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
          <div className="checkout-selector__options">
            {filteredOptions.map((option) => (
              <button
                className={`checkout-selector__option ${option.current ? "checkout-selector__option--current" : ""}`}
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.current}
                disabled={option.disabled}
                onClick={() => {
                  option.onSelect();
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.current ? <span className="checkout-selector__current">current</span> : null}
                {option.detail ? <span className="checkout-selector__detail">{option.detail}</span> : null}
              </button>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="checkout-selector__empty">No refs found</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck and expect import-only errors if component is unused**

Run: `pnpm --filter @pi-gui/desktop typecheck`
Expected: PASS if noUnusedLocals is off; otherwise continue to Task 2 before rerunning.

## Task 2: Render selector below both composer surfaces

**Files:**
- Modify: `apps/desktop/src/composer-panel.tsx`
- Modify: `apps/desktop/src/new-thread-view.tsx`

- [ ] **Step 1: Add optional slot to `ComposerPanelProps`**

Add `import type { ReactNode } from "react";` to the existing React import and add:

```ts
readonly checkoutSelector?: ReactNode;
```

Render immediately after `</ComposerSurface>` inside `.conversation--composer`:

```tsx
{checkoutSelector}
```

- [ ] **Step 2: Add optional slot to `NewThreadView` props**

Add `ReactNode` to the React import, add prop:

```ts
readonly checkoutSelector?: ReactNode;
```

Destructure it and render immediately after `</ComposerSurface>` inside `.conversation--composer`:

```tsx
{checkoutSelector}
```

## Task 3: Wire App state into the selector

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Import selector**

```ts
import { CheckoutSelector, type CheckoutSelectorOption } from "./checkout-selector";
```

- [ ] **Step 2: Build `createCheckoutSelector` helper inside `App` before return**

```tsx
const createCheckoutSelector = (workspace: WorkspaceRecord | undefined) => {
  const root = workspace ? snapshot.workspaces.find((entry) => entry.id === (workspace.rootWorkspaceId ?? workspace.id)) : undefined;
  if (!workspace || !root) return undefined;
  const worktrees = snapshot.worktreesByWorkspace[root.id] ?? [];
  const currentRef = workspace.kind === "worktree" ? selectedWorktree?.branchName ?? selectedWorktree?.name ?? workspace.branchName ?? "worktree" : workspace.branchName ?? "main";
  const options: CheckoutSelectorOption[] = [
    {
      id: root.id,
      label: root.branchName ?? "main",
      detail: "Local checkout",
      current: workspace.id === root.id,
      onSelect: () => wsMenu.selectWorkspace(root.id),
    },
    ...worktrees.map((worktree) => {
      const linkedWorkspace = snapshot.workspaces.find((entry) => entry.id === worktree.linkedWorkspaceId);
      return {
        id: worktree.id,
        label: worktree.branchName ?? worktree.name,
        detail: worktree.name,
        current: linkedWorkspace?.id === workspace.id,
        disabled: !linkedWorkspace || worktree.status !== "ready",
        onSelect: () => {
          if (linkedWorkspace && worktree.status === "ready") wsMenu.selectWorkspace(linkedWorkspace.id);
        },
      };
    }),
  ];
  return <CheckoutSelector label="Local checkout" currentRef={currentRef} options={options} />;
};
```

- [ ] **Step 3: Pass slots**

For `NewThreadView`, pass:

```tsx
checkoutSelector={createCheckoutSelector(newThreadWorkspace)}
```

For `ComposerPanel`, pass:

```tsx
checkoutSelector={createCheckoutSelector(selectedWorkspace)}
```

## Task 4: Style like T3 Code screenshot

**Files:**
- Modify: `apps/desktop/src/styles/main.css`

- [ ] **Step 1: Add selector CSS near composer styles**

```css
.checkout-selector {
  position: relative;
  width: 100%;
  margin-top: 6px;
}

.checkout-selector__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
  padding: 0 8px 0 10px;
  border-radius: 0 0 10px 10px;
  background: rgba(248, 250, 252, 0.92);
  color: var(--muted-soft);
  font-size: 12px;
}

.checkout-selector__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-strong);
  font-size: 12px;
}

.checkout-selector__popover {
  position: absolute;
  right: 0;
  bottom: 34px;
  z-index: 35;
  width: min(320px, 100%);
  padding: 5px;
  border: 1px solid #d9e0ec;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 18px 50px rgba(22, 29, 41, 0.16);
}

.checkout-selector__search {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #4d7cff;
  border-radius: 8px;
  background: #fff;
  color: var(--text-strong);
  font: inherit;
  outline: none;
}

.checkout-selector__options {
  display: grid;
  gap: 2px;
  margin-top: 5px;
}

.checkout-selector__option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  color: var(--text-strong);
  text-align: left;
}

.checkout-selector__option:hover:not(:disabled) {
  background: #f4f6fb;
}

.checkout-selector__current,
.checkout-selector__detail,
.checkout-selector__empty {
  color: var(--muted-soft);
  font-size: 11px;
}
```

- [ ] **Step 2: Add dark mode overrides**

```css
:root.dark .checkout-selector__bar {
  background: rgba(24, 25, 27, 0.95);
}

:root.dark .checkout-selector__button,
:root.dark .checkout-selector__popover,
:root.dark .checkout-selector__search {
  border-color: var(--line);
  background: var(--surface);
  color: var(--text-strong);
}

:root.dark .checkout-selector__option:hover:not(:disabled) {
  background: var(--surface-muted);
}
```

## Task 5: Add focused Playwright coverage

**Files:**
- Modify: `apps/desktop/tests/core/composer-controls.spec.ts`
- Modify: `apps/desktop/tests/core/new-thread-composer.spec.ts`

- [ ] **Step 1: Thread composer test assertions**

In `composer-controls.spec.ts`, after selecting the session, assert:

```ts
await expect(window.locator(".checkout-selector__bar")).toContainText("Local checkout");
await window.locator(".checkout-selector__button").click();
await expect(window.locator(".checkout-selector__popover")).toBeVisible();
await expect(window.locator(".checkout-selector__search")).toBeFocused();
await expect(window.locator(".checkout-selector__option")).toContainText("current");
await window.locator(".checkout-selector__search").fill("missing-ref");
await expect(window.locator(".checkout-selector__empty")).toHaveText("No refs found");
await window.keyboard.press("Escape");
await expect(window.locator(".checkout-selector__popover")).toHaveCount(0);
```

- [ ] **Step 2: New thread test assertions**

In `new-thread-composer.spec.ts`, after opening new thread, assert:

```ts
await expect(window.locator(".new-thread .checkout-selector__bar")).toContainText("Local checkout");
await window.locator(".new-thread .checkout-selector__button").click();
await expect(window.locator(".new-thread .checkout-selector__popover")).toBeVisible();
```

## Task 6: Verify and commit

**Files:**
- All modified files above

- [ ] **Step 1: Run typecheck**

Run: `pnpm --filter @pi-gui/desktop typecheck`
Expected: PASS.

- [ ] **Step 2: Run targeted composer tests**

Run: `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/composer-controls.spec.ts apps/desktop/tests/core/new-thread-composer.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/checkout-selector.tsx apps/desktop/src/composer-panel.tsx apps/desktop/src/new-thread-view.tsx apps/desktop/src/App.tsx apps/desktop/src/styles/main.css apps/desktop/tests/core/composer-controls.spec.ts apps/desktop/tests/core/new-thread-composer.spec.ts
git commit -m "Add checkout selector below composer"
```

## Self-Review

- Spec coverage: covers T3-style below-composer placement, compact current checkout display, searchable popover, current marker, local/worktree options, and no true branch switching in v1.
- Placeholder scan: no TODO/TBD placeholders.
- Type consistency: `CheckoutSelectorOption`, `checkoutSelector`, and existing workspace/worktree type names are consistent.
