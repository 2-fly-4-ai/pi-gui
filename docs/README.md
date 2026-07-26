# Repo Docs

This directory is the repo-local knowledge base for agents and humans. Keep `AGENTS.md` as the short map, and put durable product, safety, workflow, and architecture knowledge here.

Start here:

1. `SOURCE_OF_TRUTH.md` - canonical edit surfaces, generated surfaces, and ownership rules.
2. `SAFETY.md` - approval gates, secret handling, and private artifact rules.
3. `folder-map.md` - quick orientation to the repository layout.
4. `architecture.md` - desktop boundaries, state flow, driver stack, and test tiers.
5. `product-experience-safety.md` - evidence authority, checkpoint/restore, context/memory, review, and handoff safety contracts.
6. `runtime-deps.md` - why packaged Electron/runtime dependencies are explicit and how they are verified.
7. `platform-expansion.md` - current mac x64 and Windows platform expansion decision.
8. `workflows/agent-first-change.md` - default loop for agent-driven changes.
9. `security/` - credential rotation, secret-scanning procedures, and repo hygiene audits.
10. `superpowers/` - product specs and historical plans for major desktop capabilities.
11. `readme/` - imported/readme-style pi documentation and media assets.

Rules:

- Update docs in the same change when code, workflows, commands, or ownership boundaries change.
- Prefer small focused docs over one large manual.
- Do not store secrets, real env values, session transcripts, screenshots, videos, traces, HARs, or local runtime logs here.
- When a doc becomes historical, mark it clearly or move it under an archive/completed location instead of leaving it ambiguous.
