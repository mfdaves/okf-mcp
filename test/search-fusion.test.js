"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_FUSION_ALPHA, fuseRankings, fusionAlpha } = require("../src/search/fusion");

const LEXICAL = [
  { id: "a", score: 9 },
  { id: "b", score: 5 },
  { id: "c", score: 5 },
  { id: "d", score: 1 },
];
const DENSE = [
  { id: "e", score: 0.8 },
  { id: "c", score: 0.7 },
  { id: "a", score: 0.4 },
  { id: "f", score: 0.4 },
];

test("alpha 0 returns the lexical ranking and alpha 1 the dense ranking exactly", () => {
  const lexicalOnly = fuseRankings({ lexical: LEXICAL, dense: DENSE, alpha: 0 });
  assert.deepEqual(
    lexicalOnly.map((entry) => entry.id),
    LEXICAL.map((entry) => entry.id),
  );
  assert.deepEqual(
    lexicalOnly.map((entry) => entry.lexicalScore),
    [9, 5, 5, 1],
  );
  const denseOnly = fuseRankings({ lexical: LEXICAL, dense: DENSE, alpha: 1 });
  assert.deepEqual(
    denseOnly.map((entry) => entry.id),
    DENSE.map((entry) => entry.id),
  );
  // Scores of the other side are still reported where the candidate has one.
  assert.equal(denseOnly[1].lexicalScore, 5);
  assert.equal(denseOnly[0].lexicalScore, null);
});

test("fusion is a convex combination of min-max normalised scores over the union", () => {
  const fused = fuseRankings({
    lexical: LEXICAL,
    dense: DENSE,
    alpha: 0.25,
    normalization: "minmax",
  });
  assert.deepEqual(fused.map((entry) => entry.id).sort(), ["a", "b", "c", "d", "e", "f"]);
  const byId = new Map(fused.map((entry) => [entry.id, entry]));
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12);
  // a: lexical (9-1)/8 = 1, dense (0.4-0.4)/0.4 = 0
  close(byId.get("a").fusedScore, 0.75);
  // c: lexical 0.5, dense 0.75
  close(byId.get("c").lexicalNorm, 0.5);
  close(byId.get("c").denseNorm, 0.75);
  close(byId.get("c").fusedScore, 0.25 * 0.75 + 0.75 * 0.5);
  // e: dense only
  close(byId.get("e").fusedScore, 0.25);
  assert.equal(byId.get("e").lexicalScore, null);
  for (let position = 1; position < fused.length; position += 1) {
    assert.ok(fused[position - 1].fusedScore >= fused[position].fusedScore);
  }
});

test("ties break by lexical rank, then dense rank, then id", () => {
  const fused = fuseRankings({
    lexical: [
      { id: "x", score: 2 },
      { id: "y", score: 1 },
    ],
    dense: [
      { id: "y", score: 0.9 },
      { id: "x", score: 0.1 },
      { id: "z", score: 0.1 },
      { id: "w", score: 0.1 },
    ],
    alpha: 0.5,
  });
  // x and y both fuse to 0.5; x ranks first lexically. z and w fuse to 0
  // with no lexical rank and the same dense score: dense rank decides.
  assert.deepEqual(
    fused.map((entry) => entry.id),
    ["x", "y", "z", "w"],
  );
  const again = fuseRankings({
    lexical: [],
    dense: [
      { id: "q", score: 1 },
      { id: "p", score: 1 },
    ],
    alpha: 0.5,
  });
  // A list of equal scores normalises to 1.
  assert.deepEqual(
    again.map((entry) => [entry.id, entry.denseNorm]),
    [
      ["q", 1],
      ["p", 1],
    ],
  );
});

test("fusion validates alpha and its inputs", () => {
  assert.equal(fusionAlpha(undefined), DEFAULT_FUSION_ALPHA);
  assert.equal(fusionAlpha(0), 0);
  assert.equal(fusionAlpha("0.3"), 0.3);
  for (const bad of [-0.1, 1.5, Number.NaN, "x", true]) {
    assert.throws(() => fusionAlpha(bad), TypeError);
  }
  assert.throws(() => fuseRankings({ lexical: [{ id: 1, score: 1 }] }), TypeError);
  assert.deepEqual(fuseRankings({ alpha: 0.5 }), []);
  assert.throws(() => fuseRankings({ alpha: 0.5, normalization: "zscore" }), TypeError);
});

test("theoretical-minimum normalization keeps the weakest lexical hit above a miss", () => {
  const byId = (normalization) =>
    new Map(
      fuseRankings({ lexical: LEXICAL, dense: DENSE, alpha: 0.25, normalization }).map((entry) => [
        entry.id,
        entry,
      ]),
    );
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12);
  // minmax: d (lexical 1, the minimum) normalises to 0 like a miss.
  close(byId("minmax").get("d").lexicalNorm, 0);
  // lexical-tmm: lexical lower bound 0, so d keeps 1/9; dense stays min-max.
  const lexicalTmm = byId("lexical-tmm");
  close(lexicalTmm.get("d").lexicalNorm, 1 / 9);
  close(lexicalTmm.get("b").lexicalNorm, 5 / 9);
  close(lexicalTmm.get("c").denseNorm, 0.75);
  // tmm: dense lower bound -1 as well.
  const tmm = byId("tmm");
  close(tmm.get("e").denseNorm, 1);
  close(tmm.get("a").denseNorm, 1.4 / 1.8);
  // The ends still reduce to one side exactly under every normalization.
  for (const normalization of ["minmax", "tmm", "lexical-tmm"]) {
    const zero = fuseRankings({ lexical: LEXICAL, dense: DENSE, alpha: 0, normalization });
    assert.deepEqual(
      zero.map((entry) => entry.id),
      LEXICAL.map((entry) => entry.id),
    );
    const one = fuseRankings({ lexical: LEXICAL, dense: DENSE, alpha: 1, normalization });
    assert.deepEqual(
      one.map((entry) => entry.id),
      DENSE.map((entry) => entry.id),
    );
  }
});

test("ties follow the dominant side: dense order at alpha 1, lexical order at alpha 0", () => {
  const lexical = [
    { id: "b", score: 2 },
    { id: "a", score: 2 },
  ];
  const dense = [
    { id: "a", score: 0.5 },
    { id: "b", score: 0.5 },
  ];
  for (const normalization of ["minmax", "tmm", "lexical-tmm"]) {
    const one = fuseRankings({ lexical, dense, alpha: 1, normalization });
    assert.deepEqual(
      one.map((entry) => entry.id),
      ["a", "b"],
    );
    const zero = fuseRankings({ lexical, dense, alpha: 0, normalization });
    assert.deepEqual(
      zero.map((entry) => entry.id),
      ["b", "a"],
    );
  }
});
