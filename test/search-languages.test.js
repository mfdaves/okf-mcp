"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DETECTION_SHARE,
  STOP_WORDS,
  SUPPORTED_LANGUAGES,
  detectLanguage,
  detectLanguages,
  foldDiacritics,
  isStopWord,
  normalizeLanguages,
  stemForms,
  stopWordsFor,
} = require("../src/search/languages");

const tokens = (text) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

test("the registry supports English and Italian with short function-word stop lists", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["en", "it"]);
  SUPPORTED_LANGUAGES.forEach((code) => {
    const list = STOP_WORDS[code];
    assert.ok(list.length >= 100 && list.length <= 150, `${code} has ${list.length} stop words`);
    assert.equal(new Set(list).size, list.length, `${code} stop list has duplicates`);
    list.forEach((word) => {
      assert.equal(word, word.toLowerCase().trim());
    });
  });
  // Content words that catalogs use as terms must never be stop words.
  ["page", "pagina", "new", "nuovo", "up", "down", "out", "only", "ranking"].forEach((word) => {
    assert.equal(isStopWord(word, SUPPORTED_LANGUAGES), false, word);
  });
  assert.equal(isStopWord("the", ["en"]), true);
  assert.equal(isStopWord("the", ["it"]), false);
  assert.equal(isStopWord("perché", ["it"]), true);
  assert.equal(stopWordsFor(["en", "it"]).size, new Set(STOP_WORDS.en.concat(STOP_WORDS.it)).size);
});

test("language options normalise to auto or a validated code list", () => {
  assert.equal(normalizeLanguages(undefined), "auto");
  assert.equal(normalizeLanguages("auto"), "auto");
  assert.deepEqual(normalizeLanguages("none"), []);
  assert.deepEqual(normalizeLanguages([]), []);
  assert.deepEqual(normalizeLanguages("it,en"), ["it", "en"]);
  assert.deepEqual(normalizeLanguages([" EN ", "en", "it"]), ["en", "it"]);
  assert.throws(() => normalizeLanguages(["fr"]), /Unsupported search language: fr/);
  assert.throws(() => normalizeLanguages(["auto", "en"]), /cannot mix "auto"/);
});

test("diacritics fold to ASCII and stems are folded and de-duplicated per language", () => {
  assert.equal(foldDiacritics("Città"), "Citta");
  assert.equal(foldDiacritics("perché"), "perche");
  assert.equal(foldDiacritics("plain"), "plain");
  assert.deepEqual(stemForms("scarpe", ["it"]), ["scarp"]);
  assert.deepEqual(stemForms("scarpe", ["en", "it"]), ["scarp"]);
  assert.deepEqual(stemForms("velocità", ["it"]), ["veloc"]);
  assert.deepEqual(stemForms("categories", ["en"]), ["categori"]);
  // A term no language changes yields no extra forms; no languages yields none.
  assert.deepEqual(stemForms("seo", ["en", "it"]), []);
  assert.deepEqual(stemForms("running", []), []);
});

test("a document's language is detected from unambiguous stop words, ties stay undetected", () => {
  assert.equal(
    detectLanguage(
      tokens("Camminatori occasionali che escono dieci volte l'anno, soprattutto in Veneto"),
    ),
    "it",
  );
  assert.equal(
    detectLanguage(tokens("Synthetic login every five minutes per method plus the real-user rate")),
    "en",
  );
  assert.equal(detectLanguage(tokens("TRK-W-042 Dolomiti AquaStop")), null);
  assert.equal(detectLanguage(tokens("the page della pagina")), null);
  assert.equal(detectLanguage([]), null);
});

test("bundle-level detection keeps languages covering at least 5% of documents, dominant first", () => {
  assert.equal(DETECTION_SHARE, 0.05);
  const italian = tokens("la pagina della categoria non è indicizzata per il filtro colore");
  const english = tokens("the category page is not indexed because of the colour filter");
  const none = tokens("TRK-W-042");
  const mostlyItalian = Array.from({ length: 30 }, () => italian).concat([english, english, none]);
  assert.deepEqual(detectLanguages(mostlyItalian).languages, ["it", "en"]);
  const rareEnglish = Array.from({ length: 40 }, () => italian).concat([english, none]);
  const rare = detectLanguages(rareEnglish);
  assert.deepEqual(rare.languages, ["it"]);
  assert.deepEqual(rare.counts, { en: 1, it: 40 });
  assert.equal(rare.documents, 42);
  assert.equal(rare.detected, 41);
  assert.deepEqual(detectLanguages([none, none]).languages, []);
  assert.deepEqual(detectLanguages([]).languages, []);
});
