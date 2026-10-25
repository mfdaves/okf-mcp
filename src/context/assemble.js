"use strict";

// Budgeted context assembly over the lexical index (plan C-1, C-3, WP3a).
//
// Candidate concepts come from the 0.10 `searchConcepts` with every filter,
// mode and confidence field intact (at most `conceptLimit` of them). Only
// their sections are then scored, on the fly, against the same analysed
// query (src/context/score.js: BM25 over each section's own text with the
// concept bundle's stemming, plus at most 20% for the concept's shared
// metadata). Nothing is indexed or cached per OKF index, so a write costs
// context assembly nothing; the one memo is `conceptSections(doc)` per
// document object, which a functional index update keeps for unchanged
// documents. Order: the concept rank from searchConcepts leads (it already
// weighed title, description, tags and aliases); within a concept, sections
// whose own text matches come before sections found through metadata only,
// by score; an own-text section may move ahead of at most `conceptLift`
// weaker concepts in proportion to its score over the best section's. Ties
// fall back to document order. Sections are deduplicated by anchor and by
// identical text hash and packed greedily in that order while they fit.
//
// The budget covers the whole response as delivered (0.11.0-rc.2): usedTokens
// is ceil(characters / 4) of the JSON serialisation of the entire result,
// every top-level field included (query, concepts, queryTerms, the counters,
// usedTokens itself) and every section field (scoring fields too). Sections
// are packed into what the rest of the response leaves; a section's `tokens`
// is the same estimate of the section object alone. The estimator is named in
// the result and the budget is never exceeded, unless it is smaller than the
// response's fixed fields (the query echo and field names), in which case no
// section and no concept is returned and usedTokens says how large the
// response is. When the fields around the sections do not fit, the candidate
// concept list is shortened from its tail first (omittedConcepts counts the
// concepts left out). Provenance is `compact` by default (status, freshness,
// verified, sourceCount); `provenance: "full"` adds staleAfter, trustTier,
// the verified and generated events and the sources, and `provenance: "none"`
// (or `includeProvenance: false`) leaves it out. When the best section alone
// is larger than what is left it is returned on its own with its text cut at
// a sentence boundary, and `truncated` says so; when not even its fields
// without text fit, no section is returned.
//
// The result is structured JSON; catalog text appears only inside section
// fields (B-6, C-3). Provenance per section is the concept's v0.2 signals.

const { normalizeV02Signals } = require("../v02");
const { analyzeQuery, describeSearchIndex, searchLanguages } = require("../search/lexical");
const { FRESHNESS_PRIOR, searchConcepts } = require("../search/query");
const { scoreSections } = require("./score");
const { conceptSections } = require("./sections");

const CONTEXT_TOKEN_ESTIMATOR = "chars/4";
const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_BUDGET_TOKENS = 1200;
const MAX_CONTEXT_BUDGET_TOKENS = 100000;
// The budget is the primary constraint; the section cap only stops a swarm
// of tiny sections (fixture sections run 100-450 characters, so 1,200
// tokens hold 10-15 of them).
const DEFAULT_CONTEXT_LIMIT = 20;
const MAX_CONTEXT_LIMIT = 250;
// Concepts whose sections are ranked; the candidate step's page size.
const DEFAULT_CONCEPT_LIMIT = 10;
const MAX_CONCEPT_LIMIT = 50;
// Multiplier on the preamble's score (title, description, aliases and the
// text before the first heading). Chosen on the dev split of both fixtures
// among 1.0, 0.7 and 0.5 for the best labelled-anchor MRR without a lower
// anchor hit rate (test/fixtures/retrieval/reports/context-0.11-2026-10-24).
const DEFAULT_PREAMBLE_WEIGHT = 0.5;
// Sections with metadata evidence only score at most this share of the
// weakest section with own-text evidence.
const METADATA_ONLY_CEILING = 0.5;
// A truncation keeps the last sentence end in the allowed span only when it
// leaves at least this share of the span; otherwise it cuts at a word.
const MIN_SENTENCE_SHARE = 0.5;
const SENTENCE_END = /[.!?](?=\s|$)|\n/g;
// Options of assembleContext itself; everything else goes to searchConcepts.
const CONTEXT_OPTIONS = [
  "budgetTokens",
  "includeProvenance",
  "provenance",
  "conceptLimit",
  "conceptLift",
  "preambleWeight",
];
const SOURCE_FIELDS = ["id", "resource", "author"];
const PROVENANCE_MODES = Object.freeze(["compact", "full", "none"]);
const DEFAULT_PROVENANCE = "compact";
// How many weaker concepts a strong own-text section may move ahead of (one
// scoring as high as the best own-text section moves the full distance).
// Chosen on the dev split among 0, 2 and 4 by the highest anchor hit summed
// over both fixtures, then the highest anchor MRR (the sweep is in
// test/fixtures/retrieval/reports/context-0.11-2026-10-24).
const DEFAULT_CONCEPT_LIFT = 4;
const MAX_CONCEPT_LIFT = 10;
// A section's content fields (the scoring fields are tokens, score, relevance,
// matchedTerms and coverage). Since 0.11.0-rc.2 every field counts against
// the budget; the list stays exported for library callers.
const CONTENT_FIELDS = Object.freeze([
  "uri",
  "anchor",
  "heading",
  "title",
  "text",
  "truncated",
  "provenance",
]);

function estimateContextTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
}

// Characters of a value as delivered (compact JSON).
function serializedLength(value) {
  return JSON.stringify(value).length;
}

// A section's `tokens` is part of what it costs: settle it on the estimate of
// the section object including its own digits. Returns the section's length.
function settleTokens(section) {
  let tokens = 0;
  for (;;) {
    section.tokens = tokens;
    const length = serializedLength(section);
    const next = Math.ceil(length / CHARS_PER_TOKEN);
    if (next <= tokens) return length;
    tokens = next;
  }
}

// The whole response's estimate with usedTokens set to it (a fixed point:
// usedTokens is part of the response it measures).
function settleUsedTokens(response) {
  let used = 0;
  for (;;) {
    response.usedTokens = used;
    const next = Math.ceil(serializedLength(response) / CHARS_PER_TOKEN);
    if (next <= used) return used;
    used = next;
  }
}

function integerOption(value, name, fallback, maximum) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new TypeError(`${name} must be an integer from 1 through ${maximum}.`);
  }
  return number;
}

function weightOption(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PREAMBLE_WEIGHT;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) {
    throw new TypeError("preambleWeight must be a number greater than 0 and at most 1.");
  }
  return number;
}

function provenanceOption(config) {
  if (config.includeProvenance === false) {
    return null;
  }
  const mode =
    config.provenance === undefined || config.provenance === null
      ? DEFAULT_PROVENANCE
      : config.provenance;
  if (!PROVENANCE_MODES.includes(mode)) {
    throw new TypeError(`provenance must be one of ${PROVENANCE_MODES.join(", ")}.`);
  }
  return mode === "none" ? null : mode;
}

function liftOption(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CONCEPT_LIFT;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_CONCEPT_LIFT) {
    throw new TypeError(`conceptLift must be a number from 0 through ${MAX_CONCEPT_LIFT}.`);
  }
  return number;
}

function signalsFor(doc, asOf) {
  return asOf ? normalizeV02Signals(doc, { asOf }) : doc.signals || {};
}

// R-6 factors, the same as concept search applies to candidates.
function priorFactor(signals) {
  let factor = 1;
  if (signals.status === "deprecated") {
    factor *= FRESHNESS_PRIOR.deprecated;
  } else if (signals.status === "draft") {
    factor *= FRESHNESS_PRIOR.draft;
  }
  if (signals.freshness === "stale") {
    factor *= FRESHNESS_PRIOR.stale;
  }
  return factor;
}

function compactSource(source) {
  const out = {};
  SOURCE_FIELDS.forEach((field) => {
    if (source[field] !== undefined) {
      out[field] = source[field];
    }
  });
  return out;
}

const validSources = (signals) =>
  (signals.sources || []).filter(
    (source) => source && typeof source === "object" && source.valid !== false,
  );

function provenanceOf(signals, mode) {
  if (mode === "compact") {
    return {
      status: signals.status ?? null,
      freshness: signals.freshness ?? null,
      verified: (signals.verifiedEvents || []).length > 0,
      sourceCount: validSources(signals).length,
    };
  }
  return {
    status: signals.status ?? null,
    staleAfter: signals.staleAfter ?? null,
    freshness: signals.freshness ?? null,
    trustTier: signals.trustTier ?? null,
    verified: (signals.verifiedEvents || []).map((event) => ({
      by: event.by ?? null,
      at: event.at ?? null,
    })),
    generated: signals.generated
      ? { by: signals.generated.by ?? null, at: signals.generated.at ?? null }
      : null,
    sources: validSources(signals).map(compactSource),
  };
}

// The stemming languages of a bundle: its detected set under `auto`, else
// the configured union (the same plan concept search indexes with).
function bundleLanguages(index, options) {
  const plan = describeSearchIndex(index, options);
  return (bundle) => plan.bundles?.[bundle]?.languages || plan.languages;
}

// Sections of the candidate concepts that match at least one query term,
// ordered by score, candidate rank and document position, one per anchor
// and per distinct text.
function rankSections(index, options, analysis, candidates, context) {
  const entries = [];
  candidates.forEach((candidate, conceptRank) => {
    const doc = index.byUri.get(candidate.uri);
    if (!doc) {
      return;
    }
    conceptSections(doc).forEach((section, position) => {
      entries.push({ doc, concept: doc, section, position, conceptRank });
    });
  });
  const scored = scoreSections(entries, analysis, {
    languagesFor: bundleLanguages(index, options),
    preambleWeight: context.preambleWeight,
  });
  const prior = (hit) =>
    options.freshnessPrior ? priorFactor(context.signalsOf(hit.entry.doc)) : 1;
  const ranked = scored.map((hit) => ({
    entry: hit.entry,
    tier: hit.tier,
    score: hit.tier ? hit.score * prior(hit) : 0,
    coverage: hit.coverage,
    positions: hit.positions,
    conceptRank: hit.entry.conceptRank,
  }));
  // A metadata-only section scores below the weakest own-text section of its
  // concept (of any candidate when its concept has none).
  const weakest = new Map();
  ranked.forEach((hit) => {
    if (hit.tier) {
      const uri = hit.entry.doc.uri;
      weakest.set(uri, Math.min(weakest.get(uri) ?? Number.POSITIVE_INFINITY, hit.score));
    }
  });
  const ownScores = ranked.filter((hit) => hit.tier).map((hit) => hit.score);
  const fallback = ownScores.length ? Math.min(...ownScores) : 1;
  const best = ownScores.length ? Math.max(...ownScores) : 0;
  ranked.forEach((hit, position) => {
    if (!hit.tier) {
      const floor = weakest.get(hit.entry.doc.uri) ?? fallback;
      hit.score =
        METADATA_ONLY_CEILING * floor * scored[position].metadataShare * prior(scored[position]);
    }
    // Concept rank leads; an own-text section moves ahead of at most
    // `conceptLift` weaker concepts, in proportion to its score over the best.
    hit.key =
      hit.conceptRank - (hit.tier && best > 0 ? context.conceptLift * (hit.score / best) : 0);
  });
  ranked.sort(
    (left, right) =>
      left.key - right.key ||
      right.tier - left.tier ||
      right.score - left.score ||
      left.entry.position - right.entry.position,
  );
  const top = best;
  const anchors = new Set();
  const hashes = new Set();
  return ranked.filter((candidate) => {
    const { anchor, hash } = candidate.entry.section;
    if (anchors.has(anchor) || hashes.has(hash)) {
      return false;
    }
    anchors.add(anchor);
    hashes.add(hash);
    candidate.relevance = top > 0 ? candidate.score / top : 0;
    return true;
  });
}

// The longest prefix within `maxChars` that ends a sentence (keeping at least
// half of the span), else the last word boundary, else a hard cut.
function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  let cut = -1;
  SENTENCE_END.lastIndex = 0;
  for (let match = SENTENCE_END.exec(text); match; match = SENTENCE_END.exec(text)) {
    const end = match[0] === "\n" ? match.index : match.index + 1;
    if (end > maxChars) {
      break;
    }
    cut = end;
  }
  if (cut < maxChars * MIN_SENTENCE_SHARE) {
    const space = text.lastIndexOf(" ", maxChars);
    cut = space > 0 ? space : maxChars;
  }
  return text.slice(0, cut).trimEnd();
}

// The best section cut to fit `limitChars` once serialised (its tokens
// settled), or null when its fields without any text already exceed it. JSON
// escaping can make the text cost more than its length, so the allowance
// shrinks until it fits.
function truncatedSection(build, text, limitChars) {
  const empty = build("", true);
  let allowance = limitChars - settleTokens(empty);
  while (allowance > 0) {
    const section = build(truncateText(text, allowance), true);
    const excess = settleTokens(section) - limitChars;
    if (excess <= 0) {
      return section;
    }
    allowance -= excess;
  }
  return null;
}

// Greedy by rank into `availableChars` (what the rest of the response leaves
// of the budget): a section is taken when its serialised length, plus the
// comma that separates it from the previous one, fits what is left and the
// limit allows it, otherwise skipped. A best section larger than everything
// available is returned alone, cut.
function packSections(ranked, availableChars, limit, build) {
  if (ranked.length) {
    const best = ranked[0];
    const whole = build(best, best.entry.section.text, false);
    if (settleTokens(whole) > availableChars) {
      const cut = truncatedSection(
        (text, isCut) => build(best, text, isCut),
        best.entry.section.text,
        availableChars,
      );
      if (!cut) {
        return { packed: [], omitted: ranked.length, truncated: false };
      }
      return { packed: [cut], omitted: ranked.length - 1, truncated: true };
    }
  }
  const packed = [];
  let used = 0;
  let omitted = 0;
  ranked.forEach((candidate) => {
    const section = build(candidate, candidate.entry.section.text, false);
    const cost = settleTokens(section) + (packed.length ? 1 : 0);
    if (packed.length >= limit || used + cost > availableChars) {
      omitted += 1;
      return;
    }
    packed.push(section);
    used += cost;
  });
  return { packed, omitted, truncated: false };
}

// The response around the sections, sized for the worst case of the fields
// packing can still change (usedTokens at the full budget, every section
// omitted, truncated false), so what it leaves is a safe allowance. The
// candidate list is shortened from its tail while even that does not fit.
function responseFrame(fields, candidates, budgetTokens, rankedCount) {
  const limitChars = budgetTokens * CHARS_PER_TOKEN;
  const frame = (concepts) =>
    Object.assign({}, fields, {
      usedTokens: budgetTokens,
      concepts,
      sections: [],
      totalSections: rankedCount,
      omittedSections: rankedCount,
      truncated: false,
      omittedConcepts: candidates.length - concepts.length,
    });
  let concepts = candidates;
  let length = serializedLength(frame(concepts));
  while (length > limitChars && concepts.length) {
    concepts = concepts.slice(0, -1);
    length = serializedLength(frame(concepts));
  }
  return { concepts, availableChars: Math.max(0, limitChars - length) };
}

function sectionResult(candidate, text, truncated, analysis, provenanceMode, signalsOf) {
  const { entry } = candidate;
  const result = {
    uri: entry.concept.uri,
    anchor: entry.section.anchor,
    heading: entry.section.heading,
    title: entry.concept.title,
    text,
    tokens: 0,
    truncated,
    score: candidate.score,
    relevance: candidate.relevance,
    matchedTerms: candidate.positions.map((position) => analysis.tokens[position].raw),
    coverage: candidate.coverage,
  };
  if (provenanceMode) {
    result.provenance = provenanceOf(signalsOf(entry.concept), provenanceMode);
  }
  return result;
}

function assembleContext(index, options) {
  const config = options || {};
  const query = String(config.query || "").trim();
  if (!query) {
    throw new TypeError("Context assembly requires a query.");
  }
  const budgetTokens = integerOption(
    config.budgetTokens,
    "budgetTokens",
    DEFAULT_CONTEXT_BUDGET_TOKENS,
    MAX_CONTEXT_BUDGET_TOKENS,
  );
  const limit = integerOption(config.limit, "limit", DEFAULT_CONTEXT_LIMIT, MAX_CONTEXT_LIMIT);
  const conceptLimit = integerOption(
    config.conceptLimit,
    "conceptLimit",
    DEFAULT_CONCEPT_LIMIT,
    MAX_CONCEPT_LIMIT,
  );
  const preambleWeight = weightOption(config.preambleWeight);
  const conceptLift = liftOption(config.conceptLift);
  const provenanceMode = provenanceOption(config);
  const searchOptions = Object.assign({}, config, {
    query,
    limit: conceptLimit,
    offset: 0,
    detail: "compact",
  });
  CONTEXT_OPTIONS.forEach((name) => {
    delete searchOptions[name];
  });
  const response = searchConcepts(index, searchOptions);
  const candidates = response.results.map((entry, position) => ({
    uri: entry.uri,
    rank: position + 1,
    coverage: entry.coverage,
    relevance: entry.relevance,
  }));
  const analysis = analyzeQuery(query, { languages: searchLanguages(index, searchOptions) });
  // Signals once per concept per call: with asOf they are re-derived.
  const signalsCache = new Map();
  const signalsOf = (doc) => {
    if (!signalsCache.has(doc.uri)) {
      signalsCache.set(doc.uri, signalsFor(doc, config.asOf));
    }
    return signalsCache.get(doc.uri);
  };
  const ranked =
    analysis.tokens.length && candidates.length
      ? rankSections(index, searchOptions, analysis, candidates, {
          preambleWeight,
          conceptLift,
          signalsOf,
        })
      : [];
  const fields = {
    query,
    budgetTokens,
    estimator: CONTEXT_TOKEN_ESTIMATOR,
    usedTokens: 0,
    mode: response.mode,
    lowConfidence: Boolean(response.lowConfidence),
    queryTerms: response.queryTerms || [],
    droppedTerms: response.droppedTerms || [],
  };
  const frame = responseFrame(fields, candidates, budgetTokens, ranked.length);
  const packing = packSections(ranked, frame.availableChars, limit, (candidate, text, truncated) =>
    sectionResult(candidate, text, truncated, analysis, provenanceMode, signalsOf),
  );
  const result = Object.assign(fields, {
    concepts: frame.concepts,
    sections: packing.packed,
    totalSections: ranked.length,
    omittedSections: packing.omitted,
    truncated: packing.truncated,
    omittedConcepts: candidates.length - frame.concepts.length,
  });
  // The frame was sized for the worst case, so this holds; the loop is a
  // guard that keeps the promise if a field ever grows past that estimate.
  while (settleUsedTokens(result) > budgetTokens && result.sections.length) {
    result.sections.pop();
    result.omittedSections += 1;
    if (!result.sections.length) result.truncated = false;
  }
  return result;
}

// Defaults and ceilings of the sizing options, for the tool schema and CLI.
const CONTEXT_LIMITS = Object.freeze({
  budgetTokens: Object.freeze({
    default: DEFAULT_CONTEXT_BUDGET_TOKENS,
    maximum: MAX_CONTEXT_BUDGET_TOKENS,
  }),
  limit: Object.freeze({ default: DEFAULT_CONTEXT_LIMIT, maximum: MAX_CONTEXT_LIMIT }),
  conceptLimit: Object.freeze({ default: DEFAULT_CONCEPT_LIMIT, maximum: MAX_CONCEPT_LIMIT }),
});

module.exports = {
  CONTEXT_CONTENT_FIELDS: CONTENT_FIELDS,
  CONTEXT_LIMITS,
  PROVENANCE_MODES,
  CONTEXT_TOKEN_ESTIMATOR,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_CONCEPT_LIFT,
  DEFAULT_PREAMBLE_WEIGHT,
  DEFAULT_PROVENANCE,
  assembleContext,
  estimateContextTokens,
};
