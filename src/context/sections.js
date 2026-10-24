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
// concept URI alone, every other section by `uri#slug`. The heading's text is
// first normalised (line breaks of a setext or wrapped heading and any
// whitespace run become one space, trimmed), so whitespace-only edits never
// move an anchor; then GitHub's rule as github-slugger implements it applies:
// lower-cased, every character that is not a letter, a combining mark, a
// number, an underscore, a hyphen or a space removed, each space turned into
// a hyphen (hyphens left by removed punctuation are not collapsed, as on
// GitHub), and repeated slugs take `-1`, `-2`, ... in document order. On the
// fixture labels it agrees with test/fixtures/retrieval/lib/slug.js. OKF v0.2
// defines no section anchors: nothing in a bundle needs them, and a reader
// that drops the fragment still lands on the concept. An anchor depends only
// on the heading texts up to its own, so edits to any body, whitespace-only
// edits and edits to later sections leave it unchanged; renaming the heading
// or adding a same-text heading before it changes it.
//
// `text` is the section's plain text: the heading once, then paragraphs, list
// items, code blocks and tables flattened one block or row per line (a
// table's delimiter row dropped; code is kept verbatim apart from whitespace
// runs), links
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

// Whitespace-stable heading text: every whitespace run is one space.
const collapseWhitespace = (text) =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim();

function headingSlug(heading) {
  return collapseWhitespace(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "")
    .replace(/ /g, "-");
}

// A heading's text with soft and hard line breaks read as spaces (the shared
// markdown helper drops them, which would glue a setext heading's lines).
function headingNodeText(node) {
  let out = "";
  const walker = node.walker();
  for (let event = walker.next(); event; event = walker.next()) {
    if (!event.entering) {
      continue;
    }
    const type = event.node.type;
    if (type === "text" || type === "code") {
      out += event.node.literal || "";
    } else if (type === "softbreak" || type === "linebreak") {
      out += " ";
    }
  }
  return collapseWhitespace(out);
}

// One line per block, no empty lines, whitespace runs collapsed.
function normalizeText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
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
  let paragraphStart = 0;
  const walker = block.walker();
  for (let event = walker.next(); event; event = walker.next()) {
    const node = event.node;
    if (!event.entering) {
      if (node.type === "paragraph" && tableRows) {
        // Only a table's own delimiter row is dropped, never a code line.
        const rows = out
          .slice(paragraphStart)
          .split("\n")
          .filter((row) => !TABLE_DELIMITER_ROW.test(row.trim()));
        out = out.slice(0, paragraphStart) + rows.join("\n");
        tableRows = false;
      }
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
        paragraphStart = out.length;
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
    const base = headingSlug(headingNodeText(heading.node)) || EMPTY_SLUG;
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
    const headingText = headingNodeText(heading.node);
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
