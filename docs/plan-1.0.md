# okf-mcp 1.0 master plan: a knowledge runtime for autonomous agents

Status: revision 6, 2026-10-24, after WP7 and WP0 landed; embeddings re-sequenced around an OpenAI-compatible client. Owner: maintainer. Readers: the maintainer and the agents assigned to work packages.

## 0. How to use this document

Each work package (WP) in section 7 is self-contained: goal, scope, deliverables, acceptance tests, budgets, dependencies, and the files it owns. An agent assigned a WP needs this document, the repo, and the evidence folder; nothing else. Requirement IDs (`R-xx`, `W-xx`, ...) are the vocabulary for commits, tests, and reviews. Section 12 says how to brief an agent and which WPs may run in parallel.

Evidence lives in a temporary local folder (`seo-eval/` fixture, baseline, prototype runs, `results/abstain-signal.json`; `search010/` lexical prototype, stemmer comparison, `search010/scale/` 5k benchmarks; `dl/` papers). That folder is not permanent; WP0 moves the durable parts into the repo. Numbers quoted below were measured on the maintainer's machine (Node 24.17) against commit `66676af`.

## 1. Problem and vision

An autonomous agent that runs for weeks needs knowledge that survives the run, can be reviewed by a human, and cannot leak between tenants. Vector memories give none of that. okf-mcp already stores knowledge as Markdown with YAML frontmatter in git (OKF v0.2), validates it, indexes it as a typed graph, and guards writes with provenance and ownership rules.

1.0 means: an agent can read and write its knowledge through okf-mcp for weeks without a human repairing the catalog, and the public interfaces are frozen under SemVer.

The reference deployment is an SEO agent (one agent per customer, one bundle per customer, a shared read-only playbook bundle). Nothing in the plan may depend on that domain. Where the plan says "tenant", the SEO case reads "customer"; where it says "shared bundle", read "playbook". Agent-agnosticism is measured, not asserted: a second fixture from a different domain carries its own thresholds (WP0).

## 2. Non-negotiable boundaries

| ID | Boundary |
|---|---|
| B-1 | Markdown files are the only source of truth. Every index, vector, and cache is derived, versioned, and rebuildable from the files. |
| B-2 | OKF v0.2 conformance is kept. okf-mcp additions (typed relations, `okf://` locators, section anchors, policies, caches) stay extensions, documented as such, and never required to read a bundle. |
| B-3 | Local-first. No database server. Default install makes no network calls. Network features (remote bundles, API embedders, git sync) are opt-in per flag or config, with the destination allowlisted and credentials taken from the environment only. |
| B-4 | Isolation by construction: one process serves one bundle or one project. Nothing loaded into a process can be reached by a process that did not load it. Multi-tenant hosting is the deployer's composition of processes, not a feature of okf-mcp. |
| B-5 | Writes are guarded: validation before publish, attributed actor, required provenance, no implicit adoption of hand-authored content, revision checks on update. Derived files (indexes, caches) never make a tenant's git worktree dirty. `.okf-proposals/` is not derived; it stays under the root for compatibility (`store.js:157`; the dirty-worktree check is `prepareGit` in `src/authoring/git-preflight.js`), and `--git-commit` requires it to be git-ignored or relocated with `--proposal-root` (documented in WP7). |
| B-6 | Catalog content is data, never instructions. Nothing in a bundle executes. Catalog text (any frontmatter value or body text) appears only in structured result payloads and resource bodies; never in `initialize` instructions, tool descriptions or schemas, prompts, or error messages. Structured listings (`resources/list`, search and context results) are result payloads under this rule. |
| B-7 | Agent- and vendor-agnostic. The same behaviour through MCP stdio, MCP HTTP, CLI, and the Node library. No dependency on a model vendor; embedders are pluggable and optional. |
| B-8 | Dependency budget: at most 6 runtime dependencies (4 today). Optional capabilities are separate packages, never pulled in by the default install. Vendored code carries its licence header and a provenance note. |
| B-9 | Public interfaces change only additively from 0.10 to 1.0, except entries in section 10. The 0.9.1 export list of `src/index.js` (127 names) stays a subset of 1.0's. |

## 3. Consumers

- Autonomous agent: reads to orient itself, writes distilled findings, decisions, and entities; may run unattended.
- Human reviewer: reads diffs and proposals, verifies, rejects, edits files directly.
- Operator: deploys okf-mcp beside an agent (process, container, library), configures bundles, producers, embedder, sync.
- Producer package: generates concepts from a system of record under an ownership manifest (existing Producer API v1).

## 4. Requirements

### 4.1 Retrieval (R)

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| R-1 | Query mode `auto` (all terms, fall back to any term), with `all` and `any` explicit. | Must | fixture Recall@5 0.43 → 0.72, zero-result 44% → 0%. `any` alone scores higher overall (0.81) but drops exact lookups 0.93 → 0.76, so `auto` is the default |
| R-2 | Index-time stemming with the raw token kept and diacritics folded. `languages: auto \| [codes]` per project or bundle, supported set `en`, `it` at 1.0 (registry for more). `auto` = the bundle's language set: detect per document, take the union of languages present in at least 5% of documents, then stem every document and every query with all languages in that set (the measured `multi` configuration). WP1 acceptance must be met with this shipped default. | Must | multi over {it, en}: R@5 0.72 → 0.77, P@1 0.79 → 0.88; build 347 → 824 ms at 5k. Per-document detection was measured only on monolingual synthetic documents and collapses mixed documents to one language, so `auto` picks a bundle-level set instead of per-document stemming |
| R-3 | Stop words (per configured language) and single letters removed from queries; the 16-term limit counted after removal. | Must | 13 fixture queries failed on question words |
| R-4 | Per-result `matchedTerms`, `coverage`, `relevance` (score / top score); top-level `mode`, `queryTerms`, `droppedTerms`, `total` (under the mode used) and `allTermsTotal` (count under `all`, always known). `lowConfidence` flag when `mode === "any"` and top `coverage` is strictly below 0.5 (two fixture queries sit at exactly 0.5; the test pins the strict comparison). Floors `minCoverage`, `minRelevance` opt-in, default off. | Must | `seo-eval/measure-abstain-signal.js` → `results/abstain-signal.json`: flag on 5/8 no-answer, 0/57 answerable on the original 65 queries. On the enlarged WP0 sets the prototype flags 12/22 (alpinaria) and 6/10 (atlas) no-answer queries and 5/181 and 1/84 answerable ones, so the acceptance criterion is "≤ 3% of answerable queries with a relevant top-1 flagged", fixed before WP1 began; hard score cut-offs lose true positives (proto sweep: 5/8 abstentions cost 5/57 answers) |
| R-5 | Exact-match field (path, identifiers, aliases, raw title tokens) never stemmed or stop-worded. | Must | exact lookups 0.93 |
| R-6 | Optional status/freshness prior (deprecated ×0.5, stale ×0.7, draft ×0.85), off by default; applies only when the signals exist on a document. | Should | fixed one distractor case, neutral elsewhere |
| R-7 | Section-level retrieval units with a stable anchor `uri#heading-slug` (okf-mcp extension, B-2). | Must (0.11) | needed by C-1 and citations |
| R-8 | Embedder interface in core: `embed(texts) → Float32Array[]`, `id`, `dimension`, `languages`, `remote: boolean`, `maxBatch`, `maxInputChars`. The first implementation ships in core: `openai`, a zero-dependency client (Node `fetch`) for the OpenAI embeddings API and compatible endpoints, off unless configured. Further implementations (local ONNX) are separate packages loaded like producers. Default: none. | Must (0.11) | B-3, B-8; an OpenAI-compatible endpoint also covers local servers (Ollama, vLLM, LM Studio), so one client serves both the hosted and the on-premise case |
| R-8a | OpenAI-compatible client contract: `POST {baseUrl}/v1/embeddings` with `{ model, input: string[], encoding_format: "float", dimensions? }`. Configuration lives only in trusted project config (`embedder: { type: openai, baseUrl, model, apiKeyEnv, dimensions, batchSize, timeoutMs, maxRetries, concurrency }`), never in tool arguments; the API key is read from the named environment variable only. Batches respect the API limits (≤ 2,048 inputs and ≤ 300,000 tokens per request, ≤ 8,192 tokens per input; estimated at 4 chars per token, inputs truncated at `maxInputChars`). Retries with exponential backoff on 429 and 5xx honour `Retry-After`; order of outputs is checked against `index`; input text is never logged or echoed in errors; `usage.prompt_tokens` is recorded in receipts. Embedder id `openai:<origin host>:<model>:<dimensions>` keys the cache, so a model or provider change rebuilds it. On failure the search degrades to lexical-only and the receipt carries `embedder.degraded: true`. Recommended starting point for Italian and English: `text-embedding-3-small` with `dimensions: 512` (20k vectors ≈ 40 MB), chosen on the development set. | Must (0.11) | OpenAI API reference: 2,048 inputs and 300k tokens per request, 8,192 tokens per input; `dimensions` on text-embedding-3 models |
| R-9 | Vector cache outside the bundle: `$XDG_CACHE_HOME/okf-mcp/<sha256(absolute root)>/` by default (`~/.cache/okf-mcp/` when unset, `%LOCALAPPDATA%\okf-mcp\` on Windows), `cacheDir` override; keyed by section content hash; manifest versioned by embedder id, dimension, and cache format; incremental on write; brute-force cosine; no ANN until measured need. Remote bundles are lexical-only in 1.0. | Must (0.11) | a cache inside the root dirties the worktree and blocks git-backed apply (`live-authoring.js:987–1017`); remote bundles have no root (`remote.js:349–353`) |
| R-10 | Hybrid fusion by convex combination of min-max normalised lexical and dense scores (Bruch et al., arXiv:2210.11934); weight configurable, default tuned on the development queries. Lexical-only when no embedder. | Must (0.11) | |
| R-11 | Search tool description asks the caller for keywords in the catalog's languages and quoted exact strings; no longer says "all terms must match". Applies to `search_concepts` and `list_concepts.query`. | Must | caller-side expansion is the largest documented gain (Query2doc) |
| R-12 | Deferred: prefix/fuzzy matching, BM25 parameter tuning, BM25F, RM3, cross-encoder rerankers, ANN. | — | measured no gain or out of budget |

### 4.2 Context assembly (C)

| ID | Requirement | Priority |
|---|---|---|
| C-1 | `get_context(query, budgetTokens, filters)` returns deduplicated sections with provenance (`sources`, `generated`, `verified`, `status`, `staleAfter`) packed to the budget; token estimate = `ceil(chars / 4)`, stated in the result with the estimator name. | Must (0.11) |
| C-2 | Optional one-hop expansion along typed relations from the top hits, relation shown. Off by default. | Should (0.13) |
| C-3 | Results are structured JSON; concept text appears only inside result fields (B-6). | Must |

### 4.3 Writing and governance (W)

| ID | Requirement | Priority |
|---|---|---|
| W-1 | Write policy per actor pattern: allowed bundles and path prefixes (fixed glob subset: `*`, `**`, literal segments; normalised with `normalizeSlashes` and `safeRelativePath`; no regex from config), allowed types, required fields, default `status`, maximum concepts per batch. Declared in `okf.project.yaml` or `--policy <file>` for `--root`. Applies only to writes by matching actors; existing content is never retro-validated. | Must (0.12) |
| W-2 | Policy violations are structured errors (rule id, field, path) from `okf_validate_changes`; `okf_apply_changes` refuses before touching disk. | Must |
| W-3 | Duplicate check before create: candidate compared with existing concepts (lexical always; dense when available); near-duplicates returned as advice with the existing URI; policy may escalate to a block. | Must (0.12) |
| W-4 | Relation suggestions for a candidate from nearest neighbours, restricted to declared relation types; proposals only, never auto-applied. | Should (0.12) |
| W-5 | Contradiction flag: candidate whose nearest neighbour is `verified` and of the same type is flagged for review. Advisory. | Could |
| W-6 | Write paths perform one incremental index update per batch (today 4 full builds per MCP apply, 5 on git conflict). | Must (0.11) |
| W-7 | Optional git sync per bundle behind `--git-sync`: `pull --ff-only` before a batch (then refresh the index from changed paths), `push` after a successful commit. A failed push leaves the commit, reports `pushed: false`, and the next batch's pull/push is the retry; no background retry loop. Credentials from the environment or the agent's git identity only. | Should (0.13) |

### 4.4 Graph and catalog integrity (G)

| ID | Requirement | Priority |
|---|---|---|
| G-1 | `catalog_report` (tool) and `report` (CLI): orphans, near-duplicates, stale and unverified counts, provenance coverage per field, relation-type distribution, broken links. | Must |
| G-2 | Validation stays deterministic and offline. | Must |
| G-3 | Optional agent-knowledge profile: documented, non-normative type vocabulary (Entity, Finding, Decision, Experiment, Policy, Procedure) with policy snippets. No code path requires it. | Could |

### 4.5 Operations and interfaces (O, I)

| ID | Requirement | Priority |
|---|---|---|
| O-1 | Library API: documented exports for build, search, context, validate, apply, report; no process-global state; a runnable example in the reference bundle. | Must |
| O-2 | Structured receipts with timings for search, context, validate, apply, producer runs; `embedder.remote: true` whenever text left the machine. | Must |
| O-3 | Cache directory safe to delete at any time; version mismatch rebuilds, never errors; cache paths pass the same safety rules as bundle paths. | Must |
| I-1 | MCP stdio stays the primary transport. | Must |
| I-2 | MCP over Streamable HTTP, same registry as stdio. SDK 2.0.0 ships `createMcpHandler` and `WebStandardStreamableHTTPServerTransport` on web `Request`/`Response`; `node:http` needs `@modelcontextprotocol/node` (`toNodeHandler`) or a small shim; the entry is validation-free, so okf-mcp must validate `Origin` and `Host`, bind `127.0.0.1` by default, and require a bearer token. The tool-call queue moves from the `McpServer` instance to shared state so sessions serialise. | Should |
| I-3 | CLI exit codes and JSON shapes unchanged except additive fields; the REST authoring API (`src/http-server.js`) and `.okf-proposals` JSON gain a `schemaVersion` and enter the freeze. | Must |

### 4.6 Non-functional

Performance budgets at 5,000 concepts (about 5 MB of Markdown) with two stemming languages; stretch at 20,000 in parentheses. Absolute numbers are trended as CI artifacts; CI gates on in-run ratios and on 3× ceilings so runner variance does not flake (WP8).

| Metric | Budget | Measured today |
|---|---|---|
| Cold index build | ≤ 2.0 s (≤ 8 s); stemmed ÷ unstemmed ≤ 2.5× | 0.79 s at 5k and 2.76 s at 20k unstemmed (`npm run bench:index`); 0.82 s stemmed at 5k on the prototype |
| Lexical search p95 | ≤ 25 ms (≤ 120 ms) | 8.7 ms at 5k and 60.7 ms at 20k unstemmed (`bench:index`); 16–20 ms stemmed at 5k on the prototype |
| Hybrid search p95, 20k vectors, excluding query encoding | ≤ 60 ms; query encoding reported separately | not built; brute force estimated 5–15 ms |
| Write batch of 5 concepts: validate + apply + index update, git commit on | ≤ 500 ms (≤ 2 s); incremental ÷ full ≤ 0.3× | 4–5 full builds per apply today |
| Incremental embed on write, changed sections only | local model ≤ 2 s per batch; remote client one request per batch when the inputs fit, latency reported and not gated | not built |
| RSS without embedder | ≤ 300 MB (≤ 600 MB) | 178 MB after build and 249 MB at end of run at 5k; 389 / 573 MB at 20k (close to the stretch ceiling) |
| Test suite | ≤ 60 s | ≈ 9 s (195 tests, of which the retrieval eval takes 4.5 s) |

Code quality:

| ID | Rule |
|---|---|
| Q-1 | No new or split source file above 800 lines. WP7 split the two largest; files still above the cap after formatting are grandfathered by a shrink-only ratchet test (`test/source-size`) and have split owners: `indexer.js` 1,221 → WP2; `authoring.js` 1,092 → `authoring/proposals.js` in WP4; `cli.js` 996 → WP6; `migration.js` 865 → WP5. |
| Q-2 | Tools grouped by area (`mcp/tools/search.js`, `graph.js`, `authoring.js`, `producers.js`, ...), each exporting schema plus handler; the server composes a registry. |
| Q-3 | `src/index.js` keeps every 0.9.1 export (B-9); internals get JSDoc `@internal`; a test asserts the 0.9.1 list is a subset. |
| Q-4 | Lint and format in CI with Biome 2.5.15 (single binary, no dependency tree); no new runtime dependency. Rules that would need code changes are warnings for now (useOptionalChain 267, useNodejsImportProtocol 36, useIterableCallbackReturn 19, noPrototypeBuiltins 18, others 32); each WP leaves the files it owns warning-free, and the formatter carve-out for `src/search*` and `scripts/search-benchmark.js` is removed by WP1 and WP0. The formatting commit is listed in `.git-blame-ignore-revs`. |
| Q-5 | Every behaviour change ships with a test; retrieval changes also ship a fixture metric. |
| Q-6 | Comments explain why; match the current style (CommonJS, `"use strict"`, small pure functions). |
| Q-7 | CI matrix: Node 22 and 24 on `ubuntu-latest`, plus `npm test` on `windows-latest` (12 modules handle `path.sep`). POSIX permission assertions are skipped on Windows; if the runner lacks the symlink privilege, the ungated symlink tests in `test/assets.test.js`, `test/git-source.test.js`, and `test/producer.test.js` get the same `win32` guard already used in `test/okf-mcp.test.js`. |

Security:

| ID | Rule |
|---|---|
| S-1 | Path-safety rules (no traversal, symlink, reserved names) apply to cache and policy paths. |
| S-2 | Secrets never enter bundles or caches; producer secret scan covers cache manifests. |
| S-3 | B-6 is tested with a sentinel fixture: every text field carries a unique token; a test asserts zero occurrences in `initialize`, `tools/list`, `prompts/list`, and every `error.message`. `resources/list` is unchanged (`name` = title, `description`) and exempt as a structured listing (B-6). Error messages reference URIs and paths, not titles (today `live-authoring.js:2018` embeds titles). |

## 5. Out of scope for 1.0

Full-text search over external document stores; live data proxying; agent scratch or task memory; multi-writer coordination beyond git; hosted service; per-user ACL inside one process (B-4); rerankers; graph-aware ranking as a default; the skill and MCP-tool catalog as a product; federation of private remote repositories; ANN indexes; backfilling provenance on existing catalogs.

## 6. Target architecture

```
src/
  index.js                 all 0.9.1 exports + new public API (Q-3)
  cli.js                   argument parsing + dispatch only
  parser.js  markdown.js  v02.js  validation.js            unchanged roles
  indexer/   build.js  update.js  resolve.js               split of indexer.js; functional update (W-6)
  search/    lexical.js  query.js  fusion.js  dense.js      R-1..R-10
  search/stem/ among.js base-stemmer.js it.js en.js        trimmed MIT derivative of @nlpjs (WP1)
  cache/     store.js                                       XDG cache, content-hash keyed (R-9, O-3)
  embed/     interface.js  openai.js                        R-8, R-8a; zero dependencies, off unless configured
  context/   sections.js  assemble.js                       R-7, C-1, C-2
  policy/    write-policy.js  duplicates.js  suggest.js     W-1..W-5
  authoring/ live.js  git-publish.js  git-preflight.js  candidates.js  receipts.js  staging.js  shared.js   (WP7, done)
             proposals.js (split of authoring.js, WP4)   sync.js (W-7, WP6)
  mcp/       server.js  registry.js  resources.js                                                            (WP7, done)
             tools/{catalog,search,graph,provenance,computation,migration,remote,proposals,live-authoring,producers}.js
             http.js (I-2, WP6)
  mcp-server.js  live-authoring.js                        one-line shims at the old paths (kept through 1.0)
  producers/ host.js  publisher.js                           unchanged roles
  http-server.js                                             existing REST authoring API
```

Index update is functional: `updateIndex(index, { upserts, deletions }) → newIndex` sharing unchanged structure. It recomputes derived state that can change (`byUri`, alias and concept-id ambiguity, inbound broken flags, warnings, assets, external references) only for affected documents and their inbound neighbours, and falls back to a full build above a configurable change ratio (producer runs, remote loads).

Read flow: query → `search/query.js` → lexical and optional dense scores → fusion → filters and priors → `context/assemble.js` → structured result.

Write flow: candidate → policy → duplicate and relation advice → validation on `updateIndex(current, candidate)` → staged publish → `updateIndex` on persisted bytes → receipt.

## 7. Work packages

Sizes: S ≤ 1 day of agent work, M ≤ 3, L ≤ 6. All Must for 1.0 unless marked.

### WP0 Evaluation fixtures and harness (M; prerequisite; done)

- Done on branch `wp0/eval-fixtures`: `test/fixtures/retrieval/{alpinaria,atlas}/` with deterministic generators and golden tests, 203 + 94 pre-registered queries with a seeded dev/heldout split re-derived by test, `sectionAnchor` labels on 52 + 53 queries (section-targeted queries were added for this, still written before any search), `scripts/eval-search.js` (`npm run eval:search`, bootstrap CIs, `lowConfidence` metrics), `scripts/index-benchmark.js` (`npm run bench:index`), `thresholds.json`, `test/retrieval-eval.test.js` gating the baseline floors, and the committed baseline report. Atlas (94 queries) is gated on its full set. The original specification follows for reference.
- Move the Alpinaria generator, bundles, `queries.json`, graded qrels, and the runner into `test/fixtures/retrieval/alpinaria/`; keep the generator deterministic (`--seed`).
- Grow the query set to ≥ 150 by adding paraphrases and new no-answer queries per category, written before any tuning; then split development/held-out 70/30 stratified by category and language. Until the set reaches 150, CI gates on the full set with pre-registered thresholds and 1,000-sample bootstrap confidence intervals; development/held-out are reported, not gated.
- Second fixture from a different domain (software architecture catalog: services, ADRs, incidents, runbooks; English plus one other language) with ≥ 60 queries and ≥ 8 no-answer, own thresholds, gated on its full set (no held-out split until it reaches 150). This is the agent-agnosticism check.
- Label `sectionAnchor` on at least 40 development queries per fixture whose answer lives in one section; WP3a's acceptance is measured on this labelled subset.
- `npm run eval:search` produces a JSON report (Recall@5, nDCG@10, MRR, P@1, zero-result rate, `lowConfidence` precision and recall on no-answer queries, p50/p95 latency, RSS) and a Markdown summary; `scripts/search-benchmark.js` learns graded qrels and nDCG or is replaced by the runner.
- Acceptance: both fixtures validate clean in `--root` and `--project` mode; CI runs `eval:search`; the baseline report is committed as the first artifact.

### WP1 Lexical search 0.10 (M)

- Owns `src/search/` (new) and `src/search-index.js`, `src/search.js` (to be moved). Implements R-1 to R-6, R-11; keeps `searchConcepts(index, options)` backward compatible; exposes `addDocuments(index, docs)` / `removeDocuments(index, uris)` on the search index for WP2.
- Stemmers: trimmed derivative of `@nlpjs/lang-it` and `@nlpjs/lang-en-min` (`Among`, `BaseStemmer` without container or tokenizer, two stemmers), MIT headers kept, provenance note, bounded per-word cache. Upstream pinned as a devDependency at the latest stable 4.x release (parity so far measured against 5.0.0-alpha.5); `test/stem-parity.test.js` asserts zero disagreements on the 1,998-word comparison list against the pinned version.
- Language registry: stemmer plus stop list per code; `languages: auto` detection per document at index time.
- MCP schema: `mode` enum, floors, confidence fields, `allTermsTotal`; description per R-11; CLI output additive.
- Tests: adjust `test/search.test.js` only where it asserted all-term semantics under the default; new tests for stop words, stems, diacritics, exact field, confidence fields, floors, pagination and `allTermsTotal`.
- Acceptance (pre-registered in `test/fixtures/retrieval/thresholds.json`; point estimates on the full sets, 95% bootstrap CI reported; the 0.9.1 baseline on the enlarged sets is Recall@5 0.29 alpinaria and 0.27 atlas; measured with the shipped default `languages: auto`): alpinaria Recall@5 ≥ 0.72, nDCG@10 ≥ 0.78, zero-result rate 0 on answerable queries, `lowConfidence` recall ≥ 50% on no-answer queries with ≤ 3% of answerable queries with a relevant top-1 flagged; atlas Recall@5 ≥ 0.70; p95 ≤ 25 ms and stemmed ÷ unstemmed ≤ 2.5× at 5k.

### WP2 Functional index update and write-path performance (M)

- Owns `src/indexer/` and the write paths in `authoring/live.js` after WP7. Implements W-6 per section 6; replaces `buildIndex` calls at `live-authoring.js:1958, 2029, 2214, 2277` and the `rebuildStateIndex` calls in the server; producers and `load_remote_bundle` keep full builds through the change-ratio fallback.
- `applyFilters`: memoise link sets per index in a `WeakMap`, compute lazily, index edges by source (the `relationType` filter is O(concepts × edges) at `search.js:170`).
- Tests: property test, seeded: random sequences of create, update, delete, alias collision, and link breakage; `updateIndex` result deep-equals a fresh build after each step. Write-path benchmark with git commit on.
- Acceptance: write batch ≤ 500 ms at 5k with git on; incremental ÷ full ≤ 0.3×; search p95 unchanged.

### WP3a Sections and context, lexical-only (M)

- R-7, C-1, C-3 over the lexical index: section extraction from the existing CommonMark structure, anchors, deduplication, budget packing.
- Tests: packing never exceeds `budgetTokens`; deterministic order; anchors stable across whitespace-only edits; sentinel test (S-3) extended to `get_context`.
- Acceptance: `get_context` returns the labelled `sectionAnchor` within its packed sections for ≥ 80% of the labelled development queries on both fixtures (WP0 labels).

### WP3b Embedding client and vector cache (M; may start in Group B)

- R-8, R-8a, R-9, O-3, without any search wiring: `src/embed/interface.js` (the embedder contract and a validator for implementations), `src/embed/openai.js` (the OpenAI-compatible client), `src/cache/store.js` (JSON manifest plus a float32 binary file and a sidecar of section ids and content hashes under the XDG directory; rebuild on any mismatch; delete-safe), and a `prepareEmbeddings(index, embedder, cache)` function that embeds only sections whose hash is missing.
- Tests, all offline: a fake OpenAI-compatible server on `node:http` returning deterministic hash-derived vectors, exercising batching at the input and token limits, `dimensions`, output order by `index`, 429 and 5xx retries with `Retry-After`, timeouts, key-from-env, refusal of a base URL that is not in project config, error masking (no input text in any error), and `usage` accounting; cache invalidation on content and embedder change; deletion mid-run; git-backed apply succeeds with a populated cache (the blocker found in review). A live smoke script (`scripts/embed-smoke.js`) runs only when `OKF_EMBED_SMOKE=1` and the key variable are set; never in CI.
- Acceptance: all tests offline; `prepareEmbeddings` on the alpinaria fixture against the fake server issues the minimum number of requests for the configured batch size and re-embeds only changed sections after an edit.

### WP3c Hybrid retrieval (M)

- R-7 consumers, R-10, C-1 integration: `src/search/dense.js` (brute-force cosine over the cache), `src/search/fusion.js` (convex combination with min-max normalisation), config wiring in `src/project.js` (`embedder`, `cacheDir`, `fusion.alpha`), `search_concepts` and `get_context` options, `embedder.remote` and `embedder.degraded` in receipts, and `scripts/eval-search.js --embedder <config>` so the harness can score hybrid runs (the fake server is enough for plumbing; quality numbers need a real endpoint and are recorded with the model id).
- Tests: lexical-only fallback when the embedder fails or is absent; fusion weight edge cases (0 and 1 reduce to lexical and dense); deterministic ordering; budget packing unchanged.
- Acceptance (pre-registered, measured once with a real endpoint on the development set and reported on held-out): synonym category Recall@5 ≥ 0.70 (from 0.00 baseline, 0.50 lexical prototype) and mixed-language ≥ 0.85 on alpinaria; no category regresses by more than its bootstrap CI; atlas improves or holds; hybrid p95 ≤ 60 ms at 20k vectors excluding query encoding, query-encoding latency reported separately.

### WP3d Local ONNX embedder package (M; Should)

- `@mfdaves/okf-embed-onnx` as a separate package implementing the same interface (candidate models multilingual-e5-small and Arctic-Embed 2.0-M, int8; choose on the development set), loaded like a producer. For deployments where text may not leave the machine and no local OpenAI-compatible server is available. Acceptance: passes the core interface validator and the WP3c tests with the package swapped in; incremental embed ≤ 2 s per batch.

### WP4 Write policy (M)

- W-1, W-2 in `src/policy/`; policy schema documented in the reference bundle; errors carry rule ids.
- Tests: policy matrix (actor pattern × type × path × required fields × batch cap); glob subset rejects regex and traversal; existing authoring tests unchanged.
- Acceptance: violations never reach disk; `okf_validate_changes` reports them read-only; receipts carry the rule id.

### WP5 Integrity and advice (M)

- W-3, W-4, G-1 (W-5 if time allows) in `src/policy/duplicates.js`, `suggest.js`, and `catalog_report`. Advice attaches to validate and apply receipts after WP6's sync code has landed in `authoring/sync.js` (file-ownership rule, section 12).
- Tests: the fixture's near-duplicate pairs are detected lexically and, with an embedder, semantically; no false positive among verified distinct concepts; suggestions use declared relation types only.

### WP6 Deployment surface (M)

- O-1, O-2, I-2, W-7. HTTP transport per I-2 with the adapter decision recorded (shim versus `@modelcontextprotocol/node`, which would make 5 of 6 dependencies); `server.json` gains the HTTP transport entry; git sync in `authoring/sync.js`.
- Tests: HTTP contract test mirroring `test/live-mcp-contract.test.js`; two concurrent sessions serialise writes; Origin/Host rejection; git sync against a temporary bare remote (pull, push, push failure reported, index refreshed after pull).
- Acceptance: an example agent loop using the library runs read, write, re-read on the fixture in under 1 s.

### WP7 Code structure and quality (M; starts first)

- Q-1 to Q-4, Q-7. Order: (1) add an MCP schema snapshot test (none exists; `live-mcp-contract` checks a few properties); (2) split `mcp-server.js` into `mcp/registry.js` and `mcp/tools/*.js` by area; (3) split `live-authoring.js` into `authoring/live.js` and `authoring/git-publish.js`; (4) Biome config and CI job; (5) Windows runner; (6) export-subset test.
- No behaviour change; `git diff --stat` shows moves; the 184 tests, the snapshot, and the package smoke are the safety net.

### WP8 Observability and regression gates (S)

- O-2; `eval:search` and benchmarks in CI: ratio gates and 3× ceilings fail the job; absolutes stored as artifacts with a trend summary in the job output.
- Acceptance: a deliberate 3× latency regression and a deliberate 5-point Recall@5 regression both fail CI; a 10% latency wobble does not.

### WP9 1.0 contract (S; last)

- Freeze: tool names and schemas, CLI commands, exit codes and JSON shapes, project config keys, policy schema, Producer API v1, embedder interface, library exports, REST authoring API, `.okf-proposals` schema, `server.json`. Deprecation list (section 10), SemVer policy, migration note; tag.
- Acceptance: 0.9.1's MCP and CLI contract tests run against 1.0 and pass except for section 10 entries; the export-subset test passes.

Release mapping: 0.10 = WP7, WP0, WP1; 0.11 = WP2, WP3a, WP3b, WP3c; 0.12 = WP4, WP5; 0.13 = WP6, WP8, WP3d (if taken); 1.0 = WP9.

## 8. Test strategy

| Layer | What | Where |
|---|---|---|
| Unit | stemming, query normalisation, fusion, budget packing, policy evaluation, glob subset | `test/*.test.js` (node --test) |
| Property | `updateIndex` equals fresh build over random write sequences; path safety on random inputs; cache survives deletion | seeded generators in `test/` |
| Contract | MCP schema snapshot, tool annotations, CLI exit codes and JSON shapes, HTTP transport, export-subset, 0.9.1 contract tests against 1.0 | existing contract tests plus snapshots |
| Retrieval quality | both fixtures, pre-registered thresholds, bootstrap CIs; development/held-out reported | `npm run eval:search` |
| Performance | build, search, write, hybrid; ratio gates and ceilings | `scripts/*-benchmark.js`, CI job |
| Security | sentinel test for B-6 across the listed surfaces; secrets in cache manifests; traversal into cache and policy paths | `mcp-hardening`, new cases |
| Network boundary | fake OpenAI-compatible embeddings server: batching and token limits, retries with `Retry-After`, timeouts, base URL only from project config, key from env, error masking, usage accounting; live smoke opt-in via env, never in CI | `test/embed-openai.test.js`, `scripts/embed-smoke.js` |
| Soak | 48-hour synthetic agent loop on both fixtures: read, write under policy, re-read, weekly-style `catalog_report`; zero repairs, no growth in orphans or near-duplicates | `scripts/soak.js`, run before each release, not in PR CI |
| Package | `npm pack` smoke with and without optional packages, on Linux and Windows | `scripts/package-smoke.js` |

Rules: thresholds are written down before the change that targets them; fixture metrics may only be tuned on the development set; once a fixture's query set reaches 150, a held-out drop larger than its bootstrap CI blocks the merge; below that size the full-set thresholds gate and the split is reported only.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stem collisions under `any` return junk | coverage ordering, `lowConfidence`, exact field untouched (R-4, R-5) |
| Embedding model quality on mixed-language catalogs | choose on the development set, confirm on held-out and the second fixture; lexical fallback; model id in cache manifest |
| `total` inflation under `auto` (3× at 5k) | `allTermsTotal` always returned; documented |
| Vector cache corruption or drift | O-3; cache never required for correctness; XDG location keeps worktrees clean |
| Agents over-write and fragment the graph | W-1 batch caps, W-3 duplicates, `catalog_report` in the knowledge repo's CI, soak test |
| Process-local locking insufficient when a replica appears | B-4; W-7 ff-only pull; single-writer rule documented |
| Parallel WPs collide on the two large files | WP7 lands before Group B; file ownership in section 12 |
| HTTP transport needs an extra dependency | decision recorded in WP6; budget allows one |
| Optional packages drift from core | embedder interface versioned like Producer API; contract test in core |
| Small query sets make thresholds noisy | ≥ 150 queries before held-out gating; bootstrap CIs; second fixture |

## 10. Deprecations planned for 1.0

- Default search semantics change from `all` to `auto` in 0.10 for `search_concepts` and `list_concepts.query`; `mode: "all"` restores the old behaviour.
- `score` magnitudes change with stemming; consumers use ordering and `relevance`, not raw scores.
- Error messages stop embedding concept titles (S-3); they carry URIs and paths.
- `LiveAuthoringService` no longer carries the git helper methods (`runGit`, `prepareGit`, `commitGit`, and the other publication internals); they live on `GitPublisher`, reachable as `service.git`. Subclass overrides of those methods no longer intercept publication (0.10, WP7). The exported names in `src/index.js` are unchanged.
- Nothing else is removed. Any further removal needs an entry here before the WP merges.

## 11. Definition of done

1.0 ships when: all Must requirements have passing tests; the budgets in section 4.6 hold as ratio gates in CI and as absolutes on the reference machine; the Alpinaria fixture meets its pre-registered thresholds on the held-out split (set ≥ 150) and the second fixture on its full set; the 48-hour soak passes on both fixtures with zero repairs; the freeze list is published. The field criterion for the reference deployment (four weeks unattended on three tenants, zero manual catalog repairs, weekly `catalog_report` flat on orphans and near-duplicates) is reported in the release notes and is not a repo gate.

## 12. Running the plan with multiple agents

File ownership while a WP is open: a file has one owner; others wait or send a patch to the owner's branch.

| Group | WPs | May start when | Owns |
|---|---|---|---|
| A | WP7 (done), WP0 (done), WP8 scaffolding | now | WP7: both large files, `test/mcp-contract-snapshot.test.js`, `test/snapshots/`; WP0: `test/fixtures/`, `scripts/`, `eval:search` |
| B | WP1, WP2, WP3b | WP7 merged, WP0 baseline committed | WP1: `src/search/`, `src/search-index.js`, `src/search.js`, `mcp/tools/search.js`; WP2: `src/indexer/`, `authoring/live.js`, `mcp/server.js` state; WP3b: `src/embed/`, `src/cache/`, `scripts/embed-smoke.js`, its tests (no `project.js`, no search files) |
| C | WP3a, WP3c, WP4 | WP1, WP2 and WP3b merged | WP3a: `src/context/`; WP3c: `src/search/dense.js`, `fusion.js`, `scripts/eval-search.js --embedder`; WP4: `src/policy/write-policy.js` |
| D | WP6, then WP5 | Group C merged | WP6: `mcp/http.js`, `authoring/sync.js`; WP5 (after WP6): `src/policy/duplicates.js`, `suggest.js`, receipts |
| E | WP9 | everything merged | release files |

Shared files have one owner per group; everyone else sends a patch to the owner's branch:

| File | Group A | Group B | Group C | Group D |
|---|---|---|---|---|
| `src/cli.js` | WP7 | WP1 (`search` output) | WP4 (`--policy`) | WP6 (`serve`, `--git-sync`); WP5's `report` goes in after WP6 |
| `src/project.js` | WP7 | WP1 (`languages`) | WP3c (`embedder`, `cacheDir`, `fusion`) first, then WP4 (`policy`) | WP6 |
| `.github/workflows/ci.yml` | WP7 first, WP8 after WP7 merges | WP0 (`eval:search` job) | — | WP8 (ratio gates) |
| `mcp/tools/search.js` | WP7 (move only) | WP1 | WP3c (hybrid options) | — |
| `mcp/tools/context.js` | — | — | WP3a | — |
| `mcp/tools/live-authoring.js`, `mcp/tools/proposals.js` | WP7 (done) | WP2 (index refresh) | WP4 (error shapes) | WP5 (advice) after WP6 |
| `mcp/server.js` | WP7 | WP2 (state) | — | WP6 (HTTP, call queue) |
| `package.json` (scripts, devDependencies; append-only, the later merger resolves conflicts) | WP7, WP0 (test glob `test/*.test.js`, eval and bench scripts) | WP1, WP2, WP3b | WP3c, WP4 | WP6 |

Brief template for an agent:

```
Goal: <WP id and one sentence>
Read first: docs/plan-1.0.md sections 2, 4 (your IDs), 6, 7 (your WP), 8, 12; the files your WP owns.
Constraints: boundaries B-1..B-9; code rules Q-1..Q-7; no new runtime dependency without a plan change; touch only files you own.
Deliver: code + tests + fixture metrics (if retrieval) + PR description listing requirement IDs covered and thresholds met.
Do not: change public shapes non-additively; tune on the held-out set; edit the plan (propose changes in the PR instead).
Report: what passed, what you could not do, measured numbers with the command that produced them.
```

Branch per WP, rebased on main; one PR per WP; CI green including `eval:search` and benchmarks before review.

## Appendix: review record

Revision 1 was reviewed independently on 2026-10-24. Blockers fixed in revision 2: cache location (R-9, B-5), evidence for the confidence flag (R-4, `results/abstain-signal.json`), export curation versus the additive promise (Q-3, B-9). Major items folded in: SDK HTTP facts (I-2), file collisions between parallel WPs (section 12), evaluation gating (WP0, section 8), CI budget flakiness (section 4.6, WP8), index update semantics (section 6, WP2), stemmer vendoring (WP1), language defaults (R-2), testability of B-6 (S-3), off-box data paths (B-3, O-2, W-7), existing catalogs (W-1, section 5), remote bundles (R-9), repo-runnable definition of done (section 11).

The confirmation pass on revision 2 returned "ready after listed fixes"; revision 3 applies them: shared-file ownership (section 12), held-out gating rule consistent with WP0 (section 8, section 11), `languages: auto` defined at bundle level and acceptance measured with the shipped default (R-2, WP1), `resources/list` kept unchanged and exempt under B-6 (S-3), `sectionAnchor` labels for WP3a (WP0), `.okf-proposals/` location rule (B-5), cache fallbacks and Windows location (R-9), strict comparison in the confidence flag (R-4).

Revision 4 records WP7 as landed (branch `wp7/code-structure`, 11 commits, 193 tests, MCP contract and tool-order snapshots byte-identical to 0.9.1). An independent Codex review of the branch found one Windows CI failure (fixed by a `win32` skip), the `LiveAuthoringService` surface change (now a section 10 entry), and the unordered snapshot comparison (fixed with ordered snapshots). Sections 6, 10, 12 and Q-1, Q-4, Q-7 updated to match what was built.

Revision 5 records WP0 as landed and fills in the measured scaling numbers (section 4.6). The enlarged query sets lowered the 0.9.1 baseline to Recall@5 0.29 (alpinaria) and 0.27 (atlas) while the lexical prototype still measures 0.76 and 0.77, so the WP1 targets stand. The `lowConfidence` acceptance moved from "zero answerable flags" to "≤ 3% of answerable queries with a relevant top-1", because the strict rule flags 5/181 and 1/84 on the larger sets; this was changed before WP1 started (R-4, WP1).

Revision 6 re-sequences embeddings at the maintainer's request: the first embedder is an OpenAI-compatible client that ships in core with zero dependencies (R-8, R-8a), which also serves local OpenAI-compatible servers; the former WP3b is split into WP3b (client and cache, may start in Group B because it touches no search or config file), WP3c (hybrid retrieval and config wiring) and WP3d (local ONNX package, Should). Sections 4.6, 6, 8 and 12 updated accordingly.
