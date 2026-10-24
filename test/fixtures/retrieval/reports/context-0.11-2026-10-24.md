# Context evaluation — src/context/assemble.js (lexical)

Generated 2026-10-24T18:52:51.647Z · Node v24.17.0 (linux x64) · budget 1200 tokens (chars/4) · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-context.js` (`npm run eval:context`) over the queries with a `sectionAnchor` label. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest-context.{json,md}`; a committed report needs an explicit `--out`.

Anchor hit: the labelled `uri#slug` is among the packed sections (WP3a acceptance: ≥ 0.80 on dev on both fixtures). hit@1: it is the first section. Concept R@5: grade ≥ 1 concepts among the first five candidates of the search step. Candidate: the labelled concept is among the candidates (default 10). Latency is assembleContext after a warm-up pass.

| fixture | split | labelled | anchor hit (95% CI) | hit@1 (95% CI) | concept R@5 (95% CI) | candidate | mean tokens (95% CI) | mean sections | max tokens | over budget | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | dev | 40 | 1.000 [1.000, 1.000] | 0.225 [0.100, 0.350] | 0.831 [0.760, 0.896] | 1.000 | 531 [410, 648] | 11.9 | 1194 | 0 | 2.19 | 3.63 |
| alpinaria | heldout | 12 | 0.750 [0.500, 1.000] | 0.083 [0.000, 0.250] | 0.688 [0.465, 0.889] | 0.750 | 720 [474, 949] | 14.1 | 1185 | 0 | 2.50 | 3.54 |
| alpinaria | all | 52 | 0.942 [0.865, 1.000] | 0.192 [0.096, 0.308] | 0.798 [0.721, 0.869] | 0.942 | 574 [468, 694] | 12.4 | 1194 | 0 | 2.27 | 3.63 |
| atlas | dev | 43 | 0.860 [0.744, 0.953] | 0.163 [0.047, 0.279] | 0.738 [0.641, 0.831] | 0.907 | 464 [387, 538] | 11.7 | 960 | 0 | 3.02 | 3.71 |
| atlas | heldout | 15 | 0.800 [0.600, 1.000] | 0.333 [0.067, 0.600] | 0.801 [0.611, 0.944] | 0.867 | 383 [264, 510] | 10.4 | 756 | 0 | 2.94 | 3.61 |
| atlas | all | 58 | 0.845 [0.741, 0.931] | 0.207 [0.103, 0.310] | 0.755 [0.663, 0.838] | 0.897 | 443 [377, 514] | 11.3 | 960 | 0 | 3.01 | 3.76 |

## alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · 228 concepts · as-of 2026-10-24 · index build 127 ms · first (cold) call 214.8 ms

| missed query | split | labelled anchor | concept was a candidate |
|---|---|---|---|
| Q136 | heldout | `okf://alpinaria/keyword-clusters/cura-manutenzione-scarponi#parole-chiave-principali` | no |
| Q186 | heldout | `okf://alpinaria/brand-voice/tone-of-voice-en#do-not` | no |
| Q199 | heldout | `okf://alpinaria/products/trl-w-401-torrente-rapido-w#note-seo` | no |

## atlas

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · 167 concepts · as-of 2026-10-24 · index build 62 ms · first (cold) call 154.4 ms

| missed query | split | labelled anchor | concept was a candidate |
|---|---|---|---|
| A01 | heldout | `okf://atlas/incidents/inc-2026-001-validator-outage-bologna#causa-radice` | no |
| A02 | dev | `okf://atlas/decisions/adr-010-offline-validation-window#decision` | yes |
| A03 | dev | `okf://atlas/decisions/adr-019-data-retention-validations#decisione` | no |
| A07 | dev | `okf://atlas/decisions/adr-018-nexi-primary-psp#decision` | no |
| A45 | dev | `okf://atlas/runbooks/feature-flag-kill-switch#steps` | no |
| A46 | heldout | `okf://atlas/incidents/inc-2026-023-avl-feed-stale#root-cause` | yes |
| A47 | dev | `okf://atlas/questions/q-007-on-call-compensation#orientamento-attuale` | yes |
| A51 | dev | `okf://atlas/runbooks/on-call-escalation#steps` | no |
| A92 | heldout | `okf://atlas/dependencies/redis#where-it-is-used` | no |
