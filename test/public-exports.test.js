"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const FROZEN_EXPORTS = path.join(__dirname, "snapshots", "exports-0.9.1.json");

// B-9 and Q-3: the 0.9.1 export list of src/index.js stays a subset of every
// later list until 1.0. The frozen file is never regenerated to make this test
// pass; a removal needs an entry in the plan's deprecation section first.
test("src/index.js keeps every 0.9.1 public export", () => {
  const api = require("../src/index.js");
  const current = Object.keys(api).sort();
  const frozen = JSON.parse(fs.readFileSync(FROZEN_EXPORTS, "utf8"));
  assert.equal(frozen.length, 127);
  assert.deepEqual(frozen, frozen.slice().sort(), "frozen export list must be stored sorted");
  const missing = frozen.filter((name) => !current.includes(name));
  assert.deepEqual(missing, [], "public exports removed since 0.9.1");
  // A re-export shim that forgets a name would surface as undefined rather than
  // as a missing key, so check the values as well as the keys.
  current.forEach((name) => {
    assert.notEqual(api[name], undefined, `${name} is exported as undefined`);
  });
});
