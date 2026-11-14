"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createStateAsync, registerMcpInterface } = require("../src/mcp/server");
const { callJson, connectFactory } = require("./mcp-client");

const ACTOR = "human:call-queue-test";

function concept(title, body) {
  return ["---", "type: Reference", `title: ${title}`, "---", "", body || `# ${title}`, ""].join(
    "\n",
  );
}

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-call-queue-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "index.md"),
    [
      "---",
      'okf_version: "0.2"',
      "---",
      "",
      "# Call queue fixture",
      "",
      "- [Shared](shared.md)",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "shared.md"), concept("Shared"), "utf8");
  return root;
}

// Two sessions (two McpServer instances, as two stdio connections or two HTTP
// requests would build them) over one server state.
async function twoSessions(t, state) {
  const first = await connectFactory(t, () => registerMcpInterface(state));
  const second = await connectFactory(t, () => registerMcpInterface(state));
  return [first.client, second.client];
}

test("tool calls from two sessions on one state run one at a time", async (t) => {
  const root = makeRoot(t);
  const events = [];
  let active = 0;
  let maxActive = 0;
  // A stand-in service whose batches take a while, so overlapping calls
  // would show up as two batches active at once.
  const service = {
    async applyChanges(input) {
      const title = input.changes[0].title;
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`start ${title}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push(`end ${title}`);
      active -= 1;
      return { applied: false, filesChanged: false, status: "rejected", changes: [] };
    },
  };
  const state = await createStateAsync([], {
    rootPath: root,
    allowWrite: true,
    actor: ACTOR,
    liveAuthoringService: service,
  });
  const [first, second] = await twoSessions(t, state);
  const batch = (title) => ({
    changes: [{ op: "create", path: `${title}.md`, type: "Reference", title }],
  });
  await Promise.all([
    callJson(first, "okf_apply_changes", batch("one")),
    callJson(second, "okf_apply_changes", batch("two")),
  ]);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ["start one", "end one", "start two", "end two"]);
});

test("two concurrent writes to one concept from two sessions apply in order", async (t) => {
  const root = makeRoot(t);
  const state = await createStateAsync([], { rootPath: root, allowWrite: true, actor: ACTOR });
  const [first, second] = await twoSessions(t, state);
  const uri = `okf://${path.basename(root)}/shared`;
  const update = (description) => ({
    detail: "full",
    changes: [{ op: "update", uri, description }],
  });
  const [one, two] = await Promise.all([
    callJson(first, "okf_apply_changes", update("first")),
    callJson(second, "okf_apply_changes", update("second")),
  ]);
  for (const receipt of [one, two]) {
    assert.equal(receipt.result.isError, undefined);
    assert.equal(receipt.payload.applied, true);
    assert.equal(receipt.payload.status, "applied");
    assert.notEqual(receipt.payload.status, "rollback_conflict");
  }
  // The second batch was planned on the bytes the first one published.
  assert.equal(two.payload.changes[0].baseRevision, one.payload.changes[0].candidateRevision);
  assert.notEqual(one.payload.changes[0].baseRevision, one.payload.changes[0].candidateRevision);
  assert.match(fs.readFileSync(path.join(root, "shared.md"), "utf8"), /^description: second$/m);
  const read = await callJson(first, "get_concept", { uri });
  assert.equal(read.payload.frontmatter.description, "second");
});
