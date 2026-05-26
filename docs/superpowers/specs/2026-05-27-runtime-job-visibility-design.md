# Runtime Job Visibility Design

## Goal

Make Pi GUI answer the user's operational questions directly: is the agent running, is a tool still running, did a bash command leave background processes behind, where are their logs/artifacts, and how can the user inspect or stop them?

## Success criteria

- A user can distinguish `Agent running`, `Tool running`, `Background jobs running`, `Idle`, and `Unknown` without reading assistant prose.
- Bash/tool executions are represented as structured timeline cards with command, cwd, status, elapsed time, and PID/process information when available.
- Detached or surviving child processes are shown as background jobs, with honest confidence labels instead of fake certainty.
- The right-side logs surface no longer implies app/renderer logs are task/runtime truth. Runtime state is the default inspector; app logs are explicitly app logs.
- Thread rows and the selected-thread header show background activity badges/counts.
- Users get safe actions for runtime objects: inspect/tail/copy/reveal where available, and stop/kill for tracked processes.

## Problem

The app currently has one main visible concept: a session is `running` or not. Real work has at least three layers:

1. **Agent turn** — the model loop is active and may emit text/tool calls.
2. **Tool subprocess** — a Pi-owned tool such as bash is executing under the session.
3. **Background/detached process** — the tool returned or the agent is idle, but child or separately reported processes continue running.

When these states are conflated, the UI can look idle while real work continues in the background. The assistant may mention PIDs or log paths in markdown, but that structured runtime information is not modeled by the app. The current Observability/Logs panel mostly shows app/renderer/session logs, so it does not answer the user's actual question: “what is running, where, and how do I stop/watch it?”

## Design summary

Runtime state becomes a first-class model, not transcript prose. The driver records Pi-owned tool executions, tracks bash process groups, samples child processes, and reports background survivors after the tool exits. The desktop store keeps a per-session runtime job registry and renders those jobs in three places:

- **Timeline job cards** as the primary truth surface.
- **Runtime inspector panel** for expanded detail and actions.
- **Compact badges/status pills** in the thread row, top bar, and composer footer.

The app uses confidence language for imperfect process tracking. A process may be `tracked` when the app owns the process group, `survived` when it was observed as a child and remains alive after the tool exits, `claimed` when it was found only from tool output such as `pid 37035`, or `unknown` when status cannot be verified.

## Runtime states

### Session-level status

Each session presents a derived status summary:

- `Idle` — no agent turn, active tool, or known background job.
- `Agent running` — the model loop is currently active.
- `Tool running` — at least one Pi-owned tool is active.
- `N background jobs` — the agent/tool is idle but tracked/surviving/claimed processes remain.
- `Unknown background activity` — tool output claims background work but the app cannot verify the PIDs.
- `Failed` — the last run failed, with runtime details retained.

### Runtime job status

Each runtime job has:

- `running` — process is alive or tool is active.
- `exited` — process exited normally.
- `failed` — process or tool failed.
- `background` — the original tool exited but a child/survivor remains alive.
- `unknown` — app cannot determine liveness.
- `killed` — user/app sent a stop signal.

### Confidence

- `tracked` — Pi owns the PID/process group and can signal it.
- `survived` — observed as child/grandchild during execution and alive after parent exit.
- `claimed` — parsed from output or assistant/tool text, not proven as child.
- `unknown` — insufficient data to verify.

## UI design

### Timeline job cards

The timeline is the highest-value surface. A bash/tool execution renders as a structured card rather than plain markdown:

```text
Bash · Running
node factory/run-rest.mjs --lanes 2
cwd: /Users/.../serp-extensions-v2-app-factory
pid: 37035 · pgid: 37035 · elapsed: 2m 14s
output: runtime/generated-rest-20260527/logs/
[View logs] [Copy command] [Stop]
```

When the tool exits with surviving child processes, the card updates and a background section appears:

```text
Bash · Exited · 2 background jobs still running
rest-lane-1  pid 37035  survived  3m 02s
rest-lane-2  pid 37845  survived  2m 58s
logs: runtime/generated-rest-20260527/logs/
[Open runtime panel] [Kill all tracked]
```

If output claims PIDs but the app cannot prove them:

```text
Background jobs claimed by output · status unknown
rest-lane-1 pid 37035 claimed
rest-lane-2 pid 37845 claimed
[Refresh status] [Copy PIDs]
```

The rule: if runtime work exists or might exist, the timeline gets a visible object. The app should not rely on the assistant to narrate operational state.

### Runtime inspector panel

The right panel should be reorganized into explicit tabs:

1. **Runtime** — default tab. Shows agent state, active tool state, runtime jobs, background jobs, controls, and known artifacts/log paths.
2. **Task logs** — session/tool logs, stdout/stderr snippets, and detected log files for the current thread.
3. **App logs** — Electron, renderer, diagnostics, and observability events. This replaces the ambiguous “Observability / Logs” label for app-internal logs.

The Runtime tab mirrors the timeline cards but with more detail: full command, cwd, PID tree, timestamps, exit code, signal, source/confidence, and action buttons.

### Header, thread row, and composer footer

- Top/header status pill: `Agent idle · 2 background jobs` or `Tool running · bash · 1m 12s`.
- Thread row badge: spinner for active agent/tool, numeric process badge for background jobs, warning dot for unknown status.
- Composer footer truth line: `Agent idle · no tools running`, `Agent idle · 2 background jobs still running`, or `State unknown · claimed pids 37035, 37845`.

## Process tracking

### Pi-owned bash/tool processes

The PTY bash tool already creates a shell process. Extend that path to emit lifecycle metadata:

- command
- cwd
- tool call id
- shell PID and process group id where supported
- start and end timestamps
- exit code/signal
- stdout/stderr/progress snippets through existing tool update flow

The driver converts this into session events and persists enough state for reopen/reconciliation.

### Child and detached process discovery

While bash is running, sample the process tree for the shell PID/process group. Record observed children/grandchildren with command, pid, ppid, start time if available, and cwd if available. After the bash process exits, poll observed descendants:

- Still alive descendants become `background` with `survived` confidence.
- Dead descendants become `exited`.
- Processes that cannot be queried become `unknown`.

On macOS, fully detached/reparented processes can escape clean parent-child detection. The UI must show this honestly.

### Claimed PID detection

Some scripts print lines such as `rest-lane-1 pid 37035`. Parse simple PID claims from bash output and attach them as `claimed` background jobs. Verify liveness with `process.kill(pid, 0)` where possible. If the PID is alive but not known as a descendant, show it as `claimed`, not `tracked`.

### Actions

- `Stop` for active tracked process group: send SIGTERM, then offer SIGKILL if still alive.
- `Kill all tracked` for tracked/survived jobs only. Do not kill `claimed` jobs by default without explicit confirmation.
- `Refresh status` re-polls process liveness.
- `Copy PID`, `Copy command`, `Copy path`.
- `Reveal` for artifact/log paths when they exist.
- `Tail logs` when a detected log path exists.

## Persistence and recovery

Runtime job state should be persisted separately from transcript text so reopen can reconcile it:

- active jobs are re-polled on app launch/session hydration;
- jobs whose PIDs no longer exist become `exited` or `unknown`;
- stale `running` session status is not enough to display active work unless runtime jobs or agent/tool state confirm it;
- background jobs survive session idle state and remain visible until exited, killed, or dismissed.

## Testing strategy

Use the desktop `core` lane for deterministic runtime UI state and process model behavior, and targeted `live` coverage for real bash execution where needed.

Core tests should cover:

- active bash job renders as a timeline job card;
- finishing bash clears active tool state;
- surviving child PID renders as background job after parent exits;
- claimed PID renders with `claimed`/`unknown` confidence;
- thread row/topbar/composer status summarize background jobs;
- app logs are labeled as app logs, not runtime truth.

Live tests should cover:

- a real bash command that sleeps in background is detected as a survivor;
- stop/kill actions terminate tracked process groups;
- reopen reconciles persisted runtime jobs.

## Non-goals for first pass

- Perfect cross-platform process-tree discovery.
- Rich artifact parsing for every test framework.
- Long-term historical process analytics.
- Killing unverified claimed PIDs without explicit user confirmation.
- Replacing all existing observability/log functionality.

## Open risks

- Detached macOS processes can reparent to launchd and become hard to attribute.
- PID reuse can make stale claimed PID detection dangerous; claimed PIDs must include timestamps and conservative warnings.
- Tool output can be large; job extraction must avoid slowing streaming or transcript rendering.
- Stop/kill controls need careful confirmation text to avoid destructive surprises.
