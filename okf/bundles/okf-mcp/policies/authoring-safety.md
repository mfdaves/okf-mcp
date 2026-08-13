---
id: okf://okf-mcp/policies/authoring-safety
type: OKF Policy
title: Authoring Safety
description: Invariants protecting project boundaries, concept identity, review state, and concurrent edits.
tags: [policy, safety, authoring, filesystem]
relations:
  - type: related_to
    target: okf://okf-mcp/runtime/file-concept-store
  - type: related_to
    target: okf://okf-mcp/workflows/concept-authoring
  - type: related_to
    target: okf://okf-mcp/workflows/concept-update
  - type: configured_by
    target: repo://src/authoring.js
  - type: configured_by
    target: repo://src/store.js
  - type: configured_by
    target: repo://src/live-authoring.js
  - type: checked_by
    target: repo://test/okf-mcp.test.js
  - type: checked_by
    target: repo://test/mcp-hardening.test.js
  - type: checked_by
    target: repo://test/live-authoring.test.js
---

# Authoring Safety

Authoring is allowed for an explicit local `--root` or local roots declared by `okf.project.yaml`. MCP proposal mutations require `--authoring`; coordinated computation proposals also require `--allow-computation-authoring`. Direct authoring requires `--write` and a configured actor. Remote roots are read only.

Concept paths must be safe relative `.md` paths inside the selected bundle. Absolute paths, parent traversal, reserved `index.md` and `log.md` targets, symbolic-link traversal, and non-directory parents are rejected.

New concepts cannot reuse a canonical Concept ID or compatibility alias. Updates are bound to the existing bundle and path and cannot change the custom-id alias.

Candidates must satisfy the concept format, configured relation vocabulary, and internal target integrity. External schemes such as `repo://` are allowed as opaque references.

Proposal creation never writes a concept file. Acceptance repeats validation. Updates also compare the source revision immediately before replacement and return conflicts for detected concurrent changes. After acceptance, the MCP index is rebuilt without discarding configured or runtime-loaded remote bundle state.

Direct authoring exposes one destructive batch tool. It validates the combined future graph, stamps generation metadata at the server boundary, serializes batches under one process-local writer lock, stages every file before publication, and rolls back its published files on write or post-write validation failure. It rejects generated-file flags, `process:*` generation owners, configured generator outputs, and computation contracts. Optional Git commits require a clean worktree before any write and never push; a commit failure leaves the valid batch visible as applied but uncommitted.

Computation, executor, and attester artifacts are always inert. Inspection and preflight never execute them, fetch external contract URIs, echo parameter or receipt values, persist receipts, or claim attestation. Migration adds no unverifiable provenance or trust claims and never accepts its own proposals.

HTTP mutations require bearer authorization. Filesystem safeguards still apply after authentication.

The local file store is designed for one trusted root or project workspace. Multiple independent authoring workers require an external coordination or locking strategy.
