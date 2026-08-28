# Subagent Runtime Reliability Closeout

Status: complete
Started: 2026-08-22
Completed: 2026-08-22

## Goal

Make background subagents bounded, cancellable, observable, memory-safe, and able to deliver completion without blocking the parent task. Preserve full output on disk while keeping the Electron renderer and parent runtime bounded.

## Ownership and rollout order

1. **`pi-subagents` extension owns child execution.** Fix detached Electron launch/exit, enforce explicit turn limits, add a final wall-clock safety boundary, terminate the child process group, preserve full output on disk, and expose bounded/cancellable result waits with progress.
2. **`packages/pi-sdk-driver` owns the desktop safety boundary.** Add an inline guard that supplies a finite default turn limit when none was requested and converts model-generated blocking result joins into non-blocking checks. The extension's completion follow-up remains the authoritative wake-up path.
3. **Desktop timeline owns presentation.** Keep tool payloads collapsed by default, show lifecycle state in the row/header, and never require expanded raw output to understand whether a child is running, completed, limited, cancelled, or failed.
4. Roll out the extension repair first, then the driver guard, then restart Electron so new sessions load both boundaries. Verify synthetic runtime behavior before spending a live-provider call.

## Failure inventory

- `get_subagent_result(wait: true)` awaited `record.promise` without timeout, cancellation, or progress and marked the result consumed before completion. This could block the parent indefinitely and suppress the automatic completion turn.
- Detached execution received `maxTurns` in invocation metadata but did not pass or enforce it in the detached child.
- The Electron executable was reused as the detached Node runner without `ELECTRON_RUN_AS_NODE`, allowing Chromium helpers to keep the wrapper alive after work completed.
- The child runner set only an exit code, which does not guarantee an Electron-hosted wrapper exits after result artifacts are flushed.
- Detached stdout parsing assumed every process chunk contained complete JSONL lines, so split `turn_end` events could be dropped and limits/progress undercounted.
- Detached output was accumulated in full in the child, written to disk, then read back in full by the parent. UI truncation therefore did not prevent process/renderer memory pressure.
- Generic tool rendering made a blocking result wait look like a shell command with no stdout, obscuring the actual lifecycle state.
- The upstream full test suite used a locally common custom role name as its “unknown role” fixture, making the test depend on the operator's global agent catalog.

## Implementation checklist

- [x] Preserve and verify the pre-existing Electron Node-mode, explicit child-exit, and bounded visible-result repair.
- [x] Add a bounded result wait (15 seconds by default, 60-second maximum), AbortSignal handling, periodic tool updates, and truthful timeout/cancellation copy.
- [x] Leave completion notification enabled when a wait times out or is cancelled; consume results only after a terminal state is actually observed.
- [x] Pass `maxTurns` into detached configuration and enforce it from observed `turn_end` events.
- [x] Add a 60-minute detached wall-clock safety boundary and terminate the child process group on limits/stop.
- [x] Buffer partial JSONL lines so split events cannot bypass progress or limits.
- [x] Stream complete stdout to the durable result artifact while retaining only a 200 KB live/parent tail in memory.
- [x] Add the Pi GUI inline runtime guard: finite 40-turn desktop default and non-blocking result checks.
- [x] Make the upstream unknown-role test independent of the user's installed role catalog.
- [x] Verify extension lint, typecheck, build, targeted tests, and full suite.
- [x] Verify Pi GUI driver typecheck, unit tests, lint, and build.
- [x] Restart Electron in an isolated real-auth harness and prove a real provider background child completes, wakes the parent, renders collapsed output, and leaves no runner process behind.
- [x] Record final evidence and mark this plan complete.

## Acceptance criteria

- A parent task never remains blocked inside `get_subagent_result` longer than the configured bounded wait.
- Cancelling the parent wait does not silently cancel the background child and does not suppress its later completion notification.
- A detached agent stops at its explicit/default turn limit even when JSON events span stdout chunks.
- A detached process that never reaches a terminal event cannot run forever.
- Stopping/limiting a detached agent terminates its process group, not only the wrapper.
- A 350 KB+ synthetic transcript remains complete on disk while the parent receives a bounded result.
- A normal real Codex child shows progress, completes once, triggers the parent once, and leaves no duplicate/stale running card or orphan process.
- Tool output is collapsed unless the user explicitly opens it.

## Evidence

- 2026-08-22 initial extension proof: typecheck and build passed; targeted bounded-wait, detached launch/limit/chunking/output, and result-format tests passed (15 tests).
- 2026-08-22 Pi GUI driver proof: package typecheck and the new runtime-guard unit suite passed (3 tests).
- 2026-08-22 final extension proof: lint, typecheck, build, and 37 files / 479 tests passed, including a real bounded-join/automatic-wake-up regression, SIGTERM-to-SIGKILL escalation, and terminal counter persistence.
- 2026-08-22 Pi GUI proof: full typecheck, lint, 56 unit files / 242 tests, production build, full Electron core lane 194/194, and final-source timeline/evidence lane 8/8 passed.
- 2026-08-22 real-provider Electron proof: a real Codex background child completed in 21.3 seconds; the parent resumed exactly once; the UI showed one collapsed completed child and one evidence child; detached config recorded 40 turns and a 60-minute wall boundary; terminal status recorded one turn/zero tools; the parent returned idle; and no detached runner remained.
