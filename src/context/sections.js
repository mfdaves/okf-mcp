"use strict";

// Section-level retrieval units (plan R-7, WP3a). A concept is cut at its
// document-level CommonMark headings into flat, non-overlapping sections: the
// preamble (frontmatter title and description plus any body before the first
// heading) and one section per heading, running to the next heading of any
// level. Headings inside block quotes, list items or unclosed fences are
// content, not boundaries (`markdownStructure` keeps document children only),
// which matches how the computation extractor reads sections.
//
// Anchor scheme, an okf-mcp extension (B-2): the preamble is addressed by the
// concept URI alone, every other section by `uri#slug`. The slug follows
// GitHub's heading rule (lower-cased; every character that is not a letter, a
// number, a space or a hyphen removed; each whitespace character turned into
// a hyphen, hyphens not collapsed; accents kept) and repeated slugs take `-1`,
// `-2`, ... in document order. It is the rule the fixture labels were written
// with (test/fixtures/retrieval/lib/slug.js). OKF v0.2 defines no section
// anchors: nothing in a bundle needs them, and a reader that drops the
// fragment still lands on the concept. An anchor depends only on the heading
// texts up to its own, so edits to any body, whitespace-only edits and edits
// to later sections leave it unchanged.
//
// `text` is the section's plain text: the heading once, then paragraphs, list
// items, code blocks and tables flattened one block or row per line, links
// and images reduced to their text, inline HTML dropped, whitespace runs
// collapsed. `hash` is the SHA-256 of that text from `hashUnitText` in
// src/embed/units.js, so `sectionUnits` can replace the concept units in
// `prepareEmbeddings` (WP3c: `units: sectionUnits`) and identical sections
// share one cache row (R-9). Section units cover valid concepts only, the set
// search ranks (`index.concepts`); concept units also embed invalid ones.

const { hashUnitText } = require("../embed/units");
const { markdownStructure, sectionNodes } = require("../markdown");

// Parsed document -> its sections. Documents are shared unchanged across
// functional index updates, so an unchanged concept keeps its sections.
const SECTIONS = new WeakMap();
// Slug of a heading whose text has no letter or digit ("###" alone, "!!!").
const EMPTY_SLUG = "section";
const HTML_TAG = /<[^>]*>/g;
// A GFM table delimiter row (`|---|:--:|`), kept out of the plain text.
const TABLE_DELIMITER_ROW = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const TABLE_LINE = /^\s*\|/;

function headingSlug(heading) {
  return String(heading || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

// One line per block, no empty lines, whitespace runs collapsed.
function normalizeText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !TABLE_DELIMITER_ROW.test(line))
    .join("\n");
}

function firstTextLiteral(node) {
  const walker = node.walker();
  for (let event = walker.next(); event; event = walker.next()) {
    if (event.entering && event.node.type === "text") {
      return event.node.literal || "";
    }
  }
  return "";
}

// Plain text of one block subtree. Soft line breaks become spaces, except in
// a paragraph that is a table (commonmark.js has no table node), where each
// source line is a row. Leaf nodes get a single entering event.
function blockText(block) {
  let out = "";
  let tableRows = false;
  const walker = block.walker();
  for (let event = walker.next(); event; event = walker.next()) {
    const node = event.node;
    if (!event.entering) {
      if (node.type === "paragraph" || node.type === "heading" || node.type === "item") {
        out += "\n";
      }
      continue;
    }
    switch (node.type) {
      case "text":
      case "code":
        out += node.literal || "";
        break;
      case "softbreak":
        out += tableRows ? "\n" : " ";
        break;
      case "linebreak":
        out += "\n";
        break;
      case "code_block":
        out += `${node.literal || ""}\n`;
        break;
      case "html_block":
        out += `${String(node.literal || "").replace(HTML_TAG, " ")}\n`;
        break;
      case "paragraph":
        tableRows = TABLE_LINE.test(firstTextLiteral(node));
        break;
      default:
        break;
    }
  }
  return out;
}

function blocksBefore(tree, stop) {
  const nodes = [];
  let current = tree.firstChild;
  while (current && current !== stop) {
    nodes.push(current);
    current = current.next;
  }
  return nodes;
}

// GitHub numbering: the first occurrence keeps the slug, repeats take -1, -2,
// ... in document order; a heading that spells an already taken suffixed slug
// pushes the counter further so anchors stay unique within the document.
function uniqueSlugs(headings) {
  const used = new Set();
  const counters = new Map();
  return headings.map((heading) => {
    const base = headingSlug(heading.text) || EMPTY_SLUG;
    let slug = base;
    let count = counters.get(base) || 0;
    while (used.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    counters.set(base, count);
    used.add(slug);
    return slug;
  });
}

function makeSection(doc, fields, parts) {
  const text = parts.map(normalizeText).filter(Boolean).join("\n");
  return Object.freeze(
    Object.assign({ uri: doc.uri }, fields, {
      text,
      charCount: text.length,
      hash: hashUnitText(text),
    }),
  );
}

// Ordered sections of a parsed document: the preamble first (anchor = the
// concept URI), then one per document-level heading (anchor = uri#slug).
function conceptSections(doc) {
  const cacheable = doc !== null && typeof doc === "object";
  const cached = cacheable ? SECTIONS.get(doc) : undefined;
  if (cached) {
    return cached;
  }
  const structure = markdownStructure(doc.body);
  const headings = structure.headings;
  const slugs = uniqueSlugs(headings);
  const preamble = blocksBefore(structure.tree, headings.length ? headings[0].node : null)
    .map(blockText)
    .join("\n");
  const sections = [
    makeSection(doc, { anchor: doc.uri, heading: null, level: 0, slug: null }, [
      doc.title,
      doc.description,
      preamble,
    ]),
  ];
  headings.forEach((heading, position) => {
    const headingText = normalizeText(heading.text);
    const body = sectionNodes(heading, { stopAtAnyHeading: true }).map(blockText).join("\n");
    sections.push(
      makeSection(
        doc,
        {
          anchor: `${doc.uri}#${slugs[position]}`,
          heading: headingText,
          level: heading.level,
          slug: slugs[position],
        },
        [headingText, body],
      ),
    );
  });
  Object.freeze(sections);
  if (cacheable) {
    SECTIONS.set(doc, sections);
  }
  return sections;
}

// Every section of every valid concept as an embedding unit, the shape of
// `conceptUnits` in src/embed/units.js: { id: anchor, text, hash }.
function sectionUnits(index) {
  const concepts = index?.concepts || [];
  return concepts.flatMap((doc) =>
    conceptSections(doc).map((section) => ({
      id: section.anchor,
      text: section.text,
      hash: section.hash,
    })),
  );
}

module.exports = {
  conceptSections,
  headingSlug,
  sectionUnits,
};
