---
id: okf://okf-mcp/workflows/concept-authoring
type: OKF Workflow
title: Concept Authoring
description: Proposal-first workflow for validating, reviewing, and accepting new OKF concepts.
tags: [workflow, authoring, proposals, review]
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
---

# Concept Authoring

Concept authoring separates proposal from persistence.

First, the candidate bundle, path, frontmatter, body, links, relations, and identity are validated. A valid proposal stores the candidate Markdown and its validation result as a proposal record. It does not create the concept file.

A reviewer then inspects the proposal and either accepts or rejects it. Acceptance repeats validation against the current project index, creates the target directory when needed, and writes the new concept using exclusive file creation. The MCP server refreshes its index after a successful acceptance.

Invalid candidates never become proposals. A proposal that becomes invalid before acceptance remains inspectable and returns the current validation result.

Corrections to existing concepts follow the related [concept update workflow](concept-update.md). Both paths are governed by the [authoring safety policy](../policies/authoring-safety.md) and persist through the [file concept store](../runtime/file-concept-store.md).
