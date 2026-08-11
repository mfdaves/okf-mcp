"use strict";

const commonmark = require("commonmark");

const parser = new commonmark.Parser({ smart: false });

function nodeText(node) {
  let output = "";
  const walker = node.walker();
  let event;
  while ((event = walker.next())) {
    if (event.entering && ["text", "code"].includes(event.node.type)) {
      output += event.node.literal || "";
    }
  }
  return output;
}

function isDocumentChild(node) {
  return Boolean(node && node.parent && node.parent.type === "document");
}

function isTopLevelItem(node) {
  return Boolean(
    node
    && node.parent
    && node.parent.type === "list"
    && node.parent.parent
    && node.parent.parent.type === "document",
  );
}

function markdownStructure(body) {
  const source = String(body || "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const tree = parser.parse(source);
  const headings = [];
  const items = [];
  const codeBlocks = [];
  const walker = tree.walker();
  let event;
  while ((event = walker.next())) {
    if (!event.entering) {
      continue;
    }
    const node = event.node;
    if (node.type === "heading" && isDocumentChild(node)) {
      headings.push({
        node,
        level: node.level,
        text: nodeText(node).trim(),
        startLine: node.sourcepos[0][0],
        endLine: node.sourcepos[1][0],
      });
    } else if (node.type === "item" && isTopLevelItem(node)) {
      items.push({
        node,
        startLine: node.sourcepos[0][0],
        endLine: node.sourcepos[1][0],
      });
    } else if (node.type === "code_block" && isDocumentChild(node)) {
      const fenceCharacter = node._fenceChar;
      const fenceLength = Number(node._fenceLength || 0);
      const closingLine = lines[node.sourcepos[1][0] - 1] || "";
      const closed = Boolean(
        node._isFenced
        && fenceCharacter
        && new RegExp(`^ {0,3}${fenceCharacter === "`" ? "`" : "~"}{${fenceLength},}\\s*$`).test(closingLine),
      );
      codeBlocks.push({
        node,
        startLine: node.sourcepos[0][0],
        endLine: node.sourcepos[1][0],
        fenced: Boolean(node._isFenced),
        closed,
        language: String(node.info || "").trim().split(/\s+/)[0] || "",
        content: String(node.literal || "").replace(/\n$/, ""),
      });
    }
  }
  return {
    source,
    lines,
    tree,
    headings,
    items,
    codeBlocks,
  };
}

function sectionEndLine(structure, heading) {
  const next = structure.headings.find((entry) => (
    entry.startLine > heading.startLine && entry.level <= heading.level
  ));
  return next ? next.startLine : Number.POSITIVE_INFINITY;
}

function sectionNodes(heading, options) {
  const nodes = [];
  let current = heading && heading.node ? heading.node.next : null;
  while (current) {
    if (current.type === "heading" && (
      options && options.stopAtAnyHeading
      || current.level <= heading.level
    )) {
      break;
    }
    nodes.push(current);
    current = current.next;
  }
  return nodes;
}

function itemLiteral(structure, item) {
  if (item.startLine !== item.endLine) {
    return null;
  }
  const line = structure.lines[item.startLine - 1] || "";
  const match = line.match(/^\s*(?:[-+*]|\d+[.)])\s+(.+?)\s*$/);
  return match ? match[1] : null;
}

module.exports = {
  itemLiteral,
  markdownStructure,
  nodeText,
  sectionEndLine,
  sectionNodes,
};
