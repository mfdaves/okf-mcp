---
id: okf://okf-mcp/runtime/file-concept-store
type: OKF Runtime Component
title: File Concept Store
description: Local proposal and concept persistence boundary used by root and project authoring.
tags: [storage, proposals, authoring, filesystem]
relations:
  - type: consumes
    target: okf://okf-mcp/specs/concept-format
  - type: related_to
    target: okf://okf-mcp/workflows/concept-authoring
  - type: related_to
    target: okf://okf-mcp/workflows/concept-update
  - type: checked_by
    target: okf://okf-mcp/policies/authoring-safety
  - type: configured_by
    target: repo://src/store.js
---

# File Concept Store

The file concept store is the persistence boundary for root- and project-mode authoring. Proposal records are JSON files under `.okf-proposals` by default. Concept files remain ordinary Markdown inside the selected local root.

Proposal states are `proposed`, `accepted`, and `rejected`. Creating or updating a proposal writes only the proposal record. Acceptance revalidates the candidate before changing a concept file.

New concepts use exclusive creation. Updates retain a SHA256 revision and check it immediately before atomic replacement. Gated Attested Computation proposals stage the concept plus an optional external computation file and conflict-check every target before acceptance.

The store rolls back published files when an ordinary acceptance call fails, but a multi-file acceptance is not crash-transactional across process or power loss. Operators must inspect and repair an interrupted acceptance before restarting authoring; the store does not claim database transaction semantics.

Write paths remain bundle-relative, bundle boundaries are enforced, and symbolic-link traversal is blocked. Generic tools cannot alter computation contracts. Migration manifests live under `.okf-proposals/migrations`; their child proposals are never auto-accepted, and the reserved version proposal depends on accepted Stage-A children.

This is a local file-backed store intended for a trusted root or project workspace. It is not a distributed transaction system or multi-writer database. Its invariants are defined by the [authoring safety policy](../policies/authoring-safety.md).
