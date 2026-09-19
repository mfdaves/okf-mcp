---
id: okf://okf-mcp/runtime/producer-host
type: OKF Runtime Component
title: Producer Host
description: Project-scoped runtime that loads allowlisted producers, validates strict OKF v0.2 candidates, and delegates safe publication.
tags: [producer, runtime, validation, project]
relations:
  - type: consumes
    target: okf://okf-mcp/specs/producer-api
  - type: depends_on
    target: okf://okf-mcp/runtime/indexer
  - type: depends_on
    target: okf://okf-mcp/runtime/file-concept-store
  - type: related_to
    target: okf://okf-mcp/workflows/producer-publication
  - type: configured_by
    target: repo://src/producers.js
---

# Producer Host

The producer host is available only for instances declared by a trusted local project. Static listing does not execute packages. Preview and run resolve the selected bare npm package from the project root, require its `okfProducer` export, validate API and OKF versions plus producer identity, and then validate its configuration before generation.

The managed-producer profile is deliberately stricter than permissive OKF consumption. The root index must declare exactly OKF v0.2. Every concept must have a type, title, description, native valid generation metadata, and native non-empty sources. Producer-owned v0.2 diagnostics, broken internal references, invalid relation types or targets, unsafe paths, duplicate paths, and leaked resolved secrets block readiness.

Preview overlays candidate writes and manifest-owned stale deletions onto the current catalog and validates the complete future project. Run repeats generation and validation under the shared writer queue; a prior preview is never treated as authority. Invalid output changes no destination bytes.

The host publishes through the [producer publication workflow](../workflows/producer-publication.md), validates persisted state, and refreshes the MCP index. Candidate validation runs against the bytes publication will actually leave on disk, which for an unchanged source is the file already published. Compact receipts expose counts; full receipts add bounded relative paths. Neither receipt exposes generated content, secret values, source connection details, producer configuration, or absolute filesystem paths.
