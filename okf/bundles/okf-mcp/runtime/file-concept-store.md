---
id: okf://okf-mcp/runtime/file-concept-store
type: OKF Runtime Component
title: File Concept Store
description: Local proposal and concept persistence boundary used by project authoring.
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

The file concept store is the persistence boundary for project-mode authoring. Proposal records are JSON files under `.okf-proposals` by default. Concept files remain ordinary Markdown inside configured local bundles.

Proposal states are `proposed`, `accepted`, and `rejected`. Creating or updating a proposal writes only the proposal record. Acceptance revalidates the candidate before changing a concept file.

New concepts use exclusive creation. Updates retain a SHA256 revision of the source content and check it again immediately before atomic replacement. Detected concurrent changes return a conflict and preserve the current file.

Write paths are normalized relative Markdown paths. Reserved files are rejected, bundle boundaries are enforced, and symbolic-link traversal is blocked. Update proposals are also bound to the original bundle, path, and stable concept identity.

This is a local file-backed store intended for a trusted project workspace. It is not a distributed transaction system or multi-writer database. Its invariants are defined by the [authoring safety policy](../policies/authoring-safety.md).
