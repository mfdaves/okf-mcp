---
type: "Decision"
title: "Decision: keep /en/ subfolder and implement hreflang it-IT / en with x-default to Italian"
description: "No ccTLD or subdomain for the English shop; x-default stays on the Italian version."
tags: ["decision", "decisione", "en"]
lang: "en"
relations:
  - type: "related_to"
    target: "okf://alpinaria/decisions/en-locale-single-english"
  - type: "resolves"
    target: "okf://alpinaria/technical-issues/hreflang-return-tags-en"
sources:
  - id: "meeting-2026-03-05"
    resource: "https://docs.agency.internal/alpinaria/meetings/2026-03-05"
    author: "human:giulia.ferri"
generated:
  at: "2026-02-12T14:00:00Z"
  by: "human:giulia.ferri"
verified:
  by: "human:marco.benedetti"
  at: "2026-02-14T09:00:00Z"
status: "stable"
---

# Decision: keep /en/ subfolder and implement hreflang it-IT / en with x-default to Italian

**Decided 2026-02-12.** The English shop stays under the `/en/` subfolder of alpinaria.it; no .com migration and no subdomain. hreflang annotations: `it-IT` for Italian pages, `en` (no region) for English pages, `x-default` pointing to the Italian URL because Italy is 70% of revenue. Return tags are mandatory on both sides. The x-default experiment later confirmed this choice. Implementation via the sitemap, not in-page tags, to keep templates simple.
