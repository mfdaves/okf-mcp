"use strict";

// Frontmatter and concept Markdown rendering (split from src/authoring.js,
// plan Q-1); src/authoring.js re-exports both names for compatibility.

const path = require("node:path");
const yaml = require("js-yaml");

function renderFrontmatter(frontmatter) {
  const values = Object.fromEntries(
    Object.entries(frontmatter || {}).filter((entry) => entry[1] !== undefined),
  );
  return yaml
    .dump(values, {
      schema: yaml.CORE_SCHEMA,
      noRefs: true,
      lineWidth: -1,
      sortKeys: false,
    })
    .trimEnd();
}

function renderConceptMarkdown(input) {
  const frontmatter = Object.assign({}, input?.frontmatter || {});
  const body = String(input?.body || "")
    .replace(/\r\n/g, "\n")
    .trim();
  return [
    "---",
    renderFrontmatter(frontmatter),
    "---",
    "",
    body || `# ${frontmatter.title || path.posix.basename(input.path || "concept.md", ".md")}`,
    "",
  ].join("\n");
}

module.exports = { renderConceptMarkdown, renderFrontmatter };
