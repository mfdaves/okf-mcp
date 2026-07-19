"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isReservedPath(relativePath) {
  const base = path.basename(relativePath).toLowerCase();
  return base === "index.md" || base === "log.md";
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
  const match = String(body || "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function extractMarkdownLinks(body) {
  const out = [];
  const regex = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = regex.exec(String(body || "")))) {
    const target = match[2].trim();
    if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:") || target.startsWith("#")) {
      continue;
    }
    out.push({
      text: match[1],
      href: target,
    });
  }
  return out;
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

function markdownLines(body) {
  const lines = String(body || "").split(/\r?\n/);
  let fence = null;
  return lines.map((text, index) => {
    const marker = text.match(/^\s*(```+|~~~+)/);
    const hidden = Boolean(fence);
    if (marker) {
      if (!fence) {
        fence = marker[1][0];
      } else if (marker[1][0] === fence) {
        fence = null;
      }
      return { index, text, hidden: true };
    }
    return { index, text, hidden };
  });
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
  const visible = markdownLines(split.body).filter((line) => !line.hidden);
  if (!visible.some((line) => /^#{1,6}[ \t]+\S/.test(line.text))) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_index_missing_heading",
      "Reserved index.md must contain at least one Markdown heading.",
    ));
  }
  if (!extractMarkdownLinks(split.body).length) {
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
  const visible = markdownLines(split.body).filter((line) => !line.hidden);
  const headings = visible.map((line) => {
    const match = line.text.match(/^(#{1,6})[ \t]+(.+?)[ \t]*$/);
    return match ? { index: line.index, level: match[1].length, text: match[2].trim() } : null;
  }).filter(Boolean);
  const h1 = headings.filter((heading) => heading.level === 1);
  if (!h1.length) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_log_missing_h1",
      "Reserved log.md must start with an H1 title.",
    ));
  } else if (headings[0] !== h1[0]) {
    diagnostics.push(conformanceDiagnostic(
      bundle,
      relativePath,
      "reserved_log_h1_order",
      "The H1 title in reserved log.md must precede its dated sections.",
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
    const nextH2 = h2.find((heading) => heading.index > section.index);
    const end = nextH2 ? nextH2.index : Number.POSITIVE_INFINITY;
    const hasListItem = visible.some((line) => (
      line.index > section.index
      && line.index < end
      && /^\s*(?:[-+*]|\d+[.)])\s+\S/.test(line.text)
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
  const base = path.basename(relativePath).toLowerCase();
  if (base === "index.md") {
    return validateReservedIndex(bundle, relativePath, split);
  }
  if (base === "log.md") {
    return validateReservedLog(bundle, relativePath, split);
  }
  return [];
}

function parseMarkdownText(bundle, relativePath, text, sourcePath) {
  const reserved = isReservedPath(relativePath);
  const split = splitFrontmatter(text);
  const frontmatter = split.frontmatter || {};
  const warnings = [];
  if (!reserved && !split.frontmatter) {
    warnings.push({ code: "missing_frontmatter", path: relativePath, message: "Concept file has no YAML frontmatter." });
  }
  if (!reserved && (!frontmatter.type || String(frontmatter.type).trim() === "")) {
    warnings.push({ code: "missing_type", path: relativePath, message: "Concept file has no non-empty type field." });
  }
  if (!reserved && frontmatter.id && !String(frontmatter.id).startsWith("okf://")) {
    warnings.push({ code: "invalid_id", path: relativePath, message: "Concept id must start with okf://." });
  }
  const conformanceDiagnostics = reserved
    ? validateReservedDocument(bundle, relativePath, split)
    : warnings
      .filter((warning) => warning.code === "missing_frontmatter" || warning.code === "missing_type")
      .map((warning) => conformanceDiagnostic(bundle, relativePath, warning.code, warning.message));
  const title = frontmatter.title || extractTitle(split.body, path.basename(relativePath, ".md"));
  const pathUri = `okf://${bundle.id}/${relativePath}`;
  const uri = frontmatter.id && String(frontmatter.id).startsWith("okf://") ? String(frontmatter.id) : pathUri;
  return {
    bundle: bundle.id,
    bundleRoot: bundle.root,
    path: relativePath,
    absolutePath: sourcePath || relativePath,
    uri,
    pathUri,
    reserved,
    kind: reserved ? "reserved" : "concept",
    frontmatter,
    rawFrontmatter: split.rawFrontmatter,
    body: split.body,
    text,
    type: frontmatter.type || null,
    title,
    description: frontmatter.description || "",
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [],
    relations: Array.isArray(frontmatter.relations) ? frontmatter.relations : [],
    links: extractMarkdownLinks(split.body),
    warnings,
    diagnostics: conformanceDiagnostics,
    conformanceDiagnostics,
    valid: reserved || Boolean(frontmatter.type && String(frontmatter.type).trim() !== ""),
  };
}

function parseMarkdownFile(bundle, absolutePath) {
  const relativePath = safeRelativePath(bundle.root, absolutePath);
  if (relativePath === null) {
    throw new Error(`Path is outside bundle root: ${absolutePath}`);
  }
  return parseMarkdownText(bundle, relativePath, fs.readFileSync(absolutePath, "utf8"), absolutePath);
}

module.exports = {
  extractMarkdownLinks,
  isReservedPath,
  normalizeSlashes,
  parseFrontmatterYaml,
  parseMarkdownFile,
  parseMarkdownText,
  safeRelativePath,
  splitFrontmatter,
  validateReservedDocument,
};
