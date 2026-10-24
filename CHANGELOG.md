# Changelog

All notable changes to `@mfdaves/okf-mcp`. The format follows Keep a Changelog; versions follow SemVer. Until 1.0, minor versions may change defaults where this file says so.

## 0.11.0-rc.1 — 2026-10-24

The first usable version of the "knowledge runtime for autonomous agents" direction described in `docs/plan-1.0.md`. Measured on the two committed retrieval fixtures (`test/fixtures/retrieval/`, 297 pre-registered queries, Italian and English); numbers are in the committed reports under `test/fixtures/retrieval/reports/`.

### Added

- Task-shaped lexical search (0.10): query mode `auto` (all terms, then any-term fallback), Italian and English stemming with per-bundle language detection (`languages` in project config or `--languages`), diacritic folding, stop words, literal matching for quoted and identifier-like terms, per-result `matchedTerms`, `coverage`, `relevance`, top-level `allTermsTotal` and an advisory `lowConfidence` flag, opt-in `minCoverage`/`minRelevance` floors and `freshnessPrior`. Recall@5 on the fixtures rose from 0.29/0.25 to 0.74/0.76 with a zero-result rate of 0.
- Functional incremental index: writes update the index instead of rebuilding it (about 0.04× a full build), with `refreshIndex` over Markdown and referenced assets and a property test proving equivalence with a fresh build.
- Embeddings (opt-in): a zero-dependency OpenAI-compatible embeddings client (`embedder: { type: openai, ... }`), a rebuildable vector cache outside the bundle (XDG directory, content-hash keyed, locked, digest-verified), incremental embedding after each write, and `embedding_status`.
- Hybrid retrieval: convex-combination fusion (`fusion: { alpha, normalization }`, default `tmm` and 0.4) of lexical and dense rankings when an embedder is configured; lexical-only fallback with `embedder.degraded`. Recall@5 0.74/0.76 → 0.83/0.88 with `text-embedding-3-small` at 512 dimensions (`embedUnits: concepts` by default; `sections` configurable).
- Budgeted context: `get_context` tool and `context` CLI command returning deduplicated sections with stable `uri#heading-slug` anchors and provenance, packed to a token budget (default 1,200, compact provenance).
- Write policy: `writePolicy` in project config or `--policy` for `--root`; per-actor rules over bundles, paths, types, required fields, default status and batch size; enforced read-only by `okf_validate_changes`, as a refusal before staging by `okf_apply_changes`, at proposal creation and acceptance over MCP and HTTP, and opt-in for producers.
- Evaluation and benchmarks: `npm run eval:search`, `eval:context`, `bench:index`, `bench:write`, with pre-registered thresholds gated by `npm test`.
- Code structure and gates: `src/mcp/*`, `src/authoring/*`, `src/indexer/*`, `src/search/*` modules with shims at the old paths; MCP contract and tool-order snapshots; Biome lint and format; Windows CI job; content-boundary test asserting catalog text never reaches instruction surfaces.

### Changed

- Default search semantics are `auto` instead of all-terms-must-match (`mode: "all"` restores the old behaviour); `score` magnitudes changed with stemming (use ordering and `relevance`).
- Error messages reference URIs and paths instead of concept titles; YAML frontmatter errors name a fixed category and position instead of echoing source text; undeclared relation types and duplicated computation parameter names are reported by ordinal, never echoed.
- `LiveAuthoringService` no longer carries git helper methods; they live on `GitPublisher` (`service.git`). Exported names in `src/index.js` are unchanged.

### Known issues

- Synonym-category Recall@5 on the SEO fixture stays near 0.54 against a 0.70 target (0.59 with `embedUnits: sections`); a per-query adaptive fusion weight is the planned follow-up.
- Section-anchor hit on the architecture fixture is 0.79 at the default budget (target 0.80); the causes are recorded in the context report.
- A write batch with `--git-commit` takes about 630–730 ms at 5,000 concepts against a 500 ms budget; the git preflight dominates.
- At 20,000 concepts search p95 and memory exceed the stretch targets.
- The vector cache is machine-local; export/import is planned.

## 0.9.1

Last release before this plan; see the git history.
