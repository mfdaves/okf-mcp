---
type: OKF Extension Contract
title: Pinned Git Sources
description: Host-agnostic source metadata and bounded local Git-object reads for code knowledge stored outside its source repository.
tags: [okf, git, provenance, source, security]
relations:
  - type: related_to
    target: /specs/concept-format.md
  - type: configured_by
    target: repo://src/git-source.js
  - type: checked_by
    target: repo://test/git-source.test.js
---

# Pinned Git Sources

A standard `sources` entry may point at a bundle-local concept of type `Git Repository` and carry a `git` extension with a full commit revision, repository-relative POSIX path, and optional inclusive `lines: { from, to }` range.

The OKF content contains the repository's transport URL but never a machine-local checkout path or credential. The MCP host maps the repository Concept ID to an explicit checkout, bare repository, or mounted object store with `--repo <concept-id>=<path>`.

`read_git_source` resolves only declared source entries. It reads a regular blob from the pinned commit, verifies its Git object ID and SHA-256, enforces UTF-8 and byte limits, and rejects traversal, symbolic links, and submodules. It disables lazy fetches and never consults dirty working-tree bytes. When a blob exceeds the active limit, the structured error reports the actual size, the active and maximum limits, and whether retrying with a larger bounded request can succeed; line selection never bypasses the full-blob safety limit.

An unpinned source or missing host mapping remains discoverable but unavailable. No indexing, search, graph, or provenance operation triggers Git network access.
