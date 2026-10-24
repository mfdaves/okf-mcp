---
type: "Experiment"
title: "Experiment: \"Made in Italy\" in English category titles"
description: "Hypothesis: heritage wording lifts CTR for EU visitors. Result: +1.4 points CTR on allowed lines."
tags: ["experiment", "esperimento", "positive", "en"]
lang: "en"
hypothesis: "Adding \"Made in Italy\" to English category title tags increases CTR from German and Dutch users."
result: "positive"
relations:
  - type: "tests_page"
    target: "okf://alpinaria/landing-pages/en-mens-hiking-boots"
  - type: "applies_policy"
    target: "okf://alpinaria/policies/made-in-italy-claim"
sources:
  - id: "gsc"
    resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it"
    author: "process:gsc-sync"
generated:
  at: "2026-05-02T07:00:00Z"
  by: "agent/seo-alpinaria"
verified:
  by: "human:giulia.ferri"
  at: "2026-08-30T09:00:00Z"
status: "stable"
---

# Experiment: "Made in Italy" in English category titles

**Period:** 2026-06-15 → 2026-08-10, English category pages of the lines where the claim is allowed (Dolomiti, Cresta, Nevaio, Rifugio); Sentiero and Torrente as control (claim not allowed, titles unchanged).

**Hypothesis:** English-speaking EU visitors respond to Italian heritage wording.

**Result:** CTR +1.4 points (2.6% → 4.0%) on the test pages, control flat (+0.1). Position unchanged. The experiment worked; the wording is now permanent on the allowed lines and documented in the Made in Italy policy.
