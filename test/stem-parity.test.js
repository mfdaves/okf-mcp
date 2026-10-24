"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { StemmerEn: UpstreamEn } = require("@nlpjs/lang-en-min");
const { StemmerIt: UpstreamIt } = require("@nlpjs/lang-it");
const BaseStemmer = require("../src/search/stem/base-stemmer");
const StemmerEn = require("../src/search/stem/en");
const StemmerIt = require("../src/search/stem/it");

const FIXTURES_ROOT = path.join(__dirname, "fixtures", "retrieval");
const STEM_ROOT = path.join(__dirname, "..", "src", "search", "stem");
const MIN_WORDS = 2000;

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.name.endsWith(".md") ? [absolute] : [];
  });
}

// Every distinct lower-cased token of both fixtures' bundles: Italian and English prose,
// identifiers, SKUs, accented words, digits.
function fixtureWords() {
  const text = fs
    .readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(FIXTURES_ROOT, entry.name, "bundles")),
    )
    .flatMap((entry) => markdownFiles(path.join(FIXTURES_ROOT, entry.name, "bundles")))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1),
    ),
  ).sort();
}

test("the vendored Italian and English stemmers agree with the pinned upstream on the fixture vocabulary", () => {
  const words = fixtureWords();
  assert.ok(words.length >= MIN_WORDS, `only ${words.length} distinct words`);
  const pairs = [
    ["it", new UpstreamIt(), new StemmerIt()],
    ["en", new UpstreamEn(), new StemmerEn()],
  ];
  pairs.forEach(([code, upstream, vendored]) => {
    const disagreements = words
      .filter((word) => upstream.stemWord(word) !== vendored.stemWord(word))
      .map((word) => `${word}: ${upstream.stemWord(word)} != ${vendored.stemWord(word)}`);
    assert.deepEqual(disagreements, [], `${code}: ${disagreements.length} disagreements`);
  });
});

test("the stemmers are pure functions of the word, including on accented and apostrophe forms", () => {
  const it = new StemmerIt();
  const en = new StemmerEn();
  assert.equal(it.stemWord("scarpe"), "scarp");
  assert.equal(it.stemWord("scarpa"), "scarp");
  assert.equal(it.stemWord("impermeabili"), it.stemWord("impermeabile"));
  assert.equal(it.stemWord("velocità"), it.stemWord("velocita"));
  assert.equal(en.stemWord("categories"), en.stemWord("category"));
  assert.equal(en.stemWord("running"), "run");
  assert.equal(en.stemWord("descriptions"), "descript");
  // The same instance returns the same result on repeat calls (cache) and on cold calls.
  assert.equal(it.stemWord("spedizioni"), new StemmerIt().stemWord("spedizioni"));
  assert.equal(en.stemWord(""), "");
});

test("the per-word stem cache is bounded", () => {
  const stemmer = new StemmerEn();
  const limit = BaseStemmer.STEM_CACHE_LIMIT;
  assert.ok(limit > 0 && limit <= 100000);
  for (let index = 0; index < limit + 500; index += 1) {
    stemmer.stemWord(`word${index}ing`);
  }
  assert.ok(stemmer.cache.size <= limit, `cache grew to ${stemmer.cache.size}`);
  // Evicted entries are recomputed, not lost.
  assert.equal(stemmer.stemWord("word0ing"), new StemmerEn().stemWord("word0ing"));
});

test("vendored stemmer files keep the upstream MIT header and a provenance note", () => {
  const files = fs.readdirSync(STEM_ROOT).filter((name) => name.endsWith(".js"));
  assert.ok(files.length >= 4, files.join(", "));
  files.forEach((name) => {
    const text = fs.readFileSync(path.join(STEM_ROOT, name), "utf8");
    assert.match(text, /Copyright \(c\) AXA Group Operations Spain S\.A\./, name);
    assert.match(text, /Permission is hereby granted, free of charge/, name);
    assert.match(
      text,
      /Provenance: derived from @nlpjs\/(core|lang-it|lang-en-min) 4\.26\.1/,
      name,
    );
  });
});
