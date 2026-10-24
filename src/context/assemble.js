"use strict";

// Budgeted context assembly over the lexical index (plan C-1, C-3, WP3a).
//
// Candidate concepts come from the 0.10 `searchConcepts` with every filter,
// mode and confidence field intact. Their sections are then ranked against
// the same analysed query with the same lexical machinery: a shadow index
// whose "concepts" are the sections (one document per section, carrying the
// concept's type, tags and path, the heading as title, and the concept
// title, description and aliases on the preamble) is built lazily per OKF
// index and language set through `searchVariant`, so stemming, the exact
// field and the literal-term rules are the ones concept search uses. Sections
// are ranked under any-term matching (a concept can match every term across
// sections while no single section does), ordered by score, then candidate
// rank, then document order, deduplicated by anchor and by identical text
// hash, and packed greedily in that order while they fit the budget. Tokens
// are estimated as ceil(characters / 4); the estimator is named in the result
// and the budget is never exceeded. When the best section alone is larger
// than the budget it is returned on its own, cut at a sentence boundary, and
// `truncated` says so.
//
// The result is structured JSON; catalog text appears only inside section
// fields (B-6, C-3). Provenance per section is the concept's v0.2 signals.

const { normalizeV02Signals } = require("../v02");
const {
  analyzeQuery,
  describeSearchIndex,
  runQuery,
  searchLanguages,
  searchVariant,
} = require("../search/lexical");
const { FRESHNESS_PRIOR, searchConcepts } = require("../search/query");
const { conceptSections } = require("./sections");

const CONTEXT_TOKEN_ESTIMATOR = "chars/4";
const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_BUDGET_TOKENS = 1200;
const MAX_CONTEXT_BUDGET_TOKENS = 100000;
// The budget is the primary constraint; the section cap only stops a swarm
// of tiny sections (fixture sections run 100-450 characters, so 1,200
// tokens hold 10-15 of them; measured, the cap at 20 packs the same
// labelled anchors as no cap).
const DEFAULT_CONTEXT_LIMIT = 20;
const MAX_CONTEXT_LIMIT = 250;
// Concepts whose sections are ranked; the candidate step's page size.
const DEFAULT_CONCEPT_LIMIT = 10;
const MAX_CONCEPT_LIMIT = 50;
// A truncation keeps the last sentence end in the allowed span only when it
// leaves at least this share of the span; otherwise it cuts at a word.
const MIN_SENTENCE_SHARE = 0.5;
const SENTENCE_END = /[.!?](?=\s|$)|\n/g;
// Options of assembleContext itself; everything else goes to searchConcepts.
const CONTEXT_OPTIONS = ["budgetTokens", "includeProvenance", "conceptLimit"];
const SOURCE_FIELDS = ["id", "resource", "author"];
// OKF index -> Map<language key, section corpus>
const SECTION_CORPORA = new WeakMap();

function estimateContextTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
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

// A section as a concept-shaped document for the lexical index: the fields
// shared by the whole concept on every section, the concept's own lead
// fields on the preamble only, the heading as the title elsewhere.
function sectionDocument(doc, section, position) {
  const preamble = section.heading === null;
  return {
    uri: section.anchor,
    bundle: doc.bundle,
    conceptId: doc.conceptId,
    customId: doc.customId,
    path: doc.path,
    type: doc.type,
    tags: doc.tags || [],
    title: preamble ? doc.title : section.heading,
    description: preamble ? doc.description : "",
    aliases: preamble ? doc.aliases || [] : [],
    body: preamble ? section.text : section.text.slice(section.heading.length).trim(),
    concept: doc,
    section,
    position,
  };
}

function sectionCorpus(index, languages) {
  let corpora = SECTION_CORPORA.get(index);
  if (!corpora) {
    corpora = new Map();
    SECTION_CORPORA.set(index, corpora);
  }
  const key = languages.join(",") || "none";
  let corpus = corpora.get(key);
  if (!corpus) {
    const byAnchor = new Map();
    (index.concepts || []).forEach((doc) => {
      conceptSections(doc).forEach((section, position) => {
        byAnchor.set(section.anchor, sectionDocument(doc, section, position));
      });
    });
    // An explicit language list: the union concept search resolved, applied
    // to every section (per-bundle sets under `auto` would need detection to
    // run on sections, which could differ from the concept-level result).
    const shadow = { concepts: Array.from(byAnchor.values()), languages };
    corpus = { byAnchor, searchIndex: searchVariant(shadow, {}).searchIndex };
    corpora.set(key, corpus);
  }
  return corpus;
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

function provenanceOf(signals) {
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
    sources: (signals.sources || [])
      .filter((source) => source && typeof source === "object" && source.valid !== false)
      .map(compactSource),
  };
}

// Sections of the candidate concepts that match at least one query term,
// ordered by score, candidate rank and document position, one per anchor
// and per distinct text.
function rankSections(index, options, analysis, candidates, signalsByUri) {
  const corpus = sectionCorpus(index, describeSearchIndex(index, options).languages);
  const rankOf = new Map(candidates.map((candidate, position) => [candidate.uri, position]));
  const hits = runQuery(corpus.searchIndex, analysis.tokens, {
    combineWith: "OR",
    filter: (result) => {
      const entry = corpus.byAnchor.get(String(result.id));
      return Boolean(entry) && rankOf.has(entry.concept.uri);
    },
    document: (id) => corpus.byAnchor.get(id),
  });
  const ranked = hits.map((hit) => {
    const entry = corpus.byAnchor.get(hit.id);
    const prior = options.freshnessPrior ? priorFactor(signalsByUri(entry.concept)) : 1;
    return {
      entry,
      score: hit.score * prior,
      coverage: hit.coverage,
      positions: hit.positions,
      conceptRank: rankOf.get(entry.concept.uri),
    };
  });
  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.conceptRank - right.conceptRank ||
      left.entry.position - right.entry.position,
  );
  const top = ranked.length ? ranked[0].score : 0;
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

// Greedy by rank: a section is taken when it fits what is left of the budget
// and the limit, otherwise skipped. A best section larger than the whole
// budget is returned alone, cut at a sentence boundary.
function packSections(ranked, budgetTokens, limit) {
  if (ranked.length && estimateContextTokens(ranked[0].entry.section.text) > budgetTokens) {
    const text = truncateText(ranked[0].entry.section.text, budgetTokens * CHARS_PER_TOKEN);
    const tokens = estimateContextTokens(text);
    return {
      packed: [Object.assign({ text, tokens, truncated: true }, ranked[0])],
      usedTokens: tokens,
      omitted: ranked.length - 1,
      truncated: true,
    };
  }
  const packed = [];
  let usedTokens = 0;
  let omitted = 0;
  ranked.forEach((candidate) => {
    const text = candidate.entry.section.text;
    const tokens = estimateContextTokens(text);
    if (packed.length >= limit || usedTokens + tokens > budgetTokens) {
      omitted += 1;
      return;
    }
    packed.push(Object.assign({ text, tokens, truncated: false }, candidate));
    usedTokens += tokens;
  });
  return { packed, usedTokens, omitted, truncated: false };
}

function sectionResult(candidate, analysis, includeProvenance, signalsByUri) {
  const { entry } = candidate;
  const result = {
    uri: entry.concept.uri,
    anchor: entry.section.anchor,
    heading: entry.section.heading,
    title: entry.concept.title,
    text: candidate.text,
    tokens: candidate.tokens,
    truncated: candidate.truncated,
    score: candidate.score,
    relevance: candidate.relevance,
    matchedTerms: candidate.positions.map((position) => analysis.tokens[position].raw),
    coverage: candidate.coverage,
  };
  if (includeProvenance) {
    result.provenance = provenanceOf(signalsByUri(entry.concept));
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
  const includeProvenance = config.includeProvenance !== false;
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
  const signalsByUri = (doc) => {
    if (!signalsCache.has(doc.uri)) {
      signalsCache.set(doc.uri, signalsFor(doc, config.asOf));
    }
    return signalsCache.get(doc.uri);
  };
  const ranked =
    analysis.tokens.length && candidates.length
      ? rankSections(index, searchOptions, analysis, candidates, signalsByUri)
      : [];
  const packing = packSections(ranked, budgetTokens, limit);
  return {
    query,
    budgetTokens,
    estimator: CONTEXT_TOKEN_ESTIMATOR,
    usedTokens: packing.usedTokens,
    mode: response.mode,
    lowConfidence: Boolean(response.lowConfidence),
    queryTerms: response.queryTerms || [],
    droppedTerms: response.droppedTerms || [],
    concepts: candidates,
    sections: packing.packed.map((candidate) =>
      sectionResult(candidate, analysis, includeProvenance, signalsByUri),
    ),
    totalSections: ranked.length,
    omittedSections: packing.omitted,
    truncated: packing.truncated,
  };
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
  CONTEXT_LIMITS,
  CONTEXT_TOKEN_ESTIMATOR,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  assembleContext,
  estimateContextTokens,
};
