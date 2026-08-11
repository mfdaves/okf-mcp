"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildV02MigrationPlan,
  checkV02Migration,
  extractLegacyCitations,
} = require("../src/migration");

function rootIndex(version) {
  return {
    bundle: "finance",
    path: "index.md",
    uri: "okf://finance/index.md",
    reserved: true,
    valid: true,
    frontmatter: version ? { okf_version: version } : {},
    body: "# Finance\n\n- [Revenue](revenue.md)\n",
  };
}

function concept(path, frontmatter, body, extra) {
  const uri = frontmatter.id || `okf://finance/${path}`;
  return Object.assign({
    bundle: "finance",
    path,
    uri,
    pathUri: `okf://finance/${path}`,
    reserved: false,
    valid: true,
    frontmatter,
    body: body || "",
  }, extra || {});
}

function actorMappings(doc, by) {
  return {
    [doc.uri]: {
      by: by || "human:finance-owner",
      confirmed: true,
    },
  };
}

test("checker classifies v0.1, mixed, v0.2, undeclared, and blocked bundles", () => {
  const legacy = concept("legacy.md", {
    type: "Metric",
    timestamp: "2026-05-28T22:53:05+00:00",
  });
  assert.equal(checkV02Migration(
    { documents: [rootIndex("0.1"), legacy] },
    { actorMappings: actorMappings(legacy) },
  ).classification, "v0.1");

  const mixed = concept("mixed.md", {
    type: "Metric",
    timestamp: "2026-05-28T22:53:05Z",
    status: "stable",
  });
  assert.equal(checkV02Migration(
    { documents: [rootIndex(), mixed] },
    { actorMappings: actorMappings(mixed) },
  ).classification, "mixed");

  const native = concept("native.md", {
    type: "Metric",
    generated: { by: "process:catalog", at: "2026-06-01T00:00:00Z" },
  });
  assert.equal(checkV02Migration({ documents: [rootIndex("0.2"), native] }).classification, "v0.2");

  const plain = concept("plain.md", { type: "Metric" });
  const missingRoot = checkV02Migration({ documents: [plain] });
  assert.equal(missingRoot.classification, "blocked");
  assert.equal(missingRoot.contentClassification, "undeclared");
  assert.equal(missingRoot.blockers.some((entry) => entry.code === "missing_root_index"), true);

  const blocked = checkV02Migration({ documents: [rootIndex(), legacy] });
  assert.equal(blocked.classification, "blocked");
  assert.equal(blocked.contentClassification, "v0.1");
  assert.equal(blocked.blockers.some((entry) => entry.code === "truthful_actor_mapping_required"), true);

  const resourceOnly = concept("resource.md", {
    type: "Artifact",
    resource: "https://example.test/artifact",
  });
  assert.equal(checkV02Migration({ documents: [rootIndex(), resourceOnly] }).contentClassification, "undeclared");
});

test("checker reports shared document and project diagnostics once", () => {
  const diagnostic = {
    code: "reserved_index_invalid_frontmatter",
    severity: "error",
    bundle: "finance",
    path: "index.md",
    message: "Bundle-root index.md frontmatter may contain only okf_version.",
  };
  const root = Object.assign(rootIndex("0.1"), {
    conformanceDiagnostics: [diagnostic],
  });
  const report = checkV02Migration({
    documents: [root],
    diagnostics: [Object.assign({ invalidatesProject: true }, diagnostic)],
  });
  assert.equal(report.blockers.filter((entry) => entry.code === diagnostic.code).length, 1);
});

test("Stage-A plan adds only safe native fields and retains legacy content", () => {
  const legacyBody = [
    "# Revenue",
    "",
    "# Citations",
    "",
    "- [Revenue policy](https://example.test/revenue-policy)",
    "- `../references/fiscal-calendar.md`",
    "",
  ].join("\n");
  const legacy = concept("metrics/revenue.md", {
    id: "okf://finance/metrics/revenue",
    type: "Metric",
    timestamp: "2026-05-28T22:53:05+00:00",
  }, legacyBody);
  const source = { documents: [rootIndex(), legacy] };
  const snapshot = JSON.stringify(source);

  const plan = buildV02MigrationPlan(source, {
    actorMappings: actorMappings(legacy, "process:finance-import"),
  });

  assert.equal(plan.ready, true);
  assert.equal(plan.writesPerformed, false);
  assert.equal(plan.proposalsCreated, false);
  assert.equal(plan.proposalsAccepted, false);
  assert.equal(plan.conceptProposals.length, 1);
  assert.deepEqual(plan.conceptProposals[0].arguments.frontmatter, {
    generated: {
      by: "process:finance-import",
      at: "2026-05-28T22:53:05+00:00",
    },
    sources: [
      { resource: "https://example.test/revenue-policy", title: "Revenue policy" },
      { resource: "../references/fiscal-calendar.md" },
    ],
  });
  assert.deepEqual(plan.conceptProposals[0].retainedLegacyFields, ["timestamp", "# Citations"]);
  assert.equal(hasOwn(plan.conceptProposals[0].arguments, "body"), false);
  assert.equal(plan.versionDeclaration.phase, "after-stage-a-validation");
  assert.deepEqual(plan.versionDeclaration.frontmatter, { okf_version: "0.2" });
  assert.equal(plan.steps.at(-1).kind, "bundle_version_declaration");
  assert.equal(JSON.stringify(source), snapshot, "checker and planner must not mutate input documents");
});

test("native v0.2 fields win and a migrated bundle produces no second plan", () => {
  const body = "# Revenue\n\n# Citations\n\n- https://legacy.example/policy\n";
  const migrated = concept("revenue.md", {
    type: "Metric",
    timestamp: "2026-05-28T22:53:05Z",
    generated: { by: "human:owner", at: "2026-06-01T00:00:00Z" },
    sources: [{ resource: "https://native.example/policy" }],
  }, body);
  const report = checkV02Migration({ documents: [rootIndex("0.2"), migrated] });

  assert.equal(report.classification, "v0.2");
  assert.equal(report.pendingLegacyMarkers, 0);
  assert.deepEqual(report.candidates, { timestamps: [], citations: [] });
  assert.deepEqual(report.nativeFieldWins.map((entry) => entry.nativeField).sort(), ["generated", "sources"]);

  const plan = buildV02MigrationPlan({ documents: [rootIndex("0.2"), migrated] });
  assert.deepEqual(plan.conceptProposals, []);
  assert.equal(plan.versionDeclaration, null);
  assert.deepEqual(plan.steps, []);
});

test("truthful actor mappings require explicit confirmation and valid actor syntax", () => {
  const legacy = concept("legacy.md", {
    type: "Metric",
    timestamp: "2026-05-28T22:53:05Z",
  });
  const unconfirmed = checkV02Migration(
    { documents: [rootIndex(), legacy] },
    { actorMappings: { [legacy.uri]: { by: "human:owner" } } },
  );
  assert.equal(unconfirmed.actorMappingNeeds[0].reason, "mapping_not_confirmed_or_invalid");
  assert.equal(buildV02MigrationPlan(
    { documents: [rootIndex(), legacy] },
    { actorMappings: { [legacy.uri]: { by: "made-up-actor", confirmed: true } } },
  ).conceptProposals.length, 0);
});

test("generated-file candidates and identity alias collisions block migration", () => {
  const generated = concept("generated/revenue.md", {
    type: "Metric",
    timestamp: "2026-05-28T22:53:05Z",
  });
  const generatedReport = checkV02Migration(
    { documents: [rootIndex(), generated] },
    {
      actorMappings: actorMappings(generated),
      generatedPaths: [generated.path],
    },
  );
  assert.equal(generatedReport.classification, "blocked");
  assert.equal(generatedReport.generatedFileSkips.length, 1);
  assert.equal(generatedReport.blockers.some((entry) => entry.code === "generated_file_requires_generator_change"), true);
  assert.equal(buildV02MigrationPlan(
    { documents: [rootIndex(), generated] },
    { actorMappings: actorMappings(generated), generatedPaths: [generated.path] },
  ).conceptProposals.length, 0);

  const first = concept("first.md", { type: "Metric" }, "", {
    uriAliases: ["okf://finance/shared.md"],
  });
  const second = concept("second.md", { type: "Metric" }, "", {
    uriAliases: ["okf://finance/shared.md"],
  });
  const collisionReport = checkV02Migration(
    { documents: [rootIndex(), first, second] },
    { idCollisions: ["okf://finance/provided-collision"] },
  );
  assert.equal(collisionReport.classification, "blocked");
  assert.equal(collisionReport.collisions.some((entry) => entry.kind === "alias" && entry.origin === "discovered"), true);
  assert.equal(collisionReport.collisions.some((entry) => entry.kind === "id" && entry.origin === "provided"), true);
  assert.equal(collisionReport.readiness.versionDeclaration, false);
});

test("checker inventories standardized referenced assets without following them", () => {
  const computation = concept("computations/revenue.md", {
    type: "Attested Computation",
    resource: "https://console.example/revenue",
    sources: [
      { id: "policy", resource: "https://example.test/policy" },
      { resource: "all finance queries" },
    ],
    runtime: "bigquery",
    computation: "../references/revenue.sql",
    executor: { resource: "/references/run-bigquery.md", receipt: ["job_id"] },
    attester: { resource: "../references/sql-equality.py" },
  });
  const report = checkV02Migration({ documents: [rootIndex("0.2"), computation] });

  assert.equal(report.classification, "v0.2");
  assert.deepEqual(report.referencedAssets.map((entry) => entry.kind), [
    "concept_resource",
    "source",
    "source",
    "computation",
    "executor",
    "attester",
  ]);
  assert.equal(report.referencedAssets.find((entry) => entry.resource === "all finance queries").referenceKind, "opaque");
  assert.equal(report.readOnly, true);
  assert.equal(report.writesPerformed, false);
});

test("legacy citation extraction ignores fenced examples and reports ambiguous entries", () => {
  const extracted = extractLegacyCitations([
    "```markdown",
    "# Citations",
    "- https://ignored.example",
    "```",
    "",
    "# Citations",
    "- https://kept.example",
    "- Internal policy with no stable resource",
    "",
    "# Next",
    "- https://outside.example",
  ].join("\n"));
  assert.equal(extracted.found, true);
  assert.deepEqual(extracted.sources, [{ resource: "https://kept.example" }]);
  assert.deepEqual(extracted.unparsed, ["Internal policy with no stable resource"]);

  const quoted = extractLegacyCitations([
    "# Main",
    "",
    "> # Citations",
    ">",
    "> - https://quoted.example",
    "",
    "- https://not-in-a-citation-section.example",
  ].join("\n"));
  assert.equal(quoted.found, false);

  const ambiguous = extractLegacyCitations([
    "# Citations",
    "- Compare [A](https://a.example) and [B](https://b.example)",
  ].join("\n"));
  assert.deepEqual(ambiguous.sources, []);
  assert.equal(ambiguous.unparsed.length, 1);

  const nested = extractLegacyCitations([
    "# Citations",
    "- https://kept.example",
    "## Related reading",
    "- https://not-a-source.example",
  ].join("\n"));
  assert.deepEqual(nested.sources, [
    { resource: "https://kept.example" },
  ]);
  assert.equal(nested.unparsed.includes("Related reading"), true);

  const prose = extractLegacyCitations([
    "# Citations",
    "Primary source: https://omitted.example",
    "- https://kept.example",
  ].join("\n"));
  assert.equal(prose.unparsed.includes("Primary source: https://omitted.example"), true);
});

test("migration timestamp validation matches v0.2 minute precision and rejects impossible dates", () => {
  const minute = concept("minute.md", {
    type: "Metric",
    timestamp: "2026-08-11T10:00Z",
  });
  const minuteReport = checkV02Migration(
    { documents: [rootIndex(), minute] },
    { actorMappings: actorMappings(minute) },
  );
  assert.equal(minuteReport.blockers.some((entry) => entry.code === "invalid_legacy_timestamp"), false);
  assert.equal(minuteReport.candidates.timestamps[0].ready, true);

  const impossible = concept("impossible.md", {
    type: "Metric",
    timestamp: "2026-02-30T10:00:00Z",
  });
  const impossibleReport = checkV02Migration(
    { documents: [rootIndex(), impossible] },
    { actorMappings: actorMappings(impossible) },
  );
  assert.equal(impossibleReport.blockers.some((entry) => entry.code === "invalid_legacy_timestamp"), true);
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
