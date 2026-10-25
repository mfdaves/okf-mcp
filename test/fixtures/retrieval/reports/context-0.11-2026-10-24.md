# Context evaluation — src/context/assemble.js (lexical)

Generated 2026-10-25T01:50:04.863Z · Node v24.17.0 (linux x64) · budget 1200 tokens (chars/4) · provenance compact (default) · preamble weight 0.5 · concept lift 4 · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-context.js` (`npm run eval:context`) over the queries with a `sectionAnchor` label. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest-context.{json,md}`; a committed report needs an explicit `--out`.

Anchor hit: the labelled `uri#slug` is among the packed sections (WP3a acceptance: ≥ 0.80 on dev on both fixtures). hit@1: it is the first section. Anchor MRR: mean of 1 / its rank among the packed sections (0 when absent); rank: median rank where it is packed. Concept R@5: grade ≥ 1 concepts among the first five candidates of the search step. Candidate: the labelled concept is among the candidates (default 10). Latency is assembleContext after a warm-up pass; the concept search index (built once by search_concepts too) and the first call are listed per fixture.

| fixture | split | labelled | anchor hit (95% CI) | hit@1 (95% CI) | anchor MRR (95% CI) | rank | concept R@5 (95% CI) | candidate | mean tokens (95% CI) | mean sections | max tokens | over budget | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | dev | 40 | 1.000 [1.000, 1.000] | 0.525 [0.375, 0.675] | 0.685 [0.574, 0.785] | 1 | 0.902 [0.844, 0.954] | 1.000 | 1168 [1160, 1176] | 9.2 | 1200 | 0 | 2.32 | 3.63 |
| alpinaria | heldout | 12 | 0.833 [0.583, 1.000] | 0.583 [0.333, 0.833] | 0.646 [0.396, 0.875] | 1 | 0.813 [0.667, 0.938] | 0.917 | 1163 [1147, 1178] | 8.8 | 1197 | 0 | 2.26 | 3.05 |
| alpinaria | all | 52 | 0.962 [0.904, 1.000] | 0.538 [0.404, 0.673] | 0.676 [0.569, 0.782] | 1 | 0.881 [0.825, 0.934] | 0.981 | 1167 [1159, 1174] | 9.1 | 1200 | 0 | 2.29 | 3.51 |
| atlas | dev | 43 | 0.791 [0.674, 0.907] | 0.279 [0.140, 0.419] | 0.445 [0.336, 0.562] | 2 | 0.828 [0.742, 0.903] | 0.953 | 1110 [1040, 1162] | 9.1 | 1199 | 0 | 3.65 | 5.26 |
| atlas | heldout | 15 | 0.733 [0.467, 0.933] | 0.333 [0.067, 0.533] | 0.500 [0.278, 0.700] | 2 | 0.868 [0.717, 0.978] | 0.933 | 1149 [1110, 1174] | 9.7 | 1198 | 0 | 3.76 | 5.40 |
| atlas | all | 58 | 0.776 [0.655, 0.879] | 0.293 [0.190, 0.414] | 0.459 [0.363, 0.556] | 2 | 0.838 [0.760, 0.905] | 0.948 | 1120 [1061, 1160] | 9.3 | 1199 | 0 | 3.65 | 5.40 |

Secondary line, the same queries at a larger budget:

| fixture | split | budget | anchor hit (95% CI) | anchor MRR | mean sections | over budget |
|---|---|---|---|---|---|---|
| alpinaria | dev | 2000 | 1.000 [1.000, 1.000] | 0.685 | 14.7 | 0 |
| alpinaria | heldout | 2000 | 0.917 [0.750, 1.000] | 0.653 | 14.8 | 0 |
| alpinaria | all | 2000 | 0.981 [0.942, 1.000] | 0.677 | 14.7 | 0 |
| atlas | dev | 2000 | 0.860 [0.767, 0.953] | 0.449 | 15.0 | 0 |
| atlas | heldout | 2000 | 0.867 [0.667, 1.000] | 0.511 | 15.3 | 0 |
| atlas | all | 2000 | 0.862 [0.759, 0.948] | 0.465 | 15.1 | 0 |

**Shortfall (atlas):** dev anchor hit 0.791 is below the pre-registered 0.8. Of 9 dev misses: 3 ranked below the budget, 4 no shared token with the query, 2 concept not a candidate. Both main causes are lexical limits: a labelled concept the search step does not retrieve (paraphrase or cross-language queries), and a labelled section that shares no token with its query, which only its concept's metadata reaches and which therefore ranks after the concept's own-text matches. TODO WP3c-2: lexical ceiling, section embeddings expected to recover these.

## Concept lift, dev split only

| fixture | lift | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 0 | 40 | 0.950 | 0.640 | 0.525 |
| alpinaria | 2 | 40 | 0.950 | 0.646 | 0.525 |
| alpinaria | 4 | 40 | 1.000 | 0.685 | 0.525 |
| atlas | 0 | 43 | 0.767 | 0.453 | 0.279 |
| atlas | 2 | 43 | 0.791 | 0.458 | 0.279 |
| atlas | 4 | 43 | 0.791 | 0.445 | 0.279 |

## Preamble weight, dev split only

| fixture | weight | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 1 | 40 | 1.000 | 0.599 | 0.450 |
| alpinaria | 0.7 | 40 | 1.000 | 0.651 | 0.500 |
| alpinaria | 0.5 | 40 | 1.000 | 0.685 | 0.525 |
| atlas | 1 | 43 | 0.791 | 0.413 | 0.256 |
| atlas | 0.7 | 43 | 0.791 | 0.434 | 0.279 |
| atlas | 0.5 | 43 | 0.791 | 0.445 | 0.279 |

## alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · 228 concepts · as-of 2026-10-24 · index build 92 ms · concept search index 80 ms · first context call 13.2 ms

| missed query | split | labelled anchor | concept was a candidate | cause |
|---|---|---|---|---|
| Q136 | heldout | `okf://alpinaria/keyword-clusters/cura-manutenzione-scarponi#parole-chiave-principali` | no | concept not a candidate |
| Q186 | heldout | `okf://alpinaria/brand-voice/tone-of-voice-en#do-not` | yes | no shared token with the query |

## atlas

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · 167 concepts · as-of 2026-10-24 · index build 39 ms · concept search index 53 ms · first context call 7.6 ms

| missed query | split | labelled anchor | concept was a candidate | cause |
|---|---|---|---|---|
| A01 | heldout | `okf://atlas/incidents/inc-2026-001-validator-outage-bologna#causa-radice` | yes | ranked below the budget |
| A02 | dev | `okf://atlas/decisions/adr-010-offline-validation-window#decision` | yes | ranked below the budget |
| A03 | dev | `okf://atlas/decisions/adr-019-data-retention-validations#decisione` | yes | ranked below the budget |
| A04 | dev | `okf://atlas/teams/team-pagamenti#lead-and-on-call` | yes | no shared token with the query |
| A07 | dev | `okf://atlas/decisions/adr-018-nexi-primary-psp#decision` | yes | no shared token with the query |
| A22 | dev | `okf://atlas/runbooks/wallet-balance-reconciliation#steps` | yes | ranked below the budget |
| A45 | dev | `okf://atlas/runbooks/feature-flag-kill-switch#steps` | no | concept not a candidate |
| A46 | heldout | `okf://atlas/incidents/inc-2026-023-avl-feed-stale#root-cause` | yes | no evidence |
| A47 | dev | `okf://atlas/questions/q-007-on-call-compensation#orientamento-attuale` | yes | no shared token with the query |
| A51 | dev | `okf://atlas/runbooks/on-call-escalation#steps` | no | concept not a candidate |
| A92 | heldout | `okf://atlas/dependencies/redis#where-it-is-used` | no | concept not a candidate |
| A94 | dev | `okf://atlas/services/inspector-app-backend#dipendenze` | yes | no shared token with the query |
| A96 | heldout | `okf://atlas/runbooks/postgres-failover#prerequisites` | yes | no shared token with the query |
