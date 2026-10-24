# Retrieval evaluation — src/search.js

Generated 2026-10-24T17:25:49.712Z · Node v24.17.0 (linux x64, gc exposed: false) · search module `src/search.js` · limit 10 · split all · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-search.js`. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest.{json,md}`; a committed baseline is produced only with an explicit `--out test/fixtures/retrieval/reports/baseline-{date}`.

## Summary

| fixture | queries | Recall@5 (95% CI) | nDCG@10 (95% CI) | MRR@10 | P@1 | zero-result | no-answer returned any | lowConfidence P / R | p95 ms | RSS MB |
|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | 203 | 0.748 [0.703, 0.788] | 0.817 [0.782, 0.848] | 0.940 | 0.917 | 0.0% | 95.5% | 64.7% / 50.0% | 3.93 | 159.8 |
| atlas | 99 | 0.760 [0.693, 0.823] | 0.789 [0.727, 0.846] | 0.871 | 0.831 | 0.0% | 100.0% | 63.6% / 70.0% | 4.30 | 170 |

## Fixture alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · bundles alpinaria (209), playbook (21) · 228 concepts · valid for project: true · as-of 2026-10-24 · split all  
Queries: 203 (181 answerable, 22 no-answer, 52 with sectionAnchor)

### Overall (answerable queries, 95% bootstrap CI)

| metric | value | 95% CI |
|---|---|---|
| Recall@5 | 0.748 | [0.703, 0.788] |
| MustRecall@5 | 0.882 | [0.837, 0.923] |
| nDCG@10 | 0.817 | [0.782, 0.848] |
| MRR@10 | 0.940 | [0.907, 0.968] |
| P@1 | 0.917 | [0.873, 0.956] |
| hit@10 | 0.972 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 11/34 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 11 | 87.9% | 100.0% | 0.891 | 0.932 | 90.9% | 100.0% | 0.0% | – |
| disambig | 12 | 65.3% | 83.3% | 0.767 | 1.000 | 100.0% | 100.0% | 0.0% | 2/12 |
| exact | 18 | 88.5% | 88.9% | 0.913 | 0.963 | 94.4% | 100.0% | 0.0% | 0/1 |
| freshness | 11 | 78.8% | 90.9% | 0.786 | 1.000 | 100.0% | 100.0% | 0.0% | 7/11 |
| keyword | 22 | 86.0% | 90.9% | 0.893 | 1.000 | 100.0% | 100.0% | 0.0% | 0/2 |
| mixed-lang | 14 | 73.8% | 96.4% | 0.835 | 1.000 | 100.0% | 100.0% | 0.0% | 1/2 |
| morph | 16 | 69.3% | 88.5% | 0.803 | 0.906 | 87.5% | 93.8% | 0.0% | 0/1 |
| nl-task | 52 | 74.4% | 89.4% | 0.826 | 0.942 | 92.3% | 96.2% | 0.0% | 1/5 |
| playbook | 9 | 60.2% | 88.9% | 0.724 | 0.847 | 77.8% | 100.0% | 0.0% | – |
| synonym | 16 | 55.7% | 65.6% | 0.638 | 0.781 | 68.8% | 87.5% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 85 | 73.0% | 87.1% | 0.797 | 0.917 | 88.2% | 96.5% | 0.0% | 7/20 |
| it | 80 | 77.6% | 87.7% | 0.840 | 0.959 | 95.0% | 97.5% | 0.0% | 3/12 |
| mixed | 16 | 70.8% | 96.9% | 0.808 | 0.969 | 93.8% | 100.0% | 0.0% | 1/2 |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 129 | 74.8% | 88.4% | 0.816 | 0.949 | 93.0% | 97.7% | 0.0% | 9/26 |
| heldout | 52 | 74.9% | 87.8% | 0.820 | 0.920 | 88.5% | 96.2% | 0.0% | 2/8 |

### No-answer queries

Returned at least one result: 21/22 (95.5%); zero results: 4.5%.  
lowConfidence (mode === "any" && top1.coverage < 0.5): flagged 11/22 no-answer (recall 50.0%), 6 answerable (4 with a relevant top-1); precision 64.7%.

| id | split | query | returned | mode | top-1 coverage | flagged |
|---|---|---|---|---|---|---|
| Q55 | dev | black friday discount strategy | 1 | any | 0.25 | yes |
| Q56 | dev | orari di apertura del negozio di Bolzano | 1 | any | 0.25 | yes |
| Q57 | dev | returns policy for EU customers | 10 | any | 0.75 | no |
| Q58 | dev | scarponi da sci alpino | 10 | any | 0.33 | yes |
| Q59 | heldout | men's winter hiking boots landing page | 1 | all | 1.00 | no |
| Q60 | dev | decisione sul cambio hosting | 10 | any | 0.33 | yes |
| Q61 | dev | experiment on free shipping threshold | 10 | any | 0.25 | yes |
| Q62 | heldout | scarpe per bambini | 10 | any | 0.50 | no |
| Q156 | heldout | shipping costs to Germany | 5 | any | 0.33 | yes |
| Q157 | heldout | taglie dei guanti | 10 | any | 0.50 | no |
| Q158 | dev | Google Ads budget for brand campaigns | 10 | any | 0.20 | yes |
| Q159 | dev | recensioni negative sul servizio clienti | 10 | any | 0.25 | yes |
| Q160 | heldout | newsletter signup conversion rate | 8 | any | 0.50 | no |
| Q161 | heldout | garanzia di due anni sugli scarponi | 10 | any | 0.50 | no |
| Q162 | dev | competitor Decathlon | 10 | any | 0.50 | no |
| Q163 | dev | pagina categoria zaini | 1 | all | 1.00 | no |
| Q164 | dev | TikTok content strategy | 10 | any | 0.33 | yes |
| Q165 | dev | giacca in piumino | 10 | any | 0.50 | no |
| Q166 | dev | robots.txt rule for the staging subdomain | 10 | any | 0.60 | no |
| Q167 | dev | collaborazione con influencer | 0 | any | – | n/a |
| Q168 | dev | GA4 event tracking setup | 2 | any | 0.25 | yes |
| Q169 | dev | numero di negozi fisici | 10 | any | 0.33 | yes |

### Latency, build and memory

| metric | value |
|---|---|
| query latency p50 | 2.22 ms |
| query latency p95 | 3.93 ms |
| query latency mean / max | 2.45 / 7.46 ms |
| OKF index build | 86.3 ms |
| search index prepare | 79.2 ms |
| warm-up pass | 626.7 ms |
| RSS before build / after build / end | 59.5 / 122.2 / 159.8 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| Q01 | dev | nl-task | en | which landing page targets winter hiking boots for women? | 3 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q02 | dev | nl-task | it | cosa abbiamo deciso sulle pagine categoria duplicate? | 1 | 1 | 1 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q03 | dev | nl-task | en | what is the current status of core web vitals on mobile? | 2 | 2 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (0) | yes |
| Q04 | dev | nl-task | it | quali claim sull'impermeabilità possiamo usare nelle descrizioni prodotto? | 10 | 1 | 1 | alpinaria/policies/claim-impermeabile (2) | – |
| Q05 | dev | nl-task | en | experiment Made in Italy English titles result | 1 | 1 | 1 | alpinaria/experiments/en-title-italian-made (2) | – |
| Q06 | heldout | nl-task | it | chi è il competitor più forte sugli scarponi da trekking? | 3 | 1 | miss,1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q07 | dev | nl-task | en | English pages missing hreflang return tags | 1 | 1 | 1,miss | alpinaria/seo-findings/hreflang-missing-en-pages (2) | – |
| Q08 | dev | nl-task | it | perché è calato il traffico sulle pagine dei pile? | 4 | 1 | 1 | alpinaria/seo-findings/calo-traffico-pile-autunno-2026 (2) | – |
| Q09 | dev | nl-task | en | how many words of unique copy does a product page need | 10 | 1 | 1 | alpinaria/decisions/product-page-copy-minimum-120-words (2) | – |
| Q10 | dev | nl-task | it | a che pubblico ci rivolgiamo con la linea Torrente? | 10 | 1 | miss,1 | alpinaria/product-lines/torrente (2) | – |
| Q11 | dev | keyword | it | scarponi trekking donna | 10 | 1 | 3,1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | no |
| Q12 | dev | keyword | en | approach shoes | 10 | 1 | 3,1 | alpinaria/landing-pages/en-approach-shoes (2) | – |
| Q13 | dev | keyword | it | calze merino | 9 | 1 | 4,1 | alpinaria/landing-pages/it-calze-merino (2) | – |
| Q14 | heldout | keyword | en | hreflang | 10 | 1 | 3,2,4 | playbook/guidelines/hreflang-checklist (1) | – |
| Q15 | heldout | keyword | it | cannibalizzazione | 4 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q16 | dev | keyword | en | sitemap | 6 | 1 | 1,3 | alpinaria/seo-findings/sitemap-stale-urls (2) | – |
| Q17 | heldout | keyword | it | giacca guscio | 10 | 1 | 1,4 | alpinaria/seo-findings/query-mismatch-giacca-guscio (2) | – |
| Q18 | dev | keyword | en | trail running | 10 | 1 | 7,4 | alpinaria/landing-pages/it-scarpe-trail-running (1) | – |
| Q19 | dev | mixed-lang | mixed | landing page scarponi donna | 6 | 1 | 2 | alpinaria/landing-pages/it-scarponi-da-trekking-donna-old (1) | yes |
| Q20 | dev | mixed-lang | mixed | keyword cluster giacche impermeabili intent | 1 | 1 | 1 | alpinaria/keyword-clusters/giacca-impermeabile-montagna (2) | – |
| Q21 | dev | mixed-lang | mixed | finding pile traffico | 2 | 1 | 1 | alpinaria/seo-findings/calo-traffico-pile-autunno-2026 (2) | – |
| Q22 | dev | mixed-lang | mixed | policy claim riciclato | 4 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q23 | heldout | mixed-lang | mixed | brief guida scarponi invernali women | 10 | 1 | 1 | alpinaria/content-briefs/guida-scarponi-invernali-donna (2) | – |
| Q24 | heldout | exact | en | TRK-W-042 | 3 | 1 | 1 | alpinaria/products/trk-w-042-dolomiti-aquastop-w (2) | – |
| Q25 | dev | exact | en | /en/womens-winter-hiking-boots/ | 6 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q26 | heldout | exact | en | AquaStop | 10 | 3 | miss | alpinaria/products/trk-m-042-dolomiti-aquastop-m (0) | – |
| Q27 | dev | exact | it | Montevia | 5 | 1 | 1 | alpinaria/competitors/montevia (2) | – |
| Q28 | dev | exact | it | /scarponi-da-trekking/donna/ | 10 | 1 | 1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q29 | dev | exact | en | JKT-U-310 | 2 | 1 | 1 | alpinaria/products/jkt-u-310-vetta-guscio-u (2) | – |
| Q30 | dev | exact | en | x-default | 3 | 1 | 2,1 | alpinaria/experiments/hreflang-x-default-en (2) | – |
| Q31 | dev | morph | it | scarpone trekking donna | 10 | 1 | 3,1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q32 | dev | morph | en | canonicalize filtered category pages | 10 | miss | miss,miss | playbook/guidelines/pagination (0) | – |
| Q33 | dev | morph | it | impermeabilizzazione scarponi | 5 | 1 | 1,2 | alpinaria/seo-findings/featured-snippet-impermeabilizzare (2) | – |
| Q34 | heldout | morph | en | redirects outlet | 3 | 1 | 1,2 | alpinaria/technical-issues/redirect-chains-outlet (2) | – |
| Q35 | dev | morph | it | pagina categoria duplicata | 2 | 1 | 1,2 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | – |
| Q36 | heldout | morph | en | missing alt texts images | 2 | 2 | miss,2 | playbook/guidelines/image-alt-text (0) | – |
| Q37 | dev | accent | it | impermeabilita scarponi | 10 | 1 | 1,2 | alpinaria/policies/claim-impermeabile (2) | – |
| Q38 | dev | accent | it | sostenibilita claim | 1 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q39 | heldout | accent | it | traspirabilità membrana | 10 | 1 | 1 | alpinaria/keyword-clusters/membrana-impermeabile-info (2) | – |
| Q40 | heldout | accent | it | novita inverno 2026 | 1 | 1 | 1 | alpinaria/content-briefs/calendario-contenuti-inverno-2026 (2) | – |
| Q41 | dev | synonym | en | rain jacket for hiking | 10 | 1 | 1,miss | alpinaria/keyword-clusters/hardshell-jacket (2) | – |
| Q42 | dev | synonym | it | scarpe da neve donna | 10 | miss | miss,miss | alpinaria/products/win-w-305-nevaio-neve-w (0) | – |
| Q43 | dev | synonym | en | page speed problems on phones | 10 | miss | miss | alpinaria/decisions/product-page-copy-minimum-120-words (0) | – |
| Q44 | dev | synonym | it | regole sulle promozioni e prezzi barrati | 1 | 1 | 1 | alpinaria/policies/price-promo-claims (2) | – |
| Q45 | dev | synonym | en | thin product descriptions | 10 | 1 | 1 | alpinaria/seo-findings/thin-content-product-pages-torrente (2) | – |
| Q46 | dev | synonym | it | pubblico target famiglie | 10 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q47 | dev | freshness | en | core web vitals mobile LCP | 4 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q48 | heldout | freshness | en | backlink profile review | 3 | 1 | 2 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (1) | yes |
| Q49 | dev | freshness | it | filtri colore noindex o canonical | 2 | 1 | 1 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q50 | dev | freshness | en | women's winter hiking boots landing page | 5 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q51 | dev | disambig | it | come scegliere scarponi da trekking | 2 | 1 | 2,1 | alpinaria/landing-pages/it-guida-scelta-scarponi (2) | no |
| Q52 | heldout | disambig | en | how to choose winter hiking boots | 2 | 1 | 2,1 | alpinaria/content-briefs/en-how-to-choose-winter-hiking-boots (2) | no |
| Q53 | dev | disambig | en | buy women's winter hiking boots | 2 | 1 | 1 | alpinaria/keyword-clusters/womens-winter-hiking-boots-transactional (2) | no |
| Q54 | dev | disambig | it | pagina inglese scarpe da avvicinamento | 2 | 1 | miss | alpinaria/landing-pages/it-scarpe-da-avvicinamento (1) | yes |
| Q63 | dev | playbook | en | INP LCP thresholds | 1 | 1 | 1 | playbook/guidelines/core-web-vitals-thresholds (2) | – |
| Q64 | heldout | playbook | en | how long should a title tag be | 10 | 1 | 1 | playbook/guidelines/title-tag-length (2) | – |
| Q65 | heldout | playbook | mixed | checklist hreflang | 1 | 1 | 1 | playbook/guidelines/hreflang-checklist (2) | – |
| Q66 | dev | nl-task | en | why do Italian URLs show up for German users searching in English? | 10 | 2 | 2 | alpinaria/seo-findings/sitemap-stale-urls (0) | – |
| Q67 | dev | nl-task | it | quanto deve essere lungo il testo unico di una scheda prodotto? | 10 | 1 | miss,1 | alpinaria/content-briefs/torrente-product-copy-refresh (2) | – |
| Q68 | dev | nl-task | en | which pages are five clicks away from the home page? | 10 | 1 | 1,2 | alpinaria/seo-findings/mobile-menu-crawl-depth (2) | – |
| Q69 | dev | nl-task | it | quali linee possono usare il claim Made in Italy? | 10 | 1 | 1 | alpinaria/policies/made-in-italy-claim (2) | no |
| Q70 | heldout | nl-task | en | what did the lazy loading experiment on the hero image show? | 10 | 1 | 1 | alpinaria/experiments/lazy-load-hero-image (2) | – |
| Q71 | dev | nl-task | it | come dobbiamo scrivere gli alt delle immagini prodotto? | 10 | 1 | 7 | alpinaria/seo-findings/immagini-senza-alt (1) | – |
| Q72 | dev | nl-task | en | is the x-default supposed to point to the English or the Italian page? | 10 | 1 | 2,1 | alpinaria/experiments/hreflang-x-default-en (2) | – |
| Q73 | dev | nl-task | it | qual è il tasso di conversione migliore del sito? | 1 | 1 | 1 | alpinaria/landing-pages/it-calze-merino (2) | – |
| Q74 | dev | nl-task | en | when is the packing guide refresh due? | 1 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q75 | heldout | nl-task | it | quante immagini prodotto sono senza alt text? | 10 | 1 | 1 | alpinaria/seo-findings/immagini-senza-alt (2) | – |
| Q76 | dev | nl-task | en | what should we do about the 300 dead URLs in the sitemap? | 1 | 1 | 1,miss | alpinaria/seo-findings/sitemap-stale-urls (2) | – |
| Q77 | dev | nl-task | it | perché abbiamo interrotto il test delle emoji nelle meta description? | 10 | 1 | 1 | alpinaria/experiments/meta-description-emoji (2) | – |
| Q78 | heldout | nl-task | en | which competitor sponsors the Lavaredo Ultra Trail? | 10 | 1 | 1 | alpinaria/competitors/trailforge (2) | – |
| Q79 | dev | nl-task | it | dove devono stare le guide informative nella struttura URL? | 10 | 1 | 1 | alpinaria/decisions/blog-guides-under-guide-folder (2) | – |
| Q80 | heldout | nl-task | en | what is the outreach plan for the next backlink wave? | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q81 | heldout | nl-task | it | che numero consigliamo con le calze spesse? | 6 | 1 | 1 | alpinaria/content-briefs/guida-taglie-scarponi (2) | – |
| Q82 | dev | keyword | it | doposci | 4 | 1 | 1,3 | alpinaria/keyword-clusters/scarponcini-invernali-donna (2) | – |
| Q83 | dev | keyword | en | crawl budget | 2 | 1 | 1 | alpinaria/seo-findings/faceted-navigation-index-bloat (2) | – |
| Q84 | dev | keyword | it | risuolabile | 1 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q85 | heldout | keyword | en | disavow | 2 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q86 | dev | keyword | en | featured snippet | 5 | 1 | 1,2 | alpinaria/seo-findings/featured-snippet-impermeabilizzare (2) | – |
| Q87 | dev | keyword | it | tasselli | 10 | 1 | miss | alpinaria/decisions/trail-running-line-priority-2027 (1) | – |
| Q88 | heldout | keyword | en | GRS certified | 1 | 1 | 1,miss | alpinaria/product-lines/bosco (2) | – |
| Q89 | dev | keyword | it | settimana bianca | 1 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q90 | heldout | keyword | en | aggregateRating | 2 | 1 | 1 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q91 | dev | keyword | en | share of voice | 3 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q92 | dev | keyword | en | Montebelluna | 10 | 1 | 1,4 | alpinaria/content-briefs/en-italian-hiking-boots-brands-history (2) | – |
| Q93 | dev | keyword | en | Alta Via 1 | 2 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q94 | heldout | keyword | it | redirect 301 | 5 | 1 | 1 | alpinaria/decisions/redirect-vecchia-pagina-donna (2) | – |
| Q95 | dev | mixed-lang | mixed | decision canonical filtri colore | 3 | 1 | 1,miss | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q96 | heldout | mixed-lang | mixed | technical issue alt text PIM | 1 | 1 | 1 | alpinaria/technical-issues/alt-text-mancanti (2) | – |
| Q97 | dev | mixed-lang | mixed | audience trail runner mobile | 1 | 1 | 1 | alpinaria/audiences/trail-runner (2) | – |
| Q98 | dev | mixed-lang | mixed | competitor scarpe da avvicinamento | 1 | 1 | 1 | alpinaria/competitors/rocciaviva (2) | – |
| Q99 | heldout | mixed-lang | mixed | experiment title prezzo da 149 | 1 | 1 | 1 | alpinaria/experiments/title-tag-prezzo-scarponi-donna (2) | – |
| Q100 | heldout | mixed-lang | mixed | brief merino socks vesciche | 10 | 1 | 1 | alpinaria/content-briefs/en-merino-socks-benefits (2) | – |
| Q101 | dev | mixed-lang | mixed | finding crawl depth pagine inglesi | 10 | 1 | 1,5 | alpinaria/seo-findings/mobile-menu-crawl-depth (2) | – |
| Q102 | dev | mixed-lang | mixed | policy claim medici | 4 | 1 | 1 | alpinaria/policies/medical-health-claims (2) | – |
| Q103 | heldout | exact | en | WIN-W-309 | 6 | 1 | 1 | alpinaria/products/win-w-309-nevaio-polar-w (2) | – |
| Q104 | dev | exact | it | SCK-U-705 | 4 | 1 | 1 | alpinaria/products/sck-u-705-rifugio-calze-merino-heavy-u (2) | – |
| Q105 | dev | exact | en | /en/approach-shoes/ | 10 | 1 | 1 | alpinaria/landing-pages/en-approach-shoes (2) | – |
| Q106 | dev | exact | it | /abbigliamento/pile/ | 2 | 1 | 1 | alpinaria/landing-pages/it-pile (2) | – |
| Q107 | dev | exact | en | nordpasso.com | 1 | 1 | 1 | alpinaria/competitors/nordpasso (2) | – |
| Q108 | heldout | exact | it | Dolomyths | 1 | 1 | 1 | alpinaria/audiences/trail-runner (2) | – |
| Q109 | dev | exact | en | fetchpriority | 1 | 1 | miss | alpinaria/technical-issues/lcp-immagini-prodotto-mobile (1) | – |
| Q110 | heldout | exact | it | art. 17-bis | 1 | 1 | 1 | alpinaria/policies/price-promo-claims (2) | – |
| Q111 | dev | exact | en | TRL-M-404 | 3 | 1 | 1 | alpinaria/products/trl-m-404-torrente-rapido-pro-m (2) | – |
| Q112 | dev | exact | en | Elisa Dalla Costa | 1 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q113 | heldout | exact | en | /outlet/ | 10 | 1 | 1 | alpinaria/landing-pages/it-outlet (2) | – |
| Q114 | heldout | morph | it | pantaloni zip-off | 2 | 1 | miss,1,2 | alpinaria/products/pnt-m-810-passo-zip-off-m (2) | – |
| Q115 | dev | morph | en | redirected legacy promo urls | 2 | 1 | 2,1 | alpinaria/technical-issues/redirect-chains-outlet (2) | – |
| Q116 | dev | morph | it | guide informative | 10 | 1 | 1 | alpinaria/decisions/blog-guides-under-guide-folder (2) | – |
| Q117 | dev | morph | en | indexing of parameter urls | 4 | 1 | 1 | alpinaria/seo-findings/faceted-navigation-index-bloat (2) | – |
| Q118 | dev | morph | it | scarponcino invernale | 10 | 1 | 2,1 | alpinaria/landing-pages/it-scarponcini-invernali-donna (2) | – |
| Q119 | dev | morph | en | canonicals on english product pages | 1 | 1 | 1 | alpinaria/technical-issues/canonical-self-reference-missing-en (2) | – |
| Q120 | dev | morph | it | link interno perso | 3 | 1 | 2,1 | alpinaria/experiments/internal-links-pile-from-giacche (2) | – |
| Q121 | dev | morph | en | experiments with positive results | 4 | 1 | 2,1,3 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q122 | heldout | morph | it | cannibalizzazioni tra pagine | 3 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q123 | dev | morph | en | hydrating the filter widget | 3 | 1 | 1 | alpinaria/technical-issues/inp-filtri-plp (2) | no |
| Q124 | heldout | accent | it | priorita editoriale 2027 | 3 | 1 | 1 | alpinaria/decisions/trail-running-line-priority-2027 (2) | – |
| Q125 | dev | accent | it | sneaker Baita Citta | 3 | 1 | 2,3 | alpinaria/product-lines/baita (1) | – |
| Q126 | dev | accent | it | stagionalita cluster scarponi donna | 1 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-donna-transazionale (2) | – |
| Q127 | dev | accent | it | profondita di catalogo Montevia | 1 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q128 | dev | accent | it | disponibilità immediata famiglie | 1 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q129 | dev | accent | it | velocita di scroll mobile | 1 | 1 | 1 | alpinaria/experiments/category-intro-copy-length (2) | – |
| Q130 | dev | accent | it | gravita alta problemi tecnici | 10 | 4 | 4 | alpinaria/audiences/alpinisti-esperti (0) | – |
| Q131 | dev | synonym | en | insulated boots for snowshoeing | 1 | 1 | miss,miss | alpinaria/content-briefs/en-how-to-choose-winter-hiking-boots (1) | – |
| Q132 | dev | synonym | it | scarpe basse per camminare | 2 | 1 | 1,2 | alpinaria/keyword-clusters/scarpe-trekking-leggere (2) | – |
| Q133 | heldout | synonym | en | star ratings in search results | 10 | 1 | 1 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q134 | dev | synonym | it | marketplace che rivende i nostri prodotti a prezzo più basso | 10 | 1 | 1 | alpinaria/competitors/quota3000 (2) | – |
| Q135 | dev | synonym | en | slow filters on category pages | 10 | 2 | 2 | playbook/guidelines/pagination (0) | – |
| Q136 | heldout | synonym | it | pulizia delle scarpe in pelle | 10 | 1 | 1,miss | alpinaria/landing-pages/it-guida-cura-scarponi (2) | – |
| Q137 | heldout | synonym | en | German shoppers | 4 | 2 | 2 | alpinaria/competitors/nordpasso (0) | – |
| Q138 | dev | synonym | it | testi troppo corti nelle schede Torrente | 10 | 1 | 9,1 | alpinaria/content-briefs/torrente-product-copy-refresh (2) | – |
| Q139 | dev | synonym | en | mountain hut trek | 10 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q140 | heldout | synonym | it | capi in lana che non puzzano | 8 | 2 | 6 | alpinaria/keyword-clusters/calze-trekking-merino (0) | – |
| Q141 | heldout | freshness | en | referring domains count | 10 | 1 | 2 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (1) | yes |
| Q142 | dev | freshness | it | pagina categoria scarponi donna attuale | 10 | 1 | 2 | alpinaria/landing-pages/it-scarponi-da-trekking-donna-old (1) | yes |
| Q143 | dev | freshness | en | current LCP on mobile product pages | 2 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q144 | dev | freshness | it | filtri taglia robots disallow | 10 | 1 | 3,1 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q145 | dev | freshness | it | noindex sulle URL con parametri | 1 | 1 | miss | alpinaria/decisions/noindex-filtri-colore-2026-03 (1) | yes |
| Q146 | heldout | freshness | en | backlink gap to Cimalta | 1 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q147 | dev | freshness | en | mobile CLS value | 10 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q148 | dev | disambig | en | draft redesign of the women's winter page | 1 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots-draft-v2 (2) | no |
| Q149 | heldout | disambig | it | pagina italiana delle giacche hardshell | 3 | 1 | 1 | alpinaria/landing-pages/it-giacche-impermeabili (2) | no |
| Q150 | dev | disambig | en | approach shoes category in Italian | 4 | 1 | miss | alpinaria/landing-pages/en-approach-shoes (1) | yes |
| Q151 | dev | disambig | it | cluster transazionale scarponi uomo | 3 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-uomo-transazionale (2) | no |
| Q152 | dev | disambig | en | informational cluster about hiking boot sizing | 2 | 1 | 1 | alpinaria/keyword-clusters/boot-sizing-guide-en (2) | no |
| Q153 | dev | disambig | it | cluster taglie scarponi in italiano | 1 | 1 | 1 | alpinaria/keyword-clusters/misura-scarponi-trekking (2) | no |
| Q154 | heldout | disambig | en | Q2 backlink review numbers | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q2 (2) | no |
| Q155 | dev | disambig | en | men's hiking boots English category page | 2 | 1 | 1 | alpinaria/landing-pages/en-mens-hiking-boots (2) | no |
| Q170 | dev | playbook | en | how do we tell transactional from informational clusters? | 10 | 8 | 8 | alpinaria/keyword-clusters/womens-winter-hiking-boots-informational (0) | – |
| Q171 | dev | playbook | mixed | guideline cadenza refresh contenuti | 10 | 2 | 2 | alpinaria/content-briefs/calendario-contenuti-inverno-2026 (0) | – |
| Q172 | dev | playbook | en | minimum experiment duration | 1 | 1 | 1 | playbook/guidelines/experiment-protocol (2) | – |
| Q173 | dev | playbook | en | when to use robots disallow instead of noindex | 10 | 1 | 3 | alpinaria/decisions/faceted-parameters-robots (1) | – |
| Q174 | dev | playbook | it | regole per i link interni dalle guide alle categorie | 10 | 1 | 3 | alpinaria/decisions/blog-guides-under-guide-folder (1) | – |
| Q175 | heldout | playbook | en | E-E-A-T author box on guides | 2 | 1 | 1 | playbook/guidelines/eeat-for-ecommerce (2) | – |
| Q176 | dev | nl-task | en | what are the head terms of the merino hiking socks cluster? | 1 | 1 | 1 | alpinaria/keyword-clusters/merino-hiking-socks (2) | – |
| Q177 | dev | nl-task | it | quali sono le parole chiave principali del cluster pile? | 1 | 1 | 1 | alpinaria/keyword-clusters/pile-montagna (2) | – |
| Q178 | dev | nl-task | en | which page is mapped to the Dolomites packing cluster? | 10 | 1 | 2 | alpinaria/landing-pages/en-dolomites-packing-guide (1) | – |
| Q179 | dev | nl-task | it | a quale pagina è mappato il cluster scarpe trail running? | 10 | 1 | 2 | alpinaria/landing-pages/it-scarpe-trail-running (1) | – |
| Q180 | dev | nl-task | en | what is forbidden under the Made in Italy policy? | 1 | 1 | 1 | alpinaria/policies/made-in-italy-claim (2) | – |
| Q181 | dev | nl-task | it | cosa è vietato dalla policy sull'impermeabilità? | 2 | 1 | 1 | alpinaria/policies/claim-impermeabile (2) | – |
| Q182 | dev | nl-task | en | what comfort statements are allowed instead of medical claims? | 10 | 1 | 1 | alpinaria/policies/medical-health-claims (2) | – |
| Q183 | dev | nl-task | it | qual è la base normativa dei green claims? | 1 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q184 | dev | nl-task | it | in quali pagine si applicano le regole sui prezzi barrati? | 1 | 1 | 1 | alpinaria/policies/price-promo-claims (2) | – |
| Q185 | dev | nl-task | it | quali parole dobbiamo evitare nei testi italiani? | 10 | 1 | 1 | alpinaria/brand-voice/tono-di-voce-it (2) | – |
| Q186 | heldout | nl-task | en | what should English product copy not say? | 1 | miss | miss | alpinaria/policies/made-in-italy-claim (0) | – |
| Q187 | dev | keyword | it | lessico scarponi scarpe scarponcini | 1 | 1 | 1 | alpinaria/brand-voice/tono-di-voce-it (2) | – |
| Q188 | dev | nl-task | en | which SKUs belong to the Nevaio line? | 10 | 1 | 1 | alpinaria/product-lines/nevaio (2) | – |
| Q189 | dev | nl-task | it | quali modelli fanno parte della linea Cresta? | 10 | 1 | 1 | alpinaria/product-lines/cresta (2) | – |
| Q190 | heldout | nl-task | it | che taglie ha la linea Vetta? | 5 | 1 | 1 | alpinaria/product-lines/vetta (2) | – |
| Q191 | heldout | nl-task | en | is the Sentiero line made in Italy? | 7 | 1 | 1 | alpinaria/product-lines/sentiero (2) | – |
| Q192 | dev | nl-task | it | perché la pagina scarponi donna è salita di posizione? | 10 | 1 | 1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | – |
| Q193 | dev | nl-task | en | when do impressions peak for the women's winter page? | 1 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | – |
| Q194 | heldout | nl-task | it | quanti prodotti ha la categoria scarponi uomo? | 10 | 1 | 1 | alpinaria/landing-pages/it-scarponi-da-trekking-uomo (2) | – |
| Q195 | dev | nl-task | en | why does the men's hiking boots title say Made in Italy? | 10 | 1 | 1 | alpinaria/landing-pages/en-mens-hiking-boots (2) | – |
| Q196 | heldout | nl-task | it | quante parole ha la guida alla scelta degli scarponi? | 10 | 1 | 1 | alpinaria/landing-pages/it-guida-scelta-scarponi (2) | – |
| Q197 | heldout | nl-task | en | where does the lightweight hiking shoes page sit in the crawl? | 10 | 1 | 1 | alpinaria/landing-pages/en-lightweight-hiking-shoes (2) | – |
| Q198 | heldout | nl-task | it | quale CTR ha la query di brand? | 1 | 1 | 1 | alpinaria/keyword-clusters/alpinaria-brand (2) | – |
| Q199 | heldout | nl-task | it | URL della scheda prodotto Torrente Rapido W | 1 | miss | miss | alpinaria/products/trl-w-404-torrente-rapido-pro-w (0) | – |
| Q200 | dev | nl-task | en | product URL of Dolomiti AquaStop M | 3 | 1 | 1 | alpinaria/products/trk-m-042-dolomiti-aquastop-m (2) | – |
| Q201 | dev | mixed-lang | mixed | head terms del cluster approach shoes | 1 | 1 | 1 | alpinaria/keyword-clusters/approach-shoes (2) | – |
| Q202 | dev | nl-task | it | quando ha i picchi il cluster outlet scarponi? | 1 | 1 | 1 | alpinaria/keyword-clusters/saldi-scarponi (2) | – |
| Q203 | heldout | nl-task | en | what is the average position of the men's waterproof boots cluster? | 1 | 1 | 1 | alpinaria/keyword-clusters/mens-hiking-boots-waterproof (2) | – |

## Fixture atlas

Project `test/fixtures/retrieval/atlas/okf.project.yaml` · bundles atlas (160), standards (9) · 167 concepts · valid for project: true · as-of 2026-10-24 · split all  
Queries: 99 (89 answerable, 10 no-answer, 58 with sectionAnchor)

### Overall (answerable queries, 95% bootstrap CI)

| metric | value | 95% CI |
|---|---|---|
| Recall@5 | 0.760 | [0.693, 0.823] |
| MustRecall@5 | 0.893 | [0.820, 0.955] |
| nDCG@10 | 0.789 | [0.727, 0.846] |
| MRR@10 | 0.871 | [0.810, 0.931] |
| P@1 | 0.831 | [0.753, 0.899] |
| hit@10 | 0.944 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 1/9 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 4 | 83.3% | 100.0% | 0.910 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| disambig | 6 | 94.4% | 100.0% | 0.935 | 1.000 | 100.0% | 100.0% | 0.0% | 0/6 |
| exact | 8 | 100.0% | 100.0% | 0.992 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| freshness | 3 | 63.9% | 66.7% | 0.614 | 0.833 | 66.7% | 100.0% | 0.0% | 1/3 |
| keyword | 9 | 95.6% | 100.0% | 0.972 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| mixed-lang | 4 | 79.2% | 75.0% | 0.652 | 0.800 | 75.0% | 100.0% | 0.0% | – |
| morph | 6 | 61.1% | 91.7% | 0.769 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| nl-task | 39 | 75.0% | 89.7% | 0.779 | 0.861 | 82.1% | 92.3% | 0.0% | – |
| standards | 4 | 37.5% | 75.0% | 0.567 | 0.486 | 25.0% | 100.0% | 0.0% | – |
| synonym | 6 | 41.7% | 66.7% | 0.426 | 0.556 | 50.0% | 66.7% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 58 | 73.2% | 88.8% | 0.780 | 0.873 | 82.8% | 94.8% | 0.0% | 1/7 |
| it | 27 | 81.5% | 92.6% | 0.829 | 0.880 | 85.2% | 92.6% | 0.0% | 0/2 |
| mixed | 4 | 79.2% | 75.0% | 0.652 | 0.800 | 75.0% | 100.0% | 0.0% | – |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 62 | 74.9% | 91.1% | 0.783 | 0.867 | 82.3% | 95.2% | 0.0% | 1/6 |
| heldout | 27 | 78.5% | 85.2% | 0.801 | 0.883 | 85.2% | 92.6% | 0.0% | 0/3 |

### No-answer queries

Returned at least one result: 10/10 (100.0%); zero results: 0.0%.  
lowConfidence (mode === "any" && top1.coverage < 0.5): flagged 7/10 no-answer (recall 70.0%), 4 answerable (1 with a relevant top-1); precision 63.6%.

| id | split | query | returned | mode | top-1 coverage | flagged |
|---|---|---|---|---|---|---|
| A59 | dev | Jira ticket workflow for feature requests | 10 | any | 0.20 | yes |
| A60 | heldout | contratto di pulizia degli uffici | 6 | any | 0.33 | yes |
| A61 | heldout | Android app release schedule | 10 | any | 0.50 | no |
| A62 | dev | orario delle corse della linea 27 | 10 | any | 0.25 | yes |
| A63 | dev | GraphQL gateway migration | 10 | any | 0.33 | yes |
| A64 | dev | stipendio dei controllori | 6 | any | 0.50 | no |
| A65 | dev | MongoDB cluster sizing | 5 | any | 0.33 | yes |
| A66 | dev | fattura elettronica per le aziende | 2 | any | 0.33 | yes |
| A67 | dev | Terraform module for the VPC | 1 | any | 0.33 | yes |
| A68 | dev | numero verde assistenza clienti | 10 | any | 0.50 | no |

### Latency, build and memory

| metric | value |
|---|---|
| query latency p50 | 3.09 ms |
| query latency p95 | 4.30 ms |
| query latency mean / max | 3.21 / 4.43 ms |
| OKF index build | 41.7 ms |
| search index prepare | 63.1 ms |
| warm-up pass | 371.6 ms |
| RSS before build / after build / end | 160.6 / 169.4 / 170 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| A01 | heldout | nl-task | en | why did validators in Bologna go offline in January? | 1 | 1 | miss,miss | atlas/services/validator-gateway (1) | – |
| A02 | dev | nl-task | it | cosa succede ai biglietti quando il validatore è offline? | 10 | 1 | 3 | atlas/runbooks/validator-offline-queue-drain (1) | – |
| A03 | dev | nl-task | en | how long do we keep raw validations? | 1 | miss | miss,miss | atlas/questions/q-006-postgres-partitioning-validations (0) | – |
| A04 | dev | nl-task | it | chi è il reperibile per i problemi di pagamento? | 10 | 4 | 4 | atlas/runbooks/escalation-reperibilita-2025 (0) | – |
| A05 | dev | nl-task | en | what caused the duplicate subscription renewals? | 1 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A06 | dev | nl-task | it | come si riconciliano gli avvisi pagoPA non pagati? | 7 | 1 | 1 | atlas/runbooks/pagopa-reconciliation (2) | – |
| A07 | dev | nl-task | en | which PSP do we use and is there a fallback? | 1 | miss | miss | atlas/runbooks/rotate-psp-credentials (0) | – |
| A08 | dev | nl-task | en | what is the error budget for the API gateway? | 1 | 1 | 1 | atlas/slos/api-gateway-availability (2) | – |
| A09 | dev | nl-task | it | perché il login SPID non funzionava ad aprile? | 10 | 1 | 1,5 | atlas/incidents/inc-2026-013-spid-login-down (2) | – |
| A10 | dev | nl-task | en | where do we store the EMV token for tap-to-ride? | 1 | 1 | 1 | atlas/decisions/adr-014-emv-contactless-tokenization (2) | – |
| A11 | dev | nl-task | en | what should happen before activating a new fare table? | 10 | 2 | 3 | atlas/services/fare-engine (0) | – |
| A12 | heldout | nl-task | it | quale team possiede il warehouse? | 10 | 1 | 2 | atlas/services/reporting-warehouse (1) | – |
| A13 | dev | keyword | en | fencing token | 2 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A14 | heldout | keyword | en | RAPTOR | 2 | 1 | 1 | atlas/decisions/adr-005-raptor-trip-planner (2) | – |
| A15 | dev | keyword | it | ricevute telematiche | 4 | 1 | 3,1 | atlas/incidents/inc-2026-007-pagopa-timeout (2) | – |
| A16 | dev | keyword | en | outbox | 3 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A17 | dev | keyword | en | kill switch | 5 | 1 | 1 | atlas/runbooks/feature-flag-kill-switch (2) | – |
| A18 | heldout | keyword | it | tablespace Oracle | 2 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | – |
| A19 | dev | keyword | en | advisory lock | 2 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A20 | heldout | keyword | en | TTL | 6 | 1 | 1,2 | atlas/incidents/inc-2026-018-clickhouse-disk-full (2) | – |
| A21 | dev | keyword | en | Temporal | 3 | 1 | 2 | atlas/runbooks/refund-queue-unstick (1) | – |
| A22 | dev | mixed-lang | mixed | runbook riconciliazione wallet | 10 | 5 | 5 | atlas/runbooks/pagopa-reconciliation (0) | – |
| A23 | dev | mixed-lang | mixed | incident timeout nodo pagoPA | 3 | 1 | 1 | atlas/incidents/inc-2026-007-pagopa-timeout (2) | – |
| A24 | heldout | mixed-lang | mixed | SLO freschezza cruscotti operatori | 1 | 1 | miss | atlas/questions/q-007-on-call-compensation (1) | – |
| A25 | dev | mixed-lang | mixed | ADR dismissione SBE | 4 | 1 | 1 | atlas/decisions/adr-017-retire-legacy-sbe (2) | – |
| A26 | dev | exact | en | INC-2026-011 | 2 | 1 | 1 | atlas/incidents/inc-2026-011-kafka-partition-lag (2) | – |
| A27 | dev | exact | en | ADR-012 | 3 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A28 | dev | exact | en | ticketing.validations.v2 | 2 | 1 | 1 | atlas/contracts/ticket-validated-v2 (2) | – |
| A29 | heldout | exact | en | partners.tessera.it | 2 | 1 | 1,2 | atlas/incidents/inc-2026-020-api-gateway-cert-expiry (2) | – |
| A30 | dev | exact | en | kill.notification-hub.marketing | 2 | 1 | 1 | atlas/runbooks/notification-rate-limit (2) | – |
| A31 | dev | exact | it | ORA-01653 | 1 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | – |
| A32 | heldout | exact | en | /v1/planner/plan | 4 | 1 | 1 | atlas/contracts/api-planner-v1 (2) | – |
| A33 | dev | exact | en | eu-south-1 | 2 | 1 | 1 | atlas/dependencies/kubernetes-eks (2) | – |
| A34 | dev | morph | en | rotating credentials | 4 | 1 | 1 | atlas/runbooks/rotate-psp-credentials (2) | – |
| A35 | dev | morph | it | coda offline validatore | 3 | 1 | 1 | atlas/runbooks/validator-offline-queue-drain (2) | – |
| A36 | dev | morph | en | renewing certificates | 2 | 1 | 1 | atlas/runbooks/certificate-renewal (2) | – |
| A37 | dev | morph | en | partitioned ledger tables | 3 | 1 | 1,miss | atlas/services/validation-ledger (2) | – |
| A38 | heldout | morph | it | sanzione duplicata | 3 | 1 | 1 | atlas/incidents/inc-2026-025-inspector-app-sync (2) | – |
| A39 | heldout | morph | en | consumers lagging | 6 | 1 | 1,4 | atlas/incidents/inc-2026-011-kafka-partition-lag (2) | – |
| A40 | dev | accent | it | reperibilita team dati | 1 | 1 | 1 | atlas/questions/q-007-on-call-compensation (2) | – |
| A41 | heldout | accent | it | team mobilita | 10 | 1 | 1 | atlas/teams/team-mobilita (2) | – |
| A42 | dev | accent | it | nuove funzionalita SBE | 2 | 1 | 1,2 | atlas/services/legacy-sbe (2) | – |
| A43 | dev | accent | it | proprietà e runtime di pagopa-adapter | 2 | 1 | 1 | atlas/services/pagopa-adapter (2) | – |
| A44 | dev | synonym | en | double billing of season passes | 10 | 1 | 4 | atlas/services/subscription-manager (1) | – |
| A45 | dev | synonym | it | procedura per spegnere una funzione in emergenza | 10 | miss | miss | atlas/runbooks/fare-table-hotfix (0) | – |
| A46 | heldout | synonym | en | vehicle locations stuck | 10 | 1 | 1 | atlas/incidents/inc-2026-023-avl-feed-stale (2) | – |
| A47 | dev | synonym | en | who to call at night when the warehouse breaks | 10 | 3 | 5 | atlas/services/reporting-warehouse (0) | – |
| A48 | heldout | synonym | it | doppio addebito sul borsellino | 1 | miss | miss | atlas/incidents/inc-2026-025-inspector-app-sync (0) | – |
| A49 | dev | synonym | en | attack on the website | 3 | 1 | 2 | atlas/postmortems/pm-2026-029-storefront-ddos (1) | – |
| A50 | dev | freshness | en | repository structure monorepo or polyrepo | 4 | 1 | 1 | atlas/decisions/adr-015-polyrepo-per-team (2) | no |
| A51 | dev | freshness | en | escalation procedure | 7 | 1 | miss | atlas/runbooks/escalation-reperibilita-2025 (1) | yes |
| A52 | heldout | freshness | en | validation event schema | 4 | 2 | 2 | atlas/decisions/adr-002-kafka-as-event-backbone (0) | no |
| A53 | heldout | disambig | it | incidente storico del legacy SBE | 2 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | no |
| A54 | dev | disambig | en | deprecated validation event v1 | 2 | 1 | 1 | atlas/contracts/ticket-validated-v1 (2) | no |
| A55 | dev | disambig | en | Italian version of the escalation runbook | 10 | 1 | 1 | atlas/runbooks/escalation-reperibilita-2025 (2) | no |
| A56 | heldout | disambig | en | validator gateway latency SLO | 2 | 1 | 1 | atlas/slos/validator-gateway-ingest-latency (2) | no |
| A57 | dev | disambig | it | post-mortem dei validatori in italiano | 10 | 1 | 1 | atlas/postmortems/pm-2026-001-validator-outage (2) | no |
| A58 | dev | disambig | en | team that owns the API gateway | 3 | 1 | 2 | atlas/services/api-gateway (1) | no |
| A69 | dev | standards | en | when must a post-mortem be written? | 10 | 9 | 9 | atlas/postmortems/pm-2026-020-cert-expiry (0) | – |
| A70 | dev | standards | en | burn rate alert thresholds | 10 | 2 | 2 | atlas/runbooks/notification-rate-limit (0) | – |
| A71 | dev | standards | it | convenzione per i nomi dei topic | 10 | 1 | 1 | standards/standards/service-naming (2) | – |
| A72 | heldout | standards | en | how long does a deprecated REST major live | 10 | 3 | 3,4 | atlas/contracts/ticket-validated-v1 (0) | – |
| A73 | dev | nl-task | en | what are the consequences of the outbox decision? | 1 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A74 | dev | nl-task | it | quali sono le conseguenze dell'integrazione diretta con pagoPA? | 1 | 1 | 1 | atlas/decisions/adr-009-pagopa-direct-integration (2) | – |
| A75 | dev | nl-task | en | what went well during the wallet double charge incident? | 1 | 1 | 1 | atlas/postmortems/pm-2026-004-wallet-double-charge (2) | – |
| A76 | dev | nl-task | en | action items from the Kafka lag post-mortem | 1 | 1 | 1 | atlas/postmortems/pm-2026-011-kafka-lag (2) | – |
| A77 | heldout | nl-task | it | qual è la lezione del post-mortem pagoPA? | 1 | 1 | 1 | atlas/postmortems/pm-2026-007-pagopa-timeout (2) | – |
| A78 | dev | nl-task | en | how do I roll back a schema registry change? | 1 | 1 | 1 | atlas/runbooks/schema-registry-rollback (2) | – |
| A79 | dev | nl-task | en | what is the rollback for a fare table hotfix? | 1 | 1 | 1 | atlas/runbooks/fare-table-hotfix (2) | – |
| A80 | dev | nl-task | en | who do I escalate to when the validator queue is older than 48 hours? | 10 | 3 | 3 | atlas/runbooks/scale-validator-gateway (0) | – |
| A81 | dev | nl-task | it | quali sono i prerequisiti per la riconciliazione pagoPA? | 1 | 1 | 1 | atlas/runbooks/pagopa-reconciliation (2) | – |
| A82 | dev | nl-task | en | when should I use the Kafka replay runbook? | 3 | 1 | 1 | atlas/runbooks/replay-kafka-topic (2) | – |
| A83 | heldout | nl-task | en | what fields does the FareComputed event carry? | 10 | 1 | 1 | atlas/contracts/fare-computed-v1 (2) | – |
| A84 | heldout | nl-task | en | what personal data is in AccountCreated? | 1 | 1 | 1 | atlas/contracts/account-created-v1 (2) | – |
| A85 | dev | nl-task | it | per quanto si conservano gli esiti delle verifiche? | 1 | 1 | 1 | atlas/contracts/inspection-result-v1 (2) | – |
| A86 | heldout | nl-task | en | how is the trip planner latency SLO alerted? | 1 | 1 | 1 | atlas/slos/trip-planner-latency (2) | – |
| A87 | dev | nl-task | en | what is the SLI for the login availability SLO? | 1 | 1 | 1 | atlas/slos/identity-service-login-availability (2) | – |
| A88 | dev | nl-task | it | qual è l'obiettivo dello SLO di sincronizzazione dei controllori? | 1 | 1 | 1 | atlas/slos/inspector-backend-sync-latency (2) | – |
| A89 | heldout | nl-task | en | what are the options for the multi-region question? | 1 | 1 | 1 | atlas/questions/q-001-multi-region-active-active (2) | – |
| A90 | heldout | nl-task | it | qual è l'orientamento attuale sulla licenza di moneta elettronica? | 1 | 1 | 1 | atlas/questions/q-002-wallet-emoney-licence (2) | – |
| A91 | heldout | nl-task | en | when does support for Keycloak 25 end? | 1 | 1 | 1 | atlas/dependencies/keycloak (2) | – |
| A92 | heldout | nl-task | en | which services depend on Redis? | 7 | miss | miss | atlas/services/realtime-predictions (0) | – |
| A93 | dev | nl-task | en | what does the notification hub consume? | 2 | 1 | 1 | atlas/services/notification-hub (2) | – |
| A94 | dev | nl-task | it | da cosa dipende il backend dei controllori? | 10 | 2 | 2 | atlas/slos/inspector-backend-sync-latency (0) | – |
| A95 | dev | nl-task | en | who approves a refund batch above 10,000 euro when the queue is unstuck? | 10 | 1 | 1 | atlas/runbooks/refund-queue-unstick (2) | – |
| A96 | heldout | nl-task | it | quali sono i prerequisiti per il failover di PostgreSQL? | 10 | 1 | 1 | atlas/runbooks/postgres-failover (2) | – |
| A97 | heldout | nl-task | en | what must every ClickHouse raw table declare before an upgrade? | 1 | 1 | 1 | atlas/dependencies/clickhouse (2) | – |
| A98 | dev | nl-task | en | what pages the fare engine latency SLO? | 1 | 1 | 1 | atlas/slos/fare-engine-latency-p99 (2) | – |
| A99 | dev | nl-task | en | until when is Kubernetes 1.31 supported? | 1 | 1 | 1 | atlas/dependencies/kubernetes-eks (2) | – |

