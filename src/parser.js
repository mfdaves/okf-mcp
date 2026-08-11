"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { normalizeV02Signals } = require("./v02");
const { markdownStructure, nodeText } = require("./markdown");

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isReservedPath(relativePath) {
  const base = path.basename(relativePath);
  return base === "index.md" || base === "log.md";
}

function validOkfConceptUri(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    return false;
  }
  const match = value.match(/^okf:\/\/([^/\s?#]+)\/([^\s?#]+)$/);
  return Boolean(
    match
    && match[2].split("/").every((segment) => segment && segment !== "." && segment !== ".."),
  );
}

function parseFrontmatterYaml(source) {
  let parsed;
  try {
    parsed = yaml.load(String(source || ""), {
      schema: yaml.CORE_SCHEMA,
      json: false,
    });
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    throw new Error(`Invalid YAML mapping: ${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML document root must be a mapping.");
  }
  return parsed;
}

function splitFrontmatter(text) {
  if (!String(text || "").startsWith("---\n") && !String(text || "").startsWith("---\r\n")) {
    return {
      frontmatter: null,
      body: String(text || ""),
      rawFrontmatter: "",
    };
  }
  const normalized = String(text).replace(/\r\n/g, "\n");
  let end = normalized.indexOf("\n---\n", 4);
  let markerLength = 5;
  if (end === -1 && normalized.endsWith("\n---")) {
    end = normalized.length - 4;
    markerLength = 4;
  }
  if (end === -1) {
    throw new Error("Opening frontmatter marker has no closing marker");
  }
  const rawFrontmatter = normalized.slice(4, end);
  return {
    frontmatter: parseFrontmatterYaml(rawFrontmatter),
    body: normalized.slice(end + markerLength),
    rawFrontmatter,
  };
}

function extractTitle(body, fallback) {
  const heading = markdownStructure(body).headings.find((entry) => entry.level === 1);
  return heading ? heading.text || fallback : fallback;
}

function isExternalMarkdownTarget(target) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith("//");
}

function extractMarkdownLinks(body) {
  const out = [];
  const tree = markdownStructure(body).tree;
  const walker = tree.walker();
  let event;
  while ((event = walker.next())) {
    const node = event.node;
    if (!event.entering || node.type !== "link") {
      continue;
    }
    const target = String(node.destination || "").trim();
    if (!target || isExternalMarkdownTarget(target) || target.startsWith("#")) {
      continue;
    }
    out.push({
      text: nodeText(node),
      href: target,
    });
  }
  return out;
}

function topLevelBlocks(tree) {
  const blocks = [];
  let current = tree && tree.firstChild;
  while (current) {
    blocks.push(current);
    current = current.next;
  }
  return blocks;
}

function hasLocalLink(node) {
  const walker = node.walker();
  let event;
  while ((event = walker.next())) {
    if (event.entering
      && event.node.type === "link"
      && event.node.destination
      && !isExternalMarkdownTarget(event.node.destination)
      && !String(event.node.destination).startsWith("#")) {
      return true;
    }
  }
  return false;
}

function safeRelativePath(root, absolutePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(absolutePath);
  const rel = path.relative(resolvedRoot, resolvedPath);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return normalizeSlashes(rel);
  }
  return null;
}

function conformanceDiagnostic(bundle, relativePath, code, message) {
  return {
    code,
    severity: "error",
    layer: "conformance",
    bundle: bundle.id,
    path: relativePath,
    message,
  };
}

function validIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

function validateReservedIndex(bundle, relativePath, split) {
  const diagnostics = [];
  const rootIndex = normalizeSlashes(relativePath) === "index.md";
  if (split.frontmatter) {
    if (!rootIndex) {
      diagnostics.push(conformanceDiagnostic(
        bundle,
        relativePath,
        "reserved_index_frontmatter_not_allowed",
        "Only a bundle-root index.md may declare frontmatter.",
      ));
    } else {
      const keys = Object.keys(split.frontmatter);
      if (keys.some((key) => key !== "okf_version")) {
        diagnostics.push(conformanceDiagnostic(
          bundle,
          relativePath,
          "reserved_index_invalid_frontmatter",
          "Bundle-root index.md frontmatter may contain only okf_version.",
        ));
      }
      if (
        !Object.prototype.hasOwnProperty.call(split.frontmatter, "okf_version")
        || split.frontmatter.okf_version === null
        || typeof split.frontmatter.okf_version === "object"
        || String(split.frontmatter.okf_version).trim() === ""
      ) {
        diagnostics.push(conformanceDiagnostic(
          bundle,
          relativePath,
          "reserved_index_invalid_okf_version",
          "Bundle-root index.md frontmatter must declare a non-empty scalar okf_version.",
        ));
      }
    }
  }
  const structure = markdownStructure(split.body);
  const blocks = topLevelBlocks(structure.tree);
  if (!structure.headings.length) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_index_missing_heading",
      "Reserved index.md must contain at least one Markdown heading.",
    ));
  }
  if (blocks.length && blocks[0].type !== "heading") {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_index_heading_order",
      "Reserved index.md content must begin with a heading.",
    ));
  }
  const groupedLink = blocks.some((block, index) => (
    block.type === "list"
    && blocks.slice(0, index).some((entry) => entry.type === "heading")
    && hasLocalLink(block)
  ));
  if (!groupedLink) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_index_missing_link",
      "Reserved index.md must contain at least one local Markdown link entry.",
    ));
  }
  return diagnostics;
}

function validateReservedLog(bundle, relativePath, split) {
  const diagnostics = [];
  if (split.frontmatter) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_log_frontmatter_not_allowed",
      "Reserved log.md must not declare YAML frontmatter.",
    ));
  }
  const structure = markdownStructure(split.body);
  const blocks = topLevelBlocks(structure.tree);
  const headings = structure.headings;
  const h1 = headings.filter((heading) => heading.level === 1);
  if (!h1.length) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_log_missing_h1",
      "Reserved log.md must start with an H1 title.",
    ));
  } else if (!blocks.length || blocks[0] !== h1[0].node) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_log_h1_order",
      "The H1 title in reserved log.md must precede its dated sections.",
    ));
  }
  if (h1.length > 1) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_log_multiple_h1",
      "Reserved log.md must contain exactly one H1 title.",
    ));
  }

  const h2 = headings.filter((heading) => heading.level === 2);
  const sections = [];
  h2.forEach((heading) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(heading.text)) {
      diagnostics.push(conformanceDiagnostic(
        bundle,
        relativePath,
        "reserved_log_invalid_date_heading",
        `Log H2 heading must be a strict ISO date (YYYY-MM-DD): ${heading.text}`,
      ));
      return;
    }
    if (!validIsoDate(heading.text)) {
      diagnostics.push(conformanceDiagnostic(
        bundle,
        relativePath,
        "reserved_log_invalid_date",
        `Log H2 heading is not a valid calendar date: ${heading.text}`,
      ));
      return;
    }
    sections.push(heading);
  });
  if (!sections.length) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_log_missing_date_section",
      "Reserved log.md must contain at least one valid ISO-dated H2 section.",
    ));
  }
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index - 1].text <= sections[index].text) {
      diagnostics.push(conformanceDiagnostic(
        bundle,
        relativePath,
        "reserved_log_dates_not_descending",
        "Log date sections must be ordered newest first without duplicate dates.",
      ));
      break;
    }
  }
  sections.forEach((section) => {
    const nextHeading = headings.find((heading) => (
      heading.startLine > section.startLine && heading.level <= section.level
    ));
    const end = nextHeading ? nextHeading.startLine : Number.POSITIVE_INFINITY;
    const hasListItem = structure.items.some((item) => (
      item.startLine > section.startLine && item.startLine < end
    ));
    if (!hasListItem) {
      diagnostics.push(conformanceDiagnostic(
        bundle,
        relativePath,
        "reserved_log_missing_list_item",
        `Log date section ${section.text} must contain at least one prose list item.`,
      ));
    }
  });
  return diagnostics;
}

function validateReservedDocument(bundle, relativePath, split) {
  const base = path.basename(relativePath);
  if (base === "index.md") {
    return validateReservedIndex(bundle, relativePath, split);
  }
  if (base === "log.md") {
    return validateReservedLog(bundle, relativePath, split);
  }
  return [];
}

function parseMarkdownText(bundle, relativePath, text, sourcePath, options) {
  const reserved = isReservedPath(relativePath);
  const split = splitFrontmatter(text);
  const frontmatter = split.frontmatter || {};
  const warnings = [];
  if (!reserved && !split.frontmatter) {
    warnings.push({ code: "missing_frontmatter", path: relativePath, message: "Concept file has no YAML frontmatter." });
  }
  const validType = typeof frontmatter.type === "string" && frontmatter.type.trim() !== "";
  if (!reserved && !validType) {
    warnings.push({ code: "missing_type", path: relativePath, message: "Concept file type must be a non-empty string." });
  }
  const hasCustomId = Object.prototype.hasOwnProperty.call(frontmatter, "id");
  const customIdValid = hasCustomId && validOkfConceptUri(frontmatter.id);
  if (!reserved && hasCustomId && !customIdValid) {
    warnings.push({
      code: "invalid_id",
      path: relativePath,
      message: "Concept id must match okf://<bundle>/<concept-id> with non-empty safe path segments.",
    });
  }
  const conformanceDiagnostics = reserved
    ? validateReservedDocument(bundle, relativePath, split)
    : warnings
      .filter((warning) => warning.code === "missing_frontmatter" || warning.code === "missing_type")
      .map((warning) => conformanceDiagnostic(bundle, relativePath, warning.code, warning.message));
  const title = frontmatter.title || extractTitle(split.body, path.basename(relativePath).replace(/\.md$/i, ""));
  const pathUri = `okf://${bundle.id}/${relativePath}`;
  const conceptId = reserved
    ? relativePath
    : normalizeSlashes(relativePath).replace(/\.md$/i, "");
  const uri = `okf://${bundle.id}/${conceptId}`;
  const customId = customIdValid ? frontmatter.id : null;
  const signals = normalizeV02Signals({ frontmatter, body: split.body }, {
    asOf: options && options.asOf,
  });
  const v02Diagnostics = signals.diagnostics.map((entry) => Object.assign({
    bundle: bundle.id,
    path: relativePath,
  }, entry));
  warnings.push.apply(warnings, v02Diagnostics);
  return {
    bundle: bundle.id,
    bundleRoot: bundle.root,
    path: relativePath,
    absolutePath: sourcePath || relativePath,
    uri,
    pathUri,
    conceptId,
    customId,
    uriAliases: Array.from(new Set([pathUri, customId].filter((alias) => alias && alias !== uri))),
    reserved,
    kind: reserved ? "reserved" : "concept",
    frontmatter,
    rawFrontmatter: split.rawFrontmatter,
    body: split.body,
    text,
    type: validType ? frontmatter.type : null,
    title,
    description: frontmatter.description || "",
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [],
    relations: Array.isArray(frontmatter.relations) ? frontmatter.relations : [],
    signals,
    v02Diagnostics,
    links: extractMarkdownLinks(split.body),
    warnings,
    diagnostics: conformanceDiagnostics,
    conformanceDiagnostics,
    valid: reserved || validType,
  };
}

function parseMarkdownFile(bundle, absolutePath, options) {
  const relativePath = safeRelativePath(bundle.root, absolutePath);
  if (relativePath === null) {
    throw new Error(`Path is outside bundle root: ${absolutePath}`);
  }
  const bytes = fs.readFileSync(absolutePath);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Concept document is not valid UTF-8.");
  }
  return parseMarkdownText(bundle, relativePath, text, absolutePath, options);
}

module.exports = {
  extractMarkdownLinks,
  extractTitle,
  isReservedPath,
  normalizeSlashes,
  parseFrontmatterYaml,
  parseMarkdownFile,
  parseMarkdownText,
  safeRelativePath,
  splitFrontmatter,
  validateReservedDocument,
};
