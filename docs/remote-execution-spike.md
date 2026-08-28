# Remote Execution Architecture Spike

Status: executable development spike; **not a shipped remote-workspace product**
Decision date: 2026-08-28
Decision: preserve the boundary and continue research, but **no-go for public remote execution** until the product gaps below are closed.

## What the spike proves

Pi GUI can put a typed execution boundary between the desktop UI and a separately supervised process without weakening the existing Electron-main ownership model. The prototype is launched only when `PI_APP_EXPERIMENTAL_REMOTE_EXECUTION=1`; otherwise Diagnostics reports a truthful disabled state and the helper is never started.

The helper is a separate build entry (`out/main/remote-execution-helper.js`) and is deliberately included in the packaged app. It accepts only framed JSON messages over inherited stdio. Frames are capped at 64 KiB, pending requests at 32, and operations at 10 seconds. Each launch receives a random 256-bit credential, negotiates protocol version 1 and a capability descriptor, then enters a two-second heartbeat loop. Three missed heartbeats stop the child. Explicit shutdown, app quit, protocol failure, stream failure, and failed negotiation all terminate the helper; a one-second grace period is followed by `SIGKILL`.

The only prototype capabilities are:

- canonical workspace root;
- bounded directory listing (200 entries, metadata only, no file contents);
- bounded Git porcelain status (2 MiB command output and 2,000 parsed entries);
- health, capability negotiation, cancellation, heartbeat, and shutdown.

Paths are resolved beneath the canonical negotiated root. Traversal and null bytes are rejected. Directory listing does not follow symlinks. Git is read-only. The helper cannot open an editor, start a terminal or provider, run an arbitrary process, watch files, mutate Git, or receive provider credentials.

The existing local changed-files read path now uses the same `ExecutionEnvironment.gitStatus()` contract, which proves that the abstraction is not a disconnected demo.

## Measured evidence

The deterministic Electron test launches the real built helper and proves disabled-default, launch, protocol/capability negotiation, root and directory/Git probes, traversal rejection, helper crash detection, reconnect with a new generation/PID, explicit shutdown, and process disappearance. On the 2026-08-28 development build the complete enabled lifecycle finished in about 1.6 seconds. Unit tests cover fragmented/coalesced frames, size bounds, version validation, constant-time credential matching, traversal, and Git-status parsing.

The helper is included rather than development-only because that lets packaged builds truthfully exercise the same boundary. Inclusion does not enable it; the environment flag remains required. Packaged-runtime verification asserts the helper exists inside `app.asar`.

## Source of truth split

- Electron main owns lifecycle, credentials, request correlation, timeouts, heartbeat state, reconnect generation, renderer-safe errors, and the selected workspace path.
- The helper owns only the in-flight read operation and canonicalizes the root it was given.
- Pi JSONL, desktop state, provider sessions, terminals, VS Code leases, checkpoints, evidence, and credentials remain with their current owners. None move into the helper.
- The renderer receives bounded snapshots and probes through four narrow IPC calls. It never receives the ephemeral credential or a generic process/filesystem bridge.

## Threat model

The prototype defends against malformed/oversized frames, stale or unknown responses, request floods beyond the pending limit, traversal, accidental external hosts, a dead/hung helper, credential mismatch, protocol mismatch, and orphaning on normal or abnormal lifecycle transitions. Errors are length-bounded and token-shaped strings are redacted before renderer exposure.

It does **not** solve a compromised local account, a compromised Electron main process, transport across an untrusted network, host identity, multi-user authorization, replay across a real network, sandbox escape, secure secret forwarding, remote updater compromise, or hostile repository content beyond the narrow metadata operations. The launch credential is ephemeral but inherited through the child environment; a product transport must replace this with an authenticated channel whose bootstrap secret is not exposed through process inspection.

## Transport options for a product

1. SSH stdio: strongest near-term option for user-managed machines because host identity, encryption, and account authorization already exist. It still needs explicit host-key UX, reconnect semantics, multiplexing, and a signed/versioned helper install.
2. Mutual-TLS direct agent: better product control and revocation, but requires enrollment, certificate rotation, firewall traversal, and a secure updater.
3. Relay/WebSocket: easiest NAT traversal and mobile reach, but adds a high-value service, tenancy isolation, message retention policy, regional availability, and operational burden.

The current framed protocol can sit above any of these transports, but stdio loopback is not evidence that network authentication is complete.

## Product gaps

Before reconsidering the no-go decision, a production plan must prove:

- authenticated enrollment, host identity, rotation, revocation, and replay protection;
- reconnect/resume with monotonic session and request epochs rather than only a local generation;
- remote filesystem consistency, symlink policy, atomic writes, watch backpressure, and conflict handling;
- an explicit provider-credential ownership decision (prefer provider execution on the remote host; never silently copy desktop credentials);
- terminal PTY transport with resize, flow control, cancellation, history bounds, and ownership evidence;
- a VS Code strategy (Remote SSH/tunnel or a separately authenticated web surface), not an iframe pointed at an arbitrary host;
- signed helper distribution, compatibility windows, staged update/rollback, crash recovery, and uninstall;
- platform packaging, code signing/notarization, firewall prompts, proxy behavior, telemetry/privacy, and support diagnostics;
- adversarial protocol fuzzing and independent security review.

## Recommendation

Keep `ExecutionEnvironment` as the capability vocabulary and use it when another narrow local read path genuinely benefits. Keep the loopback helper behind the development flag for regression and packaged-boundary testing. Do not expose remote hosts, SSH settings, relays, terminal execution, provider forwarding, or writable operations in the product until a separate approved plan closes the gaps above.
