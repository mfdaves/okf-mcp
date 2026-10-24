"use strict";

// Language registry for lexical search (plan R-2, R-3): per code a stemmer, a
// short stop-word list, and the detector that scores a document's tokens
// against the stop lists. Supported at 1.0: English and Italian; adding a
// language is a new entry here plus a vendored stemmer under ./stem.

const StemmerEn = require("./stem/en");
const StemmerIt = require("./stem/it");

// Share of documents a detected language must reach to enter the bundle's
// language set under `languages: auto` (R-2).
const DETECTION_SHARE = 0.05;

// Function words only, so that dropping them from a query never removes a
// content term: articles, prepositions, pronouns, auxiliaries, question
// words. Deliberately absent: particles that double as content words in
// catalogs ("up", "down", "out", "over", "only", "new").
const STOP_WORDS = Object.freeze({
  en: Object.freeze(
    (
      "a about above after again against all am an and any are as at be because been before " +
      "being below between both but by can could did do does doing during each few for from " +
      "further had has have having he her here hers herself him himself his how i if in into is " +
      "it its itself just me more most my myself no nor not of on once or other our ours " +
      "ourselves per she should so some such than that the their theirs them themselves then there " +
      "these they this those through to too under until very was we were what when where which " +
      "while who whom why will with would you your yours yourself yourselves"
    ).split(" "),
  ),
  it: Object.freeze(
    (
      "a ad agli ai al all alla alle allo anche avere abbiamo avete c che chi ci ciò cio come con " +
      "cosa cui da dagli dai dal dall dalla dalle dallo degli dei del dell della delle dello di " +
      "dove e è ed era essere fa fra gli ha hai hanno ho i il in io l la le lei li lo loro lui " +
      "ma me mi mia mie miei mio ne negli nei nel nell nella nelle nello noi non nostra nostre " +
      "nostri nostro o od per perché perche più piu può puo qual quale quali quando quanto " +
      "quella quelle quelli quello questa queste questi questo se sei si sia siamo siete sono " +
      "sta stanno su sua sue sugli sui sul sull sulla sulle sullo suo suoi ti tra tu tua tue tuo " +
      "tuoi un una uno vi voi vorrei voglio vostra vostre vostri vostro"
    ).split(" "),
  ),
});

const LANGUAGES = Object.freeze({
  en: Object.freeze({
    code: "en",
    name: "English",
    stemmer: new StemmerEn(),
    stopWords: new Set(STOP_WORDS.en),
  }),
  it: Object.freeze({
    code: "it",
    name: "Italian",
    stemmer: new StemmerIt(),
    stopWords: new Set(STOP_WORDS.it),
  }),
});

const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(LANGUAGES).sort());

// Stop words shared by several languages carry no signal for detection.
const AMBIGUOUS_STOP_WORDS = new Set(
  SUPPORTED_LANGUAGES.flatMap((code) =>
    STOP_WORDS[code].filter((word) =>
      SUPPORTED_LANGUAGES.some((other) => other !== code && LANGUAGES[other].stopWords.has(word)),
    ),
  ),
);

const NON_ASCII = /[\u0080-￿]/;
const COMBINING_MARKS = /[̀-ͯ]/g;

// Strip diacritics ("città" -> "citta"); ASCII input is returned unchanged.
function foldDiacritics(term) {
  const text = String(term);
  return NON_ASCII.test(text) ? text.normalize("NFD").replace(COMBINING_MARKS, "") : text;
}

function languageFor(code) {
  const language = LANGUAGES[String(code).toLowerCase()];
  if (!language) {
    throw new TypeError(
      `Unsupported search language: ${code}. Supported: ${SUPPORTED_LANGUAGES.join(", ")}.`,
    );
  }
  return language;
}

// Accepts "auto", "none", a code list ("it,en" or ["it", "en"]) or an empty
// value (auto). Returns "auto" or a de-duplicated array of supported codes.
function normalizeLanguages(value) {
  if (value === undefined || value === null || value === "" || value === "auto") {
    return "auto";
  }
  if (value === "none" || value === false) {
    return [];
  }
  const list = Array.isArray(value) ? value : String(value).split(",");
  const codes = [];
  list.forEach((entry) => {
    const code = String(entry).trim().toLowerCase();
    if (!code || code === "none") {
      return;
    }
    if (code === "auto") {
      throw new TypeError('Search languages cannot mix "auto" with language codes.');
    }
    languageFor(code);
    if (!codes.includes(code)) {
      codes.push(code);
    }
  });
  return codes;
}

function stopWordsFor(codes) {
  const words = new Set();
  (codes || []).forEach((code) => {
    languageFor(code).stopWords.forEach((word) => {
      words.add(word);
    });
  });
  return words;
}

function isStopWord(term, codes) {
  return (codes || []).some((code) => languageFor(code).stopWords.has(term));
}

// Folded stems of a lower-cased term under each code, de-duplicated and
// without the term itself; empty when no language changes the term.
function stemForms(term, codes) {
  const folded = foldDiacritics(term);
  const forms = [];
  (codes || []).forEach((code) => {
    const stem = foldDiacritics(languageFor(code).stemmer.stemWord(term));
    if (stem && stem !== folded && !forms.includes(stem)) {
      forms.push(stem);
    }
  });
  return forms;
}

// Scores lower-cased tokens against every stop list, ignoring words shared by
// two lists. Returns the code with strictly the most hits, or null when no
// language scores or two tie.
function detectLanguage(tokens) {
  const scores = SUPPORTED_LANGUAGES.map((code) => ({ code, hits: 0 }));
  (tokens || []).forEach((token) => {
    if (AMBIGUOUS_STOP_WORDS.has(token)) {
      return;
    }
    scores.forEach((entry) => {
      if (LANGUAGES[entry.code].stopWords.has(token)) {
        entry.hits += 1;
      }
    });
  });
  scores.sort((left, right) => right.hits - left.hits || left.code.localeCompare(right.code));
  if (!scores[0].hits || (scores[1] && scores[1].hits === scores[0].hits)) {
    return null;
  }
  return scores[0].code;
}

// Bundle-level detection (R-2): detect each document, keep the languages that
// cover at least DETECTION_SHARE of all documents, dominant language first.
function detectLanguages(tokenLists) {
  const counts = Object.fromEntries(SUPPORTED_LANGUAGES.map((code) => [code, 0]));
  let documents = 0;
  let detected = 0;
  tokenLists.forEach((tokens) => {
    documents += 1;
    const code = detectLanguage(tokens);
    if (code) {
      counts[code] += 1;
      detected += 1;
    }
  });
  const languages = SUPPORTED_LANGUAGES.filter(
    (code) => documents > 0 && counts[code] / documents >= DETECTION_SHARE,
  ).sort((left, right) => counts[right] - counts[left] || left.localeCompare(right));
  return { languages, counts, documents, detected };
}

module.exports = {
  DETECTION_SHARE,
  LANGUAGES,
  STOP_WORDS,
  SUPPORTED_LANGUAGES,
  detectLanguage,
  detectLanguages,
  foldDiacritics,
  isStopWord,
  languageFor,
  normalizeLanguages,
  stemForms,
  stopWordsFor,
};
