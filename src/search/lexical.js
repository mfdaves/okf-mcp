"use strict";

// Lexical index over an OKF index (plan R-1, R-2, R-3, R-5): one MiniSearch
// instance per OKF index and language set, built lazily and cached in a
// WeakMap. Index time keeps the raw token (diacritics folded) and adds one
// stem per configured language; the `exact` field (path, identifiers,
// aliases, raw title tokens) is never stemmed. Query time folds, drops stop
// words and single letters, stems with every configured language, and runs an
// all-term or any-term tree where each query term is an OR of its forms.

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
const SEARCH_FIELDS = Object.freeze([
  "title",
  "type",
  "tags",
  "aliases",
  "description",
  "path",
  "body",
  EXACT_FIELD,
]);
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
// OKF index -> { detection, variants: Map<language key, { languages, searchIndex }> }
const SEARCH_INDEXES = new WeakMap();
const tokenize = MiniSearch.getDefault("tokenize");
const identity = (value) => value;
const identityTokenize = (text) => [text];

// A custom id is a full okf:// URI; only its concept path is an identifier.
function customIdPath(customId) {
  return customId ? String(customId).replace(/^okf:\/\/[^/]+\//, "") : "";
}

function searchDocument(doc) {
  const aliases = doc.aliases || [];
  return {
    id: doc.uri,
    title: String(doc.title || ""),
    type: String(doc.type || ""),
    tags: (doc.tags || []).join(" "),
    aliases: aliases.join(" "),
    description: String(doc.description || ""),
    path: String(doc.path || ""),
    body: String(doc.body || ""),
    exact: [doc.conceptId, customIdPath(doc.customId), doc.path, doc.title]
      .concat(aliases)
      .filter(Boolean)
      .map(String)
      .join(" "),
  };
}

// Index-time term processing for one language set: the folded token plus its
// stems (an array when any stem differs), only the folded token on the exact
// field. Memoised because catalog vocabulary repeats heavily across documents.
function createTermProcessor(languages) {
  const cache = new Map();
  return (term, field) => {
    const lower = term.toLowerCase();
    if (field === EXACT_FIELD || !languages.length) {
      return foldDiacritics(lower);
    }
    let forms = cache.get(lower);
    if (forms === undefined) {
      const folded = foldDiacritics(lower);
      const stems = stemForms(lower, languages);
      forms = stems.length ? [folded].concat(stems) : folded;
      if (cache.size >= TERM_FORMS_CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(lower, forms);
    }
    return forms;
  };
}

function buildSearchIndex(index, languages) {
  const searchIndex = new MiniSearch({
    fields: SEARCH_FIELDS,
    idField: "id",
    processTerm: createTermProcessor(languages),
    searchOptions: {
      boost: SEARCH_BOOSTS,
      combineWith: "AND",
    },
  });
  searchIndex.addAll(index.concepts.map(searchDocument));
  return searchIndex;
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

function detectIndexLanguages(index, state) {
  if (!state.detection) {
    state.detection = detectLanguages(index.concepts.map(detectionTokens));
  }
  return state.detection;
}

// Precedence: explicit option, `index.languages` (CLI --languages),
// `index.project.languages` (project config), then auto detection.
function requestedLanguages(index, options) {
  if (options && options.languages !== undefined) {
    return normalizeLanguages(options.languages);
  }
  if (index.languages !== undefined) {
    return normalizeLanguages(index.languages);
  }
  if (index.project && index.project.languages !== undefined) {
    return normalizeLanguages(index.project.languages);
  }
  return "auto";
}

// The language codes a search over `index` stems and stop-words with.
function searchLanguages(index, options) {
  const requested = requestedLanguages(index, options);
  return requested === "auto"
    ? detectIndexLanguages(index, indexState(index)).languages
    : requested;
}

function searchVariant(index, options) {
  const state = indexState(index);
  const languages = searchLanguages(index, options);
  const key = languages.join(",");
  let variant = state.variants.get(key);
  if (!variant) {
    variant = { languages, searchIndex: buildSearchIndex(index, languages) };
    state.variants.set(key, variant);
  }
  return variant;
}

function prepareSearchIndex(index, options) {
  return searchVariant(index, options).searchIndex;
}

// What a search over `index` would use, without building anything but the
// detection pass: the requested setting, the effective codes, and per-language
// document counts when detection ran.
function describeSearchIndex(index, options) {
  const requested = requestedLanguages(index, options);
  const detection = requested === "auto" ? detectIndexLanguages(index, indexState(index)) : null;
  return {
    requested,
    languages: detection ? detection.languages : requested,
    detection: detection
      ? { counts: detection.counts, documents: detection.documents, detected: detection.detected }
      : null,
  };
}

const isSingleLetter = (token) => token.length === 1 && !/\d/.test(token);

// Query analysis (R-3): lower-case tokens; drop stop words of the configured
// languages and single letters (reported as `dropped`); when nothing would be
// left, search the dropped tokens literally instead of returning nothing; the
// term limit counts what is left. Each kept token carries its forms: the
// folded token first, then one stem per configured language.
function analyzeQuery(value, options) {
  const config = options || {};
  const query = String(value || "").trim();
  if (Array.from(query).length > MAX_QUERY_CHARACTERS) {
    throw new TypeError(`Search query must not exceed ${MAX_QUERY_CHARACTERS} characters.`);
  }
  const languages = config.languages || [];
  const stopWords = config.stopWords || stopWordsFor(languages);
  const dropped = [];
  let terms = [];
  tokenize(query)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .forEach((token) => {
      if (terms.includes(token) || dropped.includes(token)) {
        return;
      }
      if (isSingleLetter(token) || stopWords.has(token)) {
        dropped.push(token);
        return;
      }
      terms.push(token);
    });
  if (!terms.length && dropped.length) {
    terms = dropped.splice(0, dropped.length);
  }
  if (terms.length > MAX_QUERY_TERMS) {
    throw new TypeError(`Search query must not exceed ${MAX_QUERY_TERMS} terms.`);
  }
  const tokens = terms.map((raw) => ({
    raw,
    forms: [foldDiacritics(raw)].concat(stemForms(raw, languages)),
  }));
  return { query, terms, tokens, dropped, languages };
}

// 0.9.1 shape ({ query, terms }) plus the analysis fields.
function normalizeSearchQuery(value, options) {
  return analyzeQuery(value, options);
}

function queryTree(tokens, combineWith) {
  return {
    combineWith,
    queries: tokens.map((token) =>
      token.forms.length === 1 ? token.forms[0] : { combineWith: "OR", queries: token.forms },
    ),
  };
}

// One MiniSearch run over analysed tokens. `combineWith` AND requires every
// token (any of its forms), OR accepts any token. Prefix and fuzzy matching
// stay off (R-12). Each hit reports the raw tokens it matched and the share
// of distinct query tokens matched.
function runQuery(searchIndex, tokens, options) {
  const config = options || {};
  const combineWith = config.combineWith === "OR" ? "OR" : "AND";
  const positions = new Map();
  tokens.forEach((token, position) => {
    token.forms.forEach((form) => {
      if (!positions.has(form)) {
        positions.set(form, new Set());
      }
      positions.get(form).add(position);
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
    result.queryTerms.forEach((term) => {
      (positions.get(term) || []).forEach((position) => {
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
// variant of `index` learns the new documents or forgets the URIs. Language
// detection is not re-run; the set chosen at build time stays. Both return
// false when `index` has no lexical index yet, in which case the next search
// builds one from the current documents.
function addDocuments(index, docs) {
  const state = SEARCH_INDEXES.get(index);
  if (!state) {
    return false;
  }
  state.variants.forEach((variant) => {
    (docs || []).forEach((doc) => {
      const document = searchDocument(doc);
      if (variant.searchIndex.has(document.id)) {
        variant.searchIndex.replace(document);
      } else {
        variant.searchIndex.add(document);
      }
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
  addDocuments,
  adoptSearchIndex,
  analyzeQuery,
  describeSearchIndex,
  normalizeSearchQuery,
  prepareSearchIndex,
  removeDocuments,
  runQuery,
  searchLanguages,
  searchVariant,
};
