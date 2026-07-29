# Display Mode Performance — Bounded Projection And Viewport Residency

Status: complete
Created: 2026-07-27
Owner: desktop renderer + Electron main

## Goal

Make Display Mode remain responsive as session count and transcript history grow without changing runtime execution,
losing drafts or attachments, weakening composer parity, or breaking focus, terminals, drag-and-drop, filtering, and
accessibility.

Display Mode must become a bounded, incrementally maintained view of all threads. Full transcript and interactive UI
machinery must exist only where it is required.

## Why This Work Exists

The current Display Mode path scales with total history instead of visible work:

- `DisplayModeView` calls `getDisplayModeThreads()` on entry and after every state-patch burst.
- `getDisplayModeThreads()` resolves every non-archived session, reads persisted full transcripts into the main-process
  transcript cache, scans those transcripts for subagents, and returns recent transcript rows for every card.
- The Display Mode read path also calls subagent audit replay/reconciliation/artifact discovery through
  `listSubagentRunsForDisplayMode`.
- Every detailed card mounts transcript rendering and the complete composer control stack.
- Every card calls `getChangedFiles()` on mount and session timestamp changes, even if the card is not pinned and cannot
  consume the result.
- Display Mode drafts and attachments are component-local, so naive virtualization would discard unsent work.
- Compact cards hide expensive UI but still initialize most detailed-card hooks.
- `detectedUrls` scans all loaded card transcripts.
- Sortable drag currently assumes every card exists as a DOM droppable.

This is a product scalability and correctness project, not cosmetic optimization.

## Non-Negotiable Invariants

1. UI residency never starts, stops, pauses, cancels, disconnects, or resubscribes a provider/runtime session.
2. Running, waiting, failed, unseen, and completed metadata remains current while a card is offscreen.
3. A draft or attachment must survive scrolling, filtering, layout changes, leaving Display Mode, opening the normal
   thread, and Electron restart.
4. Display Mode and the normal thread share the same effective per-session draft/attachment state.
5. Focused elements, open menus, rename inputs, attachment processing, expanded cards, drag operations, and open
   terminals cannot be unmounted unexpectedly.
6. Opening a cold card or thread is a single user action; hydration must not require a second click.
7. Filters, counts, sorting, pinning, preview, VS Code, terminal, compact/detailed mode, and Pause all remain correct.
8. Keyboard navigation and reordering remain available and announced accessibly.
9. Projection payloads are bounded by both row count and serialized size. One huge tool result cannot defeat limits.
10. Read/query IPC is pure: it cannot replay audits, reconcile runs, scan workspaces, run Git, or mutate session state.
11. Legacy persisted transcripts remain readable. Migration is lazy, throttled, and non-destructive.
12. Renderer and main caches are bounded and cannot evict state required by selected or running sessions.

## State Model

“Dormant” is not a single state. Four independent dimensions are required:

### Runtime liveness

Owned by the session driver and existing store. It is never controlled by Display Mode visibility.

### Metadata residency

Title, workspace, status, timestamps, unseen state, preview, config summary, and runtime summary remain available for
every session. Initial Display Mode ordering and filters should use the existing workspace/session state already in the
renderer rather than duplicating a second full list transport.

### Projection hydration

A purpose-built, bounded Display Mode projection contains only dashboard-safe excerpt rows and activity summaries.
Projection hydration is independent of full transcript hydration.

### Render residency

Only visible rows, overscan rows, and interaction-pinned cards mount detailed DOM and heavy hooks.

## Data Contracts

### DisplayModeThreadProjection

The projection must not reuse an unrestricted full `TranscriptMessage[]` contract.

Required fields:

- `{ workspaceId, sessionId }`
- monotonic `revision`
- `excerptRows`: dashboard-safe timeline rows
- `subagentActivity`
- optional discovered local preview URLs from the bounded excerpt
- `truncated`: whether content was clipped
- `serializedBytes`

Bounds:

- Maximum display rows: start at 8 and validate visually.
- Maximum serialized projection: 96 KiB.
- Individual message/tool text is clipped with an explicit truncation marker.
- Tool rows retain stable id, name, label, status, timing, and short summary; large input/output bodies are omitted.
- Attachments retain presentation metadata only, never file contents.

### IPC

Add narrow typed APIs/events:

- `getDisplayModeThreadProjection(target, knownRevision?)`
- `onDisplayModeProjectionChanged(listener)`
- optional test-only diagnostics through the existing safe test diagnostics surface

Responses:

- `{ kind: "projection", projection }`
- `{ kind: "not-modified", revision }`
- `{ kind: "not-found" }`

Events identify one `{ workspaceId, sessionId, revision }`. They do not resend all threads.

### Persistence

Persist projections in an Electron-user-data sidecar store keyed by session key.

- Projection writes are coalesced with transcript persistence.
- Existing transcript/event processing updates the in-memory projection incrementally.
- On restart, Display Mode reads the sidecar without loading the full transcript.
- If a sidecar is absent or stale, hydrate only a requested/visible legacy session.
- Legacy fallback parsing uses bounded concurrency of two.
- After building a legacy sidecar, discard the parsed transcript unless it was already full-transcript resident for
  selected/runtime reasons.

## Renderer Architecture

### Summary source

Derive all thread shells, filters, counts, and ordering from the existing `snapshot.workspaces` session summaries.
Do not issue a separate all-thread request.

### Components

- `DisplayModeCardShell`: sortable identity, header, title/status/time, actions, preview.
- `DisplayModeCardExcerpt`: projection hydration and bounded timeline excerpt.
- `DisplayModeCardComposer`: composer-only hooks and controls.
- `DisplayModeCardTerminal`: terminal lifecycle.
- `DisplayModeDetailedCard`: composes the above only while render-resident.
- `DisplayModeCompactCard`: shell only; it must not call detailed hooks.

### Keyed interaction ownership

Use main-owned existing per-session composer draft state and targeted attachment persistence.

- Extend narrow APIs for reading/updating a target session’s draft and attachments without selecting it.
- Persist updates with the existing coalesced draft/attachment mechanisms.
- The normal thread and Display Mode observe the same keyed state.
- Submission atomically clears the submitted target draft/attachments only after the main process accepts the send.
- A failed submit retains/restores the exact draft and attachments.
- Projection/cache eviction never touches interaction state.

### Row residency

Virtualize by fixed-height rows after resolving the active column count.

- Render visible rows plus two rows of overscan above and below.
- Preserve total scroll height with row spacers.
- Recompute row grouping on container-width/column changes without losing anchored scroll position.
- Compact rows use their own measured/estimated height and remain virtualized for large collections.
- Prefetch projections for overscan rows; visible rows should normally arrive already hydrated.
- Cancel or ignore stale projection requests using request generation plus projection revision.

Interaction pins override normal residency:

- focused card
- non-empty draft
- attachments or attachment processing
- open action/model/reasoning/skills/access/context menu
- rename mode
- expanded card
- active drag source/target
- open terminal

### Drag-and-drop

- Keep the complete ordered identity list in state.
- Use lightweight positional row placeholders for the full collection.
- During drag, materialize lightweight shell droppables or compute the target index from row/column geometry.
- Never materialize transcript/composer internals merely for dragging.
- Preserve pointer and keyboard drag.
- Use a drag overlay.
- Announce movement and final position.
- Keep the dragged/focused row resident until completion/cancel.

### Expensive workspace work

- Move changed-files loading out of cards.
- Request it once for the pinned workspace only when the Files drawer is visible.
- Deduplicate in-flight requests and refresh from explicit/file-change signals.
- Derive preview URLs from the pinned projection or a dedicated bounded discovery source.

## Cache Policy

Use separate caches:

1. Full transcript cache: existing runtime/selected-session needs only; Display Mode projection reads must not add entries.
2. Main projection cache: small persisted records keyed by session.
3. Renderer projection cache: weighted LRU bounded by serialized bytes, not record count.
4. Interaction state: durable and never evicted as a performance cache.

Initial renderer projection budget: 12 MiB. Validate with the large fixture and adjust from evidence.

## Instrumentation

Add counters that can be asserted without flaky wall-clock thresholds:

- Display Mode full-transcript reads
- legacy projection builds
- projection sidecar reads/writes
- projection request count, hit/miss/not-modified count, and returned bytes
- stale/cancelled renderer projection responses
- mounted card shells
- mounted detailed cards
- mounted composers
- mounted transcript excerpts
- Git changed-files invocations
- whole-collection Display Mode refreshes (target: removed)
- per-thread projection events
- estimated main full-transcript cache bytes/count
- estimated renderer projection cache bytes/count

Optional local timing diagnostics:

- first usable Display Mode
- projection hydration p50/p95
- scroll-frame and long-task samples through existing renderer diagnostics

## Scaling Fixture

Add a deterministic core Electron fixture that creates:

- 200 sessions across at least three workspaces
- mixed running/waiting/failed/idle/unseen metadata
- bounded normal transcripts
- several oversized assistant/tool rows
- legacy sessions without projection sidecars
- drafts and attachments in offscreen sessions
- subagent/workflow states

The fixture must avoid paid/provider execution and should use existing test-driver/session event helpers.

## Phased Checklist

### P0 — Baseline and plan

- [x] Record current architecture and invariants in this plan.
- [x] Add this plan to `plans/active/README.md`.
- [x] Capture current request/mount/Git/transcript-read behavior with deterministic diagnostics.
- [x] Add the 200-thread fixture without changing production behavior.

### P1 — Remove pathological repeated work

- [x] Guard/remove per-card `getChangedFiles()` calls.
- [x] Centralize pinned Files drawer loading and in-flight deduplication.
- [x] Stop scanning all card transcripts for detected URLs.
- [x] Remove all-thread refresh scheduling from generic state patches.
- [x] Remove audit replay/reconcile/artifact scanning from Display Mode query paths.
- [x] Add regression assertions for zero Git calls on initial Display Mode load.

### P2 — Bounded projection

- [x] Define bounded projection types and pure projection builder.
- [x] Add byte/row clipping unit tests including oversized tool/message records.
- [x] Add sidecar store and lazy legacy migration.
- [x] Ensure projection reads never mark `loadedTranscriptKeys`.
- [x] Update projections from transcript/session/subagent events.
- [x] Add narrow typed preload/main IPC and per-thread change events.
- [x] Remove `getDisplayModeThreads()` and its full-list record contract.
- [x] Add diagnostics and persistence/restart tests.

### P3 — Durable keyed interaction state

- [x] Add targeted draft/attachment read/update/remove APIs.
- [x] Bind Display Mode composers to main-owned per-session state.
- [x] Make successful submission clearing atomic and failed submission restorative.
- [x] Prove parity when opening the normal thread.
- [x] Prove survival across filter/layout/navigation/restart.

### P4 — Component isolation

- [x] Split shell, excerpt, composer, and terminal components.
- [x] Ensure compact cards mount no detailed hooks.
- [x] Memoize shells and detailed subtrees with stable entity props/callbacks.
- [x] Normalize projection cache updates so one thread changes one subscribed card.
- [x] Add mount-count diagnostics and tests.

### P5 — Viewport residency

- [x] Implement row grouping from resolved columns.
- [x] Add row virtualization with two-row overscan.
- [x] Add projection prefetch/cancellation/stale revision handling.
- [x] Preserve scroll anchor across responsive column changes.
- [x] Implement interaction residency pins.
- [x] Prove focused/draft/attachment/menu/expanded cards are never discarded.

### P6 — Drag, terminal, accessibility, and remaining measured costs

- [x] Adapt pointer drag for virtual rows.
- [x] Preserve keyboard drag and accessible announcements.
- [x] Preserve terminal sessions across offscreen transitions.
- [x] Re-run filtering, ordering, compact/detailed, expanded, preview, VS Code, Pause all, and composer parity.
- [x] Measure broad workspace patch serialization/rerender cost.
- [x] Split/normalize the workspace/session state domain only if evidence shows it remains material.

### P7 — Verification and completion audit

- [x] `git diff --check`
- [x] desktop typecheck
- [x] unit tests
- [x] targeted Display Mode core Electron spec
- [x] deterministic 200-thread performance spec
- [x] full core Electron lane
- [x] real Electron manual/Playwright visual check in detailed and compact mode
- [x] run `simplify` when available; otherwise record manual simplification review
- [x] requirement-by-requirement completion audit against this plan
- [x] update `docs/architecture.md` and `plans/active/README.md`

## Structural Success Gates

With 200 sidecar-backed sessions:

- Initial Display Mode load performs zero full transcript reads.
- Initial Display Mode load performs zero changed-files Git commands.
- No generic state event causes a complete all-thread projection request.
- Detailed cards/composers/excerpts mounted are bounded by visible rows + overscan + interaction pins.
- One projection event updates one session entity.
- Compact mode mounts zero composer and transcript-excerpt components.
- Offscreen runtime sessions continue without renderer residency.
- Projection payloads never exceed the declared byte bound.
- Main full-transcript cache does not grow merely from opening/scrolling Display Mode.
- Renderer projection cache stays within its weighted budget.
- Drafts and attachments survive every required transition.

## Performance Targets

These are local reference-machine targets, not sole CI correctness gates:

- 200-session Display Mode first usable p95 under 350 ms after warm app boot.
- Projection hydration p95 under 100 ms for sidecar-backed visible cards.
- Sustained scroll near 60 fps with no repeated long tasks over 100 ms.
- Idle Display Mode produces no polling work and near-zero renderer CPU.

Record the machine/context with measured results instead of treating a single timing as universal.

## Verification Evidence

Append dated commands, counts, and real-surface observations here as phases complete.

### 2026-07-27

- Deterministic fixture: 200 sessions across three workspaces, including 12 legacy sessions, mixed status/unseen
  metadata, oversized tool bodies, durable run activity, and offscreen draft/attachment state.
- Measured on Apple M4 Pro, macOS 26.4.1 arm64, background real Electron at the default 1280 × 800 viewport:
  first usable Display Mode was 308 ms after click. The 200-session one-entity state patch was 60 bytes, so a deeper
  workspace/session state split was not warranted.
- Initial 200-session load asserted zero full-transcript reads, zero changed-files Git requests, unchanged
  full-transcript cache residency, no more than 30 projection requests/resident detailed cards, and a renderer
  projection cache below 12 MiB.
- Scrolling through all 200 sessions read only requested legacy transcripts (at most the 12 fixture legacy sessions);
  it never admitted them to the full-transcript cache.
- Detailed and compact real Electron screenshots were inspected. Detailed cards retained the offscreen draft,
  attachment, workflow rail, and terminal residency. Compact mode rendered shell-only cards, preserved status/order,
  respected an explicit one-column layout, and mounted zero transcript/composer internals.
- `pnpm test:unit`: 47 files, 203 tests passed.
- Targeted projection/subagent units: 2 files, 14 tests passed.
- Targeted Display Mode Electron lane: 11 tests passed; final performance suite: 3 tests passed.
- Full core Electron lane: 181 tests passed and one pre-existing contradictory Settings width assertion failed. The
  same earlier commit intentionally widened Settings to the 1320 px surface requested by the product work but still
  asserted a 960 px maximum. The test was corrected to require `> 960` and `<= 1320`, then its real Electron rerun
  passed. Composite result: all 182 core cases passed, with no product-code failure.
- Desktop typecheck, production build, repository lint, and `git diff --check` passed.
- `simplify` is not available in this checkout. Manual simplification review removed the all-thread transport,
  consolidated projection refresh/persistence, deduplicated projection and changed-file requests, bounded both
  projection caches, prevented untouched composers from writing, and retained the measured state domain because its
  remaining 60-byte entity patch was not material.
