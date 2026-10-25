# Changelog

All notable changes to `@mfdaves/okf-mcp`. The format follows Keep a Changelog; versions follow SemVer. Until 1.0, minor versions may change defaults where this file says so.

## 0.11.0-rc.2 — 2026-10-25

Three defects found by running 0.11.0-rc.1 against a real 560-concept catalog, fixed.

### Fixed

- One oversized document no longer turns hybrid search off for a whole catalog. A generated contract dense with identifiers was longer than the embedding model accepts; the whole request failed and the server fell back to lexical-only search for every document. The client now plans requests with a cautious estimate (one token per 3 characters) and truncates at 24,000 characters by default instead of 32,000. If the provider still refuses a request, the client splits the batch until the refused document stands alone, retries it once at half its length (never below 2,000 characters), and skips it only if it is refused again. A skipped document is listed in the preparation receipt as `skipped: [{ id, reason: "input_rejected" }]` and in `embedding_status` and the startup receipt as `skipped: { count, ids }`. Every other document is embedded and search stays hybrid. On the real catalog: 560 of 560 embedded, none skipped, one retried at half length. The default change gives a new embedder id, so existing vector caches made with the default are rebuilt once.
- Search mode `auto` is no longer stopped by one long document that happens to contain every word of the query. It used to fall back to any-word matches only when no document matched every word. Now the documents that match every word come first, in their usual order, and documents that match some of the words follow them whenever fewer than `autoFill` documents match every word (default 3). In that case `mode` is `auto`; `allTermsTotal`, `coverage` and `lowConfidence` mean what they meant before. Set `autoFill` as a library search option or in `okf.project.yaml`; `autoFill: 0` restores the old rule. It is not a tool argument. Lexical Recall@5 on the fixtures: 0.742 → 0.823 and 0.760 → 0.827. Hybrid results on the fixtures are unchanged.
- `get_context` now stays within its token budget. Only the text of the sections used to be counted, so a response was 1.6 to 1.7 times the budget. `usedTokens` now measures the whole JSON response: the candidate concepts, query terms, counters and every section field. Sections are packed into what is left. When even the other fields do not fit, the candidate list is shortened from the end, and the new `omittedConcepts` field counts what was dropped. The tool returns compact JSON, so the text an agent receives is exactly what was measured. A section's `tokens` field now counts the whole section object. Because the old overhead is now charged to the budget, fewer sections fit: the fixtures' section-anchor hit at 1,200 tokens went from 1.000 to 0.900 and from 0.791 to 0.721.

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
