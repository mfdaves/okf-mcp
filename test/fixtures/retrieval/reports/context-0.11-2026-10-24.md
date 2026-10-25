# Context evaluation — src/context/assemble.js (lexical)

Generated 2026-10-25T02:00:59.361Z · Node v24.17.0 (linux x64) · budget 1200 tokens (chars/4) · provenance compact (default) · preamble weight 0.5 · concept lift 4 · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-context.js` (`npm run eval:context`) over the queries with a `sectionAnchor` label. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest-context.{json,md}`; a committed report needs an explicit `--out`.

Anchor hit: the labelled `uri#slug` is among the packed sections (WP3a acceptance: ≥ 0.80 on dev on both fixtures). hit@1: it is the first section. Anchor MRR: mean of 1 / its rank among the packed sections (0 when absent); rank: median rank where it is packed. Concept R@5: grade ≥ 1 concepts among the first five candidates of the search step. Candidate: the labelled concept is among the candidates (default 10). Latency is assembleContext after a warm-up pass; the concept search index (built once by search_concepts too) and the first call are listed per fixture.

| fixture | split | labelled | anchor hit (95% CI) | hit@1 (95% CI) | anchor MRR (95% CI) | rank | concept R@5 (95% CI) | candidate | mean tokens (95% CI) | mean sections | max tokens | over budget | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | dev | 40 | 0.900 [0.800, 0.975] | 0.525 [0.375, 0.675] | 0.669 [0.544, 0.777] | 1 | 0.902 [0.844, 0.954] | 1.000 | 1151 [1139, 1162] | 5.1 | 1198 | 0 | 5.86 | 7.41 |
| alpinaria | heldout | 12 | 0.750 [0.500, 1.000] | 0.583 [0.333, 0.833] | 0.632 [0.382, 0.861] | 1 | 0.813 [0.667, 0.938] | 0.917 | 1160 [1142, 1178] | 4.9 | 1199 | 0 | 5.51 | 6.03 |
| alpinaria | all | 52 | 0.865 [0.769, 0.942] | 0.538 [0.404, 0.673] | 0.660 [0.548, 0.772] | 1 | 0.881 [0.825, 0.934] | 0.981 | 1153 [1143, 1163] | 5.1 | 1199 | 0 | 5.72 | 6.95 |
| atlas | dev | 43 | 0.721 [0.605, 0.860] | 0.279 [0.140, 0.419] | 0.435 [0.322, 0.553] | 2 | 0.828 [0.742, 0.903] | 0.953 | 1115 [1052, 1161] | 5.2 | 1200 | 0 | 3.58 | 5.75 |
| atlas | heldout | 15 | 0.733 [0.467, 0.933] | 0.333 [0.067, 0.533] | 0.500 [0.278, 0.700] | 2 | 0.868 [0.717, 0.978] | 0.933 | 1140 [1122, 1158] | 5.5 | 1197 | 0 | 3.73 | 5.90 |
| atlas | all | 58 | 0.724 [0.603, 0.828] | 0.293 [0.190, 0.414] | 0.452 [0.353, 0.553] | 2 | 0.838 [0.760, 0.905] | 0.948 | 1121 [1072, 1156] | 5.3 | 1200 | 0 | 3.59 | 5.93 |

Secondary line, the same queries at a larger budget:

| fixture | split | budget | anchor hit (95% CI) | anchor MRR | mean sections | over budget |
|---|---|---|---|---|---|---|
| alpinaria | dev | 2000 | 1.000 [1.000, 1.000] | 0.685 | 10.0 | 0 |
| alpinaria | heldout | 2000 | 0.833 [0.583, 1.000] | 0.646 | 9.5 | 0 |
| alpinaria | all | 2000 | 0.962 [0.904, 1.000] | 0.676 | 9.9 | 0 |
| atlas | dev | 2000 | 0.791 [0.674, 0.907] | 0.445 | 10.0 | 0 |
| atlas | heldout | 2000 | 0.800 [0.600, 1.000] | 0.507 | 10.7 | 0 |
| atlas | all | 2000 | 0.793 [0.672, 0.897] | 0.461 | 10.2 | 0 |

**Shortfall (atlas):** dev anchor hit 0.721 is below the pre-registered 0.8. Of 12 dev misses: 6 ranked below the budget, 4 no shared token with the query, 2 concept not a candidate. Both main causes are lexical limits: a labelled concept the search step does not retrieve (paraphrase or cross-language queries), and a labelled section that shares no token with its query, which only its concept's metadata reaches and which therefore ranks after the concept's own-text matches. TODO WP3c-2: lexical ceiling, section embeddings expected to recover these.

## Concept lift, dev split only

| fixture | lift | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 0 | 40 | 0.825 | 0.622 | 0.525 |
| alpinaria | 2 | 40 | 0.875 | 0.635 | 0.525 |
| alpinaria | 4 | 40 | 0.900 | 0.669 | 0.525 |
| atlas | 0 | 43 | 0.721 | 0.445 | 0.279 |
| atlas | 2 | 43 | 0.698 | 0.443 | 0.279 |
| atlas | 4 | 43 | 0.721 | 0.435 | 0.279 |

## Preamble weight, dev split only

| fixture | weight | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 1 | 40 | 0.875 | 0.580 | 0.450 |
| alpinaria | 0.7 | 40 | 0.900 | 0.635 | 0.500 |
| alpinaria | 0.5 | 40 | 0.900 | 0.669 | 0.525 |
| atlas | 1 | 43 | 0.651 | 0.393 | 0.256 |
| atlas | 0.7 | 43 | 0.674 | 0.417 | 0.279 |
| atlas | 0.5 | 43 | 0.721 | 0.435 | 0.279 |

## alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · 228 concepts · as-of 2026-10-24 · index build 193 ms · concept search index 169 ms · first context call 28.4 ms

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

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · 167 concepts · as-of 2026-10-24 · index build 45 ms · concept search index 39 ms · first context call 14.0 ms

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
| A96 | heldout | `okf://atlas/runbooks/postgres-failover#prerequisites` | yes | no shared token with the query |
