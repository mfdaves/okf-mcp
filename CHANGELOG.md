# Changelog

All notable changes to `@mfdaves/okf-mcp`. The format follows Keep a Changelog; versions follow SemVer. Until 1.0, minor versions may change defaults where this file says so.

## 0.13.0-rc.1 — 2026-11-14

MCP over Streamable HTTP with a principal per request (WP6a in `docs/plan-1.0.md`, requirements I-2 and I-2a to I-2c). Stdio is unchanged: the six stdio MCP contract snapshots are byte-identical to 0.12.0-rc.1.

### Added

- `okf mcp --http [--host 127.0.0.1] [--port 8766] [--public-url URL] [--allowed-host H]... [--allowed-origin O]...` serves the stdio tools, resources and schemas over Streamable HTTP through the SDK's `createMcpHandler`: protocol revision 2026-07-28 and, statelessly, 2025-era clients including the 2025-11-25 `initialize`. A small `node:http` bridge in `src/mcp/http.js` replaces an `@modelcontextprotocol/node` dependency. `Host` is checked on every request and `Origin` on the MCP endpoint (403), bodies above 1 MiB get 413, and `GET /health` answers `{"status":"ok"}`. Binding a non-loopback host without `--auth` is a usage error (exit 2).
- Principals: every call runs for `{ subject, actor, scopes, name?, email? }`. `okf.read` is required for any call; `okf.write` enables the live write tools and producer runs. A principal without `okf.write` sees no write tool in `tools/list`, and calling one fails as a disabled tool does. Over stdio the principal comes from the flags (`--actor`; `okf.write` only with `--write`). Without `--auth` an HTTP caller is anonymous and read-only.
- Writes made for a principal stamp its actor in `generated.by` and are judged by the write policy for that actor; with `--git-commit`, a principal's `name` and `email` become the commit author while the committer stays the configured identity. `LiveAuthoringService.validateChanges/applyChanges` accept `context.actor` and `context.author`. Proposal tools act for the call's principal, so `proposedBy` names its actor (over stdio, `--actor` as before). Producer runs keep `process:<producer>`.
- `--auth tokens:<file>`: a YAML list of `{ sha256, subject, actor, scopes }`, tokens kept only as SHA-256 hashes.
- `--auth introspect:<url>` with `--authorization-server <issuer>`: RFC 7662 introspection with HTTP Basic client credentials from `OKF_INTROSPECTION_CLIENT_ID` / `OKF_INTROSPECTION_CLIENT_SECRET`. A token is accepted when `active` is true, `aud` equals `--public-url`, `exp` is in the future and `scope` holds `okf.read`; the actor is `human:<username>`. Answers are cached by token hash until the earlier of `exp` and 60 s. Refused tokens get 401 with a `resource_metadata` challenge, a missing `okf.read` 403, an unreachable or failing authorization server 503 without detail. The server publishes RFC 9728 protected-resource metadata naming the issuer; okf-mcp never issues tokens. Token values never appear in responses, errors, logs or the MCP request context.
- `--refresh-interval <ms>` (default 2000): over HTTP, files changed outside okf-mcp are picked up before a request at most once per interval, inside the call queue, and a changed index is handed to live authoring. An unchanged check costs p50 33.7 ms / p95 37.1 ms at 5,000 concepts; `npm run bench:index` now reports it.
- `server.json` describes a second package transport: Streamable HTTP at `http://127.0.0.1:8766/mcp`, started with `--http`.

### Changed

- All MCP sessions built over one server state share one tool-call queue (`state.callQueue`) instead of one queue per `McpServer` instance; over stdio there is still one session per process.
- `src/cli.js` is split into `src/cli/{options,usage,commands,http-options}.js` with no behaviour change; it leaves the Q-1 size ratchet's grandfather list.

### Known issues

- `--authoring` is refused with `--http`: which scope may create and accept proposals over HTTP is not decided, and under the stdio rule the proposal tools would be open to read-only principals.
- A revoked introspected token stays valid for up to 60 seconds (the answer cache).
- `--allow-remote-tool` over HTTP lets any principal, read-only ones included, load a remote bundle into the state every principal shares.
- No CORS preflight handling: browser clients on other origins need a proxy that answers it.
- Refresh while serving detects changes by size and modification time, like the write path (W-6); an edit that keeps both is missed.

## 0.12.0-rc.1 — 2026-10-25

Retrieval level-up (WP3c-2): an adaptive fusion weight, contextual embedding units and a confidence block with opt-in abstention, each measured against pre-registered targets on both fixtures and on a real 560-concept catalog (`test/fixtures/retrieval/reports/hybrid-0.12-2026-10-25.md`, `context-0.12-2026-10-25.md`). No default ranking changes: the fixed fusion weight 0.4 and concept units stay the defaults because the new options did not meet their conditions for becoming defaults.

### Added

- `fusion.alpha: adaptive`: the weight of the semantic side is decided once per query from the lexical pass, `fusion.adaptive.low` when quoted or identifier-like terms are matched by every-term hits, `mid` when at least `autoFill` concepts match every term, `high` when nothing matches every term and no concept matches half of them, linear in between. The weights default to the development-split choice `{ low: 0.1, mid: 0.5, high: 0.9 }`. Hybrid responses report `alphaUsed` and `alphaReason`; `embedding_status` reports the setting. Opt-in: on the fixtures it raised alpinaria Recall@5 0.830 → 0.838 (synonyms 0.542 → 0.604, target 0.70) but lowered atlas 0.882 → 0.870; overhead 0.3 ms p95 at 20,000 vectors. On the real catalog it lifted paraphrase queries from 0.10 to 0.27 (informative only).
- `embedUnits: contextual-sections` and `contextual-concepts`: each section, or each concept, is embedded after a one-line prefix naming its concept (`title · type · path`, at most 160 characters; `type · path` for concepts). Plain unit hashes are unchanged; switching unit sets re-embeds once and the receipts name the unit set (`embedUnits`). On the fixtures neither beat concept units (mean dev Recall@5 0.841 and 0.843 against 0.844) and the prefix costs 56% more prompt tokens for sections (6.6% for concepts).
- `confidence: { coverage, topSimilarity, lowConfidence, reasons }` on every `search_concepts` and `get_context` response to a query. With an embedder, `lowConfidence` is also true when the top result matched fewer than half of the terms and no candidate reaches `confidence.minSimilarity` (project or `--embedder-config` key; default 0). Lexical-only responses keep the 0.10 rule.
- `get_context` `abstainOnLowConfidence`: a low-confidence query returns no sections, with the confidence block, the candidate concepts and `abstained: true`.
- Evaluation harness: `--alpha adaptive`, `--adaptive`, the dev-only `--adaptive-grid` with its pre-registered choice rule, and `--baseline <report>` for a per-category paired bootstrap of the Recall@5 difference; hybrid per-query rows carry `alphaUsed`, `alphaReason` and `topSimilarity`.

### Changed

- With an embedder, the top-level `lowConfidence` of a search follows the confidence rule above; at the default threshold it flags the same queries as before.
- The confidence block counts against a `get_context` budget (about 18 tokens). Atlas section-anchor hit at 1,200 tokens: 0.721 → 0.698 (one query); alpinaria unchanged.

### Known issues

- Synonym Recall@5 on the SEO fixture stays at 0.542 by default (0.604 with the adaptive weight; target 0.70).
- Abstention: the similarity clause shares the coverage bound of the lexical one, so on the fixtures no threshold flags an extra unanswerable query; no-answer recall is 0.545 on alpinaria (target 0.70) and 0.70 on atlas, and 4 of 7 on the real catalog (target 5), whose unflagged questions have a top coverage of 0.60–0.67.
- `get_context` candidates are lexical; contextual embeddings do not reach it yet.

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
