"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeV02Signals } = require("../src/v02");

function codes(result) {
  return new Set(result.diagnostics.map((entry) => entry.code));
}

test("normalizes native provenance, generation, verification, and lifecycle without mutating raw values", () => {
  const frontmatter = {
    type: "Metric",
    resource: "https://example.test/metrics/revenue",
    sources: [
      {
        id: "policy",
        resource: "references/policy.md",
        title: "Revenue policy",
        author: "team:finance",
        usage_count: 42,
        last_modified: "2026-07-31",
        "x-source": "preserved",
      },
    ],
    usage_window: { from: "2026-07-01", to: "2026-07-31", note: "preserved" },
    generated: {
      by: "reference_agent/gemini-2.5-pro",
      at: "2026-08-01T09:00:00Z",
      "x-generator": "preserved",
    },
    verified: { by: "human:reviewer", at: "2026-08-02T10:30:00+02:00", note: "preserved" },
    status: "deprecated",
    stale_after: "2026-08-11",
    "x-extension": { nested: true },
  };
  const snapshot = structuredClone(frontmatter);
  const result = normalizeV02Signals({ frontmatter, body: "# Metric" }, { asOf: "2026-08-11" });

  assert.deepEqual(frontmatter, snapshot);
  assert.equal(result.raw, frontmatter);
  assert.equal(result.resource, frontmatter.resource);
  assert.equal(result.sourcesOrigin, "native");
  assert.equal(result.sources[0]["x-source"], "preserved");
  assert.deepEqual(result.sources[0].usageWindow, frontmatter.usage_window);
  assert.equal(result.generatedOrigin, "native");
  assert.equal(result.generated.by, "reference_agent/gemini-2.5-pro");
  assert.equal(result.generated["x-generator"], "preserved");
  assert.deepEqual(result.verifiedEvents, [frontmatter.verified]);
  assert.notEqual(result.verifiedEvents[0], frontmatter.verified);
  assert.equal(result.trustTier, "human-reviewed");
  assert.equal(result.status, "deprecated");
  assert.equal(result.staleAfter, "2026-08-11");
  assert.equal(result.freshness, "stale");
  assert.deepEqual(result.diagnostics, []);
});

test("native sources and generated metadata win over legacy fallbacks even when empty or malformed", () => {
  const native = normalizeV02Signals({
    type: "Metric",
    sources: [],
    generated: { by: "process:refresh", at: "2026-08-01T00:00:00Z" },
    timestamp: "2025-01-01T00:00:00Z",
  }, {
    body: "# Metric\n\n# Citations\n- https://legacy.example/source",
    asOf: "2026-08-11",
  });
  assert.equal(native.sourcesOrigin, "native");
  assert.deepEqual(native.sources, []);
  assert.equal(native.generatedOrigin, "native");
  assert.equal(native.generated.at, "2026-08-01T00:00:00Z");

  const malformed = normalizeV02Signals({
    type: "Metric",
    sources: "bad",
    generated: "bad",
    timestamp: "2025-01-01T00:00:00Z",
  }, {
    body: "# Citations\n- https://legacy.example/source",
    asOf: "2026-08-11",
  });
  assert.equal(malformed.sourcesOrigin, "native");
  assert.deepEqual(malformed.sources, []);
  assert.equal(malformed.generatedOrigin, "native");
  assert.equal(malformed.generated, null);
  assert.equal(codes(malformed).has("invalid_sources"), true);
  assert.equal(codes(malformed).has("invalid_generated"), true);
});

test("falls back to legacy Citations and timestamp and marks both as legacy", () => {
  const result = normalizeV02Signals({
    type: "Metric",
    timestamp: "2026-05-28T22:53:05+00:00",
  }, {
    body: [
      "# Metric",
      "",
      "```markdown",
      "# Citations",
      "- https://ignored.example",
      "```",
      "",
      "# Citations",
      "- [Policy](https://example.test/policy)",
      "- `references/local.md`",
      "",
      "# Notes",
      "- https://not-a-citation.example",
    ].join("\n"),
    asOf: "2026-08-11",
  });

  assert.equal(result.sourcesOrigin, "legacy_citations");
  assert.deepEqual(result.sources.map((entry) => entry.resource), [
    "https://example.test/policy",
    "references/local.md",
  ]);
  assert.equal(result.sources.every((entry) => entry.legacy), true);
  assert.equal(result.sources[0].title, "Policy");
  assert.equal(result.generatedOrigin, "legacy_timestamp");
  assert.deepEqual(result.generated, {
    by: null,
    at: "2026-05-28T22:53:05+00:00",
    legacy: true,
    valid: true,
  });
});

test("derives exactly three trust tiers and fails malformed verification closed", () => {
  const absent = normalizeV02Signals({ type: "Metric" }, { asOf: "2026-08-11" });
  assert.equal(absent.trustTier, "unverified");
  assert.deepEqual(absent.verifiedEvents, []);

  const machine = normalizeV02Signals({
    type: "Metric",
    verified: [
      { by: "process:nightly", at: "2026-08-10T02:00:00Z" },
      { by: "reference_agent/gemini-2.5-pro", at: "2026-08-10T03:00:00Z" },
    ],
  }, { asOf: "2026-08-11" });
  assert.equal(machine.trustTier, "machine-confirmed");

  const human = normalizeV02Signals({
    type: "Metric",
    verified: [
      { by: "process:nightly", at: "2026-08-10T02:00:00Z" },
      { by: "human:alice", at: "2026-08-10T03:00:00Z" },
    ],
  }, { asOf: "2026-08-11" });
  assert.equal(human.trustTier, "human-reviewed");

  const malformed = normalizeV02Signals({
    type: "Metric",
    verified: [
      { by: "human:alice", at: "2026-08-10T03:00:00Z" },
      { by: "human:bob", at: "not-a-datetime" },
    ],
  }, { asOf: "2026-08-11" });
  assert.equal(malformed.trustTier, "unverified");
  assert.deepEqual(malformed.verifiedEvents, []);
  assert.equal(codes(malformed).has("invalid_verified_at"), true);

  const invalidActor = normalizeV02Signals({
    type: "Metric",
    verified: { by: "human:", at: "2026-08-10T03:00:00Z" },
  }, { asOf: "2026-08-11" });
  assert.equal(invalidActor.trustTier, "unverified");
  assert.equal(codes(invalidActor).has("invalid_verified_actor"), true);
});

test("defaults lifecycle and computes freshness on the exact UTC date boundary", () => {
  const defaults = normalizeV02Signals({ type: "Metric" }, { asOf: "2026-08-10" });
  assert.equal(defaults.status, "stable");
  assert.equal(defaults.staleAfter, null);
  assert.equal(defaults.freshness, "unspecified");

  const fresh = normalizeV02Signals({ type: "Metric", stale_after: "2026-08-11" }, { asOf: "2026-08-10" });
  assert.equal(fresh.freshness, "fresh");
  const boundary = normalizeV02Signals({ type: "Metric", stale_after: "2026-08-11" }, { asOf: "2026-08-11" });
  assert.equal(boundary.freshness, "stale");
  const utcDate = normalizeV02Signals({ type: "Metric" }, { asOf: "2026-08-11T00:30:00+02:00" });
  assert.equal(utcDate.asOf, "2026-08-10");

  const malformed = normalizeV02Signals({
    type: "Metric",
    status: "archived",
    stale_after: "2026-02-30",
  }, { asOf: "2026-08-11" });
  assert.equal(malformed.status, null);
  assert.equal(malformed.freshness, "invalid");
  assert.deepEqual([...codes(malformed)].sort(), ["invalid_stale_after", "invalid_status"]);
  assert.throws(() => normalizeV02Signals({ type: "Metric" }, { asOf: "not-a-date" }), /asOf/);
});

test("normalizes source credibility and usage windows with soft diagnostics", () => {
  const result = normalizeV02Signals({
    type: "Metric",
    sources: [
      {
        id: "good",
        resource: "https://example.test/good",
        usage_count: 3,
        last_modified: "2026-08-01",
        usage_window: { from: "2026-08-01", to: "2026-08-10" },
      },
      { id: "missing-resource", usage_count: -1, last_modified: "2026-02-30" },
      "not-a-mapping",
    ],
    usage_window: { from: "2026-08-10", to: "2026-08-01" },
  }, { asOf: "2026-08-11" });

  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[0].valid, true);
  assert.deepEqual(result.sources[0].usageWindow, { from: "2026-08-01", to: "2026-08-10" });
  assert.equal(result.sources[1].valid, false);
  assert.equal(result.sources[2].valid, false);
  assert.equal(result.usageWindow, null);
  assert.deepEqual([...codes(result)].sort(), [
    "invalid_source_entry",
    "invalid_source_last_modified",
    "invalid_source_usage_count",
    "invalid_usage_window",
    "missing_source_resource",
  ]);
});

test("extracts a structurally ready inline Attested Computation", () => {
  const frontmatter = {
    type: "Attested Computation",
    runtime: "bigquery",
    parameters: [
      { name: "year", type: "integer", required: true, note: "preserved" },
    ],
    executor: {
      resource: "references/skills/run-on-bq.md",
      receipt: ["job_id", "executed_sql", "result"],
    },
    attester: { resource: "references/attesters/sql-equality.py" },
  };
  const body = [
    "# Attested Revenue",
    "",
    "# Computation",
    "",
    "```sql",
    "SELECT SUM(amount)",
    "FROM revenue",
    "WHERE fiscal_year = @year",
    "```",
    "",
    "Policy prose.",
  ].join("\n");
  const result = normalizeV02Signals({ frontmatter, body }, { asOf: "2026-08-11" });

  assert.equal(result.computation.ready, true);
  assert.equal(result.computation.runtime, "bigquery");
  assert.equal(result.computation.parameters[0].note, "preserved");
  assert.deepEqual(result.computation.computation, {
    mode: "inline",
    language: "sql",
    content: "SELECT SUM(amount)\nFROM revenue\nWHERE fiscal_year = @year",
    closed: true,
  });
  assert.deepEqual(result.diagnostics, []);
});

test("extracts file computations and diagnoses conflicting inline content", () => {
  const contract = {
    type: "Attested Computation",
    runtime: "postgres",
    computation: "references/computations/revenue.sql",
    executor: { resource: "references/run.md", receipt: ["query_id", "executed_sql", "result"] },
    attester: { resource: "references/attest.py" },
  };
  const file = normalizeV02Signals(contract, { body: "# Revenue", asOf: "2026-08-11" });
  assert.equal(file.computation.ready, true);
  assert.deepEqual(file.computation.computation, {
    mode: "file",
    path: "references/computations/revenue.sql",
  });

  const conflict = normalizeV02Signals(contract, {
    body: "# Computation\n\n```sql\nSELECT 1\n```",
    asOf: "2026-08-11",
  });
  assert.equal(conflict.computation.ready, false);
  assert.equal(conflict.computation.computation, null);
  assert.equal(codes(conflict).has("conflicting_computation_sources"), true);
});

test("computation readiness fails structurally without affecting non-computation concepts", () => {
  const invalid = normalizeV02Signals({
    type: "Attested Computation",
    parameters: [
      { name: "year", type: "integer", required: true },
      { name: "year", type: "integer", required: true },
    ],
    executor: { resource: "", receipt: ["result", "result"] },
    attester: {},
  }, {
    body: "# Computation\n\n```sql\n```",
    asOf: "2026-08-11",
  });
  assert.equal(invalid.computation.ready, false);
  assert.equal(invalid.computation.parameters, null);
  assert.deepEqual([...codes(invalid)].sort(), [
    "duplicate_computation_parameter",
    "duplicate_executor_receipt_field",
    "invalid_inline_computation",
    "missing_attester_resource",
    "missing_computation_runtime",
    "missing_executor_resource",
  ]);

  const ordinary = normalizeV02Signals({ type: "Metric", runtime: "ignored" }, { asOf: "2026-08-11" });
  assert.equal(ordinary.computation, null);
  assert.deepEqual(ordinary.diagnostics, []);
});

test("inline extraction ignores similarly named headings outside the H1 computation section", () => {
  const result = normalizeV02Signals({
    type: "Attested Computation",
    runtime: "python",
    executor: { resource: "references/run.md", receipt: ["result"] },
    attester: { resource: "references/attest.py" },
  }, {
    body: [
      "## Computation",
      "```sql",
      "SELECT 'ignored'",
      "```",
      "# Notes",
      "```markdown",
      "# Computation",
      "```",
      "# Computation",
      "~~~python",
      "print('used')",
      "~~~",
    ].join("\n"),
    asOf: "2026-08-11",
  });
  assert.equal(result.computation.ready, true);
  assert.deepEqual(result.computation.inline, {
    sectionCount: 1,
    blocks: [{ language: "python", content: "print('used')", closed: true }],
  });
});

test("CommonMark structure excludes quoted and outer-fence pseudo sections", () => {
  const provenance = normalizeV02Signals({ type: "Metric" }, {
    body: [
      "````markdown",
      "```",
      "# Citations",
      "- https://inside-fence.example",
      "````",
      "",
      "> # Citations",
      ">",
      "> - https://inside-quote.example",
      "",
      "# Citations #",
      "- https://kept.example",
    ].join("\n"),
    asOf: "2026-08-11",
  });
  assert.deepEqual(provenance.sources.map((entry) => entry.resource), ["https://kept.example"]);

  const contract = {
    type: "Attested Computation",
    runtime: "python",
    executor: { resource: "references/run.md", receipt: ["result"] },
    attester: { resource: "references/attest.py" },
  };
  const quoted = normalizeV02Signals(contract, {
    body: "> # Computation\n\n```python\nprint('not owned by the quote')\n```",
    asOf: "2026-08-11",
  });
  assert.equal(quoted.computation.ready, false);
  assert.equal(quoted.computation.inline.sectionCount, 0);

  const closingHash = normalizeV02Signals(contract, {
    body: "# Computation #\n\n```python\nprint('accepted')\n```",
    asOf: "2026-08-11",
  });
  assert.equal(closingHash.computation.ready, true);
  assert.equal(closingHash.computation.computation.content, "print('accepted')");

  const indented = normalizeV02Signals(contract, {
    body: "# Computation\n\n    ```python\n    print('not fenced')\n    ```",
    asOf: "2026-08-11",
  });
  assert.equal(indented.computation.ready, false);
  assert.equal(codes(indented).has("invalid_inline_computation"), true);
});

test("strict ISO helpers reject impossible dates and timezone-less datetimes", () => {
  const leap = normalizeV02Signals({ type: "Metric", stale_after: "2024-02-29" }, { asOf: "2024-02-28" });
  assert.equal(leap.freshness, "fresh");

  const impossibleDate = normalizeV02Signals({ type: "Metric", stale_after: "2025-02-29" }, { asOf: "2025-02-28" });
  assert.equal(impossibleDate.freshness, "invalid");
  assert.equal(codes(impossibleDate).has("invalid_stale_after"), true);

  const zoned = normalizeV02Signals({
    type: "Metric",
    generated: { by: "process:refresh", at: "2026-08-11T10:00:00+02:00" },
  }, { asOf: "2026-08-11" });
  assert.equal(zoned.generated.valid, true);

  const minutePrecision = normalizeV02Signals({
    type: "Metric",
    generated: { by: "process:refresh", at: "2026-08-11T10:00Z" },
  }, { asOf: "2026-08-11" });
  assert.equal(minutePrecision.generated.valid, true);

  for (const at of ["2026-08-11T10:00:00", "2026-02-30T10:00:00Z"]) {
    const invalid = normalizeV02Signals({
      type: "Metric",
      generated: { by: "process:refresh", at },
    }, { asOf: "2026-08-11" });
    assert.equal(invalid.generated.valid, false);
    assert.equal(codes(invalid).has("invalid_generated_at"), true);
  }
});
