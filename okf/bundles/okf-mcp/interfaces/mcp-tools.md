---
id: okf://okf-mcp/interfaces/mcp-tools
type: OKF Interface
title: MCP Tool Catalog
description: Agent-facing tool contract for discovery, graph navigation, validation, remote loading, and authoring.
tags: [mcp, tools, interface, agents]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/mcp-server
  - type: consumes
    target: okf://okf-mcp/runtime/indexer
  - type: related_to
    target: okf://okf-mcp/workflows/concept-authoring
  - type: configured_by
    target: repo://src/mcp-server.js
  - type: checked_by
    target: repo://test/okf-mcp.test.js
  - type: checked_by
    target: repo://test/mcp-hardening.test.js
  - type: checked_by
    target: repo://test/live-authoring.test.js
  - type: checked_by
    target: repo://test/live-mcp-contract.test.js
  - type: checked_by
    target: repo://test/live-agent-workflow.test.js
---

# MCP Tool Catalog

The MCP interface groups tools by intent.

Discovery tools list bundles, concepts, types, tags, custom relation types, standard edge kinds, and loaded remote bundles. `get_concept` accepts a portable Concept ID or compatibility locator and returns raw frontmatter and body plus normalized v0.2 signals, referenced-asset metadata, and declared Git-source availability. Search uses a process-local MiniSearch BM25+ index and filters lifecycle, trust, freshness at a deterministic date, source presence, generator or verifier actors, runtime, and static attestation readiness.

Graph tools return bounded graphs, neighbors, subgraphs, paths, summaries, provenance traces, and rendered exports. They can filter semantic edge kinds and optionally include inert asset nodes or unfetched external leaves. Extensionless canonical, `.md`, and custom-id aliases are accepted for lookup.

Validation tools inspect bundles, projects, and candidate concepts without writing. They report OKF conformance separately from project validity. Remote loading fetches a public GitHub tree into the in-memory index.

Static computation tools inspect contracts, read indexed assets, prepare parameter digests, and check receipt field names without execution, attestation, value echo, or persistence. Migration tools check or preview Stage A without writes.

`read_git_source` reads one pinned `sources[].git` entry from a checkout or bare repository explicitly mapped by the MCP host. It reads the Git object database rather than the working tree and never fetches. Oversized content errors include the observed size, active limit, maximum supported limit, and whether a bounded retry can succeed.

An explicit local root or project workspace exposes candidate validation, path suggestion, and proposal inspection. Normal proposal mutations require `--authoring`; the coordinated computation proposal additionally requires `--allow-computation-authoring`. `--write --actor <actor>` exposes read-only `okf_validate_changes` plus destructive `okf_apply_changes`, both accepting the same structured create/update batch grammar without requiring agents to compose YAML. Runtime calls to `load_remote_bundle` require `--allow-remote-tool`.

`okf_validate_changes` and `okf_apply_changes` plan 1–100 operations as one future graph, including cross-batch and loaded-remote references. Validation returns a non-durable time-of-check receipt. Apply repeats planning under the process-local writer queue, stamps one server-owned `generated.at` with the configured `generated.by`, publishes the complete local batch, validates persisted state, and refreshes the index. Receipts expose bounded semantic effects, absolute targets, revisions, graph diagnostics, Git preconditions, and durability without echoing full bodies.

Optional `--git-commit` policy rejects filter declarations and hidden `assume-unchanged`/`skip-worktree` index flags, disables replace-object resolution, pins the checked-out symbolic branch, constructs an isolated index from validated bytes, and publishes its exact tree with a compare-and-swap ref update from a clean worktree. The shared index is not used to assemble the commit, so unrelated concurrently staged paths cannot enter it; only affected index paths are synchronized after publication. Determinate failures preserve matching valid working-tree files. Ambiguous outcomes, checkout changes, target replacements, and best-effort revision-checked rollback conflicts are reported explicitly; the tool never pushes.

Every tool supplies a purpose-specific description, descriptions for all input parameters, and MCP annotations for read behavior, destructive behavior, idempotency, and external access. Tool discovery and direct invocation use the same capability checks, so a hidden tool also fails when called by name. Annotations remain hints to clients; server-side validation is authoritative.

The official MCP SDK validates tool arguments against the advertised schema without coercion. Unknown or disabled tools are rejected by SDK dispatch. Argument-schema failures and expected validation, storage, network, read-only, and proposal-conflict failures from enabled tools are returned as tool results with `isError: true`. A validation operation that successfully reports invalid OKF remains a successful tool result.

`search_concepts` and the optional text query on `list_concepts` require every case-insensitive query term, regardless of order. They rank title, type, tags, aliases, description, path, and body while keeping arbitrary frontmatter as an exact structured filter. Queries are bounded to 512 characters and 16 terms; fuzzy, prefix, stemming, and stop-word expansion are not applied. Scores are relative retrieval scores rather than a stable public scale. Relation-type filtering selects concepts with an outgoing relation of the requested type.
