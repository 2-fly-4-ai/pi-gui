# Display Mode Plan

## Goal

Add a new **Display Mode** surface to Pi GUI: a fullscreen/command-center view for monitoring and controlling multiple active threads at once.

The key product principle: **reuse the existing chat/thread/composer/terminal pieces wherever possible**. Do not create parallel chat systems or one-off controls unless there is no reusable piece yet.

## Navigation

- Add a sidebar nav item named **Display Mode**.
- Place it under **Threads** and above **Skills**.
- It should switch the main app surface into Display Mode.
- Threads remains the normal single-thread chat view.
- Display Mode becomes the multi-thread command center.

## Layout

Display Mode should feel like a fullscreen mission-control dashboard:

- Main area: dynamic tile layout for currently active/running threads.
- Right side: persistent drawer for preview/logs/files.
- Top controls: filters and global controls.

Initial visual structure:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pi GUI   Display Mode                         [All] [Running] [Waiting] [Error]   [Pause All] │
├───────────────┬──────────────────────────────────────────────────────────────┬───────────────┤
│ Sidebar       │ Running Threads                                             │ Preview Drawer│
│               │                                                              │ Preview Logs  │
│ Threads       │ ┌──────────────────────────────┐ ┌───────────────────────┐ │ Files         │
│ Display Mode  │ │ ● Running Project Web        │ │ ● Idle API cleanup    │ │               │
│ Skills        │ │ Step 3 / 7                    │ │ compact mode          │ │ Browser frame │
│ Extensions    │ │ Chat preview                  │ │ +2 files              │ │ localhost     │
│ Settings      │ │ Diff preview                  │ │ [Expand] [Code]       │ │               │
│               │ │ Terminal preview              │ └───────────────────────┘ │               │
│ THREADS       │ │ Inline reply composer          │                           │               │
│ ...           │ │ [Send] [Open] [Terminal][Code] │                           │               │
│               │ └──────────────────────────────┘                           │               │
└───────────────┴──────────────────────────────────────────────────────────────┴───────────────┘
```

## Tile Layout

Use a dynamic/masonry-style layout instead of a fixed 2-column grid.

Behavior:

- Active/streaming threads can occupy larger tiles.
- Quiet threads can be compact.
- Each tile should have compact/expanded mode.
- Tiles should eventually be drag-reorderable so users can arrange by priority.

MVP can start with a responsive CSS grid, but structure the component so masonry/reordering can be added cleanly.

## Thread Tile Contents

Each thread tile should include:

- Status ring:
  - green = running
  - amber = waiting for input
  - red = error
  - grey = idle
- Workspace/project name.
- Thread title.
- Updated/running time.
- Progress indicator if available or inferable.
- Existing chat/timeline preview using the current transcript rendering pieces.
- Diff preview:
  - changed files
  - added/removed counts where possible
  - file status
- Terminal preview or terminal action.
- Inline reply composer.
- Actions:
  - Open Thread
  - Terminal
  - VS Code
  - Expand/Collapse

Important: reuse existing parts:

- Reuse `TimelineItem` / message markdown rendering for chat snippets.
- Reuse `ComposerSurface`/composer styling for inline reply where practical.
- Reuse `TerminalPanel` or terminal-service plumbing for terminal access.
- Reuse existing button/icon/button styles.
- Reuse existing diff data APIs and diff components where practical.

## Inline Reply Requirement

Display Mode must allow replying to a thread inline.

This is important because without inline replies the command-center view breaks as soon as a thread asks a question.

Behavior:

- Each expanded tile has a reply composer.
- Enter submits, Shift+Enter inserts newline, matching current composer behavior where possible.
- If a thread is running, submitted text should follow existing queue/steer semantics.
- Avoid inventing a separate composer model if existing session composer APIs can be generalized.

## Terminal Behavior

Each tile should be able to open terminal controls for that thread/workspace.

Preferred path:

- Reuse existing `TerminalPanel` and terminal-service root scoping.
- Add support for opening a terminal from a tile.
- Terminal may start as an expanded area inside the tile or a focused panel associated with the tile.

Terminal preview behavior:

- Auto-scroll by default.
- Click/focus should pause auto-scroll so users can read output.
- Provide a resume/follow output affordance later.

## Right Drawer

The right drawer should be multi-tab from the start:

- Preview
- Logs
- Files

Even if Logs and Files are placeholders initially, the pattern should be anchored now.

### Preview Tab

Preview should support:

- URL input, e.g. localhost port.
- Desktop/mobile device frame toggle.
- Open external browser button.
- Pin preview to a specific thread/tile.
- If pinned, associate the preview with that thread’s likely localhost/server output when possible.

### Logs Tab

Initial placeholder is acceptable.
Future behavior:

- Aggregated run logs.
- Terminal/activity logs.
- Filter by thread.

### Files Tab

Initial placeholder is acceptable.
Future behavior:

- Changed files for selected/pinned thread.
- File list and quick diff preview.

## Global Controls

Top-level Display Mode controls:

- Filter bar:
  - All
  - Running
  - Waiting
  - Error
- Pause All button.
- Eventually keyboard shortcuts for tile actions:
  - `T` terminal
  - `V` VS Code
  - `O` open thread

## VS Code Action

Each tile should have a button to open the project in VS Code.

Implementation options:

- Prefer a direct `code <workspace path>` launch if available.
- If not available, fall back gracefully and/or show an error.
- Keep renderer/main boundary tight: renderer asks main process to open VS Code; renderer should not get broad Node access.

## Data/API Needs

Current app mostly centers around the selected thread. Display Mode needs multi-thread data.

Likely additions:

- API to fetch Display Mode thread records:
  - workspace
  - session
  - transcript preview/full cached transcript
- API to submit composer text to a specific session, not only selected session.
- API to cancel a specific session run, not only selected session.
- API to open workspace in VS Code.
- Possibly session event subscription already updates global state; use it where possible.

Keep the backend thin over existing session-driver/pi-sdk-driver behavior.

## First Implementation Slice

MVP should be useful but not overbuilt:

1. Add `display-mode` app view.
2. Add sidebar item.
3. Add Display Mode surface.
4. Show running threads as tiles; include idle/recent fallback if no threads are running.
5. Reuse existing timeline rendering for chat preview.
6. Add tile actions:
   - Open Thread
   - Terminal
   - VS Code
7. Add inline reply composer using existing composer styles/components where possible.
8. Add right drawer with Preview / Logs / Files tabs.
9. Add filter controls and Pause All placeholder/action if specific cancel-all API is not ready.

## Later Enhancements

- Masonry sizing based on activity.
- Drag-reorder tiles.
- Real progress model from agent/runtime events.
- Real preview pinning via detected localhost URLs.
- Embedded browser/webview if product direction approves it.
- Pause all / resume all semantics.
- More complete keyboard shortcuts.
- Per-tile terminal pause/follow output behavior.

## Open Questions

- Should Display Mode show only running threads, or running + recently active threads?
- Should fullscreen mean app-content fullscreen or actual Electron/macOS fullscreen?
- Should terminal live inside each tile, or open in a tile-associated larger panel?
- Should preview use Electron webview, iframe, or external browser first?

## Current Decision

Proceed with app-content Display Mode first. Keep the implementation incremental and reuse existing UI/components aggressively.
