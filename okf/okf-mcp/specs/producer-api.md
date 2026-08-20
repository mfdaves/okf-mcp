---
id: okf://okf-mcp/specs/producer-api
type: OKF Extension Contract
title: Producer API
description: Versioned Node.js contract for configured metadata producers that return candidate OKF v0.2 documents without publishing them.
tags: [okf, producer, extension, api]
relations:
  - type: depends_on
    target: okf://okf-mcp/specs/concept-format
  - type: related_to
    target: okf://okf-mcp/runtime/producer-host
  - type: configured_by
    target: repo://src/producers.js
---

# Producer API

A producer package exports `okfProducer`. The descriptor declares producer API version `1`, target OKF version `0.2`, stable identity, package version, relation vocabulary, configuration validation, and one asynchronous `generate` function.

The host supplies a configured bundle ID, normalized trusted configuration, one generation timestamp, cancellation signal, and a bounded secret resolver. Generation may read source metadata but must not write destination files. It returns sorted bundle-relative Markdown candidates plus a numeric summary. It receives no destination path and has no preview or apply authority.

Producer configuration comes only from `okf.project.yaml`. MCP callers select one configured instance and cannot replace its package, bundle, configuration, credentials, queries, or output location. Packages are already installed and are resolved from the trusted project root; okf-mcp never installs or fetches producer code.

The producer declaration is not proof of conformance. The [producer host](../runtime/producer-host.md) independently parses and validates every candidate and the complete future project before publication.
