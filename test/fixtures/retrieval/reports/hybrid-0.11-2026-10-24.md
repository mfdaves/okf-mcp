# Retrieval evaluation — hybrid 0.11 (text-embedding-3-small, 512 dims, section units, shipped defaults)

Generated 2026-10-24T19:55:01.637Z · Node v24.17.0 (linux x64, gc exposed: false) · search module `src/search/query.js` with options `{"hybrid":true,"alpha":0.5,"normalization":"lexical-tmm","embedUnits":"sections"}` · limit 10 · split all · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-search.js`. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest.{json,md}`; a committed baseline is produced only with an explicit `--out test/fixtures/retrieval/reports/baseline-{date}`.

## Summary

| fixture | queries | Recall@5 (95% CI) | nDCG@10 (95% CI) | MRR@10 | P@1 | zero-result | no-answer returned any | lowConfidence P / R | p95 ms | RSS MB |
|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | 203 | 0.835 [0.796, 0.870] | 0.861 [0.831, 0.887] | 0.929 | 0.895 | 0.0% | 100.0% | 70.6% / 54.5% | 2.66 | 194 |
| atlas | 99 | 0.874 [0.820, 0.923] | 0.849 [0.800, 0.894] | 0.873 | 0.809 | 0.0% | 100.0% | 60.0% / 60.0% | 3.06 | 158.5 |

## Fixture alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · bundles alpinaria (209), playbook (21) · 228 concepts · valid for project: true · as-of 2026-10-24 · split all  
Queries: 203 (181 answerable, 22 no-answer, 52 with sectionAnchor)

### Overall (answerable queries, 95% bootstrap CI)

| metric | value | 95% CI |
|---|---|---|
| Recall@5 | 0.835 | [0.796, 0.870] |
| MustRecall@5 | 0.931 | [0.895, 0.961] |
| nDCG@10 | 0.861 | [0.831, 0.887] |
| MRR@10 | 0.929 | [0.895, 0.959] |
| P@1 | 0.895 | [0.845, 0.934] |
| hit@10 | 0.994 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 11/34 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 11 | 84.8% | 90.9% | 0.827 | 0.841 | 81.8% | 90.9% | 0.0% | – |
| disambig | 12 | 93.1% | 91.7% | 0.889 | 1.000 | 100.0% | 100.0% | 0.0% | 2/12 |
| exact | 18 | 85.9% | 88.9% | 0.904 | 0.958 | 94.4% | 100.0% | 0.0% | 0/1 |
| freshness | 11 | 97.7% | 100.0% | 0.880 | 1.000 | 100.0% | 100.0% | 0.0% | 7/11 |
| keyword | 22 | 81.9% | 97.7% | 0.819 | 0.902 | 86.4% | 100.0% | 0.0% | 0/2 |
| mixed-lang | 14 | 90.5% | 100.0% | 0.899 | 0.964 | 92.9% | 100.0% | 0.0% | 1/2 |
| morph | 16 | 76.6% | 90.6% | 0.878 | 0.945 | 93.8% | 100.0% | 0.0% | 0/1 |
| nl-task | 52 | 84.7% | 97.1% | 0.908 | 0.958 | 92.3% | 100.0% | 0.0% | 1/5 |
| playbook | 9 | 88.0% | 100.0% | 0.816 | 0.911 | 88.9% | 100.0% | 0.0% | – |
| synonym | 16 | 59.4% | 68.8% | 0.685 | 0.759 | 62.5% | 100.0% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 85 | 81.5% | 93.5% | 0.854 | 0.923 | 88.2% | 100.0% | 0.0% | 7/20 |
| it | 80 | 83.9% | 91.3% | 0.861 | 0.927 | 90.0% | 98.8% | 0.0% | 3/12 |
| mixed | 16 | 91.7% | 100.0% | 0.903 | 0.969 | 93.8% | 100.0% | 0.0% | 1/2 |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 129 | 82.0% | 92.6% | 0.854 | 0.928 | 89.9% | 99.2% | 0.0% | 9/26 |
| heldout | 52 | 87.1% | 94.2% | 0.880 | 0.931 | 88.5% | 100.0% | 0.0% | 2/8 |

### No-answer queries

Returned at least one result: 22/22 (100.0%); zero results: 0.0%.  
lowConfidence (mode === "any" && top1.coverage < 0.5): flagged 12/22 no-answer (recall 54.5%), 5 answerable (4 with a relevant top-1); precision 70.6%.

| id | split | query | returned | mode | top-1 coverage | flagged |
|---|---|---|---|---|---|---|
| Q55 | dev | black friday discount strategy | 10 | any | 0.25 | yes |
| Q56 | dev | orari di apertura del negozio di Bolzano | 10 | any | 0.25 | yes |
| Q57 | dev | returns policy for EU customers | 10 | any | 0.75 | no |
| Q58 | dev | scarponi da sci alpino | 10 | any | 0.33 | yes |
| Q59 | heldout | men's winter hiking boots landing page | 10 | all | 1.00 | no |
| Q60 | dev | decisione sul cambio hosting | 10 | any | 0.33 | yes |
| Q61 | dev | experiment on free shipping threshold | 10 | any | 0.25 | yes |
| Q62 | heldout | scarpe per bambini | 10 | any | 0.50 | no |
| Q156 | heldout | shipping costs to Germany | 10 | any | 0.33 | yes |
| Q157 | heldout | taglie dei guanti | 10 | any | 0.50 | no |
| Q158 | dev | Google Ads budget for brand campaigns | 10 | any | 0.20 | yes |
| Q159 | dev | recensioni negative sul servizio clienti | 10 | any | 0.25 | yes |
| Q160 | heldout | newsletter signup conversion rate | 10 | any | 0.50 | no |
| Q161 | heldout | garanzia di due anni sugli scarponi | 10 | any | 0.50 | no |
| Q162 | dev | competitor Decathlon | 10 | any | 0.50 | no |
| Q163 | dev | pagina categoria zaini | 10 | all | 0.67 | no |
| Q164 | dev | TikTok content strategy | 10 | any | 0.33 | yes |
| Q165 | dev | giacca in piumino | 10 | any | 0.50 | no |
| Q166 | dev | robots.txt rule for the staging subdomain | 10 | any | 0.60 | no |
| Q167 | dev | collaborazione con influencer | 10 | any | 0.00 | yes |
| Q168 | dev | GA4 event tracking setup | 10 | any | 0.25 | yes |
| Q169 | dev | numero di negozi fisici | 10 | any | 0.33 | yes |

### Latency, build and memory

| metric | value |
|---|---|
| query latency p50 | 1.72 ms |
| query latency p95 | 2.66 ms |
| query latency mean / max | 1.88 / 7.11 ms |
| OKF index build | 49.4 ms |
| search index prepare | n/a (built lazily; see warm-up) |
| warm-up pass | 625.0 ms |
| RSS before build / after build / end | 108.2 / 159.9 / 194 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| Q01 | dev | nl-task | en | which landing page targets winter hiking boots for women? | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q02 | dev | nl-task | it | cosa abbiamo deciso sulle pagine categoria duplicate? | 10 | 1 | 1 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q03 | dev | nl-task | en | what is the current status of core web vitals on mobile? | 10 | 2 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (0) | yes |
| Q04 | dev | nl-task | it | quali claim sull'impermeabilità possiamo usare nelle descrizioni prodotto? | 10 | 1 | 1 | alpinaria/policies/claim-impermeabile (2) | – |
| Q05 | dev | nl-task | en | experiment Made in Italy English titles result | 10 | 1 | 1 | alpinaria/experiments/en-title-italian-made (2) | – |
| Q06 | heldout | nl-task | it | chi è il competitor più forte sugli scarponi da trekking? | 10 | 1 | 6,1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q07 | dev | nl-task | en | English pages missing hreflang return tags | 10 | 1 | 1,2 | alpinaria/seo-findings/hreflang-missing-en-pages (2) | – |
| Q08 | dev | nl-task | it | perché è calato il traffico sulle pagine dei pile? | 10 | 1 | 1 | alpinaria/seo-findings/calo-traffico-pile-autunno-2026 (2) | – |
| Q09 | dev | nl-task | en | how many words of unique copy does a product page need | 10 | 1 | 1 | alpinaria/decisions/product-page-copy-minimum-120-words (2) | – |
| Q10 | dev | nl-task | it | a che pubblico ci rivolgiamo con la linea Torrente? | 10 | 1 | 8,1 | alpinaria/product-lines/torrente (2) | – |
| Q11 | dev | keyword | it | scarponi trekking donna | 10 | 1 | 2,1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | no |
| Q12 | dev | keyword | en | approach shoes | 10 | 1 | 2,1 | alpinaria/landing-pages/en-approach-shoes (2) | – |
| Q13 | dev | keyword | it | calze merino | 10 | 1 | 4,1 | alpinaria/landing-pages/it-calze-merino (2) | – |
| Q14 | heldout | keyword | en | hreflang | 10 | 1 | 2,3,4 | playbook/guidelines/hreflang-checklist (1) | – |
| Q15 | heldout | keyword | it | cannibalizzazione | 10 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q16 | dev | keyword | en | sitemap | 10 | 1 | 3,2 | playbook/guidelines/xml-sitemap-hygiene (1) | – |
| Q17 | heldout | keyword | it | giacca guscio | 10 | 1 | 1,4 | alpinaria/seo-findings/query-mismatch-giacca-guscio (2) | – |
| Q18 | dev | keyword | en | trail running | 10 | 1 | 7,3 | alpinaria/landing-pages/en-trail-running-shoes (1) | – |
| Q19 | dev | mixed-lang | mixed | landing page scarponi donna | 10 | 1 | 2 | alpinaria/landing-pages/it-scarponi-da-trekking-donna-old (1) | yes |
| Q20 | dev | mixed-lang | mixed | keyword cluster giacche impermeabili intent | 10 | 2 | 2 | alpinaria/landing-pages/it-giacche-impermeabili (0) | – |
| Q21 | dev | mixed-lang | mixed | finding pile traffico | 10 | 1 | 1 | alpinaria/seo-findings/calo-traffico-pile-autunno-2026 (2) | – |
| Q22 | dev | mixed-lang | mixed | policy claim riciclato | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q23 | heldout | mixed-lang | mixed | brief guida scarponi invernali women | 10 | 1 | 1 | alpinaria/content-briefs/guida-scarponi-invernali-donna (2) | – |
| Q24 | heldout | exact | en | TRK-W-042 | 10 | 1 | 1 | alpinaria/products/trk-w-042-dolomiti-aquastop-w (2) | – |
| Q25 | dev | exact | en | /en/womens-winter-hiking-boots/ | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q26 | heldout | exact | en | AquaStop | 10 | 4 | 7 | alpinaria/products/trk-m-042-dolomiti-aquastop-m (0) | – |
| Q27 | dev | exact | it | Montevia | 10 | 1 | 1 | alpinaria/competitors/montevia (2) | – |
| Q28 | dev | exact | it | /scarponi-da-trekking/donna/ | 10 | 1 | 1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q29 | dev | exact | en | JKT-U-310 | 10 | 1 | 1 | alpinaria/products/jkt-u-310-vetta-guscio-u (2) | – |
| Q30 | dev | exact | en | x-default | 10 | 1 | 2,1 | alpinaria/experiments/hreflang-x-default-en (2) | – |
| Q31 | dev | morph | it | scarpone trekking donna | 10 | 1 | 2,1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q32 | dev | morph | en | canonicalize filtered category pages | 10 | 8 | 8,miss | playbook/guidelines/pagination (0) | – |
| Q33 | dev | morph | it | impermeabilizzazione scarponi | 10 | 1 | 3,1 | alpinaria/content-briefs/guida-impermeabilizzare-scarponi (2) | – |
| Q34 | heldout | morph | en | redirects outlet | 10 | 1 | 1,2 | alpinaria/technical-issues/redirect-chains-outlet (2) | – |
| Q35 | dev | morph | it | pagina categoria duplicata | 10 | 1 | 2,1 | alpinaria/seo-findings/duplicate-category-pages-filters (2) | – |
| Q36 | heldout | morph | en | missing alt texts images | 10 | 1 | 4,1 | alpinaria/seo-findings/immagini-senza-alt (2) | – |
| Q37 | dev | accent | it | impermeabilita scarponi | 10 | 1 | 1,2 | alpinaria/policies/claim-impermeabile (2) | – |
| Q38 | dev | accent | it | sostenibilita claim | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q39 | heldout | accent | it | traspirabilità membrana | 10 | 1 | 1 | alpinaria/keyword-clusters/membrana-impermeabile-info (2) | – |
| Q40 | heldout | accent | it | novita inverno 2026 | 10 | 1 | 1 | alpinaria/content-briefs/calendario-contenuti-inverno-2026 (2) | – |
| Q41 | dev | synonym | en | rain jacket for hiking | 10 | 1 | 1,miss | alpinaria/keyword-clusters/hardshell-jacket (2) | – |
| Q42 | dev | synonym | it | scarpe da neve donna | 10 | 7 | 10,7 | alpinaria/products/win-w-305-nevaio-neve-w (0) | – |
| Q43 | dev | synonym | en | page speed problems on phones | 10 | 6 | 6 | alpinaria/landing-pages/it-outlet (0) | – |
| Q44 | dev | synonym | it | regole sulle promozioni e prezzi barrati | 10 | 1 | 1 | alpinaria/policies/price-promo-claims (2) | – |
| Q45 | dev | synonym | en | thin product descriptions | 10 | 1 | 1 | alpinaria/seo-findings/thin-content-product-pages-torrente (2) | – |
| Q46 | dev | synonym | it | pubblico target famiglie | 10 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q47 | dev | freshness | en | core web vitals mobile LCP | 10 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q48 | heldout | freshness | en | backlink profile review | 10 | 1 | 2 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (1) | yes |
| Q49 | dev | freshness | it | filtri colore noindex o canonical | 10 | 1 | 1 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q50 | dev | freshness | en | women's winter hiking boots landing page | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q51 | dev | disambig | it | come scegliere scarponi da trekking | 10 | 1 | 2,1 | alpinaria/landing-pages/it-guida-scelta-scarponi (2) | no |
| Q52 | heldout | disambig | en | how to choose winter hiking boots | 10 | 1 | 2,1 | alpinaria/content-briefs/en-how-to-choose-winter-hiking-boots (2) | no |
| Q53 | dev | disambig | en | buy women's winter hiking boots | 10 | 1 | 1 | alpinaria/keyword-clusters/womens-winter-hiking-boots-transactional (2) | no |
| Q54 | dev | disambig | it | pagina inglese scarpe da avvicinamento | 10 | 1 | miss | alpinaria/landing-pages/it-scarpe-da-avvicinamento (1) | yes |
| Q63 | dev | playbook | en | INP LCP thresholds | 10 | 1 | 1 | playbook/guidelines/core-web-vitals-thresholds (2) | – |
| Q64 | heldout | playbook | en | how long should a title tag be | 10 | 1 | 1 | playbook/guidelines/title-tag-length (2) | – |
| Q65 | heldout | playbook | mixed | checklist hreflang | 10 | 1 | 1 | playbook/guidelines/hreflang-checklist (2) | – |
| Q66 | dev | nl-task | en | why do Italian URLs show up for German users searching in English? | 10 | 1 | 1 | alpinaria/seo-findings/hreflang-missing-en-pages (2) | – |
| Q67 | dev | nl-task | it | quanto deve essere lungo il testo unico di una scheda prodotto? | 10 | 1 | miss,1 | alpinaria/content-briefs/torrente-product-copy-refresh (2) | – |
| Q68 | dev | nl-task | en | which pages are five clicks away from the home page? | 10 | 1 | 1,2 | alpinaria/seo-findings/mobile-menu-crawl-depth (2) | – |
| Q69 | dev | nl-task | it | quali linee possono usare il claim Made in Italy? | 10 | 1 | 1 | alpinaria/policies/made-in-italy-claim (2) | no |
| Q70 | heldout | nl-task | en | what did the lazy loading experiment on the hero image show? | 10 | 1 | 1 | alpinaria/experiments/lazy-load-hero-image (2) | – |
| Q71 | dev | nl-task | it | come dobbiamo scrivere gli alt delle immagini prodotto? | 10 | 1 | 4 | alpinaria/seo-findings/immagini-senza-alt (1) | – |
| Q72 | dev | nl-task | en | is the x-default supposed to point to the English or the Italian page? | 10 | 1 | 2,1 | alpinaria/experiments/hreflang-x-default-en (2) | – |
| Q73 | dev | nl-task | it | qual è il tasso di conversione migliore del sito? | 10 | 1 | 1 | alpinaria/landing-pages/it-calze-merino (2) | – |
| Q74 | dev | nl-task | en | when is the packing guide refresh due? | 10 | 1 | 2 | alpinaria/landing-pages/en-dolomites-packing-guide (1) | – |
| Q75 | heldout | nl-task | it | quante immagini prodotto sono senza alt text? | 10 | 1 | 1 | alpinaria/seo-findings/immagini-senza-alt (2) | – |
| Q76 | dev | nl-task | en | what should we do about the 300 dead URLs in the sitemap? | 10 | 1 | 1,2 | alpinaria/seo-findings/sitemap-stale-urls (2) | – |
| Q77 | dev | nl-task | it | perché abbiamo interrotto il test delle emoji nelle meta description? | 10 | 1 | 1 | alpinaria/experiments/meta-description-emoji (2) | – |
| Q78 | heldout | nl-task | en | which competitor sponsors the Lavaredo Ultra Trail? | 10 | 1 | 1 | alpinaria/competitors/trailforge (2) | – |
| Q79 | dev | nl-task | it | dove devono stare le guide informative nella struttura URL? | 10 | 1 | 1 | alpinaria/decisions/blog-guides-under-guide-folder (2) | – |
| Q80 | heldout | nl-task | en | what is the outreach plan for the next backlink wave? | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q81 | heldout | nl-task | it | che numero consigliamo con le calze spesse? | 10 | 3 | 3 | alpinaria/products/sck-u-705-rifugio-calze-merino-heavy-u (0) | – |
| Q82 | dev | keyword | it | doposci | 10 | 1 | 1,3 | alpinaria/keyword-clusters/scarponcini-invernali-donna (2) | – |
| Q83 | dev | keyword | en | crawl budget | 10 | 4 | 4 | alpinaria/technical-issues/en-pages-crawl-depth (0) | – |
| Q84 | dev | keyword | it | risuolabile | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q85 | heldout | keyword | en | disavow | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q86 | dev | keyword | en | featured snippet | 10 | 1 | 1,2 | alpinaria/seo-findings/featured-snippet-impermeabilizzare (2) | – |
| Q87 | dev | keyword | it | tasselli | 10 | 4 | 5 | alpinaria/products/trk-m-063-dolomiti-alta-m (0) | – |
| Q88 | heldout | keyword | en | GRS certified | 10 | 1 | 1,4 | alpinaria/product-lines/bosco (2) | – |
| Q89 | dev | keyword | it | settimana bianca | 10 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q90 | heldout | keyword | en | aggregateRating | 10 | 1 | 1 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q91 | dev | keyword | en | share of voice | 10 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q92 | dev | keyword | en | Montebelluna | 10 | 1 | 1,3 | alpinaria/content-briefs/en-italian-hiking-boots-brands-history (2) | – |
| Q93 | dev | keyword | en | Alta Via 1 | 10 | 1 | 2 | alpinaria/brand-voice/tone-of-voice-en (1) | – |
| Q94 | heldout | keyword | it | redirect 301 | 10 | 1 | 1 | alpinaria/decisions/redirect-vecchia-pagina-donna (2) | – |
| Q95 | dev | mixed-lang | mixed | decision canonical filtri colore | 10 | 1 | 1,3 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q96 | heldout | mixed-lang | mixed | technical issue alt text PIM | 10 | 1 | 1 | alpinaria/technical-issues/alt-text-mancanti (2) | – |
| Q97 | dev | mixed-lang | mixed | audience trail runner mobile | 10 | 1 | 1 | alpinaria/audiences/trail-runner (2) | – |
| Q98 | dev | mixed-lang | mixed | competitor scarpe da avvicinamento | 10 | 1 | 4 | alpinaria/landing-pages/it-scarpe-da-avvicinamento (1) | – |
| Q99 | heldout | mixed-lang | mixed | experiment title prezzo da 149 | 10 | 1 | 1 | alpinaria/experiments/title-tag-prezzo-scarponi-donna (2) | – |
| Q100 | heldout | mixed-lang | mixed | brief merino socks vesciche | 10 | 1 | 1 | alpinaria/content-briefs/en-merino-socks-benefits (2) | – |
| Q101 | dev | mixed-lang | mixed | finding crawl depth pagine inglesi | 10 | 1 | 1,4 | alpinaria/seo-findings/mobile-menu-crawl-depth (2) | – |
| Q102 | dev | mixed-lang | mixed | policy claim medici | 10 | 1 | 1 | alpinaria/policies/medical-health-claims (2) | – |
| Q103 | heldout | exact | en | WIN-W-309 | 10 | 1 | 1 | alpinaria/products/win-w-309-nevaio-polar-w (2) | – |
| Q104 | dev | exact | it | SCK-U-705 | 10 | 1 | 1 | alpinaria/products/sck-u-705-rifugio-calze-merino-heavy-u (2) | – |
| Q105 | dev | exact | en | /en/approach-shoes/ | 10 | 1 | 1 | alpinaria/landing-pages/en-approach-shoes (2) | – |
| Q106 | dev | exact | it | /abbigliamento/pile/ | 10 | 1 | 1 | alpinaria/landing-pages/it-pile (2) | – |
| Q107 | dev | exact | en | nordpasso.com | 10 | 1 | 1 | alpinaria/competitors/nordpasso (2) | – |
| Q108 | heldout | exact | it | Dolomyths | 10 | 1 | 1 | alpinaria/audiences/trail-runner (2) | – |
| Q109 | dev | exact | en | fetchpriority | 10 | 1 | miss | alpinaria/technical-issues/lcp-immagini-prodotto-mobile (1) | – |
| Q110 | heldout | exact | it | art. 17-bis | 10 | 1 | 1 | alpinaria/policies/price-promo-claims (2) | – |
| Q111 | dev | exact | en | TRL-M-404 | 10 | 1 | 1 | alpinaria/products/trl-m-404-torrente-rapido-pro-m (2) | – |
| Q112 | dev | exact | en | Elisa Dalla Costa | 10 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q113 | heldout | exact | en | /outlet/ | 10 | 1 | 1 | alpinaria/landing-pages/it-outlet (2) | – |
| Q114 | heldout | morph | it | pantaloni zip-off | 10 | 1 | 3,1,2 | alpinaria/products/pnt-m-810-passo-zip-off-m (2) | – |
| Q115 | dev | morph | en | redirected legacy promo urls | 10 | 1 | 2,1 | alpinaria/technical-issues/redirect-chains-outlet (2) | – |
| Q116 | dev | morph | it | guide informative | 10 | 1 | 1 | alpinaria/decisions/blog-guides-under-guide-folder (2) | – |
| Q117 | dev | morph | en | indexing of parameter urls | 10 | 1 | 1 | alpinaria/seo-findings/faceted-navigation-index-bloat (2) | – |
| Q118 | dev | morph | it | scarponcino invernale | 10 | 1 | 2,1 | alpinaria/landing-pages/it-scarponcini-invernali-donna (2) | – |
| Q119 | dev | morph | en | canonicals on english product pages | 10 | 1 | 1 | alpinaria/technical-issues/canonical-self-reference-missing-en (2) | – |
| Q120 | dev | morph | it | link interno perso | 10 | 1 | 10,1 | alpinaria/experiments/internal-links-pile-from-giacche (2) | – |
| Q121 | dev | morph | en | experiments with positive results | 10 | 1 | 2,1,3 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q122 | heldout | morph | it | cannibalizzazioni tra pagine | 10 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q123 | dev | morph | en | hydrating the filter widget | 10 | 1 | 1 | alpinaria/technical-issues/inp-filtri-plp (2) | no |
| Q124 | heldout | accent | it | priorita editoriale 2027 | 10 | 1 | 1 | alpinaria/decisions/trail-running-line-priority-2027 (2) | – |
| Q125 | dev | accent | it | sneaker Baita Citta | 10 | 1 | 1,2 | alpinaria/products/lfs-w-901-baita-citt-w (2) | – |
| Q126 | dev | accent | it | stagionalita cluster scarponi donna | 10 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-donna-transazionale (2) | – |
| Q127 | dev | accent | it | profondita di catalogo Montevia | 10 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q128 | dev | accent | it | disponibilità immediata famiglie | 10 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q129 | dev | accent | it | velocita di scroll mobile | 10 | 4 | 4 | alpinaria/technical-issues/lcp-immagini-prodotto-mobile (0) | – |
| Q130 | dev | accent | it | gravita alta problemi tecnici | 10 | miss | miss | alpinaria/audiences/alpinisti-esperti (0) | – |
| Q131 | dev | synonym | en | insulated boots for snowshoeing | 10 | 2 | 6,2 | alpinaria/landing-pages/en-womens-winter-hiking-boots (0) | – |
| Q132 | dev | synonym | it | scarpe basse per camminare | 10 | 1 | 1,5 | alpinaria/keyword-clusters/scarpe-trekking-leggere (2) | – |
| Q133 | heldout | synonym | en | star ratings in search results | 10 | 1 | 1 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q134 | dev | synonym | it | marketplace che rivende i nostri prodotti a prezzo più basso | 10 | 1 | 1 | alpinaria/competitors/quota3000 (2) | – |
| Q135 | dev | synonym | en | slow filters on category pages | 10 | 2 | 2 | playbook/guidelines/pagination (0) | – |
| Q136 | heldout | synonym | it | pulizia delle scarpe in pelle | 10 | 1 | 1,miss | alpinaria/landing-pages/it-guida-cura-scarponi (2) | – |
| Q137 | heldout | synonym | en | German shoppers | 10 | 2 | 2 | alpinaria/competitors/nordpasso (0) | – |
| Q138 | dev | synonym | it | testi troppo corti nelle schede Torrente | 10 | 1 | 7,1 | alpinaria/content-briefs/torrente-product-copy-refresh (2) | – |
| Q139 | dev | synonym | en | mountain hut trek | 10 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q140 | heldout | synonym | it | capi in lana che non puzzano | 10 | 3 | 6 | alpinaria/keyword-clusters/calze-trekking-merino (0) | – |
| Q141 | heldout | freshness | en | referring domains count | 10 | 1 | 2 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (1) | yes |
| Q142 | dev | freshness | it | pagina categoria scarponi donna attuale | 10 | 1 | 2 | alpinaria/landing-pages/it-scarponi-da-trekking-donna-old (1) | yes |
| Q143 | dev | freshness | en | current LCP on mobile product pages | 10 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q144 | dev | freshness | it | filtri taglia robots disallow | 10 | 1 | 1,3 | alpinaria/decisions/faceted-parameters-robots (2) | no |
| Q145 | dev | freshness | it | noindex sulle URL con parametri | 10 | 1 | 4 | alpinaria/technical-issues/parametri-filtri-indicizzati (1) | yes |
| Q146 | heldout | freshness | en | backlink gap to Cimalta | 10 | 1 | 2 | alpinaria/competitors/cimalta (1) | no |
| Q147 | dev | freshness | en | mobile CLS value | 10 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q148 | dev | disambig | en | draft redesign of the women's winter page | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots-draft-v2 (2) | no |
| Q149 | heldout | disambig | it | pagina italiana delle giacche hardshell | 10 | 1 | 1 | alpinaria/landing-pages/it-giacche-impermeabili (2) | no |
| Q150 | dev | disambig | en | approach shoes category in Italian | 10 | 1 | 4 | alpinaria/landing-pages/en-approach-shoes (1) | yes |
| Q151 | dev | disambig | it | cluster transazionale scarponi uomo | 10 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-uomo-transazionale (2) | no |
| Q152 | dev | disambig | en | informational cluster about hiking boot sizing | 10 | 1 | 1 | alpinaria/keyword-clusters/boot-sizing-guide-en (2) | no |
| Q153 | dev | disambig | it | cluster taglie scarponi in italiano | 10 | 1 | 2 | alpinaria/content-briefs/guida-taglie-scarponi (1) | no |
| Q154 | heldout | disambig | en | Q2 backlink review numbers | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (2) | no |
| Q155 | dev | disambig | en | men's hiking boots English category page | 10 | 1 | 1 | alpinaria/landing-pages/en-mens-hiking-boots (2) | no |
| Q170 | dev | playbook | en | how do we tell transactional from informational clusters? | 10 | 5 | 5 | alpinaria/keyword-clusters/womens-winter-hiking-boots-transactional (0) | – |
| Q171 | dev | playbook | mixed | guideline cadenza refresh contenuti | 10 | 1 | 1 | playbook/guidelines/content-refresh-cadence (2) | – |
| Q172 | dev | playbook | en | minimum experiment duration | 10 | 1 | 1 | playbook/guidelines/experiment-protocol (2) | – |
| Q173 | dev | playbook | en | when to use robots disallow instead of noindex | 10 | 1 | 3 | alpinaria/decisions/faceted-parameters-robots (1) | – |
| Q174 | dev | playbook | it | regole per i link interni dalle guide alle categorie | 10 | 1 | 3 | alpinaria/decisions/blog-guides-under-guide-folder (1) | – |
| Q175 | heldout | playbook | en | E-E-A-T author box on guides | 10 | 1 | 1 | playbook/guidelines/eeat-for-ecommerce (2) | – |
| Q176 | dev | nl-task | en | what are the head terms of the merino hiking socks cluster? | 10 | 1 | 1 | alpinaria/keyword-clusters/merino-hiking-socks (2) | – |
| Q177 | dev | nl-task | it | quali sono le parole chiave principali del cluster pile? | 10 | 1 | 1 | alpinaria/keyword-clusters/pile-montagna (2) | – |
| Q178 | dev | nl-task | en | which page is mapped to the Dolomites packing cluster? | 10 | 1 | 2 | alpinaria/landing-pages/en-dolomites-packing-guide (1) | – |
| Q179 | dev | nl-task | it | a quale pagina è mappato il cluster scarpe trail running? | 10 | 1 | 2 | alpinaria/landing-pages/it-scarpe-trail-running (1) | – |
| Q180 | dev | nl-task | en | what is forbidden under the Made in Italy policy? | 10 | 1 | 1 | alpinaria/policies/made-in-italy-claim (2) | – |
| Q181 | dev | nl-task | it | cosa è vietato dalla policy sull'impermeabilità? | 10 | 1 | 1 | alpinaria/policies/claim-impermeabile (2) | – |
| Q182 | dev | nl-task | en | what comfort statements are allowed instead of medical claims? | 10 | 1 | 1 | alpinaria/policies/medical-health-claims (2) | – |
| Q183 | dev | nl-task | it | qual è la base normativa dei green claims? | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q184 | dev | nl-task | it | in quali pagine si applicano le regole sui prezzi barrati? | 10 | 1 | 1 | alpinaria/policies/price-promo-claims (2) | – |
| Q185 | dev | nl-task | it | quali parole dobbiamo evitare nei testi italiani? | 10 | 1 | 1 | alpinaria/brand-voice/tono-di-voce-it (2) | – |
| Q186 | heldout | nl-task | en | what should English product copy not say? | 10 | 2 | 2 | alpinaria/decisions/product-page-copy-minimum-120-words (0) | – |
| Q187 | dev | keyword | it | lessico scarponi scarpe scarponcini | 10 | 3 | 3 | alpinaria/keyword-clusters/vie-ferrate-scarpe (0) | – |
| Q188 | dev | nl-task | en | which SKUs belong to the Nevaio line? | 10 | 1 | 1 | alpinaria/product-lines/nevaio (2) | – |
| Q189 | dev | nl-task | it | quali modelli fanno parte della linea Cresta? | 10 | 1 | 1 | alpinaria/product-lines/cresta (2) | – |
| Q190 | heldout | nl-task | it | che taglie ha la linea Vetta? | 10 | 1 | 1 | alpinaria/product-lines/vetta (2) | – |
| Q191 | heldout | nl-task | en | is the Sentiero line made in Italy? | 10 | 1 | 1 | alpinaria/product-lines/sentiero (2) | – |
| Q192 | dev | nl-task | it | perché la pagina scarponi donna è salita di posizione? | 10 | 1 | 1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q193 | dev | nl-task | en | when do impressions peak for the women's winter page? | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | – |
| Q194 | heldout | nl-task | it | quanti prodotti ha la categoria scarponi uomo? | 10 | 1 | 1 | alpinaria/landing-pages/it-scarponi-da-trekking-uomo (2) | – |
| Q195 | dev | nl-task | en | why does the men's hiking boots title say Made in Italy? | 10 | 1 | 1 | alpinaria/landing-pages/en-mens-hiking-boots (2) | – |
| Q196 | heldout | nl-task | it | quante parole ha la guida alla scelta degli scarponi? | 10 | 1 | 1 | alpinaria/landing-pages/it-guida-scelta-scarponi (2) | – |
| Q197 | heldout | nl-task | en | where does the lightweight hiking shoes page sit in the crawl? | 10 | 1 | 1 | alpinaria/landing-pages/en-lightweight-hiking-shoes (2) | – |
| Q198 | heldout | nl-task | it | quale CTR ha la query di brand? | 10 | 1 | 1 | alpinaria/keyword-clusters/alpinaria-brand (2) | – |
| Q199 | heldout | nl-task | it | URL della scheda prodotto Torrente Rapido W | 10 | 2 | 2 | alpinaria/products/trl-w-404-torrente-rapido-pro-w (0) | – |
| Q200 | dev | nl-task | en | product URL of Dolomiti AquaStop M | 10 | 1 | 1 | alpinaria/products/trk-m-042-dolomiti-aquastop-m (2) | – |
| Q201 | dev | mixed-lang | mixed | head terms del cluster approach shoes | 10 | 1 | 1 | alpinaria/keyword-clusters/approach-shoes (2) | – |
| Q202 | dev | nl-task | it | quando ha i picchi il cluster outlet scarponi? | 10 | 1 | 1 | alpinaria/keyword-clusters/saldi-scarponi (2) | – |
| Q203 | heldout | nl-task | en | what is the average position of the men's waterproof boots cluster? | 10 | 1 | 1 | alpinaria/keyword-clusters/mens-hiking-boots-waterproof (2) | – |

## Fixture atlas

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · bundles atlas (160), standards (9) · 167 concepts · valid for project: true · as-of 2026-10-24 · split all  
Queries: 99 (89 answerable, 10 no-answer, 58 with sectionAnchor)

### Overall (answerable queries, 95% bootstrap CI)

| metric | value | 95% CI |
|---|---|---|
| Recall@5 | 0.874 | [0.820, 0.923] |
| MustRecall@5 | 0.949 | [0.904, 0.983] |
| nDCG@10 | 0.849 | [0.800, 0.894] |
| MRR@10 | 0.873 | [0.815, 0.926] |
| P@1 | 0.809 | [0.719, 0.888] |
| hit@10 | 0.978 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 1/9 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 4 | 91.7% | 100.0% | 0.960 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| disambig | 6 | 100.0% | 100.0% | 0.977 | 1.000 | 100.0% | 100.0% | 0.0% | 0/6 |
| exact | 8 | 100.0% | 100.0% | 0.982 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| freshness | 3 | 58.3% | 66.7% | 0.724 | 0.722 | 66.7% | 100.0% | 0.0% | 1/3 |
| keyword | 9 | 88.1% | 94.4% | 0.885 | 0.944 | 88.9% | 100.0% | 0.0% | – |
| mixed-lang | 4 | 100.0% | 100.0% | 0.727 | 0.675 | 50.0% | 100.0% | 0.0% | – |
| morph | 6 | 86.1% | 100.0% | 0.934 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| nl-task | 39 | 91.7% | 97.4% | 0.878 | 0.893 | 82.1% | 100.0% | 0.0% | – |
| standards | 4 | 58.3% | 75.0% | 0.451 | 0.458 | 25.0% | 75.0% | 0.0% | – |
| synonym | 6 | 52.8% | 83.3% | 0.551 | 0.611 | 50.0% | 83.3% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 58 | 86.7% | 94.0% | 0.862 | 0.891 | 82.8% | 98.3% | 0.0% | 1/7 |
| it | 27 | 87.0% | 96.3% | 0.839 | 0.864 | 81.5% | 96.3% | 0.0% | 0/2 |
| mixed | 4 | 100.0% | 100.0% | 0.727 | 0.675 | 50.0% | 100.0% | 0.0% | – |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 62 | 85.8% | 96.0% | 0.826 | 0.861 | 79.0% | 96.8% | 0.0% | 1/6 |
| heldout | 27 | 90.9% | 92.6% | 0.902 | 0.901 | 85.2% | 100.0% | 0.0% | 0/3 |

### No-answer queries

Returned at least one result: 10/10 (100.0%); zero results: 0.0%.  
lowConfidence (mode === "any" && top1.coverage < 0.5): flagged 6/10 no-answer (recall 60.0%), 4 answerable (1 with a relevant top-1); precision 60.0%.

| id | split | query | returned | mode | top-1 coverage | flagged |
|---|---|---|---|---|---|---|
| A59 | dev | Jira ticket workflow for feature requests | 10 | any | 0.60 | no |
| A60 | heldout | contratto di pulizia degli uffici | 10 | any | 0.33 | yes |
| A61 | heldout | Android app release schedule | 10 | any | 0.50 | no |
| A62 | dev | orario delle corse della linea 27 | 10 | any | 0.25 | yes |
| A63 | dev | GraphQL gateway migration | 10 | any | 0.33 | yes |
| A64 | dev | stipendio dei controllori | 10 | any | 0.50 | no |
| A65 | dev | MongoDB cluster sizing | 10 | any | 0.33 | yes |
| A66 | dev | fattura elettronica per le aziende | 10 | any | 0.33 | yes |
| A67 | dev | Terraform module for the VPC | 10 | any | 0.33 | yes |
| A68 | dev | numero verde assistenza clienti | 10 | any | 0.50 | no |

### Latency, build and memory

| metric | value |
|---|---|
| query latency p50 | 2.56 ms |
| query latency p95 | 3.06 ms |
| query latency mean / max | 2.61 / 3.72 ms |
| OKF index build | 42.6 ms |
| search index prepare | n/a (built lazily; see warm-up) |
| warm-up pass | 423.8 ms |
| RSS before build / after build / end | 119.3 / 158.4 / 158.5 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| A01 | heldout | nl-task | en | why did validators in Bologna go offline in January? | 10 | 1 | 1,6 | atlas/incidents/inc-2026-001-validator-outage-bologna (2) | – |
| A02 | dev | nl-task | it | cosa succede ai biglietti quando il validatore è offline? | 10 | 1 | 2 | atlas/runbooks/validator-offline-queue-drain (1) | – |
| A03 | dev | nl-task | en | how long do we keep raw validations? | 10 | 1 | 6,3 | atlas/contracts/ticket-validated-v2 (1) | – |
| A04 | dev | nl-task | it | chi è il reperibile per i problemi di pagamento? | 10 | 4 | 4 | atlas/runbooks/escalation-reperibilita-2025 (0) | – |
| A05 | dev | nl-task | en | what caused the duplicate subscription renewals? | 10 | 2 | 2 | atlas/slos/subscription-manager-renewal-success (0) | – |
| A06 | dev | nl-task | it | come si riconciliano gli avvisi pagoPA non pagati? | 10 | 1 | 1 | atlas/runbooks/pagopa-reconciliation (2) | – |
| A07 | dev | nl-task | en | which PSP do we use and is there a fallback? | 10 | 2 | 2 | atlas/runbooks/rotate-psp-credentials (0) | – |
| A08 | dev | nl-task | en | what is the error budget for the API gateway? | 10 | 1 | 1 | atlas/slos/api-gateway-availability (2) | – |
| A09 | dev | nl-task | it | perché il login SPID non funzionava ad aprile? | 10 | 1 | 1,5 | atlas/incidents/inc-2026-013-spid-login-down (2) | – |
| A10 | dev | nl-task | en | where do we store the EMV token for tap-to-ride? | 10 | 1 | 1 | atlas/decisions/adr-014-emv-contactless-tokenization (2) | – |
| A11 | dev | nl-task | en | what should happen before activating a new fare table? | 10 | 2 | 3 | atlas/services/fare-engine (0) | – |
| A12 | heldout | nl-task | it | quale team possiede il warehouse? | 10 | 1 | 2 | atlas/services/reporting-warehouse (1) | – |
| A13 | dev | keyword | en | fencing token | 10 | 2 | 2 | atlas/decisions/adr-014-emv-contactless-tokenization (0) | – |
| A14 | heldout | keyword | en | RAPTOR | 10 | 1 | 1 | atlas/decisions/adr-005-raptor-trip-planner (2) | – |
| A15 | dev | keyword | it | ricevute telematiche | 10 | 1 | 4,1 | atlas/incidents/inc-2026-007-pagopa-timeout (2) | – |
| A16 | dev | keyword | en | outbox | 10 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A17 | dev | keyword | en | kill switch | 10 | 1 | 1 | atlas/runbooks/feature-flag-kill-switch (2) | – |
| A18 | heldout | keyword | it | tablespace Oracle | 10 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | – |
| A19 | dev | keyword | en | advisory lock | 10 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A20 | heldout | keyword | en | TTL | 10 | 1 | 1,6 | atlas/incidents/inc-2026-018-clickhouse-disk-full (2) | – |
| A21 | dev | keyword | en | Temporal | 10 | 1 | 2 | atlas/runbooks/refund-queue-unstick (1) | – |
| A22 | dev | mixed-lang | mixed | runbook riconciliazione wallet | 10 | 5 | 5 | atlas/runbooks/pagopa-reconciliation (0) | – |
| A23 | dev | mixed-lang | mixed | incident timeout nodo pagoPA | 10 | 1 | 1 | atlas/incidents/inc-2026-007-pagopa-timeout (2) | – |
| A24 | heldout | mixed-lang | mixed | SLO freschezza cruscotti operatori | 10 | 2 | 3 | atlas/services/operator-portal (0) | – |
| A25 | dev | mixed-lang | mixed | ADR dismissione SBE | 10 | 1 | 1 | atlas/decisions/adr-017-retire-legacy-sbe (2) | – |
| A26 | dev | exact | en | INC-2026-011 | 10 | 1 | 1 | atlas/incidents/inc-2026-011-kafka-partition-lag (2) | – |
| A27 | dev | exact | en | ADR-012 | 10 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A28 | dev | exact | en | ticketing.validations.v2 | 10 | 1 | 1 | atlas/contracts/ticket-validated-v2 (2) | – |
| A29 | heldout | exact | en | partners.tessera.it | 10 | 1 | 1,2 | atlas/incidents/inc-2026-020-api-gateway-cert-expiry (2) | – |
| A30 | dev | exact | en | kill.notification-hub.marketing | 10 | 1 | 1 | atlas/runbooks/notification-rate-limit (2) | – |
| A31 | dev | exact | it | ORA-01653 | 10 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | – |
| A32 | heldout | exact | en | /v1/planner/plan | 10 | 1 | 1 | atlas/contracts/api-planner-v1 (2) | – |
| A33 | dev | exact | en | eu-south-1 | 10 | 1 | 2 | atlas/questions/q-001-multi-region-active-active (1) | – |
| A34 | dev | morph | en | rotating credentials | 10 | 1 | 1 | atlas/runbooks/rotate-psp-credentials (2) | – |
| A35 | dev | morph | it | coda offline validatore | 10 | 1 | 1 | atlas/runbooks/validator-offline-queue-drain (2) | – |
| A36 | dev | morph | en | renewing certificates | 10 | 1 | 1 | atlas/runbooks/certificate-renewal (2) | – |
| A37 | dev | morph | en | partitioned ledger tables | 10 | 1 | 1,2 | atlas/services/validation-ledger (2) | – |
| A38 | heldout | morph | it | sanzione duplicata | 10 | 1 | 1 | atlas/incidents/inc-2026-025-inspector-app-sync (2) | – |
| A39 | heldout | morph | en | consumers lagging | 10 | 1 | 1,3 | atlas/incidents/inc-2026-011-kafka-partition-lag (2) | – |
| A40 | dev | accent | it | reperibilita team dati | 10 | 1 | 1 | atlas/questions/q-007-on-call-compensation (2) | – |
| A41 | heldout | accent | it | team mobilita | 10 | 1 | 1 | atlas/teams/team-mobilita (2) | – |
| A42 | dev | accent | it | nuove funzionalita SBE | 10 | 1 | 1,2 | atlas/services/legacy-sbe (2) | – |
| A43 | dev | accent | it | proprietà e runtime di pagopa-adapter | 10 | 1 | 1 | atlas/services/pagopa-adapter (2) | – |
| A44 | dev | synonym | en | double billing of season passes | 10 | 1 | 3 | atlas/services/subscription-manager (1) | – |
| A45 | dev | synonym | it | procedura per spegnere una funzione in emergenza | 10 | miss | miss | atlas/runbooks/fare-table-hotfix (0) | – |
| A46 | heldout | synonym | en | vehicle locations stuck | 10 | 1 | 1 | atlas/incidents/inc-2026-023-avl-feed-stale (2) | – |
| A47 | dev | synonym | en | who to call at night when the warehouse breaks | 10 | 3 | 3 | atlas/services/reporting-warehouse (0) | – |
| A48 | heldout | synonym | it | doppio addebito sul borsellino | 10 | 3 | 3 | atlas/incidents/inc-2026-025-inspector-app-sync (0) | – |
| A49 | dev | synonym | en | attack on the website | 10 | 1 | 2 | atlas/postmortems/pm-2026-029-storefront-ddos (1) | – |
| A50 | dev | freshness | en | repository structure monorepo or polyrepo | 10 | 1 | 1 | atlas/decisions/adr-015-polyrepo-per-team (2) | no |
| A51 | dev | freshness | en | escalation procedure | 10 | 1 | 2 | atlas/runbooks/escalation-reperibilita-2025 (1) | yes |
| A52 | heldout | freshness | en | validation event schema | 10 | 6 | 6 | atlas/services/validation-ledger (0) | no |
| A53 | heldout | disambig | it | incidente storico del legacy SBE | 10 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | no |
| A54 | dev | disambig | en | deprecated validation event v1 | 10 | 1 | 1 | atlas/contracts/ticket-validated-v1 (2) | no |
| A55 | dev | disambig | en | Italian version of the escalation runbook | 10 | 1 | 1 | atlas/runbooks/escalation-reperibilita-2025 (2) | no |
| A56 | heldout | disambig | en | validator gateway latency SLO | 10 | 1 | 1 | atlas/slos/validator-gateway-ingest-latency (2) | no |
| A57 | dev | disambig | it | post-mortem dei validatori in italiano | 10 | 1 | 1 | atlas/postmortems/pm-2026-001-validator-outage (2) | no |
| A58 | dev | disambig | en | team that owns the API gateway | 10 | 1 | 2 | atlas/services/api-gateway (1) | no |
| A69 | dev | standards | en | when must a post-mortem be written? | 10 | miss | miss | atlas/postmortems/pm-2026-020-cert-expiry (0) | – |
| A70 | dev | standards | en | burn rate alert thresholds | 10 | 2 | 4 | atlas/runbooks/notification-rate-limit (0) | – |
| A71 | dev | standards | it | convenzione per i nomi dei topic | 10 | 1 | 1 | standards/standards/service-naming (2) | – |
| A72 | heldout | standards | en | how long does a deprecated REST major live | 10 | 3 | 3,4 | standards/standards/deprecation-policy (0) | – |
| A73 | dev | nl-task | en | what are the consequences of the outbox decision? | 10 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A74 | dev | nl-task | it | quali sono le conseguenze dell'integrazione diretta con pagoPA? | 10 | 1 | 1 | atlas/decisions/adr-009-pagopa-direct-integration (2) | – |
| A75 | dev | nl-task | en | what went well during the wallet double charge incident? | 10 | 1 | 2 | atlas/incidents/inc-2026-004-wallet-double-charge (1) | – |
| A76 | dev | nl-task | en | action items from the Kafka lag post-mortem | 10 | 1 | 1 | atlas/postmortems/pm-2026-011-kafka-lag (2) | – |
| A77 | heldout | nl-task | it | qual è la lezione del post-mortem pagoPA? | 10 | 1 | 1 | atlas/postmortems/pm-2026-007-pagopa-timeout (2) | – |
| A78 | dev | nl-task | en | how do I roll back a schema registry change? | 10 | 1 | 1 | atlas/runbooks/schema-registry-rollback (2) | – |
| A79 | dev | nl-task | en | what is the rollback for a fare table hotfix? | 10 | 1 | 1 | atlas/runbooks/fare-table-hotfix (2) | – |
| A80 | dev | nl-task | en | who do I escalate to when the validator queue is older than 48 hours? | 10 | 3 | 3 | atlas/runbooks/scale-validator-gateway (0) | – |
| A81 | dev | nl-task | it | quali sono i prerequisiti per la riconciliazione pagoPA? | 10 | 1 | 1 | atlas/runbooks/pagopa-reconciliation (2) | – |
| A82 | dev | nl-task | en | when should I use the Kafka replay runbook? | 10 | 1 | 1 | atlas/runbooks/replay-kafka-topic (2) | – |
| A83 | heldout | nl-task | en | what fields does the FareComputed event carry? | 10 | 1 | 1 | atlas/contracts/fare-computed-v1 (2) | – |
| A84 | heldout | nl-task | en | what personal data is in AccountCreated? | 10 | 1 | 1 | atlas/contracts/account-created-v1 (2) | – |
| A85 | dev | nl-task | it | per quanto si conservano gli esiti delle verifiche? | 10 | 4 | 5 | atlas/slos/inspector-backend-sync-latency (0) | – |
| A86 | heldout | nl-task | en | how is the trip planner latency SLO alerted? | 10 | 1 | 1 | atlas/slos/trip-planner-latency (2) | – |
| A87 | dev | nl-task | en | what is the SLI for the login availability SLO? | 10 | 1 | 1 | atlas/slos/identity-service-login-availability (2) | – |
| A88 | dev | nl-task | it | qual è l'obiettivo dello SLO di sincronizzazione dei controllori? | 10 | 1 | 1 | atlas/slos/inspector-backend-sync-latency (2) | – |
| A89 | heldout | nl-task | en | what are the options for the multi-region question? | 10 | 1 | 1 | atlas/questions/q-001-multi-region-active-active (2) | – |
| A90 | heldout | nl-task | it | qual è l'orientamento attuale sulla licenza di moneta elettronica? | 10 | 1 | 1 | atlas/questions/q-002-wallet-emoney-licence (2) | – |
| A91 | heldout | nl-task | en | when does support for Keycloak 25 end? | 10 | 1 | 1 | atlas/dependencies/keycloak (2) | – |
| A92 | heldout | nl-task | en | which services depend on Redis? | 10 | 1 | 1 | atlas/dependencies/redis (2) | – |
| A93 | dev | nl-task | en | what does the notification hub consume? | 10 | 1 | 1 | atlas/services/notification-hub (2) | – |
| A94 | dev | nl-task | it | da cosa dipende il backend dei controllori? | 10 | 2 | 2 | atlas/slos/inspector-backend-sync-latency (0) | – |
| A95 | dev | nl-task | en | who approves a refund batch above 10,000 euro when the queue is unstuck? | 10 | 1 | 1 | atlas/runbooks/refund-queue-unstick (2) | – |
| A96 | heldout | nl-task | it | quali sono i prerequisiti per il failover di PostgreSQL? | 10 | 1 | 1 | atlas/runbooks/postgres-failover (2) | – |
| A97 | heldout | nl-task | en | what must every ClickHouse raw table declare before an upgrade? | 10 | 1 | 1 | atlas/dependencies/clickhouse (2) | – |
| A98 | dev | nl-task | en | what pages the fare engine latency SLO? | 10 | 1 | 1 | atlas/slos/fare-engine-latency-p99 (2) | – |
| A99 | dev | nl-task | en | until when is Kubernetes 1.31 supported? | 10 | 1 | 1 | atlas/dependencies/kubernetes-eks (2) | – |


## Hybrid run

Fusion alpha 0.5 (dense weight) · normalization lexical-tmm · units sections · split all

### alpinaria

Embedder `openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:32000` · remote true · dimension 512 · degraded false · cache rows 694  
Documents: 702 units, 0 embedded, 702 reused, 0 requests, 0 prompt tokens, 1 ms  
Queries: 203 encoded in 203 requests, 1540 prompt tokens · encoding p50 169.4 ms, p95 329.0 ms · search p50 1.72 ms, p95 2.66 ms (excluding encoding)

| category | n | lexical Recall@5 | hybrid Recall@5 | delta | lexical 95% CI half-width | regressed |
|---|---|---|---|---|---|---|
| accent | 11 | 84.8% | 84.8% | +0.0 | 0.129 | no |
| disambig | 12 | 65.3% | 93.1% | +27.8 | 0.139 | no |
| exact | 18 | 88.5% | 85.9% | -2.6 | 0.098 | no |
| freshness | 11 | 72.0% | 97.7% | +25.8 | 0.182 | no |
| keyword | 22 | 86.0% | 81.9% | -4.1 | 0.089 | no |
| mixed-lang | 14 | 73.8% | 90.5% | +16.7 | 0.143 | no |
| morph | 16 | 69.3% | 76.6% | +7.3 | 0.141 | no |
| nl-task | 52 | 74.4% | 84.7% | +10.3 | 0.086 | no |
| playbook | 9 | 60.2% | 88.0% | +27.8 | 0.194 | no |
| synonym | 16 | 55.7% | 59.4% | +3.6 | 0.148 | no |

### atlas

Embedder `openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:32000` · remote true · dimension 512 · degraded false · cache rows 955  
Documents: 1010 units, 0 embedded, 1010 reused, 0 requests, 0 prompt tokens, 1 ms  
Queries: 99 encoded in 99 requests, 803 prompt tokens · encoding p50 176.5 ms, p95 368.6 ms · search p50 2.56 ms, p95 3.06 ms (excluding encoding)

| category | n | lexical Recall@5 | hybrid Recall@5 | delta | lexical 95% CI half-width | regressed |
|---|---|---|---|---|---|---|
| accent | 4 | 83.3% | 91.7% | +8.3 | 0.250 | no |
| disambig | 6 | 94.4% | 100.0% | +5.6 | 0.083 | no |
| exact | 8 | 100.0% | 100.0% | +0.0 | 0.000 | no |
| freshness | 3 | 63.9% | 58.3% | -5.6 | 0.375 | no |
| keyword | 9 | 95.6% | 88.1% | -7.4 | 0.067 | yes |
| mixed-lang | 4 | 79.2% | 100.0% | +20.8 | 0.208 | no |
| morph | 6 | 61.1% | 86.1% | +25.0 | 0.167 | no |
| nl-task | 39 | 75.0% | 91.7% | +16.7 | 0.104 | no |
| standards | 4 | 37.5% | 58.3% | +20.8 | 0.208 | no |
| synonym | 6 | 41.7% | 52.8% | +11.1 | 0.236 | no |


## Measurement record (WP3c)

Final run: text-embedding-3-small at 512 dimensions, section units (the new default), fusion alpha 0.5 with lexical-tmm normalization, dense candidate depth 200, lexical evidence for dense candidates and the literal guard; chosen on the dev split only. Lexical numbers are the shipped 0.10 search re-run in the same process and equal the committed lexical-0.10 report.

| fixture | split | lexical-0.10 Recall@5 (95% CI) | hybrid Recall@5 (95% CI) | lexical nDCG@10 | hybrid nDCG@10 | lexical P@1 | hybrid P@1 |
|---|---|---|---|---|---|---|---|
| alpinaria | full (181) | 0.742 [0.697, 0.784] | 0.835 [0.796, 0.870] | 0.814 | 0.861 | 0.917 | 0.895 |
| alpinaria | dev (129) | 0.743 [0.691, 0.791] | 0.820 [0.773, 0.866] | 0.812 | 0.854 | 0.930 | 0.899 |
| alpinaria | heldout (52) | 0.742 [0.664, 0.829] | 0.871 [0.810, 0.927] | 0.819 | 0.880 | 0.885 | 0.885 |
| atlas | full (89) | 0.760 [0.693, 0.823] | 0.874 [0.820, 0.923] | 0.790 | 0.849 | 0.831 | 0.809 |
| atlas | dev (62) | 0.749 [0.673, 0.828] | 0.858 [0.794, 0.917] | 0.784 | 0.826 | 0.823 | 0.790 |
| atlas | heldout (27) | 0.785 [0.673, 0.887] | 0.909 [0.810, 0.983] | 0.803 | 0.902 | 0.852 | 0.852 |

Pre-registered WP3c acceptance with section units: alpinaria synonym Recall@5 >= 0.70: not met (0.557 -> 0.594; dev 0.569, heldout 0.667 on 4 queries; concept units 0.542; dense-only sections reach 0.81 on dev synonyms, so the shortfall is now in fusion with keyword-heavy lexical scores rather than in the units). Mixed-language >= 0.85: met (0.738 -> 0.905). No category regresses by more than its bootstrap CI: not met (atlas keyword 0.956 -> 0.881 on 9 queries against a half-width of 0.067; it holds with concept units). Atlas exact holds at 1.000. Atlas improves (0.760 -> 0.874). Hybrid p95 excluding query encoding: 34 ms at 5,000 concepts x 4 units (met), 162 ms at 20,000 concepts where lexical alone takes 100 ms (not met). Zero-result rate stays 0. lowConfidence reads the displayed top result: alpinaria precision/recall 70.6% / 54.5% (lexical 64.7% / 50.0%), atlas 60.0% / 60.0% (lexical 63.6% / 70.0%). Query encoding p50/p95 169/329 ms (alpinaria) and 177/369 ms (atlas), reported apart from search latency.

### Pre-registered alpha rule

Alpha selection rule, written before the first live sweep (2026-10-24):

- Grid: alpha in {0, 0.1, ..., 1}, text-embedding-3-small at 512 dimensions, concept units.
- Data: dev split only of alpinaria (129 answerable dev queries) and atlas (62).
- Criterion: maximise the unweighted mean of alpinaria-dev Recall@5 and atlas-dev Recall@5.
- Ties (within 0.005 of the best mean): higher mean nDCG@10, then the smaller alpha (closer to lexical).
- One default for both fixtures (plan R-10; no per-fixture alpha).
- The 1,536-dimension run uses the chosen alpha on dev only; 512 stays the default unless 1,536
  improves the dev mean Recall@5 by more than the larger of the two dev bootstrap half-widths.
- Held-out and full numbers are computed once, after the choice, and not used to revise it.

### Dev-split sweeps (Recall@5; text-embedding-3-small, 512 dimensions)

Normalization `minmax`:

| alpha | alpinaria dev | atlas dev | mean | mean nDCG@10 | alpinaria synonym / mixed-lang / keyword / exact | atlas synonym / mixed-lang / keyword / exact |
|---|---|---|---|---|---|---|
| 0 | 0.743 | 0.749 | 0.746 | 0.798 | 0.56 / 0.82 / 0.86 / 0.90 | 0.46 / 0.89 / 1.00 / 1.00 |
| 0.1 | 0.805 | 0.852 | 0.828 | 0.834 | 0.58 / 0.92 / 0.76 / 0.88 | 0.46 / 1.00 / 0.86 / 1.00 |
| 0.2 | 0.792 | 0.852 | 0.822 | 0.832 | 0.54 / 0.92 / 0.72 / 0.88 | 0.46 / 1.00 / 0.86 / 1.00 |
| 0.3 | 0.797 | 0.858 | 0.828 | 0.835 | 0.54 / 0.92 / 0.72 / 0.88 | 0.46 / 1.00 / 0.80 / 1.00 |
| 0.4 | 0.798 | 0.858 | 0.828 | 0.835 | 0.54 / 0.92 / 0.72 / 0.88 | 0.46 / 1.00 / 0.80 / 1.00 |
| 0.5 | 0.815 | 0.853 | 0.834 | 0.838 | 0.57 / 0.95 / 0.72 / 0.88 | 0.46 / 1.00 / 0.80 / 1.00 |
| 0.6 | 0.817 | 0.841 | 0.829 | 0.832 | 0.62 / 0.95 / 0.68 / 0.88 | 0.46 / 1.00 / 0.67 / 1.00 |
| 0.7 | 0.815 | 0.835 | 0.825 | 0.827 | 0.71 / 0.95 / 0.61 / 0.79 | 0.54 / 1.00 / 0.67 / 1.00 |
| 0.8 | 0.819 | 0.787 | 0.803 | 0.819 | 0.78 / 0.95 / 0.55 / 0.76 | 0.54 / 0.67 / 0.59 / 1.00 |
| 0.9 | 0.787 | 0.766 | 0.776 | 0.803 | 0.81 / 0.95 / 0.52 / 0.69 | 0.54 / 0.67 / 0.59 / 1.00 |
| 1 | 0.749 | 0.692 | 0.720 | 0.727 | 0.81 / 0.95 / 0.46 / 0.58 | 0.48 / 0.56 / 0.55 / 0.67 |

Normalization `lexical-tmm`:

| alpha | alpinaria dev | atlas dev | mean | mean nDCG@10 | alpinaria synonym / mixed-lang / keyword / exact | atlas synonym / mixed-lang / keyword / exact |
|---|---|---|---|---|---|---|
| 0 | 0.743 | 0.749 | 0.746 | 0.798 | 0.56 / 0.82 / 0.86 / 0.90 | 0.46 / 0.89 / 1.00 / 1.00 |
| 0.1 | 0.808 | 0.862 | 0.835 | 0.839 | 0.54 / 0.92 / 0.81 / 0.90 | 0.46 / 1.00 / 0.97 / 1.00 |
| 0.2 | 0.798 | 0.857 | 0.828 | 0.837 | 0.54 / 0.92 / 0.75 / 0.88 | 0.46 / 1.00 / 0.91 / 1.00 |
| 0.3 | 0.799 | 0.869 | 0.834 | 0.838 | 0.54 / 0.92 / 0.75 / 0.88 | 0.46 / 1.00 / 0.91 / 1.00 |
| 0.4 | 0.801 | 0.869 | 0.835 | 0.837 | 0.54 / 0.92 / 0.75 / 0.88 | 0.46 / 1.00 / 0.91 / 1.00 |
| 0.5 | 0.820 | 0.858 | 0.839 | 0.840 | 0.57 / 0.95 / 0.77 / 0.88 | 0.46 / 1.00 / 0.86 / 1.00 |
| 0.6 | 0.820 | 0.850 | 0.835 | 0.833 | 0.62 / 0.95 / 0.70 / 0.88 | 0.46 / 1.00 / 0.77 / 1.00 |
| 0.7 | 0.817 | 0.845 | 0.831 | 0.828 | 0.71 / 0.95 / 0.63 / 0.79 | 0.54 / 1.00 / 0.77 / 1.00 |
| 0.8 | 0.817 | 0.792 | 0.805 | 0.820 | 0.76 / 0.95 / 0.55 / 0.76 | 0.54 / 0.67 / 0.65 / 1.00 |
| 0.9 | 0.787 | 0.767 | 0.777 | 0.803 | 0.81 / 0.95 / 0.52 / 0.69 | 0.54 / 0.67 / 0.61 / 1.00 |
| 1 | 0.749 | 0.692 | 0.720 | 0.727 | 0.81 / 0.95 / 0.46 / 0.58 | 0.48 / 0.56 / 0.55 / 0.67 |

Normalization `tmm`:

| alpha | alpinaria dev | atlas dev | mean | mean nDCG@10 | alpinaria synonym / mixed-lang / keyword / exact | atlas synonym / mixed-lang / keyword / exact |
|---|---|---|---|---|---|---|
| 0 | 0.743 | 0.749 | 0.746 | 0.798 | 0.56 / 0.82 / 0.86 / 0.90 | 0.46 / 0.89 / 1.00 / 1.00 |
| 0.1 | 0.810 | 0.854 | 0.832 | 0.837 | 0.58 / 0.92 / 0.79 / 0.90 | 0.46 / 1.00 / 0.97 / 1.00 |
| 0.2 | 0.812 | 0.862 | 0.837 | 0.838 | 0.58 / 0.92 / 0.81 / 0.90 | 0.46 / 1.00 / 0.97 / 1.00 |
| 0.3 | 0.808 | 0.862 | 0.835 | 0.839 | 0.54 / 0.92 / 0.81 / 0.90 | 0.46 / 1.00 / 0.97 / 1.00 |
| 0.4 | 0.805 | 0.862 | 0.834 | 0.837 | 0.54 / 0.92 / 0.81 / 0.88 | 0.46 / 1.00 / 0.97 / 1.00 |
| 0.5 | 0.800 | 0.865 | 0.832 | 0.840 | 0.54 / 0.92 / 0.78 / 0.88 | 0.46 / 1.00 / 0.91 / 1.00 |
| 0.6 | 0.798 | 0.869 | 0.834 | 0.839 | 0.54 / 0.92 / 0.77 / 0.88 | 0.46 / 1.00 / 0.91 / 1.00 |
| 0.7 | 0.803 | 0.869 | 0.836 | 0.839 | 0.54 / 0.92 / 0.75 / 0.88 | 0.46 / 1.00 / 0.91 / 1.00 |
| 0.8 | 0.815 | 0.864 | 0.839 | 0.839 | 0.57 / 0.92 / 0.75 / 0.88 | 0.46 / 1.00 / 0.91 / 1.00 |
| 0.9 | 0.839 | 0.823 | 0.831 | 0.835 | 0.73 / 0.95 / 0.73 / 0.85 | 0.54 / 0.67 / 0.77 / 1.00 |
| 1 | 0.749 | 0.692 | 0.720 | 0.727 | 0.81 / 0.95 / 0.46 / 0.58 | 0.48 / 0.56 / 0.55 / 0.67 |

### Concept units, same fixes and defaults (alpha 0.4, tmm), for comparison

| fixture | full Recall@5 | dev | heldout | synonym | mixed-lang | exact | keyword |
|---|---|---|---|---|---|---|---|
| alpinaria | 0.830 | 0.814 | 0.869 | 0.542 | 0.881 | 0.894 | 0.871 |
| atlas | 0.882 | 0.873 | 0.902 | 0.528 | 1.000 | 1.000 | 0.933 |

### 1,536 dimensions on dev (concept units, before the review fixes)

| fixture | Recall@5 (95% CI) | nDCG@10 | synonym | mixed-lang |
|---|---|---|---|---|
| alpinaria | 0.817 [0.773, 0.861] | 0.869 | 0.542 | 0.917 |
| atlas | 0.849 [0.782, 0.916] | 0.851 | 0.542 | 1.000 |

### Hybrid latency at scale (synthetic vectors, query encoding excluded)

`node --expose-gc scripts/index-benchmark.js --sizes <n> --rounds <r> --search-module scripts/hybrid-bench-module.js --search-options '{"dimension":512,"unitsPerConcept":<k>}'`

| run | concepts | vectors | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| hybrid, 4 units per concept | 5000 | 20000 | 25.11 | 34.18 | 46.13 |
| hybrid, 1 unit per concept | 20000 | 20000 | 98.85 | 162.33 | 263.13 |
| lexical only | 5000 | – | 8.74 | 15.49 | 16.74 |
| lexical only | 20000 | – | 53.82 | 100.4 | 156.12 |

### Notes

- Deviation from the pre-registration, on dev data only: the rule fixed the alpha grid under min-max; after the first sweep exposed a min-max artifact, two more normalizations were swept and the same rule applied across all grids. Each round (first, review fixes, section units) re-swept dev and computed held-out and full numbers once, after the choice.
- Concept units under the same fixes are recorded below for comparison: they meet the no-regression criterion and score a slightly higher dev mean; sections lift synonym and mixed-language recall but cost atlas keyword recall.
- The 1,536-dimension run was measured with concept units before the review fixes and gave the same dev mean as 512; it was not repeated.
- The per-fixture search latencies come from the evaluation process; the scale benchmark is the reference for the 60 ms budget.
- Prompt tokens in this round: 79,648 (about 0.0016 USD); 343,564 over all three rounds (about 0.0069 USD).

