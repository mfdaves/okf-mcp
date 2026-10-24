#!/usr/bin/env node
"use strict";
/*
 * Retrieval fixture "alpinaria": a reproducible OKF v0.2 corpus for an autonomous SEO agent
 * (one customer bundle plus a shared read-only playbook bundle). Fixture 1 of the WP0 harness.
 *
 * Writes:
 *   <out>/bundles/alpinaria/   customer bundle (Italian outdoor footwear & apparel brand, IT + EN)
 *   <out>/bundles/playbook/    shared agency playbook (read-only by convention)
 *   <out>/okf.project.yaml     project file declaring both bundles and the custom relation types
 *
 * Usage: node generate.js [--out <dir>] [--seed <n>] [--extra-products <n>]
 *
 * Defaults regenerate the committed fixture in place (--out defaults to this directory, seed 42).
 * Everything is deterministic for a given seed: test/retrieval-fixtures.test.js asserts that a
 * fresh run is byte-identical to the committed tree. Anchor concepts referenced by queries.json
 * have fixed IDs and hand-written text; the remaining concepts are templated with seeded variation.
 * --extra-products adds procedurally generated products for scaling experiments only.
 */

const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const OUT = path.resolve(opt("--out", __dirname));
const SEED = Number(opt("--seed", 42));
const EXTRA_PRODUCTS = Number(opt("--extra-products", 0));
const CUSTOMER = "alpinaria";
const PLAYBOOK = "playbook";

// ---------------------------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------------------------
function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const pad = (n, w) => String(n).padStart(w, "0");

// ---------------------------------------------------------------------------------------------
// YAML emitter (block style, JSON-quoted scalars => valid YAML 1.2 core schema)
// ---------------------------------------------------------------------------------------------
function yamlScalar(v) {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
}
function yamlLines(value, indent) {
  const pre = " ".repeat(indent);
  const lines = [];
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const inner = yamlLines(item, indent + 2);
        lines.push(`${pre}- ${inner[0].trimStart()}`);
        inner.slice(1).forEach((l) => lines.push(l));
      } else {
        lines.push(`${pre}- ${yamlScalar(item)}`);
      }
    });
    return lines;
  }
  Object.entries(value).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(`${pre}${k}: []`); return; }
      if (v.every((x) => typeof x !== "object")) {
        lines.push(`${pre}${k}: [${v.map(yamlScalar).join(", ")}]`);
      } else {
        lines.push(`${pre}${k}:`);
        yamlLines(v, indent + 2).forEach((l) => lines.push(l));
      }
    } else if (typeof v === "object") {
      lines.push(`${pre}${k}:`);
      yamlLines(v, indent + 2).forEach((l) => lines.push(l));
    } else {
      lines.push(`${pre}${k}: ${yamlScalar(v)}`);
    }
  });
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Actors, sources, dates
// ---------------------------------------------------------------------------------------------
const ACTOR = {
  agent: "agent/seo-alpinaria",
  giulia: "human:giulia.ferri",       // SEO lead (agency)
  marco: "human:marco.benedetti",     // e-commerce manager (client)
  elena: "human:elena.rossi",         // legal / brand compliance (client)
  gsc: "process:gsc-sync",
  crawl: "process:crawl-weekly",
  pim: "process:pim-export",
  playbook: "human:agency.seo-practice",
};
const SRC = {
  gsc: { id: "gsc", resource: "https://search.google.com/search-console?resource_id=sc-domain:alpinaria.it", author: ACTOR.gsc },
  pim: { id: "pim", resource: "https://pim.alpinaria.internal/export/2026-09", author: ACTOR.pim },
  crawl: { id: "crawl", resource: "https://crawl.agency.internal/alpinaria/2026-10-12", author: ACTOR.crawl },
  crawlOld: { id: "crawl", resource: "https://crawl.agency.internal/alpinaria/2026-01-20", author: ACTOR.crawl },
  meeting: { id: "meeting-2026-09-18", resource: "https://docs.agency.internal/alpinaria/meetings/2026-09-18", author: ACTOR.giulia },
  meetingOld: { id: "meeting-2026-03-05", resource: "https://docs.agency.internal/alpinaria/meetings/2026-03-05", author: ACTOR.giulia },
  kwp: { id: "keyword-planner", resource: "https://ads.google.com/aw/keywordplanner", author: ACTOR.agent },
  psi: { id: "pagespeed", resource: "https://pagespeed.web.dev/analysis?url=https://www.alpinaria.it/", author: ACTOR.agent },
  crux: { id: "crux", resource: "https://developer.chrome.com/docs/crux", author: ACTOR.agent },
  legal: { id: "legal-memo", resource: "https://docs.alpinaria.internal/legal/claims-2026", author: ACTOR.elena },
  brandbook: { id: "brandbook", resource: "https://docs.alpinaria.internal/brand/brandbook-2026", author: ACTOR.marco },
  ahrefs: { id: "backlinks", resource: "https://app.ahrefs.com/site-explorer/overview/v2/subdomains/live?target=alpinaria.it", author: ACTOR.agent },
  analytics: { id: "ga4", resource: "https://analytics.google.com/analytics/web/#/p0000/reports", author: ACTOR.agent },
};
const conceptSource = (id, conceptId) => ({ id, resource: `okf://${CUSTOMER}/${conceptId}` });

const TODAY = "2026-10-24";
const PAST = ["2026-02-28", "2026-03-31", "2026-04-30", "2026-06-30", "2026-08-31", "2026-09-30"];
const FUTURE = ["2026-12-31", "2027-01-31", "2027-03-31", "2027-04-30", "2027-06-30"];
function isoAt(y, m, d, h) { return `${y}-${pad(m, 2)}-${pad(d, 2)}T${pad(h || 9, 2)}:00:00Z`; }
function randomAt(fromMonthIndex, toMonthIndex) {
  // month index 0 = 2025-11
  const mi = fromMonthIndex + Math.floor(rng() * (toMonthIndex - fromMonthIndex + 1));
  const y = mi < 2 ? 2025 : 2026;
  const m = mi < 2 ? 11 + mi : mi - 1;
  return isoAt(y, m, 1 + Math.floor(rng() * 27), 7 + Math.floor(rng() * 11));
}

// ---------------------------------------------------------------------------------------------
// Concept registry
// ---------------------------------------------------------------------------------------------
const bundles = { [CUSTOMER]: [], [PLAYBOOK]: [] };
const ids = new Set();

function concept(bundle, c) {
  if (!c.id || !c.type || !c.title) throw new Error(`concept missing id/type/title: ${JSON.stringify(c).slice(0, 80)}`);
  const key = `${bundle}/${c.id}`;
  if (ids.has(key)) throw new Error(`duplicate concept id ${key}`);
  ids.add(key);
  bundles[bundle].push(Object.assign({ bundle }, c));
  return c.id;
}
const cust = (c) => concept(CUSTOMER, c);
const uri = (id, bundle) => `okf://${bundle || CUSTOMER}/${id}`;
const rel = (type, id, bundle) => ({ type, target: uri(id, bundle) });
// Markdown link relative to a file at depth 1 (e.g. products/x.md -> ../product-lines/y.md)
const mdlink = (text, id) => `[${text}](../${id}.md)`;

// Provenance helpers -------------------------------------------------------------------------
function provenance(kind, overrides) {
  const p = {};
  switch (kind) {
    case "product":
      p.generated = { at: randomAt(0, 11), by: ACTOR.pim };
      p.sources = [SRC.pim];
      if (chance(0.3)) p.verified = { by: ACTOR.marco, at: randomAt(6, 11) };
      p.status = chance(0.1) ? "draft" : "stable";
      break;
    case "cluster":
      p.generated = { at: randomAt(2, 10), by: ACTOR.agent };
      p.sources = [SRC.kwp, SRC.gsc];
      if (chance(0.5)) p.verified = { by: ACTOR.giulia, at: randomAt(5, 11) };
      p.status = "stable";
      p.stale_after = chance(0.2) ? pick(PAST) : pick(FUTURE);
      break;
    case "landing":
      p.generated = { at: randomAt(3, 11), by: ACTOR.crawl };
      p.sources = [SRC.crawl, SRC.gsc];
      if (chance(0.6)) p.verified = { by: ACTOR.crawl, at: isoAt(2026, 10, 12, 3) };
      p.status = "stable";
      break;
    case "finding":
      p.generated = { at: randomAt(4, 11), by: ACTOR.agent };
      p.sources = [pick([SRC.gsc, SRC.crawl, SRC.analytics])];
      if (chance(0.4)) p.verified = { by: pick([ACTOR.giulia, ACTOR.crawl]), at: randomAt(8, 11) };
      p.status = "stable";
      p.stale_after = chance(0.3) ? pick(PAST) : pick(FUTURE);
      break;
    case "decision":
      p.generated = { at: randomAt(3, 11), by: pick([ACTOR.giulia, ACTOR.marco]) };
      p.sources = [SRC.meeting];
      p.verified = { by: ACTOR.giulia, at: randomAt(8, 11) };
      p.status = "stable";
      break;
    case "experiment":
      p.generated = { at: randomAt(4, 11), by: ACTOR.agent };
      p.sources = [SRC.gsc];
      p.status = "stable";
      break;
    case "brief":
      p.generated = { at: randomAt(7, 11), by: ACTOR.agent };
      p.sources = [SRC.kwp];
      p.status = chance(0.5) ? "draft" : "stable";
      break;
    case "issue":
      p.generated = { at: randomAt(5, 11), by: ACTOR.crawl };
      p.sources = [SRC.crawl];
      if (chance(0.7)) p.verified = { by: ACTOR.crawl, at: isoAt(2026, 10, 12, 3) };
      p.status = "stable";
      p.stale_after = pick(FUTURE);
      break;
    case "policy":
      p.generated = { at: randomAt(1, 6), by: ACTOR.elena };
      p.sources = [SRC.legal];
      p.verified = { by: ACTOR.elena, at: randomAt(6, 10) };
      p.status = "stable";
      break;
    case "competitor":
      p.generated = { at: randomAt(3, 9), by: ACTOR.agent };
      p.status = "stable";
      p.stale_after = chance(0.25) ? pick(PAST) : pick(FUTURE);
      break;
    case "audience":
      p.generated = { at: randomAt(0, 3), by: ACTOR.marco };
      p.sources = [SRC.brandbook, SRC.analytics];
      p.verified = { by: ACTOR.marco, at: randomAt(2, 5) };
      p.status = "stable";
      break;
    case "brand":
      p.generated = { at: randomAt(0, 1), by: ACTOR.marco };
      p.sources = [SRC.brandbook];
      p.verified = { by: ACTOR.marco, at: randomAt(1, 3) };
      p.status = "stable";
      break;
    case "playbook":
      p.generated = { at: randomAt(0, 4), by: ACTOR.playbook };
      p.verified = { by: ACTOR.playbook, at: randomAt(4, 8) };
      p.status = "stable";
      break;
    default:
      break;
  }
  return Object.assign(p, overrides || {});
}

// ---------------------------------------------------------------------------------------------
// 1. Brand voice (3)
// ---------------------------------------------------------------------------------------------
cust({
  id: "brand-voice/tono-di-voce-it", type: "Brand Voice", lang: "it",
  title: "Tono di voce Alpinaria (italiano)",
  description: "Come scrive Alpinaria in italiano: registro, lessico, cose da evitare.",
  tags: ["brand", "tone-of-voice", "copy", "italiano"],
  ...provenance("brand"),
  body: `# Tono di voce Alpinaria (italiano)

Alpinaria parla come una guida alpina esperta ma alla mano: competente, concreta, mai gridata. Diamo del tu. Preferiamo frasi brevi e verbi attivi. Il montanaro di Montebelluna che ha cucito il primo scarpone nel 1962 è il nostro punto di riferimento: sostanza prima dello stile.

## Lessico da usare
- "scarponi" per le calzature alte da trekking, "scarpe" per le basse, "scarponcini" per i modelli invernali leggeri.
- "guscio" (non "hardshell") nei testi italiani, salvo nelle pagine che intercettano la query inglese.
- "impermeabile" solo quando autorizzato dalla ${mdlink("policy sui claim di impermeabilità", "policies/claim-impermeabile")}.

## Da evitare
Superlativi assoluti ("il migliore", "il più leggero al mondo"), anglicismi gratuiti, punti esclamativi in serie, promesse tecniche non verificabili. Vedi anche il ${mdlink("glossario IT/EN", "brand-voice/glossario-terminologia")}.
`,
});
cust({
  id: "brand-voice/tone-of-voice-en", type: "Brand Voice", lang: "en",
  title: "Alpinaria tone of voice (English)",
  description: "How Alpinaria writes for English-speaking EU customers.",
  tags: ["brand", "tone-of-voice", "copy", "english"],
  ...provenance("brand"),
  body: `# Alpinaria tone of voice (English)

In English we sound like a well-travelled Italian friend who happens to make boots: warm, precise, lightly proud of the Dolomites heritage, never salesy. British spelling (colour, metres). Use "hiking boots" for the high-cut models, "hiking shoes" for low cut, "snow boots" or "winter boots" for the insulated Nevaio range.

## Do
- Lead with the terrain and the person, then the product.
- Name the valley or the trail when we can (Val di Fassa, Alta Via 1).
- Keep sentences under 20 words in product copy.

## Do not
- No "best in class", no "revolutionary", no medical promises (see the ${mdlink("medical claims policy", "policies/medical-health-claims")}).
- Do not translate Italian idioms literally. "Made in Italy" only where the ${mdlink("Made in Italy policy", "policies/made-in-italy-claim")} allows it.
`,
});
cust({
  id: "brand-voice/glossario-terminologia", type: "Brand Voice", lang: "mixed",
  title: "Glossario terminologia IT/EN",
  description: "Corrispondenze tra i termini italiani usati nel catalogo e la terminologia inglese usata nelle pagine EN.",
  tags: ["glossario", "glossary", "terminologia", "traduzione"],
  ...provenance("brand"),
  body: `# Glossario terminologia IT/EN

| Italiano | English | Note |
|---|---|---|
| scarponi (da trekking) | hiking boots / trekking boots | "scarpone" al singolare solo nelle schede prodotto |
| scarpe da escursionismo | hiking shoes | low cut |
| scarpe da avvicinamento | approach shoes | |
| scarponcini invernali, doposci | winter boots, snow boots | linea Nevaio |
| scarpe da trail running | trail running shoes | linea Torrente |
| giacca guscio | hardshell jacket, shell jacket | |
| pile | fleece | |
| intimo tecnico | base layer | |
| calze | socks | |
| impermeabile | waterproof | claim regolato |
| idrorepellente | water-repellent (DWR) | |
| traspirabilità | breathability | |
| membrana AquaStop | AquaStop membrane | marchio registrato Alpinaria |
| suola Gripmax | Gripmax outsole | mescola proprietaria |
| tomaia | upper | |
| intersuola | midsole | |
| taglia / numero | size | |

Il glossario è la fonte per gli hreflang alternates e per i title delle pagine EN.
`,
});

// ---------------------------------------------------------------------------------------------
// 2. Product lines (10) and products (60)
// ---------------------------------------------------------------------------------------------
const LINES = [
  { id: "dolomiti", name: "Dolomiti", code: "TRK", cat: "scarponi da trekking", catEn: "hiking boots", membrane: true, madeInItaly: true,
    it: "Scarponi da trekking in pelle nabuk con membrana AquaStop. La linea storica Alpinaria per escursioni di più giorni, sentieri rocciosi e zaino pesante.",
    en: "Nubuck leather hiking boots with the AquaStop membrane. The heritage Alpinaria line for multi-day treks, rocky trails and heavy packs.",
    models: [["AquaStop", "W", 42, 189], ["AquaStop", "M", 42, 189], ["Lite", "W", 55, 159], ["Lite", "M", 55, 159], ["Alta", "W", 63, 229], ["Alta", "M", 63, 229]],
    lp: ["landing-pages/it-scarponi-da-trekking-donna", "landing-pages/it-scarponi-da-trekking-uomo", "landing-pages/en-mens-hiking-boots"] },
  { id: "sentiero", name: "Sentiero", code: "HIK", cat: "scarpe da escursionismo leggere", catEn: "lightweight hiking shoes", membrane: false, madeInItaly: false,
    it: "Scarpe da escursionismo basse e leggere, tomaia in mesh e pelle scamosciata, trattamento idrorepellente. Per sentieri facili, camminate in collina e viaggi.",
    en: "Low-cut lightweight hiking shoes with a mesh and suede upper and a water-repellent finish. For easy trails, hill walks and travel.",
    models: [["Vento", "W", 110, 129], ["Vento", "M", 110, 129], ["Vento Mid", "W", 112, 139], ["Vento Mid", "M", 112, 139], ["Aria", "W", 118, 119], ["Aria", "M", 118, 119]],
    lp: ["landing-pages/it-scarpe-da-trekking-leggere", "landing-pages/en-lightweight-hiking-shoes"] },
  { id: "cresta", name: "Cresta", code: "APP", cat: "scarpe da avvicinamento", catEn: "approach shoes", membrane: false, madeInItaly: true,
    it: "Scarpe da avvicinamento con suola Gripmax a zona climbing, fascia in gomma sulla punta e allacciatura fino in punta. Pensate per vie ferrate, sentieri attrezzati e avvicinamenti alle pareti.",
    en: "Approach shoes with a Gripmax outsole featuring a climbing zone, a rubber toe rand and lacing to the toe. Built for via ferrata, scrambling and walk-ins to the crag.",
    models: [["Grip", "W", 201, 149], ["Grip", "M", 201, 149], ["Ferrata", "W", 207, 169], ["Ferrata", "M", 207, 169], ["Roccia", "U", 214, 179], ["Roccia Lite", "U", 216, 159]],
    lp: ["landing-pages/it-scarpe-da-avvicinamento", "landing-pages/en-approach-shoes"] },
  { id: "nevaio", name: "Nevaio", code: "WIN", cat: "scarponcini invernali", catEn: "winter boots", membrane: true, madeInItaly: true,
    it: "Scarponcini invernali isolati con imbottitura termica da 200 g, membrana AquaStop e suola Gripmax Ice per neve battuta e ghiaccio. I doposci tecnici di Alpinaria.",
    en: "Insulated winter boots with 200 g thermal lining, AquaStop membrane and Gripmax Ice outsole for packed snow and ice. Alpinaria's technical snow boots.",
    models: [["Termo", "W", 301, 179], ["Termo", "M", 301, 179], ["Neve", "W", 305, 199], ["Neve", "M", 305, 199], ["Polar", "W", 309, 219], ["Polar", "M", 309, 219]],
    lp: ["landing-pages/it-scarponcini-invernali-donna", "landing-pages/en-womens-winter-hiking-boots"] },
  { id: "torrente", name: "Torrente", code: "TRL", cat: "scarpe da trail running", catEn: "trail running shoes", membrane: false, madeInItaly: false,
    it: "Scarpe da trail running con intersuola reattiva, drop 6 mm e tasselli da 5 mm. Leggere, drenanti, per sentieri tecnici e gare in montagna.",
    en: "Trail running shoes with a responsive midsole, 6 mm drop and 5 mm lugs. Light, fast-draining, for technical trails and mountain races.",
    models: [["Rapido", "W", 401, 139], ["Rapido", "M", 401, 139], ["Rapido Pro", "W", 404, 159], ["Rapido Pro", "M", 404, 159], ["Fango", "W", 410, 149], ["Fango", "M", 410, 149]],
    lp: ["landing-pages/it-scarpe-trail-running", "landing-pages/en-trail-running-shoes"] },
  { id: "vetta", name: "Vetta", code: "JKT", cat: "giacche guscio impermeabili", catEn: "hardshell jackets", membrane: true, madeInItaly: false,
    it: "Giacche guscio a tre strati con membrana AquaStop (colonna d'acqua 20.000 mm), cuciture termonastrate e cappuccio compatibile con il casco. Protezione dalla pioggia e dal vento in quota.",
    en: "Three-layer hardshell jackets with the AquaStop membrane (20,000 mm hydrostatic head), taped seams and a helmet-compatible hood. Waterproof and windproof protection at altitude.",
    models: [["Guscio", "U", 310, 299], ["Guscio Pro", "W", 320, 349], ["Guscio Pro", "M", 320, 349], ["Leggera", "W", 330, 249], ["Leggera", "M", 330, 249], ["Alpina", "U", 340, 399]],
    lp: ["landing-pages/it-giacche-impermeabili", "landing-pages/en-hardshell-jackets"] },
  { id: "bosco", name: "Bosco", code: "FLC", cat: "pile e strati intermedi", catEn: "fleece mid layers", membrane: false, madeInItaly: false,
    it: "Pile e strati intermedi in poliestere riciclato al 70% (certificato GRS), vestibilità atletica, zip a contrasto. Lo strato caldo e traspirante sotto il guscio.",
    en: "Fleece mid layers in 70% recycled polyester (GRS certified), athletic fit, contrast zips. The warm breathable layer under the shell.",
    models: [["Pile", "W", 501, 89], ["Pile", "M", 501, 89], ["Pile Zip", "W", 505, 99], ["Pile Zip", "M", 505, 99], ["Grid", "U", 510, 109], ["Grid Hoody", "U", 512, 119]],
    lp: ["landing-pages/it-pile"] },
  { id: "rifugio", name: "Rifugio", code: "BSL", cat: "intimo tecnico e calze in lana merino", catEn: "merino base layers and socks", membrane: false, madeInItaly: true,
    it: "Intimo tecnico e calze in lana merino (18,5 micron) lavorate a Montebelluna. Termoregolazione naturale, nessun odore anche dopo tre giorni di cammino.",
    en: "Merino wool base layers and socks (18.5 micron) knitted in Montebelluna. Natural temperature regulation, no odour even after three days on the trail.",
    models: [["Merino Base", "W", 601, 69], ["Merino Base", "M", 601, 69], ["Merino Long", "W", 605, 79], ["Merino Long", "M", 605, 79], ["Calze Merino", "U", 701, 19, "SCK"], ["Calze Merino Heavy", "U", 705, 22, "SCK"]],
    lp: ["landing-pages/it-calze-merino", "landing-pages/en-merino-hiking-socks"] },
  { id: "passo", name: "Passo", code: "PNT", cat: "pantaloni softshell da montagna", catEn: "softshell mountain pants", membrane: false, madeInItaly: false,
    it: "Pantaloni softshell elasticizzati in quattro direzioni, ginocchia preformate, trattamento idrorepellente. Dal sentiero alla ferrata senza cambiarsi.",
    en: "Four-way stretch softshell pants with articulated knees and a water-repellent finish. From the trail to the via ferrata without changing.",
    models: [["Softshell", "W", 801, 129], ["Softshell", "M", 801, 129], ["Softshell Warm", "W", 805, 149], ["Softshell Warm", "M", 805, 149], ["Zip-off", "W", 810, 109], ["Zip-off", "M", 810, 109]],
    lp: ["landing-pages/it-pantaloni-softshell"] },
  { id: "baita", name: "Baita", code: "LFS", cat: "sneaker lifestyle", catEn: "lifestyle sneakers", membrane: false, madeInItaly: false,
    it: "Sneaker lifestyle ispirate agli scarponi d'archivio: pelle scamosciata, suola Gripmax Urban, colori di montagna. Per il dopo-escursione e la città.",
    en: "Lifestyle sneakers inspired by archive boots: suede, Gripmax Urban outsole, mountain colours. For après-hike and the city.",
    models: [["Città", "W", 901, 119], ["Città", "M", 901, 119], ["Urban", "W", 905, 109], ["Urban", "M", 905, 109], ["Canvas", "U", 910, 99], ["Winter", "U", 915, 139]],
    lp: [] },
];

const GENDER = { W: { it: "donna", en: "women's" }, M: { it: "uomo", en: "men's" }, U: { it: "unisex", en: "unisex" } };
const SIZES = { TRK: "36–47", HIK: "36–47", APP: "36–47", WIN: "36–46", TRL: "36–47", LFS: "36–46", JKT: "XS–XXL", FLC: "XS–XXL", BSL: "XS–XL", PNT: "XS–XXL", SCK: "35–47" };
const COLORS_IT = ["antracite", "nero", "verde abete", "terracotta", "blu notte", "sabbia", "ruggine", "grigio pietra"];
const COLORS_EN = ["anthracite", "black", "fir green", "terracotta", "midnight blue", "sand", "rust", "stone grey"];

const productIds = {};
LINES.forEach((line) => {
  cust({
    id: `product-lines/${line.id}`, type: "Product Line", lang: "mixed",
    title: `Linea ${line.name}`,
    description: `${line.name}: ${line.cat} / ${line.catEn}.`,
    tags: ["linea", "product-line", line.id, line.code.toLowerCase()],
    aliases: [line.name, `${line.name} line`],
    ...provenance("brand"),
    relations: line.lp.map((lp) => rel("promoted_by", lp)),
    body: `# Linea ${line.name}

${line.it}

${line.en}

## Modelli / Models
${line.models.map((m) => `- ${line.name} ${m[0]} ${m[1]} — SKU ${m[4] || line.code}-${m[1]}-${pad(m[2], 3)}`).join("\n")}

## Note
- Codice linea: ${line.code}. Taglie ${SIZES[line.code]}.
- ${line.madeInItaly ? "Assemblata a Montebelluna (TV): claim \"Made in Italy\" consentito." : "Prodotta in Vietnam su design italiano: usare \"Designed in Italy\", mai \"Made in Italy\"."} Vedi ${mdlink("policy Made in Italy", "policies/made-in-italy-claim")}.
- ${line.membrane ? "Membrana AquaStop: il claim \"impermeabile\" è consentito (vedi " + mdlink("policy impermeabilità", "policies/claim-impermeabile") + ")." : "Nessuna membrana: solo \"idrorepellente\" / \"water-repellent\"."}
${line.lp.length ? `- Pagine di categoria: ${line.lp.map((lp) => mdlink(lp.split("/")[1], lp)).join(", ")}.` : "- Nessuna pagina di categoria dedicata: la linea vive nelle pagine prodotto e nell'outlet."}
`,
  });
});

function productBody(line, m, sku, g, price, lang) {
  const colorIt = pick(COLORS_IT), colorEn = pick(COLORS_EN);
  const weight = 250 + Math.floor(rng() * 500);
  const name = `${line.name} ${m[0]} ${m[1]}`;
  const slugIt = `/${line.cat.split(" ")[0] === "giacche" ? "abbigliamento/giacche-impermeabili" : line.cat.replace(/ /g, "-")}/${g.it}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/`;
  const slugEn = `/en/${line.catEn.replace(/ /g, "-")}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/`;
  const itSentences = [
    `${line.membrane ? "Membrana AquaStop per un'impermeabilità garantita e una buona traspirabilità" : "Trattamento idrorepellente che fa scivolare via la pioggia leggera"}.`,
    `Suola Gripmax ${line.code === "WIN" ? "Ice" : line.code === "LFS" ? "Urban" : ""} con tasselli autopulenti.`.replace(/\s+/g, " "),
    `Peso ${weight} g (taglia ${g.it === "donna" ? "38" : "42"}). Taglie ${SIZES[m[4] || line.code]}. Colore ${colorIt}.`,
    `Calzata ${pick(["regolare", "media", "ampia in punta", "avvolgente"])}; ${pick(["consigliamo mezzo numero in più con calze spesse", "veste fedele al numero abituale", "prendere il numero abituale"])}.`,
    pick(["Ideale per escursioni giornaliere e trekking di più giorni.", "Pensata per chi cammina tutto l'anno.", "Il modello più venduto della linea nella stagione 2025/26.", "Nuovo per la stagione autunno-inverno 2026."]),
  ];
  const enSentences = [
    `${line.membrane ? "AquaStop membrane: waterproof and breathable" : "Water-repellent finish that sheds light showers"}.`,
    `Gripmax ${line.code === "WIN" ? "Ice " : line.code === "LFS" ? "Urban " : ""}outsole with self-cleaning lugs.`,
    `Weight ${weight} g (size ${g.en === "women's" ? "EU 38" : "EU 42"}). Sizes ${SIZES[m[4] || line.code]}. Colour ${colorEn}.`,
    `${pick(["Regular fit", "Medium fit", "Roomy toe box", "Snug fit"])}; ${pick(["go half a size up with thick socks", "true to size", "order your usual size"])}.`,
    pick(["Ideal for day hikes and multi-day treks.", "Built for year-round walking.", "Best seller of the line in the 2025/26 season.", "New for autumn-winter 2026."]),
  ];
  const head = `# ${name}\n\n**SKU:** ${sku} · **${lang === "en" ? "Line" : "Linea"}:** ${mdlink(line.name, `product-lines/${line.id}`)} · **${lang === "en" ? "Gender" : "Genere"}:** ${lang === "en" ? g.en : g.it} · **${lang === "en" ? "List price" : "Prezzo di listino"}:** ${price},00 €\n\n`;
  const seoIt = `## Note SEO\n\nPagina prodotto: \`${slugIt}\`. Title attuale: "${name} – ${line.cat} ${g.it} | Alpinaria". ${chance(0.5) ? "Scheda con meno di 80 parole di testo unico: da ampliare." : "Scheda completa, recensioni attive."}\n`;
  const seoEn = `## SEO notes\n\nProduct URL: \`${slugEn}\`. Current title: "${name} – ${g.en} ${line.catEn} | Alpinaria". ${chance(0.5) ? "Fewer than 80 words of unique copy: expand." : "Full copy, reviews enabled."}\n`;
  if (lang === "it") {
    return head + `${capitalize(singularIt(line.cat))} da ${g.it} ${line.name}: ${itSentences.join(" ")}\n\n${seoIt}`;
  }
  if (lang === "en") {
    return head + `${capitalize(g.en)} ${singularEn(line.catEn)} ${line.name}: ${enSentences.join(" ")}\n\n${seoEn}`;
  }
  return head + `${capitalize(singularIt(line.cat))} da ${g.it} ${line.name}: ${itSentences.slice(0, 3).join(" ")}\n\n${enSentences.slice(2).join(" ")}\n\n${seoIt}\n${seoEn}`;
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function singularIt(cat) {
  return cat.replace(/^scarponi/, "scarpone").replace(/^scarpe/, "scarpa").replace(/^scarponcini/, "scarponcino")
    .replace(/^giacche guscio impermeabili/, "giacca guscio impermeabile").replace(/^pile e strati intermedi/, "pile")
    .replace(/^intimo tecnico e calze in lana merino/, "capo in lana merino").replace(/^pantaloni softshell da montagna/, "pantalone softshell")
    .replace(/^sneaker lifestyle/, "sneaker lifestyle");
}
function singularEn(cat) {
  return cat.replace(/boots$/, "boot").replace(/shoes$/, "shoe").replace(/jackets$/, "jacket").replace(/layers$/, "layer")
    .replace(/merino base layers and socks/, "merino piece").replace(/pants$/, "pant").replace(/sneakers$/, "sneaker");
}

LINES.forEach((line) => {
  line.models.forEach((m, idx) => {
    const code = m[4] || line.code;
    const sku = `${code}-${m[1]}-${pad(m[2], 3)}`;
    const g = GENDER[m[1]];
    const name = `${line.name} ${m[0]} ${m[1]}`;
    const lang = ["it", "en", "mixed", "it", "en", "it"][idx];
    const id = `products/${sku.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    productIds[sku] = id;
    cust({
      id, type: "Product", lang,
      title: name,
      description: lang === "en" ? `${capitalize(g.en)} ${singularEn(line.catEn)}, SKU ${sku}, ${m[3]} €.` : `${capitalize(singularIt(line.cat))} ${g.it}, SKU ${sku}, ${m[3]} €.`,
      tags: ["prodotto", "product", line.id, code.toLowerCase(), g.it],
      aliases: [sku],
      sku, line: line.name, gender: m[1], price_eur: m[3],
      ...provenance("product"),
      relations: [rel("belongs_to_line", `product-lines/${line.id}`)],
      body: productBody(line, m, sku, g, m[3], lang),
    });
  });
});

// Extra procedurally generated products for scaling experiments
for (let i = 0; i < EXTRA_PRODUCTS; i += 1) {
  const line = pick(LINES);
  const m = [`${pick(["Evo", "Trek", "Nord", "Sud", "Cima", "Valle"])} ${i}`, pick(["W", "M", "U"]), 950 + i, 99 + (i % 7) * 10];
  const sku = `${line.code}-${m[1]}-${pad(m[2], 3)}`;
  const name = `${line.name} ${m[0]} ${m[1]}`;
  cust({
    id: `products/${sku.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, type: "Product", lang: pick(["it", "en", "mixed"]),
    title: name, description: `SKU ${sku}.`, tags: ["prodotto", "product", line.id], aliases: [sku], sku,
    ...provenance("product"), relations: [rel("belongs_to_line", `product-lines/${line.id}`)],
    body: productBody(line, m, sku, GENDER[m[1]], m[3], pick(["it", "en"])),
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Audiences (6)
// ---------------------------------------------------------------------------------------------
const AUDIENCES = [
  { id: "audiences/escursionisti-weekend", lang: "it", title: "Escursionisti del fine settimana", description: "Segmento principale IT: camminatori occasionali, 35–55 anni, Nord Italia.",
    body: "Camminatori occasionali che escono 10–15 volte l'anno, soprattutto in Veneto, Trentino e Lombardia. Comprano uno scarpone ogni 3–4 anni, cercano \"scarponi da trekking\" su Google in settembre e in aprile, leggono le recensioni e temono di sbagliare la taglia. Segmento che pesa il 46% del fatturato online. Canale preferito: ricerca organica + confronto su marketplace. Linee rilevanti: Dolomiti, Sentiero, Bosco." },
  { id: "audiences/alpinisti-esperti", lang: "it", title: "Alpinisti e frequentatori di vie ferrate", description: "Segmento tecnico IT: ferrate, alta quota, acquisti informati.",
    body: "Frequentatori abituali di vie ferrate e alta quota, 25–50 anni, spesso iscritti al CAI. Conoscono i materiali, confrontano i pesi al grammo e cercano query specifiche come \"scarpe da ferrata\" o \"guscio tre strati\". Prezzo medio di carrello doppio rispetto alla media. Linee rilevanti: Cresta, Vetta, Passo, Rifugio. Il segmento tollera testi tecnici lunghi e premia le schede con dati reali (colonna d'acqua, grammi, drop)." },
  { id: "audiences/trail-runner", lang: "mixed", title: "Trail runner / corridori in montagna", description: "Segmento in crescita, IT ed EN, linea Torrente.",
    body: "Runner che corrono su sentiero tra le 2 e le 5 volte a settimana, 28–45 anni, metà uomini e metà donne. Cambiano scarpe ogni 600–800 km, quindi riacquistano spesso. In Italia cercano \"scarpe trail running\", in inglese \"trail running shoes\" e nomi di gara (Lavaredo, Dolomyths). Mobile first: 81% delle sessioni da smartphone. They respond to drop, lug depth and weight in the first screen, and they compare us with Trailforge. Linea rilevante: Torrente. Il segmento è la priorità editoriale 2027." },
  { id: "audiences/famiglie-in-montagna", lang: "it", title: "Famiglie in montagna", description: "Segmento stagionale IT: vacanze estive e settimane bianche.",
    body: "Famiglie con bambini tra 6 e 14 anni che vanno in montagna d'estate e per la settimana bianca. Comprano per gli adulti (non abbiamo una linea bambino) e cercano comfort, prezzo e disponibilità immediata. Query tipiche: \"scarponcini invernali donna\", \"pile uomo\", \"scarponi trekking offerta\". Segmento sensibile all'outlet e alle promozioni di fine stagione. Linee rilevanti: Nevaio, Bosco, Sentiero." },
  { id: "audiences/eu-english-dolomites-visitors", lang: "en", title: "English-speaking EU visitors planning a Dolomites trip", description: "Core EN segment: Germans, Dutch, Belgians, Scandinavians browsing in English before a trip to the Dolomites.",
    body: "Travellers from Germany, the Netherlands, Belgium, Austria and Scandinavia who browse in English, typically 4–8 weeks before a hiking holiday in the Dolomites or Lake Garda. They search \"what to pack for the Dolomites\", \"italian hiking boots\" and \"women's winter hiking boots\" (for the snowshoe season). Average order value is 22% above the Italian segment, return rate higher because of sizing doubts. They buy the heritage story: Montebelluna, leather, Made in Italy where we can claim it. Relevant lines: Dolomiti, Nevaio, Vetta, Rifugio." },
  { id: "audiences/eco-conscious-buyers", lang: "en", title: "Eco-conscious buyers", description: "Cross-market segment that filters by recycled materials and repairability.",
    body: "Buyers in both markets, skewing 25–40 and female, who check material composition, recycled content and repair options before purchasing. They respond to GRS certificates, resoling service and honest claims; they punish vague \"eco-friendly\" wording, which is why the green claims policy exists. Typical queries: \"recycled fleece\", \"resoleable hiking boots\", \"pile riciclato\". Relevant lines: Bosco, Rifugio, Dolomiti (resoling)." },
];
AUDIENCES.forEach((a) => cust(Object.assign({ type: "Audience", tags: ["audience", "segmento", "target"] }, provenance("audience"), a, { body: `# ${a.title}\n\n${a.body}\n` })));

// ---------------------------------------------------------------------------------------------
// 4. Keyword clusters (30)
// ---------------------------------------------------------------------------------------------
const CLUSTERS = [
  // --- Italian ---
  { id: "keyword-clusters/scarponi-trekking-donna-transazionale", lang: "it", intent: "transactional", market: "it", volume: 9900,
    title: "Scarponi da trekking donna — transazionale",
    terms: ["scarponi da trekking donna", "scarponi trekking donna impermeabili", "scarponi da montagna donna", "scarponi donna trekking prezzo", "scarponi trekking donna in pelle"],
    lp: "landing-pages/it-scarponi-da-trekking-donna", audience: "audiences/escursionisti-weekend",
    notes: "Cluster transazionale ad alto volume, stagionalità settembre/aprile. SERP: shopping, pagine categoria di Montevia e Quota3000, nessun risultato informativo tra i primi 5. Non confondere con il cluster informativo sulla scelta." },
  { id: "keyword-clusters/scarponi-trekking-informazionale", lang: "it", intent: "informational", market: "it", volume: 4400,
    title: "Come scegliere gli scarponi da trekking — informazionale",
    terms: ["come scegliere gli scarponi da trekking", "differenza scarponi e scarpe da trekking", "scarponi da trekking alti o bassi", "scarponi trekking quali comprare", "migliori scarponi da trekking"],
    lp: "landing-pages/it-guida-scelta-scarponi", audience: "audiences/escursionisti-weekend",
    notes: "Intent informativo: la SERP è fatta di guide e video. Si intercetta con la guida, non con la categoria. Featured snippet presente per la query principale (occupato da un blog di settore)." },
  { id: "keyword-clusters/scarponi-trekking-uomo-transazionale", lang: "it", intent: "transactional", market: "it", volume: 12100,
    title: "Scarponi da trekking uomo — transazionale",
    terms: ["scarponi da trekking uomo", "scarponi trekking uomo impermeabili", "scarponi da montagna uomo", "scarponi uomo pelle trekking"],
    lp: "landing-pages/it-scarponi-da-trekking-uomo", audience: "audiences/escursionisti-weekend",
    notes: "Volume più alto del catalogo. Posizione media 6,8; Montevia e Cimalta davanti a noi." },
  { id: "keyword-clusters/scarpe-trekking-leggere", lang: "it", intent: "commercial", market: "it", volume: 3600,
    title: "Scarpe da trekking leggere — commerciale",
    terms: ["scarpe da trekking leggere", "scarpe da escursionismo basse", "scarpe trekking estive", "scarpe da camminata montagna"],
    lp: "landing-pages/it-scarpe-da-trekking-leggere", audience: "audiences/escursionisti-weekend",
    notes: "Intent commerciale/di confronto: molti \"migliori scarpe da trekking leggere\". Linea Sentiero." },
  { id: "keyword-clusters/scarpe-avvicinamento", lang: "it", intent: "commercial", market: "it", volume: 1900,
    title: "Scarpe da avvicinamento — commerciale",
    terms: ["scarpe da avvicinamento", "scarpe avvicinamento donna", "scarpe approach", "scarpe da avvicinamento uomo"],
    lp: "landing-pages/it-scarpe-da-avvicinamento", audience: "audiences/alpinisti-esperti",
    notes: "Nicchia tecnica, alto tasso di conversione. Rocciaviva domina la SERP. Linea Cresta." },
  { id: "keyword-clusters/scarponcini-invernali-donna", lang: "it", intent: "transactional", market: "it", volume: 5400,
    title: "Scarponcini invernali donna — transazionale",
    terms: ["scarponcini invernali donna", "doposci donna", "scarponcini donna imbottiti", "stivaletti invernali impermeabili donna", "scarponcini invernali donna montagna"],
    lp: "landing-pages/it-scarponcini-invernali-donna", audience: "audiences/famiglie-in-montagna",
    notes: "Picco novembre–gennaio. Il termine \"doposci\" porta traffico ma con intent più lifestyle. Linea Nevaio." },
  { id: "keyword-clusters/scarpe-trail-running", lang: "it", intent: "transactional", market: "it", volume: 8100,
    title: "Scarpe trail running — transazionale",
    terms: ["scarpe trail running", "scarpe da trail running uomo", "scarpe trail running donna", "scarpe trail", "scarpe da corsa in montagna"],
    lp: "landing-pages/it-scarpe-trail-running", audience: "audiences/trail-runner",
    notes: "Competizione fortissima con i brand running puri e Trailforge. Linea Torrente." },
  { id: "keyword-clusters/giacca-impermeabile-montagna", lang: "it", intent: "commercial", market: "it", volume: 6600,
    title: "Giacche impermeabili da montagna — commerciale",
    terms: ["giacca impermeabile montagna", "giacche impermeabili trekking", "giacca guscio", "giacca a vento impermeabile donna", "giacca guscio uomo", "hardshell"],
    lp: "landing-pages/it-giacche-impermeabili", audience: "audiences/alpinisti-esperti",
    notes: "Gli utenti italiani cercano \"giacca guscio\" e \"giacca impermeabile\"; la pagina usa solo \"hardshell\" nel title: vedi il finding sul mismatch. Linea Vetta." },
  { id: "keyword-clusters/pile-montagna", lang: "it", intent: "transactional", market: "it", volume: 7400,
    title: "Pile da montagna — transazionale",
    terms: ["pile uomo", "pile donna", "maglia in pile", "pile montagna", "pile trekking", "pile riciclato"],
    lp: "landing-pages/it-pile", audience: "audiences/famiglie-in-montagna",
    notes: "Stagionale (ottobre–febbraio). Calo di traffico in corso: vedi il finding dedicato. Linea Bosco." },
  { id: "keyword-clusters/calze-trekking-merino", lang: "it", intent: "transactional", market: "it", volume: 2400,
    title: "Calze da trekking in lana merino — transazionale",
    terms: ["calze trekking merino", "calze da trekking", "calze lana merino", "calze merino", "calze da montagna"],
    lp: "landing-pages/it-calze-merino", audience: "audiences/escursionisti-weekend",
    notes: "Prodotto d'ingresso a basso prezzo, ottimo per acquisizione. Linea Rifugio." },
  { id: "keyword-clusters/pantaloni-softshell", lang: "it", intent: "transactional", market: "it", volume: 2900,
    title: "Pantaloni softshell da montagna — transazionale",
    terms: ["pantaloni softshell", "pantaloni da montagna uomo", "pantaloni trekking donna", "pantaloni softshell invernali"],
    lp: "landing-pages/it-pantaloni-softshell", audience: "audiences/alpinisti-esperti",
    notes: "Linea Passo. Posizione media 11,2: seconda pagina." },
  { id: "keyword-clusters/membrana-impermeabile-info", lang: "it", intent: "informational", market: "it", volume: 1600,
    title: "Membrana impermeabile e traspirabilità — informazionale",
    terms: ["membrana impermeabile scarponi", "scarponi impermeabili come funzionano", "impermeabilità scarponi", "traspirabilità membrana", "scarponi impermeabili e traspiranti"],
    lp: "landing-pages/it-guida-cura-scarponi", audience: "audiences/escursionisti-weekend",
    notes: "Domande sull'impermeabilità e sulla traspirabilità della membrana. Ottimo per spiegare AquaStop senza violare la policy sui claim." },
  { id: "keyword-clusters/cura-manutenzione-scarponi", lang: "it", intent: "informational", market: "it", volume: 2200,
    title: "Cura e manutenzione degli scarponi — informazionale",
    terms: ["come pulire scarponi in pelle", "come impermeabilizzare scarponi", "ingrassare scarponi", "manutenzione scarponi trekking", "impermeabilizzante scarponi"],
    lp: "landing-pages/it-guida-cura-scarponi", audience: "audiences/escursionisti-weekend",
    notes: "La guida alla cura è già in posizione 4 per \"come impermeabilizzare scarponi\": opportunità featured snippet." },
  { id: "keyword-clusters/misura-scarponi-trekking", lang: "it", intent: "informational", market: "it", volume: 3300,
    title: "Taglia e numero degli scarponi da trekking — informazionale",
    terms: ["taglia scarponi trekking", "scarponi trekking che numero prendere", "scarponi un numero in più", "misura scarponi montagna"],
    lp: null, audience: "audiences/escursionisti-weekend",
    notes: "Nessuna pagina dedicata in italiano: il brief per la guida taglie è in lavorazione. Query che precede l'acquisto e riduce i resi." },
  { id: "keyword-clusters/alpinaria-brand", lang: "it", intent: "navigational", market: "it", volume: 14800,
    title: "Alpinaria — navigazionale (brand)",
    terms: ["alpinaria", "alpinaria scarponi", "alpinaria outlet", "alpinaria montebelluna", "alpinaria dolomiti scarponi"],
    lp: null, audience: null,
    notes: "Query di brand. CTR 61%. Monitorare i sitelink e la pagina outlet." },
  { id: "keyword-clusters/sneaker-outdoor-lifestyle", lang: "it", intent: "commercial", market: "it", volume: 2000,
    title: "Sneaker outdoor lifestyle — commerciale",
    terms: ["sneaker outdoor uomo", "scarpe casual montagna", "sneaker stile trekking", "sneaker outdoor donna"],
    lp: null, audience: "audiences/escursionisti-weekend",
    notes: "Linea Baita. PiedeLibero domina. Nessuna landing dedicata, solo schede prodotto." },
  { id: "keyword-clusters/saldi-scarponi", lang: "it", intent: "transactional", market: "it", volume: 4000,
    title: "Scarponi in offerta e outlet — transazionale stagionale",
    terms: ["scarponi trekking offerta", "outlet scarponi", "scarponi trekking scontati", "saldi scarponi montagna", "alpinaria outlet"],
    lp: "landing-pages/it-outlet", audience: "audiences/famiglie-in-montagna",
    notes: "Picchi a gennaio e luglio. La pagina /outlet/ resta indicizzata tutto l'anno per decisione del team." },
  { id: "keyword-clusters/vie-ferrate-scarpe", lang: "it", intent: "commercial", market: "it", volume: 1300,
    title: "Scarpe da ferrata — commerciale",
    terms: ["scarpe da ferrata", "scarpe per vie ferrate", "scarponi da ferrata", "scarpe ferrata donna"],
    lp: "landing-pages/it-scarpe-da-avvicinamento", audience: "audiences/alpinisti-esperti",
    notes: "Si sovrappone alle scarpe da avvicinamento ma con intent più da principiante. Candidato a una guida dedicata." },
  // --- English ---
  { id: "keyword-clusters/womens-winter-hiking-boots-transactional", lang: "en", intent: "transactional", market: "en-eu", volume: 2900,
    title: "Women's winter hiking boots — transactional",
    terms: ["women's winter hiking boots", "insulated hiking boots women", "buy women's winter hiking boots", "womens snow hiking boots", "warm waterproof hiking boots women"],
    lp: "landing-pages/en-womens-winter-hiking-boots", audience: "audiences/eu-english-dolomites-visitors",
    notes: "Transactional. SERP dominated by NordPasso and marketplaces. Peak December–February. Nevaio line. Keep separate from the informational cluster." },
  { id: "keyword-clusters/womens-winter-hiking-boots-informational", lang: "en", intent: "informational", market: "en-eu", volume: 1300,
    title: "How to choose winter hiking boots — informational",
    terms: ["how to choose winter hiking boots", "are hiking boots warm enough for snow", "winter hiking boots vs snow boots", "what to look for in winter hiking boots"],
    lp: null, audience: "audiences/eu-english-dolomites-visitors",
    notes: "Informational. No page yet: a content brief is in progress. Would support the transactional page through internal links." },
  { id: "keyword-clusters/mens-hiking-boots-waterproof", lang: "en", intent: "transactional", market: "en-eu", volume: 4400,
    title: "Men's waterproof hiking boots — transactional",
    terms: ["men's waterproof hiking boots", "mens hiking boots", "leather hiking boots men", "waterproof trekking boots men"],
    lp: "landing-pages/en-mens-hiking-boots", audience: "audiences/eu-english-dolomites-visitors",
    notes: "Highest-volume EN cluster. Dolomiti line. Average position 9.4." },
  { id: "keyword-clusters/lightweight-hiking-shoes", lang: "en", intent: "commercial", market: "en-eu", volume: 2400,
    title: "Lightweight hiking shoes — commercial",
    terms: ["lightweight hiking shoes", "low cut hiking shoes", "best lightweight hiking shoes", "summer hiking shoes"],
    lp: "landing-pages/en-lightweight-hiking-shoes", audience: "audiences/eu-english-dolomites-visitors",
    notes: "Comparison intent, listicle SERP. Sentiero line." },
  { id: "keyword-clusters/approach-shoes", lang: "en", intent: "commercial", market: "en-eu", volume: 1900,
    title: "Approach shoes — commercial",
    terms: ["approach shoes", "approach shoes for via ferrata", "scrambling shoes", "women's approach shoes", "best approach shoes"],
    lp: "landing-pages/en-approach-shoes", audience: "audiences/alpinisti-esperti",
    notes: "Technical niche; strong conversion. Cresta line. Rocciaviva and NordPasso ahead." },
  { id: "keyword-clusters/hardshell-jacket", lang: "en", intent: "commercial", market: "en-eu", volume: 3600,
    title: "Hardshell jackets — commercial",
    terms: ["hardshell jacket", "waterproof hiking jacket", "shell jacket women", "3 layer hardshell", "hardshell jacket men"],
    lp: "landing-pages/en-hardshell-jackets", audience: "audiences/alpinisti-esperti",
    notes: "Vetta line. NordPasso owns the SERP; we rank 12–18." },
  { id: "keyword-clusters/merino-hiking-socks", lang: "en", intent: "transactional", market: "en-eu", volume: 2000,
    title: "Merino hiking socks — transactional",
    terms: ["merino hiking socks", "merino wool hiking socks", "best hiking socks blisters", "italian merino socks"],
    lp: "landing-pages/en-merino-hiking-socks", audience: "audiences/eco-conscious-buyers",
    notes: "Entry product for EN acquisition. Rifugio line." },
  { id: "keyword-clusters/dolomites-hiking-gear", lang: "en", intent: "informational", market: "en-eu", volume: 2700,
    title: "What to pack for the Dolomites — informational",
    terms: ["what to pack for the dolomites", "dolomites hiking boots", "dolomites packing list", "hiking gear dolomites summer", "do i need hiking boots for the dolomites"],
    lp: "landing-pages/en-dolomites-packing-guide", audience: "audiences/eu-english-dolomites-visitors",
    notes: "Top-of-funnel for EU visitors. Our packing guide ranks 3 for the head term. Refresh brief scheduled." },
  { id: "keyword-clusters/trail-running-shoes-eu", lang: "en", intent: "transactional", market: "en-eu", volume: 5400,
    title: "Trail running shoes — transactional (EN)",
    terms: ["trail running shoes", "trail running shoes women", "trail running shoes men", "trail shoes for rocky terrain"],
    lp: "landing-pages/en-trail-running-shoes", audience: "audiences/trail-runner",
    notes: "Torrente line. Trailforge and the big running brands dominate; we rank beyond 20 for the head term." },
  { id: "keyword-clusters/boot-sizing-guide-en", lang: "en", intent: "informational", market: "en-eu", volume: 1800,
    title: "Hiking boot sizing — informational",
    terms: ["hiking boot sizing", "should hiking boots be a size bigger", "hiking boot size guide", "how should hiking boots fit"],
    lp: "landing-pages/en-boot-sizing-guide", audience: "audiences/eu-english-dolomites-visitors",
    notes: "Reduces returns in the EN segment. Sizing guide ranks 7." },
  { id: "keyword-clusters/italian-hiking-boots-brand", lang: "en", intent: "commercial", market: "en-eu", volume: 1100,
    title: "Italian hiking boots brands — commercial",
    terms: ["italian hiking boots", "italian made hiking boots", "italian hiking boot brands", "montebelluna boots"],
    lp: null, audience: "audiences/eu-english-dolomites-visitors",
    notes: "Brand-adjacent commercial cluster surfaced by the EN brand query finding. Content brief on the Montebelluna story planned." },
  { id: "keyword-clusters/fleece-mid-layer", lang: "en", intent: "commercial", market: "en-eu", volume: 2200,
    title: "Fleece mid layers — commercial",
    terms: ["fleece mid layer", "hiking fleece", "recycled fleece jacket", "grid fleece"],
    lp: null, audience: "audiences/eco-conscious-buyers",
    notes: "Bosco line has no EN category page: products only." },
];
const INTENT_IT = { transactional: "transazionale", informational: "informazionale", commercial: "commerciale", navigational: "navigazionale" };
CLUSTERS.forEach((c) => {
  const it = c.lang === "it";
  const relations = [];
  if (c.lp) relations.push(rel("targets_page", c.lp));
  if (c.audience) relations.push(rel("for_audience", c.audience));
  cust({
    id: c.id, type: "Keyword Cluster", lang: c.lang,
    title: c.title,
    description: it ? `Cluster ${INTENT_IT[c.intent]} (${c.volume} ricerche/mese, mercato IT).` : `${capitalize(c.intent)} cluster (${c.volume} searches/month, EN EU market).`,
    tags: ["keyword-cluster", c.intent, c.market, ...(it ? ["parole-chiave"] : ["keywords"])],
    intent: c.intent, market: c.market, monthly_volume: c.volume,
    ...provenance("cluster"),
    relations,
    body: `# ${c.title}

**Intent:** ${c.intent}${it ? ` (${INTENT_IT[c.intent]})` : ""} · **${it ? "Mercato" : "Market"}:** ${c.market} · **${it ? "Volume mensile" : "Monthly volume"}:** ${c.volume}

## ${it ? "Parole chiave principali" : "Head terms"}
${c.terms.map((t) => `- ${t}`).join("\n")}

## ${it ? "Pagina di destinazione" : "Target page"}
${c.lp ? mdlink(c.lp.split("/")[1], c.lp) : (it ? "Nessuna pagina mappata." : "No page mapped yet.")}

## ${it ? "Note" : "Notes"}
${c.notes}
`,
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Landing pages (24)
// ---------------------------------------------------------------------------------------------
const PAGES = [
  { id: "landing-pages/it-scarponi-da-trekking-donna", lang: "it", url: "/scarponi-da-trekking/donna/", cluster: "keyword-clusters/scarponi-trekking-donna-transazionale", line: "dolomiti",
    title: "Scarponi da trekking donna (IT)", h1: "Scarponi da trekking da donna", titleTag: "Scarponi da Trekking Donna da 149 € | Alpinaria",
    notes: "Pagina categoria principale per il cluster transazionale donna. Dopo il redirect della vecchia /donna/scarponi/ la posizione media è passata da 8,1 a 4,6. Prodotti in evidenza: TRK-W-042, TRK-W-055, TRK-W-063. Alternate EN: nessuna (la pagina EN è per uomo; la pagina donna EN è in backlog)." },
  { id: "landing-pages/it-scarponi-da-trekking-uomo", lang: "it", url: "/scarponi-da-trekking/uomo/", cluster: "keyword-clusters/scarponi-trekking-uomo-transazionale", line: "dolomiti",
    title: "Scarponi da trekking uomo (IT)", h1: "Scarponi da trekking da uomo", titleTag: "Scarponi da Trekking Uomo in Pelle | Alpinaria",
    notes: "Categoria più trafficata del sito. 48 prodotti, filtri colore e taglia (vedi il problema dei parametri indicizzati). Alternate EN: /en/mens-hiking-boots/." },
  { id: "landing-pages/it-scarpe-da-trekking-leggere", lang: "it", url: "/scarpe-da-trekking/leggere/", cluster: "keyword-clusters/scarpe-trekking-leggere", line: "sentiero",
    title: "Scarpe da trekking leggere (IT)", h1: "Scarpe da trekking leggere", titleTag: "Scarpe da Trekking Leggere e Basse | Alpinaria",
    notes: "Linea Sentiero. Testo introduttivo di 80 parole, oggetto dell'esperimento sulla lunghezza. Alternate EN: /en/lightweight-hiking-shoes/." },
  { id: "landing-pages/it-scarpe-da-avvicinamento", lang: "it", url: "/scarpe-da-avvicinamento/", cluster: "keyword-clusters/scarpe-avvicinamento", line: "cresta",
    title: "Scarpe da avvicinamento (IT)", h1: "Scarpe da avvicinamento e da ferrata", titleTag: "Scarpe da Avvicinamento e Ferrata | Alpinaria",
    notes: "Linea Cresta. Intercetta anche il cluster ferrata. Versione inglese della pagina: /en/approach-shoes/ (hreflang ok)." },
  { id: "landing-pages/it-scarponcini-invernali-donna", lang: "it", url: "/scarponcini-invernali/donna/", cluster: "keyword-clusters/scarponcini-invernali-donna", line: "nevaio",
    title: "Scarponcini invernali donna (IT)", h1: "Scarponcini invernali da donna", titleTag: "Scarponcini Invernali Donna Impermeabili | Alpinaria",
    notes: "Linea Nevaio. Stagionale: traffico da novembre a febbraio. Pagina gemella in inglese: /en/womens-winter-hiking-boots/. Prodotti in evidenza: WIN-W-301, WIN-W-305, WIN-W-309." },
  { id: "landing-pages/it-scarpe-trail-running", lang: "it", url: "/trail-running/", cluster: "keyword-clusters/scarpe-trail-running", line: "torrente",
    title: "Scarpe trail running (IT)", h1: "Scarpe da trail running", titleTag: "Scarpe Trail Running Uomo e Donna | Alpinaria",
    notes: "Linea Torrente. Schede prodotto con testo scarso: vedi il finding sui contenuti sottili. Alternate EN: /en/trail-running-shoes/." },
  { id: "landing-pages/it-giacche-impermeabili", lang: "it", url: "/abbigliamento/giacche-impermeabili/", cluster: "keyword-clusters/giacca-impermeabile-montagna", line: "vetta",
    title: "Giacche impermeabili (IT)", h1: "Giacche impermeabili e gusci da montagna", titleTag: "Hardshell Donna e Uomo | Alpinaria",
    notes: "Linea Vetta. Il title usa \"Hardshell\" mentre la query italiana è \"giacca guscio\" / \"giacca impermeabile\": da riscrivere. Alternate EN: /en/hardshell-jackets/." },
  { id: "landing-pages/it-pile", lang: "it", url: "/abbigliamento/pile/", cluster: "keyword-clusters/pile-montagna", line: "bosco",
    title: "Pile (IT)", h1: "Pile e strati intermedi", titleTag: "Pile Uomo e Donna in Poliestere Riciclato | Alpinaria",
    notes: "Linea Bosco. Traffico in calo del 38% rispetto all'anno scorso. Nessuna pagina EN equivalente." },
  { id: "landing-pages/it-calze-merino", lang: "it", url: "/accessori/calze-merino/", cluster: "keyword-clusters/calze-trekking-merino", line: "rifugio",
    title: "Calze merino (IT)", h1: "Calze da trekking in lana merino", titleTag: "Calze da Trekking in Lana Merino | Alpinaria",
    notes: "Linea Rifugio. Pagina piccola (2 SKU: SCK-U-701, SCK-U-705) ma con il miglior tasso di conversione del sito. Alternate EN: /en/merino-hiking-socks/." },
  { id: "landing-pages/it-pantaloni-softshell", lang: "it", url: "/abbigliamento/pantaloni-softshell/", cluster: "keyword-clusters/pantaloni-softshell", line: "passo",
    title: "Pantaloni softshell (IT)", h1: "Pantaloni softshell da montagna", titleTag: "Pantaloni Softshell da Montagna | Alpinaria",
    notes: "Linea Passo. Seconda pagina di Google: servono link interni dalle pagine scarponi." },
  { id: "landing-pages/it-guida-scelta-scarponi", lang: "it", url: "/guide/come-scegliere-scarponi-da-trekking/", cluster: "keyword-clusters/scarponi-trekking-informazionale", line: "dolomiti",
    title: "Guida: come scegliere gli scarponi da trekking (IT)", h1: "Come scegliere gli scarponi da trekking", titleTag: "Come Scegliere gli Scarponi da Trekking: Guida Completa | Alpinaria",
    notes: "Guida informativa, 2.400 parole, aggiornata a marzo 2026. Test FAQ schema concluso senza effetto. Linka la categoria donna e uomo." },
  { id: "landing-pages/it-guida-cura-scarponi", lang: "it", url: "/guide/cura-scarponi-pelle/", cluster: "keyword-clusters/cura-manutenzione-scarponi", line: "dolomiti",
    title: "Guida: cura degli scarponi in pelle (IT)", h1: "Come pulire, ingrassare e impermeabilizzare gli scarponi in pelle", titleTag: "Cura degli Scarponi in Pelle: Pulire e Impermeabilizzare | Alpinaria",
    notes: "Posizione 4 per \"come impermeabilizzare scarponi\". Copre anche le domande sulla membrana e sulla traspirabilità." },
  { id: "landing-pages/it-outlet", lang: "it", url: "/outlet/", cluster: "keyword-clusters/saldi-scarponi", line: null,
    title: "Outlet (IT)", h1: "Outlet Alpinaria", titleTag: "Outlet Scarponi e Abbigliamento da Montagna | Alpinaria",
    notes: "Indicizzata tutto l'anno. Catene di redirect a 3 salti dalle vecchie URL /saldi/ e /promo/: vedi il problema tecnico." },
  { id: "landing-pages/it-scarponi-da-trekking-donna-old", lang: "it", url: "/donna/scarponi/", cluster: "keyword-clusters/scarponi-trekking-donna-transazionale", line: "dolomiti", status: "deprecated",
    title: "Scarponi donna — vecchia URL /donna/scarponi/ (deprecata)", h1: "Scarponi donna", titleTag: "Scarponi Donna | Alpinaria",
    notes: "Vecchia pagina categoria che si cannibalizzava con /scarponi-da-trekking/donna/. Reindirizzata con 301 il 2026-04-02. Conservata solo come storico: non usare come destinazione." },
  { id: "landing-pages/en-womens-winter-hiking-boots", lang: "en", url: "/en/womens-winter-hiking-boots/", cluster: "keyword-clusters/womens-winter-hiking-boots-transactional", line: "nevaio",
    title: "Women's Winter Hiking Boots (EN)", h1: "Women's winter hiking boots", titleTag: "Women's Winter Hiking Boots – Insulated & Waterproof | Alpinaria",
    notes: "English category page for the Nevaio line, targeting the transactional cluster. Featured products: WIN-W-301, WIN-W-305, WIN-W-309. Italian twin: /scarponcini-invernali/donna/. Average position 11.3, impressions peak in December." },
  { id: "landing-pages/en-mens-hiking-boots", lang: "en", url: "/en/mens-hiking-boots/", cluster: "keyword-clusters/mens-hiking-boots-waterproof", line: "dolomiti",
    title: "Men's Hiking Boots (EN)", h1: "Men's hiking boots", titleTag: "Men's Waterproof Hiking Boots Made in Italy | Alpinaria",
    notes: "English category page for the Dolomiti line. Title carries \"Made in Italy\" after the positive experiment. For insulated winter models the Nevaio range currently has no men's English page; a men's winter page is in the backlog. Italian twin: /scarponi-da-trekking/uomo/." },
  { id: "landing-pages/en-lightweight-hiking-shoes", lang: "en", url: "/en/lightweight-hiking-shoes/", cluster: "keyword-clusters/lightweight-hiking-shoes", line: "sentiero",
    title: "Lightweight Hiking Shoes (EN)", h1: "Lightweight hiking shoes", titleTag: "Lightweight Hiking Shoes for Summer Trails | Alpinaria",
    notes: "Sentiero line. Crawl depth 5 from the English home page: see the technical issue." },
  { id: "landing-pages/en-approach-shoes", lang: "en", url: "/en/approach-shoes/", cluster: "keyword-clusters/approach-shoes", line: "cresta",
    title: "Approach Shoes (EN)", h1: "Approach shoes for via ferrata and scrambling", titleTag: "Approach Shoes for Via Ferrata | Alpinaria",
    notes: "Cresta line. Italian twin: /scarpe-da-avvicinamento/. Best EN conversion rate." },
  { id: "landing-pages/en-hardshell-jackets", lang: "en", url: "/en/hardshell-jackets/", cluster: "keyword-clusters/hardshell-jacket", line: "vetta",
    title: "Hardshell Jackets (EN)", h1: "Hardshell jackets", titleTag: "Hardshell Jackets – 3-Layer Waterproof Shells | Alpinaria",
    notes: "Vetta line. Italian twin: /abbigliamento/giacche-impermeabili/." },
  { id: "landing-pages/en-merino-hiking-socks", lang: "en", url: "/en/merino-hiking-socks/", cluster: "keyword-clusters/merino-hiking-socks", line: "rifugio",
    title: "Merino Hiking Socks (EN)", h1: "Merino hiking socks", titleTag: "Italian Merino Hiking Socks | Alpinaria",
    notes: "Rifugio line. Two SKUs. Italian twin: /accessori/calze-merino/." },
  { id: "landing-pages/en-dolomites-packing-guide", lang: "en", url: "/en/guides/what-to-pack-for-the-dolomites/", cluster: "keyword-clusters/dolomites-hiking-gear", line: null,
    title: "Guide: What to pack for the Dolomites (EN)", h1: "What to pack for a hiking trip in the Dolomites", titleTag: "What to Pack for the Dolomites: Hiking Checklist | Alpinaria",
    notes: "Top EN organic entry page. Ranks 3 for the head term; refresh brief scheduled for spring 2027 season." },
  { id: "landing-pages/en-trail-running-shoes", lang: "en", url: "/en/trail-running-shoes/", cluster: "keyword-clusters/trail-running-shoes-eu", line: "torrente",
    title: "Trail Running Shoes (EN)", h1: "Trail running shoes", titleTag: "Trail Running Shoes for Mountain Trails | Alpinaria",
    notes: "Torrente line. Missing self-referencing canonical on product pages below this category." },
  { id: "landing-pages/en-boot-sizing-guide", lang: "en", url: "/en/guides/hiking-boot-sizing/", cluster: "keyword-clusters/boot-sizing-guide-en", line: null,
    title: "Guide: Hiking boot sizing (EN)", h1: "Hiking boot sizing: how should hiking boots fit?", titleTag: "Hiking Boot Sizing Guide | Alpinaria",
    notes: "Supports EN returns reduction. No Italian twin yet." },
  { id: "landing-pages/en-womens-winter-hiking-boots-draft-v2", lang: "en", url: "/en/womens-winter-hiking-boots/", cluster: "keyword-clusters/womens-winter-hiking-boots-transactional", line: "nevaio", status: "draft",
    title: "Women's Winter Hiking Boots — v2 redesign (draft)", h1: "Women's winter hiking boots for snow and ice", titleTag: "Women's Winter Hiking Boots for Snow | Alpinaria",
    notes: "Draft redesign of the English women's winter page, same URL. Adds a comparison table and FAQ. Not live; do not cite as the current page." },
];
PAGES.forEach((p) => {
  const it = p.lang === "it";
  const relations = [rel("targets_cluster", p.cluster)];
  if (p.line) relations.push(rel("promotes_line", `product-lines/${p.line}`));
  const prov = provenance("landing");
  if (p.status) prov.status = p.status;
  if (p.status === "draft") { delete prov.verified; prov.generated = { at: isoAt(2026, 10, 15, 11), by: ACTOR.agent }; }
  cust({
    id: p.id, type: "Landing Page", lang: p.lang,
    title: p.title,
    description: it ? `URL ${p.url} — pagina ${p.url.includes("/guide/") ? "guida" : "categoria"} per il cluster ${p.cluster.split("/")[1]}.` : `URL ${p.url} — ${p.url.includes("/guides/") ? "guide" : "category"} page for cluster ${p.cluster.split("/")[1]}.`,
    tags: ["landing-page", it ? "pagina" : "page", p.lang, p.url.includes("guide") ? "guide" : "category"],
    url: p.url, h1: p.h1, title_tag: p.titleTag,
    ...prov,
    relations,
    body: `# ${p.title}

**URL:** \`${p.url}\` · **H1:** ${p.h1} · **${it ? "Lingua" : "Language"}:** ${p.lang}

**Title tag:** ${p.titleTag}

## ${it ? "Cluster di destinazione" : "Target cluster"}
${mdlink(p.cluster.split("/")[1], p.cluster)}${p.line ? ` · ${it ? "Linea" : "Line"}: ${mdlink(capitalize(p.line), `product-lines/${p.line}`)}` : ""}

## ${it ? "Note" : "Notes"}
${p.notes}
`,
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Competitors (8)
// ---------------------------------------------------------------------------------------------
const COMPETITORS = [
  { id: "competitors/montevia", lang: "it", title: "Montevia", description: "Grande retailer outdoor italiano, primo concorrente organico sugli scarponi da trekking.",
    body: "Montevia è il più grande rivenditore outdoor online in Italia. Non produce ma vende tutti i marchi, con pagine categoria molto profonde e migliaia di recensioni. Domina le SERP transazionali \"scarponi da trekking uomo/donna\" con una share of voice del 31% e ci supera anche sul pile, dove ha accelerato con promozioni continue nell'autunno 2026. Punti deboli: contenuti informativi scarsi, nessuna guida alla cura, tempi di consegna. Dominio: montevia.it." },
  { id: "competitors/rocciaviva", lang: "it", title: "Rocciaviva", description: "Marchio italiano premium di arrampicata e avvicinamento.",
    body: "Rocciaviva è il riferimento italiano per le scarpe da avvicinamento e da ferrata. Prezzi 20% sopra i nostri, community di arrampicatori molto fedele, blog tecnico aggiornato ogni settimana. Domina \"scarpe da avvicinamento\" e \"approach shoes\" in entrambi i mercati. Da osservare il loro configuratore di suola. Dominio: rocciaviva.com." },
  { id: "competitors/nordpasso", lang: "en", title: "NordPasso", description: "German outdoor brand, strongest EN competitor on hardshell and winter boots.",
    body: "NordPasso is a German brand selling across the EU in English and German. Owns the hardshell jacket SERP and ranks 1–3 for women's winter hiking boots and approach shoes in the English market. Excellent hreflang implementation across 11 locales, product pages with 400+ words of unique copy, video on every category. Weakness: no Italian heritage story, no Dolomites content. Domain: nordpasso.com." },
  { id: "competitors/cimalta", lang: "it", title: "Cimalta", description: "Marchio storico di scarponi in pelle di Montebelluna, concorrente diretto sulla linea Dolomiti.",
    body: "Cimalta nasce a Montebelluna come noi e gioca la stessa carta della tradizione e del Made in Italy. Catalogo più piccolo, prezzi simili, sito tecnicamente datato (nessun hreflang, Core Web Vitals pessimi) ma backlink profile molto forte da testate di settore. Davanti a noi su \"scarponi da trekking uomo\". Dominio: cimalta.it." },
  { id: "competitors/trailforge", lang: "en", title: "Trailforge", description: "Trail running specialist, main competitor for the Torrente line.",
    body: "Trailforge is a trail running pure player with a huge athlete programme and race sponsorships (Lavaredo Ultra Trail). They rank top 3 for \"trail running shoes\" in English and Italian and publish shoe reviews weekly. Our Torrente line cannot compete head-on on the head term; the opportunity is long-tail (rocky terrain, via ferrata approach runs) and Dolomites race content. Domain: trailforge.com." },
  { id: "competitors/quota3000", lang: "it", title: "Quota3000", description: "Marketplace italiano di attrezzatura da montagna.",
    body: "Quota3000 è un marketplace multi-brand con listino aggressivo e forte presenza nelle SERP di prezzo (\"scarponi trekking offerta\", \"outlet scarponi\"). Rivende anche Alpinaria: attenzione alla cannibalizzazione delle query di brand con i nostri prodotti venduti a prezzo inferiore. Dominio: quota3000.it." },
  { id: "competitors/piedelibero", lang: "it", title: "PiedeLibero", description: "Marchio lifestyle di sneaker outdoor.",
    body: "PiedeLibero è il leader italiano delle sneaker outdoor lifestyle e il concorrente della linea Baita. Comunicazione fashion, forte su Instagram, SEO debole ma brand search enorme. Dominio: piedelibero.it." },
  { id: "competitors/valtrek", lang: "mixed", title: "Valtrek", description: "Catena di negozi sportivi a basso prezzo / budget sporting goods chain.",
    body: "Valtrek è la catena budget presente in tutta Europa con marchi propri. Prezzi dal 40 al 60% sotto i nostri. Budget chain with own brands, ranks for every generic query in both markets thanks to domain authority; weak on quality signals and on heritage. Non è un concorrente di posizionamento ma intercetta il primo acquisto delle famiglie. Dominio: valtrek.com." },
];
COMPETITORS.forEach((c) => cust(Object.assign({ type: "Competitor", tags: ["competitor", "concorrente", "serp"] }, provenance("competitor"), c, { body: `# ${c.title}\n\n${c.body}\n` })));

// ---------------------------------------------------------------------------------------------
// 7. SEO findings (18)
// ---------------------------------------------------------------------------------------------
const FINDINGS = [
  { id: "seo-findings/cannibalizzazione-scarponi-donna", lang: "it", title: "Cannibalizzazione scarponi donna tra categoria e vecchia URL", description: "Due pagine si alternavano in SERP per \"scarponi da trekking donna\".",
    sources: [SRC.gsc], verified: { by: ACTOR.giulia, at: isoAt(2026, 4, 3) }, stale_after: "2026-09-30",
    relations: [rel("affects_page", "landing-pages/it-scarponi-da-trekking-donna"), rel("affects_page", "landing-pages/it-scarponi-da-trekking-donna-old")],
    body: "Da Search Console (gennaio–marzo 2026) la query \"scarponi da trekking donna\" mostrava in alternanza `/scarponi-da-trekking/donna/` e la vecchia `/donna/scarponi/`, con posizione media complessiva 8,1 e CTR 2,3%. Classico caso di cannibalizzazione: due URL con title quasi identici e stessi prodotti. Risolto con il redirect 301 deciso a marzo; dopo il consolidamento la posizione media è 4,6. Finding chiuso ma utile come precedente per le altre categorie." },
  { id: "seo-findings/core-web-vitals-mobile-2026-01", lang: "en", title: "Core Web Vitals mobile status — January 2026", description: "Superseded snapshot: LCP 3.9 s on mobile product pages, CLS 0.18.",
    sources: [SRC.crux, SRC.psi], stale_after: "2026-04-30", status: "stable",
    relations: [rel("affects_page", "landing-pages/it-scarponi-da-trekking-uomo")],
    body: "CrUX field data, 28-day window ending 2026-01-20. Mobile product pages: LCP 3.9 s (poor), INP 310 ms (poor), CLS 0.18 (needs improvement). Main causes: lazy-loaded hero image, render-blocking CSS, filter widget hydration. Desktop passes. This snapshot is kept for history; see the September 2026 finding for the current state." },
  { id: "seo-findings/core-web-vitals-mobile-2026-09", lang: "en", title: "Core Web Vitals mobile status — September 2026", description: "Current snapshot: LCP 2.4 s after image work; INP 260 ms on category filters still failing.",
    sources: [SRC.crux, SRC.psi], verified: { by: ACTOR.giulia, at: isoAt(2026, 10, 2) }, stale_after: "2027-01-31", status: "stable",
    relations: [rel("supersedes", "seo-findings/core-web-vitals-mobile-2026-01"), rel("affects_page", "landing-pages/it-scarponi-da-trekking-uomo")],
    body: "CrUX field data, 28-day window ending 2026-09-28. Mobile product pages now pass LCP at 2.4 s after removing lazy loading from the hero image and serving AVIF. CLS down to 0.05. INP is still 260 ms on category pages because the colour and size filter widget blocks the main thread on tap; this is the remaining blocker for a full pass. Recommendation: defer filter hydration and split the bundle. Verified against PageSpeed Insights lab runs on 2026-10-02." },
  { id: "seo-findings/hreflang-missing-en-pages", lang: "en", title: "English pages missing hreflang return tags", description: "EN category pages point to IT but IT pages do not point back, so the annotations are ignored.",
    sources: [SRC.crawl], verified: { by: ACTOR.crawl, at: isoAt(2026, 10, 12, 3) }, stale_after: "2027-01-31",
    relations: [rel("affects_page", "landing-pages/en-mens-hiking-boots"), rel("affects_page", "landing-pages/en-hardshell-jackets")],
    body: "The October crawl shows 14 English pages with hreflang annotations pointing to their Italian twins while the Italian pages carry no return tag. Google ignores hreflang pairs without return links, which explains why Italian URLs are shown to German and Dutch users searching in English. Missing return tags on: /en/mens-hiking-boots/, /en/hardshell-jackets/, /en/lightweight-hiking-shoes/, /en/trail-running-shoes/ and 10 product pages. The approach-shoes pair is correct and can be used as the template." },
  { id: "seo-findings/faceted-navigation-index-bloat", lang: "en", title: "Faceted navigation index bloat on EN and IT categories", description: "About 14,000 parameter URLs (?colore=, ?taglia=) are indexed.",
    sources: [SRC.gsc, SRC.crawl], stale_after: "2027-03-31",
    relations: [rel("affects_page", "landing-pages/it-scarponi-da-trekking-uomo")],
    body: "Search Console reports 14,200 indexed URLs carrying ?colore= and ?taglia= parameters, against 1,900 canonical pages. Colour facets duplicate the category with the same title and copy; size facets have no search demand at all. The crawl budget is spent on facets: the median crawl frequency of product pages dropped to once every 9 days. The decision taken in September splits the treatment: canonical tag to the base category for colour, robots disallow for size." },
  { id: "seo-findings/calo-traffico-pile-autunno-2026", lang: "it", title: "Calo del traffico organico sulle pagine pile (autunno 2026)", description: "Sessioni organiche −38% YoY a settembre sulla categoria pile.",
    sources: [SRC.analytics, SRC.gsc], verified: { by: ACTOR.giulia, at: isoAt(2026, 10, 9) }, stale_after: "2027-01-31",
    relations: [rel("affects_page", "landing-pages/it-pile"), rel("related_to", "competitors/montevia")],
    body: "A settembre 2026 le sessioni organiche su `/abbigliamento/pile/` sono calate del 38% rispetto a settembre 2025 e le impression del 21%. Il traffico non è sparito dal mercato: Montevia ha guadagnato le posizioni 1–3 per \"pile uomo\" e \"pile donna\" con promozioni continue e una pagina categoria rinnovata. In parallelo la nostra pagina ha perso i link interni dalle pagine delle giacche durante il redesign di luglio. L'esperimento sui link interni è partito per recuperare." },
  { id: "seo-findings/featured-snippet-impermeabilizzare", lang: "it", title: "Opportunità featured snippet: come impermeabilizzare gli scarponi", description: "La guida alla cura è in posizione 4; lo snippet è vincibile con una lista numerata.",
    sources: [SRC.gsc], stale_after: "2027-03-31",
    relations: [rel("affects_page", "landing-pages/it-guida-cura-scarponi")],
    body: "Per la query \"come impermeabilizzare scarponi\" (1.000 ricerche/mese) la guida alla cura degli scarponi in pelle è in posizione 4. Il featured snippet attuale è una lista di 6 passaggi presa da un blog. La nostra pagina ha i passaggi ma in forma discorsiva. Riscrivere la sezione come lista numerata con H2 che riprende la query, e aggiungere il prodotto impermeabilizzante Alpinaria come passaggio finale." },
  { id: "seo-findings/en-brand-queries-dolomites", lang: "en", title: "English visitors search for Italian hiking boot brands", description: "Rising EN impressions on \"italian hiking boots\" and \"montebelluna boots\".",
    sources: [SRC.gsc], stale_after: "2027-04-30",
    relations: [rel("related_to", "keyword-clusters/italian-hiking-boots-brand"), rel("for_audience", "audiences/eu-english-dolomites-visitors")],
    body: "Impressions for \"italian hiking boots\", \"italian made hiking boots\" and \"montebelluna boots\" grew 64% year on year in the English market, mostly from Germany and the Netherlands. We rank 14–20 with the home page, which is not a good answer. A brand-story page about Montebelluna and the Dolomiti line would fit the commercial intent." },
  { id: "seo-findings/thin-content-product-pages-torrente", lang: "en", title: "Thin content on Torrente product pages", description: "All 12 Torrente product pages have fewer than 60 words of unique copy.",
    sources: [SRC.crawl], verified: { by: ACTOR.crawl, at: isoAt(2026, 10, 12, 3) }, stale_after: "2027-01-31",
    relations: [rel("affects_page", "landing-pages/en-trail-running-shoes"), rel("affects_page", "landing-pages/it-scarpe-trail-running"), rel("related_to", "product-lines/torrente")],
    body: "Crawl word count on the 12 Torrente trail running product pages: median 48 words of unique copy in Italian and 41 in English, the rest is boilerplate. Trailforge averages 380. Thin content correlates with the poor rankings of the line and with the lowest add-to-cart rate in the catalogue. The 120-word minimum decided for product pages applies first to this line; a copy refresh brief exists." },
  { id: "seo-findings/duplicate-category-pages-filters", lang: "it", title: "Pagine categoria duplicate generate dai filtri colore", description: "Le URL con ?colore= hanno title e testo identici alla categoria base e sono indicizzate.",
    sources: [SRC.crawl, SRC.gsc], verified: { by: ACTOR.giulia, at: isoAt(2026, 9, 10) }, stale_after: "2027-01-31",
    relations: [rel("affects_page", "landing-pages/it-scarponi-da-trekking-uomo"), rel("affects_page", "landing-pages/it-scarponi-da-trekking-donna")],
    body: "Ogni pagina categoria genera fino a 8 varianti `?colore=` con lo stesso title, la stessa H1 e lo stesso testo introduttivo: pagine categoria duplicate a tutti gli effetti. Su `/scarponi-da-trekking/uomo/` ne sono indicizzate 7, e due di queste ricevono impression per la query principale al posto della pagina base. Il tema è stato discusso nella riunione del 18 settembre e ha portato alla decisione sul canonical." },
  { id: "seo-findings/immagini-senza-alt", lang: "mixed", title: "Immagini prodotto senza alt text", description: "1,200 product images are missing alt text across both languages.",
    sources: [SRC.crawl], stale_after: "2027-03-31",
    relations: [rel("related_to", "decisions/image-alt-template")],
    body: "The crawl found 1,200 product images (38% of the catalogue) with an empty or missing alt attribute, plus 300 with the file name as alt. Google Images traffic is 2% of organic sessions, well below the 6–8% typical for footwear. Le immagini senza alt sono concentrate nelle schede caricate dal PIM dopo marzo 2026, dove il campo alt non viene popolato. Soluzione proposta: template alt generato dal PIM (decisione approvata)." },
  { id: "seo-findings/backlink-profile-review-2026-q2", lang: "en", title: "Backlink profile review — Q2 2026", description: "Superseded: 1,850 referring domains, 9% toxic, outreach not started.",
    sources: [SRC.ahrefs], stale_after: "2026-08-31",
    relations: [],
    body: "Backlink profile as of 2026-06-15: 1,850 referring domains, DR 41. About 9% of links come from expired-domain networks and should be disavowed. No outreach programme is running. Cimalta has 3,100 referring domains with strong editorial links from mountaineering magazines. This review is superseded by the Q3 review." },
  { id: "seo-findings/backlink-profile-review-2026-q3", lang: "en", title: "Backlink profile review — Q3 2026", description: "Current: 1,980 referring domains after disavow and first outreach wave.",
    sources: [SRC.ahrefs], verified: { by: ACTOR.giulia, at: isoAt(2026, 10, 6) }, stale_after: "2027-01-31",
    relations: [rel("supersedes", "seo-findings/backlink-profile-review-2026-q2")],
    body: "Backlink profile as of 2026-09-30: 1,980 referring domains, DR 43. The disavow file submitted in July removed the expired-domain network. The first outreach wave (Dolomites hut guides, Italian hiking blogs) produced 41 new editorial links, 12 of them to the packing guide. Next wave targets German and Dutch travel blogs in English. The gap to Cimalta narrowed to about 1,000 domains." },
  { id: "seo-findings/sitemap-stale-urls", lang: "en", title: "XML sitemap lists 300 removed URLs", description: "Sitemap still includes URLs returning 410 after the spring catalogue clean-up.",
    sources: [SRC.crawl, SRC.gsc], stale_after: "2027-01-31",
    relations: [],
    body: "The product sitemap lists 300 URLs that return 410 Gone since the April catalogue clean-up, plus 45 URLs that redirect. Search Console flags the sitemap as having errors and crawl stats show Googlebot still requesting the dead URLs weekly. The sitemap generator reads the PIM status field, which is not updated when a product is archived." },
  { id: "seo-findings/competitor-montevia-serp-share", lang: "it", title: "Share of voice Montevia sul cluster scarponi", description: "Montevia occupa il 31% delle posizioni 1–3 sul cluster scarponi da trekking.",
    sources: [SRC.gsc], verified: { by: ACTOR.agent, at: isoAt(2026, 9, 22) }, stale_after: "2026-09-30",
    relations: [rel("related_to", "competitors/montevia"), rel("related_to", "keyword-clusters/scarponi-trekking-uomo-transazionale")],
    body: "Rilevazione di settembre 2026 sulle 40 query del cluster scarponi da trekking (uomo e donna): Montevia è il competitor più forte con il 31% delle posizioni 1–3, seguito da Cimalta (18%) e Quota3000 (12%). Alpinaria è al 9%. Montevia vince grazie a profondità di catalogo e recensioni, non a contenuto editoriale: la nostra leva è la guida alla scelta e la pagina brand." },
  { id: "seo-findings/query-mismatch-giacca-guscio", lang: "it", title: "Query mismatch: gli utenti cercano \"giacca guscio\", la pagina dice \"hardshell\"", description: "Il title della pagina giacche usa solo l'anglicismo.",
    sources: [SRC.gsc], stale_after: "2027-03-31",
    relations: [rel("affects_page", "landing-pages/it-giacche-impermeabili"), rel("related_to", "keyword-clusters/giacca-impermeabile-montagna")],
    body: "Il 71% delle impression della pagina `/abbigliamento/giacche-impermeabili/` arriva da query con \"giacca guscio\" o \"giacca impermeabile\", ma il title e la H1 dicono solo \"Hardshell\". CTR 1,1% contro il 3,4% medio delle categorie. Proposta: title \"Giacche Guscio Impermeabili (Hardshell) | Alpinaria\" e H1 \"Giacche guscio e impermeabili da montagna\", coerente con il tono di voce italiano." },
  { id: "seo-findings/mobile-menu-crawl-depth", lang: "en", title: "English category pages sit at crawl depth 5", description: "EN categories are reachable only through the language switcher and the footer.",
    sources: [SRC.crawl], stale_after: "2027-01-31",
    relations: [rel("affects_page", "landing-pages/en-lightweight-hiking-shoes")],
    body: "The English category pages are five clicks from the Italian home page because the main navigation on /en/ is a reduced version and the language switcher links only the home page. Italian categories are at depth 2. Crawl frequency of EN categories is a third of the Italian ones. Fix: mirror the main navigation on /en/ and switch languages page to page." },
  { id: "seo-findings/redirect-chains-outlet", lang: "en", title: "Redirect chains into /outlet/", description: "Old promo URLs reach /outlet/ in three hops.",
    sources: [SRC.crawl], stale_after: "2027-01-31",
    relations: [rel("affects_page", "landing-pages/it-outlet")],
    body: "Legacy URLs /saldi/, /promo/ and /offerte/ reach /outlet/ through a redirect chain of three hops (http to https, trailing slash, then the final target). 210 external links point to the legacy URLs. Collapse each chain into a single 301 to /outlet/." },
];
FINDINGS.forEach((f) => {
  const prov = provenance("finding");
  cust(Object.assign({ type: "SEO Finding", tags: ["finding", "seo-finding", f.lang] }, prov, f, {
    generated: { at: f.generated_at || prov.generated.at, by: ACTOR.agent },
    body: `# ${f.title}\n\n${f.body}\n`,
  }));
});

// ---------------------------------------------------------------------------------------------
// 8. Decisions (12)
// ---------------------------------------------------------------------------------------------
const DECISIONS = [
  { id: "decisions/canonical-pagine-categoria-duplicate", lang: "it", title: "Decisione: canonical per le pagine categoria duplicate dai filtri colore", description: "Le varianti ?colore= puntano con canonical alla categoria base; i filtri taglia vengono bloccati.",
    sources: [SRC.meeting, conceptSource("finding", "seo-findings/duplicate-category-pages-filters")], generated: { at: isoAt(2026, 9, 18, 16), by: ACTOR.giulia }, verified: { by: ACTOR.marco, at: isoAt(2026, 9, 19, 9) },
    relations: [rel("supersedes", "decisions/noindex-filtri-colore-2026-03"), rel("informed_by", "seo-findings/duplicate-category-pages-filters"), rel("informed_by", "seo-findings/faceted-navigation-index-bloat")],
    body: "**Deciso il 2026-09-18** (riunione con Marco Benedetti). Le pagine categoria duplicate generate dai filtri colore (`?colore=`) ricevono un tag canonical verso la categoria base invece del noindex deciso a marzo; il noindex faceva perdere i link interni e il segnale delle varianti. I filtri taglia (`?taglia=`) non hanno domanda di ricerca e vengono esclusi dalla scansione via robots.txt. Eccezione: se in futuro un colore avrà domanda propria (es. \"scarponi trekking donna rossi\") si valuterà una pagina dedicata con testo unico. Owner: team sviluppo, rilascio entro fine ottobre. Questa decisione sostituisce quella di marzo 2026." },
  { id: "decisions/noindex-filtri-colore-2026-03", lang: "it", title: "Decisione (superata): noindex su tutti i filtri", description: "Marzo 2026: noindex su tutte le URL con parametri. Sostituita a settembre.",
    status: "deprecated", sources: [SRC.meetingOld], generated: { at: isoAt(2026, 3, 5, 15), by: ACTOR.giulia }, verified: { by: ACTOR.giulia, at: isoAt(2026, 3, 6, 10) },
    relations: [],
    body: "**Deciso il 2026-03-05, superato il 2026-09-18.** Tutte le URL con parametri di filtro (colore, taglia, prezzo) ricevevano un meta robots noindex. Dopo sei mesi il numero di URL indicizzate con parametri era sceso solo del 20% e le pagine categoria avevano perso parte dei link interni. Vedi la decisione di settembre sul canonical, che sostituisce questa." },
  { id: "decisions/redirect-vecchia-pagina-donna", lang: "it", title: "Decisione: redirect 301 da /donna/scarponi/ a /scarponi-da-trekking/donna/", description: "Chiude la cannibalizzazione tra le due pagine donna.",
    sources: [SRC.meetingOld, conceptSource("finding", "seo-findings/cannibalizzazione-scarponi-donna")], generated: { at: isoAt(2026, 3, 20, 11), by: ACTOR.giulia }, verified: { by: ACTOR.marco, at: isoAt(2026, 4, 2, 9) },
    relations: [rel("informed_by", "seo-findings/cannibalizzazione-scarponi-donna"), rel("affects_page", "landing-pages/it-scarponi-da-trekking-donna")],
    body: "**Deciso il 2026-03-20, eseguito il 2026-04-02.** La vecchia pagina `/donna/scarponi/` viene reindirizzata con 301 alla categoria `/scarponi-da-trekking/donna/` per risolvere la cannibalizzazione documentata nel finding. La pagina vecchia non viene riaperta per campagne: se serve una landing promozionale si usa un parametro di campagna sulla pagina ufficiale." },
  { id: "decisions/hreflang-implementation-subfolder", lang: "en", title: "Decision: keep /en/ subfolder and implement hreflang it-IT / en with x-default to Italian", description: "No ccTLD or subdomain for the English shop; x-default stays on the Italian version.",
    sources: [SRC.meetingOld], generated: { at: isoAt(2026, 2, 12, 14), by: ACTOR.giulia }, verified: { by: ACTOR.marco, at: isoAt(2026, 2, 14, 9) },
    relations: [rel("related_to", "decisions/en-locale-single-english"), rel("resolves", "technical-issues/hreflang-return-tags-en")],
    body: "**Decided 2026-02-12.** The English shop stays under the `/en/` subfolder of alpinaria.it; no .com migration and no subdomain. hreflang annotations: `it-IT` for Italian pages, `en` (no region) for English pages, `x-default` pointing to the Italian URL because Italy is 70% of revenue. Return tags are mandatory on both sides. The x-default experiment later confirmed this choice. Implementation via the sitemap, not in-page tags, to keep templates simple." },
  { id: "decisions/naming-impermeabile-vs-idrorepellente", lang: "it", title: "Decisione: quando scrivere \"impermeabile\" e quando \"idrorepellente\"", description: "Regola editoriale che applica la policy sui claim di impermeabilità ai title e alle schede.",
    sources: [SRC.meeting, conceptSource("policy", "policies/claim-impermeabile")], generated: { at: isoAt(2026, 5, 8, 10), by: ACTOR.giulia }, verified: { by: ACTOR.elena, at: isoAt(2026, 5, 9, 12) },
    relations: [rel("applies_policy", "policies/claim-impermeabile")],
    body: "**Deciso il 2026-05-08.** Nei title, nelle H1 e nelle schede si scrive \"impermeabile\" solo per i prodotti con membrana AquaStop (linee Dolomiti, Nevaio, Vetta). Per Sentiero, Passo e Baita, che hanno solo il trattamento DWR, si scrive \"idrorepellente\" oppure \"resistente all'acqua\". Vietato \"impermeabile\" nelle keyword dei title delle categorie miste. Il termine inglese corrispondente segue il glossario: waterproof / water-repellent." },
  { id: "decisions/blog-guides-under-guide-folder", lang: "it", title: "Decisione: tutte le guide sotto /guide/ e /en/guides/", description: "Struttura URL unica per i contenuti informativi.",
    sources: [SRC.meetingOld], generated: { at: isoAt(2026, 1, 15, 10), by: ACTOR.giulia },
    relations: [],
    body: "**Deciso il 2026-01-15.** I contenuti informativi (guide alla scelta, alla cura, alle taglie, packing list) vivono sotto `/guide/` in italiano e `/en/guides/` in inglese, mai nel blog né nelle categorie. Le guide linkano la categoria pertinente nel primo paragrafo e nel box finale." },
  { id: "decisions/product-page-copy-minimum-120-words", lang: "en", title: "Decision: minimum 120 words of unique copy on every product page", description: "Applies first to the Torrente line, then to new products at launch.",
    sources: [SRC.meeting, conceptSource("finding", "seo-findings/thin-content-product-pages-torrente")], generated: { at: isoAt(2026, 9, 18, 16), by: ACTOR.giulia }, verified: { by: ACTOR.marco, at: isoAt(2026, 9, 19, 9) },
    relations: [rel("informed_by", "seo-findings/thin-content-product-pages-torrente")],
    body: "**Decided 2026-09-18.** Every product page needs at least 120 words of unique copy per language: terrain, fit, materials, care. Boilerplate (shipping, returns block, size chart) does not count. The Torrente line goes first because of the thin content finding; new products must meet the minimum before publication, enforced by a PIM validation rule. Copy follows the tone of voice documents." },
  { id: "decisions/outlet-page-noindex-off-season", lang: "it", title: "Decisione: la pagina /outlet/ resta indicizzata tutto l'anno", description: "Niente noindex fuori stagione: l'outlet mantiene i ranking tra un periodo di saldi e l'altro.",
    sources: [SRC.meetingOld], generated: { at: isoAt(2026, 2, 26, 11), by: ACTOR.marco },
    relations: [rel("affects_page", "landing-pages/it-outlet")],
    body: "**Deciso il 2026-02-26.** La pagina `/outlet/` resta sempre indicizzabile, anche quando ha pochi prodotti, per non perdere le posizioni su \"outlet scarponi\" e \"scarponi trekking offerta\" tra un periodo di saldi e l'altro. Fuori stagione mostra i fine serie e un modulo per l'avviso saldi." },
  { id: "decisions/image-alt-template", lang: "mixed", title: "Decision: alt text template generated by the PIM", description: "Alt = \"<Modello> <genere> – <categoria> Alpinaria\" / \"<Model> <gender> – <category> Alpinaria\".",
    sources: [SRC.meeting, conceptSource("finding", "seo-findings/immagini-senza-alt")], generated: { at: isoAt(2026, 9, 18, 16), by: ACTOR.giulia }, verified: { by: ACTOR.marco, at: isoAt(2026, 9, 19, 9) },
    relations: [rel("informed_by", "seo-findings/immagini-senza-alt")],
    body: "**Decided 2026-09-18.** The PIM generates alt text for every product image with the template `<Modello> <genere> – <categoria> Alpinaria` in Italian (e.g. \"Dolomiti AquaStop W donna – scarponi da trekking Alpinaria\") and `<Model> <gender> – <category> Alpinaria` in English. Detail shots append the view (\"suola\", \"outsole\"). Manual alt text overrides the template when present. Backfill of the 1,200 images without alt scheduled for November." },
  { id: "decisions/en-locale-single-english", lang: "en", title: "Decision: one English version for all EU markets", description: "No en-GB / en-DE / en-NL split; a single `en` locale.",
    sources: [SRC.meetingOld], generated: { at: isoAt(2026, 2, 12, 14), by: ACTOR.giulia }, verified: { by: ACTOR.marco, at: isoAt(2026, 2, 14, 9) },
    relations: [rel("related_to", "decisions/hreflang-implementation-subfolder")],
    body: "**Decided 2026-02-12.** The English shop serves every EU country from one `en` locale with prices in euro. Country-specific English versions (en-DE, en-NL) would be near-duplicates and split the already small English authority. Shipping information is shown dynamically by IP, not through separate URLs." },
  { id: "decisions/faceted-parameters-robots", lang: "en", title: "Decision: robots disallow for ?taglia=, canonical for ?colore=", description: "Technical counterpart of the duplicate category pages decision.",
    sources: [SRC.meeting, conceptSource("finding", "seo-findings/faceted-navigation-index-bloat")], generated: { at: isoAt(2026, 9, 18, 17), by: ACTOR.giulia }, verified: { by: ACTOR.marco, at: isoAt(2026, 9, 19, 9) },
    relations: [rel("informed_by", "seo-findings/faceted-navigation-index-bloat"), rel("related_to", "decisions/canonical-pagine-categoria-duplicate")],
    body: "**Decided 2026-09-18.** Size facets (`?taglia=`) are disallowed in robots.txt because they have no search demand. Colour facets (`?colore=`) stay crawlable and carry a canonical tag to the base category, so that internal links to colour variants still pass signals. Price and sort parameters are also disallowed. Review after the January crawl." },
  { id: "decisions/trail-running-line-priority-2027", lang: "it", title: "Decisione: la linea Torrente è la priorità editoriale 2027", description: "Budget contenuti 2027 concentrato su trail running (guide, confronti, gare).",
    sources: [SRC.meeting], generated: { at: isoAt(2026, 10, 2, 15), by: ACTOR.marco }, verified: { by: ACTOR.giulia, at: isoAt(2026, 10, 3, 9) },
    relations: [rel("related_to", "product-lines/torrente"), rel("for_audience", "audiences/trail-runner")],
    body: "**Deciso il 2026-10-02.** Il 40% del budget contenuti 2027 va alla linea Torrente: guide alle gare dolomitiche, confronto drop e tasselli, pagine per terreno (roccia, fango). Il segmento trail runner riacquista spesso ed è il più mobile del sito. Le guide in inglese partono prima di quelle italiane perché Trailforge è più debole sulle query di gara in inglese." },
];
DECISIONS.forEach((d) => {
  const prov = provenance("decision");
  cust(Object.assign({ type: "Decision", tags: ["decision", "decisione", d.lang] }, prov, d, { body: `# ${d.title}\n\n${d.body}\n` }));
});

// ---------------------------------------------------------------------------------------------
// 9. Experiments (10)
// ---------------------------------------------------------------------------------------------
const EXPERIMENTS = [
  { id: "experiments/title-tag-prezzo-scarponi-donna", lang: "it", title: "Esperimento: prezzo \"da 149 €\" nel title della categoria scarponi donna", description: "Ipotesi: il prezzo nel title aumenta il CTR. Risultato: +0,8 punti di CTR.",
    hypothesis: "Aggiungere \"da 149 €\" al title aumenta il CTR della categoria scarponi da trekking donna.", result: "positivo", status: "stable",
    verified: { by: ACTOR.giulia, at: isoAt(2026, 6, 20) }, relations: [rel("tests_page", "landing-pages/it-scarponi-da-trekking-donna")],
    body: "**Periodo:** 2026-05-02 → 2026-06-13 (6 settimane, confronto con le 6 precedenti e con la categoria uomo come controllo).\n\n**Ipotesi:** aggiungere il prezzo di partenza al title aumenta il CTR senza perdere posizioni.\n\n**Risultato:** CTR da 3,1% a 3,9% (+0,8 punti), posizione media stabile (4,6 → 4,5), clic +22%. La categoria uomo di controllo è rimasta piatta. Esteso a tutte le categorie calzature a luglio." },
  { id: "experiments/faq-schema-guida-scarponi", lang: "it", title: "Esperimento: FAQ schema sulla guida alla scelta degli scarponi", description: "Ipotesi: il rich result FAQ aumenta il CTR della guida. Risultato: nessun effetto.",
    hypothesis: "Il markup FAQPage porta un rich result e più clic sulla guida.", result: "nullo", status: "stable",
    relations: [rel("tests_page", "landing-pages/it-guida-scelta-scarponi")],
    body: "**Periodo:** 2026-03-10 → 2026-04-20.\n\n**Ipotesi:** aggiungendo FAQPage con 5 domande la guida ottiene il rich result e un CTR maggiore.\n\n**Risultato:** il rich result è comparso per 9 giorni e poi è sparito; CTR invariato (4,2% vs 4,1%). Nessun effetto misurabile. Markup rimosso a maggio per non appesantire la pagina." },
  { id: "experiments/en-title-italian-made", lang: "en", title: "Experiment: \"Made in Italy\" in English category titles", description: "Hypothesis: heritage wording lifts CTR for EU visitors. Result: +1.4 points CTR on allowed lines.",
    hypothesis: "Adding \"Made in Italy\" to English category title tags increases CTR from German and Dutch users.", result: "positive", status: "stable",
    verified: { by: ACTOR.giulia, at: isoAt(2026, 8, 30) }, relations: [rel("tests_page", "landing-pages/en-mens-hiking-boots"), rel("applies_policy", "policies/made-in-italy-claim")],
    body: "**Period:** 2026-06-15 → 2026-08-10, English category pages of the lines where the claim is allowed (Dolomiti, Cresta, Nevaio, Rifugio); Sentiero and Torrente as control (claim not allowed, titles unchanged).\n\n**Hypothesis:** English-speaking EU visitors respond to Italian heritage wording.\n\n**Result:** CTR +1.4 points (2.6% → 4.0%) on the test pages, control flat (+0.1). Position unchanged. The experiment worked; the wording is now permanent on the allowed lines and documented in the Made in Italy policy." },
  { id: "experiments/internal-links-pile-from-giacche", lang: "it", title: "Esperimento: link interni verso la pagina pile dalle pagine giacche", description: "In corso: ripristinare i link interni persi nel redesign per recuperare il traffico del pile.",
    hypothesis: "Ripristinare 6 link interni contestuali dalle pagine giacche e scarponi alla categoria pile recupera posizioni su \"pile uomo\" e \"pile donna\".", result: "in corso", status: "draft", stale_after: "2026-12-31",
    relations: [rel("tests_page", "landing-pages/it-pile"), rel("informed_by", "seo-findings/calo-traffico-pile-autunno-2026")],
    body: "**Periodo:** dal 2026-10-10, lettura prevista il 2026-12-05.\n\n**Ipotesi:** il calo del pile è in parte dovuto alla perdita dei link interni nel redesign di luglio; ripristinandoli (box \"completa il tuo strato\" nelle giacche e negli scarponi) la pagina recupera almeno 3 posizioni.\n\n**Risultato:** in corso. Prima lettura a 4 settimane: impression +9%, posizione da 7,8 a 6,9." },
  { id: "experiments/product-schema-aggregate-rating", lang: "en", title: "Experiment: Product structured data with aggregateRating", description: "Hypothesis: star ratings in SERP lift product page clicks. Result: +12% clicks.",
    hypothesis: "Adding aggregateRating to Product structured data earns review stars and more clicks.", result: "positive", status: "stable",
    verified: { by: ACTOR.giulia, at: isoAt(2026, 5, 28) }, relations: [],
    body: "**Period:** 2026-04-01 → 2026-05-15 on 200 product pages with at least 5 reviews; 200 comparable pages as control.\n\n**Result:** review stars appeared on 84% of test pages within two weeks; clicks +12%, CTR +0.6 points, no position change. Rolled out to the whole catalogue in June." },
  { id: "experiments/lazy-load-hero-image", lang: "en", title: "Experiment: remove lazy loading from the product hero image", description: "Hypothesis: eager hero image improves mobile LCP. Result: LCP −0.9 s.",
    hypothesis: "Loading the first product image eagerly with fetchpriority=high reduces mobile LCP below 2.5 s.", result: "positive", status: "stable",
    verified: { by: ACTOR.crawl, at: isoAt(2026, 7, 15) }, relations: [rel("informed_by", "seo-findings/core-web-vitals-mobile-2026-01")],
    body: "**Period:** 2026-06-01 → 2026-07-10, lab and field measurement.\n\n**Result:** mobile LCP on product pages dropped from 3.6 s to 2.7 s in CrUX (−0.9 s) and under 2.5 s after AVIF was added in August. The CLS improvement came from reserving the image box. One of the two changes behind the September Core Web Vitals snapshot." },
  { id: "experiments/meta-description-emoji", lang: "it", title: "Esperimento (abbandonato): emoji nelle meta description", description: "Interrotto dopo due settimane per incoerenza con il tono di voce.",
    hypothesis: "Un'emoji montagna nella meta description aumenta il CTR.", result: "abbandonato", status: "deprecated", stale_after: "2026-02-28",
    relations: [],
    body: "**Periodo:** 2026-01-12 → 2026-01-26.\n\n**Risultato:** abbandonato. CTR +0,2 punti non significativo; il team brand ha chiesto di interrompere perché l'emoji contrasta con il tono di voce. Non ripetere." },
  { id: "experiments/category-intro-copy-length", lang: "it", title: "Esperimento: testo introduttivo da 300 parole contro 80 nelle categorie", description: "Risultato inconcludente: nessuna differenza misurabile in 8 settimane.",
    hypothesis: "Un testo introduttivo più lungo (300 parole) migliora le posizioni delle categorie calzature.", result: "inconcludente", status: "stable", stale_after: "2026-06-30",
    relations: [rel("tests_page", "landing-pages/it-scarpe-da-trekking-leggere")],
    body: "**Periodo:** 2026-02-15 → 2026-04-12, 4 categorie con testo lungo e 4 con testo breve.\n\n**Risultato:** inconcludente. Posizione media −0,3 nel gruppo test e −0,2 nel controllo, entro il rumore. Il testo lungo ha però ridotto la velocità di scroll ai prodotti su mobile. Decisione: testo breve sopra, approfondimento sotto la griglia." },
  { id: "experiments/hreflang-x-default-en", lang: "en", title: "Experiment: x-default pointing to English instead of Italian", description: "Hypothesis: English x-default helps EU visitors. Result: negative for Italy; reverted.",
    hypothesis: "Setting x-default to the English URL increases English impressions without hurting Italian rankings.", result: "negative", status: "stable",
    verified: { by: ACTOR.giulia, at: isoAt(2026, 4, 25) }, relations: [rel("related_to", "decisions/hreflang-implementation-subfolder")],
    body: "**Period:** 2026-03-15 → 2026-04-20 on 20 category pairs.\n\n**Result:** English impressions +6% but Italian clicks −4% on the test pairs, because unmatched languages (fr, es) were sent to English pages with higher bounce. Reverted; x-default stays on the Italian URL as decided in February." },
  { id: "experiments/outlet-countdown-title", lang: "it", title: "Esperimento: countdown saldi nel title della pagina outlet", description: "In corso fino a fine gennaio: title dinamico con i giorni mancanti ai saldi.",
    hypothesis: "Un title che indica l'inizio dei saldi (\"Saldi dal 5 gennaio\") aumenta il CTR dell'outlet in dicembre.", result: "in corso", status: "draft", stale_after: "2027-01-31",
    relations: [rel("tests_page", "landing-pages/it-outlet")],
    body: "**Periodo:** dal 2026-12-01 al 2027-01-31 (pianificato).\n\n**Ipotesi:** il title dinamico con la data di inizio saldi aumenta il CTR della pagina outlet nel periodo pre-saldi.\n\n**Risultato:** in corso, non ancora partito." },
];
EXPERIMENTS.forEach((e) => {
  const prov = provenance("experiment");
  cust(Object.assign({ type: "Experiment", tags: ["experiment", "esperimento", e.result, e.lang] }, prov, e, { body: `# ${e.title}\n\n${e.body}\n` }));
});

// ---------------------------------------------------------------------------------------------
// 10. Content briefs (12)
// ---------------------------------------------------------------------------------------------
const BRIEFS = [
  { id: "content-briefs/guida-scarponi-invernali-donna", lang: "it", title: "Brief: guida agli scarponi invernali da donna", description: "Guida informativa IT per il cluster scarponcini invernali donna, uscita prevista novembre.",
    status: "draft", relations: [rel("targets_cluster", "keyword-clusters/scarponcini-invernali-donna"), rel("promotes_line", "product-lines/nevaio")],
    body: "**URL prevista:** `/guide/scarponi-invernali-donna/` · **Lunghezza:** 1.800 parole · **Scadenza:** 2026-11-10\n\n**Obiettivo:** intercettare le domande che precedono l'acquisto degli scarponcini invernali da donna (quanto devono essere caldi, imbottitura 200 g o 400 g, suola per ghiaccio, differenza con i doposci) e portare alla categoria.\n\n**Struttura:** H2 per tipo di uso (passeggiate sulla neve, ciaspole, città), tabella temperature/imbottitura, FAQ sulla taglia con calze spesse, box prodotto per WIN-W-301, WIN-W-305 e WIN-W-309.\n\n**Vincoli:** \"impermeabile\" consentito (membrana AquaStop); niente claim \"caldo fino a −30°\" senza test." },
  { id: "content-briefs/en-how-to-choose-winter-hiking-boots", lang: "en", title: "Brief: How to choose winter hiking boots", description: "English guide for the informational winter boots cluster; supports the transactional women's page.",
    status: "draft", relations: [rel("targets_cluster", "keyword-clusters/womens-winter-hiking-boots-informational"), rel("promotes_line", "product-lines/nevaio")],
    body: "**Planned URL:** `/en/guides/how-to-choose-winter-hiking-boots/` · **Length:** 1,600 words · **Due:** 2026-11-20\n\n**Goal:** answer the informational cluster (how to choose winter hiking boots, are hiking boots warm enough for snow, winter hiking boots vs snow boots) and link to the women's winter hiking boots page.\n\n**Outline:** insulation grams explained, membrane vs water-repellent, outsole for ice, sizing with thick socks, when snowshoes change the choice. Product boxes for WIN-W-305 and WIN-M-305. British spelling, tone of voice EN." },
  { id: "content-briefs/en-what-to-pack-dolomites", lang: "en", title: "Brief: refresh of \"What to pack for the Dolomites\"", description: "Refresh the top EN guide before the 2027 season; add hut-to-hut section and winter variant.",
    status: "stable", relations: [rel("targets_cluster", "keyword-clusters/dolomites-hiking-gear"), rel("refreshes_page", "landing-pages/en-dolomites-packing-guide")],
    body: "**URL:** `/en/guides/what-to-pack-for-the-dolomites/` (existing) · **Due:** 2027-02-15\n\n**Goal:** keep position 3 and win the featured snippet with a scannable checklist. Add a hut-to-hut (Alta Via 1) section, a winter/snowshoe variant and a downloadable checklist. Update links to Dolomiti, Vetta and Rifugio categories. Keep the author box (guide Elisa Dalla Costa) for E-E-A-T." },
  { id: "content-briefs/guida-impermeabilizzare-scarponi", lang: "it", title: "Brief: come impermeabilizzare gli scarponi in pelle (riscrittura per lo snippet)", description: "Riscrittura della sezione della guida alla cura per vincere il featured snippet.",
    status: "stable", relations: [rel("targets_cluster", "keyword-clusters/cura-manutenzione-scarponi"), rel("refreshes_page", "landing-pages/it-guida-cura-scarponi"), rel("informed_by", "seo-findings/featured-snippet-impermeabilizzare")],
    body: "**URL:** `/guide/cura-scarponi-pelle/` (sezione esistente) · **Scadenza:** 2026-11-05\n\n**Obiettivo:** featured snippet per \"come impermeabilizzare scarponi\". Riscrivere la sezione come lista numerata di 6 passaggi (pulire, asciugare, applicare l'impermeabilizzante, lasciare agire, rimuovere l'eccesso, ripetere ogni 10 uscite) sotto una H2 che riprende la query. Aggiungere il video da 40 secondi. Linkare la membrana AquaStop solo come spiegazione, senza claim." },
  { id: "content-briefs/guida-taglie-scarponi", lang: "it", title: "Brief: guida alle taglie degli scarponi da trekking", description: "Nuova guida IT per il cluster taglia/numero; obiettivo ridurre i resi.",
    status: "draft", relations: [rel("targets_cluster", "keyword-clusters/misura-scarponi-trekking")],
    body: "**URL prevista:** `/guide/taglie-scarponi-trekking/` · **Lunghezza:** 1.200 parole · **Scadenza:** 2026-12-01\n\n**Obiettivo:** rispondere a \"scarponi trekking che numero prendere\" e \"scarponi un numero in più\" e ridurre i resi per taglia (oggi il 31% dei resi). Tabella di conversione EU/UK/US, test del pollice, consiglio per calze spesse, differenze tra le linee (Dolomiti veste regolare, Cresta più stretta). Versione inglese già esistente: /en/guides/hiking-boot-sizing/." },
  { id: "content-briefs/en-approach-vs-hiking-shoes", lang: "en", title: "Brief: Approach shoes vs hiking shoes", description: "Comparison article for the EN approach cluster.",
    status: "stable", relations: [rel("targets_cluster", "keyword-clusters/approach-shoes"), rel("promotes_line", "product-lines/cresta")],
    body: "**Planned URL:** `/en/guides/approach-shoes-vs-hiking-shoes/` · **Length:** 1,400 words · **Due:** 2027-01-20\n\n**Goal:** rank for \"approach shoes vs hiking shoes\" and \"scrambling shoes\", feed the approach shoes category. Comparison table (sole stiffness, climbing zone, weight, use on via ferrata), when to pick each, Cresta Grip and Cresta Ferrata boxes." },
  { id: "content-briefs/pile-vs-softshell", lang: "it", title: "Brief: pile o softshell? Guida alla scelta dello strato intermedio", description: "Articolo di confronto IT che sostiene le categorie pile e pantaloni softshell.",
    status: "draft", relations: [rel("targets_cluster", "keyword-clusters/pile-montagna"), rel("promotes_line", "product-lines/bosco")],
    body: "**URL prevista:** `/guide/pile-o-softshell/` · **Lunghezza:** 1.300 parole · **Scadenza:** 2026-11-25\n\n**Obiettivo:** contenuto informativo a sostegno della categoria pile in calo; spiegare quando serve il pile, quando il softshell, quando entrambi sotto il guscio. Linkare le categorie pile e pantaloni softshell e la giacca Vetta. Includere il pile riciclato Bosco (70% GRS) rispettando la policy sui claim ambientali." },
  { id: "content-briefs/en-merino-socks-benefits", lang: "en", title: "Brief: Why merino hiking socks prevent blisters", description: "Short EN article for the merino socks cluster.",
    status: "stable", relations: [rel("targets_cluster", "keyword-clusters/merino-hiking-socks"), rel("promotes_line", "product-lines/rifugio")],
    body: "**Planned URL:** `/en/guides/merino-hiking-socks-blisters/` · **Length:** 900 words · **Due:** 2026-12-10\n\n**Goal:** rank for \"best hiking socks blisters\" and \"merino wool hiking socks\", push SCK-U-701 and SCK-U-705. No medical claims (see policy): say \"reduce friction\", never \"prevent injuries\"." },
  { id: "content-briefs/torrente-product-copy-refresh", lang: "mixed", title: "Brief: riscrittura schede prodotto Torrente / Torrente product copy refresh", description: "12 schede IT + EN portate ad almeno 120 parole uniche.",
    status: "draft", relations: [rel("promotes_line", "product-lines/torrente"), rel("informed_by", "seo-findings/thin-content-product-pages-torrente")],
    body: "**Ambito:** le 12 schede della linea Torrente (TRL-W-401, TRL-M-401, TRL-W-404, TRL-M-404, TRL-W-410, TRL-M-410 in IT e EN). **Scadenza:** 2026-11-15.\n\n**Obiettivo:** almeno 120 parole uniche per lingua, come da decisione: terreno (roccia, fango), drop, tasselli, peso, calzata, confronto tra Rapido e Fango. Scope: each of the 12 Torrente product pages gets 120+ unique words per language, written by the trail runner persona, no \"fastest shoe\" superlatives." },
  { id: "content-briefs/guida-vie-ferrate-scarpe", lang: "it", title: "Brief: che scarpe usare in via ferrata", description: "Guida IT per il cluster scarpe da ferrata, linea Cresta.",
    status: "stable", relations: [rel("targets_cluster", "keyword-clusters/vie-ferrate-scarpe"), rel("promotes_line", "product-lines/cresta")],
    body: "**URL prevista:** `/guide/scarpe-da-ferrata/` · **Lunghezza:** 1.500 parole · **Scadenza:** 2027-03-01\n\n**Obiettivo:** intercettare i principianti che cercano \"scarpe da ferrata\" e portarli alla categoria avvicinamento. Spiegare suola, rigidità, protezione della punta; quando bastano gli scarponi Dolomiti e quando serve Cresta Ferrata. Autore: guida alpina partner per E-E-A-T." },
  { id: "content-briefs/en-italian-hiking-boots-brands-history", lang: "en", title: "Brief: Montebelluna and the Italian hiking boot tradition", description: "Brand story page for the EN commercial cluster on Italian hiking boots.",
    status: "draft", relations: [rel("targets_cluster", "keyword-clusters/italian-hiking-boots-brand"), rel("informed_by", "seo-findings/en-brand-queries-dolomites")],
    body: "**Planned URL:** `/en/montebelluna-italian-hiking-boots/` · **Length:** 1,200 words · **Due:** 2027-01-15\n\n**Goal:** rank for \"italian hiking boots\" and \"montebelluna boots\" with a page that is commercial, not a blog post: history of the Montebelluna district, how Dolomiti boots are made, the lines that can claim Made in Italy (policy), links to the men's and women's categories." },
  { id: "content-briefs/calendario-contenuti-inverno-2026", lang: "it", title: "Calendario contenuti inverno 2026/27", description: "Piano editoriale novembre–febbraio: guide, novità di stagione, refresh.",
    status: "stable", relations: [rel("related_to", "decisions/trail-running-line-priority-2027")],
    body: "**Novembre 2026:** guida scarponi invernali donna; riscrittura snippet impermeabilizzare; novità di stagione Nevaio (WIN-W-309 Polar). **Dicembre:** guida taglie scarponi; merino socks EN; countdown saldi outlet. **Gennaio 2027:** Montebelluna brand page EN; approach vs hiking EN; refresh packing guide. **Febbraio:** prime guide trail running EN (priorità 2027), pile o softshell. Le novità di prodotto si pubblicano il martedì, le guide il giovedì." },
];
BRIEFS.forEach((b) => {
  const prov = provenance("brief");
  cust(Object.assign({ type: "Content Brief", tags: ["content-brief", "brief", b.lang] }, prov, b, { body: `# ${b.title}\n\n${b.body}\n` }));
});

// ---------------------------------------------------------------------------------------------
// 11. Technical issues (10)
// ---------------------------------------------------------------------------------------------
const ISSUES = [
  { id: "technical-issues/hreflang-return-tags-en", lang: "en", title: "hreflang return tags missing on Italian pages", description: "Open — 14 EN/IT pairs without return tags.", severity: "high", state: "open",
    relations: [rel("documented_in", "seo-findings/hreflang-missing-en-pages")],
    body: "**Severity:** high · **State:** open · **Owner:** dev team\n\nItalian category and product pages do not emit the `en` alternate in the sitemap, so the EN→IT annotation has no return tag and the pair is invalid. Fix in the sitemap generator: emit both directions for every pair in the translation table. Test with the approach-shoes pair, which is already correct." },
  { id: "technical-issues/parametri-filtri-indicizzati", lang: "it", title: "URL con parametri ?colore= e ?taglia= indicizzate", description: "Aperto — circa 14.000 URL con parametri nell'indice.", severity: "high", state: "open",
    relations: [rel("documented_in", "seo-findings/faceted-navigation-index-bloat"), rel("resolved_by", "decisions/faceted-parameters-robots")],
    body: "**Gravità:** alta · **Stato:** aperto, fix in rilascio · **Owner:** sviluppo\n\nI filtri di categoria generano URL con parametri `?colore=` e `?taglia=` indicizzabili. Implementare: canonical alla categoria base sulle varianti colore, disallow in robots.txt per `?taglia=`, `?prezzo=` e `?ordina=`. Verificare che i link interni ai filtri non usino nofollow." },
  { id: "technical-issues/lcp-immagini-prodotto-mobile", lang: "it", title: "LCP alto sulle immagini prodotto da mobile", description: "Risolto in parte — LCP da 3,9 s a 2,4 s; resta il lavoro sui template meno usati.", severity: "medium", state: "in-progress",
    relations: [rel("documented_in", "seo-findings/core-web-vitals-mobile-2026-09")],
    body: "**Gravità:** media · **Stato:** in corso · **Owner:** frontend\n\nL'immagine principale delle schede prodotto era caricata in lazy loading e in JPEG pesante. Dopo il caricamento eager con fetchpriority e il formato AVIF, l'LCP mobile è passato da 3,9 s a 2,4 s. Restano da sistemare i template outlet e guide, ancora sopra i 3 s." },
  { id: "technical-issues/inp-filtri-plp", lang: "en", title: "INP 260 ms on category filter widget", description: "Open — filter widget blocks the main thread on tap.", severity: "medium", state: "open",
    relations: [rel("documented_in", "seo-findings/core-web-vitals-mobile-2026-09")],
    body: "**Severity:** medium · **State:** open · **Owner:** frontend\n\nTapping a colour or size filter on category pages triggers a 260 ms long task (hydration of the whole filter tree plus a synchronous price recalculation). Defer hydration until the first interaction, debounce the price recalculation, split the vendor bundle. Target: INP under 200 ms on mobile." },
  { id: "technical-issues/sitemap-410-urls", lang: "en", title: "Sitemap generator includes archived products", description: "Open — 300 URLs returning 410 still listed.", severity: "low", state: "open",
    relations: [rel("documented_in", "seo-findings/sitemap-stale-urls")],
    body: "**Severity:** low · **State:** open · **Owner:** backend\n\nThe sitemap job reads the PIM `status` field but archived products keep status `active` with an `archived_at` date. Add the date check, regenerate daily, and drop redirecting URLs." },
  { id: "technical-issues/redirect-chains-outlet", lang: "en", title: "Redirect chain /saldi/ → /promo/ → /outlet/", description: "Open — three-hop redirect chain into the outlet page.", severity: "low", state: "open",
    relations: [rel("documented_in", "seo-findings/redirect-chains-outlet"), rel("affects_page", "landing-pages/it-outlet")],
    body: "**Severity:** low · **State:** open · **Owner:** dev team\n\nLegacy promo URLs go through http→https, then /saldi/→/promo/, then /promo/→/outlet/. Collapse to a single 301 from each legacy URL straight to https://www.alpinaria.it/outlet/. 210 external links depend on it." },
  { id: "technical-issues/alt-text-mancanti", lang: "it", title: "Alt text mancanti sulle immagini caricate dal PIM", description: "Aperto — il campo alt non viene popolato dall'export PIM dopo marzo 2026.", severity: "medium", state: "open",
    relations: [rel("documented_in", "seo-findings/immagini-senza-alt"), rel("resolved_by", "decisions/image-alt-template")],
    body: "**Gravità:** media · **Stato:** aperto · **Owner:** PIM team\n\nDall'export PIM di marzo 2026 il campo alt delle immagini prodotto arriva vuoto. Implementare il template deciso a settembre e rilanciare il backfill sulle 1.200 immagini senza alt." },
  { id: "technical-issues/en-pages-crawl-depth", lang: "en", title: "English category pages at crawl depth 5", description: "Open — navigation on /en/ is reduced and the language switcher links only the home page.", severity: "medium", state: "open",
    relations: [rel("documented_in", "seo-findings/mobile-menu-crawl-depth")],
    body: "**Severity:** medium · **State:** open · **Owner:** frontend\n\nMirror the full main navigation on /en/ and make the language switcher link the equivalent page (translation table already exists for hreflang). Expected: EN categories at depth 2." },
  { id: "technical-issues/canonical-self-reference-missing-en", lang: "en", title: "Self-referencing canonical missing on English product pages", description: "Open — EN product pages have no canonical tag at all.", severity: "medium", state: "open",
    relations: [rel("affects_page", "landing-pages/en-trail-running-shoes")],
    body: "**Severity:** medium · **State:** open · **Owner:** dev team\n\nThe English product template omits the canonical link element, so parameter and tracking variants of EN product URLs get indexed separately. Add a self-referencing canonical to the EN product template, matching the Italian one." },
  { id: "technical-issues/robots-blocked-css", lang: "en", title: "robots.txt blocked /static/css/ (resolved)", description: "Resolved in May 2026 — kept for history.", severity: "high", state: "resolved", status: "deprecated",
    relations: [],
    body: "**Severity:** high · **State:** resolved 2026-05-04\n\nA robots.txt rule from the old CMS blocked /static/css/ and /static/js/, so Googlebot rendered pages without styles and flagged mobile usability errors. Rule removed; mobile usability errors cleared within three weeks." },
];
ISSUES.forEach((i) => {
  const prov = provenance("issue");
  if (i.status === "deprecated") { prov.stale_after = "2026-06-30"; }
  cust(Object.assign({ type: "Technical Issue", tags: ["technical-issue", "tech", i.severity, i.state, i.lang] }, prov, i, { body: `# ${i.title}\n\n${i.body}\n` }));
});

// ---------------------------------------------------------------------------------------------
// 12. Policies (5)
// ---------------------------------------------------------------------------------------------
const POLICIES = [
  { id: "policies/claim-impermeabile", lang: "it", title: "Policy claim: impermeabilità", description: "Quando è consentito dichiarare \"impermeabile\" e con quali prove; cosa è vietato.",
    body: "## Consentito\n- \"Impermeabile\" solo per i prodotti con membrana AquaStop e test di colonna d'acqua ≥ 10.000 mm (scarponi Dolomiti e Nevaio) o ≥ 20.000 mm (giacche Vetta). Il valore va riportato nella scheda.\n- \"Idrorepellente\" o \"resistente all'acqua\" per i prodotti con solo trattamento DWR (Sentiero, Passo, Baita).\n- \"Impermeabilità e traspirabilità certificate\" se il report di laboratorio è allegato nel PIM.\n\n## Vietato\n- \"100% impermeabile\", \"impermeabile a vita\", \"impermeabile per sempre\".\n- \"Impermeabile\" per scarponi in pelle senza membrana, anche se ingrassati.\n- Promettere l'impermeabilità dopo riparazioni o risuolature.\n\n## Perché\nReclami 2025 sull'impermeabilità degli scarponi: 140 casi, di cui 90 su prodotti senza membrana descritti come \"impermeabili\" dai rivenditori. La regola vale per title, meta description, schede, annunci e marketplace. Vedi la decisione editoriale impermeabile/idrorepellente." },
  { id: "policies/green-claims", lang: "mixed", title: "Policy claim: sostenibilità e materiali riciclati / green claims", description: "Claim ambientali consentiti solo con percentuale e certificato; vietati i termini generici.",
    body: "## Consentito / Allowed\n- \"Poliestere riciclato al 70%\" / \"70% recycled polyester\" quando il certificato GRS è nel PIM e la percentuale è esatta.\n- \"Risuolabile\" / \"resoleable\" per Dolomiti e Cresta (servizio attivo).\n- \"Lana merino mulesing-free\" con dichiarazione del fornitore.\n\n## Vietato / Forbidden\n- \"Eco-friendly\", \"green\", \"sostenibile\" senza specifica, \"amico dell'ambiente\".\n- \"Carbon neutral\", \"a impatto zero\" senza certificazione di terza parte.\n- Percentuali di riciclato arrotondate per eccesso.\n\n## Base normativa\nDirettiva UE sui green claims e linee guida AGCM 2026 sulla pubblicità ambientale. La sostenibilità si racconta con numeri verificabili. The same rules apply to English copy, product feeds and marketplace listings." },
  { id: "policies/made-in-italy-claim", lang: "en", title: "Policy claim: Made in Italy", description: "Which lines may say \"Made in Italy\" and which must say \"Designed in Italy\".",
    body: "## Allowed\n- \"Made in Italy\" for products assembled in Montebelluna: Dolomiti, Cresta, Nevaio boots and Rifugio merino socks and base layers.\n- \"Designed in Italy\" / \"Disegnato in Italia\" for Sentiero, Torrente, Vetta, Bosco, Passo and Baita, which are produced in Vietnam and Romania on Italian designs.\n\n## Forbidden\n- \"Made in Italy\", \"Italian made\" or the Italian flag on any product of the second group, in titles, copy, feeds or ads.\n- \"Handmade\" unless the product is in the heritage range.\n\n## Notes\nThe English title experiment showed a strong CTR effect of \"Made in Italy\"; the temptation to extend it to other lines is explicitly rejected. Legal basis: Italian law 166/2009 and the EU origin marking rules. Checked by legal on every category title change." },
  { id: "policies/medical-health-claims", lang: "en", title: "Policy claim: medical and health claims", description: "No orthopaedic, therapeutic or injury-prevention claims in any language.",
    body: "## Forbidden\n- \"Prevents injuries\", \"cures plantar fasciitis\", \"orthopaedic\", \"corrects pronation\", \"recommended by physiotherapists\".\n- Any wording that implies a medical device or a therapeutic effect, in Italian or English, including customer review excerpts selected for the page.\n\n## Allowed\n- Comfort and fit statements: \"reduces friction\", \"supports the ankle\", \"cushioned midsole\".\n- Material facts: \"merino wool regulates temperature\".\n\n## Why\nEU medical device regulation and consumer law; two complaints in 2025 about \"anti-blister\" wording on socks. Applies to briefs, product copy, structured data and ads." },
  { id: "policies/price-promo-claims", lang: "it", title: "Policy claim: prezzi, sconti e promozioni", description: "Prezzi barrati solo con il prezzo più basso dei 30 giorni precedenti (direttiva Omnibus).",
    body: "## Regole\n- Il prezzo barrato è sempre il prezzo più basso applicato nei 30 giorni precedenti, non il listino.\n- \"Da 149 €\" nei title è consentito solo se almeno un prodotto della categoria è a quel prezzo in quel momento (controllo automatico settimanale).\n- Le percentuali di sconto si scrivono sul prezzo barrato corretto.\n- Vietato \"prezzo più basso garantito\", \"sottocosto\" senza i requisiti di legge, \"ultimi pezzi\" se la giacenza supera 20 unità.\n\n## Ambito\nPagine categoria, outlet, schede, feed e annunci. Base normativa: direttiva Omnibus recepita nel Codice del Consumo (art. 17-bis) e indicazioni AGCM." },
];
POLICIES.forEach((p) => {
  const prov = provenance("policy");
  cust(Object.assign({ type: "Policy", tags: ["policy", "claim", "compliance", p.lang] }, prov, p, { body: `# ${p.title}\n\n${p.body}\n` }));
});

// ---------------------------------------------------------------------------------------------
// 13. Shared playbook bundle (20)
// ---------------------------------------------------------------------------------------------
const PLAY = [
  ["guidelines/search-intent-taxonomy", "Definition", "Search intent taxonomy", "Informational, navigational, commercial, transactional: how the agency labels keyword clusters.",
    "Every keyword cluster carries exactly one intent label. Informational: the user wants to learn (how to, what is, guide). Navigational: the user wants a specific site or brand. Commercial: the user compares before buying (best, vs, review). Transactional: the user wants to buy now (buy, price, near me, product + gender). Two clusters with the same head terms but different modifiers are kept separate when the SERP differs; the SERP, not the keyword, decides the intent. One page targets one intent."],
  ["guidelines/hreflang-checklist", "Checklist", "hreflang checklist", "Twelve checks before signing off an international implementation.",
    "1. Every page lists itself. 2. Every annotation has a return tag. 3. Language codes are ISO 639-1, regions ISO 3166-1 Alpha 2. 4. x-default points to the global or default-language page. 5. Canonical and hreflang URLs are identical. 6. No annotations on noindex pages. 7. Implemented in one place only (HTML head, HTTP header or sitemap). 8. Pairs validated after each release with a crawler. 9. Translated pages are real translations, not near-duplicates. 10. Language switcher links page to page. 11. Internal links stay within the language. 12. Monitor Search Console international targeting for 'no return tag' errors."],
  ["guidelines/canonicalization-rules", "Guideline", "Canonicalization rules", "When to use canonical tags, noindex, robots or parameter handling.",
    "Canonical when the duplicate must keep passing signals to a preferred version (colour facets, tracking parameters, pagination to view-all when it exists). Noindex when the page must exist for users but should never rank and has no inbound equity worth keeping. Robots disallow when the URLs waste crawl budget and have no search demand (size facets, sort orders, internal search). Never combine noindex with disallow. Canonical is a hint, not a directive: keep titles, copy and internal links consistent with it."],
  ["guidelines/core-web-vitals-thresholds", "Threshold", "Core Web Vitals thresholds", "Good / needs improvement / poor thresholds used in all client reporting.",
    "LCP: good up to 2.5 s, needs improvement up to 4.0 s, poor above. INP: good up to 200 ms, needs improvement up to 500 ms, poor above. CLS: good up to 0.1, needs improvement up to 0.25, poor above. All thresholds are evaluated at the 75th percentile of CrUX field data over 28 days, mobile and desktop separately. Lab tools (PageSpeed Insights, Lighthouse) are used to diagnose, never to report pass or fail."],
  ["guidelines/title-tag-length", "Guideline", "Title tag length and structure", "50–60 characters, primary keyword first, brand last.",
    "Keep title tags between 50 and 60 characters (roughly 580 pixels) so they are not truncated on mobile. Primary keyword at the start, modifier (gender, price, material) in the middle, brand at the end after a pipe. One title per intent; never stuff two clusters. Prices or dates in titles are allowed only when automatically kept accurate. Test title changes for at least four weeks with a control group."],
  ["guidelines/internal-linking", "Guideline", "Internal linking rules", "Contextual links, depth, anchors, and the 'complete the layer' pattern for apparel.",
    "Every category page must be reachable within three clicks from the home page in its language. Contextual links from guides to categories go in the first paragraph and in a closing box. Anchor text uses the target cluster's head term, varied across pages. Cross-sell boxes ('complete the layer': shell → fleece → base layer) count as internal links and must not be loaded client-side only. Audit lost internal links after every redesign."],
  ["guidelines/faceted-navigation", "Guideline", "Faceted navigation handling", "Decision tree for filters: index, canonical, disallow.",
    "For each facet ask: is there search demand for the facet value combined with the category? If yes and the page can carry unique copy, make it an indexable landing page with a clean URL. If there is demand but no unique copy, canonical to the category. If there is no demand, disallow the parameter in robots.txt. Never let more than two facets combine in an indexable URL. Review quarterly with Search Console impressions by parameter."],
  ["guidelines/keyword-cannibalization", "Definition", "Keyword cannibalization", "Definition, detection and the standard fixes.",
    "Keyword cannibalization: two or more URLs of the same site alternate or compete in the SERP for the same query, splitting clicks and signals. Detect it in Search Console by exporting query/page pairs and flagging queries with more than one page above 5% of impressions over 28 days. Standard fixes in order of preference: consolidate with a 301, differentiate intent and copy, canonical, de-optimise the weaker page. Always re-check four weeks after the fix."],
  ["guidelines/product-structured-data", "Guideline", "Product structured data", "Required and recommended properties for Product and Offer markup.",
    "Required: name, image, offers.price, offers.priceCurrency, offers.availability, sku. Recommended: brand, gtin, aggregateRating with reviewCount, review, material, color, size via hasVariant (merchant listings). aggregateRating only from genuine on-site reviews. Validate with the Rich Results Test on every template release. Variant pages share a productGroupID."],
  ["guidelines/image-alt-text", "Guideline", "Image alt text", "Descriptive, specific, generated from product data where manual alt is missing.",
    "Alt text describes the image for a person who cannot see it: model, gender, category, view. Keep it under 125 characters, no keyword stuffing, no 'image of'. For catalogues, generate alt from product data (model, gender, category, brand) and allow manual overrides. Decorative images get an empty alt. Measure the effect through Google Images clicks in Search Console."],
  ["guidelines/pagination", "Guideline", "Pagination for category pages", "Self-canonical paginated pages, crawlable links, no view-all unless small.",
    "Paginated category pages (?page=2) keep a self-referencing canonical and remain indexable with crawlable <a> links to the previous and next page. Do not canonical page 2+ to page 1. Infinite scroll must have paginated URLs behind it. Only use a view-all page when the category has fewer than 100 products."],
  ["guidelines/redirect-hygiene", "Guideline", "Redirect hygiene", "Single-hop 301s, chain audits, redirect map ownership.",
    "Every redirect is a single 301 straight to the final URL. Audit chains and loops after each migration and quarterly. Redirects are kept in a versioned map owned by SEO, not scattered in CMS plugins. Legacy URLs with external links are never allowed to 404 or 410; removed products redirect to the closest category only when the category is genuinely relevant, otherwise return 410."],
  ["guidelines/content-refresh-cadence", "Guideline", "Content refresh cadence", "When evergreen guides are reviewed and what counts as a refresh.",
    "Evergreen guides are reviewed every 12 months or when impressions drop more than 20% quarter on quarter, whichever comes first. A refresh updates facts, adds a section the SERP now expects, renews internal links and republishes with an updated date only when the content changed materially. Seasonal guides are refreshed six weeks before the season."],
  ["guidelines/international-seo-structure", "Guideline", "International site structure", "ccTLD vs subfolder vs subdomain and when each is chosen.",
    "Subfolders (/en/) are the default for brands with one primary market and smaller secondary markets: they share authority and are cheapest to maintain. ccTLDs only when the secondary market needs local payment, legal entity and marketing, and has the authority to stand alone. Subdomains are avoided. One language version per language unless legal or pricing differences require country versions."],
  ["guidelines/robots-txt-rules", "Guideline", "robots.txt rules", "What may and may not be blocked.",
    "Never block CSS, JavaScript or image paths needed to render pages. Block internal search, cart, checkout, account, and facet parameters with no demand. Do not use robots.txt to remove indexed URLs: a blocked URL stays indexed without a snippet. Test every change in the Search Console robots tester before deploying."],
  ["guidelines/xml-sitemap-hygiene", "Guideline", "XML sitemap hygiene", "Only canonical, indexable, 200 URLs; regenerate daily.",
    "Sitemaps contain only canonical URLs that return 200, are indexable and that we want ranked. No redirects, no 404/410, no noindex pages. Regenerate daily from the live catalogue, split by type (products, categories, guides) under 50,000 URLs each, include lastmod only when accurate, and include hreflang alternates when the implementation is sitemap-based."],
  ["guidelines/eeat-for-ecommerce", "Guideline", "E-E-A-T for e-commerce content", "Author boxes, first-hand testing, sources and transparency on guides.",
    "Guides carry a named author with a bio and real experience (a mountain guide, a product developer). First-hand testing is described with specifics (where, how long, conditions). Claims about materials link to certificates or the brand's policies. Product reviews are genuine and moderated. About, contact and returns information are one click away from every guide."],
  ["guidelines/experiment-protocol", "Guideline", "SEO experiment protocol", "Hypothesis, control group, minimum duration, how results are recorded.",
    "Every experiment has a written hypothesis with the expected metric and direction, a control group of comparable pages, a minimum duration of four weeks (six for title tags), and a reading date set in advance. Results are recorded as positive, negative, inconclusive or abandoned, with the numbers, and never extrapolated beyond the tested template. Negative and inconclusive results are kept."],
  ["guidelines/reporting-cadence", "Guideline", "Client reporting cadence", "Weekly, monthly and quarterly deliverables.",
    "Weekly: automated anomaly alerts (traffic, indexing, Core Web Vitals). Monthly: organic performance by cluster, experiments update, open technical issues by severity. Quarterly: competitor share of voice, backlink profile review, content refresh plan, decisions log. Every number names its source and date window."],
  ["guidelines/claims-compliance-eu", "Guideline", "Claims compliance in the EU", "Agency-wide baseline for environmental, origin, health and price claims.",
    "Environmental claims must be specific, substantiated and certified (EU Green Claims rules; national authorities such as AGCM in Italy). Origin claims follow national origin marking law. Health or medical claims on apparel and footwear are not allowed. Price claims follow the Omnibus Directive: reference price is the lowest price of the previous 30 days. Each client has its own policy concepts that refine this baseline; the client policy wins when stricter."],
];
PLAY.forEach(([id, type, title, description, body]) => {
  concept(PLAYBOOK, Object.assign({ id, type, title, description, lang: "en", tags: ["playbook", "guideline", type.toLowerCase().replace(/ /g, "-")] }, provenance("playbook"), {
    body: `# ${title}\n\n${body}\n`,
  }));
});

// ---------------------------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------------------------
function frontmatterFor(c) {
  const fm = {
    type: c.type,
    title: c.title,
    description: c.description,
    tags: c.tags,
  };
  if (c.aliases && c.aliases.length) fm.aliases = c.aliases;
  fm.lang = c.lang;
  ["intent", "market", "monthly_volume", "url", "h1", "title_tag", "sku", "line", "gender", "price_eur", "hypothesis", "result", "severity", "state"].forEach((k) => {
    if (c[k] !== undefined && c[k] !== null) fm[k] = c[k];
  });
  if (c.relations && c.relations.length) fm.relations = c.relations;
  if (c.sources && c.sources.length) fm.sources = c.sources;
  if (c.generated) fm.generated = c.generated;
  if (c.verified) fm.verified = c.verified;
  if (c.status) fm.status = c.status;
  if (c.stale_after) fm.stale_after = c.stale_after;
  return fm;
}

function writeBundle(bundleId, concepts) {
  const root = path.join(OUT, "bundles", bundleId);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const byType = new Map();
  concepts.forEach((c) => {
    const file = path.join(root, `${c.id}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = ["---", ...yamlLines(frontmatterFor(c), 0), "---", "", c.body.trimEnd(), ""].join("\n");
    fs.writeFileSync(file, text, "utf8");
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c);
  });
  const indexLines = ["---", 'okf_version: "0.2"', "---", "", `# ${bundleId === CUSTOMER ? "Alpinaria — SEO agent knowledge bundle" : "Agency SEO playbook (shared, read-only)"}`, ""];
  if (bundleId === CUSTOMER) {
    indexLines.push("Durable knowledge of the SEO agent for the customer Alpinaria (Italian outdoor footwear and apparel, markets IT and EN-EU). Generated by generate.js (seed 42); do not edit by hand.", "");
  } else {
    indexLines.push("Agency-wide SEO guidelines shared by every customer agent. Read-only for customer agents.", "");
  }
  Array.from(byType.keys()).sort().forEach((type) => {
    indexLines.push(`## ${type}`, "");
    byType.get(type).sort((a, b) => a.id.localeCompare(b.id)).forEach((c) => indexLines.push(`- [${c.title}](${c.id}.md)`));
    indexLines.push("");
  });
  fs.writeFileSync(path.join(root, "index.md"), indexLines.join("\n"), "utf8");
  return { root, count: concepts.length, byType: Object.fromEntries(Array.from(byType.entries()).map(([k, v]) => [k, v.length])) };
}

const RELATION_TYPES = [
  "targets_cluster", "targets_page", "promotes_line", "promoted_by", "belongs_to_line", "for_audience", "affects_page", "tests_page",
  "informed_by", "applies_policy", "resolves", "resolved_by", "documented_in", "refreshes_page",
];

function writeProject() {
  const text = [
    "project: alpinaria-seo-agent",
    "bundles:",
    `  - id: ${CUSTOMER}`,
    `    root: bundles/${CUSTOMER}`,
    '    include: ["*.md", "**/*.md"]',
    `  - id: ${PLAYBOOK}`,
    `    root: bundles/${PLAYBOOK}`,
    '    include: ["*.md", "**/*.md"]',
    "relationTypes:",
    ...RELATION_TYPES.map((t) => `  - ${t}`),
    "strictLinks: true",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "okf.project.yaml"), text, "utf8");
}

const summary = {
  out: OUT,
  seed: SEED,
  bundles: {
    [CUSTOMER]: writeBundle(CUSTOMER, bundles[CUSTOMER]),
    [PLAYBOOK]: writeBundle(PLAYBOOK, bundles[PLAYBOOK]),
  },
  provenance: summarizeProvenance(bundles[CUSTOMER].concat(bundles[PLAYBOOK])),
};
writeProject();

function summarizeProvenance(all) {
  const s = { total: all.length, status: {}, verified: 0, humanVerified: 0, withSources: 0, staleAfter: 0, stalePast: 0, lang: {} };
  all.forEach((c) => {
    const st = c.status || "stable";
    s.status[st] = (s.status[st] || 0) + 1;
    if (c.verified) { s.verified += 1; if (String(c.verified.by).startsWith("human:")) s.humanVerified += 1; }
    if (c.sources && c.sources.length) s.withSources += 1;
    if (c.stale_after) { s.staleAfter += 1; if (c.stale_after < TODAY) s.stalePast += 1; }
    s.lang[c.lang] = (s.lang[c.lang] || 0) + 1;
  });
  return s;
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
