"use strict";

// Lexical index over an OKF index (plan R-1, R-2, R-3, R-5): one MiniSearch
// instance per OKF index and language setting, built lazily and cached in a
// WeakMap. Languages are detected per bundle (the union of languages present
// in at least 5% of that bundle's documents) unless configured; each document
// is stemmed with its own bundle's set and queries with the union of all sets
// (or the filtered bundle's set). Text fields keep the raw token (diacritics
// folded) plus one stem per language; the `exact` field (path, identifiers,
// aliases, raw title tokens) is literal: never stemmed, folded or
// stop-worded. Query time folds, drops stop words and single letters, and
// stems every plain term; quoted text and identifier-looking tokens are
// literal terms that only count when the whole compound is in the exact
// field or their pieces form an adjacent run in one field's raw tokens,
// never through a stem. One BM25 tree scores the query; coverage is counted
// over logical terms after that verification.

const MiniSearch = require("minisearch");
const {
  detectLanguages,
  foldDiacritics,
  normalizeLanguages,
  stemForms,
  stopWordsFor,
} = require("./languages");

const MAX_QUERY_CHARACTERS = 512;
const MAX_QUERY_TERMS = 16;
const EXACT_FIELD = "exact";
const TEXT_FIELDS = Object.freeze([
  "title",
  "type",
  "tags",
  "aliases",
  "description",
  "path",
  "body",
]);
const SEARCH_FIELDS = Object.freeze(TEXT_FIELDS.concat([EXACT_FIELD]));
const SEARCH_BOOSTS = Object.freeze({
  title: 8,
  type: 5,
  tags: 4,
  aliases: 4,
  description: 3,
  path: 2,
  body: 1,
  exact: 6,
});
// Body characters sampled per document for language detection.
const DETECTION_SAMPLE_CHARACTERS = 4000;
// Distinct tokens whose index forms are memoised per language set.
const TERM_FORMS_CACHE_LIMIT = 50000;
// Documents whose raw token streams are kept for literal-term verification.
const STREAM_CACHE_LIMIT = 2000;
// OKF index -> { detection, variants: Map<language key, variant> }
const SEARCH_INDEXES = new WeakMap();
// MiniSearch instance -> Map<document id, { text, exact }>
const STREAM_CACHES = new WeakMap();
// Separates fields in the cached text: a control character is never part of
// a token and never a separator, so an adjacent run cannot cross it.
const FIELD_BREAK = "\n\u0001\n";
const SEPARATOR_CLASS = "[\\n\\r\\p{Z}\\p{P}\\p{S}]";
// MiniSearch's default tokenizer splits on space and punctuation only; symbols
// such as Markdown backticks would stay glued to code-formatted terms
// ("`kill"), so the lexical index splits on symbols as well, everywhere.
const TOKEN_SEPARATORS = /[\n\r\p{Z}\p{P}\p{S}]+/u;
const tokenize = (text) => String(text).split(TOKEN_SEPARATORS).filter(Boolean);
const identity = (value) => value;
const identityTokenize = (text) => [text];
// Leaves are pre-processed; MiniSearch must neither tokenize nor expand them.
const LEAF_OPTIONS = Object.freeze({
  tokenize: identityTokenize,
  processTerm: identity,
  prefix: false,
  fuzzy: false,
});
// Query pieces in order: "double quoted", “typographic quoted”, or a run of
// characters that are neither spaces nor quotes, so punctuation around a
// quoted group never swallows it.
const QUERY_PIECES = /"([^"]*)"|“([^”]*)”|([^\s"“”]+)/gu;
// An unquoted chunk that looks like an identifier: digits or an internal hyphen.
const IDENTIFIER_CHUNK = /\p{N}|[\p{L}\p{N}]-[\p{L}\p{N}]/u;
// An indexed chunk kept whole beside its pieces: an internal hyphen, underscore or dot.
const IDENTIFIER_SEGMENT = /[\p{L}\p{N}][-_.][\p{L}\p{N}]/u;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const FILE_EXTENSION = /\.[a-z0-9]+$/;

const canonicalCodes = (codes) => Array.from(new Set(codes)).sort();
const languageKey = (codes) => canonicalCodes(codes).join(",") || "none";
// Index normalisation of raw tokens: lower-cased, diacritics folded, no stems.
const rawTokens = (text) =>
  tokenize(String(text || "")).map((token) => foldDiacritics(token.toLowerCase()));

// A custom id is a full okf:// URI; only its concept path is an identifier.
function customIdPath(customId) {
  return customId ? String(customId).replace(/^okf:\/\/[^/]+\//, "") : "";
}

// One segment per identifier-bearing value; the exact tokenizer sees them
// separately so whole titles and aliases become tokens of their own.
function exactSegments(doc) {
  return [doc.conceptId, customIdPath(doc.customId), doc.path, doc.title]
    .concat(doc.aliases || [])
    .filter(Boolean)
    .map((value) => String(value).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function textFieldValues(doc) {
  return [
    String(doc.title || ""),
    String(doc.type || ""),
    (doc.tags || []).join(" "),
    (doc.aliases || []).join(" "),
    String(doc.description || ""),
    String(doc.path || ""),
    String(doc.body || ""),
  ];
}

function searchDocument(doc) {
  const [title, type, tags, aliases, description, path, body] = textFieldValues(doc);
  return {
    id: doc.uri,
    title,
    type,
    tags,
    aliases,
    description,
    path,
    body,
    exact: exactSegments(doc).join("\n"),
  };
}

// Exact-field tokens are literal (lower-cased, diacritics kept): each segment
// as a whole, its default tokens, and every identifier chunk with and without
// a file extension, so "TRK-W-042" survives as one token beside "trk", "w"
// and "042".
function exactTokens(text) {
  const out = new Set();
  String(text)
    .split("\n")
    .forEach((line) => {
      const segment = line.trim().toLowerCase();
      if (!segment) {
        return;
      }
      out.add(segment);
      tokenize(segment).forEach((token) => {
        if (token) {
          out.add(token);
        }
      });
      segment.split(/[\s/]+/).forEach((chunk) => {
        const clean = chunk.replace(EDGE_PUNCTUATION, "");
        if (clean && IDENTIFIER_SEGMENT.test(clean)) {
          out.add(clean);
          const bare = clean.replace(FILE_EXTENSION, "");
          if (bare && bare !== clean) {
            out.add(bare);
          }
        }
      });
    });
  return Array.from(out);
}

function fieldTokenize(text, field) {
  return field === EXACT_FIELD ? exactTokens(text) : tokenize(text);
}

// Index-time term processing. `current` names the language set of the
// document being added (set by the variant before each add): the folded token
// plus its stems for text fields, the literal token for the exact field.
// Memoised per language set because catalog vocabulary repeats heavily.
function createTermProcessor(current) {
  const caches = new Map();
  return (term, field) => {
    if (field === EXACT_FIELD) {
      return term;
    }
    const lower = term.toLowerCase();
    if (!current.languages.length) {
      return foldDiacritics(lower);
    }
    let cache = caches.get(current.key);
    if (!cache) {
      cache = new Map();
      caches.set(current.key, cache);
    }
    let forms = cache.get(lower);
    if (forms === undefined) {
      const folded = foldDiacritics(lower);
      const stems = stemForms(lower, current.languages);
      forms = stems.length ? [folded].concat(stems) : folded;
      if (cache.size >= TERM_FORMS_CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(lower, forms);
    }
    return forms;
  };
}

function detectionTokens(doc) {
  const text = [
    doc.title,
    doc.description,
    String(doc.body || "").slice(0, DETECTION_SAMPLE_CHARACTERS),
  ]
    .map((value) => String(value || ""))
    .join("\n");
  return tokenize(text).map((token) => token.toLowerCase());
}

function indexState(index) {
  let state = SEARCH_INDEXES.get(index);
  if (!state) {
    state = { detection: null, variants: new Map() };
    SEARCH_INDEXES.set(index, state);
  }
  return state;
}

// Bundle-level detection (R-2): each bundle's set from its own documents; the
// union stems queries.
function detectIndexLanguages(index, state) {
  if (!state.detection) {
    const tokenLists = new Map();
    index.concepts.forEach((doc) => {
      const bundle = String(doc.bundle);
      if (!tokenLists.has(bundle)) {
        tokenLists.set(bundle, []);
      }
      tokenLists.get(bundle).push(detectionTokens(doc));
    });
    const bundles = {};
    const union = new Set();
    Array.from(tokenLists.keys())
      .sort()
      .forEach((bundle) => {
        bundles[bundle] = detectLanguages(tokenLists.get(bundle));
        bundles[bundle].languages.forEach((code) => {
          union.add(code);
        });
      });
    state.detection = { bundles, languages: canonicalCodes(Array.from(union)) };
  }
  return state.detection;
}

// Precedence: explicit option, `index.languages` (CLI --languages),
// `index.project.languages` (project config), then per-bundle detection.
function requestedLanguages(index, options) {
  let value;
  if (options && options.languages !== undefined) {
    value = options.languages;
  } else if (index.languages !== undefined) {
    value = index.languages;
  } else if (index.project && index.project.languages !== undefined) {
    value = index.project.languages;
  }
  const normalized = normalizeLanguages(value);
  return normalized === "auto" ? "auto" : canonicalCodes(normalized);
}

// The effective setting: the union used for queries, a per-bundle lookup for
// documents, and the cache key (canonical, so ["it","en"] and ["en","it"]
// share one index).
function languagePlan(index, options) {
  const requested = requestedLanguages(index, options);
  if (requested !== "auto") {
    return {
      requested,
      languages: requested,
      key: languageKey(requested),
      bundles: null,
      languagesFor: () => requested,
    };
  }
  const detection = detectIndexLanguages(index, indexState(index));
  return {
    requested,
    languages: detection.languages,
    key: "auto",
    bundles: detection.bundles,
    languagesFor: (bundle) =>
      detection.bundles[bundle] ? detection.bundles[bundle].languages : detection.languages,
  };
}

// Languages a query is analysed with: the filtered bundle's own set when a
// `bundle` filter is given and detection ran, otherwise the union.
function searchLanguages(index, options) {
  const plan = languagePlan(index, options);
  const bundle = options?.bundle;
  if (bundle && plan.bundles?.[String(bundle)]) {
    return canonicalCodes(plan.bundles[String(bundle)].languages);
  }
  return plan.languages;
}

function buildVariant(index, plan) {
  const current = { languages: [], key: "none" };
  const searchIndex = new MiniSearch({
    fields: SEARCH_FIELDS,
    idField: "id",
    tokenize: fieldTokenize,
    processTerm: createTermProcessor(current),
    searchOptions: {
      boost: SEARCH_BOOSTS,
      combineWith: "AND",
    },
  });
  const upsert = (doc) => {
    current.languages = plan.languagesFor(String(doc.bundle));
    current.key = languageKey(current.languages);
    const document = searchDocument(doc);
    if (searchIndex.has(document.id)) {
      searchIndex.replace(document);
    } else {
      searchIndex.add(document);
    }
    const streams = STREAM_CACHES.get(searchIndex);
    if (streams) {
      streams.delete(document.id);
    }
  };
  index.concepts.forEach(upsert);
  return { searchIndex, upsert, languages: plan.languages, bundles: plan.bundles };
}

function searchVariant(index, options) {
  const state = indexState(index);
  const plan = languagePlan(index, options);
  let variant = state.variants.get(plan.key);
  if (!variant) {
    variant = buildVariant(index, plan);
    state.variants.set(plan.key, variant);
  }
  return variant;
}

function prepareSearchIndex(index, options) {
  return searchVariant(index, options).searchIndex;
}

// What a search over `index` would use, without building anything but the
// detection pass: the requested setting, the effective union, and per-bundle
// sets with document counts when detection ran.
function describeSearchIndex(index, options) {
  const plan = languagePlan(index, options);
  return { requested: plan.requested, languages: plan.languages, bundles: plan.bundles };
}

const isSingleLetter = (token) => token.length === 1 && !/\d/.test(token);

function plainTerm(raw, languages) {
  const folded = foldDiacritics(raw);
  const forms = [folded].concat(stemForms(raw, languages));
  return {
    kind: "plain",
    raw,
    literal: raw,
    forms,
    pieces: [],
    leaves: [raw].concat(forms),
    snippetTerms: [folded],
    stems: forms.slice(1),
  };
}

// Quoted text and identifier-looking chunks: the lower-cased literal as a
// whole (accents kept, for the exact field) plus its pieces folded the way
// the text fields index raw tokens; nothing stemmed or dropped.
function literalTerm(kind, text) {
  const literal = text.toLowerCase().replace(/\s+/g, " ").trim();
  const pieces = rawTokens(literal);
  return {
    kind,
    raw: literal,
    literal,
    forms: [],
    pieces,
    leaves: [literal].concat(pieces),
    snippetTerms: [literal].concat(pieces),
    stems: [],
  };
}

// Query analysis (R-3): quoted spans and identifier-looking chunks become
// literal terms; other chunks are tokenised, lower-cased, and lose stop words
// of the configured languages and single letters (reported as `dropped`).
// When nothing would be left, the dropped tokens are searched literally
// instead of returning nothing; the term limit counts what is left.
function analyzeQuery(value, options) {
  const config = options || {};
  const query = String(value || "").trim();
  if (Array.from(query).length > MAX_QUERY_CHARACTERS) {
    throw new TypeError(`Search query must not exceed ${MAX_QUERY_CHARACTERS} characters.`);
  }
  const languages = config.languages || [];
  const stopWords = config.stopWords || stopWordsFor(languages);
  const tokens = [];
  const dropped = [];
  const seen = new Set();
  const push = (term) => {
    const key = `${term.kind}:${term.raw}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(term);
    }
  };
  for (const piece of query.matchAll(QUERY_PIECES)) {
    const quoted = piece[1] !== undefined ? piece[1] : piece[2];
    if (quoted !== undefined) {
      const term = literalTerm("exact", quoted);
      if (term.pieces.length) {
        push(term);
      }
      continue;
    }
    const chunk = piece[3].replace(EDGE_PUNCTUATION, "");
    if (!chunk) {
      continue;
    }
    if (IDENTIFIER_CHUNK.test(chunk)) {
      push(literalTerm("identifier", chunk));
      continue;
    }
    tokenize(chunk)
      .map((token) => token.toLowerCase())
      .filter(Boolean)
      .forEach((token) => {
        if (isSingleLetter(token) || stopWords.has(token)) {
          if (!dropped.includes(token)) {
            dropped.push(token);
          }
          return;
        }
        push(plainTerm(token, languages));
      });
  }
  if (!tokens.length && dropped.length) {
    dropped.splice(0, dropped.length).forEach((token) => {
      push(plainTerm(token, languages));
    });
  }
  if (tokens.length > MAX_QUERY_TERMS) {
    throw new TypeError(`Search query must not exceed ${MAX_QUERY_TERMS} terms.`);
  }
  return { query, terms: tokens.map((term) => term.raw), tokens, dropped, languages };
}

// 0.9.1 shape ({ query, terms }) plus the analysis fields.
function normalizeSearchQuery(value, options) {
  return analyzeQuery(value, options);
}

// One term of the query tree. Plain terms: the literal against the exact
// field, the folded token and stems against the text fields (one node over
// every field when the literal needs no folding, so stems alone are kept
// away from the exact field). Literal terms: the whole compound against the
// exact field, or every piece somewhere in the document; the run is
// verified for adjacency afterwards.
function termNode(term) {
  if (term.kind === "plain") {
    const [folded, ...stems] = term.forms;
    if (term.literal === folded) {
      const queries = [{ combineWith: "OR", fields: SEARCH_FIELDS, queries: [folded] }];
      if (stems.length) {
        queries.push({ combineWith: "OR", fields: TEXT_FIELDS, queries: stems });
      }
      return queries.length === 1 ? queries[0] : { combineWith: "OR", queries };
    }
    return {
      combineWith: "OR",
      queries: [
        { combineWith: "OR", fields: [EXACT_FIELD], queries: [term.literal] },
        { combineWith: "OR", fields: TEXT_FIELDS, queries: term.forms },
      ],
    };
  }
  if (term.pieces.length === 1 && term.pieces[0] === term.literal) {
    return { combineWith: "OR", fields: SEARCH_FIELDS, queries: [term.literal] };
  }
  return {
    combineWith: "OR",
    queries: [
      { combineWith: "OR", fields: [EXACT_FIELD], queries: [term.literal] },
      { combineWith: "AND", fields: SEARCH_FIELDS, queries: term.pieces },
    ],
  };
}

function queryTree(tokens, combineWith) {
  return { combineWith, queries: tokens.map(termNode) };
}

// A document's text fields and exact segments in index normalisation
// (lower-cased, diacritics folded, no stems), joined by a control character
// no run can cross, plus its literal exact tokens; cached per MiniSearch
// instance for literal-term verification.
function documentText(searchIndex, id, doc) {
  let cache = STREAM_CACHES.get(searchIndex);
  if (!cache) {
    cache = new Map();
    STREAM_CACHES.set(searchIndex, cache);
  }
  let entry = cache.get(id);
  if (!entry) {
    const segments = exactSegments(doc);
    entry = {
      text: textFieldValues(doc)
        .concat(segments)
        .map((value) => foldDiacritics(value.toLowerCase()))
        .join(FIELD_BREAK),
      exact: new Set(exactTokens(segments.join("\n"))),
    };
    if (cache.size >= STREAM_CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(id, entry);
  }
  return entry;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches `pieces` as whole tokens, adjacent and in order, within one field.
function runPattern(pieces) {
  const run = pieces.map(escapeRegExp).join(`${SEPARATOR_CLASS}+`);
  return new RegExp(`(?:^|${SEPARATOR_CLASS})${run}(?=${SEPARATOR_CLASS}|$)`, "u");
}

// A literal term counts for a document only when the whole compound is one
// of its exact tokens or its pieces form an adjacent run in one of its
// fields; a stem never satisfies it. Documents the tree matched without the
// literal evidence are skipped before any normalisation.
function literalTermMatched(searchIndex, term, result, options) {
  const matchedLeaves = result.queryTerms;
  const evidence =
    matchedLeaves.includes(term.literal) ||
    term.pieces.every((piece) => matchedLeaves.includes(piece));
  if (!evidence) {
    return false;
  }
  const doc = options.document ? options.document(String(result.id)) : null;
  if (!doc) {
    return evidence;
  }
  const entry = documentText(searchIndex, String(result.id), doc);
  if (entry.exact.has(term.literal)) {
    return true;
  }
  if (!term.pattern) {
    term.pattern = runPattern(term.pieces);
  }
  return term.pattern.test(entry.text);
}

// One MiniSearch run over analysed terms. `combineWith` AND requires every
// logical term, OR accepts any. Prefix and fuzzy matching stay off (R-12).
// Plain terms are attributed through their matched leaves, literal terms
// through verification; each hit reports the raw terms it matched and the
// share of distinct logical terms matched. `options.document(id)` supplies
// documents for the verification.
function runQuery(searchIndex, tokens, options) {
  const config = options || {};
  const combineWith = config.combineWith === "OR" ? "OR" : "AND";
  // Leaf string -> positions of the plain terms it belongs to.
  const leafPositions = new Map();
  const literalPositions = [];
  tokens.forEach((term, position) => {
    if (term.kind !== "plain") {
      literalPositions.push(position);
      return;
    }
    term.leaves.forEach((leaf) => {
      if (!leafPositions.has(leaf)) {
        leafPositions.set(leaf, []);
      }
      leafPositions.get(leaf).push(position);
    });
  });
  const results = searchIndex.search(
    queryTree(tokens, combineWith),
    Object.assign({ filter: config.filter }, LEAF_OPTIONS),
  );
  const hits = [];
  results.forEach((result) => {
    const seen = new Array(tokens.length).fill(false);
    result.queryTerms.forEach((leaf) => {
      const owners = leafPositions.get(leaf);
      if (owners) {
        owners.forEach((position) => {
          seen[position] = true;
        });
      }
    });
    literalPositions.forEach((position) => {
      if (literalTermMatched(searchIndex, tokens[position], result, config)) {
        seen[position] = true;
      }
    });
    const positions = [];
    seen.forEach((flag, position) => {
      if (flag) {
        positions.push(position);
      }
    });
    if (!positions.length || (combineWith === "AND" && positions.length !== tokens.length)) {
      return;
    }
    hits.push({
      id: String(result.id),
      score: result.score,
      positions,
      coverage: positions.length / tokens.length,
    });
  });
  return hits;
}

// Incremental maintenance for a functional index update (WP2): every cached
// variant of `index` learns the new documents (stemmed with their bundle's
// set) or forgets the URIs. Detection is not re-run; a bundle unknown at
// build time takes the union. Both return false when `index` has no lexical
// index yet, in which case the next search builds one from the documents.
function addDocuments(index, docs) {
  const state = SEARCH_INDEXES.get(index);
  if (!state) {
    return false;
  }
  state.variants.forEach((variant) => {
    (docs || []).forEach((doc) => {
      variant.upsert(doc);
    });
  });
  return true;
}

function removeDocuments(index, uris) {
  const state = SEARCH_INDEXES.get(index);
  if (!state) {
    return false;
  }
  state.variants.forEach((variant) => {
    (uris || []).forEach((uri) => {
      if (variant.searchIndex.has(uri)) {
        variant.searchIndex.discard(uri);
      }
      const streams = STREAM_CACHES.get(variant.searchIndex);
      if (streams) {
        streams.delete(uri);
      }
    });
  });
  return true;
}

// Moves the cached lexical index from one OKF index object to its successor,
// so an updated index keeps the structure instead of rebuilding it. The
// previous index must not be searched afterwards.
function adoptSearchIndex(previous, next) {
  const state = SEARCH_INDEXES.get(previous);
  if (!state || previous === next) {
    return false;
  }
  SEARCH_INDEXES.delete(previous);
  SEARCH_INDEXES.set(next, state);
  return true;
}

module.exports = {
  EXACT_FIELD,
  MAX_QUERY_CHARACTERS,
  MAX_QUERY_TERMS,
  SEARCH_BOOSTS,
  SEARCH_FIELDS,
  TEXT_FIELDS,
  addDocuments,
  adoptSearchIndex,
  analyzeQuery,
  describeSearchIndex,
  exactTokens,
  normalizeSearchQuery,
  prepareSearchIndex,
  removeDocuments,
  runQuery,
  searchLanguages,
  searchVariant,
};
