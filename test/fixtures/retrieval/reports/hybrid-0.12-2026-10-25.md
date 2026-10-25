# Retrieval evaluation — hybrid 0.12 (text-embedding-3-small, 512 dims, shipped defaults: concept units, tmm, alpha 0.4, minSimilarity 0)

Generated 2026-10-25T02:56:59.714Z · Node v24.17.0 (linux x64, gc exposed: false) · search module `src/search/query.js` with options `{"hybrid":true,"alpha":0.4,"normalization":"tmm","embedUnits":"concepts"}` · limit 10 · split all · bootstrap 1000 samples (seed 20261024)

Produced by `scripts/eval-search.js`. Routine runs write to the git-ignored `test/fixtures/retrieval/reports/latest.{json,md}`; a committed baseline is produced only with an explicit `--out test/fixtures/retrieval/reports/baseline-{date}`.

## Summary

| fixture | queries | Recall@5 (95% CI) | nDCG@10 (95% CI) | MRR@10 | P@1 | zero-result | no-answer returned any | lowConfidence P / R | p95 ms | RSS MB |
|---|---|---|---|---|---|---|---|---|---|---|
| alpinaria | 203 | 0.830 [0.791, 0.864] | 0.856 [0.825, 0.882] | 0.929 | 0.890 | 0.0% | 100.0% | 66.7% / 54.5% | 3.12 | 184.5 |
| atlas | 99 | 0.882 [0.831, 0.929] | 0.855 [0.809, 0.899] | 0.876 | 0.809 | 0.0% | 100.0% | 63.6% / 70.0% | 5.99 | 156.4 |

## Fixture alpinaria

Project `test/fixtures/retrieval/alpinaria/okf.project.yaml` · bundles alpinaria (209), playbook (21) · 228 concepts · valid for project: true · as-of 2026-10-24 · split all  
Queries: 203 (181 answerable, 22 no-answer, 52 with sectionAnchor)

### Overall (answerable queries, 95% bootstrap CI)

| metric | value | 95% CI |
|---|---|---|
| Recall@5 | 0.830 | [0.791, 0.864] |
| MustRecall@5 | 0.920 | [0.881, 0.950] |
| nDCG@10 | 0.856 | [0.825, 0.882] |
| MRR@10 | 0.929 | [0.896, 0.957] |
| P@1 | 0.890 | [0.840, 0.934] |
| hit@10 | 0.989 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 11/34 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 11 | 89.4% | 100.0% | 0.854 | 0.859 | 81.8% | 100.0% | 0.0% | – |
| disambig | 12 | 88.9% | 83.3% | 0.868 | 1.000 | 100.0% | 100.0% | 0.0% | 2/12 |
| exact | 18 | 89.4% | 94.4% | 0.918 | 0.963 | 94.4% | 100.0% | 0.0% | 0/1 |
| freshness | 11 | 95.5% | 90.9% | 0.876 | 1.000 | 100.0% | 100.0% | 0.0% | 7/11 |
| keyword | 22 | 87.1% | 93.2% | 0.851 | 0.924 | 86.4% | 100.0% | 0.0% | 0/2 |
| mixed-lang | 14 | 88.1% | 100.0% | 0.877 | 0.964 | 92.9% | 100.0% | 0.0% | 1/2 |
| morph | 16 | 75.5% | 93.8% | 0.852 | 0.906 | 87.5% | 93.8% | 0.0% | 0/1 |
| nl-task | 52 | 85.5% | 97.1% | 0.891 | 0.962 | 92.3% | 100.0% | 0.0% | 1/5 |
| playbook | 9 | 71.3% | 88.9% | 0.807 | 0.903 | 88.9% | 100.0% | 0.0% | – |
| synonym | 16 | 54.2% | 65.6% | 0.670 | 0.747 | 62.5% | 93.8% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 85 | 82.1% | 92.4% | 0.860 | 0.919 | 88.2% | 97.6% | 0.0% | 7/20 |
| it | 80 | 83.3% | 90.0% | 0.848 | 0.932 | 88.8% | 100.0% | 0.0% | 3/12 |
| mixed | 16 | 86.5% | 100.0% | 0.874 | 0.969 | 93.8% | 100.0% | 0.0% | 1/2 |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 129 | 81.4% | 91.1% | 0.848 | 0.929 | 89.9% | 98.4% | 0.0% | 9/26 |
| heldout | 52 | 86.9% | 94.2% | 0.876 | 0.929 | 86.5% | 100.0% | 0.0% | 2/8 |

### No-answer queries

Returned at least one result: 22/22 (100.0%); zero results: 0.0%.  
lowConfidence ((mode === "any" && top1.coverage < 0.5) || (topSimilarity < minSimilarity && top1.coverage < 0.5)): flagged 12/22 no-answer (recall 54.5%), 6 answerable (4 with a relevant top-1); precision 66.7%.

| id | split | query | returned | mode | top-1 coverage | flagged |
|---|---|---|---|---|---|---|
| Q55 | dev | black friday discount strategy | 10 | any | 0.25 | yes |
| Q56 | dev | orari di apertura del negozio di Bolzano | 10 | any | 0.25 | yes |
| Q57 | dev | returns policy for EU customers | 10 | any | 0.75 | no |
| Q58 | dev | scarponi da sci alpino | 10 | any | 0.33 | yes |
| Q59 | heldout | men's winter hiking boots landing page | 10 | auto | 1.00 | no |
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
| Q163 | dev | pagina categoria zaini | 10 | auto | 0.67 | no |
| Q164 | dev | TikTok content strategy | 10 | any | 0.33 | yes |
| Q165 | dev | giacca in piumino | 10 | any | 0.50 | no |
| Q166 | dev | robots.txt rule for the staging subdomain | 10 | any | 0.60 | no |
| Q167 | dev | collaborazione con influencer | 10 | any | 0.00 | yes |
| Q168 | dev | GA4 event tracking setup | 10 | any | 0.25 | yes |
| Q169 | dev | numero di negozi fisici | 10 | any | 0.33 | yes |

### Latency, build and memory

| metric | value |
|---|---|
| query latency p50 | 1.69 ms |
| query latency p95 | 3.12 ms |
| query latency mean / max | 1.93 / 5.39 ms |
| OKF index build | 107.1 ms |
| search index prepare | n/a (built lazily; see warm-up) |
| warm-up pass | 1158.9 ms |
| RSS before build / after build / end | 104.8 / 155.8 / 184.5 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| Q01 | dev | nl-task | en | which landing page targets winter hiking boots for women? | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots (2) | no |
| Q02 | dev | nl-task | it | cosa abbiamo deciso sulle pagine categoria duplicate? | 10 | 1 | 1 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q03 | dev | nl-task | en | what is the current status of core web vitals on mobile? | 10 | 2 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (0) | yes |
| Q04 | dev | nl-task | it | quali claim sull'impermeabilità possiamo usare nelle descrizioni prodotto? | 10 | 1 | 1 | alpinaria/policies/claim-impermeabile (2) | – |
| Q05 | dev | nl-task | en | experiment Made in Italy English titles result | 10 | 1 | 1 | alpinaria/experiments/en-title-italian-made (2) | – |
| Q06 | heldout | nl-task | it | chi è il competitor più forte sugli scarponi da trekking? | 10 | 1 | miss,1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q07 | dev | nl-task | en | English pages missing hreflang return tags | 10 | 1 | 1,2 | alpinaria/seo-findings/hreflang-missing-en-pages (2) | – |
| Q08 | dev | nl-task | it | perché è calato il traffico sulle pagine dei pile? | 10 | 1 | 1 | alpinaria/seo-findings/calo-traffico-pile-autunno-2026 (2) | – |
| Q09 | dev | nl-task | en | how many words of unique copy does a product page need | 10 | 1 | 1 | alpinaria/decisions/product-page-copy-minimum-120-words (2) | – |
| Q10 | dev | nl-task | it | a che pubblico ci rivolgiamo con la linea Torrente? | 10 | 1 | miss,1 | alpinaria/product-lines/torrente (2) | – |
| Q11 | dev | keyword | it | scarponi trekking donna | 10 | 1 | 3,1 | alpinaria/landing-pages/it-scarponi-da-trekking-donna (2) | no |
| Q12 | dev | keyword | en | approach shoes | 10 | 1 | 3,1 | alpinaria/landing-pages/en-approach-shoes (2) | – |
| Q13 | dev | keyword | it | calze merino | 10 | 1 | 4,1 | alpinaria/landing-pages/it-calze-merino (2) | – |
| Q14 | heldout | keyword | en | hreflang | 10 | 1 | 3,2,4 | playbook/guidelines/hreflang-checklist (1) | – |
| Q15 | heldout | keyword | it | cannibalizzazione | 10 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q16 | dev | keyword | en | sitemap | 10 | 1 | 1,3 | alpinaria/seo-findings/sitemap-stale-urls (2) | – |
| Q17 | heldout | keyword | it | giacca guscio | 10 | 1 | 1,4 | alpinaria/seo-findings/query-mismatch-giacca-guscio (2) | – |
| Q18 | dev | keyword | en | trail running | 10 | 1 | 7,4 | alpinaria/landing-pages/en-trail-running-shoes (1) | – |
| Q19 | dev | mixed-lang | mixed | landing page scarponi donna | 10 | 1 | 2 | alpinaria/landing-pages/it-scarponi-da-trekking-donna-old (1) | yes |
| Q20 | dev | mixed-lang | mixed | keyword cluster giacche impermeabili intent | 10 | 2 | 2 | alpinaria/landing-pages/it-giacche-impermeabili (0) | – |
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
| Q41 | dev | synonym | en | rain jacket for hiking | 10 | 1 | 1,miss | alpinaria/keyword-clusters/hardshell-jacket (2) | – |
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
| Q53 | dev | disambig | en | buy women's winter hiking boots | 10 | 1 | 2 | alpinaria/landing-pages/en-womens-winter-hiking-boots (1) | no |
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
| Q74 | dev | nl-task | en | when is the packing guide refresh due? | 10 | 1 | 2 | alpinaria/landing-pages/en-dolomites-packing-guide (1) | – |
| Q75 | heldout | nl-task | it | quante immagini prodotto sono senza alt text? | 10 | 1 | 1 | alpinaria/seo-findings/immagini-senza-alt (2) | – |
| Q76 | dev | nl-task | en | what should we do about the 300 dead URLs in the sitemap? | 10 | 1 | 1,2 | alpinaria/seo-findings/sitemap-stale-urls (2) | – |
| Q77 | dev | nl-task | it | perché abbiamo interrotto il test delle emoji nelle meta description? | 10 | 1 | 1 | alpinaria/experiments/meta-description-emoji (2) | – |
| Q78 | heldout | nl-task | en | which competitor sponsors the Lavaredo Ultra Trail? | 10 | 1 | 1 | alpinaria/competitors/trailforge (2) | – |
| Q79 | dev | nl-task | it | dove devono stare le guide informative nella struttura URL? | 10 | 1 | 1 | alpinaria/decisions/blog-guides-under-guide-folder (2) | – |
| Q80 | heldout | nl-task | en | what is the outreach plan for the next backlink wave? | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q81 | heldout | nl-task | it | che numero consigliamo con le calze spesse? | 10 | 2 | 2 | alpinaria/products/sck-u-705-rifugio-calze-merino-heavy-u (0) | – |
| Q82 | dev | keyword | it | doposci | 10 | 1 | 1,4 | alpinaria/keyword-clusters/scarponcini-invernali-donna (2) | – |
| Q83 | dev | keyword | en | crawl budget | 10 | 3 | 3 | alpinaria/technical-issues/en-pages-crawl-depth (0) | – |
| Q84 | dev | keyword | it | risuolabile | 10 | 1 | 1 | alpinaria/policies/green-claims (2) | – |
| Q85 | heldout | keyword | en | disavow | 10 | 1 | 1 | alpinaria/seo-findings/backlink-profile-review-2026-q3 (2) | no |
| Q86 | dev | keyword | en | featured snippet | 10 | 1 | 1,2 | alpinaria/seo-findings/featured-snippet-impermeabilizzare (2) | – |
| Q87 | dev | keyword | it | tasselli | 10 | 1 | miss | alpinaria/decisions/trail-running-line-priority-2027 (1) | – |
| Q88 | heldout | keyword | en | GRS certified | 10 | 1 | 1,4 | alpinaria/product-lines/bosco (2) | – |
| Q89 | dev | keyword | it | settimana bianca | 10 | 2 | 2 | alpinaria/audiences/escursionisti-weekend (0) | – |
| Q90 | heldout | keyword | en | aggregateRating | 10 | 1 | 1 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q91 | dev | keyword | en | share of voice | 10 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q92 | dev | keyword | en | Montebelluna | 10 | 1 | 1,5 | alpinaria/content-briefs/en-italian-hiking-boots-brands-history (2) | – |
| Q93 | dev | keyword | en | Alta Via 1 | 10 | 1 | 1 | alpinaria/content-briefs/en-what-to-pack-dolomites (2) | – |
| Q94 | heldout | keyword | it | redirect 301 | 10 | 1 | 1 | alpinaria/decisions/redirect-vecchia-pagina-donna (2) | – |
| Q95 | dev | mixed-lang | mixed | decision canonical filtri colore | 10 | 1 | 1,3 | alpinaria/decisions/canonical-pagine-categoria-duplicate (2) | no |
| Q96 | heldout | mixed-lang | mixed | technical issue alt text PIM | 10 | 1 | 1 | alpinaria/technical-issues/alt-text-mancanti (2) | – |
| Q97 | dev | mixed-lang | mixed | audience trail runner mobile | 10 | 1 | 1 | alpinaria/audiences/trail-runner (2) | – |
| Q98 | dev | mixed-lang | mixed | competitor scarpe da avvicinamento | 10 | 1 | 5 | alpinaria/landing-pages/it-scarpe-da-avvicinamento (1) | – |
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
| Q120 | dev | morph | it | link interno perso | 10 | 1 | 3,1 | alpinaria/experiments/internal-links-pile-from-giacche (2) | – |
| Q121 | dev | morph | en | experiments with positive results | 10 | 1 | 2,1,3 | alpinaria/experiments/product-schema-aggregate-rating (2) | – |
| Q122 | heldout | morph | it | cannibalizzazioni tra pagine | 10 | 1 | 1 | alpinaria/seo-findings/cannibalizzazione-scarponi-donna (2) | – |
| Q123 | dev | morph | en | hydrating the filter widget | 10 | 1 | 1 | alpinaria/technical-issues/inp-filtri-plp (2) | no |
| Q124 | heldout | accent | it | priorita editoriale 2027 | 10 | 1 | 1 | alpinaria/decisions/trail-running-line-priority-2027 (2) | – |
| Q125 | dev | accent | it | sneaker Baita Citta | 10 | 1 | 1,2 | alpinaria/products/lfs-w-901-baita-citt-w (2) | – |
| Q126 | dev | accent | it | stagionalita cluster scarponi donna | 10 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-donna-transazionale (2) | – |
| Q127 | dev | accent | it | profondita di catalogo Montevia | 10 | 1 | 1 | alpinaria/seo-findings/competitor-montevia-serp-share (2) | – |
| Q128 | dev | accent | it | disponibilità immediata famiglie | 10 | 1 | 1 | alpinaria/audiences/famiglie-in-montagna (2) | – |
| Q129 | dev | accent | it | velocita di scroll mobile | 10 | 4 | 4 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (0) | – |
| Q130 | dev | accent | it | gravita alta problemi tecnici | 10 | 5 | 5 | alpinaria/audiences/alpinisti-esperti (0) | – |
| Q131 | dev | synonym | en | insulated boots for snowshoeing | 10 | 3 | 9,4 | alpinaria/landing-pages/en-mens-hiking-boots (0) | – |
| Q132 | dev | synonym | it | scarpe basse per camminare | 10 | 1 | 1,9 | alpinaria/keyword-clusters/scarpe-trekking-leggere (2) | – |
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
| Q144 | dev | freshness | it | filtri taglia robots disallow | 10 | 1 | 1,3 | alpinaria/decisions/faceted-parameters-robots (2) | no |
| Q145 | dev | freshness | it | noindex sulle URL con parametri | 10 | 1 | 8 | alpinaria/technical-issues/parametri-filtri-indicizzati (1) | yes |
| Q146 | heldout | freshness | en | backlink gap to Cimalta | 10 | 1 | 2 | alpinaria/competitors/cimalta (1) | no |
| Q147 | dev | freshness | en | mobile CLS value | 10 | 1 | 2 | alpinaria/seo-findings/core-web-vitals-mobile-2026-01 (1) | yes |
| Q148 | dev | disambig | en | draft redesign of the women's winter page | 10 | 1 | 1 | alpinaria/landing-pages/en-womens-winter-hiking-boots-draft-v2 (2) | no |
| Q149 | heldout | disambig | it | pagina italiana delle giacche hardshell | 10 | 1 | 1 | alpinaria/landing-pages/it-giacche-impermeabili (2) | no |
| Q150 | dev | disambig | en | approach shoes category in Italian | 10 | 1 | 8 | alpinaria/landing-pages/en-approach-shoes (1) | yes |
| Q151 | dev | disambig | it | cluster transazionale scarponi uomo | 10 | 1 | 1 | alpinaria/keyword-clusters/scarponi-trekking-uomo-transazionale (2) | no |
| Q152 | dev | disambig | en | informational cluster about hiking boot sizing | 10 | 1 | 1 | alpinaria/keyword-clusters/boot-sizing-guide-en (2) | no |
| Q153 | dev | disambig | it | cluster taglie scarponi in italiano | 10 | 1 | 2 | alpinaria/content-briefs/guida-taglie-scarponi (1) | no |
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
| Q186 | heldout | nl-task | en | what should English product copy not say? | 10 | 1 | 1 | alpinaria/brand-voice/tone-of-voice-en (2) | – |
| Q187 | dev | keyword | it | lessico scarponi scarpe scarponcini | 10 | 2 | 2 | alpinaria/content-briefs/guida-vie-ferrate-scarpe (0) | – |
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
| Q198 | heldout | nl-task | it | quale CTR ha la query di brand? | 10 | 2 | 2 | alpinaria/seo-findings/query-mismatch-giacca-guscio (0) | – |
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
| Recall@5 | 0.882 | [0.831, 0.929] |
| MustRecall@5 | 0.966 | [0.933, 0.994] |
| nDCG@10 | 0.855 | [0.809, 0.899] |
| MRR@10 | 0.876 | [0.819, 0.927] |
| P@1 | 0.809 | [0.719, 0.888] |
| hit@10 | 0.989 | – |
| zero-result rate | 0.000 | [0.000, 0.000] |
| distractor outranks | 1/9 | – |

### By category

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| accent | 4 | 91.7% | 100.0% | 0.960 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| disambig | 6 | 100.0% | 100.0% | 0.961 | 1.000 | 100.0% | 100.0% | 0.0% | 0/6 |
| exact | 8 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| freshness | 3 | 61.1% | 100.0% | 0.750 | 0.733 | 66.7% | 100.0% | 0.0% | 1/3 |
| keyword | 9 | 93.3% | 100.0% | 0.908 | 0.944 | 88.9% | 100.0% | 0.0% | – |
| mixed-lang | 4 | 100.0% | 100.0% | 0.771 | 0.708 | 50.0% | 100.0% | 0.0% | – |
| morph | 6 | 86.1% | 100.0% | 0.933 | 1.000 | 100.0% | 100.0% | 0.0% | – |
| nl-task | 39 | 92.1% | 97.4% | 0.876 | 0.895 | 82.1% | 100.0% | 0.0% | – |
| standards | 4 | 58.3% | 75.0% | 0.553 | 0.483 | 25.0% | 100.0% | 0.0% | – |
| synonym | 6 | 52.8% | 83.3% | 0.503 | 0.597 | 50.0% | 83.3% | 0.0% | – |

### By language

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| en | 58 | 87.9% | 96.6% | 0.870 | 0.893 | 82.8% | 100.0% | 0.0% | 1/7 |
| it | 27 | 87.0% | 96.3% | 0.835 | 0.864 | 81.5% | 96.3% | 0.0% | 0/2 |
| mixed | 4 | 100.0% | 100.0% | 0.771 | 0.708 | 50.0% | 100.0% | 0.0% | – |

### By split

| group | n | Recall@5 | MustRecall@5 | nDCG@10 | MRR@10 | P@1 | hit@10 | zero-result | distractor outranks |
|---|---|---|---|---|---|---|---|---|---|
| dev | 62 | 87.3% | 96.0% | 0.840 | 0.866 | 79.0% | 98.4% | 0.0% | 1/6 |
| heldout | 27 | 90.2% | 98.1% | 0.890 | 0.899 | 85.2% | 100.0% | 0.0% | 0/3 |

### No-answer queries

Returned at least one result: 10/10 (100.0%); zero results: 0.0%.  
lowConfidence ((mode === "any" && top1.coverage < 0.5) || (topSimilarity < minSimilarity && top1.coverage < 0.5)): flagged 7/10 no-answer (recall 70.0%), 4 answerable (1 with a relevant top-1); precision 63.6%.

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
| query latency p50 | 4.32 ms |
| query latency p95 | 5.99 ms |
| query latency mean / max | 4.14 / 6.57 ms |
| OKF index build | 84.0 ms |
| search index prepare | n/a (built lazily; see warm-up) |
| warm-up pass | 847.2 ms |
| RSS before build / after build / end | 116.1 / 156.4 / 156.4 MB |

### Per query (answerable)

| id | split | cat | lang | query | returned | first relevant | must ranks | top-1 (grade) | distractor first |
|---|---|---|---|---|---|---|---|---|---|
| A01 | heldout | nl-task | en | why did validators in Bologna go offline in January? | 10 | 1 | 1,6 | atlas/incidents/inc-2026-001-validator-outage-bologna (2) | – |
| A02 | dev | nl-task | it | cosa succede ai biglietti quando il validatore è offline? | 10 | 1 | 3 | atlas/runbooks/validator-offline-queue-drain (1) | – |
| A03 | dev | nl-task | en | how long do we keep raw validations? | 10 | 1 | 6,4 | atlas/contracts/ticket-validated-v2 (1) | – |
| A04 | dev | nl-task | it | chi è il reperibile per i problemi di pagamento? | 10 | 3 | 3 | atlas/runbooks/escalation-reperibilita-2025 (0) | – |
| A05 | dev | nl-task | en | what caused the duplicate subscription renewals? | 10 | 2 | 2 | atlas/slos/subscription-manager-renewal-success (0) | – |
| A06 | dev | nl-task | it | come si riconciliano gli avvisi pagoPA non pagati? | 10 | 1 | 1 | atlas/runbooks/pagopa-reconciliation (2) | – |
| A07 | dev | nl-task | en | which PSP do we use and is there a fallback? | 10 | 2 | 2 | atlas/runbooks/rotate-psp-credentials (0) | – |
| A08 | dev | nl-task | en | what is the error budget for the API gateway? | 10 | 1 | 1 | atlas/slos/api-gateway-availability (2) | – |
| A09 | dev | nl-task | it | perché il login SPID non funzionava ad aprile? | 10 | 1 | 1,5 | atlas/incidents/inc-2026-013-spid-login-down (2) | – |
| A10 | dev | nl-task | en | where do we store the EMV token for tap-to-ride? | 10 | 1 | 1 | atlas/decisions/adr-014-emv-contactless-tokenization (2) | – |
| A11 | dev | nl-task | en | what should happen before activating a new fare table? | 10 | 2 | 2 | atlas/services/fare-engine (0) | – |
| A12 | heldout | nl-task | it | quale team possiede il warehouse? | 10 | 1 | 2 | atlas/services/reporting-warehouse (1) | – |
| A13 | dev | keyword | en | fencing token | 10 | 2 | 2 | atlas/decisions/adr-014-emv-contactless-tokenization (0) | – |
| A14 | heldout | keyword | en | RAPTOR | 10 | 1 | 1 | atlas/decisions/adr-005-raptor-trip-planner (2) | – |
| A15 | dev | keyword | it | ricevute telematiche | 10 | 1 | 4,1 | atlas/incidents/inc-2026-007-pagopa-timeout (2) | – |
| A16 | dev | keyword | en | outbox | 10 | 1 | 1 | atlas/decisions/adr-012-outbox-pattern (2) | – |
| A17 | dev | keyword | en | kill switch | 10 | 1 | 1 | atlas/runbooks/feature-flag-kill-switch (2) | – |
| A18 | heldout | keyword | it | tablespace Oracle | 10 | 1 | 1 | atlas/incidents/inc-2025-041-legacy-sbe-crash (2) | – |
| A19 | dev | keyword | en | advisory lock | 10 | 1 | 1 | atlas/incidents/inc-2026-027-subscription-renewal-duplicate (2) | – |
| A20 | heldout | keyword | en | TTL | 10 | 1 | 1,2 | atlas/incidents/inc-2026-018-clickhouse-disk-full (2) | – |
| A21 | dev | keyword | en | Temporal | 10 | 1 | 2 | atlas/runbooks/refund-queue-unstick (1) | – |
| A22 | dev | mixed-lang | mixed | runbook riconciliazione wallet | 10 | 3 | 3 | atlas/runbooks/pagopa-reconciliation (0) | – |
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
| A33 | dev | exact | en | eu-south-1 | 10 | 1 | 1 | atlas/dependencies/kubernetes-eks (2) | – |
| A34 | dev | morph | en | rotating credentials | 10 | 1 | 1 | atlas/runbooks/rotate-psp-credentials (2) | – |
| A35 | dev | morph | it | coda offline validatore | 10 | 1 | 1 | atlas/runbooks/validator-offline-queue-drain (2) | – |
| A36 | dev | morph | en | renewing certificates | 10 | 1 | 1 | atlas/runbooks/certificate-renewal (2) | – |
| A37 | dev | morph | en | partitioned ledger tables | 10 | 1 | 1,2 | atlas/services/validation-ledger (2) | – |
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
| A51 | dev | freshness | en | escalation procedure | 10 | 1 | 2 | atlas/runbooks/escalation-reperibilita-2025 (1) | yes |
| A52 | heldout | freshness | en | validation event schema | 10 | 5 | 5 | atlas/services/validation-ledger (0) | no |
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
| A85 | dev | nl-task | it | per quanto si conservano gli esiti delle verifiche? | 10 | 4 | 4 | atlas/slos/inspector-backend-sync-latency (0) | – |
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

Fusion alpha 0.4 (dense weight) · normalization tmm · units concepts · split all

### alpinaria

Embedder `openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:24000` · remote true · dimension 512 · degraded false · cache rows 228  
Documents: 228 units, 0 embedded, 228 reused, 0 requests, 0 prompt tokens, 1 ms  
Queries: 203 encoded in 203 requests, 1540 prompt tokens · encoding p50 242.8 ms, p95 358.1 ms · search p50 1.69 ms, p95 3.12 ms (excluding encoding)

| category | n | lexical Recall@5 | hybrid Recall@5 | delta | lexical 95% CI half-width | regressed |
|---|---|---|---|---|---|---|
| accent | 11 | 89.4% | 89.4% | +0.0 | 0.114 | no |
| disambig | 12 | 84.7% | 88.9% | +4.2 | 0.125 | no |
| exact | 18 | 88.5% | 89.4% | +0.9 | 0.098 | no |
| freshness | 11 | 93.2% | 95.5% | +2.3 | 0.091 | no |
| keyword | 22 | 89.4% | 87.1% | -2.3 | 0.068 | no |
| mixed-lang | 14 | 83.3% | 88.1% | +4.8 | 0.107 | no |
| morph | 16 | 75.5% | 75.5% | +0.0 | 0.146 | no |
| nl-task | 52 | 83.7% | 85.5% | +1.8 | 0.067 | no |
| playbook | 9 | 71.3% | 71.3% | +0.0 | 0.208 | no |
| synonym | 16 | 59.4% | 54.2% | -5.2 | 0.151 | no |

### atlas

Embedder `openai:https://api.openai.com/v1/embeddings:text-embedding-3-small:512:24000` · remote true · dimension 512 · degraded false · cache rows 167  
Documents: 167 units, 0 embedded, 167 reused, 0 requests, 0 prompt tokens, 0 ms  
Queries: 99 encoded in 99 requests, 803 prompt tokens · encoding p50 207.0 ms, p95 353.1 ms · search p50 4.32 ms, p95 5.99 ms (excluding encoding)

| category | n | lexical Recall@5 | hybrid Recall@5 | delta | lexical 95% CI half-width | regressed |
|---|---|---|---|---|---|---|
| accent | 4 | 91.7% | 91.7% | +0.0 | 0.125 | no |
| disambig | 6 | 100.0% | 100.0% | +0.0 | 0.000 | no |
| exact | 8 | 100.0% | 100.0% | +0.0 | 0.000 | no |
| freshness | 3 | 63.9% | 61.1% | -2.8 | 0.375 | no |
| keyword | 9 | 95.6% | 93.3% | -2.2 | 0.067 | no |
| mixed-lang | 4 | 91.7% | 100.0% | +8.3 | 0.125 | no |
| morph | 6 | 72.2% | 86.1% | +13.9 | 0.167 | no |
| nl-task | 39 | 85.7% | 92.1% | +6.4 | 0.075 | no |
| standards | 4 | 37.5% | 58.3% | +20.8 | 0.208 | no |
| synonym | 6 | 41.7% | 52.8% | +11.1 | 0.236 | no |

## Measurement record (WP3c-2)

Shipped defaults after WP3c-2: text-embedding-3-small at 512 dimensions, concept units, fixed fusion alpha 0.4 with tmm (the rc.2 ranking, reproduced byte for byte), `minSimilarity` 0. Opt-in: `fusion.alpha: adaptive` (weights 0.1 / 0.5 / 0.9), `embedUnits: contextual-sections | contextual-concepts`, `confidence.minSimilarity`, `get_context` `abstainOnLowConfidence`.

### Pre-registration

- Written before the first live run of each step (2026-10-25); dev split only for every choice; held-out and full numbers computed once after the choice and never used to revise it.
- Adaptive grid: low in {0.1, 0.2, 0.3} x mid in {0.3, 0.4, 0.5} x high in {0.6, 0.75, 0.9} (high >= mid), concept units, tmm. Choice: best mean of alpinaria-dev and atlas-dev Recall@5; ties within 0.005 by mean nDCG@10, then the smallest low + mid + high.
- Adaptive becomes the default only if all four hold: alpinaria synonym Recall@5 >= 0.70; no category worse than its paired bootstrap CI against the fixed 0.4 (rc.2) ranking; overall Recall@5 not below the fixed 0.4 on either fixture; fusion overhead <= 1 ms p95 at 20k vectors.
- Units: concepts, sections, contextual-sections, contextual-concepts at the fusion chosen in step 1. Choice: best mean dev Recall@5, ties within 0.005 by mean nDCG@10. The chosen default must not lose to concepts on either fixture beyond the paired CI.
- minSimilarity (tau): grid 0..0.8 step 0.005 over the dev splits at the shipped defaults. Constraint: on each fixture's dev split at most 3% of answerable queries have a relevant top-1 and are flagged. Objective: the most no-answer dev queries flagged (pooled). Ties: the smallest tau.
- Abstention gate: no-answer recall >= 0.70 on both full fixtures with <= 3% of answerable queries with a relevant top-1 flagged; on the private catalog at least 5 of 7 unanswerable flagged and 0 exact lookups flagged.

### Step 1: adaptive fusion weight

Dev grid (concept units, tmm): best mean dev Recall@5 over the fixtures; ties within 0.005 by mean nDCG@10, then the smallest low + mid + high. Choice: low 0.1, mid 0.5, high 0.9 (mean dev Recall@5 0.843, mean nDCG@10 0.851; the fixed 0.4 scores 0.844 / 0.844). The low weight changes nothing on the fixtures: the literal guard already orders those queries.

| low | mid | high | mean dev R@5 | mean dev nDCG@10 | alpinaria dev R@5 / synonym | atlas dev R@5 / synonym |
|---|---|---|---|---|---|---|
| 0.1 | 0.3 | 0.6 | 0.846 | 0.844 | 0.813 / 0.542 | 0.878 / 0.542 |
| 0.1 | 0.3 | 0.75 | 0.848 | 0.843 | 0.817 / 0.542 | 0.878 / 0.542 |
| 0.1 | 0.3 | 0.9 | 0.848 | 0.850 | 0.828 / 0.625 | 0.868 / 0.542 |
| 0.1 | 0.4 | 0.6 | 0.844 | 0.845 | 0.810 / 0.542 | 0.878 / 0.542 |
| 0.1 | 0.4 | 0.75 | 0.844 | 0.846 | 0.814 / 0.542 | 0.873 / 0.542 |
| 0.1 | 0.4 | 0.9 | 0.847 | 0.850 | 0.826 / 0.625 | 0.868 / 0.542 |
| 0.1 | 0.5 | 0.6 | 0.838 | 0.843 | 0.810 / 0.542 | 0.866 / 0.542 |
| 0.1 | 0.5 | 0.75 | 0.840 | 0.846 | 0.814 / 0.542 | 0.866 / 0.542 |
| 0.1 | 0.5 | 0.9 | 0.843 | 0.851 | 0.826 / 0.625 | 0.861 / 0.542 |
| 0.2 | 0.3 | 0.6 | 0.846 | 0.844 | 0.813 / 0.542 | 0.878 / 0.542 |
| 0.2 | 0.3 | 0.75 | 0.848 | 0.843 | 0.817 / 0.542 | 0.878 / 0.542 |
| 0.2 | 0.3 | 0.9 | 0.848 | 0.850 | 0.828 / 0.625 | 0.868 / 0.542 |
| 0.2 | 0.4 | 0.6 | 0.844 | 0.845 | 0.810 / 0.542 | 0.878 / 0.542 |
| 0.2 | 0.4 | 0.75 | 0.844 | 0.846 | 0.814 / 0.542 | 0.873 / 0.542 |
| 0.2 | 0.4 | 0.9 | 0.847 | 0.850 | 0.826 / 0.625 | 0.868 / 0.542 |
| 0.2 | 0.5 | 0.6 | 0.838 | 0.843 | 0.810 / 0.542 | 0.866 / 0.542 |
| 0.2 | 0.5 | 0.75 | 0.840 | 0.846 | 0.814 / 0.542 | 0.866 / 0.542 |
| 0.2 | 0.5 | 0.9 | 0.843 | 0.851 | 0.826 / 0.625 | 0.861 / 0.542 |
| 0.3 | 0.3 | 0.6 | 0.846 | 0.844 | 0.813 / 0.542 | 0.878 / 0.542 |
| 0.3 | 0.3 | 0.75 | 0.848 | 0.843 | 0.817 / 0.542 | 0.878 / 0.542 |
| 0.3 | 0.3 | 0.9 | 0.848 | 0.850 | 0.828 / 0.625 | 0.868 / 0.542 |
| 0.3 | 0.4 | 0.6 | 0.844 | 0.845 | 0.810 / 0.542 | 0.878 / 0.542 |
| 0.3 | 0.4 | 0.75 | 0.844 | 0.846 | 0.814 / 0.542 | 0.873 / 0.542 |
| 0.3 | 0.4 | 0.9 | 0.847 | 0.850 | 0.826 / 0.625 | 0.868 / 0.542 |
| 0.3 | 0.5 | 0.6 | 0.838 | 0.843 | 0.810 / 0.542 | 0.866 / 0.542 |
| 0.3 | 0.5 | 0.75 | 0.840 | 0.846 | 0.814 / 0.542 | 0.866 / 0.542 |
| 0.3 | 0.5 | 0.9 | 0.843 | 0.851 | 0.826 / 0.625 | 0.861 / 0.542 |

Chosen weights against the fixed 0.4 (Recall@5, 95% bootstrap CI):

| fixture | split | fixed 0.4 | adaptive 0.1/0.5/0.9 | paired delta [95% CI] |
|---|---|---|---|---|
| alpinaria | full | 0.830 [0.791, 0.864] | 0.838 [0.799, 0.873] | +0.008 [-0.005, 0.026] |
| alpinaria | dev | 0.814 [0.768, 0.856] | 0.826 [0.780, 0.870] | +0.011 [-0.008, 0.035] |
| alpinaria | heldout | 0.869 [0.813, 0.921] | 0.869 [0.813, 0.921] | +0.000 [0.000, 0.000] |
| atlas | full | 0.882 [0.831, 0.929] | 0.870 [0.817, 0.920] | -0.012 [-0.030, 0.002] |
| atlas | dev | 0.873 [0.811, 0.930] | 0.861 [0.792, 0.923] | -0.012 [-0.032, 0.007] |
| atlas | heldout | 0.902 [0.819, 0.967] | 0.890 [0.806, 0.958] | -0.012 [-0.037, 0.000] |

Per category (paired bootstrap of the Recall@5 difference against the fixed 0.4):

alpinaria: accent -0.045 [-0.136, 0.000]; disambig +0.000 [0.000, 0.000]; exact +0.000 [0.000, 0.000]; freshness +0.000 [0.000, 0.000]; keyword -0.017 [-0.042, 0.000]; mixed-lang +0.000 [0.000, 0.000]; morph +0.000 [0.000, 0.000]; nl-task +0.016 [0.000, 0.042]; playbook +0.056 [0.000, 0.167]; synonym +0.063 [0.000, 0.188].

alpinaria weight reasons over all queries: all_terms 46, interpolated 127, literal_terms 18, weak_lexical 12.

atlas: accent +0.000 [0.000, 0.000]; disambig +0.000 [0.000, 0.000]; exact +0.000 [0.000, 0.000]; freshness +0.083 [0.000, 0.250]; keyword -0.037 [-0.111, 0.000]; mixed-lang +0.000 [0.000, 0.000]; morph +0.000 [0.000, 0.000]; nl-task -0.017 [-0.043, 0.000]; standards -0.083 [-0.250, 0.000]; synonym +0.000 [0.000, 0.000].

atlas weight reasons over all queries: interpolated 58, all_terms 19, literal_terms 15, weak_lexical 7.

Hybrid latency at 5,000 concepts x 4 units (20,000 synthetic vectors, query encoding excluded; `scripts/index-benchmark.js --sizes 5000 --rounds 10 --search-module scripts/hybrid-bench-module.js`, three interleaved runs each):

| run | p50 ms | p95 ms | max ms |
|---|---|---|---|
| alpha 0.4-1 | 23.83 | 33.06 | 42.07 |
| alpha 0.4-2 | 23.89 | 33.7 | 42.21 |
| alpha 0.4-3 | 24.19 | 33.37 | 42.06 |
| alpha adaptive-1 | 23.93 | 33.41 | 44.71 |
| alpha adaptive-2 | 24.12 | 33.7 | 42.02 |
| alpha adaptive-3 | 24.29 | 33.87 | 42.32 |

Mean p95: fixed 33.377 ms, adaptive 33.660 ms, overhead 0.283 ms (budget 1 ms; the 60 ms hybrid p95 budget holds).

| pre-registered condition | value | result |
|---|---|---|
| alpinaria synonym Recall@5 >= 0.70 | 0.604 | not met |
| no category worse than its paired CI | none regressed | met |
| overall Recall@5 not below fixed 0.4 on either fixture | alpinaria 0.830 -> 0.838; atlas 0.882 -> 0.870 | not met |
| fusion overhead <= 1 ms p95 at 20k vectors | 0.280 | met |

Decision: the default stays the fixed 0.4; the adaptive weight ships opt-in with the dev-chosen weights.

### Step 2: contextual units

At the step-1 fusion (fixed 0.4, tmm). Paired: Recall@5 difference against concept units with its 95% paired bootstrap CI.

| units | alpinaria dev | atlas dev | mean dev R@5 | mean dev nDCG@10 | held-out alpinaria / atlas | full alpinaria / atlas | synonym alpinaria / atlas | paired vs concepts alpinaria; atlas | document tokens |
|---|---|---|---|---|---|---|---|---|---|
| concepts | 0.814 | 0.873 | 0.844 | 0.844 | 0.869 / 0.902 | 0.830 / 0.882 | 0.542 / 0.528 | – | 82406 |
| sections | 0.805 | 0.862 | 0.834 | 0.837 | 0.879 / 0.902 | 0.826 / 0.874 | 0.573 / 0.472 | -0.003 [-0.014, 0.006]; -0.007 [-0.019, 0.000] | 72157 |
| contextual-sections | 0.806 | 0.877 | 0.841 | 0.841 | 0.869 / 0.902 | 0.824 / 0.885 | 0.573 / 0.528 | -0.006 [-0.017, 0.004]; 0.003 [0.000, 0.008] | 112884 |
| contextual-concepts | 0.813 | 0.873 | 0.843 | 0.843 | 0.869 / 0.902 | 0.829 / 0.882 | 0.542 / 0.528 | -0.001 [-0.009, 0.006]; -0.000 [-0.011, 0.011] | 87874 |

Choice by the WP3c rule: concepts (every row is within 0.005 of the best mean except sections; concepts has the best mean nDCG@10). No unit set loses to concepts beyond the paired CI on either fixture. Prefix cost: contextual-sections 112,884 against 72,157 prompt tokens for plain sections (+56%; fixture sections average about 190 characters, so the up to 160-character prefix weighs far more than the 10-15% the plan expected), contextual-concepts 87,874 against 82,406 (+6.6%).

For information, the same unit sets under the adaptive weight (not a choice the rule makes):

| units + adaptive | mean dev R@5 | mean dev nDCG@10 | full alpinaria / atlas | synonym alpinaria / atlas | category regressions vs concepts at 0.4 |
|---|---|---|---|---|---|
| concepts | 0.843 | 0.851 | 0.838 / 0.870 | 0.604 / 0.528 | none |
| sections | 0.836 | 0.843 | 0.830 / 0.878 | 0.615 / 0.583 | keyword |
| contextual-sections | 0.843 | 0.847 | 0.828 / 0.881 | 0.604 / 0.528 | none |
| contextual-concepts | 0.848 | 0.854 | 0.837 / 0.877 | 0.583 / 0.528 | none |

### Step 3: abstention v2

Rule: `(mode === any && coverage < 0.5) || (topSimilarity < minSimilarity && coverage < 0.5)`. On the dev splits every tau from 0 to 0.8 flags the same no-answer queries (17 of 24) and the same answerable top-1 hits; the first extra answerable flag appears at 0.55. The pre-registered tie-break picks tau = 0. Every no-answer query whose top result matches fewer than half of the terms is already an any-term fallback, so the similarity clause (which shares the coverage bound) flags nothing new on the fixtures at any tau up to the first answerable flag; the unflagged no-answer queries all have a top coverage of 0.5 or more.

| fixture | split | no-answer flagged | recall | answerable flagged | relevant top-1 flagged | share |
|---|---|---|---|---|---|---|
| alpinaria | dev | 11/16 | 0.688 | 4/129 | 3 | 2.3% |
| atlas | dev | 6/8 | 0.750 | 2/62 | 1 | 1.6% |
| alpinaria | heldout | 1/6 | 0.167 | 2/52 | 1 | 1.9% |
| atlas | heldout | 1/2 | 0.500 | 2/27 | 0 | 0.0% |
| alpinaria | all | 12/22 | 0.545 | 6/181 | 4 | 2.2% |
| atlas | all | 7/10 | 0.700 | 4/89 | 1 | 1.1% |

Gate (full sets): alpinaria no-answer recall 0.545 (target 0.70, not met), atlas 0.700 (met); relevant top-1 flagged 2.2% and 1.1% (max 3%, met). test/search-acceptance.test.js records the shortfall with the skip pattern.

Proposal evidence (not shipped): without the shared coverage bound, `(mode any && coverage < 0.5) || (mode any && topSimilarity < tau)` chooses tau 0.4 on dev and flags 19 of 24 no-answer queries (alpinaria 11/16, atlas 8/8) with 3/129 and 1/62 relevant top-1 results flagged; held-out 4/8 (alpinaria 2/6, atlas 2/2) with 1/52 and 0/27; full alpinaria 13/22, atlas 10/10 with 4/181 and 1/89. Alpinaria stays below 0.70.

### Real catalog (private)

A private production catalog (560 concepts, read-only; 45 agent-labelled queries, 7 no-answer, 8 exact); the rc.2 comparison harness with NEW pointed at this branch, hybrid on, vectors reused (550 query tokens per run). The opt-in adaptive column is informative only; nothing was chosen on this catalog.

| Recall@5 | lexical rc.2 -> 0.12 | hybrid rc.2 -> 0.12 | hybrid, adaptive opt-in |
|---|---|---|---|
| overall | 0.590 -> 0.590 | 0.664 -> 0.664 | 0.686 |
| Ingestion | 0.608 -> 0.608 | 0.742 -> 0.742 | 0.742 |
| Pipeline | 0.506 -> 0.506 | 0.521 -> 0.521 | 0.551 |
| other | 0.667 -> 0.667 | 0.667 -> 0.667 | 0.738 |
| task | 0.629 -> 0.629 | 0.703 -> 0.703 | 0.689 |
| exact | 0.833 -> 0.833 | 0.896 -> 0.896 | 0.938 |
| paraphrase | 0.000 -> 0.000 | 0.100 -> 0.100 | 0.267 |
| MRR@10 | 0.689 -> 0.689 | 0.761 -> 0.761 | 0.775 |

Abstention on the private catalog (hybrid): 4 -> 4 of 7 unanswerable flagged (target 5, not met: the three unflagged ones have a top coverage of 0.60-0.67, which the coverage bound of both clauses excludes), 0 of 8 exact lookups flagged (target 0, met). get_context must-have concepts delivered: 26 -> 26 of 38 at 1,200 tokens, 27 -> 28 at 2,000. tools/list in the default read-only mode: 32111 -> 33351 bytes.

Prompt tokens over every live fixture run behind this report: 299777, plus 1100 for the two private-catalog runs (about 0.0060 USD at 0.02 USD per million).
