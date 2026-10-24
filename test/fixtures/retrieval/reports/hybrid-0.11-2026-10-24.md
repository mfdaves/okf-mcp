# Retrieval evaluation — hybrid 0.11 (text-embedding-3-small, 512 dims, alpha 0.4, tmm)

Generated 2026-10-24T19:09:09.839Z · Node v24.17.0 (linux x64, gc exposed: false) · search module `src/search/query.js` with options `{"hybrid":true,"alpha":0.4,"normalization":"tmm","embedUnits":"concepts"}` · limit 10 · split all · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-search.js`. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest.{json,md}`; a committed baseline is produced only with an explicit `--out test/fixtures/retrieval/reports/baseline-{date}`.

## Summary

| fixture | queries | Recall@5 (95% CI) | nDCG@10 (95% CI) | MRR@10 | P@1 | zero-result | no-answer returned any | lowConfidence P / R | p95 ms | RSS MB |
|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | 203 | 0.836 [0.799, 0.870] | 0.872 [0.843, 0.896] | 0.952 | 0.928 | 0.0% | 100.0% | 64.7% / 50.0% | 2.48 | 192 |
| atlas | 99 | 0.843 [0.783, 0.899] | 0.854 [0.810, 0.899] | 0.889 | 0.831 | 0.0% | 100.0% | 63.6% / 70.0% | 17.38 | 155.5 |

## Fixture alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · bundles alpinaria (209), playbook (21) · 228 concepts · valid for project: true · as-of 2026-10-24 · split all  
Queries: 203 (181 answerable, 22 no-answer, 52 with sectionAnchor)

### Overall (answerable queries, 95% bootstrap CI)

| metric | value | 95% CI |
|---|---|---|
| Recall@5 | 0.836 | [0.799, 0.870] |
| MustRecall@5 | 0.936 | [0.903, 0.964] |
| nDCG@10 | 0.872 | [0.843, 0.896] |
| MRR@10 | 0.952 | [0.923, 0.976] |
| P@1 | 0.928 | [0.884, 0.961] |
| hit@10 | 0.989 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 11/34 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 11 | 89.4% | 100.0% | 0.905 | 0.927 | 90.9% | 100.0% | 0.0% | – |
| disambig | 12 | 88.9% | 91.7% | 0.879 | 1.000 | 100.0% | 100.0% | 0.0% | 2/12 |
| exact | 18 | 88.3% | 94.4% | 0.912 | 0.963 | 94.4% | 100.0% | 0.0% | 0/1 |
| freshness | 11 | 97.7% | 100.0% | 0.879 | 1.000 | 100.0% | 100.0% | 0.0% | 7/11 |
| keyword | 22 | 85.8% | 93.2% | 0.892 | 1.000 | 100.0% | 100.0% | 0.0% | 0/2 |
| mixed-lang | 14 | 88.1% | 100.0% | 0.914 | 1.000 | 100.0% | 100.0% | 0.0% | 1/2 |
| morph | 16 | 77.6% | 93.8% | 0.852 | 0.906 | 87.5% | 93.8% | 0.0% | 0/1 |
| nl-task | 52 | 86.8% | 98.1% | 0.906 | 0.971 | 94.2% | 100.0% | 0.0% | 1/5 |
| playbook | 9 | 71.3% | 88.9% | 0.804 | 0.903 | 88.9% | 100.0% | 0.0% | – |
| synonym | 16 | 55.7% | 68.8% | 0.674 | 0.789 | 68.8% | 93.8% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 85 | 83.4% | 93.5% | 0.863 | 0.929 | 89.4% | 97.6% | 0.0% | 7/20 |
| it | 80 | 83.2% | 92.5% | 0.874 | 0.967 | 95.0% | 100.0% | 0.0% | 3/12 |
| mixed | 16 | 86.5% | 100.0% | 0.905 | 1.000 | 100.0% | 100.0% | 0.0% | 1/2 |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 129 | 82.2% | 93.0% | 0.865 | 0.957 | 94.6% | 98.4% | 0.0% | 9/26 |
| heldout | 52 | 86.8% | 95.2% | 0.887 | 0.939 | 88.5% | 100.0% | 0.0% | 2/8 |

### No-answer queries

Returned at least one result: 22/22 (100.0%); zero results: 0.0%.  
lowConfidence (mode === "any" && top1.coverage < 0.5): flagged 11/22 no-answer (recall 50.0%), 6 answerable (4 with a relevant top-1); precision 64.7%.

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
| Q161 | heldout | garanzia di due anni sugli scarponi | 10 | any | 0.25 | no |
| Q162 | dev | competitor Decathlon | 10 | any | 0.50 | no |
| Q163 | dev | pagina categoria zaini | 10 | all | 1.00 | no |
| Q164 | dev | TikTok content strategy | 10 | any | 0.33 | yes |
| Q165 | dev | giacca in piumino | 10 | any | 0.50 | no |
| Q166 | dev | robots.txt rule for the staging subdomain | 10 | any | 0.60 | no |
| Q167 | dev | collaborazione con influencer | 10 | any | 0.00 | no |
| Q168 | dev | GA4 event tracking setup | 10 | any | 0.25 | yes |
| Q169 | dev | numero di negozi fisici | 10 | any | 0.33 | yes |

### Latency, build and memory

| metric | value |
|---|---|
| query latency p50 | 1.49 ms |
| query latency p95 | 2.48 ms |
| query latency mean / max | 1.65 / 4.30 ms |
| OKF index build | 119.9 ms |
| search index prepare | n/a (built lazily; see warm-up) |
| warm-up pass | 924.8 ms |
| RSS before build / after build / end | 108.5 / 171.6 / 192 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| Q01 | dev | nl-task | en | which landing page targets winter hiking boots for women? | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q02 | dev | nl-task | it | cosa abbiamo deciso sulle pagine categoria duplicate? | 10 | 1 | 1 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q03 | dev | nl-task | en | what is the current status of core web vitals on mobile? | 10 | 2 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (0) | yes |
| Q04 | dev | nl-task | it | quali claim sull'impermeabilità possiamo usare nelle descrizioni prodotto? | 10 | 1 | 1 | alpinaria/policies/claim-impermeabile (2) | – |
| Q05 | dev | nl-task | en | experiment Made in Italy English titles result | 10 | 1 | 1 | alpinaria/experiments/en-title-italian-made (2) | – |
| Q06 | heldout | nl-task | it | chi è il competitor più forte sugli scarponi da trekking? | 10 | 1 | 4,1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q07 | dev | nl-task | en | English pages missing hreflang return tags | 10 | 1 | 1,2 | alpinaria/seo-findings/hreflang-missing-en-pages (2) | – |
| Q08 | dev | nl-task | it | perché è calato il traffico sulle pagine dei pile? | 10 | 1 | 1 | alpinaria/seo-findings/calo-traffico-pile-autunno-2026 (2) | – |
| Q09 | dev | nl-task | en | how many words of unique copy does a product page need | 10 | 1 | 1 | alpinaria/decisions/product-page-copy-minimum-120-words (2) | – |
| Q10 | dev | nl-task | it | a che pubblico ci rivolgiamo con la linea Torrente? | 10 | 1 | miss,1 | alpinaria/product-lines/torrente (2) | – |
| Q11 | dev | keyword | it | scarponi trekking donna | 10 | 1 | 3,1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | no |
| Q12 | dev | keyword | en | approach shoes | 10 | 1 | 3,1 | alpinaria/landing-pages/en-approach-shoes (2) | – |
| Q13 | dev | keyword | it | calze merino | 10 | 1 | 4,1 | alpinaria/landing-pages/it-calze-merino (2) | – |
| Q14 | heldout | keyword | en | hreflang | 10 | 1 | 3,2,4 | playbook/guidelines/hreflang-checklist (1) | – |
| Q15 | heldout | keyword | it | cannibalizzazione | 10 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q16 | dev | keyword | en | sitemap | 10 | 1 | 3,2 | playbook/guidelines/xml-sitemap-hygiene (1) | – |
| Q17 | heldout | keyword | it | giacca guscio | 10 | 1 | 1,4 | alpinaria/seo-findings/query-mismatch-giacca-guscio (2) | – |
| Q18 | dev | keyword | en | trail running | 10 | 1 | 7,4 | alpinaria/landing-pages/en-trail-running-shoes (1) | – |
| Q19 | dev | mixed-lang | mixed | landing page scarponi donna | 10 | 1 | 2 | alpinaria/landing-pages/it-scarponi-da-trekking-donna-old (1) | yes |
| Q20 | dev | mixed-lang | mixed | keyword cluster giacche impermeabili intent | 10 | 1 | 1 | alpinaria/keyword-clusters/giacca-impermeabile-montagna (2) | – |
| Q21 | dev | mixed-lang | mixed | finding pile traffico | 10 | 1 | 1 | alpinaria/seo-findings/calo-traffico-pile-autunno-2026 (2) | – |
| Q22 | dev | mixed-lang | mixed | policy claim riciclato | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q23 | heldout | mixed-lang | mixed | brief guida scarponi invernali women | 10 | 1 | 1 | alpinaria/content-briefs/guida-scarponi-invernali-donna (2) | – |
| Q24 | heldout | exact | en | TRK-W-042 | 10 | 1 | 1 | alpinaria/products/trk-w-042-dolomiti-aquastop-w (2) | – |
| Q25 | dev | exact | en | /en/womens-winter-hiking-boots/ | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q26 | heldout | exact | en | AquaStop | 10 | 3 | miss | alpinaria/products/trk-m-042-dolomiti-aquastop-m (0) | – |
| Q27 | dev | exact | it | Montevia | 10 | 1 | 1 | alpinaria/competitors/montevia (2) | – |
| Q28 | dev | exact | it | /scarponi-da-trekking/donna/ | 10 | 1 | 1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q29 | dev | exact | en | JKT-U-310 | 10 | 1 | 1 | alpinaria/products/jkt-u-310-vetta-guscio-u (2) | – |
| Q30 | dev | exact | en | x-default | 10 | 1 | 2,1 | alpinaria/experiments/hreflang-x-default-en (2) | – |
| Q31 | dev | morph | it | scarpone trekking donna | 10 | 1 | 3,1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q32 | dev | morph | en | canonicalize filtered category pages | 10 | miss | miss,miss | playbook/guidelines/pagination (0) | – |
| Q33 | dev | morph | it | impermeabilizzazione scarponi | 10 | 1 | 2,1 | alpinaria/content-briefs/guida-impermeabilizzare-scarponi (2) | – |
| Q34 | heldout | morph | en | redirects outlet | 10 | 1 | 1,2 | alpinaria/technical-issues/redirect-chains-outlet (2) | – |
| Q35 | dev | morph | it | pagina categoria duplicata | 10 | 1 | 1,2 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | – |
| Q36 | heldout | morph | en | missing alt texts images | 10 | 2 | 4,2 | playbook/guidelines/image-alt-text (0) | – |
| Q37 | dev | accent | it | impermeabilita scarponi | 10 | 1 | 1,2 | alpinaria/policies/claim-impermeabile (2) | – |
| Q38 | dev | accent | it | sostenibilita claim | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q39 | heldout | accent | it | traspirabilità membrana | 10 | 1 | 1 | alpinaria/keyword-clusters/membrana-impermeabile-info (2) | – |
| Q40 | heldout | accent | it | novita inverno 2026 | 10 | 1 | 1 | alpinaria/content-briefs/calendario-contenuti-inverno-2026 (2) | – |
| Q41 | dev | synonym | en | rain jacket for hiking | 10 | 1 | 1,9 | alpinaria/keyword-clusters/hardshell-jacket (2) | – |
| Q42 | dev | synonym | it | scarpe da neve donna | 10 | 8 | miss,8 | alpinaria/products/win-w-305-nevaio-neve-w (0) | – |
| Q43 | dev | synonym | en | page speed problems on phones | 10 | miss | miss | alpinaria/decisions/product-page-copy-minimum-120-words (0) | – |
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
| Q71 | dev | nl-task | it | come dobbiamo scrivere gli alt delle immagini prodotto? | 10 | 1 | 5 | alpinaria/seo-findings/immagini-senza-alt (1) | – |
| Q72 | dev | nl-task | en | is the x-default supposed to point to the English or the Italian page? | 10 | 1 | 2,1 | alpinaria/experiments/hreflang-x-default-en (2) | – |
| Q73 | dev | nl-task | it | qual è il tasso di conversione migliore del sito? | 10 | 1 | 1 | alpinaria/landing-pages/it-calze-merino (2) | – |
| Q74 | dev | nl-task | en | when is the packing guide refresh due? | 10 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q75 | heldout | nl-task | it | quante immagini prodotto sono senza alt text? | 10 | 1 | 1 | alpinaria/seo-findings/immagini-senza-alt (2) | – |
| Q76 | dev | nl-task | en | what should we do about the 300 dead URLs in the sitemap? | 10 | 1 | 1,2 | alpinaria/seo-findings/sitemap-stale-urls (2) | – |
| Q77 | dev | nl-task | it | perché abbiamo interrotto il test delle emoji nelle meta description? | 10 | 1 | 1 | alpinaria/experiments/meta-description-emoji (2) | – |
| Q78 | heldout | nl-task | en | which competitor sponsors the Lavaredo Ultra Trail? | 10 | 1 | 1 | alpinaria/competitors/trailforge (2) | – |
| Q79 | dev | nl-task | it | dove devono stare le guide informative nella struttura URL? | 10 | 1 | 1 | alpinaria/decisions/blog-guides-under-guide-folder (2) | – |
| Q80 | heldout | nl-task | en | what is the outreach plan for the next backlink wave? | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q81 | heldout | nl-task | it | che numero consigliamo con le calze spesse? | 10 | 1 | 1 | alpinaria/content-briefs/guida-taglie-scarponi (2) | – |
| Q82 | dev | keyword | it | doposci | 10 | 1 | 1,4 | alpinaria/keyword-clusters/scarponcini-invernali-donna (2) | – |
| Q83 | dev | keyword | en | crawl budget | 10 | 1 | 1 | alpinaria/seo-findings/faceted-navigation-index-bloat (2) | – |
| Q84 | dev | keyword | it | risuolabile | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q85 | heldout | keyword | en | disavow | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q86 | dev | keyword | en | featured snippet | 10 | 1 | 1,2 | alpinaria/seo-findings/featured-snippet-impermeabilizzare (2) | – |
| Q87 | dev | keyword | it | tasselli | 10 | 1 | miss | alpinaria/content-briefs/torrente-product-copy-refresh (1) | – |
| Q88 | heldout | keyword | en | GRS certified | 10 | 1 | 1,3 | alpinaria/product-lines/bosco (2) | – |
| Q89 | dev | keyword | it | settimana bianca | 10 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q90 | heldout | keyword | en | aggregateRating | 10 | 1 | 1 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q91 | dev | keyword | en | share of voice | 10 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q92 | dev | keyword | en | Montebelluna | 10 | 1 | 1,5 | alpinaria/content-briefs/en-italian-hiking-boots-brands-history (2) | – |
| Q93 | dev | keyword | en | Alta Via 1 | 10 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q94 | heldout | keyword | it | redirect 301 | 10 | 1 | 1 | alpinaria/decisions/redirect-vecchia-pagina-donna (2) | – |
| Q95 | dev | mixed-lang | mixed | decision canonical filtri colore | 10 | 1 | 1,5 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q96 | heldout | mixed-lang | mixed | technical issue alt text PIM | 10 | 1 | 1 | alpinaria/technical-issues/alt-text-mancanti (2) | – |
| Q97 | dev | mixed-lang | mixed | audience trail runner mobile | 10 | 1 | 1 | alpinaria/audiences/trail-runner (2) | – |
| Q98 | dev | mixed-lang | mixed | competitor scarpe da avvicinamento | 10 | 1 | 1 | alpinaria/competitors/rocciaviva (2) | – |
| Q99 | heldout | mixed-lang | mixed | experiment title prezzo da 149 | 10 | 1 | 1 | alpinaria/experiments/title-tag-prezzo-scarponi-donna (2) | – |
| Q100 | heldout | mixed-lang | mixed | brief merino socks vesciche | 10 | 1 | 1 | alpinaria/content-briefs/en-merino-socks-benefits (2) | – |
| Q101 | dev | mixed-lang | mixed | finding crawl depth pagine inglesi | 10 | 1 | 1,5 | alpinaria/seo-findings/mobile-menu-crawl-depth (2) | – |
| Q102 | dev | mixed-lang | mixed | policy claim medici | 10 | 1 | 1 | alpinaria/policies/medical-health-claims (2) | – |
| Q103 | heldout | exact | en | WIN-W-309 | 10 | 1 | 1 | alpinaria/products/win-w-309-nevaio-polar-w (2) | – |
| Q104 | dev | exact | it | SCK-U-705 | 10 | 1 | 1 | alpinaria/products/sck-u-705-rifugio-calze-merino-heavy-u (2) | – |
| Q105 | dev | exact | en | /en/approach-shoes/ | 10 | 1 | 1 | alpinaria/landing-pages/en-approach-shoes (2) | – |
| Q106 | dev | exact | it | /abbigliamento/pile/ | 10 | 1 | 1 | alpinaria/landing-pages/it-pile (2) | – |
| Q107 | dev | exact | en | nordpasso.com | 10 | 1 | 1 | alpinaria/competitors/nordpasso (2) | – |
| Q108 | heldout | exact | it | Dolomyths | 10 | 1 | 1 | alpinaria/audiences/trail-runner (2) | – |
| Q109 | dev | exact | en | fetchpriority | 10 | 1 | 5 | alpinaria/technical-issues/lcp-immagini-prodotto-mobile (1) | – |
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
| Q120 | dev | morph | it | link interno perso | 10 | 1 | 2,1 | alpinaria/experiments/internal-links-pile-from-giacche (2) | – |
| Q121 | dev | morph | en | experiments with positive results | 10 | 1 | 2,1,3 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q122 | heldout | morph | it | cannibalizzazioni tra pagine | 10 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q123 | dev | morph | en | hydrating the filter widget | 10 | 1 | 1 | alpinaria/technical-issues/inp-filtri-plp (2) | no |
| Q124 | heldout | accent | it | priorita editoriale 2027 | 10 | 1 | 1 | alpinaria/decisions/trail-running-line-priority-2027 (2) | – |
| Q125 | dev | accent | it | sneaker Baita Citta | 10 | 1 | 1,2 | alpinaria/products/lfs-w-901-baita-citt-w (2) | – |
| Q126 | dev | accent | it | stagionalita cluster scarponi donna | 10 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-donna-transazionale (2) | – |
| Q127 | dev | accent | it | profondita di catalogo Montevia | 10 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q128 | dev | accent | it | disponibilità immediata famiglie | 10 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q129 | dev | accent | it | velocita di scroll mobile | 10 | 1 | 1 | alpinaria/experiments/category-intro-copy-length (2) | – |
| Q130 | dev | accent | it | gravita alta problemi tecnici | 10 | 5 | 5 | alpinaria/audiences/alpinisti-esperti (0) | – |
| Q131 | dev | synonym | en | insulated boots for snowshoeing | 10 | 1 | 3,miss | alpinaria/content-briefs/en-how-to-choose-winter-hiking-boots (1) | – |
| Q132 | dev | synonym | it | scarpe basse per camminare | 10 | 1 | 1,2 | alpinaria/keyword-clusters/scarpe-trekking-leggere (2) | – |
| Q133 | heldout | synonym | en | star ratings in search results | 10 | 1 | 1 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q134 | dev | synonym | it | marketplace che rivende i nostri prodotti a prezzo più basso | 10 | 1 | 1 | alpinaria/competitors/quota3000 (2) | – |
| Q135 | dev | synonym | en | slow filters on category pages | 10 | 2 | 2 | playbook/guidelines/pagination (0) | – |
| Q136 | heldout | synonym | it | pulizia delle scarpe in pelle | 10 | 1 | 1,miss | alpinaria/landing-pages/it-guida-cura-scarponi (2) | – |
| Q137 | heldout | synonym | en | German shoppers | 10 | 2 | 2 | alpinaria/competitors/nordpasso (0) | – |
| Q138 | dev | synonym | it | testi troppo corti nelle schede Torrente | 10 | 1 | 7,1 | alpinaria/content-briefs/torrente-product-copy-refresh (2) | – |
| Q139 | dev | synonym | en | mountain hut trek | 10 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q140 | heldout | synonym | it | capi in lana che non puzzano | 10 | 2 | 6 | alpinaria/keyword-clusters/calze-trekking-merino (0) | – |
| Q141 | heldout | freshness | en | referring domains count | 10 | 1 | 2 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (1) | yes |
| Q142 | dev | freshness | it | pagina categoria scarponi donna attuale | 10 | 1 | 2 | alpinaria/landing-pages/it-scarponi-da-trekking-donna-old (1) | yes |
| Q143 | dev | freshness | en | current LCP on mobile product pages | 10 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q144 | dev | freshness | it | filtri taglia robots disallow | 10 | 1 | 4,2 | alpinaria/technical-issues/parametri-filtri-indicizzati (1) | no |
| Q145 | dev | freshness | it | noindex sulle URL con parametri | 10 | 1 | 4 | alpinaria/decisions/noindex-filtri-colore-2026-03 (1) | yes |
| Q146 | heldout | freshness | en | backlink gap to Cimalta | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q147 | dev | freshness | en | mobile CLS value | 10 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q148 | dev | disambig | en | draft redesign of the women's winter page | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots-draft-v2 (2) | no |
| Q149 | heldout | disambig | it | pagina italiana delle giacche hardshell | 10 | 1 | 1 | alpinaria/landing-pages/it-giacche-impermeabili (2) | no |
| Q150 | dev | disambig | en | approach shoes category in Italian | 10 | 1 | 5 | alpinaria/landing-pages/en-approach-shoes (1) | yes |
| Q151 | dev | disambig | it | cluster transazionale scarponi uomo | 10 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-uomo-transazionale (2) | no |
| Q152 | dev | disambig | en | informational cluster about hiking boot sizing | 10 | 1 | 1 | alpinaria/keyword-clusters/boot-sizing-guide-en (2) | no |
| Q153 | dev | disambig | it | cluster taglie scarponi in italiano | 10 | 1 | 1 | alpinaria/keyword-clusters/misura-scarponi-trekking (2) | no |
| Q154 | heldout | disambig | en | Q2 backlink review numbers | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (2) | no |
| Q155 | dev | disambig | en | men's hiking boots English category page | 10 | 1 | 1 | alpinaria/landing-pages/en-mens-hiking-boots (2) | no |
| Q170 | dev | playbook | en | how do we tell transactional from informational clusters? | 10 | 8 | 8 | alpinaria/keyword-clusters/womens-winter-hiking-boots-informational (0) | – |
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
| Q186 | heldout | nl-task | en | what should English product copy not say? | 10 | 2 | 2 | alpinaria/policies/made-in-italy-claim (0) | – |
| Q187 | dev | keyword | it | lessico scarponi scarpe scarponcini | 10 | 1 | 1 | alpinaria/brand-voice/tono-di-voce-it (2) | – |
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
| Recall@5 | 0.843 | [0.783, 0.899] |
| MustRecall@5 | 0.949 | [0.904, 0.989] |
| nDCG@10 | 0.854 | [0.810, 0.899] |
| MRR@10 | 0.889 | [0.836, 0.940] |
| P@1 | 0.831 | [0.753, 0.899] |
| hit@10 | 0.989 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 1/9 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 4 | 83.3% | 100.0% | 0.936 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| disambig | 6 | 100.0% | 100.0% | 0.961 | 1.000 | 100.0% | 100.0% | 0.0% | 0/6 |
| exact | 8 | 91.7% | 100.0% | 0.967 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| freshness | 3 | 72.2% | 100.0% | 0.784 | 0.833 | 66.7% | 100.0% | 0.0% | 1/3 |
| keyword | 9 | 93.3% | 94.4% | 0.924 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| mixed-lang | 4 | 79.2% | 75.0% | 0.774 | 0.833 | 75.0% | 100.0% | 0.0% | – |
| morph | 6 | 75.0% | 100.0% | 0.903 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| nl-task | 39 | 87.8% | 97.4% | 0.881 | 0.892 | 82.1% | 100.0% | 0.0% | – |
| standards | 4 | 66.7% | 75.0% | 0.556 | 0.483 | 25.0% | 100.0% | 0.0% | – |
| synonym | 6 | 52.8% | 83.3% | 0.503 | 0.597 | 50.0% | 83.3% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 58 | 83.9% | 95.7% | 0.861 | 0.892 | 82.8% | 100.0% | 0.0% | 1/7 |
| it | 27 | 85.8% | 96.3% | 0.853 | 0.892 | 85.2% | 96.3% | 0.0% | 0/2 |
| mixed | 4 | 79.2% | 75.0% | 0.774 | 0.833 | 75.0% | 100.0% | 0.0% | – |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 62 | 84.4% | 96.8% | 0.851 | 0.886 | 82.3% | 98.4% | 0.0% | 1/6 |
| heldout | 27 | 84.0% | 90.7% | 0.863 | 0.897 | 85.2% | 100.0% | 0.0% | 0/3 |

### No-answer queries

Returned at least one result: 10/10 (100.0%); zero results: 0.0%.  
lowConfidence (mode === "any" && top1.coverage < 0.5): flagged 7/10 no-answer (recall 70.0%), 4 answerable (1 with a relevant top-1); precision 63.6%.

| id | split | query | returned | mode | top-1 coverage | flagged |
|---|---|---|---|---|---|---|
| A59 | dev | Jira ticket workflow for feature requests | 10 | any | 0.20 | yes |
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
| query latency p50 | 9.49 ms |
| query latency p95 | 17.38 ms |
| query latency mean / max | 10.58 / 23.10 ms |
| OKF index build | 259.1 ms |
| search index prepare | n/a (built lazily; see warm-up) |
| warm-up pass | 1666.3 ms |
| RSS before build / after build / end | 117 / 155.3 / 155.5 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| A01 | heldout | nl-task | en | why did validators in Bologna go offline in January? | 10 | 1 | 2,3 | atlas/services/validator-gateway (1) | – |
| A02 | dev | nl-task | it | cosa succede ai biglietti quando il validatore è offline? | 10 | 1 | 3 | atlas/runbooks/validator-offline-queue-drain (1) | – |
| A03 | dev | nl-task | en | how long do we keep raw validations? | 10 | 2 | 2,3 | atlas/questions/q-006-postgres-partitioning-validations (0) | – |
| A04 | dev | nl-task | it | chi è il reperibile per i problemi di pagamento? | 10 | 3 | 3 | atlas/runbooks/escalation-reperibilita-2025 (0) | – |
| A05 | dev | nl-task | en | what caused the duplicate subscription renewals? | 10 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A06 | dev | nl-task | it | come si riconciliano gli avvisi pagoPA non pagati? | 10 | 1 | 1 | atlas/runbooks/pagopa-reconciliation (2) | – |
| A07 | dev | nl-task | en | which PSP do we use and is there a fallback? | 10 | 2 | 2 | atlas/runbooks/rotate-psp-credentials (0) | – |
| A08 | dev | nl-task | en | what is the error budget for the API gateway? | 10 | 1 | 1 | atlas/slos/api-gateway-availability (2) | – |
| A09 | dev | nl-task | it | perché il login SPID non funzionava ad aprile? | 10 | 1 | 1,5 | atlas/incidents/inc-2026-013-spid-login-down (2) | – |
| A10 | dev | nl-task | en | where do we store the EMV token for tap-to-ride? | 10 | 1 | 1 | atlas/decisions/adr-014-emv-contactless-tokenization (2) | – |
| A11 | dev | nl-task | en | what should happen before activating a new fare table? | 10 | 2 | 2 | atlas/services/fare-engine (0) | – |
| A12 | heldout | nl-task | it | quale team possiede il warehouse? | 10 | 1 | 2 | atlas/services/reporting-warehouse (1) | – |
| A13 | dev | keyword | en | fencing token | 10 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A14 | heldout | keyword | en | RAPTOR | 10 | 1 | 1 | atlas/decisions/adr-005-raptor-trip-planner (2) | – |
| A15 | dev | keyword | it | ricevute telematiche | 10 | 1 | 4,1 | atlas/incidents/inc-2026-007-pagopa-timeout (2) | – |
| A16 | dev | keyword | en | outbox | 10 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A17 | dev | keyword | en | kill switch | 10 | 1 | 1 | atlas/runbooks/feature-flag-kill-switch (2) | – |
| A18 | heldout | keyword | it | tablespace Oracle | 10 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | – |
| A19 | dev | keyword | en | advisory lock | 10 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A20 | heldout | keyword | en | TTL | 10 | 1 | 1,miss | atlas/incidents/inc-2026-018-clickhouse-disk-full (2) | – |
| A21 | dev | keyword | en | Temporal | 10 | 1 | 2 | atlas/runbooks/refund-queue-unstick (1) | – |
| A22 | dev | mixed-lang | mixed | runbook riconciliazione wallet | 10 | 3 | 3 | atlas/runbooks/pagopa-reconciliation (0) | – |
| A23 | dev | mixed-lang | mixed | incident timeout nodo pagoPA | 10 | 1 | 1 | atlas/incidents/inc-2026-007-pagopa-timeout (2) | – |
| A24 | heldout | mixed-lang | mixed | SLO freschezza cruscotti operatori | 10 | 1 | 6 | atlas/questions/q-007-on-call-compensation (1) | – |
| A25 | dev | mixed-lang | mixed | ADR dismissione SBE | 10 | 1 | 1 | atlas/decisions/adr-017-retire-legacy-sbe (2) | – |
| A26 | dev | exact | en | INC-2026-011 | 10 | 1 | 1 | atlas/incidents/inc-2026-011-kafka-partition-lag (2) | – |
| A27 | dev | exact | en | ADR-012 | 10 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A28 | dev | exact | en | ticketing.validations.v2 | 10 | 1 | 1 | atlas/contracts/ticket-validated-v2 (2) | – |
| A29 | heldout | exact | en | partners.tessera.it | 10 | 1 | 1,2 | atlas/incidents/inc-2026-020-api-gateway-cert-expiry (2) | – |
| A30 | dev | exact | en | kill.notification-hub.marketing | 10 | 1 | 1 | atlas/runbooks/notification-rate-limit (2) | – |
| A31 | dev | exact | it | ORA-01653 | 10 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | – |
| A32 | heldout | exact | en | /v1/planner/plan | 10 | 1 | 1 | atlas/contracts/api-planner-v1 (2) | – |
| A33 | dev | exact | en | eu-south-1 | 10 | 1 | 1 | atlas/dependencies/kubernetes-eks (2) | – |
| A34 | dev | morph | en | rotating credentials | 10 | 1 | 1 | atlas/runbooks/rotate-psp-credentials (2) | – |
| A35 | dev | morph | it | coda offline validatore | 10 | 1 | 1 | atlas/runbooks/validator-offline-queue-drain (2) | – |
| A36 | dev | morph | en | renewing certificates | 10 | 1 | 1 | atlas/runbooks/certificate-renewal (2) | – |
| A37 | dev | morph | en | partitioned ledger tables | 10 | 1 | 1,4 | atlas/services/validation-ledger (2) | – |
| A38 | heldout | morph | it | sanzione duplicata | 10 | 1 | 1 | atlas/incidents/inc-2026-025-inspector-app-sync (2) | – |
| A39 | heldout | morph | en | consumers lagging | 10 | 1 | 1,4 | atlas/incidents/inc-2026-011-kafka-partition-lag (2) | – |
| A40 | dev | accent | it | reperibilita team dati | 10 | 1 | 1 | atlas/questions/q-007-on-call-compensation (2) | – |
| A41 | heldout | accent | it | team mobilita | 10 | 1 | 1 | atlas/teams/team-mobilita (2) | – |
| A42 | dev | accent | it | nuove funzionalita SBE | 10 | 1 | 1,2 | atlas/services/legacy-sbe (2) | – |
| A43 | dev | accent | it | proprietà e runtime di pagopa-adapter | 10 | 1 | 1 | atlas/services/pagopa-adapter (2) | – |
| A44 | dev | synonym | en | double billing of season passes | 10 | 1 | 3 | atlas/services/subscription-manager (1) | – |
| A45 | dev | synonym | it | procedura per spegnere una funzione in emergenza | 10 | miss | miss | atlas/runbooks/fare-table-hotfix (0) | – |
| A46 | heldout | synonym | en | vehicle locations stuck | 10 | 1 | 1 | atlas/incidents/inc-2026-023-avl-feed-stale (2) | – |
| A47 | dev | synonym | en | who to call at night when the warehouse breaks | 10 | 3 | 5 | atlas/services/reporting-warehouse (0) | – |
| A48 | heldout | synonym | it | doppio addebito sul borsellino | 10 | 4 | 4 | atlas/incidents/inc-2026-025-inspector-app-sync (0) | – |
| A49 | dev | synonym | en | attack on the website | 10 | 1 | 2 | atlas/postmortems/pm-2026-029-storefront-ddos (1) | – |
| A50 | dev | freshness | en | repository structure monorepo or polyrepo | 10 | 1 | 1 | atlas/decisions/adr-015-polyrepo-per-team (2) | no |
| A51 | dev | freshness | en | escalation procedure | 10 | 1 | 4 | atlas/runbooks/escalation-reperibilita-2025 (1) | yes |
| A52 | heldout | freshness | en | validation event schema | 10 | 2 | 2 | atlas/decisions/adr-002-kafka-as-event-backbone (0) | no |
| A53 | heldout | disambig | it | incidente storico del legacy SBE | 10 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | no |
| A54 | dev | disambig | en | deprecated validation event v1 | 10 | 1 | 1 | atlas/contracts/ticket-validated-v1 (2) | no |
| A55 | dev | disambig | en | Italian version of the escalation runbook | 10 | 1 | 1 | atlas/runbooks/escalation-reperibilita-2025 (2) | no |
| A56 | heldout | disambig | en | validator gateway latency SLO | 10 | 1 | 1 | atlas/slos/validator-gateway-ingest-latency (2) | no |
| A57 | dev | disambig | it | post-mortem dei validatori in italiano | 10 | 1 | 1 | atlas/postmortems/pm-2026-001-validator-outage (2) | no |
| A58 | dev | disambig | en | team that owns the API gateway | 10 | 1 | 2 | atlas/services/api-gateway (1) | no |
| A69 | dev | standards | en | when must a post-mortem be written? | 10 | 10 | 10 | atlas/postmortems/pm-2026-020-cert-expiry (0) | – |
| A70 | dev | standards | en | burn rate alert thresholds | 10 | 2 | 2 | atlas/runbooks/notification-rate-limit (0) | – |
| A71 | dev | standards | it | convenzione per i nomi dei topic | 10 | 1 | 1 | standards/standards/service-naming (2) | – |
| A72 | heldout | standards | en | how long does a deprecated REST major live | 10 | 3 | 3,4 | atlas/contracts/ticket-validated-v1 (0) | – |
| A73 | dev | nl-task | en | what are the consequences of the outbox decision? | 10 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A74 | dev | nl-task | it | quali sono le conseguenze dell'integrazione diretta con pagoPA? | 10 | 1 | 1 | atlas/decisions/adr-009-pagopa-direct-integration (2) | – |
| A75 | dev | nl-task | en | what went well during the wallet double charge incident? | 10 | 1 | 1 | atlas/postmortems/pm-2026-004-wallet-double-charge (2) | – |
| A76 | dev | nl-task | en | action items from the Kafka lag post-mortem | 10 | 1 | 1 | atlas/postmortems/pm-2026-011-kafka-lag (2) | – |
| A77 | heldout | nl-task | it | qual è la lezione del post-mortem pagoPA? | 10 | 1 | 1 | atlas/postmortems/pm-2026-007-pagopa-timeout (2) | – |
| A78 | dev | nl-task | en | how do I roll back a schema registry change? | 10 | 1 | 1 | atlas/runbooks/schema-registry-rollback (2) | – |
| A79 | dev | nl-task | en | what is the rollback for a fare table hotfix? | 10 | 1 | 1 | atlas/runbooks/fare-table-hotfix (2) | – |
| A80 | dev | nl-task | en | who do I escalate to when the validator queue is older than 48 hours? | 10 | 3 | 3 | atlas/runbooks/scale-validator-gateway (0) | – |
| A81 | dev | nl-task | it | quali sono i prerequisiti per la riconciliazione pagoPA? | 10 | 1 | 1 | atlas/runbooks/pagopa-reconciliation (2) | – |
| A82 | dev | nl-task | en | when should I use the Kafka replay runbook? | 10 | 1 | 1 | atlas/runbooks/replay-kafka-topic (2) | – |
| A83 | heldout | nl-task | en | what fields does the FareComputed event carry? | 10 | 1 | 1 | atlas/contracts/fare-computed-v1 (2) | – |
| A84 | heldout | nl-task | en | what personal data is in AccountCreated? | 10 | 1 | 1 | atlas/contracts/account-created-v1 (2) | – |
| A85 | dev | nl-task | it | per quanto si conservano gli esiti delle verifiche? | 10 | 1 | 1 | atlas/contracts/inspection-result-v1 (2) | – |
| A86 | heldout | nl-task | en | how is the trip planner latency SLO alerted? | 10 | 1 | 1 | atlas/slos/trip-planner-latency (2) | – |
| A87 | dev | nl-task | en | what is the SLI for the login availability SLO? | 10 | 1 | 1 | atlas/slos/identity-service-login-availability (2) | – |
| A88 | dev | nl-task | it | qual è l'obiettivo dello SLO di sincronizzazione dei controllori? | 10 | 1 | 1 | atlas/slos/inspector-backend-sync-latency (2) | – |
| A89 | heldout | nl-task | en | what are the options for the multi-region question? | 10 | 1 | 1 | atlas/questions/q-001-multi-region-active-active (2) | – |
| A90 | heldout | nl-task | it | qual è l'orientamento attuale sulla licenza di moneta elettronica? | 10 | 1 | 1 | atlas/questions/q-002-wallet-emoney-licence (2) | – |
| A91 | heldout | nl-task | en | when does support for Keycloak 25 end? | 10 | 1 | 1 | atlas/dependencies/keycloak (2) | – |
| A92 | heldout | nl-task | en | which services depend on Redis? | 10 | 8 | 8 | atlas/services/mobile-bff (0) | – |
| A93 | dev | nl-task | en | what does the notification hub consume? | 10 | 1 | 1 | atlas/services/notification-hub (2) | – |
| A94 | dev | nl-task | it | da cosa dipende il backend dei controllori? | 10 | 2 | 2 | atlas/slos/inspector-backend-sync-latency (0) | – |
| A95 | dev | nl-task | en | who approves a refund batch above 10,000 euro when the queue is unstuck? | 10 | 1 | 1 | atlas/runbooks/refund-queue-unstick (2) | – |
| A96 | heldout | nl-task | it | quali sono i prerequisiti per il failover di PostgreSQL? | 10 | 1 | 1 | atlas/runbooks/postgres-failover (2) | – |
| A97 | heldout | nl-task | en | what must every ClickHouse raw table declare before an upgrade? | 10 | 1 | 1 | atlas/dependencies/clickhouse (2) | – |
| A98 | dev | nl-task | en | what pages the fare engine latency SLO? | 10 | 1 | 1 | atlas/slos/fare-engine-latency-p99 (2) | – |
| A99 | dev | nl-task | en | until when is Kubernetes 1.31 supported? | 10 | 1 | 1 | atlas/dependencies/kubernetes-eks (2) | – |


## Hybrid run

Fusion alpha 0.4 (dense weight) · normalization tmm · units concepts · split all

### alpinaria

Embedder `openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:32000` · remote true · dimension 512 · degraded false · cache rows 228  
Documents: 228 units, 0 embedded, 228 reused, 0 requests, 0 prompt tokens, 0 ms  
Queries: 203 encoded in 203 requests, 1540 prompt tokens · encoding p50 143.1 ms, p95 166.6 ms · search p50 1.49 ms, p95 2.48 ms (excluding encoding)

| category | n | lexical Recall@5 | hybrid Recall@5 | delta | lexical 95% CI half-width | regressed |
|---|---|---|---|---|---|---|
| accent | 11 | 84.8% | 89.4% | +4.5 | 0.129 | no |
| disambig | 12 | 65.3% | 88.9% | +23.6 | 0.139 | no |
| exact | 18 | 88.5% | 88.3% | -0.2 | 0.098 | no |
| freshness | 11 | 72.0% | 97.7% | +25.8 | 0.182 | no |
| keyword | 22 | 86.0% | 85.8% | -0.2 | 0.089 | no |
| mixed-lang | 14 | 73.8% | 88.1% | +14.3 | 0.143 | no |
| morph | 16 | 69.3% | 77.6% | +8.3 | 0.141 | no |
| nl-task | 52 | 74.4% | 86.8% | +12.3 | 0.086 | no |
| playbook | 9 | 60.2% | 71.3% | +11.1 | 0.194 | no |
| synonym | 16 | 55.7% | 55.7% | +0.0 | 0.148 | no |

### atlas

Embedder `openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:32000` · remote true · dimension 512 · degraded false · cache rows 167  
Documents: 167 units, 0 embedded, 167 reused, 0 requests, 0 prompt tokens, 0 ms  
Queries: 99 encoded in 99 requests, 803 prompt tokens · encoding p50 144.1 ms, p95 170.0 ms · search p50 9.49 ms, p95 17.38 ms (excluding encoding)

| category | n | lexical Recall@5 | hybrid Recall@5 | delta | lexical 95% CI half-width | regressed |
|---|---|---|---|---|---|---|
| accent | 4 | 83.3% | 83.3% | +0.0 | 0.250 | no |
| disambig | 6 | 94.4% | 100.0% | +5.6 | 0.083 | no |
| exact | 8 | 100.0% | 91.7% | -8.3 | 0.000 | yes |
| freshness | 3 | 63.9% | 72.2% | +8.3 | 0.375 | no |
| keyword | 9 | 95.6% | 93.3% | -2.2 | 0.067 | no |
| mixed-lang | 4 | 79.2% | 79.2% | +0.0 | 0.208 | no |
| morph | 6 | 61.1% | 75.0% | +13.9 | 0.167 | no |
| nl-task | 39 | 75.0% | 87.8% | +12.8 | 0.104 | no |
| standards | 4 | 37.5% | 66.7% | +29.2 | 0.208 | no |
| synonym | 6 | 41.7% | 52.8% | +11.1 | 0.236 | no |


## Measurement record (WP3c)

text-embedding-3-small at 512 dimensions, concept units, fusion alpha 0.4 with theoretical-minimum normalization (tmm), chosen on the dev split only. Lexical numbers are the shipped 0.10 search re-run in the same process; they equal the committed lexical-0.10 report (Recall@5 alpinaria 0.742, atlas 0.760).

| fixture | split | lexical-0.10 Recall@5 (95% CI) | hybrid Recall@5 (95% CI) | lexical nDCG@10 | hybrid nDCG@10 |
|---|---|---|---|---|---|
| alpinaria | full (181) | 0.742 [0.697, 0.784] | 0.836 [0.799, 0.870] | 0.814 | 0.872 |
| alpinaria | dev (129) | 0.743 [0.691, 0.791] | 0.822 [0.777, 0.866] | 0.812 | 0.865 |
| alpinaria | heldout (52) | 0.742 [0.664, 0.829] | 0.868 [0.812, 0.923] | 0.819 | 0.887 |
| atlas | full (89) | 0.760 [0.693, 0.823] | 0.843 [0.783, 0.899] | 0.790 | 0.854 |
| atlas | dev (62) | 0.749 [0.673, 0.828] | 0.844 [0.776, 0.908] | 0.784 | 0.851 |
| atlas | heldout (27) | 0.785 [0.673, 0.887] | 0.840 [0.745, 0.927] | 0.803 | 0.863 |

Pre-registered WP3c acceptance: alpinaria synonym Recall@5 >= 0.70: not met (0.557, unchanged from lexical; dev 0.542, heldout 0.604). Alpinaria mixed-language >= 0.85: met (0.738 -> 0.881; dev 0.917, heldout 0.792 on 4 queries). No category regresses by more than its bootstrap CI: not met in one case under the strict reading (atlas exact, 8 queries, 1.000 -> 0.917 against a zero-width lexical CI); every other category holds or improves. Atlas improves (0.760 -> 0.843). Hybrid p95 at 20k vectors excluding query encoding: 35.3 ms at 5,000 concepts x 4 units (met); 199 ms at 20,000 concepts x 1 unit, where lexical search alone takes 124 ms (not met). Zero-result rate stays 0 on answerable queries; lowConfidence keeps its lexical meaning, so its precision and recall are unchanged (alpinaria 64.7% / 50.0%, atlas 63.6% / 70.0%). Query encoding p50/p95: 143/167 ms (alpinaria), 144/170 ms (atlas), reported apart from search latency.

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
| 0.1 | 0.790 | 0.802 | 0.796 | 0.838 | 0.51 / 0.92 / 0.69 / 0.78 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.2 | 0.782 | 0.807 | 0.795 | 0.836 | 0.51 / 0.92 / 0.66 / 0.78 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.3 | 0.773 | 0.802 | 0.788 | 0.840 | 0.51 / 0.92 / 0.64 / 0.78 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.4 | 0.779 | 0.791 | 0.785 | 0.843 | 0.57 / 0.92 / 0.64 / 0.73 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.5 | 0.789 | 0.791 | 0.790 | 0.844 | 0.63 / 0.92 / 0.62 / 0.70 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.6 | 0.783 | 0.791 | 0.787 | 0.837 | 0.63 / 0.92 / 0.56 / 0.62 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.7 | 0.780 | 0.791 | 0.785 | 0.819 | 0.63 / 0.92 / 0.54 / 0.62 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.8 | 0.775 | 0.780 | 0.778 | 0.808 | 0.65 / 0.92 / 0.49 / 0.57 | 0.54 / 0.89 / 0.48 / 0.81 |
| 0.9 | 0.744 | 0.759 | 0.751 | 0.776 | 0.60 / 0.92 / 0.38 / 0.54 | 0.60 / 0.89 / 0.44 / 0.72 |
| 1 | 0.733 | 0.745 | 0.739 | 0.744 | 0.60 / 0.92 / 0.37 / 0.54 | 0.60 / 0.89 / 0.36 / 0.67 |

Normalization `lexical-tmm`:

| alpha | alpinaria dev | atlas dev | mean | mean nDCG@10 | alpinaria synonym / mixed-lang / keyword / exact | atlas synonym / mixed-lang / keyword / exact |
|---|---|---|---|---|---|---|
| 0 | 0.743 | 0.749 | 0.746 | 0.798 | 0.56 / 0.82 / 0.86 / 0.90 | 0.46 / 0.89 / 1.00 / 1.00 |
| 0.1 | 0.819 | 0.834 | 0.826 | 0.858 | 0.54 / 0.92 / 0.86 / 0.88 | 0.54 / 0.89 / 0.97 / 0.89 |
| 0.2 | 0.810 | 0.842 | 0.826 | 0.854 | 0.54 / 0.92 / 0.78 / 0.88 | 0.54 / 0.89 / 0.91 / 0.89 |
| 0.3 | 0.799 | 0.835 | 0.817 | 0.857 | 0.54 / 0.92 / 0.77 / 0.85 | 0.54 / 0.89 / 0.80 / 0.89 |
| 0.4 | 0.801 | 0.825 | 0.813 | 0.859 | 0.60 / 0.92 / 0.73 / 0.80 | 0.54 / 0.89 / 0.80 / 0.89 |
| 0.5 | 0.812 | 0.819 | 0.816 | 0.858 | 0.65 / 0.92 / 0.71 / 0.74 | 0.54 / 0.89 / 0.74 / 0.89 |
| 0.6 | 0.792 | 0.803 | 0.797 | 0.847 | 0.65 / 0.92 / 0.58 / 0.66 | 0.54 / 0.89 / 0.66 / 0.81 |
| 0.7 | 0.784 | 0.791 | 0.787 | 0.824 | 0.65 / 0.92 / 0.52 / 0.66 | 0.54 / 0.89 / 0.54 / 0.81 |
| 0.8 | 0.782 | 0.775 | 0.778 | 0.810 | 0.68 / 0.92 / 0.49 / 0.61 | 0.54 / 0.89 / 0.48 / 0.81 |
| 0.9 | 0.747 | 0.759 | 0.753 | 0.776 | 0.60 / 0.92 / 0.38 / 0.58 | 0.60 / 0.89 / 0.44 / 0.72 |
| 1 | 0.733 | 0.745 | 0.739 | 0.744 | 0.60 / 0.92 / 0.37 / 0.54 | 0.60 / 0.89 / 0.36 / 0.67 |

Normalization `tmm`:

| alpha | alpinaria dev | atlas dev | mean | mean nDCG@10 | alpinaria synonym / mixed-lang / keyword / exact | atlas synonym / mixed-lang / keyword / exact |
|---|---|---|---|---|---|---|
| 0 | 0.743 | 0.749 | 0.746 | 0.798 | 0.56 / 0.82 / 0.86 / 0.90 | 0.46 / 0.89 / 1.00 / 1.00 |
| 0.1 | 0.819 | 0.835 | 0.827 | 0.856 | 0.54 / 0.92 / 0.83 / 0.94 | 0.54 / 0.89 / 1.00 / 1.00 |
| 0.2 | 0.819 | 0.835 | 0.827 | 0.857 | 0.54 / 0.92 / 0.83 / 0.94 | 0.54 / 0.89 / 1.00 / 1.00 |
| 0.3 | 0.819 | 0.834 | 0.827 | 0.858 | 0.54 / 0.92 / 0.83 / 0.94 | 0.54 / 0.89 / 0.97 / 0.94 |
| 0.4 | 0.822 | 0.844 | 0.833 | 0.858 | 0.54 / 0.92 / 0.83 / 0.92 | 0.54 / 0.89 / 0.97 / 0.89 |
| 0.5 | 0.815 | 0.842 | 0.829 | 0.858 | 0.54 / 0.92 / 0.81 / 0.90 | 0.54 / 0.89 / 0.91 / 0.89 |
| 0.6 | 0.799 | 0.846 | 0.823 | 0.852 | 0.54 / 0.92 / 0.76 / 0.79 | 0.54 / 0.89 / 0.91 / 0.89 |
| 0.7 | 0.798 | 0.841 | 0.819 | 0.854 | 0.54 / 0.92 / 0.75 / 0.79 | 0.54 / 0.89 / 0.86 / 0.89 |
| 0.8 | 0.791 | 0.830 | 0.811 | 0.856 | 0.54 / 0.92 / 0.71 / 0.74 | 0.54 / 0.89 / 0.80 / 0.89 |
| 0.9 | 0.820 | 0.806 | 0.813 | 0.853 | 0.68 / 0.92 / 0.73 / 0.69 | 0.54 / 0.89 / 0.66 / 0.89 |
| 1 | 0.733 | 0.745 | 0.739 | 0.744 | 0.60 / 0.92 / 0.37 / 0.54 | 0.60 / 0.89 / 0.36 / 0.67 |

### 1,536 dimensions on dev (alpha 0.4, tmm)

| fixture | Recall@5 (95% CI) | nDCG@10 | synonym | mixed-lang | document tokens | query tokens |
|---|---|---|---|---|---|---|
| alpinaria | 0.817 [0.773, 0.861] | 0.869 | 0.542 | 0.917 | 42765 | 1135 |
| atlas | 0.849 [0.782, 0.916] | 0.851 | 0.542 | 1.000 | 39641 | 581 |

### Hybrid latency at scale (synthetic vectors, query encoding excluded)

`node --expose-gc scripts/index-benchmark.js --sizes <n> --rounds <r> --search-module scripts/hybrid-bench-module.js --search-options '{"dimension":512,"unitsPerConcept":<k>,"alpha":0.4}'`

| run | concepts | vectors | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| hybrid, 4 units per concept | 5000 | 20000 | 24.84 | 35.31 | 40.4 |
| hybrid, 1 unit per concept | 20000 | 20000 | 103.67 | 199.26 | 333.75 |
| lexical only | 5000 | – | 11.97 | 21.1 | 24.61 |
| lexical only | 20000 | – | 74.67 | 123.54 | 169.03 |

### Notes

- Deviation from the pre-registration, made on dev data only: the rule fixed the alpha grid under the then-default min-max normalization. The first sweep exposed a min-max artifact (the weakest hit of a small all-term lexical set normalises to 0, like a miss), so two more normalizations were swept on the same dev queries and the same rule was applied across all three grids. Held-out and full numbers were computed once, after the choice.
- Synonym queries do not improve: dense-only ranking (alpha 1) reaches 0.60 on alpinaria dev synonyms, so the gap is in the concept-level units (title, description and whole body in one vector) as much as in the fusion. Section units (WP3a) are the next measurement; 1,536 dimensions do not help (dev synonym 0.542).
- The search latencies in the per-fixture tables come from the evaluation process on a shared machine; the scale benchmark below is the reference for the 60 ms budget.
- Total prompt tokens for every live run behind this report: 174,019 (about 0.0035 USD at 0.02 USD per million).

