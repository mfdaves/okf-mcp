# okf-mcp 1.0 master plan: a knowledge runtime for autonomous agents

Status: revision 8, 2026-10-25: milestone `v0.11.0-rc.1` cut; real-catalog check done and rc.2 fixes in progress (section 11a); WP3c-2 planned as the next step. Owner: maintainer. Readers: the maintainer and the agents assigned to work packages.

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
| R-1 | Query mode `auto`: all-term hits first in their own order; when fewer than `autoFill` (default 3; search option and project key, never a tool argument; 0 restores the 0.10 "all, else any" rule) any-term results are appended, deduplicated; `mode` reports `auto`, `all` or `any` accordingly; `all` and `any` explicit. Changed in rc.2 after one 54k-character document that matched every term suppressed the fallback on a real catalog. | Must | fixture Recall@5 0.43 → 0.72, zero-result 44% → 0%. `any` alone scores higher overall (0.81) but drops exact lookups 0.93 → 0.76, so `auto` is the default |
| R-2 | Index-time stemming with the raw token kept and diacritics folded. `languages: auto \| [codes]` per project or bundle, supported set `en`, `it` at 1.0 (registry for more). `auto` = the bundle's language set: detect per document, take the union of languages present in at least 5% of documents, then stem every document and every query with all languages in that set (the measured `multi` configuration); when no language reaches 5%, `auto` yields no stemming. Precedence: explicit search option → `index.languages` → `index.project.languages` → detection. WP1 acceptance must be met with this shipped default. | Must | multi over {it, en}: R@5 0.72 → 0.77, P@1 0.79 → 0.88; build 347 → 824 ms at 5k. Per-document detection was measured only on monolingual synthetic documents and collapses mixed documents to one language, so `auto` picks a bundle-level set instead of per-document stemming |
| R-3 | Stop words (per configured language) and single letters removed from queries; the 16-term limit counted after removal. | Must | 13 fixture queries failed on question words |
| R-4 | Per-result `matchedTerms`, `coverage`, `relevance` (score / top score); top-level `mode`, `queryTerms`, `droppedTerms`, `total` (under the mode used) and `allTermsTotal` (count under `all`, always known). `lowConfidence` flag when `mode === "any"` and top `coverage` is strictly below 0.5 (two fixture queries sit at exactly 0.5; the test pins the strict comparison). Floors `minCoverage`, `minRelevance` opt-in, default off. | Must | `seo-eval/measure-abstain-signal.js` → `results/abstain-signal.json`: flag on 5/8 no-answer, 0/57 answerable on the original 65 queries. On the enlarged WP0 sets the prototype flags 12/22 (alpinaria) and 6/10 (atlas) no-answer queries and 5/181 and 1/84 answerable ones, so the acceptance criterion is "≤ 3% of answerable queries with a relevant top-1 flagged", fixed before WP1 began; hard score cut-offs lose true positives (proto sweep: 5/8 abstentions cost 5/57 answers) |
| R-5 | Exact-match field (path, identifiers, aliases, raw title tokens) never stemmed or stop-worded. | Must | exact lookups 0.93 |
| R-6 | Optional status/freshness prior (deprecated ×0.5, stale ×0.7, draft ×0.85), off by default; applies only when the signals exist on a document. | Should | fixed one distractor case, neutral elsewhere |
| R-7 | Section-level retrieval units with a stable anchor `uri#heading-slug` (okf-mcp extension, B-2). | Must (0.11) | needed by C-1 and citations |
| R-8 | Embedder interface in core: `embed(texts, { signal }) → Float32Array[]`, `id`, `dimension` (may be `null` until `probe()` has run when the model's dimension is not configured; consumers call `await embedder.probe()` before opening a cache), `languages`, `remote: boolean`, `maxBatch`, `maxInputChars`; optional `concurrency`, `usage()`, `probe()`. `prepareEmbeddings` chunks work at `maxBatch × concurrency`. The first implementation ships in core: `openai`, a zero-dependency client (Node `fetch`) for the OpenAI embeddings API and compatible endpoints, off unless configured. Further implementations (local ONNX) are separate packages loaded like producers. Default: none. | Must (0.11) | B-3, B-8; an OpenAI-compatible endpoint also covers local servers (Ollama, vLLM, LM Studio), so one client serves both the hosted and the on-premise case |
| R-8a | OpenAI-compatible client contract: `POST {baseUrl}/v1/embeddings` with `{ model, input: string[], encoding_format: "float", dimensions? }`. Configuration lives only in trusted project config (`embedder: { type: openai, baseUrl, model, apiKeyEnv, dimensions, batchSize, timeoutMs, maxRetries, concurrency }`), never in tool arguments; the API key is read from the named environment variable only. Batches respect the API limits (≤ 2,048 inputs and ≤ 300,000 tokens per request, ≤ 8,192 tokens per input); budgets are estimated conservatively at 3 chars per token (identifier-dense text runs about 2.6), inputs are truncated at `maxInputChars` (default 24,000), and a request refused as `invalid_request` is bisected to isolate the offending input (bounded extra requests), which is retried once at half length (floor 2,000 chars) and otherwise recorded as `skipped: [{ id, reason: "input_rejected" }]` in the preparation receipt and `embedding_status`, so one document never degrades a whole catalog (rc.2). Retries with exponential backoff on 429 and 5xx honour `Retry-After`; order of outputs is checked against `index`; input text is never logged or echoed in errors; `usage.prompt_tokens` is recorded in receipts. `baseUrl` may already end in `/v1`; a base URL carrying credentials or a query string is rejected. Server error messages never enter `error.message` (B-6); they are kept, truncated, under `details.server.message` and dropped if they contain input text. Receipts use the codebase's camelCase (`promptTokens`, `totalTokens`). Embedder id `openai:<origin+path>/embeddings:<model>:<dimension>:<maxInputChars>` (for example `openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:32000`) keys the cache, so a change of provider, endpoint path, model, dimension or truncation rebuilds it. HTTP failures carry only the status and an enum `serverCode` (`invalid_api_key`, `insufficient_quota`, `rate_limited`, `model_not_found`, `invalid_request`, `server_error`, `unknown`); no server-supplied string is retained anywhere. Cache writes hold an advisory lock file (2 s wait, 10 min stale takeover); a writer deletes only its own superseded generations immediately and foreign ones after 15 minutes; readers load everything at open. Every returned vector must have the declared length and stay finite after Float32 storage (`embedder_invalid_vector`, not retried). On failure the search degrades to lexical-only and the receipt carries `embedder.degraded: true`. Recommended starting point for Italian and English: `text-embedding-3-small` with `dimensions: 512` (20k vectors ≈ 40 MB), chosen on the development set. | Must (0.11) | OpenAI API reference: 2,048 inputs and 300k tokens per request, 8,192 tokens per input; `dimensions` on text-embedding-3 models |
| R-9 | Vector cache outside the bundle: `$XDG_CACHE_HOME/okf-mcp/<sha256(absolute root)>/` by default (`~/.cache/okf-mcp/` when unset, `%LOCALAPPDATA%\okf-mcp\` on Windows), `cacheDir` override; rows keyed by unit content hash only (identical text shares a row; `units.json` ids are informational, and consumers map unit ids to vectors by recomputing hashes from the index, memoised per index); manifest versioned by embedder id, dimension, and cache format, written last as the commit point; incremental on write; brute-force cosine; no ANN until measured need. Remote bundles are lexical-only in 1.0. | Must (0.11) | a cache inside the root dirties the worktree and blocks git-backed apply (`live-authoring.js:987–1017`); remote bundles have no root (`remote.js:349–353`) |
| R-10 | Hybrid fusion by convex combination of normalised lexical and dense scores (Bruch et al., arXiv:2210.11934); weight configurable, default tuned on the development queries. Lexical-only when no embedder. | Must (0.11) | WP3c: plain min-max has an artifact on small all-term lexical sets (the weakest hit normalises to 0, indistinguishable from a miss; atlas keyword fell 1.00 → 0.54), so the default normalisation is `tmm` (min-max against the theoretical minimum) with `alpha` 0.4, chosen on the dev splits; `minmax` and `lexical-tmm` remain configurable. Dev-mean Recall@5 0.746 lexical → 0.833 hybrid; 1,536 dimensions gave the same 0.833, so 512 stays |
| R-11 | Search tool description asks the caller for keywords in the catalog's languages and quoted exact strings; no longer says "all terms must match". Applies to `search_concepts` and `list_concepts.query`. | Must | caller-side expansion is the largest documented gain (Query2doc) |
| R-12 | Deferred: prefix/fuzzy matching, BM25 parameter tuning, BM25F, RM3, cross-encoder rerankers, ANN. | — | measured no gain or out of budget |

### 4.2 Context assembly (C)

| ID | Requirement | Priority |
|---|---|---|
| C-1 | `get_context(query, budgetTokens, filters)` returns deduplicated sections with provenance (`sources`, `generated`, `verified`, `status`, `staleAfter`) packed to the budget; `usedTokens` = `ceil(chars / 4)` of the entire compact JSON response as returned (sections, concept list, query echo, scores), never above `budgetTokens` except when the budget is smaller than the query echo plus field names; the concept list is trimmed from the end (`omittedConcepts`) before sections are dropped (rc.2; about 300 of the default 1,200 tokens go to the concept list and score fields, a candidate for slimming). | Must (0.11) |
| C-2 | Optional one-hop expansion along typed relations from the top hits, relation shown. Off by default. | Should (0.13) |
| C-3 | Results are structured JSON; concept text appears only inside result fields (B-6). | Must |

### 4.3 Writing and governance (W)

| ID | Requirement | Priority |
|---|---|---|
| W-1 | Write policy per actor pattern: allowed bundles and path prefixes (fixed glob subset: `*`, `**`, literal segments; normalised with `normalizeSlashes` and `safeRelativePath`; no regex from config), allowed types, required fields, default `status`, maximum concepts per batch. Declared in `okf.project.yaml` or `--policy <file>` for `--root`. Applies only to writes by matching actors; existing content is never retro-validated. Scope: direct writes (`okf_validate_changes` / `okf_apply_changes`), proposal creation and acceptance over MCP and HTTP (evaluated against the proposing actor, then the proposal's recorded actor at acceptance). Producers are operator-configured and publish under ownership manifests, so they are exempt unless `writePolicy.applyToProducers: true`. | Must (0.12) |
| W-2 | Policy violations are structured errors (rule id, field, path) from `okf_validate_changes`; `okf_apply_changes` refuses before touching disk. | Must |
| W-3 | Duplicate check before create: candidate compared with existing concepts (lexical always; dense when available); near-duplicates returned as advice with the existing URI; policy may escalate to a block. | Must (0.12) |
| W-4 | Relation suggestions for a candidate from nearest neighbours, restricted to declared relation types; proposals only, never auto-applied. | Should (0.12) |
| W-5 | Contradiction flag: candidate whose nearest neighbour is `verified` and of the same type is flagged for review. Advisory. | Could |
| W-6 | Write paths perform one incremental index update per batch (today 4 full builds per MCP apply, 5 on git conflict). `refreshIndex` detects external edits by size and `mtimeNs` of Markdown files and of every referenced asset; an edit that preserves both size and timestamp is invisible to refresh. Write targets are additionally protected by a content-hash check that rereads and re-plans once (`concept_changed`); dependencies and assets are not, so such edits need the next ordinary write touching them or a restart. Date-dependent signals are recomputed by a full rebuild on the first update of a new UTC day (runs under the writer lock: one latency spike per day per process). | Must (0.11) |
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
| Cold index build | ≤ 2.0 s (≤ 8 s); stemmed ÷ unstemmed ≤ 2.5× | WP1 at 5k: 1.16 s stemmed vs 0.81 s unstemmed (1.44×; search-index part 786 vs 437 ms, 1.80×); 4.7 s stemmed at 20k |
| Lexical search p95 | ≤ 25 ms (≤ 120 ms) | WP1 at 5k: 17.7 ms stemmed vs 13.0 ms unstemmed; at 20k 124.7 vs 91.1 ms (stretch ceiling missed by 4%, not gated) |
| Hybrid search p95, 20k vectors, excluding query encoding | ≤ 60 ms; query encoding reported separately. "20k vectors" means 5,000 concepts × 4 section units, the 1.0 tenant size | WP3c: 35.3 ms at 5,000 concepts × 4 units (lexical alone 21.1 ms) ✔; 199 ms at 20,000 concepts × 1 unit where lexical alone is already 124 ms (the 20k stretch tier, not gated). Query encoding p50/p95 ≈ 143/168 ms through the remote API, reported separately |
| Write batch of 5 concepts: validate + apply + index update, git commit on | ≤ 500 ms (≤ 2 s); incremental ÷ full ≤ 0.3× | WP2 at 5k after the review fixes (mixed create/update batches, one external removal per batch, two refreshes per batch): incremental ÷ full 0.032 (updateIndex ≈ 13 ms vs full ≈ 400 ms); batch p95 217 ms with git off, 628 ms with git on. Git subprocesses are 64% of the git-on batch (69 calls; `check-attr` over all ~5,100 tracked files ≈ 134 ms). The 500 ms git-on budget is therefore not met by WP2 and is owed by WP6: narrowing `check-attr` to candidate paths (≈ −130 ms) and sharing the planning walk with the persisted-state refresh when it is milliseconds old (≈ −45 ms) |
| Incremental embed on write, changed sections only | local model ≤ 2 s per batch; remote client one request per batch when the inputs fit, latency reported and not gated | WP3b live run against api.openai.com, `text-embedding-3-small`: alpinaria 228 concept units in one request, 42,765 prompt tokens (188 per concept), 0.57 s at 512 dims and 0.79 s at 1,536 (2.7 s on the first cold connection), 0.0009 USD; atlas 167 units, 39,641 tokens, 0.50 s; the second run reuses the cache with zero requests |
| RSS without embedder | ≤ 300 MB (≤ 600 MB) | WP1 at 5k: 271 MB stemmed, 251 MB unstemmed; at 20k 1,167 MB stemmed, 835 MB unstemmed. The 20k stretch is missed before stemming is involved; index memory at 20k becomes a named follow-up (WP2 report or post-1.0), not a 1.0 gate |
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
  search/    languages.js  cli-options.js                   registry, stop lists, detection; CLI flag parsing (WP1)
  search/stem/ among.js  base-stemmer.js  {it,en}.js  {it,en}-{tables,regions,suffixes}.js
                                                            MIT derivative of @nlpjs/lang-it and lang-en-min 4.26.1,
                                                            regenerated by scripts/vendor-stemmers.js, parity-tested (WP1)
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

### WP1 Lexical search 0.10 (M; done)

- Done on branch `wp1/lexical-search` (12 commits, merged as `f57e223`): vendored it/en stemmers with parity test, language registry with per-bundle detection, `src/search/{lexical,query,languages,cli-options}.js` with shims, modes `auto|all|any`, literal terms (quoted or identifier-like) matched as whole compounds or adjacent raw runs and never against stems, coverage over logical terms, `allTermsTotal`, `lowConfidence`, opt-in floors and freshness prior, MCP and CLI surfaces, `languages` carried through project config and MCP rebuilds. Measured on the full sets: alpinaria Recall@5 0.742 [0.697, 0.784], nDCG@10 0.814, P@1 0.917, zero-result 0; atlas 0.760 [0.693, 0.823], 0.790, 0.831, 0; held-out floors hold; p95 18.9 ms and stemmed ÷ unstemmed 2.12× at 5k. Three independent review rounds; all findings closed. The original specification follows for reference.

- Owns `src/search/` (new) and `src/search-index.js`, `src/search.js` (to be moved). Implements R-1 to R-6, R-11; keeps `searchConcepts(index, options)` backward compatible; exposes `addDocuments(index, docs)` / `removeDocuments(index, uris)` on the search index for WP2.
- Stemmers: trimmed derivative of `@nlpjs/lang-it` and `@nlpjs/lang-en-min` (`Among`, `BaseStemmer` without container or tokenizer, two stemmers), MIT headers kept, provenance note, bounded per-word cache. Upstream pinned as a devDependency at the latest stable 4.x release (parity so far measured against 5.0.0-alpha.5); `test/stem-parity.test.js` asserts zero disagreements on the 1,998-word comparison list against the pinned version.
- Language registry: stemmer plus stop list per code; `languages: auto` detection per document at index time.
- MCP schema: `mode` enum, floors, confidence fields, `allTermsTotal`; description per R-11; CLI output additive.
- Tests: adjust `test/search.test.js` only where it asserted all-term semantics under the default; new tests for stop words, stems, diacritics, exact field, confidence fields, floors, pagination and `allTermsTotal`.
- Acceptance (pre-registered in `test/fixtures/retrieval/thresholds.json`; point estimates on the full sets, 95% bootstrap CI reported; the 0.9.1 baseline on the enlarged sets is Recall@5 0.29 alpinaria and 0.27 atlas; measured with the shipped default `languages: auto`): alpinaria Recall@5 ≥ 0.72, nDCG@10 ≥ 0.78, zero-result rate 0 on answerable queries, `lowConfidence` recall ≥ 50% on no-answer queries with ≤ 3% of answerable queries with a relevant top-1 flagged; atlas Recall@5 ≥ 0.70; p95 ≤ 25 ms and stemmed ÷ unstemmed ≤ 2.5× at 5k.

### WP2 Functional index update and write-path performance (M; done)

- Done on branch `wp2/index-update-final` (14 commits, merged as `5240904`): `src/indexer/{build,assemble,update,resolve,paths,cache,index}.js` with shim, `updateIndex` with dependency tracking and a 0.2 change-ratio fallback, `refreshIndex` over Markdown and referenced assets (size + `mtimeNs`), `IndexCache` keyed by snapshot identity, `indexInputs` for server/service compatibility, one write-path bug found and fixed by the property test (create + replace in one batch), `scripts/write-benchmark.js` (`npm run bench:write`). Measured: incremental ÷ full 0.04; git-off batch p95 ≈ 180–220 ms; git-on p95 ≈ 630–730 ms, owed to WP6 (git preflight). Two independent reviews; all findings closed or documented (W-6). The original specification follows for reference.

- Owns `src/indexer/` and the write paths in `authoring/live.js` after WP7. Implements W-6 per section 6; replaces `buildIndex` calls at `live-authoring.js:1958, 2029, 2214, 2277` and the `rebuildStateIndex` calls in the server; producers and `load_remote_bundle` keep full builds through the change-ratio fallback.
- `applyFilters`: memoise link sets per index in a `WeakMap`, compute lazily, index edges by source (the `relationType` filter is O(concepts × edges) at `search.js:170`; after WP1 the function lives in `src/search/query.js`).
- Carry the project's `languages` setting into the index: `attachProject` copies `project.languages`, and root mode sets `index.languages` from the CLI option in `mcp/server.js` (gap found by WP1; the MCP server in project mode otherwise falls back to detection).
- Tests: property test, seeded: random sequences of create, update, delete, alias collision, and link breakage; `updateIndex` result deep-equals a fresh build after each step. Write-path benchmark with git commit on.
- Acceptance: write batch ≤ 500 ms at 5k with git on; incremental ÷ full ≤ 0.3×; search p95 unchanged.

### WP3a Sections and context, lexical-only (M; done)

- Done on branch `wp3a/context-2` (14 commits, merged as `c284c4b`): `src/context/{sections,score,assemble,cli-options}.js`, `get_context` tool and `context` CLI command, `npm run eval:context`, committed report. Sections of the top candidates are ranked on the fly (no corpus rebuilt on write; first call ≤ 40 ms and warm p95 20 ms at 5k); the budget counts the delivered payload (default 1,200 tokens, compact provenance); own-text evidence ranks before metadata within a concept, concept order primary, `conceptLift` 4, `preambleWeight` 0.5. One independent review pass; see section 11a for the atlas shortfall. The original specification follows for reference.

- R-7, C-1, C-3 over the lexical index: section extraction from the existing CommonMark structure, anchors, deduplication, budget packing.
- Tests: packing never exceeds `budgetTokens`; deterministic order; anchors stable across whitespace-only edits; sentinel test (S-3) extended to `get_context`.
- Acceptance: `get_context` returns the labelled `sectionAnchor` within its packed sections for ≥ 80% of the labelled development queries on both fixtures (WP0 labels).

### WP3b Embedding client and vector cache (M; done)

- Done on branches `wp3b/embed-client` and `wp3b/embed-client-final` (20 commits, merged as `61200ca`): `src/embed/{interface,units,openai,prepare}.js`, `src/cache/{store,lock,files,paths}.js`, 64 offline tests with a fake OpenAI-compatible server, `scripts/embed-smoke.js`. Live run against api.openai.com with `text-embedding-3-small`: alpinaria 228 units in one request, 42,765 prompt tokens, 0.5–1.9 s, 0.0009 USD; second run zero requests. Five independent review passes; the remaining lock and directory races are documented in the file headers as windows Node cannot close without `openat`. The original specification follows for reference.

- R-8, R-8a, R-9, O-3, without any search wiring: `src/embed/interface.js` (the embedder contract and a validator for implementations), `src/embed/openai.js` (the OpenAI-compatible client), `src/cache/store.js` (JSON manifest plus a float32 binary file and a sidecar of section ids and content hashes under the XDG directory; rebuild on any mismatch; delete-safe), and a `prepareEmbeddings(index, embedder, cache)` function that embeds only sections whose hash is missing.
- Tests, all offline: a fake OpenAI-compatible server on `node:http` returning deterministic hash-derived vectors, exercising batching at the input and token limits, `dimensions`, output order by `index`, 429 and 5xx retries with `Retry-After`, timeouts, key-from-env, refusal of a base URL that is not in project config, error masking (no input text in any error), and `usage` accounting; cache invalidation on content and embedder change; deletion mid-run; git-backed apply succeeds with a populated cache (the blocker found in review). A live smoke script (`scripts/embed-smoke.js`) runs only when `OKF_EMBED_SMOKE=1` and the key variable are set; never in CI.
- Acceptance: all tests offline; `prepareEmbeddings` on the alpinaria fixture against the fake server issues the minimum number of requests for the configured batch size and re-embeds only changed sections after an edit.

### WP3c Hybrid retrieval (M; done)

- Done on branch `wp3c/hybrid` (13 commits, merged as `90891a4`): `src/search/{dense,fusion,hybrid,embedding-config,embedding-cli}.js`, config wiring, startup lifecycle and post-apply embedding through one queue, `embedding_status`, harness `--embedder`/`--alpha-sweep`/`--units`, committed live report. One independent review pass; the six majors (dense-stage fallback, startup/apply queue, pagination-stable candidate depth of 200, lexical evidence for dense candidates, probe order, literal guard) are fixed. Defaults chosen by the pre-registered rule on the dev splits. The original specification follows for reference.

- R-7 consumers, R-10, C-1 integration: `src/search/dense.js` (brute-force cosine over the cache), `src/search/fusion.js` (convex combination with min-max normalisation), config wiring in `src/project.js` (`embedder`, `cacheDir`, `fusion.alpha`), `search_concepts` and `get_context` options, `embedder.remote` and `embedder.degraded` in receipts, and `scripts/eval-search.js --embedder <config>` so the harness can score hybrid runs (the fake server is enough for plumbing; quality numbers need a real endpoint and are recorded with the model id).
- Tests: lexical-only fallback when the embedder fails or is absent; fusion weight edge cases (0 and 1 reduce to lexical and dense); deterministic ordering; budget packing unchanged.
- Acceptance (pre-registered, measured once with a real endpoint on the development set and reported on held-out): synonym category Recall@5 ≥ 0.70 (from 0.00 baseline, 0.50 lexical prototype) and mixed-language ≥ 0.85 on alpinaria; no category regresses beyond a paired bootstrap of the difference (the earlier "its own CI" wording is undefined for zero-width lexical CIs); atlas improves or holds; hybrid p95 ≤ 60 ms at 20k vectors (5,000 concepts × 4 units) excluding query encoding, query-encoding latency reported separately.
- Outcome (branch `wp3c/hybrid`, 8 commits, live measurement with `text-embedding-3-small` at 512 dims, 174k prompt tokens ≈ 0.0035 USD): overall Recall@5 alpinaria 0.742 → 0.836 [0.799, 0.870] (held-out 0.742 → 0.868), atlas 0.760 → 0.843 (held-out 0.785 → 0.840); mixed-language 0.738 → 0.881 ✔; atlas improves ✔; p95 35 ms at 5k × 4 units ✔; incremental embed one request per batch ✔. Not met: synonym category 0.557 (dense-only reaches 0.60 on dev; 1,536 dims does not help), and atlas exact 1.000 → 0.917 on 8 queries (hybrid CI [0.75, 1.0]). Follow-up WP3c-2 after WP3a lands: default `embedUnits: sections`, re-measure synonyms with section units, and a lower alpha when the query carries literal terms (the exact-category case). Concept-level units measured here were embedded with concept text only; the shortfall is a data/unit question, not a fusion bug.

### WP3c-2 Retrieval level-up: adaptive fusion, contextual sections, abstention (M; next after rc.2)

Three measured gaps drive this: synonym and paraphrase queries (embeddings alone 0.81 on dev synonyms, fused 0.54; private-catalog paraphrases 0.10), section units losing to concept units because a bare section carries no system context, and `lowConfidence` catching only about half of unanswerable questions (4 of 7 on the private catalog). Everything below is dev-tuned and held-out-reported on both fixtures, then checked on the private catalog with the maintainer's local comparison harness (agent-written labels until the maintainer supplies real questions). Ships as `0.12.0-rc.1`; all configuration is additive.

1. Adaptive fusion weight (`src/search/fusion.js`, `hybrid.js`). `fusion.alpha` accepts `"adaptive"` (new default once accepted) or a number. Signals, all already computed before fusion: `allTermsTotal`, top lexical coverage after the any-term pass, presence of matched literal terms, top dense similarity. Rule family, parameters tuned on the dev splits only: literal terms matched → `low` (around 0.2, the existing guard stays); all-term hits ≥ `autoFill` with top coverage 1 → `mid` (0.4, today's value); no all-term hits and top coverage < 0.5 → `high` (around 0.75); in between, linear in top coverage. The response reports `alphaUsed` and the reason. Tests: monotonicity and boundary unit tests on the rule; alpha identical across pages of one query; `alpha: 0.4` reproduces today's results exactly; offline fake-server plumbing. Pre-registered acceptance: alpinaria synonym Recall@5 ≥ 0.70 (the WP3c target, still open); no category drops beyond a paired bootstrap CI versus the rc.2 hybrid report; overall Recall@5 not below fixed alpha on either fixture; fusion overhead ≤ 1 ms p95 at 20k vectors.

2. Contextual section embeddings (`src/context/sections.js`, `src/embed/units.js`). New unit function `contextualSectionUnits(index)`: text = a bounded prefix (`title · type · path`, ≤ 160 chars) plus the heading and section text; anchors and hashes of plain sections unchanged; the contextual variant has its own hashes, so switching re-embeds once (reported). Config `embedUnits: contextual-sections` alongside `concepts` and `sections`. Also measure `contextual-concepts` (type and path prefixed to the concept text). Tests: prefix bounding, format, hash stability for plain sections, one request per batch and changed-units-only re-embedding. Measurement: live on dev for `concepts`, `sections`, `contextual-sections`, `contextual-concepts`; the default is chosen by the WP3c rule (mean dev Recall@5, tie-break nDCG@10) and reported on held-out, with the synonym category and the extra token cost of the prefix (expected 10–15%) stated. Pre-registered: the chosen default must not lose to `concepts` on either fixture beyond the paired CI.

3. Abstention v2 (`src/search/query.js`, `hybrid.js`, `src/context/assemble.js`). Add the top dense similarity as a second signal: `lowConfidence = (mode is any and top coverage < 0.5) or (topSimilarity < τ and top coverage < 0.5)`, with τ tuned on the dev no-answer and answerable queries to maximise no-answer recall subject to ≤ 3% of answerable queries with a relevant top-1 flagged (the existing rule). The response gains `confidence: { coverage, topSimilarity, lowConfidence, reasons }`; `get_context` carries the same block and an opt-in `abstainOnLowConfidence` that returns no sections. Tests: rule unit tests; the fixture gate moves from "recall ≥ 0.50" to a pre-registered **≥ 0.70 no-answer recall on both fixtures with ≤ 3% false flags**; private catalog: at least 5 of 7 unanswerable questions flagged, 0 of the exact lookups flagged. Lexical-only deployments keep today's rule (no similarity signal).

4. Optional, same release if time allows: multi-query search (`queries: [..]`, fused by reciprocal rank across phrasings; caller-side expansion is the best-documented gain in the literature; acceptance: no regression on single queries, improvement reported on paraphrases), and a schema trim of `okf_validate_changes` / `okf_apply_changes` via shared `$defs` (target: `tools/list` ≤ 25 KB from 31.5 KB, snapshots regenerated, no behaviour change).

Benchmarks and gates for the whole package: `npm run eval:search -- --embedder …` and `eval:context` reports committed as `hybrid-0.12-<date>` and `context-0.12-<date>`; `bench:index` with the synthetic 20k-vector cache for the p95 gate (≤ 60 ms excluding encoding); the private-catalog comparison before → after in the report; token usage and cost per live run recorded (expect under 0.02 USD for all of it); one independent review pass per the milestone rule.

### WP3d Local ONNX embedder package (M; Should)

- `@mfdaves/okf-embed-onnx` as a separate package implementing the same interface (candidate models multilingual-e5-small and Arctic-Embed 2.0-M, int8; choose on the development set), loaded like a producer. For deployments where text may not leave the machine and no local OpenAI-compatible server is available. Acceptance: passes the core interface validator and the WP3c tests with the package swapped in; incremental embed ≤ 2 s per batch.

### WP4 Write policy (M; done)

- Done on branch `wp4/write-policy-2` (11 commits, merged as `6382a74`): `src/policy/write-policy.js`, `src/authoring/{policy-hook,proposal-policy}.js`, `src/catalog-text.js`, `writePolicy` in project config and `--policy` for `--root`, enforced on direct writes, proposal creation and acceptance over MCP and HTTP, opt-in for producers (`applyToProducers`), unknown actors judged as `unknown`, `defaultStatus` applied at acceptance, `test/content-boundary.test.js` (three server modes; found and fixed YAML error echo and undeclared-vocabulary echo), docs. Two independent review passes. The original specification follows for reference.

- W-1, W-2 in `src/policy/`; policy schema documented in the reference bundle; errors carry rule ids.
- Tests: policy matrix (actor pattern × type × path × required fields × batch cap); glob subset rejects regex and traversal; existing authoring tests unchanged.
- Acceptance: violations never reach disk; `okf_validate_changes` reports them read-only; receipts carry the rule id.

### WP5 Integrity and advice (M)

- W-3, W-4, G-1 (W-5 if time allows) in `src/policy/duplicates.js`, `suggest.js`, and `catalog_report`. Advice attaches to validate and apply receipts after WP6's sync code has landed in `authoring/sync.js` (file-ownership rule, section 12).
- Tests: the fixture's near-duplicate pairs are detected lexically and, with an embedder, semantically; no false positive among verified distinct concepts; suggestions use declared relation types only.

### WP6 Deployment surface (M)

- O-1, O-2, I-2, W-7. HTTP transport per I-2 with the adapter decision recorded (shim versus `@modelcontextprotocol/node`, which would make 5 of 6 dependencies); `server.json` gains the HTTP transport entry; git sync in `authoring/sync.js`.
- Portable vector cache: `okf embeddings export <file>` / `import <file>` (the manifest, units and vectors of the current generation, self-describing by embedder id and digests) so a new machine, a CI job or a second replica starts warm without re-embedding; documentation for keeping the XDG cache directory across CI runs keyed by embedder id. The cache stays outside the bundle (B-5); an opted-in, git-ignored in-root location remains possible through `cacheDir` + `allowInsideRoot` and is documented as such.
- Git preflight cost (from WP2): narrow `check-attr` to candidate paths or cache the attribute scan per HEAD, and share the planning walk with the persisted-state refresh when it is milliseconds old, to bring the git-on write batch under 500 ms.
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

## 11a. Milestone: first good version (`v0.11.0-rc.1`)

Decided 2026-10-24: the first usable version ships before the remaining work packages, so real use with the reference deployment drives what comes next. Review discipline from here: the maintainer's verification plus at most one independent review pass per branch; only correctness and security majors are fixed before merge; everything else is listed here and carried forward.

Contents: WP7, WP0, WP1, WP2, WP3b, WP3a, WP4, WP3c (everything the plan calls 0.10 and 0.11), merged as `90891a4` with 423 tests (one skipped by design). Final hybrid numbers at the shipped defaults (`embedUnits: concepts`, `tmm`, alpha 0.4, `text-embedding-3-small` 512): Recall@5 alpinaria 0.742 → 0.830 [0.791, 0.864] (held-out 0.869), atlas 0.760 → 0.882 [0.831, 0.929] (held-out 0.902); mixed-language 0.738 → 0.881; exact alpinaria 0.894, atlas 1.000; no category regresses beyond its CI; p95 33.7 ms at 5k × 4 units; all live runs together 346k tokens ≈ 0.007 USD. `get_context`: anchor hit alpinaria 1.000 dev / 0.750 held-out, atlas 0.791 dev / 0.733 held-out at 1,200 tokens compact (0.837 / 0.800 at 2,000). Released as `v0.11.0-rc.1` on the `next` dist-tag (publishing is a manual workflow run).

Real-catalog check (2026-10-25, a private production catalog the maintainer works with daily: 560 concepts, 592 files, 4.9 MB, English, 241 generated data-contract concepts past `stale_after`; 45 agent-labelled queries, 31 of 38 answerable in its two main areas, an ingestion service and a data pipeline; the harness and labels stay local and accept the maintainer's own queries): Recall@5 / MRR@10 overall 0.8.0 0.17 / 0.20 (76% zero-result; every task-shaped question returned nothing) → rc.1 lexical 0.47 / 0.64 → rc.1 hybrid 0.66 / 0.76; ingestion area 0.19 → 0.43 → 0.74; pipeline area 0.15 → 0.43 → 0.52; exact lookups 0.81 → 0.83 → 0.90 with every 0.8.0 top-1 still in the new top-5; validation output byte-identical. Tokens an agent receives to answer a question: 0.8.0 search + 3 × get_concept 1,478 (but the right concept arrived in 7/38), new search + 3 × get_concept 7,485 (24/38), `get_context` at 1,200 1,945 (24/38). `tools/list` grew from 20.7 KB to 31.5 KB per session. Three defects found, fixed in rc.2: embedding inputs over the provider's 8,192-token limit failed the whole batch (now bisected, halved, or skipped per unit, with a chars/3 estimate and `maxInputChars` 24,000); one 54k-character document matching every query term defeated the `auto` fallback (R-1 now reads: all-term hits first, any-term results appended when fewer than `autoFill` = 3 all-term hits); `get_context` delivered 1.6–1.7× its budget because the envelope was not counted (C-1 now counts the whole response). Embedding the catalog cost 295k tokens (identifier-dense text runs about 3× the chars/4 estimate), under 0.01 USD. rc.2 outcome (`f671b27`, 434 tests): fixtures lexical Recall@5 0.742 → 0.823 (alpinaria) and 0.760 → 0.827 (atlas) from the `autoFill` rule alone, hybrid unchanged at 0.830 / 0.882; private-catalog lexical 0.473 → 0.590 (ingestion 0.429 → 0.608, pipeline 0.430 → 0.506), the four long-document queries from 0 to 0.25–1.00, hybrid unchanged at 0.664 with 560/560 embedded and 0 skips (one input halved); `get_context` now delivers at most 1,199 of 1,200 tokens and the must-have concept in 26–27 of 38 questions (was 24–25); dev anchor-hit at the honest budget 0.900 alpinaria / 0.721 atlas (1.000 / 0.791 at 2,000).

Known issues carried into the milestone:
- Paraphrase queries on the real catalog stay unsolved (hybrid Recall@5 0.10 on 5 queries), consistent with the synonym shortfall below.
- Synonym-category Recall@5 0.542 on alpinaria (target 0.70; section units reach 0.594; embeddings alone reach 0.81 on dev synonyms, so fusion is the gap): per-query adaptive alpha is the follow-up (WP3c-2).
- Atlas section-anchor hit 0.791 at the default budget (target 0.80): 4 of 9 misses are candidate-step misses, 3 share no token with the query, 2 do not fit the budget; the acceptance test records the value instead of relaxing the threshold.
- Git-on write batch p95 ≈ 630–730 ms at 5k against a 500 ms budget (git preflight; WP6).
- 20k stretch tier: search p95 and RSS above the stretch ceilings (index memory item, post-milestone).
- Vector cache is machine-local; export/import and CI caching are WP6.
- Lock and directory races in the vector cache are narrowed, not closed (documented in the file headers).
- HTTP MCP transport, git sync, CI ratio gates, soak test and the 1.0 freeze are WP6, WP8, WP9.

## 12. Running the plan with multiple agents

File ownership while a WP is open: a file has one owner; others wait or send a patch to the owner's branch.

| Group | WPs | May start when | Owns |
|---|---|---|---|
| A | WP7 (done), WP0 (done), WP8 scaffolding | now | WP7: both large files, `test/mcp-contract-snapshot.test.js`, `test/snapshots/`; WP0: `test/fixtures/`, `scripts/`, `eval:search` |
| B | WP1 (done), WP2 (done), WP3b (in review) | WP7 merged, WP0 baseline committed | WP1: `src/search/`, `src/search-index.js`, `src/search.js`, `mcp/tools/search.js`; WP2: `src/indexer/`, `authoring/live.js`, `mcp/server.js` state; WP3b: `src/embed/`, `src/cache/`, `scripts/embed-smoke.js`, its tests (no `project.js`, no search files) |
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
