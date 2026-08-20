---
id: okf://okf-mcp/workflows/concept-authoring
type: OKF Workflow
title: Concept Authoring
description: Reviewable and direct workflows for validating and persisting structured OKF concept changes.
tags: [workflow, authoring, proposals, review, batch]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/file-concept-store
  - type: consumes
    target: okf://okf-mcp/specs/concept-format
  - type: checked_by
    target: okf://okf-mcp/policies/authoring-safety
  - type: related_to
    target: okf://okf-mcp/workflows/concept-update
  - type: configured_by
    target: repo://src/authoring.js
  - type: configured_by
    target: repo://src/live-authoring.js
---

# Concept Authoring

Concept authoring has two explicitly gated persistence paths.

First, the candidate bundle, path, frontmatter, body, links, relations, and identity are validated. A valid proposal stores the candidate Markdown and its validation result as a proposal record. It does not create the concept file.

A reviewer then inspects the proposal and either accepts or rejects it. Acceptance repeats validation against the current project index, creates the target directory when needed, and writes the new concept using exclusive file creation. The MCP server refreshes its index after a successful acceptance.

Invalid candidates never become proposals. A proposal that becomes invalid before acceptance remains inspectable and returns the current validation result.

For a trusted client approval boundary, `--write --actor <actor>` exposes read-only `okf_validate_changes` and destructive `okf_apply_changes`. Agents submit structured concept fields rather than YAML. The server derives optional paths from strong prefix-scoped same-type conventions or deterministic slugs, rejects future same-type/title conflicts, patches tags/sources/relations, stamps one generation actor and time, and validates the complete future graph. A validation receipt is a non-durable time-of-check preview; apply repeats the checks before publication. Compact receipts are the default and full receipts remain available explicitly. Optional Git policy pins the checked-out symbolic branch, builds one exact isolated tree from validated bytes, and compare-and-swap publishes it without pushing.

Direct writes do not replace generator ownership or computation review. Process-generated concepts, configured generator outputs, and Attested Computation contracts remain outside this workflow.

Corrections to existing concepts follow the related [concept update workflow](concept-update.md). Both paths are governed by the [authoring safety policy](../policies/authoring-safety.md) and persist through the [file concept store](../runtime/file-concept-store.md).
