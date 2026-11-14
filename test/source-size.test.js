"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SOURCE_ROOT = path.join(__dirname, "..", "src");
const LINE_CAP = 800;

// Q-1: no source file above 800 lines. Files already over the cap when the
// rule was adopted are listed with their size at that time (wc -l, after the
// Biome format landed); they may shrink but never grow. Delete an entry once
// its file is under the cap.
const GRANDFATHERED = {
  "authoring.js": 1010,
  "migration.js": 865,
};

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.name.endsWith(".js") ? [absolute] : [];
  });
}

function lineCount(file) {
  return (fs.readFileSync(file, "utf8").match(/\n/g) || []).length;
}

test("no source file exceeds the line cap and grandfathered files only shrink", () => {
  const oversized = [];
  const grown = [];
  sourceFiles(SOURCE_ROOT).forEach((file) => {
    const relative = path.relative(SOURCE_ROOT, file).split(path.sep).join("/");
    const lines = lineCount(file);
    const ceiling = GRANDFATHERED[relative];
    if (ceiling !== undefined) {
      if (lines > ceiling) grown.push(`${relative}: ${lines} > ${ceiling}`);
      return;
    }
    if (lines > LINE_CAP) oversized.push(`${relative}: ${lines}`);
  });
  assert.deepEqual(oversized, [], "source files above the line cap");
  assert.deepEqual(grown, [], "grandfathered files may only shrink");
});
