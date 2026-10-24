# Context evaluation — src/context/assemble.js (lexical)

Generated 2026-10-24T19:39:28.294Z · Node v24.17.0 (linux x64) · budget 1200 tokens (chars/4) · provenance compact (default) · preamble weight 0.5 · concept lift 4 · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-context.js` (`npm run eval:context`) over the queries with a `sectionAnchor` label. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest-context.{json,md}`; a committed report needs an explicit `--out`.

Anchor hit: the labelled `uri#slug` is among the packed sections (WP3a acceptance: ≥ 0.80 on dev on both fixtures). hit@1: it is the first section. Anchor MRR: mean of 1 / its rank among the packed sections (0 when absent); rank: median rank where it is packed. Concept R@5: grade ≥ 1 concepts among the first five candidates of the search step. Candidate: the labelled concept is among the candidates (default 10). Latency is assembleContext after a warm-up pass; the concept search index (built once by search_concepts too) and the first call are listed per fixture.

| fixture | split | labelled | anchor hit (95% CI) | hit@1 (95% CI) | anchor MRR (95% CI) | rank | concept R@5 (95% CI) | candidate | mean tokens (95% CI) | mean sections | max tokens | over budget | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | dev | 40 | 1.000 [1.000, 1.000] | 0.475 [0.325, 0.625] | 0.662 [0.554, 0.760] | 2 | 0.831 [0.760, 0.896] | 1.000 | 921 [820, 1018] | 7.3 | 1199 | 0 | 7.41 | 13.41 |
| alpinaria | heldout | 12 | 0.750 [0.500, 1.000] | 0.583 [0.333, 0.833] | 0.618 [0.368, 0.854] | 1 | 0.688 [0.465, 0.889] | 0.750 | 956 [790, 1119] | 7.3 | 1197 | 0 | 7.63 | 10.09 |
| alpinaria | all | 52 | 0.942 [0.865, 1.000] | 0.500 [0.365, 0.654] | 0.652 [0.554, 0.761] | 1 | 0.798 [0.721, 0.869] | 0.942 | 929 [845, 1014] | 7.3 | 1199 | 0 | 7.51 | 12.65 |
| atlas | dev | 43 | 0.791 [0.674, 0.907] | 0.279 [0.163, 0.419] | 0.459 [0.354, 0.579] | 2 | 0.738 [0.641, 0.831] | 0.907 | 941 [855, 1015] | 7.7 | 1197 | 0 | 8.64 | 12.50 |
| atlas | heldout | 15 | 0.733 [0.467, 0.933] | 0.333 [0.133, 0.533] | 0.511 [0.311, 0.689] | 2 | 0.801 [0.611, 0.944] | 0.867 | 868 [731, 1008] | 7.5 | 1188 | 0 | 8.09 | 10.34 |
| atlas | all | 58 | 0.776 [0.655, 0.879] | 0.293 [0.172, 0.397] | 0.473 [0.376, 0.570] | 2 | 0.755 [0.663, 0.838] | 0.897 | 922 [847, 996] | 7.6 | 1197 | 0 | 8.45 | 12.50 |

Secondary line, the same queries at a larger budget:

| fixture | split | budget | anchor hit (95% CI) | anchor MRR | mean sections | over budget |
|---|---|---|---|---|---|---|
| alpinaria | dev | 2000 | 1.000 [1.000, 1.000] | 0.662 | 10.0 | 0 |
| alpinaria | heldout | 2000 | 0.750 [0.500, 1.000] | 0.618 | 11.3 | 0 |
| alpinaria | all | 2000 | 0.942 [0.865, 1.000] | 0.652 | 10.3 | 0 |
| atlas | dev | 2000 | 0.837 [0.721, 0.953] | 0.462 | 10.5 | 0 |
| atlas | heldout | 2000 | 0.800 [0.600, 1.000] | 0.518 | 9.7 | 0 |
| atlas | all | 2000 | 0.828 [0.724, 0.914] | 0.477 | 10.3 | 0 |

**Shortfall (atlas):** dev anchor hit 0.791 is below the pre-registered 0.8. Of 9 dev misses: 2 ranked below the budget, 4 concept not a candidate, 3 no shared token with the query. Both main causes are lexical limits: a labelled concept the search step does not retrieve (paraphrase or cross-language queries), and a labelled section that shares no token with its query, which only its concept's metadata reaches and which therefore ranks after the concept's own-text matches. TODO WP3c-2: lexical ceiling, section embeddings expected to recover these.

## Concept lift, dev split only

| fixture | lift | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 0 | 40 | 0.950 | 0.612 | 0.475 |
| alpinaria | 2 | 40 | 0.950 | 0.617 | 0.475 |
| alpinaria | 4 | 40 | 1.000 | 0.662 | 0.475 |
| atlas | 0 | 43 | 0.767 | 0.460 | 0.279 |
| atlas | 2 | 43 | 0.791 | 0.465 | 0.279 |
| atlas | 4 | 43 | 0.791 | 0.459 | 0.279 |

## Preamble weight, dev split only

| fixture | weight | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 1 | 40 | 1.000 | 0.588 | 0.425 |
| alpinaria | 0.7 | 40 | 1.000 | 0.618 | 0.425 |
| alpinaria | 0.5 | 40 | 1.000 | 0.662 | 0.475 |
| atlas | 1 | 43 | 0.791 | 0.411 | 0.209 |
| atlas | 0.7 | 43 | 0.791 | 0.443 | 0.256 |
| atlas | 0.5 | 43 | 0.791 | 0.459 | 0.279 |

## alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · 228 concepts · as-of 2026-10-24 · index build 382 ms · concept search index 305 ms · first context call 43.5 ms

| missed query | split | labelled anchor | concept was a candidate | cause |
|---|---|---|---|---|
| Q136 | heldout | `okf://alpinaria/keyword-clusters/cura-manutenzione-scarponi#parole-chiave-principali` | no | concept not a candidate |
| Q186 | heldout | `okf://alpinaria/brand-voice/tone-of-voice-en#do-not` | no | concept not a candidate |
| Q199 | heldout | `okf://alpinaria/products/trl-w-401-torrente-rapido-w#note-seo` | no | concept not a candidate |

## atlas

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · 167 concepts · as-of 2026-10-24 · index build 175 ms · concept search index 202 ms · first context call 10.2 ms

| missed query | split | labelled anchor | concept was a candidate | cause |
|---|---|---|---|---|
| A01 | heldout | `okf://atlas/incidents/inc-2026-001-validator-outage-bologna#causa-radice` | no | concept not a candidate |
| A02 | dev | `okf://atlas/decisions/adr-010-offline-validation-window#decision` | yes | ranked below the budget |
| A03 | dev | `okf://atlas/decisions/adr-019-data-retention-validations#decisione` | no | concept not a candidate |
| A04 | dev | `okf://atlas/teams/team-pagamenti#lead-and-on-call` | yes | no shared token with the query |
| A07 | dev | `okf://atlas/decisions/adr-018-nexi-primary-psp#decision` | no | concept not a candidate |
| A22 | dev | `okf://atlas/runbooks/wallet-balance-reconciliation#steps` | yes | ranked below the budget |
| A45 | dev | `okf://atlas/runbooks/feature-flag-kill-switch#steps` | no | concept not a candidate |
| A46 | heldout | `okf://atlas/incidents/inc-2026-023-avl-feed-stale#root-cause` | yes | no evidence |
| A47 | dev | `okf://atlas/questions/q-007-on-call-compensation#orientamento-attuale` | yes | no shared token with the query |
| A51 | dev | `okf://atlas/runbooks/on-call-escalation#steps` | no | concept not a candidate |
| A92 | heldout | `okf://atlas/dependencies/redis#where-it-is-used` | no | concept not a candidate |
| A94 | dev | `okf://atlas/services/inspector-app-backend#dipendenze` | yes | no shared token with the query |
| A96 | heldout | `okf://atlas/runbooks/postgres-failover#prerequisites` | yes | no shared token with the query |
