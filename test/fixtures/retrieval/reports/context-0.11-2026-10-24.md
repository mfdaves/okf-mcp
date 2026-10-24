# Context evaluation — src/context/assemble.js (lexical)

Generated 2026-10-24T19:01:01.713Z · Node v24.17.0 (linux x64) · budget 1200 tokens (chars/4) · preamble weight 0.5 · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-context.js` (`npm run eval:context`) over the queries with a `sectionAnchor` label. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest-context.{json,md}`; a committed report needs an explicit `--out`.

Anchor hit: the labelled `uri#slug` is among the packed sections (WP3a acceptance: ≥ 0.80 on dev on both fixtures). hit@1: it is the first section. Anchor MRR: mean of 1 / its rank among the packed sections (0 when absent); rank: median rank where it is packed. Concept R@5: grade ≥ 1 concepts among the first five candidates of the search step. Candidate: the labelled concept is among the candidates (default 10). Latency is assembleContext after a warm-up pass; the concept search index (built once by search_concepts too) and the first call are listed per fixture.

| fixture | split | labelled | anchor hit (95% CI) | hit@1 (95% CI) | anchor MRR (95% CI) | rank | concept R@5 (95% CI) | candidate | mean tokens (95% CI) | mean sections | max tokens | over budget | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | dev | 40 | 1.000 [1.000, 1.000] | 0.675 [0.525, 0.825] | 0.807 [0.718, 0.892] | 1 | 0.831 [0.760, 0.896] | 1.000 | 560 [427, 693] | 11.8 | 1197 | 0 | 3.16 | 5.04 |
| alpinaria | heldout | 12 | 0.750 [0.500, 1.000] | 0.583 [0.250, 0.833] | 0.639 [0.361, 0.889] | 1 | 0.688 [0.465, 0.889] | 0.750 | 736 [485, 973] | 14.1 | 1197 | 0 | 3.51 | 4.16 |
| alpinaria | all | 52 | 0.942 [0.865, 1.000] | 0.654 [0.519, 0.788] | 0.768 [0.677, 0.859] | 1 | 0.798 [0.721, 0.869] | 0.942 | 600 [481, 727] | 12.3 | 1197 | 0 | 3.31 | 5.04 |
| atlas | dev | 43 | 0.860 [0.744, 0.953] | 0.488 [0.349, 0.651] | 0.557 [0.426, 0.693] | 1 | 0.738 [0.641, 0.831] | 0.907 | 468 [392, 545] | 11.7 | 1085 | 0 | 3.97 | 5.55 |
| atlas | heldout | 15 | 0.800 [0.600, 1.000] | 0.467 [0.200, 0.667] | 0.554 [0.318, 0.767] | 1 | 0.801 [0.611, 0.944] | 0.867 | 374 [263, 499] | 10.4 | 789 | 0 | 3.91 | 5.28 |
| atlas | all | 58 | 0.845 [0.741, 0.931] | 0.483 [0.345, 0.603] | 0.556 [0.434, 0.664] | 1 | 0.755 [0.663, 0.838] | 0.897 | 444 [376, 514] | 11.3 | 1085 | 0 | 3.93 | 5.88 |

## Preamble weight, dev split only

| fixture | weight | dev queries | anchor hit | anchor MRR | hit@1 |
|---|---|---|---|---|---|
| alpinaria | 1 | 40 | 1.000 | 0.722 | 0.575 |
| alpinaria | 0.7 | 40 | 1.000 | 0.803 | 0.675 |
| alpinaria | 0.5 | 40 | 1.000 | 0.807 | 0.675 |
| atlas | 1 | 43 | 0.837 | 0.548 | 0.488 |
| atlas | 0.7 | 43 | 0.860 | 0.556 | 0.488 |
| atlas | 0.5 | 43 | 0.860 | 0.557 | 0.488 |

## alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · 228 concepts · as-of 2026-10-24 · index build 156 ms · concept search index 122 ms · first context call 17.2 ms

| missed query | split | labelled anchor | concept was a candidate |
|---|---|---|---|
| Q136 | heldout | `okf://alpinaria/keyword-clusters/cura-manutenzione-scarponi#parole-chiave-principali` | no |
| Q186 | heldout | `okf://alpinaria/brand-voice/tone-of-voice-en#do-not` | no |
| Q199 | heldout | `okf://alpinaria/products/trl-w-401-torrente-rapido-w#note-seo` | no |

## atlas

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · 167 concepts · as-of 2026-10-24 · index build 63 ms · concept search index 74 ms · first context call 5.8 ms

| missed query | split | labelled anchor | concept was a candidate |
|---|---|---|---|
| A01 | heldout | `okf://atlas/incidents/inc-2026-001-validator-outage-bologna#causa-radice` | no |
| A03 | dev | `okf://atlas/decisions/adr-019-data-retention-validations#decisione` | no |
| A07 | dev | `okf://atlas/decisions/adr-018-nexi-primary-psp#decision` | no |
| A09 | dev | `okf://atlas/incidents/inc-2026-013-spid-login-down#causa-radice` | yes |
| A45 | dev | `okf://atlas/runbooks/feature-flag-kill-switch#steps` | no |
| A46 | heldout | `okf://atlas/incidents/inc-2026-023-avl-feed-stale#root-cause` | yes |
| A51 | dev | `okf://atlas/runbooks/on-call-escalation#steps` | no |
| A57 | dev | `okf://atlas/postmortems/pm-2026-001-validator-outage#sintesi` | yes |
| A92 | heldout | `okf://atlas/dependencies/redis#where-it-is-used` | no |
