"use strict";

const { conceptSummary, edgesBySource, linkSets } = require("../indexer");
const { normalizeV02Signals } = require("../v02");
const { resolveConcept } = require("../indexer");
const { foldDiacritics } = require("./languages");
const { analyzeQuery, prepareSearchIndex, runQuery, searchLanguages } = require("./lexical");
const { denseSearch } = require("./dense");
const { fuseRankings, fusionAlpha } = require("./fusion");

const MAX_COMPACT_TEXT = 500;
// `auto` runs the all-term query and falls back to any-term when it returns
// nothing (R-1); it is the default since 0.10 (section 10).
const SEARCH_MODES = Object.freeze(["auto", "all", "any"]);
// R-4: a response is flagged when the any-term fallback produced it and its
// top result matched strictly fewer than half of the query terms.
const LOW_CONFIDENCE_COVERAGE = 0.5;
// R-6: optional score multipliers, off by default, applied only when the
// signal is present on the document.
const FRESHNESS_PRIOR = Object.freeze({ deprecated: 0.5, stale: 0.7, draft: 0.85 });
// R-10: how many dense neighbours join the lexical hits before fusion (more
// when the requested page reaches further).
const DENSE_DEPTH = 100;

function lower(value) {
  return String(value || "").toLowerCase();
}

function compactText(value) {
  const text = String(value || "");
  return text.length > MAX_COMPACT_TEXT ? `${text.slice(0, MAX_COMPACT_TEXT - 1)}…` : text;
}

function compactConceptSummary(doc) {
  return {
    uri: doc.uri,
    title: compactText(doc.title),
    type: compactText(doc.type),
    description: compactText(doc.description),
  };
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function frontmatterMatches(frontmatter, filters) {
  const entries = Object.entries(filters || {});
  return entries.every(([key, expected]) => {
    const actual = frontmatter[key];
    if (Array.isArray(actual)) {
      return actual.map(String).some((entry) => lower(entry) === lower(expected));
    }
    return lower(actual) === lower(expected);
  });
}

function docText(doc) {
  return [
    doc.title,
    doc.description,
    doc.type,
    doc.path,
    doc.tags.join(" "),
    doc.aliases.join(" "),
    doc.body,
  ].join("\n");
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Earliest occurrence of a query term's literal or folded form (diacritics
// folded on both sides); failing that, of a word starting with one of its stems.
function snippetFor(doc, tokens) {
  if (!tokens.length) {
    return "";
  }
  const text = docText(doc).replace(/\s+/g, " ");
  const normalized = foldDiacritics(lower(text));
  let idx = -1;
  let matchedLength = 0;
  const consider = (candidate, length) => {
    if (candidate !== -1 && (idx === -1 || candidate < idx)) {
      idx = candidate;
      matchedLength = length;
    }
  };
  tokens.forEach((token) => {
    token.snippetTerms.forEach((term) => {
      const folded = foldDiacritics(term);
      consider(normalized.indexOf(folded), folded.length);
    });
  });
  if (idx === -1) {
    tokens.forEach((token) => {
      token.stems.forEach((stem) => {
        const match = new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(stem)}[\\p{L}\\p{N}]*`,
          "u",
        ).exec(normalized);
        if (match) {
          consider(match.index, match[0].length);
        }
      });
    });
  }
  if (idx === -1) {
    return "";
  }
  const start = Math.max(0, idx - 50);
  return text.slice(start, idx + matchedLength + 80).trim();
}

function signalsForDoc(doc, asOf) {
  if (!asOf) {
    return doc.signals || {};
  }
  const signals = normalizeV02Signals(doc, { asOf });
  if (signals.computation && doc.signals?.computation) {
    signals.computation.structuralReady = signals.computation.ready;
    signals.computation.assetsReady = doc.signals.computation.assetsReady;
    signals.computation.attestationReady = Boolean(
      signals.computation.structuralReady && signals.computation.assetsReady,
    );
  }
  return signals;
}

function applyFilters(index, options) {
  const config = options || {};
  const typeFilters = asArray(config.types || config.type).map(lower);
  const tagsAny = asArray(config.tagsAny || config.tag).map(lower);
  const tagsAll = asArray(config.tagsAll).map(lower);
  const statuses = asArray(config.statuses || config.status).map(lower);
  const trustTiers = asArray(config.trustTiers || config.trustTier).map(lower);
  const freshness = asArray(config.freshness).map(lower);
  const linkedToDoc = resolveConcept(index, config.linkedTo);
  const linkedFromDoc = resolveConcept(index, config.linkedFrom);
  const linkedTo = linkedToDoc ? linkedToDoc.uri : config.linkedTo;
  const linkedFrom = linkedFromDoc ? linkedFromDoc.uri : config.linkedFrom;
  const { outbound, inbound } = linkSets(index);
  return index.concepts.filter((doc) => {
    const signals = signalsForDoc(doc, config.asOf);
    if (config.bundle && doc.bundle !== config.bundle) {
      return false;
    }
    if (config.pathPrefix && !doc.path.startsWith(config.pathPrefix)) {
      return false;
    }
    if (typeFilters.length && !typeFilters.includes(lower(doc.type))) {
      return false;
    }
    const docTags = doc.tags.map(lower);
    if (tagsAny.length && !tagsAny.some((tag) => docTags.includes(tag))) {
      return false;
    }
    if (tagsAll.length && !tagsAll.every((tag) => docTags.includes(tag))) {
      return false;
    }
    if (config.frontmatter && !frontmatterMatches(doc.frontmatter, config.frontmatter)) {
      return false;
    }
    if (linkedTo && !(outbound.get(doc.uri) || new Set()).has(linkedTo)) {
      return false;
    }
    if (linkedFrom && !(inbound.get(doc.uri) || new Set()).has(linkedFrom)) {
      return false;
    }
    if (
      config.orphanOnly &&
      ((outbound.get(doc.uri) || new Set()).size > 0 ||
        (inbound.get(doc.uri) || new Set()).size > 0)
    ) {
      return false;
    }
    if (config.relationType) {
      const hasRelation = (edgesBySource(index).get(doc.uri) || []).some(
        (edge) =>
          !edge.broken &&
          edge.kind === "relation" &&
          lower(edge.relationType) === lower(config.relationType),
      );
      if (!hasRelation) {
        return false;
      }
    }
    if (statuses.length && !statuses.includes(lower(signals.status))) {
      return false;
    }
    if (trustTiers.length && !trustTiers.includes(lower(signals.trustTier))) {
      return false;
    }
    if (freshness.length && !freshness.includes(lower(signals.freshness))) {
      return false;
    }
    if (config.hasSources !== undefined && Boolean(signals.sources?.length) !== config.hasSources) {
      return false;
    }
    if (config.runtime && lower(signals.computation?.runtime) !== lower(config.runtime)) {
      return false;
    }
    if (
      config.attestationReady !== undefined &&
      Boolean(signals.computation?.attestationReady) !== config.attestationReady
    ) {
      return false;
    }
    if (config.generatedBy && lower(signals.generated?.by) !== lower(config.generatedBy)) {
      return false;
    }
    if (
      config.verifiedBy &&
      !(signals.verifiedEvents || []).some((event) => lower(event.by) === lower(config.verifiedBy))
    ) {
      return false;
    }
    return true;
  });
}

function compareDocs(left, right) {
  return left.path.localeCompare(right.path) || left.uri.localeCompare(right.uri);
}

function searchMode(value) {
  if (value === undefined || value === null || value === "") {
    return "auto";
  }
  if (!SEARCH_MODES.includes(value)) {
    throw new TypeError(`Search mode must be one of ${SEARCH_MODES.join(", ")}.`);
  }
  return value;
}

function floorOption(value, name) {
  if (value === undefined || value === null) {
    return 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new TypeError(`${name} must be a number between 0 and 1.`);
  }
  return number;
}

function priorFactor(doc, asOf) {
  const signals = signalsForDoc(doc, asOf);
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

// Runs the analysed query under `mode` over the filtered documents. Returns
// the ranked results (doc, score, matchedTerms, coverage, relevance), the mode
// that produced them, and the all-term count: the AND result size or, under
// `any`, the hits that matched every token. The optional prior multiplies
// scores before ranking; `relevance` is score over the run's top score, and
// the floors drop results below either value after that.
function rankQuery(index, config, analysis, docsByUri) {
  const searchIndex = prepareSearchIndex(index, config);
  const run = (combineWith) =>
    runQuery(searchIndex, analysis.tokens, {
      combineWith,
      filter: (result) => docsByUri.has(String(result.id)),
      document: (id) => docsByUri.get(id),
    });
  let hits;
  let mode;
  let allTermsTotal;
  if (config.mode === "any") {
    hits = run("OR");
    mode = "any";
    allTermsTotal = hits.filter((hit) => hit.coverage === 1).length;
  } else {
    hits = run("AND");
    mode = "all";
    allTermsTotal = hits.length;
    if (!hits.length && config.mode === "auto") {
      hits = run("OR");
      mode = "any";
    }
  }
  const prior = config.freshnessPrior ? (doc) => priorFactor(doc, config.asOf) : () => 1;
  const results = hits
    .filter((hit) => docsByUri.has(hit.id))
    .map((hit) => {
      const doc = docsByUri.get(hit.id);
      return Object.assign({ doc }, hit, { score: hit.score * prior(doc) });
    });
  results.sort((a, b) => b.score - a.score || compareDocs(a.doc, b.doc));
  const top = results.length ? results[0].score : 0;
  results.forEach((entry) => {
    entry.relevance = top > 0 ? entry.score / top : 0;
  });
  return { results: applyFloors(results, config), mode, allTermsTotal, unfloored: results };
}

// The floors keep their lexical meaning under hybrid ranking too: coverage of
// the query terms and the lexical score relative to the lexical top result.
function applyFloors(results, config) {
  if (!(config.minCoverage > 0 || config.minRelevance > 0)) {
    return results;
  }
  return results.filter(
    (entry) =>
      entry.coverage >= config.minCoverage &&
      (entry.lexicalRelevance ?? entry.relevance) >= config.minRelevance,
  );
}

// Hybrid ranking (R-10): the lexical hits, before floors, fused with the dense
// ranking of the filtered candidates. An explicit mode "all" keeps its
// meaning, every term required, so dense scores only re-rank the all-term
// hits; under auto and any the dense neighbours join the candidates.
function hybridRank(index, config, ranking, filteredDocs, depth) {
  const lexical = ranking.unfloored;
  const byUri = new Map(lexical.map((entry) => [entry.doc.uri, entry]));
  const candidates = config.mode === "all" ? lexical.map((entry) => entry.doc) : filteredDocs;
  const prior = config.freshnessPrior ? (doc) => priorFactor(doc, config.asOf) : null;
  const docs = new Map(candidates.map((doc) => [doc.uri, doc]));
  const dense = denseSearch(index, {
    queryVector: config.queryVector,
    cache: config.vectorCache,
    units: config.embedUnits,
    candidates,
    limit: depth,
  }).map((entry) => {
    // R-6 multiplies scores; a negative cosine is divided so it still drops.
    const factor = prior ? prior(docs.get(entry.id)) : 1;
    const score = entry.score >= 0 ? entry.score * factor : entry.score / factor;
    return { id: entry.id, score, unit: entry.unit };
  });
  const units = new Map(dense.map((entry) => [entry.id, entry.unit]));
  const fused = fuseRankings({
    lexical: lexical.map((entry) => ({ id: entry.doc.uri, score: entry.score })),
    dense,
    alpha: config.alpha,
  });
  const top = fused.length ? fused[0].fusedScore : 0;
  const results = fused.map((entry) => {
    const hit = byUri.get(entry.id);
    const base = hit
      ? Object.assign({}, hit, { lexicalRelevance: hit.relevance })
      : { doc: docs.get(entry.id), positions: [], coverage: 0, lexicalRelevance: 0 };
    return Object.assign(base, {
      score: entry.fusedScore,
      relevance: top > 0 ? entry.fusedScore / top : 0,
      lexicalScore: entry.lexicalScore,
      denseScore: entry.denseScore,
      fusedScore: entry.fusedScore,
      unit: units.get(entry.id),
    });
  });
  return applyFloors(results, config);
}

function hybridFields(entry) {
  const fields = {
    lexicalScore: entry.lexicalScore,
    denseScore: entry.denseScore,
    fusedScore: entry.fusedScore,
  };
  // Section units cite the section that matched (`uri#anchor`).
  if (entry.unit && entry.unit !== entry.doc.uri) {
    fields.unit = entry.unit;
  }
  return fields;
}

function searchConcepts(index, options) {
  const config = Object.assign({}, options || {}, {
    mode: searchMode(options?.mode),
    minCoverage: floorOption(options?.minCoverage, "minCoverage"),
    minRelevance: floorOption(options?.minRelevance, "minRelevance"),
  });
  const query = String(config.query || "").trim();
  const analysis = analyzeQuery(query, {
    languages: query ? searchLanguages(index, config) : [],
  });
  const limit = Math.max(1, Math.min(Number(config.limit || 25), 250));
  const offset = Math.max(0, Number(config.offset || 0));
  const filteredDocs = applyFilters(index, config);
  let results;
  let ranking = null;
  let hybrid = false;
  if (analysis.query) {
    if (!analysis.tokens.length) {
      // Punctuation-only text: nothing to run, reported under the requested mode.
      results = [];
      ranking = { mode: config.mode === "any" ? "any" : "all", allTermsTotal: 0, results };
    } else {
      const docsByUri = new Map(filteredDocs.map((doc) => [doc.uri, doc]));
      ranking = rankQuery(index, config, analysis, docsByUri);
      hybrid = config.hybrid === true && Boolean(config.queryVector && config.vectorCache);
      results = hybrid
        ? hybridRank(index, config, ranking, filteredDocs, Math.max(DENSE_DEPTH, offset + limit))
        : ranking.results;
    }
  } else {
    results = filteredDocs.map((doc) => ({ doc, score: 0 }));
    results.sort((a, b) => compareDocs(a.doc, b.doc));
  }
  const page = results.slice(offset, offset + limit).map((entry) => {
    if (config.detail === "compact") {
      const compact = compactConceptSummary(entry.doc);
      if (ranking) {
        Object.assign(compact, { coverage: entry.coverage, relevance: entry.relevance });
      }
      return hybrid ? Object.assign(compact, hybridFields(entry)) : compact;
    }
    const summary = conceptSummary(entry.doc);
    if (config.asOf) {
      const signals = signalsForDoc(entry.doc, config.asOf);
      summary.signals = Object.assign({}, summary.signals, {
        status: signals.status,
        staleAfter: signals.staleAfter,
        freshness: signals.freshness,
        asOf: signals.asOf,
        trustTier: signals.trustTier,
      });
    }
    Object.assign(summary, {
      score: entry.score,
      snippet: snippetFor(entry.doc, analysis.tokens),
    });
    if (ranking) {
      Object.assign(summary, {
        matchedTerms: entry.positions.map((position) => analysis.tokens[position].raw),
        coverage: entry.coverage,
        relevance: entry.relevance,
      });
    }
    return hybrid ? Object.assign(summary, hybridFields(entry)) : summary;
  });
  const response = { total: results.length, limit, offset };
  if (ranking) {
    // lowConfidence keeps its lexical meaning: it reads the lexical ranking.
    const lexicalResults = ranking.results;
    Object.assign(response, {
      mode: ranking.mode,
      allTermsTotal: ranking.allTermsTotal,
      lowConfidence:
        ranking.mode === "any" &&
        lexicalResults.length > 0 &&
        lexicalResults[0].coverage < LOW_CONFIDENCE_COVERAGE,
      queryTerms: analysis.terms,
      droppedTerms: analysis.dropped,
    });
    if (hybrid) {
      Object.assign(response, { hybrid: true, alpha: fusionAlpha(config.alpha) });
    }
  }
  response.results = page;
  return response;
}

module.exports = {
  FRESHNESS_PRIOR,
  LOW_CONFIDENCE_COVERAGE,
  SEARCH_MODES,
  applyFilters,
  searchConcepts,
};
