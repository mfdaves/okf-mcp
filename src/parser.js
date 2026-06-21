"use strict";

const fs = require("fs");
const path = require("path");

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isReservedPath(relativePath) {
  const base = path.basename(relativePath).toLowerCase();
  return base === "index.md" || base === "log.md";
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseScalar(value) {
  const text = String(value || "").trim();
  if (text === "") {
    return "";
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (text === "null") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((entry) => stripQuotes(entry.trim())).filter((entry) => entry !== "");
  }
  return stripQuotes(text);
}

function parseKeyValue(text, lineNumber) {
  const keyMatch = String(text || "").match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
  if (!keyMatch) {
    throw new Error(`Unsupported YAML frontmatter line ${lineNumber}: ${text}`);
  }
  return {
    key: keyMatch[1],
    value: keyMatch[2] || "",
  };
}

function countIndent(line) {
  const match = String(line || "").match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function parseBlockArray(lines, startIndex, parentIndent) {
  const values = [];
  let index = startIndex;
  while (index < lines.length) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    const indent = countIndent(raw);
    if (indent <= parentIndent) {
      break;
    }
    const arrayMatch = raw.match(/^\s*-\s+(.*)$/);
    if (!arrayMatch) {
      throw new Error(`Unsupported YAML array line ${index + 1}: ${raw}`);
    }
    const itemText = arrayMatch[1].trim();
    const itemKv = itemText.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
    if (!itemKv) {
      values.push(parseScalar(itemText));
      index += 1;
      continue;
    }
    const item = {};
    item[itemKv[1]] = parseScalar(itemKv[2] || "");
    index += 1;
    while (index < lines.length) {
      const childRaw = lines[index];
      if (!childRaw.trim() || childRaw.trim().startsWith("#")) {
        index += 1;
        continue;
      }
      const childIndent = countIndent(childRaw);
      if (childIndent <= indent) {
        break;
      }
      const child = parseKeyValue(childRaw.trim(), index + 1);
      item[child.key] = child.value.trim() === "" ? "" : parseScalar(child.value);
      index += 1;
    }
    values.push(item);
  }
  return { values, nextIndex: index };
}

function parseFrontmatterYaml(yaml) {
  const out = {};
  const lines = String(yaml || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith("#")) {
      continue;
    }
    if (countIndent(raw) !== 0) {
      throw new Error(`Unsupported YAML frontmatter line ${index + 1}: ${raw}`);
    }
    const parsed = parseKeyValue(raw, index + 1);
    const key = parsed.key;
    const value = parsed.value;
    if (value.trim() === "") {
      const block = parseBlockArray(lines, index + 1, 0);
      out[key] = block.values;
      index = block.nextIndex - 1;
    } else {
      out[key] = parseScalar(value);
    }
  }
  return out;
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
};
