"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildIndex } = require("../src/indexer");
const {
  compileGlobPattern,
  evaluateWritePolicy,
  globMatch,
  loadWritePolicyFile,
  parseWritePolicy,
} = require("../src/policy/write-policy");

function compile(pattern) {
  const errors = [];
  const compiled = compileGlobPattern(pattern, "test", errors);
  assert.deepEqual(errors, [], `pattern ${JSON.stringify(pattern)} should compile`);
  return compiled;
}

function policyOf(raw) {
  const parsed = parseWritePolicy(raw);
  assert.deepEqual(parsed.errors, []);
  return parsed.policy;
}

function errorsOf(raw) {
  const parsed = parseWritePolicy(raw);
  assert.equal(parsed.policy, null);
  return parsed.errors;
}

function change(overrides) {
  const frontmatter = Object.assign(
    {
      type: "SEO Finding",
      title: "One",
      sources: ["/references/source.md"],
      stale_after: "2027-01-01",
    },
    overrides?.frontmatter,
  );
  return Object.assign(
    {
      op: "create",
      bundleId: "customers-a",
      path: "findings/one.md",
      type: frontmatter.type,
      uri: "okf://customers-a/findings/one",
    },
    overrides,
    { frontmatter },
  );
}

function evaluate(policy, actor, changes, index) {
  return evaluateWritePolicy(policy, { actor, changes, index });
}

function reasons(evaluation) {
  return evaluation.violations.map((entry) => [entry.rule, entry.reason, entry.field || null]);
}

const MATRIX_POLICY = {
  defaultEffect: "deny",
  rules: [
    { name: "humans", actors: ["human:*"] },
    {
      name: "nightly",
      actors: ["process:nightly-*"],
      bundles: ["customers-*"],
      paths: ["findings/**", "decisions/*"],
      types: ["SEO Finding", "Decision"],
      requiredFields: ["sources", "stale_after"],
      defaultStatus: "draft",
      maxConceptsPerBatch: 2,
    },
    { actors: ["openai/*"], paths: ["drafts/**"], effect: "deny" },
    { actors: ["openai/*"], bundles: ["customers-*"] },
  ],
};

test("the glob subset matches literal, * and ** segments and interprets nothing else", () => {
  const cases = [
    ["findings/**", "findings/a.md", true],
    ["findings/**", "findings/a/b.md", true],
    ["findings/**", "findings", true],
    ["findings/**", "decisions/a.md", false],
    ["decisions/*", "decisions/a.md", true],
    ["decisions/*", "decisions/sub/a.md", false],
    ["*", "a.md", true],
    ["*", "sub/a.md", false],
    ["**", "anything/at/all.md", true],
    ["**/*.md", "deep/er/file.md", true],
    ["**/*.md", "file.md", true],
    ["*/findings/*", "customers/findings/a.md", true],
    ["process:nightly-*", "process:nightly-refresh", true],
    ["process:nightly-*", "process:weekly", false],
    ["openai/*", "openai/gpt-5.6", true],
    ["openai/*", "anthropic/claude", false],
    ["*/*", "openai/gpt-5.6", true],
    ["*/*", "human:alice", false],
    ["human:*", "human:alice", true],
    ["Findings/*", "findings/a.md", false],
    // Regex metacharacters are literal characters.
    ["findings/(a|b).md", "findings/a.md", false],
    ["findings/(a|b).md", "findings/(a|b).md", true],
    ["findings/a.md", "findings/aXmd", false],
    ["findings/a+.md", "findings/aa.md", false],
    ["[a-z]*", "b", false],
    ["[a-z]*", "[a-z]x", true],
    ["a*b*c", "aXXbYYc", true],
    ["a*b*c", "aXXbYY", false],
    // Backslashes normalise on both sides.
    ["findings\\**", "findings/a/b.md", true],
    ["findings/*", "findings\\a.md", true],
  ];
  cases.forEach(([pattern, value, expected]) => {
    assert.equal(globMatch(compile(pattern), value), expected, `${pattern} vs ${value}`);
  });
  assert.equal(globMatch(compile("*"), undefined), false);
});

test("the glob subset rejects traversal, absolute paths, empty segments and embedded **", () => {
  const rejected = [
    "../x",
    "a/../b",
    "./a",
    "a/./b",
    "/abs/**",
    "C:/x",
    "a//b",
    "a/",
    "a**",
    "**a/b",
    "",
    42,
    null,
    "a\u0000b",
    "a\nb",
    "x".repeat(257),
  ];
  rejected.forEach((pattern) => {
    const errors = [];
    assert.equal(compileGlobPattern(pattern, "writePolicy.rules[0].paths[0]", errors), null);
    assert.equal(errors.length, 1, `pattern ${JSON.stringify(pattern)} should be rejected`);
    assert.equal(errors[0].code, "invalid_write_policy_pattern");
    assert.equal(errors[0].field, "writePolicy.rules[0].paths[0]");
  });
});

test("parseWritePolicy normalises defaults, keeps rule order and reports field paths", () => {
  assert.deepEqual(parseWritePolicy(undefined), { policy: null, errors: [] });
  assert.deepEqual(parseWritePolicy(null), { policy: null, errors: [] });
  const empty = policyOf({});
  assert.equal(empty.defaultEffect, "allow");
  assert.deepEqual(empty.rules, []);

  const policy = policyOf(MATRIX_POLICY);
  assert.equal(policy.defaultEffect, "deny");
  assert.deepEqual(
    policy.rules.map((rule) => rule.id),
    ["humans", "nightly", 2, 3],
  );
  assert.deepEqual(
    policy.rules.map((rule) => rule.effect),
    ["allow", "allow", "deny", "allow"],
  );
  assert.equal(policy.rules[0].bundles, null);
  assert.equal(policy.rules[0].paths, null);
  assert.equal(policy.rules[0].types, null);
  assert.deepEqual(policy.rules[0].requiredFields, []);
  assert.equal(policy.rules[0].maxConceptsPerBatch, null);
  assert.deepEqual(policy.rules[1].requiredFields, ["sources", "stale_after"]);
  assert.equal(policy.rules[1].defaultStatus, "draft");
  assert.equal(policy.rules[1].maxConceptsPerBatch, 2);
  assert.deepEqual(Array.from(policy.rules[1].types), ["SEO Finding", "Decision"]);
  // Parsing a parsed policy is the identity.
  assert.equal(parseWritePolicy(policy).policy, policy);

  const fieldsOf = (raw) => errorsOf(raw).map((entry) => `${entry.code} ${entry.field}`);
  assert.deepEqual(fieldsOf("deny"), ["invalid_write_policy writePolicy"]);
  assert.deepEqual(fieldsOf([]), ["invalid_write_policy writePolicy"]);
  assert.deepEqual(fieldsOf({ defaultEffect: "block" }), [
    "invalid_write_policy writePolicy.defaultEffect",
  ]);
  assert.deepEqual(fieldsOf({ rules: {} }), ["invalid_write_policy writePolicy.rules"]);
  assert.deepEqual(fieldsOf({ extra: true }), ["unknown_write_policy_field writePolicy.extra"]);
  assert.deepEqual(fieldsOf({ rules: ["human:*"] }), [
    "invalid_write_policy_rule writePolicy.rules[0]",
  ]);
  assert.deepEqual(fieldsOf({ rules: [{}] }), [
    "invalid_write_policy_rule writePolicy.rules[0].actors",
  ]);
  assert.deepEqual(fieldsOf({ rules: [{ actors: [] }] }), [
    "invalid_write_policy_rule writePolicy.rules[0].actors",
  ]);
  assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], effect: "maybe" }] }), [
    "invalid_write_policy_rule writePolicy.rules[0].effect",
  ]);
  assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], paths: ["../x"] }] }), [
    "invalid_write_policy_pattern writePolicy.rules[0].paths[0]",
  ]);
  assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], bundles: [] }] }), [
    "invalid_write_policy_rule writePolicy.rules[0].bundles",
  ]);
  assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], types: [" "] }] }), [
    "invalid_write_policy_rule writePolicy.rules[0].types[0]",
  ]);
  assert.deepEqual(
    fieldsOf({ rules: [{ actors: ["human:*"], requiredFields: ["stale after"] }] }),
    ["invalid_write_policy_rule writePolicy.rules[0].requiredFields[0]"],
  );
  assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], defaultStatus: "review" }] }), [
    "invalid_write_policy_rule writePolicy.rules[0].defaultStatus",
  ]);
  [0, 1.5, "10", -1].forEach((value) => {
    assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], maxConceptsPerBatch: value }] }), [
      "invalid_write_policy_rule writePolicy.rules[0].maxConceptsPerBatch",
    ]);
  });
  assert.deepEqual(
    fieldsOf({
      rules: [
        {
          actors: ["human:*"],
          effect: "deny",
          requiredFields: ["sources"],
          defaultStatus: "draft",
        },
      ],
    }),
    [
      "invalid_write_policy_rule writePolicy.rules[0].requiredFields",
      "invalid_write_policy_rule writePolicy.rules[0].defaultStatus",
    ],
  );
  assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], name: "a b" }] }), [
    "invalid_write_policy_rule writePolicy.rules[0].name",
  ]);
  assert.deepEqual(
    fieldsOf({
      rules: [
        { actors: ["human:*"], name: "same" },
        { actors: ["human:*"], name: "same" },
      ],
    }),
    ["invalid_write_policy_rule writePolicy.rules[1].name"],
  );
  assert.deepEqual(fieldsOf({ rules: [{ actors: ["human:*"], regex: ".*" }] }), [
    "unknown_write_policy_field writePolicy.rules[0].regex",
  ]);
});

test("evaluateWritePolicy decides by the first matching rule across actors, bundles, paths, types, fields and batch size", () => {
  const policy = policyOf(MATRIX_POLICY);
  const nightly = "process:nightly-refresh";

  // Actors: a human matches the first rule whatever the change.
  const human = evaluate(policy, "human:alice", [change({ bundleId: "internal", path: "x.md" })]);
  assert.deepEqual(human.violations, []);
  assert.deepEqual(human.decisions, [{ rule: "humans", effect: "allow", defaultStatus: null }]);

  // An actor no rule names falls to the default effect.
  const stranger = evaluate(policy, "anthropic/claude", [change()]);
  assert.deepEqual(stranger.violations, [
    {
      code: "policy_violation",
      rule: null,
      reason: "actor_denied",
      path: "findings/one.md",
      bundleId: "customers-a",
      uri: "okf://customers-a/findings/one",
    },
  ]);
  assert.deepEqual(stranger.decisions, [{ rule: null, effect: "deny", defaultStatus: null }]);

  // The full nightly rule, satisfied: no violations, defaultStatus for creates without one.
  const allowed = evaluate(policy, nightly, [
    change(),
    change({
      path: "decisions/two.md",
      type: "Decision",
      frontmatter: { type: "Decision", status: "stable" },
    }),
  ]);
  assert.deepEqual(allowed.violations, []);
  assert.deepEqual(allowed.decisions, [
    { rule: "nightly", effect: "allow", defaultStatus: "draft" },
    { rule: "nightly", effect: "allow", defaultStatus: null },
  ]);
  // An update never receives the default status.
  const updated = evaluate(policy, nightly, [change({ op: "update" })]);
  assert.deepEqual(updated.decisions, [{ rule: "nightly", effect: "allow", defaultStatus: null }]);

  // Selectors, one at a time; the nearest allow rule and its failing selector are named.
  assert.deepEqual(reasons(evaluate(policy, nightly, [change({ bundleId: "internal" })])), [
    ["nightly", "bundle_denied", null],
  ]);
  assert.deepEqual(reasons(evaluate(policy, nightly, [change({ path: "notes/one.md" })])), [
    ["nightly", "path_denied", null],
  ]);
  assert.deepEqual(
    reasons(evaluate(policy, nightly, [change({ path: "decisions/deep/one.md" })])),
    [["nightly", "path_denied", null]],
  );
  assert.deepEqual(
    reasons(
      evaluate(policy, nightly, [
        change({ type: "Reference", frontmatter: { type: "Reference" } }),
      ]),
    ),
    [["nightly", "type_denied", null]],
  );

  // Required fields: missing, empty string, empty array and null all count as absent.
  assert.deepEqual(
    reasons(evaluate(policy, nightly, [change({ frontmatter: { stale_after: undefined } })])),
    [["nightly", "missing_required_field", "stale_after"]],
  );
  assert.deepEqual(reasons(evaluate(policy, nightly, [change({ frontmatter: { sources: [] } })])), [
    ["nightly", "missing_required_field", "sources"],
  ]);
  assert.deepEqual(
    reasons(
      evaluate(policy, nightly, [change({ frontmatter: { sources: null, stale_after: "  " } })]),
    ),
    [
      ["nightly", "missing_required_field", "sources"],
      ["nightly", "missing_required_field", "stale_after"],
    ],
  );
  const missing = evaluate(policy, nightly, [change({ frontmatter: { sources: [] } })]);
  assert.equal(missing.violations[0].path, "findings/one.md");
  assert.equal(missing.violations[0].bundleId, "customers-a");
  assert.equal(missing.violations[0].uri, "okf://customers-a/findings/one");
  // A required status is satisfied by the default status.
  const statusPolicy = policyOf({
    rules: [{ actors: ["**"], requiredFields: ["status"], defaultStatus: "draft" }],
  });
  assert.deepEqual(evaluate(statusPolicy, nightly, [change()]).violations, []);
  assert.deepEqual(reasons(evaluate(statusPolicy, nightly, [change({ op: "update" })])), [
    [0, "missing_required_field", "status"],
  ]);

  // Batch size counts the changes the rule decides.
  const three = evaluate(policy, nightly, [
    change({ path: "findings/a.md" }),
    change({ path: "findings/b.md" }),
    change({ path: "findings/c.md" }),
  ]);
  assert.deepEqual(three.violations, [
    { code: "policy_violation", rule: "nightly", reason: "batch_too_large", limit: 2, count: 3 },
  ]);
  const two = evaluate(policy, nightly, [
    change({ path: "findings/a.md" }),
    change({ path: "findings/b.md" }),
  ]);
  assert.deepEqual(two.violations, []);
  // Denied changes are not counted against the cap of the rule they failed.
  const mixed = evaluate(policy, nightly, [
    change({ path: "findings/a.md" }),
    change({ path: "findings/b.md" }),
    change({ path: "notes/c.md" }),
  ]);
  assert.deepEqual(reasons(mixed), [["nightly", "path_denied", null]]);

  // A deny rule decides before a later allow rule and is named by its most specific selector.
  assert.deepEqual(
    reasons(evaluate(policy, "openai/gpt-5.6", [change({ path: "drafts/one.md" })])),
    [[2, "path_denied", null]],
  );
  assert.deepEqual(evaluate(policy, "openai/gpt-5.6", [change()]).decisions, [
    { rule: 3, effect: "allow", defaultStatus: null },
  ]);
  // No full match: the first actor-matching allow rule explains the default deny.
  assert.deepEqual(
    reasons(evaluate(policy, "openai/gpt-5.6", [change({ bundleId: "internal" })])),
    [[3, "bundle_denied", null]],
  );
  const actorDeny = policyOf({ rules: [{ actors: ["openai/*"], effect: "deny" }] });
  assert.deepEqual(reasons(evaluate(actorDeny, "openai/gpt-5.6", [change()])), [
    [0, "actor_denied", null],
  ]);
  const typeDeny = policyOf({
    rules: [{ actors: ["**"], bundles: ["*"], types: ["Decision"], effect: "deny" }],
  });
  assert.deepEqual(
    reasons(
      evaluate(typeDeny, "human:x", [
        change({ type: "Decision", frontmatter: { type: "Decision" } }),
      ]),
    ),
    [[0, "type_denied", null]],
  );
  const bundleDeny = policyOf({
    rules: [{ actors: ["**"], bundles: ["customers-*"], effect: "deny" }],
  });
  assert.deepEqual(reasons(evaluate(bundleDeny, "human:x", [change()])), [
    [0, "bundle_denied", null],
  ]);
});

test("evaluateWritePolicy honours defaultEffect both ways and tolerates no policy", () => {
  const openByDefault = policyOf({ rules: [{ actors: ["openai/*"], effect: "deny" }] });
  assert.deepEqual(evaluate(openByDefault, "anthropic/claude", [change()]), {
    violations: [],
    decisions: [{ rule: null, effect: "allow", defaultStatus: null }],
  });
  assert.equal(evaluate(openByDefault, "openai/gpt-5.6", [change()]).violations.length, 1);

  const closedByDefault = policyOf({ defaultEffect: "deny" });
  assert.deepEqual(reasons(evaluate(closedByDefault, "human:alice", [change()])), [
    [null, "actor_denied", null],
  ]);

  assert.deepEqual(evaluate(null, "human:alice", [change(), change()]), {
    violations: [],
    decisions: [null, null],
  });
  assert.throws(() => evaluate(openByDefault, "", [change()]), /requires an actor/);
  assert.throws(() => evaluate(openByDefault, "human:x", "nope"), /requires a changes array/);
  assert.throws(
    () => evaluate(openByDefault, "human:x", ["nope"]),
    /changes\[0\] must be an object/,
  );
  assert.throws(() => evaluate({ rules: [] }, "human:x", [change()]), /from parseWritePolicy/);
});

test("updates resolve through the index and existing content is never retro-validated", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-write-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relativePath, text) => {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, "utf8");
  };
  write("index.md", ["---", 'okf_version: "0.2"', "---", "", "# Policy fixture", ""].join("\n"));
  write(
    "findings/old.md",
    [
      "---",
      "type: SEO Finding",
      "title: Old",
      "sources:",
      "  - /index.md",
      "---",
      "",
      "# Old",
      "",
    ].join("\n"),
  );
  const index = buildIndex([{ id: "customers-a", root, include: [], exclude: [] }], {
    allowCustomRelationTypes: true,
  });
  const policy = policyOf({
    defaultEffect: "deny",
    rules: [
      {
        name: "nightly",
        actors: ["process:nightly-*"],
        paths: ["findings/**"],
        types: ["SEO Finding"],
        requiredFields: ["sources", "stale_after"],
      },
    ],
  });
  // A batch touching only a compliant new concept passes although findings/old.md
  // lacks stale_after: only the batch is evaluated.
  const unrelated = evaluate(
    policy,
    "process:nightly-refresh",
    [change({ path: "findings/new.md" })],
    index,
  );
  assert.deepEqual(unrelated.violations, []);
  // Updating the old concept is evaluated on its resolved frontmatter.
  const update = evaluate(
    policy,
    "process:nightly-refresh",
    [{ op: "update", uri: "okf://customers-a/findings/old" }],
    index,
  );
  assert.deepEqual(update.violations, [
    {
      code: "policy_violation",
      rule: "nightly",
      reason: "missing_required_field",
      field: "stale_after",
      path: "findings/old.md",
      bundleId: "customers-a",
      uri: "okf://customers-a/findings/old",
    },
  ]);
  // Explicit fields on the change win over the resolved concept.
  const explicit = evaluate(
    policy,
    "process:nightly-refresh",
    [
      {
        op: "update",
        uri: "okf://customers-a/findings/old",
        path: "findings/old.md",
        type: "SEO Finding",
        frontmatter: { sources: ["/index.md"], stale_after: "2027-01-01" },
      },
    ],
    index,
  );
  assert.deepEqual(explicit.violations, []);
  // An unresolvable uri has no path or type, so a path or type selector cannot match it.
  const unknown = evaluate(
    policy,
    "process:nightly-refresh",
    [{ op: "update", uri: "okf://customers-a/missing" }],
    index,
  );
  assert.deepEqual(reasons(unknown), [["nightly", "path_denied", null]]);
});

test("loadWritePolicyFile applies path safety and parses bare or wrapped YAML and JSON", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-write-policy-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    fs.writeFileSync(path.join(root, name), text, "utf8");
    return path.join(root, name);
  };
  const bare = write(
    "bare.yaml",
    [
      "defaultEffect: deny",
      "rules:",
      "  - actors: ['human:*']",
      "    paths: ['findings/**']",
      "",
    ].join("\n"),
  );
  const loaded = loadWritePolicyFile(bare);
  assert.equal(loaded.defaultEffect, "deny");
  assert.equal(loaded.rules.length, 1);
  assert.equal(globMatch(loaded.rules[0].paths[0], "findings/x.md"), true);
  const wrapped = write(
    "wrapped.yaml",
    ["writePolicy:", "  defaultEffect: allow", "  rules: []", ""].join("\n"),
  );
  assert.equal(loadWritePolicyFile(wrapped).defaultEffect, "allow");
  const json = write(
    "policy.json",
    JSON.stringify({ rules: [{ actors: ["**"], effect: "deny" }] }),
  );
  assert.equal(loadWritePolicyFile(json).rules[0].effect, "deny");

  const invalid = write(
    "invalid.yaml",
    ["rules:", "  - actors: ['human:*']", "    paths: ['../x']", ""].join("\n"),
  );
  assert.throws(
    () => loadWritePolicyFile(invalid),
    (error) =>
      error.code === "invalid_write_policy" &&
      /writePolicy\.rules\[0\]\.paths\[0\]/.test(error.message) &&
      Array.isArray(error.details),
  );
  const empty = write("empty.yaml", "");
  assert.throws(() => loadWritePolicyFile(empty), /empty/);
  const scalar = write("scalar.yaml", "just text\n");
  assert.throws(
    () => loadWritePolicyFile(scalar),
    (error) => error.code === "invalid_policy_file",
  );
  assert.throws(
    () => loadWritePolicyFile(path.join(root, "missing.yaml")),
    (error) => error.code === "policy_file_missing",
  );
  assert.throws(
    () => loadWritePolicyFile(root),
    (error) => error.code === "policy_file_not_regular",
  );
  assert.throws(
    () => loadWritePolicyFile(""),
    (error) => error.code === "invalid_policy_path",
  );
  const large = write("large.yaml", `# ${"x".repeat(256 * 1024)}\n`);
  assert.throws(
    () => loadWritePolicyFile(large),
    (error) => error.code === "policy_file_too_large",
  );
  if (process.platform !== "win32") {
    const link = path.join(root, "link.yaml");
    fs.symlinkSync(bare, link);
    assert.throws(
      () => loadWritePolicyFile(link),
      (error) => error.code === "policy_file_symlink",
    );
  }
});
