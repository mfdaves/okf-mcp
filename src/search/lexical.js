"use strict";

// Lexical index over an OKF index (plan R-1, R-2, R-3, R-5): one MiniSearch
// instance per OKF index and language setting, built lazily and cached in a
// WeakMap. Languages are detected per bundle (the union of languages present
// in at least 5% of that bundle's documents) unless configured; each document
// is stemmed with its own bundle's set and queries with the union of all sets.
// Text fields keep the raw token (diacritics folded) plus one stem per
// language; the `exact` field (path, identifiers, aliases, raw title tokens)
// is literal: never stemmed, folded or stop-worded. Query time folds, drops
// stop words and single letters, and stems every plain term; quoted text and
// identifier-looking tokens stay literal and run an all-term or any-term
// tree where each query term is an OR of its forms.

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
// OKF index -> { detection, variants: Map<language key, variant> }
const SEARCH_INDEXES = new WeakMap();
const tokenize = MiniSearch.getDefault("tokenize");
const identity = (value) => value;
const identityTokenize = (text) => [text];
// Query pieces in order: "double quoted", “typographic quoted”, or a run of non-spaces.
const QUERY_PIECES = /"([^"]*)"|“([^”]*)”|(\S+)/gu;
// An unquoted chunk that looks like an identifier: digits or an internal hyphen.
const IDENTIFIER_CHUNK = /\p{N}|[\p{L}\p{N}]-[\p{L}\p{N}]/u;
// An indexed chunk kept whole beside its pieces: an internal hyphen, underscore or dot.
const IDENTIFIER_SEGMENT = /[\p{L}\p{N}][-_.][\p{L}\p{N}]/u;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const FILE_EXTENSION = /\.[a-z0-9]+$/;

const canonicalCodes = (codes) => Array.from(new Set(codes)).sort();
const languageKey = (codes) => canonicalCodes(codes).join(",") || "none";

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

function searchDocument(doc) {
  return {
    id: doc.uri,
    title: String(doc.title || ""),
    type: String(doc.type || ""),
    tags: (doc.tags || []).join(" "),
    aliases: (doc.aliases || []).join(" "),
    description: String(doc.description || ""),
    path: String(doc.path || ""),
    body: String(doc.body || ""),
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

function searchLanguages(index, options) {
  return languagePlan(index, options).languages;
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
    run: [],
    leaves: [raw].concat(forms),
    snippetTerms: [folded],
    stems: forms.slice(1),
  };
}

// Quoted text and identifier-looking chunks: the lower-cased literal as a
// whole plus its pieces, nothing folded, stemmed or dropped.
function literalTerm(kind, text) {
  const literal = text.toLowerCase().replace(/\s+/g, " ").trim();
  const run = tokenize(literal).filter(Boolean);
  return {
    kind,
    raw: literal,
    literal,
    forms: [],
    run,
    leaves: [literal].concat(run),
    snippetTerms: [literal].concat(run),
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
      if (term.run.length) {
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
// field, the folded token and stems against the text fields. Literal terms:
// the whole against the exact field, or every piece (an ordered run the
// tokenizer split) across all fields.
function termNode(term) {
  if (term.kind === "plain") {
    return {
      combineWith: "OR",
      queries: [
        { combineWith: "OR", fields: [EXACT_FIELD], queries: [term.literal] },
        { combineWith: "OR", fields: TEXT_FIELDS, queries: term.forms },
      ],
    };
  }
  if (term.run.length === 1 && term.run[0] === term.literal) {
    return { combineWith: "OR", fields: SEARCH_FIELDS, queries: [term.literal] };
  }
  return {
    combineWith: "OR",
    queries: [
      { combineWith: "OR", fields: [EXACT_FIELD], queries: [term.literal] },
      { combineWith: "AND", fields: SEARCH_FIELDS, queries: term.run },
    ],
  };
}

function queryTree(tokens, combineWith) {
  return { combineWith, queries: tokens.map(termNode) };
}

// One MiniSearch run over analysed terms. `combineWith` AND requires every
// term (any of its forms), OR accepts any term. Prefix and fuzzy matching
// stay off (R-12). Each hit reports the raw terms it matched and the share
// of distinct query terms matched.
function runQuery(searchIndex, tokens, options) {
  const config = options || {};
  const combineWith = config.combineWith === "OR" ? "OR" : "AND";
  const positions = new Map();
  tokens.forEach((term, position) => {
    term.leaves.forEach((leaf) => {
      if (!positions.has(leaf)) {
        positions.set(leaf, new Set());
      }
      positions.get(leaf).add(position);
    });
  });
  const results = searchIndex.search(queryTree(tokens, combineWith), {
    tokenize: identityTokenize,
    processTerm: identity,
    prefix: false,
    fuzzy: false,
    filter: config.filter,
  });
  return results.map((result) => {
    const matched = new Set();
    result.queryTerms.forEach((leaf) => {
      (positions.get(leaf) || []).forEach((position) => {
        matched.add(position);
      });
    });
    const ordered = Array.from(matched).sort((left, right) => left - right);
    return {
      id: String(result.id),
      score: result.score,
      matchedTerms: ordered.map((position) => tokens[position].raw),
      coverage: tokens.length ? ordered.length / tokens.length : 0,
    };
  });
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
