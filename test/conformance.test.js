"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { renderConceptMarkdown } = require("../src/authoring");
const { buildIndex, validateIndex } = require("../src/indexer");
const { parseFrontmatterYaml, splitFrontmatter } = require("../src/parser");

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-conformance-"));
  Object.entries(files).forEach(([relativePath, content]) => {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
  });
  return root;
}

function concept(frontmatter, body) {
  return `---\n${frontmatter}\n---\n\n${body || "# Concept"}\n`;
}

test("standards YAML accepts complex mappings, extensions, and unknown concept types", () => {
  const root = fixture({
    "complex.md": concept([
      "type: Vendor Specific Runtime",
      "title: Complex",
      "description: |",
      "  First line.",
      "  Second line.",
      "aliases: [\"alpha,beta\", gamma]",
      "x-extension:",
      "  nested:",
      "    enabled: true",
      "    limits: [1, 2, 3]",
    ].join("\n"), "# Complex"),
  });
  const index = buildIndex([`fixture=${root}`]);
  const validation = validateIndex(index);

  assert.equal(validation.conformant, true);
  assert.equal(validation.validForProject, true);
  assert.equal(validation.valid, validation.validForProject);
  assert.equal(index.concepts[0].type, "Vendor Specific Runtime");
  assert.deepEqual(index.concepts[0].frontmatter.aliases, ["alpha,beta", "gamma"]);
  assert.equal(index.concepts[0].frontmatter["x-extension"].nested.enabled, true);
  assert.deepEqual(index.concepts[0].frontmatter["x-extension"].nested.limits, [1, 2, 3]);
  assert.match(index.concepts[0].description, /First line\.\nSecond line\./);
});

test("an invalid extension id is a project diagnostic, not a conformance failure", () => {
  const root = fixture({
    "invalid-id.md": concept("type: Concept\nid: local-id", "# Invalid extension id"),
  });
  const validation = validateIndex(buildIndex([`fixture=${root}`]));

  assert.equal(validation.conformant, true);
  assert.equal(validation.validForProject, false);
  assert.equal(validation.diagnostics.some((entry) => (
    entry.code === "invalid_id"
    && entry.layer === "project"
  )), true);
});

test("authoring preserves nested extension frontmatter through YAML serialization", () => {
  const frontmatter = {
    type: "Vendor Specific Runtime",
    title: "Nested",
    "x-extension": {
      enabled: true,
      limits: [1, 2, 3],
      owner: {
        team: "runtime",
      },
    },
  };
  const markdown = renderConceptMarkdown({
    path: "nested.md",
    frontmatter,
    body: "# Nested",
  });

  assert.deepEqual(splitFrontmatter(markdown).frontmatter, frontmatter);
});

test("YAML requires a mapping root and rejects duplicate mapping keys", () => {
  assert.throws(
    () => parseFrontmatterYaml("- Concept\n- Other"),
    /root must be a mapping/,
  );
  assert.throws(
    () => parseFrontmatterYaml("type: Concept\ntype: Other"),
    /duplicated mapping key/i,
  );
  assert.throws(
    () => parseFrontmatterYaml("type: !include concept.yaml"),
    /unknown (?:scalar )?tag/i,
  );
  assert.throws(
    () => parseFrontmatterYaml("unsafe: !!js/function >\n  function () {}"),
    /unknown scalar tag/i,
  );

  const root = fixture({
    "duplicate.md": concept("type: Concept\ntype: Other", "# Duplicate"),
    "sequence.md": concept("- Concept\n- Other", "# Sequence"),
  });
  const index = buildIndex([`fixture=${root}`]);
  const validation = validateIndex(index);

  assert.equal(validation.conformant, false);
  assert.equal(validation.validForProject, false);
  assert.equal(index.errors.filter((entry) => entry.code === "parse_error").length, 2);
  assert.equal(validation.diagnostics.filter((entry) => entry.layer === "conformance").length, 2);
});

test("a broken Markdown link is conformant but invalid for the project", () => {
  const root = fixture({
    "source.md": concept("type: Concept\ntitle: Source", "# Source\n\n[Missing](missing.md)"),
  });
  const index = buildIndex([`fixture=${root}`]);
  const validation = validateIndex(index);

  assert.equal(validation.conformant, true);
  assert.equal(validation.validForProject, false);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.some((entry) => entry.code === "broken_link"), true);
  assert.equal(validation.diagnostics.some((entry) => (
    entry.code === "broken_link"
    && entry.layer === "project"
    && entry.severity === "warning"
  )), true);
});

test("project graph errors do not redefine document conformance", () => {
  const first = fixture({
    "first.md": concept("type: Concept", "# First"),
  });
  const second = fixture({
    "second.md": concept("type: Concept", "# Second"),
  });
  const index = buildIndex([
    { id: "duplicate", root: first },
    { id: "duplicate", root: second },
  ]);
  const validation = validateIndex(index);

  assert.equal(validation.conformant, true);
  assert.equal(validation.validForProject, false);
  assert.equal(validation.errors.some((entry) => entry.code === "duplicate_bundle_id"), true);
  assert.equal(validation.diagnostics.some((entry) => (
    entry.code === "duplicate_bundle_id"
    && entry.layer === "project"
    && entry.severity === "error"
  )), true);
});

test("validateIndex can scope project validity to one bundle", () => {
  const good = fixture({
    "concept.md": concept("type: Concept", "# Good"),
  });
  const broken = fixture({
    "concept.md": concept("type: Concept", "# Broken\n\n[Missing](missing.md)"),
  });
  const index = buildIndex([
    { id: "good", root: good },
    { id: "broken", root: broken },
  ]);

  assert.equal(validateIndex(index).validForProject, false);
  assert.equal(validateIndex(index, "good").validForProject, true);
  assert.equal(validateIndex(index, "broken").conformant, true);
  assert.equal(validateIndex(index, "broken").validForProject, false);
});

test("malformed reserved indexes and logs emit explicit conformance diagnostics", () => {
  const root = fixture({
    "concept.md": concept("type: Concept", "# Concept"),
    "index.md": "This index has neither a heading nor a link.\n",
    "docs/index.md": [
      "---",
      "owner: docs",
      "---",
      "",
      "# Nested Index",
      "",
      "[Concept](../concept.md)",
      "",
    ].join("\n"),
    "log.md": [
      "# Change Log",
      "",
      "## 2024-01-01",
      "",
      "- Older entry",
      "",
      "## 2024-02-01",
      "",
      "No list item here.",
      "",
      "## 2024-02-30",
      "",
      "- Impossible date",
      "",
      "## February 2024",
      "",
      "- Non-ISO date",
      "",
    ].join("\n"),
  });
  const validation = validateIndex(buildIndex([`fixture=${root}`]));
  const codes = new Set(validation.diagnostics.map((entry) => entry.code));

  assert.equal(validation.conformant, false);
  assert.equal(validation.validForProject, false);
  assert.equal(codes.has("reserved_index_missing_heading"), true);
  assert.equal(codes.has("reserved_index_missing_link"), true);
  assert.equal(codes.has("reserved_index_frontmatter_not_allowed"), true);
  assert.equal(codes.has("reserved_log_dates_not_descending"), true);
  assert.equal(codes.has("reserved_log_missing_list_item"), true);
  assert.equal(codes.has("reserved_log_invalid_date"), true);
  assert.equal(codes.has("reserved_log_invalid_date_heading"), true);
});

test("valid reserved index and log resources pass conformance", () => {
  const root = fixture({
    "concept.md": concept("type: Unregistered Concept Type\nx-extra: accepted", "# Concept"),
    "index.md": [
      "---",
      "okf_version: \"0.1\"",
      "---",
      "",
      "# Bundle Index",
      "",
      "## Concepts",
      "",
      "- [Concept](concept.md)",
      "",
    ].join("\n"),
    "log.md": [
      "# Change Log",
      "",
      "## 2025-02-02",
      "",
      "- **Added** the current concept.",
      "",
      "## 2025-01-01",
      "",
      "- Initial prose entry.",
      "",
    ].join("\n"),
  });
  const index = buildIndex([`fixture=${root}`]);
  const validation = validateIndex(index);

  assert.equal(index.reserved.length, 2);
  assert.equal(validation.conformant, true);
  assert.equal(validation.validForProject, true);
  assert.deepEqual(validation.diagnostics, []);
});
