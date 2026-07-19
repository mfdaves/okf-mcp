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
  - type: configured_by
    target: repo://okf.project.yaml
  - type: configured_by
    target: repo://package.json
---

# Published okf-mcp Reference Bundle

This directory is the canonical machine-readable architectural reference for `okf-mcp`. It is maintained with the source repository and validated by the same runtime it documents.

The latest public bundle can be loaded from:

`https://github.com/mfdaves/okf-mcp/tree/main/okf/bundles/okf-mcp`

Consumers that need reproducibility should replace `main` with a release tag. Remote loading indexes only the Markdown tree and does not execute repository code.

The npm package allowlist includes `okf.project.yaml` and the `okf` directory so installed artifacts carry the same reference bundle. The repository project config can validate, search, render, and serve this bundle locally.

Concept ids use the stable `okf://okf-mcp/...` namespace. Internal relations target those stable ids, while `repo://` references connect durable concepts to their current implementation sources without turning source files into concepts.

The bundle deliberately documents product contracts, runtime boundaries, workflows, and policies rather than mirroring every source file.
