"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveConceptPathSuggestion,
  normalizeConceptPath,
} = require("../src/authoring");

test("concept paths reject raw empty, dot, and parent segments", () => {
  for (const unsafe of [
    "notes//beta.md",
    "notes/./beta.md",
    "notes/../beta.md",
    "./beta.md",
    "../beta.md",
    ".git/refs/heads/poison.md",
    ".GIT/config.md",
    "notes/.hidden.md",
    "a.md/b.md",
    "INDEX.MD",
    "notes/Log.md",
  ]) {
    assert.throws(
      () => normalizeConceptPath(unsafe),
      /safe relative|stay inside|Markdown file|reserved/,
    );
  }
  assert.equal(normalizeConceptPath("notes/beta.md"), "notes/beta.md");
});

test("path suggestions use a dominant same-type directory only with strong evidence", () => {
  const bundle = { id: "handbook" };
  const documents = Array.from({ length: 13 }, (_, index) => ({
    bundle: bundle.id,
    valid: true,
    reserved: false,
    type: "Service Runbook",
    path: `operations/runbook-${index}.md`,
  })).concat({
    bundle: bundle.id,
    valid: true,
    reserved: false,
    type: "Service Runbook",
    path: "archive/service-runbook/legacy.md",
  });

  assert.deepEqual(
    deriveConceptPathSuggestion({ documents }, bundle, {
      type: "Service Runbook",
      title: "Queue Health Verification",
    }),
    {
      path: "operations/queue-health-verification.md",
      strategy: "dominant_same_type_directory",
      evidence: {
        matchingConcepts: 14,
        dominantDirectoryCount: 13,
        dominantDirectoryRatio: 0.929,
        dominantDirectory: "operations",
      },
    },
  );

  assert.equal(
    deriveConceptPathSuggestion({ documents }, bundle, {
      prefix: "operations",
      type: "Service Runbook",
      title: "Scoped Runbook",
    }).path,
    "operations/scoped-runbook.md",
  );
  assert.equal(
    deriveConceptPathSuggestion({ documents: documents.slice(0, 1) }, bundle, {
      type: "Service Runbook",
      title: "Sparse Example",
    }).path,
    "service-runbook/sparse-example.md",
  );

  for (const unsafePrefix of ["/absolute", "C:/absolute", "nested/../escape", "nested//empty"]) {
    assert.throws(
      () => deriveConceptPathSuggestion({ documents: [] }, bundle, {
        prefix: unsafePrefix,
        type: "Reference",
        title: "Unsafe",
      }),
      /safe relative|inside the bundle/,
    );
  }
});
