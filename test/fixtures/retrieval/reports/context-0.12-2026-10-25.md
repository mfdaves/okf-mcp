# Context evaluation — context 0.12 (lexical candidates, 1,200 tokens, compact provenance, confidence block)

Generated 2026-10-25T03:04:51.694Z · Node v24.17.0 (linux x64) · budget 1200 tokens (chars/4) · provenance compact (default) · preamble weight 0.5 · concept lift 4 · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-context.js` (`npm run eval:context`) over the queries with a `sectionAnchor` label. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest-context.{json,md}`; a committed report needs an explicit `--out`.

Anchor hit: the labelled `uri#slug` is among the packed sections (WP3a acceptance: ≥ 0.80 on dev on both fixtures). hit@1: it is the first section. Anchor MRR: mean of 1 / its rank among the packed sections (0 when absent); rank: median rank where it is packed. Concept R@5: grade ≥ 1 concepts among the first five candidates of the search step. Candidate: the labelled concept is among the candidates (default 10). Latency is assembleContext after a warm-up pass; the concept search index (built once by search_concepts too) and the first call are listed per fixture.

| fixture | split | labelled | anchor hit (95% CI) | hit@1 (95% CI) | anchor MRR (95% CI) | rank | concept R@5 (95% CI) | candidate | mean tokens (95% CI) | mean sections | max tokens | over budget | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | dev | 40 | 0.900 [0.800, 0.975] | 0.525 [0.375, 0.675] | 0.669 [0.544, 0.777] | 1 | 0.902 [0.844, 0.954] | 1.000 | 1157 [1145, 1167] | 5.0 | 1199 | 0 | 2.29 | 3.26 |
| alpinaria | heldout | 12 | 0.750 [0.500, 1.000] | 0.583 [0.333, 0.833] | 0.632 [0.382, 0.861] | 1 | 0.813 [0.667, 0.938] | 0.917 | 1155 [1134, 1174] | 4.8 | 1200 | 0 | 2.26 | 3.63 |
| alpinaria | all | 52 | 0.865 [0.769, 0.942] | 0.538 [0.404, 0.673] | 0.660 [0.548, 0.772] | 1 | 0.881 [0.825, 0.934] | 0.981 | 1157 [1147, 1167] | 5.0 | 1200 | 0 | 2.29 | 3.59 |
| atlas | dev | 43 | 0.698 [0.558, 0.837] | 0.279 [0.140, 0.419] | 0.430 [0.318, 0.548] | 2 | 0.828 [0.742, 0.903] | 0.953 | 1120 [1060, 1164] | 5.1 | 1197 | 0 | 4.43 | 6.00 |
| atlas | heldout | 15 | 0.733 [0.467, 0.933] | 0.333 [0.067, 0.533] | 0.500 [0.278, 0.700] | 2 | 0.868 [0.717, 0.978] | 0.933 | 1148 [1133, 1163] | 5.4 | 1197 | 0 | 3.60 | 5.62 |
| atlas | all | 58 | 0.707 [0.586, 0.828] | 0.293 [0.190, 0.414] | 0.448 [0.345, 0.549] | 2 | 0.838 [0.760, 0.905] | 0.948 | 1127 [1079, 1160] | 5.2 | 1197 | 0 | 4.23 | 6.00 |

Secondary line, the same queries at a larger budget:

| fixture | split | budget | anchor hit (95% CI) | anchor MRR | mean sections | over budget |
|---|---|---|---|---|---|---|
| alpinaria | dev | 2000 | 1.000 [1.000, 1.000] | 0.685 | 9.8 | 0 |
| alpinaria | heldout | 2000 | 0.833 [0.583, 1.000] | 0.646 | 9.3 | 0 |
| alpinaria | all | 2000 | 0.962 [0.904, 1.000] | 0.676 | 9.7 | 0 |
| atlas | dev | 2000 | 0.791 [0.674, 0.907] | 0.445 | 10.0 | 0 |
| atlas | heldout | 2000 | 0.800 [0.600, 1.000] | 0.507 | 10.5 | 0 |
| atlas | all | 2000 | 0.793 [0.672, 0.897] | 0.461 | 10.1 | 0 |

**Shortfall (atlas):** dev anchor hit 0.698 is below the pre-registered 0.8. Of 13 dev misses: 6 ranked below the budget, 5 no shared token with the query, 2 concept not a candidate. Both main causes are lexical limits: a labelled concept the search step does not retrieve (paraphrase or cross-language queries), and a labelled section that shares no token with its query, which only its concept's metadata reaches and which therefore ranks after the concept's own-text matches. TODO WP3c-2: lexical ceiling, section embeddings expected to recover these.

## Concept lift, dev split only

| fixture | lift | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 0 | 40 | 0.825 | 0.622 | 0.525 |
| alpinaria | 2 | 40 | 0.850 | 0.630 | 0.525 |
| alpinaria | 4 | 40 | 0.900 | 0.669 | 0.525 |
| atlas | 0 | 43 | 0.721 | 0.445 | 0.279 |
| atlas | 2 | 43 | 0.721 | 0.447 | 0.279 |
| atlas | 4 | 43 | 0.698 | 0.430 | 0.279 |

## Preamble weight, dev split only

| fixture | weight | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 1 | 40 | 0.900 | 0.584 | 0.450 |
| alpinaria | 0.7 | 40 | 0.900 | 0.635 | 0.500 |
| alpinaria | 0.5 | 40 | 0.900 | 0.669 | 0.525 |
| atlas | 1 | 43 | 0.651 | 0.393 | 0.256 |
| atlas | 0.7 | 43 | 0.674 | 0.417 | 0.279 |
| atlas | 0.5 | 43 | 0.698 | 0.430 | 0.279 |

## alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · 228 concepts · as-of 2026-10-24 · index build 134 ms · concept search index 117 ms · first context call 24.0 ms

| missed query | split | labelled anchor | concept was a candidate | cause |
|---|---|---|---|---|
| Q13 | dev | `okf://alpinaria/keyword-clusters/calze-trekking-merino#parole-chiave-principali` | yes | ranked below the budget |
| Q17 | heldout | `okf://alpinaria/keyword-clusters/giacca-impermeabile-montagna#parole-chiave-principali` | yes | ranked below the budget |
| Q18 | dev | `okf://alpinaria/keyword-clusters/trail-running-shoes-eu#head-terms` | yes | ranked below the budget |
| Q22 | dev | `okf://alpinaria/policies/green-claims#consentito--allowed` | yes | ranked below the budget |
| Q92 | dev | `okf://alpinaria/keyword-clusters/italian-hiking-boots-brand#head-terms` | yes | ranked below the budget |
| Q136 | heldout | `okf://alpinaria/keyword-clusters/cura-manutenzione-scarponi#parole-chiave-principali` | no | concept not a candidate |
| Q186 | heldout | `okf://alpinaria/brand-voice/tone-of-voice-en#do-not` | yes | no shared token with the query |

## atlas

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · 167 concepts · as-of 2026-10-24 · index build 34 ms · concept search index 33 ms · first context call 10.0 ms

| missed query | split | labelled anchor | concept was a candidate | cause |
|---|---|---|---|---|
| A01 | heldout | `okf://atlas/incidents/inc-2026-001-validator-outage-bologna#causa-radice` | yes | ranked below the budget |
| A02 | dev | `okf://atlas/decisions/adr-010-offline-validation-window#decision` | yes | ranked below the budget |
| A03 | dev | `okf://atlas/decisions/adr-019-data-retention-validations#decisione` | yes | ranked below the budget |
| A04 | dev | `okf://atlas/teams/team-pagamenti#lead-and-on-call` | yes | no shared token with the query |
| A05 | dev | `okf://atlas/incidents/inc-2026-027-subscription-renewal-duplicate#root-cause` | yes | ranked below the budget |
| A07 | dev | `okf://atlas/decisions/adr-018-nexi-primary-psp#decision` | yes | no shared token with the query |
| A09 | dev | `okf://atlas/incidents/inc-2026-013-spid-login-down#causa-radice` | yes | ranked below the budget |
| A22 | dev | `okf://atlas/runbooks/wallet-balance-reconciliation#steps` | yes | ranked below the budget |
| A34 | dev | `okf://atlas/runbooks/rotate-psp-credentials#steps` | yes | no shared token with the query |
| A36 | dev | `okf://atlas/runbooks/certificate-renewal#steps` | yes | ranked below the budget |
| A45 | dev | `okf://atlas/runbooks/feature-flag-kill-switch#steps` | no | concept not a candidate |
| A46 | heldout | `okf://atlas/incidents/inc-2026-023-avl-feed-stale#root-cause` | yes | no evidence |
| A47 | dev | `okf://atlas/questions/q-007-on-call-compensation#orientamento-attuale` | yes | no shared token with the query |
| A51 | dev | `okf://atlas/runbooks/on-call-escalation#steps` | no | concept not a candidate |
| A92 | heldout | `okf://atlas/dependencies/redis#where-it-is-used` | no | concept not a candidate |
| A94 | dev | `okf://atlas/services/inspector-app-backend#dipendenze` | yes | no shared token with the query |
| A96 | heldout | `okf://atlas/runbooks/postgres-failover#prerequisites` | yes | no shared token with the query |

## WP3c-2 notes (0.12.0-rc.1)

- Candidates still come from the lexical search: `get_context` does not use the embedder in 0.12, so contextual section embeddings do not reach it and the atlas shortfall above keeps its causes (hybrid candidates for `get_context` are a proposed follow-up; library callers can pass the hybrid search options through `assembleContext`).
- Every response now carries `confidence: { coverage, topSimilarity, lowConfidence, reasons }` (about 70 characters, 18 tokens of the budget). Compared with `context-0.11-2026-10-24`, every labelled query keeps its result except atlas A94 (dev), whose labelled section was packed fifth and no longer fits at 1,200 tokens: atlas dev anchor hit 0.721 -> 0.698, held-out unchanged at 0.733; alpinaria unchanged (0.900 dev, 0.750 held-out); the 2,000-token line is unchanged (1.000 / 0.791 dev).
- `abstainOnLowConfidence: true` returns no sections when the candidate search is low-confidence; with lexical candidates that is the 0.10 rule (any-term fallback with a top coverage below 0.5), so it abstains on the queries lexical search flags (alpinaria 11/22 no-answer queries, 4 of 181 answerable queries with a relevant top-1; atlas 7/10 and 1 of 89).
