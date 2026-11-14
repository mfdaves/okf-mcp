---
id: okf://okf-mcp/specs/producer-api
type: OKF Extension Contract
title: Producer API
description: Versioned Node.js contract for configured metadata producers that return candidate OKF v0.2 documents without publishing them.
tags:
  - okf
  - producer
  - extension
  - api
relations:
  - type: depends_on
    target: okf://okf-mcp/specs/concept-format
  - type: related_to
    target: okf://okf-mcp/runtime/producer-host
  - type: configured_by
    target: repo://src/producers.js
  - type: checked_by
    target: repo://test/producer.test.js
generated:
  by: anthropic/claude-code
  at: 2026-11-14T17:33:39.682Z
---

# Producer API

A producer package exports `okfProducer`. The descriptor declares producer API version `1`, target OKF version `0.2`, stable identity, package version, relation vocabulary, configuration validation, and one asynchronous `generate` function.

The host supplies a configured bundle ID, normalized trusted configuration, one generation timestamp, cancellation signal, and a bounded secret resolver. Generation may read source metadata but must not write destination files. It returns sorted bundle-relative Markdown candidates plus a numeric summary. It receives no destination path and has no preview or apply authority. A producer that cannot generate may throw an error carrying its own `code` (`^[a-z][a-z0-9_]{0,63}
# Producer API

A producer package exports `okfProducer`. The descriptor declares producer API version `1`, target OKF version `0.2`, stable identity, package version, relation vocabulary, configuration validation, and one asynchronous `generate` function.

The host supplies a configured bundle ID, normalized trusted configuration, one generation timestamp, cancellation signal, and a bounded secret resolver. Generation may read source metadata but must not write destination files. It returns sorted bundle-relative Markdown candidates plus a numeric summary. , for example `access_denied`) and a `details` object of scalar values; the host reports both as one diagnostic of an invalid receipt, keeping identifier keys with finite numbers, booleans, null, or single-line strings of at most 200 characters that hold no secret the producer read. The error's message is never forwarded, and an error without such a code is reported as `producer_execution_failed`.

Producer configuration comes only from `okf.project.yaml`. MCP callers select one configured instance and cannot replace its package, bundle, configuration, credentials, queries, or output location. Packages are already installed and are resolved from the trusted project root; okf-mcp never installs or fetches producer code.

Resolution requires the exact bare package name to be installed under a project `node_modules` directory, and the entry node resolves must belong to that installed package. Registry installs, workspaces, links, and store-backed layouts all qualify, because a symbolic link inside `node_modules` is an install-tool detail rather than a trust boundary. A path written into configuration never resolves.

The producer declaration is not proof of conformance. The [producer host](../runtime/producer-host.md) independently parses and validates every candidate and the complete future project before publication.
