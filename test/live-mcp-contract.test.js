"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { callJson, connectMcp } = require("./mcp-client");

function concept(title) {
  return [
    "---",
    "type: Reference",
    `title: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-live-mcp-contract-"));
  fs.writeFileSync(path.join(root, "index.md"), [
    "---",
    "okf_version: \"0.2\"",
    "---",
    "",
    "# Contract fixture",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "existing.md"), concept("Existing"), "utf8");
  return root;
}

function writeStubConcept(root, relativePath, title) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, concept(title), "utf8");
}

test("live validation and apply advertise projection-friendly matching contracts", async (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const disabled = await connectMcp(t, [], { rootPath: root });
  const disabledNames = new Set((await disabled.client.listTools()).tools.map((tool) => tool.name));
  assert.equal(disabledNames.has("okf_validate_changes"), false);
  assert.equal(disabledNames.has("okf_apply_changes"), false);

  const calls = [];
  const service = {
    async validateChanges(args, context) {
      calls.push({ method: "validate", args, context });
      if (args.message === "structured-error") {
        const error = new Error("The requested source is too large.");
        error.code = "git_source_too_large";
        error.details = {
          actualBytes: 10042,
          limitBytes: 4096,
          maxAllowedBytes: 1048576,
          retryable: true,
        };
        throw error;
      }
      return {
        valid: false,
        status: "rejected",
        filesChanged: false,
        changes: [],
        validation: { valid: false, diagnostics: [{ code: "stub_invalid" }] },
      };
    },
    async applyChanges(args, context) {
      calls.push({ method: "apply", args, context });
      const change = args.changes[0];
      writeStubConcept(root, change.path, change.title);
      if (change.path === "partial.md") {
        return {
          applied: false,
          filesChanged: true,
          status: "applied_uncommitted",
          changes: [{
            op: change.op,
            path: change.path,
            absolutePath: path.join(root, change.path),
            title: change.title,
          }],
          validation: { valid: true },
        };
      }
      return {
        applied: true,
        filesChanged: true,
        status: "applied",
        changes: [{
          op: change.op,
          path: change.path,
          absolutePath: path.join(root, change.path),
          title: change.title,
          effects: { bodyChanged: true },
        }],
        validation: { valid: true },
      };
    },
  };
  const enabled = await connectMcp(t, [], {
    rootPath: root,
    allowWrite: true,
    actor: "test/contract",
    liveAuthoringService: service,
  });
  const listed = await enabled.client.listTools();
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  const validateTool = byName.get("okf_validate_changes");
  const applyTool = byName.get("okf_apply_changes");

  assert.ok(validateTool);
  assert.ok(applyTool);
  assert.equal(validateTool.annotations.readOnlyHint, true);
  assert.equal(validateTool.annotations.destructiveHint, false);
  assert.equal(applyTool.annotations.destructiveHint, true);
  assert.deepEqual(validateTool.inputSchema, applyTool.inputSchema);

  const changesSchema = applyTool.inputSchema.properties.changes;
  assert.match(changesSchema.description, /Create grammar:/);
  assert.match(changesSchema.description, /Update grammar:/);
  const updateSchema = changesSchema.items.oneOf.find(
    (branch) => branch.properties.op.const === "update",
  );
  assert.equal(updateSchema.anyOf, undefined);
  assert.equal(updateSchema.minProperties, 3);
  for (const field of ["tags", "sources", "relations"]) {
    assert.equal(updateSchema.properties[field].anyOf, undefined);
    assert.equal(updateSchema.properties[field].minProperties, 1);
    assert.deepEqual(
      Object.keys(updateSchema.properties[field].properties).sort(),
      ["add", "remove"],
    );
  }
  assert.equal(
    updateSchema.properties.relations.properties.add.items.properties.target.type,
    "string",
  );

  assert.equal(validateTool.outputSchema.type, "object");
  assert.equal(validateTool.outputSchema.additionalProperties, true);
  assert.ok(validateTool.outputSchema.properties.valid);
  assert.ok(validateTool.outputSchema.properties.readyToApply);
  assert.ok(validateTool.outputSchema.properties.snapshot);
  assert.ok(validateTool.outputSchema.properties.preconditions);
  assert.ok(validateTool.outputSchema.properties.target);
  assert.ok(validateTool.outputSchema.properties.changes.items.properties.effects);
  assert.equal(applyTool.outputSchema.type, "object");
  assert.ok(applyTool.outputSchema.properties.applied);
  assert.ok(applyTool.outputSchema.properties.durability);

  const bundles = await callJson(enabled.client, "list_bundles");
  assert.equal(bundles.payload[0].root, ".");
  assert.equal(bundles.payload[0].absoluteRoot, fs.realpathSync(root));
  assert.equal(bundles.payload[0].projectRoot, fs.realpathSync(root));

  const previewInput = {
    changes: [{
      op: "create",
      path: "preview.md",
      type: "Reference",
      title: "Preview",
    }],
  };
  const preview = await callJson(enabled.client, "okf_validate_changes", previewInput);
  assert.equal(preview.result.isError, undefined);
  assert.equal(preview.payload.valid, false);
  assert.deepEqual(preview.result.structuredContent, preview.payload);
  assert.equal(fs.existsSync(path.join(root, "preview.md")), false);
  assert.deepEqual(calls[0], {
    method: "validate",
    args: previewInput,
    context: { additionalBundles: [] },
  });

  for (const change of [
    { op: "update", uri: `okf://${path.basename(root)}/existing` },
    { op: "update", uri: `okf://${path.basename(root)}/existing`, tags: {} },
  ]) {
    const invalid = await enabled.client.callTool({
      name: "okf_validate_changes",
      arguments: { changes: [change] },
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /Invalid arguments/i);
  }
  assert.equal(calls.length, 1);

  const operationalError = await callJson(enabled.client, "okf_validate_changes", {
    message: "structured-error",
    changes: [{
      op: "create",
      path: "error.md",
      type: "Reference",
      title: "Error",
    }],
  });
  assert.equal(operationalError.result.isError, true);
  assert.equal(operationalError.payload.code, "git_source_too_large");
  assert.deepEqual(operationalError.payload.details, {
    actualBytes: 10042,
    limitBytes: 4096,
    maxAllowedBytes: 1048576,
    retryable: true,
  });
  assert.deepEqual(operationalError.result.structuredContent, operationalError.payload);

  const applied = await callJson(enabled.client, "okf_apply_changes", {
    changes: [{
      op: "create",
      path: "applied.md",
      type: "Reference",
      title: "Applied",
    }],
  });
  assert.equal(applied.result.isError, undefined);
  assert.deepEqual(applied.result.structuredContent, applied.payload);
  assert.deepEqual(JSON.parse(applied.result.content[0].text), applied.payload);
  const readApplied = await callJson(enabled.client, "get_concept", {
    uri: `okf://${path.basename(root)}/applied`,
  });
  assert.equal(readApplied.payload.title, "Applied");

  const partial = await callJson(enabled.client, "okf_apply_changes", {
    changes: [{
      op: "create",
      path: "partial.md",
      type: "Reference",
      title: "Partial",
    }],
  });
  assert.equal(partial.result.isError, true);
  assert.deepEqual(partial.result.structuredContent, partial.payload);
  const readPartial = await callJson(enabled.client, "get_concept", {
    uri: `okf://${path.basename(root)}/partial`,
  });
  assert.equal(readPartial.payload.title, "Partial");
  const applyCalls = calls.filter((call) => call.method === "apply");
  assert.equal(applyCalls.length, 2);
  applyCalls.forEach((call) => {
    assert.deepEqual(call.context, { additionalBundles: [] });
  });
});
