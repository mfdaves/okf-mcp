"use strict";

const { conceptSummary } = require("./indexer");
const { normalizeV02Signals } = require("./v02");
const { resolveConcept } = require("./indexer");

function lower(value) {
  return String(value || "").toLowerCase();
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
    JSON.stringify(doc.frontmatter),
    doc.body,
  ].join("\n");
}

function snippetFor(doc, query) {
  if (!query) {
    return "";
  }
  const text = docText(doc).replace(/\s+/g, " ");
  const idx = lower(text).indexOf(lower(query));
  if (idx === -1) {
    return "";
  }
  const start = Math.max(0, idx - 50);
  return text.slice(start, idx + query.length + 80).trim();
}

function linkedSets(index) {
  const outbound = new Map();
  const inbound = new Map();
  index.edges.filter((edge) => !edge.broken).forEach((edge) => {
    if (!outbound.has(edge.source)) {
      outbound.set(edge.source, new Set());
    }
    if (!inbound.has(edge.target)) {
      inbound.set(edge.target, new Set());
    }
    outbound.get(edge.source).add(edge.target);
    inbound.get(edge.target).add(edge.source);
  });
  return { outbound, inbound };
}

function signalsForDoc(doc, asOf) {
  if (!asOf) {
    return doc.signals || {};
  }
  const signals = normalizeV02Signals(doc, { asOf });
  if (signals.computation && doc.signals && doc.signals.computation) {
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
  const { outbound, inbound } = linkedSets(index);
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
    if (config.orphanOnly && ((outbound.get(doc.uri) || new Set()).size > 0 || (inbound.get(doc.uri) || new Set()).size > 0)) {
      return false;
    }
    if (config.relationType) {
      const hasRelation = index.edges.some((edge) => (
        !edge.broken &&
        edge.source === doc.uri &&
        edge.kind === "relation" &&
        lower(edge.relationType) === lower(config.relationType)
      ));
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
    if (config.hasSources !== undefined && Boolean(signals.sources && signals.sources.length) !== config.hasSources) {
      return false;
    }
    if (config.runtime && lower(signals.computation && signals.computation.runtime) !== lower(config.runtime)) {
      return false;
    }
    if (config.attestationReady !== undefined
      && Boolean(signals.computation && signals.computation.attestationReady) !== config.attestationReady) {
      return false;
    }
    if (config.generatedBy && lower(signals.generated && signals.generated.by) !== lower(config.generatedBy)) {
      return false;
    }
    if (config.verifiedBy && !(signals.verifiedEvents || []).some((event) => lower(event.by) === lower(config.verifiedBy))) {
      return false;
    }
    return true;
  });
}

function scoreDoc(doc, query) {
  if (!query) {
    return 0;
  }
  const q = lower(query);
  let score = 0;
  if (lower(doc.title).includes(q)) {
    score += 8;
  }
  if (lower(doc.type).includes(q)) {
    score += 5;
  }
  if (doc.tags.some((tag) => lower(tag).includes(q))) {
    score += 4;
  }
  if (doc.aliases.some((alias) => lower(alias).includes(q))) {
    score += 4;
  }
  if (lower(doc.description).includes(q)) {
    score += 3;
  }
  if (lower(doc.path).includes(q)) {
    score += 2;
  }
  if (lower(doc.body).includes(q)) {
    score += 1;
  }
  return score;
}

function searchConcepts(index, options) {
  const config = options || {};
  const query = String(config.query || "").trim();
  const limit = Math.max(1, Math.min(Number(config.limit || 25), 250));
  const offset = Math.max(0, Number(config.offset || 0));
  let results = applyFilters(index, config).map((doc) => ({
    doc,
    score: scoreDoc(doc, query),
  }));
  if (query) {
    results = results.filter((entry) => entry.score > 0);
    results.sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path));
  } else {
    results.sort((a, b) => a.doc.path.localeCompare(b.doc.path));
  }
  const page = results.slice(offset, offset + limit).map((entry) => {
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
    return Object.assign(summary, {
      score: entry.score,
      snippet: snippetFor(entry.doc, query),
    });
  });
  return {
    total: results.length,
    limit,
    offset,
    results: page,
  };
}

module.exports = {
  applyFilters,
  searchConcepts,
};
