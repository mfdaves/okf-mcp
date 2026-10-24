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
// exact token of the section (identifiers, path, title and aliases on the
// preamble; the heading elsewhere). Never through a stem.
//
// Score: BM25 (k1 1.2, b 0.75) over the candidate sections, document
// frequency and average length taken from that same set, so a term common to
// every candidate section weighs little. The preamble's score is multiplied by
// `preambleWeight`: it carries the concept title, description and aliases,
// which match most queries that selected the concept and would otherwise take
// rank 1 over the section that answers.

const { exactTokens } = require("../search/lexical");
const { foldDiacritics, stemForms } = require("../search/languages");

const K1 = 1.2;
const B = 0.75;
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

// The section as the lexical index would read it: its own text (plus the
// aliases on the preamble), and the concept fields every section shares
// (type, tags, path), so a section is found by what its concept is about even
// when it never repeats the concept's name. `folded` (for literal runs) holds
// the section text only; `forms` (for plain terms and length) holds both.
// Stems are memoised per call and language set by `stemsOf`.
function sectionTokens(doc, section, stemsOf) {
  const preamble = section.heading === null;
  const own = lowerTokens(
    preamble ? [section.text].concat(doc.aliases || []).join("\n") : section.text,
  );
  const shared = lowerTokens([doc.type, (doc.tags || []).join(" "), doc.path].join("\n"));
  const identifiers = preamble
    ? exactSegments(doc)
    : [doc.conceptId, customIdPath(doc.customId), doc.path, section.heading];
  return {
    folded: own.map((token) => foldDiacritics(token)),
    forms: own.concat(shared).map(stemsOf),
    exact: new Set(exactTokens(identifiers.filter(Boolean).join("\n"))),
  };
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

// Term frequency of every analysed term in one section.
function termFrequencies(tokens, terms, leafOwners) {
  const tf = new Array(terms.length).fill(0);
  for (const forms of tokens) {
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

// entries: [{ doc, section, ... }]; analysis: analyzeQuery's result;
// languagesFor(bundle): the stemming languages of a concept's bundle.
// Returns, for every entry matching at least one term, { entry, score,
// coverage, positions } with positions the indexes of the matched terms.
function scoreSections(entries, analysis, options) {
  const config = options || {};
  const preambleWeight = config.preambleWeight === undefined ? 1 : config.preambleWeight;
  const terms = analysis.tokens;
  if (!terms.length || !entries.length) {
    return [];
  }
  const leafOwners = new Map();
  terms.forEach((term, position) => {
    if (term.kind !== "plain") {
      return;
    }
    term.leaves.forEach((leaf) => {
      if (!leafOwners.has(leaf)) {
        leafOwners.set(leaf, []);
      }
      if (!leafOwners.get(leaf).includes(position)) {
        leafOwners.get(leaf).push(position);
      }
    });
  });
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
    const tokens = sectionTokens(entry.doc, entry.section, stemsFor(String(entry.doc.bundle)));
    const tf = termFrequencies(tokens.forms, terms, leafOwners);
    terms.forEach((term, position) => {
      if (term.kind !== "plain") {
        const runs = runCount(tokens.folded, term.pieces);
        tf[position] = tokens.exact.has(term.literal) ? Math.max(1, runs) : runs;
      }
    });
    return { entry, tf, length: Math.max(1, tokens.forms.length) };
  });
  const count = rows.length;
  const averageLength = rows.reduce((sum, row) => sum + row.length, 0) / count;
  const idf = terms.map((_, position) => {
    const df = rows.filter((row) => row.tf[position] > 0).length;
    return Math.log(1 + (count - df + 0.5) / (df + 0.5));
  });
  const scored = [];
  rows.forEach((row) => {
    const positions = [];
    let score = 0;
    row.tf.forEach((frequency, position) => {
      if (!frequency) {
        return;
      }
      positions.push(position);
      const norm = K1 * (1 - B + (B * row.length) / averageLength);
      score += (idf[position] * (frequency * (K1 + 1))) / (frequency + norm);
    });
    if (!positions.length) {
      return;
    }
    if (row.entry.section.heading === null) {
      score *= preambleWeight;
    }
    scored.push({ entry: row.entry, score, coverage: positions.length / terms.length, positions });
  });
  return scored;
}

module.exports = { scoreSections };
