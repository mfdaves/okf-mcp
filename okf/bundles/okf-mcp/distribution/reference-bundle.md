---
id: okf://okf-mcp/distribution/reference-bundle
type: OKF Distribution
title: Published okf-mcp Reference Bundle
description: Canonical public OKF bundle describing the okf-mcp product and its durable contracts.
tags: [distribution, reference, remote-bundle, dogfooding]
relations:
  - type: consumes
    target: okf://okf-mcp/specs/concept-format
  - type: related_to
    target: okf://okf-mcp/overview/okf-mcp
  - type: checked_by
    target: repo://test/okf-mcp.test.js
  - type: checked_by
    target: repo://scripts/package-smoke.js
  - type: configured_by
    target: repo://okf.project.yaml
  - type: configured_by
    target: repo://package.json
  - type: configured_by
    target: repo://server.json
  - type: configured_by
    target: repo://.github/workflows/release.yml
  - type: configured_by
    target: repo://.agents/skills/okf-mcp-release/SKILL.md
---

# Published okf-mcp Reference Bundle

This directory is the canonical machine-readable architectural reference for `okf-mcp`. It is maintained with the source repository and validated by the same runtime it documents.

The latest public bundle can be loaded from:

`https://github.com/mfdaves/okf-mcp/tree/main/okf/bundles/okf-mcp`

Consumers that need reproducibility should replace `main` with a release tag. Remote loading indexes only the Markdown tree and does not execute repository code.

The public npm package is `@mfdaves/okf-mcp`. Its allowlist includes `okf.project.yaml`, `server.json`, and the `okf` directory so installed artifacts carry the same reference bundle and MCP Registry metadata. The package declares the Registry name `io.github.mfdaves/okf-mcp`.

The package smoke gate verifies that package, lockfile, CLI, MCP server, and Registry versions and identities agree. It installs the generated tarball into a clean temporary project, executes both binaries, validates this bundle, and uses the official client SDK to exercise both modern `2026-07-28` and legacy `2025-11-25` stdio sessions through tool discovery, resource discovery, resource reads, and concept retrieval.

The repository release skill defines the package identity, capability matrix, protocol, schema enforcement, self-validation, tarball, clean-install, prerelease, and registry synchronization gates. The trusted-publishing workflow repeats those checks against an exact Git release tag before publishing. Release-candidate metadata is not published to the MCP Registry; stable Registry publication follows successful npm and `npx` verification.

Portable Concept IDs are extensionless paths inside this root. `okf://okf-mcp/...` remains a deterministic MCP/workspace locator, while `repo://` references connect durable concepts to implementation sources without turning source files into concepts.

The bundle deliberately documents product contracts, runtime boundaries, workflows, and policies rather than mirroring every source file.
