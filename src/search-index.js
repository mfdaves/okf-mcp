"use strict";

const MiniSearch = require("minisearch");

const MAX_QUERY_CHARACTERS = 512;
const MAX_QUERY_TERMS = 16;
const SEARCH_FIELDS = Object.freeze([
  "title",
  "type",
  "tags",
  "aliases",
  "description",
  "path",
  "body",
]);
const SEARCH_BOOSTS = Object.freeze({
  title: 8,
  type: 5,
  tags: 4,
  aliases: 4,
  description: 3,
  path: 2,
  body: 1,
});
const SEARCH_INDEXES = new WeakMap();
const tokenize = MiniSearch.getDefault("tokenize");
const processTerm = MiniSearch.getDefault("processTerm");

function queryTerms(query) {
  return tokenize(String(query || ""))
    .map((term) => processTerm(term))
    .filter((term) => typeof term === "string" && term.length > 0);
}

function normalizeSearchQuery(value) {
  const query = String(value || "").trim();
  if (Array.from(query).length > MAX_QUERY_CHARACTERS) {
    throw new TypeError(`Search query must not exceed ${MAX_QUERY_CHARACTERS} characters.`);
  }
  const terms = queryTerms(query);
  if (terms.length > MAX_QUERY_TERMS) {
    throw new TypeError(`Search query must not exceed ${MAX_QUERY_TERMS} terms.`);
  }
  return { query, terms };
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
  };
}

function prepareSearchIndex(index) {
  let searchIndex = SEARCH_INDEXES.get(index);
  if (searchIndex) {
    return searchIndex;
  }
  searchIndex = new MiniSearch({
    fields: SEARCH_FIELDS,
    idField: "id",
    searchOptions: {
      boost: SEARCH_BOOSTS,
      combineWith: "AND",
    },
  });
  searchIndex.addAll(index.concepts.map(searchDocument));
  SEARCH_INDEXES.set(index, searchIndex);
  return searchIndex;
}

module.exports = {
  MAX_QUERY_CHARACTERS,
  MAX_QUERY_TERMS,
  normalizeSearchQuery,
  prepareSearchIndex,
};
