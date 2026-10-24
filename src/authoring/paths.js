"use strict";

// Concept path rules and the type/title path suggestion, shared by the
// proposal and live authoring services (split from src/authoring.js, plan
// Q-1). src/authoring.js re-exports every name for compatibility.

const path = require("node:path");
const { findConceptMatches } = require("../indexer");
const { normalizeSlashes } = require("../parser");

function slug(value, fallback) {
  const text = String(value || fallback || "concept")
    .trim()
    .toLowerCase();
  return text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || String(fallback || "concept");
}

function hasControlCharacter(text) {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function normalizeConceptPath(value) {
  const raw = normalizeSlashes(String(value || "").trim());
  if (!raw) {
    throw new Error("Concept path is required.");
  }
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || hasControlCharacter(raw)) {
    throw new Error("Concept path must be a safe relative path.");
  }
  const rawParts = raw.split("/");
  if (rawParts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error(
      "Concept path must be a safe relative path without empty, hidden, dot, or parent segments.",
    );
  }
  if (rawParts.slice(0, -1).some((part) => part.toLowerCase().endsWith(".md"))) {
    throw new Error("Concept path cannot place a Markdown file inside another Markdown path.");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error("Concept path must stay inside the bundle.");
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Concept path contains an unsafe segment.");
  }
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new Error("Concept path must end with .md.");
  }
  const base = path.posix.basename(normalized).toLowerCase();
  if (base === "index.md" || base === "log.md") {
    throw new Error("Concept path cannot be a reserved index.md or log.md file.");
  }
  return normalized;
}

function deriveConceptPathSuggestion(index, bundle, input) {
  const rawPrefix = input?.prefix ? normalizeSlashes(String(input.prefix).trim()) : "";
  if (rawPrefix.startsWith("/") || /^[A-Za-z]:\//.test(rawPrefix)) {
    throw new Error("Path prefix must be a safe relative path inside the bundle.");
  }
  const prefix = rawPrefix.replace(/\/+$/g, "");
  if (prefix) {
    normalizeConceptPath(`${prefix}/placeholder.md`);
  }
  const type = String(input?.type || "").trim();
  const typePart = type === "Attested Computation" ? "computations" : slug(type, "concept");
  const titlePart = slug(input?.title, typePart);
  let parent = prefix ? `${prefix}/${typePart}` : typePart;
  let strategy = prefix ? "explicit_prefix" : "type_slug";
  let evidence = { matchingConcepts: 0, dominantDirectoryCount: 0, dominantDirectoryRatio: 0 };

  if (type !== "Attested Computation" && index) {
    const matching = findConceptMatches(index, {
      bundle: bundle.id,
      type,
      pathPrefix: prefix,
    });
    const counts = new Map();
    matching.forEach((document) => {
      const directory = path.posix.dirname(document.path);
      const normalizedDirectory = directory === "." ? "" : directory;
      counts.set(normalizedDirectory, (counts.get(normalizedDirectory) || 0) + 1);
    });
    const dominant = Array.from(counts.entries()).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0];
    const dominantCount = dominant ? dominant[1] : 0;
    const ratio = matching.length ? dominantCount / matching.length : 0;
    evidence = {
      matchingConcepts: matching.length,
      dominantDirectoryCount: dominantCount,
      dominantDirectoryRatio: Number(ratio.toFixed(3)),
    };
    if (dominant && dominantCount >= 2 && ratio >= 0.6) {
      parent = dominant[0];
      strategy = "dominant_same_type_directory";
      evidence.dominantDirectory = dominant[0] || ".";
    }
  }

  return {
    path: normalizeConceptPath([parent, `${titlePart}.md`].filter(Boolean).join("/")),
    strategy,
    evidence,
  };
}

module.exports = { deriveConceptPathSuggestion, normalizeConceptPath, slug };
