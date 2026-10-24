"use strict";

// Per-query section scoring for context assembly (plan C-1, WP3a). Only the
// sections of the candidate concepts are scored, on the fly: no section
// index, no per-index corpus, nothing to rebuild after a write. The query is
// the 0.10 analysis (`analyzeQuery`: stop words and single letters dropped,
// plain terms folded and stemmed, quoted and identifier-like terms literal),
// and each section is read the way the lexical index reads a document: tokens
// split on spaces, punctuation and symbols, lower-cased and diacritic-folded,
// plus one stem per language of the concept's bundle. A plain term counts
// where any of its forms meets any form of a token; a literal term counts
// once per adjacent run of its pieces, or once when the whole compound is an
// exact token of the field. Never through a stem.
//
// Evidence comes in two tiers. Own text: the section's text (on the
// preamble, which stands for the concept, also its aliases and identifiers;
// elsewhere the heading as an exact token). Concept metadata: the type, tags,
// path and identifiers every section of the concept shares. The primary score
// is BM25 (k1 1.2, b 0.75) over own text only, with document frequency and
// average length taken from the candidate sections, so a term common to every
// candidate section weighs little; `coverage` and the matched terms are
// own-text only. Metadata adds a bonus of at most 20% of the own-text score,
// in proportion to the IDF weight of the terms only metadata matched. A
// section with no own-text match is kept (a runbook's "Steps" rarely repeats
// its title) but as tier 0, which the caller ranks below every own-text
// section of the same concept. The preamble's own score is multiplied by
// `preambleWeight`: it carries the concept title, description and aliases,
// which match most queries that selected the concept and would otherwise take
// rank 1 over the section that answers.

const { exactTokens } = require("../search/lexical");
const { foldDiacritics, stemForms } = require("../search/languages");

const K1 = 1.2;
const B = 0.75;
// Ceiling of the metadata bonus as a share of the own-text score.
const METADATA_BONUS = 0.2;
// The splitter of src/search/lexical.js: spaces, punctuation and symbols.
const TOKEN_SEPARATORS = /[\n\r\p{Z}\p{P}\p{S}]+/u;

const lowerTokens = (text) =>
  String(text || "")
    .split(TOKEN_SEPARATORS)
    .filter(Boolean)
    .map((token) => token.toLowerCase());

const customIdPath = (customId) =>
  customId ? String(customId).replace(/^okf:\/\/[^/]+\//, "") : "";

// The values the lexical index treats as identifiers, for the preamble.
function exactSegments(doc) {
  return [doc.conceptId, customIdPath(doc.customId), doc.path, doc.title]
    .concat(doc.aliases || [])
    .filter(Boolean)
    .map((value) => String(value).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// One evidence field: folded tokens (for literal runs), their forms with
// stems (for plain terms) and the exact tokens (for whole literals).
function evidenceField(lower, identifiers, stemsOf) {
  return {
    folded: lower.map((token) => foldDiacritics(token)),
    forms: lower.map(stemsOf),
    exact: new Set(exactTokens(identifiers.filter(Boolean).join("\n"))),
  };
}

// A section's own text and its concept's shared metadata. Stems are memoised
// per call and language set by `stemsOf`.
function sectionFields(doc, section, stemsOf) {
  const preamble = section.heading === null;
  const own = evidenceField(
    lowerTokens(preamble ? [section.text].concat(doc.aliases || []).join("\n") : section.text),
    preamble ? exactSegments(doc) : [section.heading],
    stemsOf,
  );
  const metadata = evidenceField(
    lowerTokens([doc.type, (doc.tags || []).join(" "), doc.path].join("\n")),
    [doc.conceptId, customIdPath(doc.customId), doc.path],
    stemsOf,
  );
  return { own, metadata };
}

function runCount(folded, pieces) {
  if (!pieces.length || pieces.length > folded.length) {
    return 0;
  }
  let count = 0;
  for (let start = 0; start + pieces.length <= folded.length; start += 1) {
    let match = true;
    for (let offset = 0; offset < pieces.length && match; offset += 1) {
      match = folded[start + offset] === pieces[offset];
    }
    if (match) {
      count += 1;
    }
  }
  return count;
}

// Term frequency of every analysed term in one field.
function termFrequencies(field, terms, leafOwners) {
  const tf = new Array(terms.length).fill(0);
  for (const forms of field.forms) {
    const seen = new Set();
    for (const leaf of forms) {
      for (const owner of leafOwners.get(leaf) || []) {
        if (!seen.has(owner)) {
          seen.add(owner);
          tf[owner] += 1;
        }
      }
    }
  }
  terms.forEach((term, position) => {
    if (term.kind !== "plain") {
      const runs = runCount(field.folded, term.pieces);
      tf[position] = field.exact.has(term.literal) ? Math.max(1, runs) : runs;
    }
  });
  return tf;
}

function formsFor(languages, cache) {
  return (lower) => {
    let forms = cache.get(lower);
    if (!forms) {
      const folded = foldDiacritics(lower);
      forms = [folded].concat(stemForms(lower, languages));
      cache.set(lower, forms);
    }
    return forms;
  };
}

function leafOwnersOf(terms) {
  const owners = new Map();
  terms.forEach((term, position) => {
    if (term.kind !== "plain") {
      return;
    }
    term.leaves.forEach((leaf) => {
      if (!owners.has(leaf)) {
        owners.set(leaf, []);
      }
      if (!owners.get(leaf).includes(position)) {
        owners.get(leaf).push(position);
      }
    });
  });
  return owners;
}

// entries: [{ doc, section, ... }]; analysis: analyzeQuery's result;
// languagesFor(bundle): the stemming languages of a concept's bundle.
// Returns, for every entry with evidence in either tier,
// { entry, tier, score, metadataShare, coverage, positions }: tier 1 with
// `score` the weighted own-text score plus the metadata bonus; tier 0 with
// score 0 and `metadataShare` (the IDF share of the terms metadata matched),
// for the caller to place below its concept's tier-1 sections. `positions`
// index own-text terms.
function scoreSections(entries, analysis, options) {
  const config = options || {};
  const preambleWeight = config.preambleWeight === undefined ? 1 : config.preambleWeight;
  const terms = analysis.tokens;
  if (!terms.length || !entries.length) {
    return [];
  }
  const leafOwners = leafOwnersOf(terms);
  const formCaches = new Map();
  const stemsFor = (bundle) => {
    const languages = config.languagesFor ? config.languagesFor(bundle) : [];
    const key = languages.join(",");
    if (!formCaches.has(key)) {
      formCaches.set(key, formsFor(languages, new Map()));
    }
    return formCaches.get(key);
  };
  const rows = entries.map((entry) => {
    const fields = sectionFields(entry.doc, entry.section, stemsFor(String(entry.doc.bundle)));
    return {
      entry,
      own: termFrequencies(fields.own, terms, leafOwners),
      metadata: termFrequencies(fields.metadata, terms, leafOwners),
      length: Math.max(1, fields.own.folded.length),
    };
  });
  const count = rows.length;
  const averageLength = rows.reduce((sum, row) => sum + row.length, 0) / count;
  const idfOver = (matches) =>
    terms.map((_, position) => {
      const df = rows.filter((row) => matches(row, position)).length;
      return Math.log(1 + (count - df + 0.5) / (df + 0.5));
    });
  const idf = idfOver((row, position) => row.own[position] > 0);
  // Metadata weights: IDF over either tier, so a term only metadata carries counts.
  const anyIdf = idfOver((row, position) => row.own[position] > 0 || row.metadata[position] > 0);
  const anyTotal = anyIdf.reduce((sum, value) => sum + value, 0) || 1;
  const scored = [];
  rows.forEach((row) => {
    const positions = [];
    let own = 0;
    let metadataWeight = 0;
    row.own.forEach((frequency, position) => {
      if (frequency) {
        positions.push(position);
        const norm = K1 * (1 - B + (B * row.length) / averageLength);
        own += (idf[position] * (frequency * (K1 + 1))) / (frequency + norm);
      } else if (row.metadata[position]) {
        metadataWeight += anyIdf[position];
      }
    });
    const metadataShare = metadataWeight / anyTotal;
    if (!positions.length && !metadataShare) {
      return;
    }
    if (row.entry.section.heading === null) {
      own *= preambleWeight;
    }
    scored.push({
      entry: row.entry,
      tier: positions.length ? 1 : 0,
      score: positions.length ? own * (1 + METADATA_BONUS * metadataShare) : 0,
      metadataShare,
      coverage: positions.length / terms.length,
      positions,
    });
  });
  return scored;
}

module.exports = { METADATA_BONUS, scoreSections };
