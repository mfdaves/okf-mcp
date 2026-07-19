---
id: okf://okf-mcp/workflows/concept-update
type: OKF Workflow
title: Concept Update
description: Guarded proposal workflow for correcting an existing OKF concept without losing concurrent changes.
tags: [workflow, update, correction, concurrency]
relations:
  - type: depends_on
    target: okf://okf-mcp/workflows/concept-authoring
  - type: depends_on
    target: okf://okf-mcp/runtime/file-concept-store
  - type: checked_by
    target: okf://okf-mcp/policies/authoring-safety
  - type: configured_by
    target: repo://src/authoring.js
  - type: configured_by
    target: repo://src/store.js
---

# Concept Update

An update begins by reading the current concept through `get_concept`. `okf_propose_update` targets that concept by canonical or path-derived URI.

The caller may provide a frontmatter patch, a list of frontmatter keys to remove, a replacement body, or a combination. Unspecified frontmatter and an omitted body are preserved. The stable concept URI cannot change through this operation.

The proposal stores the complete candidate plus the SHA256 revision of the source content. Acceptance verifies that the target still has the same bundle, path, and identity, revalidates the candidate, and compares the source revision again immediately before atomic replacement.

When a detected edit changes the source after proposal creation, acceptance returns a conflict without overwriting the current concept. The caller must read the current concept and create a new proposal.

This workflow corrects knowledge while retaining review and conflict visibility. It is governed by the [authoring safety policy](../policies/authoring-safety.md).
