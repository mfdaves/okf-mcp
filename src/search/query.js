"use strict";

const { conceptSummary, edgesBySource, linkSets } = require("../indexer");
const { normalizeV02Signals } = require("../v02");
const { resolveConcept } = require("../indexer");
const { foldDiacritics } = require("./languages");
const { analyzeQuery, prepareSearchIndex, runQuery, searchLanguages } = require("./lexical");
const { denseSearch } = require("./dense");
const { fuseRankings, fusionNormalization, resolveAlpha } = require("./fusion");
const { LOW_CONFIDENCE_COVERAGE, assessConfidence } = require("./confidence");

const MAX_COMPACT_TEXT = 500;
// `auto` runs the all-term query first; when it yields fewer than `autoFill`
// hits, the any-term results follow the all-term hits (R-1). It is the
// default since 0.10 (section 10). With no all-term hit the page is the
// any-term ranking (mode "any"); with some, the all-term hits keep their order
// and precedence and the any-term results are appended (mode "auto"); with
// `autoFill` or more, only the all-term hits are returned (mode "all").
const SEARCH_MODES = Object.freeze(["auto", "all", "any"]);
// 0.11.0-rc.2: a single long document that happens to contain every term must
// not hide the documents that match most of them.
const DEFAULT_AUTO_FILL = 3;
const MAX_AUTO_FILL = 250;
// R-4: a response is flagged when the any-term fallback produced it and its
// top result matched strictly fewer than half of the query terms; with the
// semantic side, also when no candidate is similar enough (./confidence.js).
// R-6: optional score multipliers, off by default, applied only when the
// signal is present on the document.
const FRESHNESS_PRIOR = Object.freeze({ deprecated: 0.5, stale: 0.7, draft: 0.85 });
// R-10: how many dense neighbours join the lexical hits before fusion. Fixed,
// independent of offset and limit, so every page of one query paginates the
// same candidate set: total and order are identical across pages.
const DENSE_DEPTH = 200;

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

// Precedence: explicit search option, then the project's `autoFill`, then
// DEFAULT_AUTO_FILL. 0 restores the 0.10 behaviour (fall back only on zero).
function autoFillOption(value, index) {
  let raw = value;
  if (raw === undefined || raw === null) {
    raw = index?.project?.autoFill;
  }
  if (raw === undefined || raw === null) {
    return DEFAULT_AUTO_FILL;
  }
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_AUTO_FILL) {
    throw new TypeError(`autoFill must be an integer between 0 and ${MAX_AUTO_FILL}.`);
  }
  return number;
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
// scores before ranking; `relevance` is score over the best score shown, and
// the floors drop results below either value after that. Under `auto` the
// all-term hits lead in their own order and, when there are fewer than
// `autoFill` of them, the remaining any-term hits follow in theirs: both
// passes run over the whole filtered set, so the candidate list, and every
// page cut from it, does not depend on offset or limit.
function rankQuery(index, config, analysis, docsByUri) {
  const searchIndex = prepareSearchIndex(index, config);
  const run = (combineWith) =>
    runQuery(searchIndex, analysis.tokens, {
      combineWith,
      filter: (result) => docsByUri.has(String(result.id)),
      document: (id) => docsByUri.get(id),
    });
  const prior = config.freshnessPrior ? (doc) => priorFactor(doc, config.asOf) : () => 1;
  const ranked = (hits) => {
    const list = hits
      .filter((hit) => docsByUri.has(hit.id))
      .map((hit) => {
        const doc = docsByUri.get(hit.id);
        return Object.assign({ doc }, hit, { score: hit.score * prior(doc) });
      });
    list.sort((a, b) => b.score - a.score || compareDocs(a.doc, b.doc));
    return list;
  };
  let results;
  let mode;
  let allTermsTotal;
  // URIs of the all-term hits when the all-term pass ran (the literal guard's group).
  let allTermUris = null;
  if (config.mode === "any") {
    results = ranked(run("OR"));
    mode = "any";
    allTermsTotal = results.filter((hit) => hit.coverage === 1).length;
  } else {
    results = ranked(run("AND"));
    mode = "all";
    allTermsTotal = results.length;
    allTermUris = new Set(results.map((entry) => entry.doc.uri));
    if (config.mode === "auto" && results.length < config.autoFill) {
      const fill = ranked(run("OR")).filter((entry) => !allTermUris.has(entry.doc.uri));
      if (!results.length) {
        results = fill;
        mode = "any";
        allTermUris = null;
      } else if (fill.length) {
        results = results.concat(fill);
        mode = "auto";
      }
    }
  }
  const top = results.reduce((best, entry) => Math.max(best, entry.score), 0);
  results.forEach((entry) => {
    entry.relevance = top > 0 ? entry.score / top : 0;
  });
  // Lexical evidence (matched terms, coverage, score) for candidates the
  // lexical pass did not return: dense neighbours that match only some terms
  // under an all-term pass. An any-term pass (alone or appended) already
  // holds every match.
  const evidence = (uris) => {
    if (mode !== "all" || !uris.size) return [];
    const subset = new Map(Array.from(uris, (uri) => [uri, docsByUri.get(uri)]));
    return runQuery(searchIndex, analysis.tokens, {
      combineWith: "OR",
      filter: (result) => subset.has(String(result.id)),
      document: (id) => subset.get(id),
    })
      .filter((hit) => subset.has(hit.id))
      .map((hit) => {
        const doc = subset.get(hit.id);
        return Object.assign({ doc }, hit, { score: hit.score * prior(doc) });
      })
      .sort((a, b) => b.score - a.score || compareDocs(a.doc, b.doc));
  };
  return {
    results: applyFloors(results, config),
    mode,
    allTermsTotal,
    allTermUris,
    unfloored: results,
    evidence,
  };
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
//
// Literal guard: when the all-term pass ran and the query carries literal
// terms (quoted or identifier-like), the all-term hits keep precedence over
// every other candidate; fusion orders each group. Exact lookups then never
// lose a document that contains the identifier to a semantic neighbour.
function hybridRank(index, config, ranking, filteredDocs, analysis) {
  const lexical = ranking.unfloored;
  const passUris = new Set(lexical.map((entry) => entry.doc.uri));
  const byUri = new Map(lexical.map((entry) => [entry.doc.uri, entry]));
  const candidates = config.mode === "all" ? lexical.map((entry) => entry.doc) : filteredDocs;
  const prior = config.freshnessPrior ? (doc) => priorFactor(doc, config.asOf) : null;
  const docs = new Map(candidates.map((doc) => [doc.uri, doc]));
  const nearest = denseSearch(index, {
    queryVector: config.queryVector,
    cache: config.vectorCache,
    units: config.embedUnits,
    candidates,
    limit: DENSE_DEPTH,
  });
  // The best raw cosine over the candidates, before any prior (abstention, WP3c-2).
  const topSimilarity = nearest.length ? nearest[0].score : null;
  const dense = nearest.map((entry) => {
    // R-6 multiplies scores; a negative cosine is divided so it still drops.
    const factor = prior ? prior(docs.get(entry.id)) : 1;
    const score = entry.score >= 0 ? entry.score * factor : entry.score / factor;
    return { id: entry.id, score, unit: entry.unit };
  });
  const units = new Map(dense.map((entry) => [entry.id, entry.unit]));
  // One weight per query (WP3c-2): fixed, or chosen by the adaptive rule from
  // the lexical pass, which does not depend on offset or limit.
  const choice = resolveAlpha(
    config.alpha,
    {
      literal:
        ranking.allTermUris !== null &&
        ranking.allTermUris.size > 0 &&
        analysis.tokens.some((token) => token.kind !== "plain"),
      allTermsTotal: ranking.allTermsTotal,
      autoFill: config.autoFill,
      topCoverage: lexical.reduce((best, entry) => Math.max(best, entry.coverage || 0), 0),
    },
    config.adaptiveAlpha,
  );
  const alpha = choice.alpha;
  // Partial matches among the dense neighbours join the lexical side after
  // the pass's hits (never at alpha 0, which must reproduce the lexical list).
  const extra =
    alpha > 0
      ? ranking.evidence(new Set(dense.map((entry) => entry.id).filter((id) => !passUris.has(id))))
      : [];
  const top = lexical.length ? lexical[0].score : 0;
  extra.forEach((entry) => {
    entry.relevance = top > 0 ? entry.score / top : 0;
    byUri.set(entry.doc.uri, entry);
  });
  const fused = fuseRankings({
    lexical: lexical.concat(extra).map((entry) => ({ id: entry.doc.uri, score: entry.score })),
    dense,
    alpha,
    normalization: config.fusionNormalization,
  });
  // Not at alpha 1, which must reproduce the dense ranking exactly. At alpha
  // 0 the all-term hits lead whatever the terms, as in the lexical ranking
  // (auto appends the any-term results after them), which alpha 0 must
  // reproduce.
  const guard =
    alpha < 1 &&
    ranking.allTermUris !== null &&
    ranking.allTermUris.size > 0 &&
    (alpha === 0 || analysis.tokens.some((token) => token.kind !== "plain"));
  if (guard) {
    const group = (entry) => (ranking.allTermUris.has(entry.id) ? 0 : 1);
    // Array.prototype.sort is stable: fused order holds within each group.
    fused.sort((a, b) => group(a) - group(b));
  }
  const best = fused.length ? Math.max(...fused.map((entry) => entry.fusedScore)) : 0;
  const results = fused.map((entry) => {
    const hit = byUri.get(entry.id);
    const base = hit
      ? Object.assign({}, hit, { lexicalRelevance: hit.relevance })
      : { doc: docs.get(entry.id), positions: [], coverage: 0, lexicalRelevance: 0 };
    return Object.assign(base, {
      score: entry.fusedScore,
      relevance: best > 0 ? entry.fusedScore / best : 0,
      lexicalScore: entry.lexicalScore,
      denseScore: entry.denseScore,
      fusedScore: entry.fusedScore,
      unit: units.get(entry.id),
    });
  });
  return {
    results: applyFloors(results, config),
    alpha,
    alphaReason: choice.reason,
    topSimilarity,
  };
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
    autoFill: autoFillOption(options?.autoFill, index),
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
  let fusion = null;
  if (analysis.query) {
    if (!analysis.tokens.length) {
      // Punctuation-only text: nothing to run, reported under the requested mode.
      results = [];
      ranking = {
        mode: config.mode === "any" ? "any" : "all",
        allTermsTotal: 0,
        allTermUris: null,
        results,
      };
    } else {
      const docsByUri = new Map(filteredDocs.map((doc) => [doc.uri, doc]));
      ranking = rankQuery(index, config, analysis, docsByUri);
      hybrid = config.hybrid === true && Boolean(config.queryVector && config.vectorCache);
      fusion = hybrid ? hybridRank(index, config, ranking, filteredDocs, analysis) : null;
      results = hybrid ? fusion.results : ranking.results;
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
    // lowConfidence reads the displayed top result's coverage (lexical
    // evidence is computed for every candidate, dense ones included) and,
    // when the semantic side ran, the best similarity (WP3c-2).
    const confidence = assessConfidence(
      {
        mode: ranking.mode,
        coverage: results.length ? results[0].coverage : null,
        topSimilarity: hybrid ? fusion.topSimilarity : null,
      },
      config.minSimilarity,
    );
    Object.assign(response, {
      mode: ranking.mode,
      allTermsTotal: ranking.allTermsTotal,
      lowConfidence: confidence.lowConfidence,
      queryTerms: analysis.terms,
      droppedTerms: analysis.dropped,
      confidence,
    });
    if (hybrid) {
      Object.assign(response, {
        hybrid: true,
        alpha: fusion.alpha,
        normalization: fusionNormalization(config.fusionNormalization),
        // WP3c-2: the weight this query used and why (`fixed` unless adaptive).
        alphaUsed: fusion.alpha,
        alphaReason: fusion.alphaReason,
      });
    }
  }
  response.results = page;
  return response;
}

module.exports = {
  DEFAULT_AUTO_FILL,
  FRESHNESS_PRIOR,
  LOW_CONFIDENCE_COVERAGE,
  SEARCH_MODES,
  applyFilters,
  searchConcepts,
};
