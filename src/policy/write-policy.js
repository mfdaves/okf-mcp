"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { resolveConcept } = require("../indexer");
const { normalizeSlashes, parseFrontmatterYaml } = require("../parser");

// Per-actor write policy (plan W-1). The policy is trusted configuration: it
// comes from okf.project.yaml or from --policy <file> in --root mode, never
// from a tool argument. It is evaluated against the changes of one batch
// only; existing content is never retro-validated.

const EFFECTS = new Set(["allow", "deny"]);
const STATUSES = new Set(["draft", "stable", "deprecated"]);
const POLICY_KEYS = new Set(["defaultEffect", "rules"]);
const RULE_KEYS = new Set([
  "name",
  "actors",
  "bundles",
  "paths",
  "types",
  "requiredFields",
  "defaultStatus",
  "maxConceptsPerBatch",
  "effect",
]);
const ALLOW_ONLY_KEYS = ["requiredFields", "defaultStatus", "maxConceptsPerBatch"];
const MAX_RULES = 200;
const MAX_PATTERN_LENGTH = 256;
const MAX_POLICY_FILE_BYTES = 256 * 1024;
const PARSED = Symbol.for("okf-mcp.write-policy.parsed");

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Boolean(value && Object.hasOwn(value, key));
}

function configError(code, field, message) {
  return { code, field, message };
}

function hasControlCharacter(text) {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

// The glob subset: segments separated by "/"; a segment is "**" (any number
// of segments, including none), a literal, or a literal with "*" standing
// for any run of characters inside the segment. Nothing else is interpreted;
// a pattern never becomes a RegExp, so regex metacharacters are literal.
function compileGlobPattern(value, field, errors) {
  const fail = (message) => {
    errors.push(configError("invalid_write_policy_pattern", field, message));
    return null;
  };
  if (typeof value !== "string" || !value.length) {
    return fail("Pattern must be a non-empty string.");
  }
  if (value.length > MAX_PATTERN_LENGTH) {
    return fail(`Pattern must not exceed ${MAX_PATTERN_LENGTH} characters.`);
  }
  if (hasControlCharacter(value)) {
    return fail("Pattern cannot contain control characters.");
  }
  const normalized = normalizeSlashes(value);
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return fail("Pattern must be relative; absolute paths are not allowed.");
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "") {
      return fail("Pattern cannot contain empty segments.");
    }
    if (segment === "." || segment === "..") {
      return fail("Pattern cannot contain . or .. segments.");
    }
    if (segment.includes("**") && segment !== "**") {
      return fail("** must stand alone as a whole segment.");
    }
  }
  return { source: value, segments };
}

// "*" inside one segment, matched by hand (no RegExp): the classic
// single-star wildcard walk with one backtrack point.
function matchSegment(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p;
      mark = t;
      p += 1;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p += 1;
      t += 1;
    } else if (star !== -1) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") {
    p += 1;
  }
  return p === pattern.length;
}

function matchSegments(patterns, segments) {
  const memo = new Map();
  const go = (i, j) => {
    if (i === patterns.length) {
      return j === segments.length;
    }
    const key = i * (segments.length + 1) + j;
    if (memo.has(key)) {
      return memo.get(key);
    }
    let result;
    if (patterns[i] === "**") {
      result = go(i + 1, j) || (j < segments.length && go(i, j + 1));
    } else {
      result = j < segments.length && matchSegment(patterns[i], segments[j]) && go(i + 1, j + 1);
    }
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

function globMatch(pattern, value) {
  if (!pattern || typeof value !== "string") {
    return false;
  }
  return matchSegments(pattern.segments, normalizeSlashes(value).split("/"));
}

function matchesAny(patterns, value) {
  return patterns.some((pattern) => globMatch(pattern, value));
}

function parsePatternList(value, field, errors) {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || !value.length) {
    errors.push(configError("invalid_write_policy_rule", field, "Must be a non-empty array."));
    return null;
  }
  const patterns = value.map((entry, index) =>
    compileGlobPattern(entry, `${field}[${index}]`, errors),
  );
  return patterns.every(Boolean) ? patterns : null;
}

function parseStringList(value, field, errors, validate) {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || !value.length) {
    errors.push(configError("invalid_write_policy_rule", field, "Must be a non-empty array."));
    return null;
  }
  let valid = true;
  value.forEach((entry, index) => {
    const message = validate(entry);
    if (message) {
      valid = false;
      errors.push(configError("invalid_write_policy_rule", `${field}[${index}]`, message));
    }
  });
  return valid ? value.slice() : null;
}

function nonBlankString(value) {
  if (typeof value !== "string" || !value.trim() || hasControlCharacter(value)) {
    return "Must be a non-empty string.";
  }
  return null;
}

function fieldName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(value)) {
    return "Must be a frontmatter key: letters, numbers, underscores, dots, colons, or hyphens.";
  }
  return null;
}

function parseRule(raw, index, errors, names) {
  const field = `writePolicy.rules[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push(configError("invalid_write_policy_rule", field, "Rule must be an object."));
    return null;
  }
  const before = errors.length;
  Object.keys(raw)
    .filter((key) => !RULE_KEYS.has(key))
    .forEach((key) => {
      errors.push(
        configError(
          "unknown_write_policy_field",
          `${field}.${key}`,
          `Unknown write policy rule field: ${key}`,
        ),
      );
    });
  let name = null;
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(raw.name)) {
      errors.push(
        configError(
          "invalid_write_policy_rule",
          `${field}.name`,
          "Rule name may contain only letters, numbers, underscores, dots, and hyphens.",
        ),
      );
    } else if (names.has(raw.name)) {
      errors.push(
        configError("invalid_write_policy_rule", `${field}.name`, "Rule names must be unique."),
      );
    } else {
      names.add(raw.name);
      name = raw.name;
    }
  }
  const effect = raw.effect === undefined ? "allow" : raw.effect;
  if (!EFFECTS.has(effect)) {
    errors.push(
      configError("invalid_write_policy_rule", `${field}.effect`, "effect must be allow or deny."),
    );
  }
  if (raw.actors === undefined) {
    errors.push(
      configError("invalid_write_policy_rule", `${field}.actors`, "Rule requires actors."),
    );
  }
  const actors = parsePatternList(raw.actors, `${field}.actors`, errors);
  const bundles = parsePatternList(raw.bundles, `${field}.bundles`, errors);
  const paths = parsePatternList(raw.paths, `${field}.paths`, errors);
  const types = parseStringList(raw.types, `${field}.types`, errors, nonBlankString);
  const requiredFields = parseStringList(
    raw.requiredFields,
    `${field}.requiredFields`,
    errors,
    fieldName,
  );
  let defaultStatus = null;
  if (raw.defaultStatus !== undefined) {
    if (!STATUSES.has(raw.defaultStatus)) {
      errors.push(
        configError(
          "invalid_write_policy_rule",
          `${field}.defaultStatus`,
          "defaultStatus must be draft, stable, or deprecated.",
        ),
      );
    } else {
      defaultStatus = raw.defaultStatus;
    }
  }
  let maxConceptsPerBatch = null;
  if (raw.maxConceptsPerBatch !== undefined) {
    if (!Number.isInteger(raw.maxConceptsPerBatch) || raw.maxConceptsPerBatch < 1) {
      errors.push(
        configError(
          "invalid_write_policy_rule",
          `${field}.maxConceptsPerBatch`,
          "maxConceptsPerBatch must be a positive integer.",
        ),
      );
    } else {
      maxConceptsPerBatch = raw.maxConceptsPerBatch;
    }
  }
  if (effect === "deny") {
    ALLOW_ONLY_KEYS.filter((key) => raw[key] !== undefined).forEach((key) => {
      errors.push(
        configError(
          "invalid_write_policy_rule",
          `${field}.${key}`,
          `${key} applies only to allow rules.`,
        ),
      );
    });
  }
  if (errors.length !== before) {
    return null;
  }
  return {
    id: name === null ? index : name,
    index,
    name,
    effect,
    actors,
    bundles,
    paths,
    types: types ? new Set(types) : null,
    requiredFields: requiredFields || [],
    defaultStatus,
    maxConceptsPerBatch,
  };
}

// Parses the `writePolicy` mapping. Returns { policy, errors }: the policy is
// null when the input is absent (no policy) or invalid; errors carry a config
// field path like writePolicy.rules[1].paths[0], in the style of project.js.
function parseWritePolicy(raw) {
  const errors = [];
  if (raw === undefined || raw === null) {
    return { policy: null, errors };
  }
  if (isWritePolicy(raw)) {
    return { policy: raw, errors };
  }
  if (!isPlainObject(raw)) {
    errors.push(
      configError("invalid_write_policy", "writePolicy", "writePolicy must be an object."),
    );
    return { policy: null, errors };
  }
  Object.keys(raw)
    .filter((key) => !POLICY_KEYS.has(key))
    .forEach((key) => {
      errors.push(
        configError(
          "unknown_write_policy_field",
          `writePolicy.${key}`,
          `Unknown write policy field: ${key}`,
        ),
      );
    });
  const defaultEffect = raw.defaultEffect === undefined ? "allow" : raw.defaultEffect;
  if (!EFFECTS.has(defaultEffect)) {
    errors.push(
      configError(
        "invalid_write_policy",
        "writePolicy.defaultEffect",
        "defaultEffect must be allow or deny.",
      ),
    );
  }
  let rules = [];
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) {
      errors.push(
        configError("invalid_write_policy", "writePolicy.rules", "rules must be an array."),
      );
    } else if (raw.rules.length > MAX_RULES) {
      errors.push(
        configError(
          "invalid_write_policy",
          "writePolicy.rules",
          `rules must not exceed ${MAX_RULES} entries.`,
        ),
      );
    } else {
      const names = new Set();
      rules = raw.rules.map((rule, index) => parseRule(rule, index, errors, names));
    }
  }
  if (errors.length) {
    return { policy: null, errors };
  }
  const policy = { defaultEffect, rules };
  Object.defineProperty(policy, PARSED, { value: true });
  return { policy, errors };
}

function isWritePolicy(value) {
  return Boolean(value && typeof value === "object" && value[PARSED] === true);
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

// One change as the evaluator sees it. Planned candidates carry everything;
// raw update changes may name only a uri, which the index resolves to the
// existing concept's bundle, path, type, and frontmatter.
function describeChange(change, position, index) {
  if (!isPlainObject(change)) {
    throw new TypeError(`changes[${position}] must be an object.`);
  }
  const described = {
    op: change.op === "update" ? "update" : "create",
    bundleId: change.bundleId || change.bundle || null,
    path: typeof change.path === "string" ? normalizeSlashes(change.path) : null,
    type: typeof change.type === "string" ? change.type : null,
    frontmatter: isPlainObject(change.frontmatter) ? change.frontmatter : null,
    uri: typeof change.uri === "string" ? change.uri : null,
  };
  if (index && described.uri && (described.path === null || described.type === null)) {
    const existing = resolveConcept(index, described.uri);
    if (existing?.valid && !existing.reserved) {
      described.bundleId = described.bundleId || existing.bundle;
      described.path = described.path || normalizeSlashes(existing.path);
      described.type = described.type || existing.type || null;
      described.frontmatter = described.frontmatter || existing.frontmatter || {};
      described.uri = existing.uri;
    }
  }
  described.frontmatter = described.frontmatter || {};
  if (described.type === null && typeof described.frontmatter.type === "string") {
    described.type = described.frontmatter.type;
  }
  return described;
}

// The first selector of a rule the change does not satisfy, in the order the
// selectors narrow a write: bundle, then path, then type. Absent selectors
// match everything; an unknown value never matches a present selector.
function failingSelector(rule, change) {
  if (rule.bundles && !(change.bundleId && matchesAny(rule.bundles, change.bundleId))) {
    return "bundle";
  }
  if (rule.paths && !(change.path && matchesAny(rule.paths, change.path))) {
    return "path";
  }
  if (rule.types && !(change.type && rule.types.has(change.type))) {
    return "type";
  }
  return null;
}

// Why a matching deny rule denies: named after its most specific selector.
function denyReason(rule) {
  if (rule.paths) return "path_denied";
  if (rule.types) return "type_denied";
  if (rule.bundles) return "bundle_denied";
  return "actor_denied";
}

function appliesDefaultStatus(rule, change) {
  return Boolean(
    rule.defaultStatus && change.op === "create" && isEmptyValue(change.frontmatter.status),
  );
}

// First rule whose actors match and whose other selectors (when present)
// match decides. Without a match the default effect applies; a default deny
// names the first actor-matching allow rule and the selector it failed, so
// the caller learns which rule nearly allowed the write.
function decide(policy, actor, change) {
  let nearest = null;
  let nearestFailure = null;
  for (const rule of policy.rules) {
    if (!matchesAny(rule.actors, actor)) continue;
    const failure = failingSelector(rule, change);
    if (failure) {
      if (!nearest && rule.effect === "allow") {
        nearest = rule;
        nearestFailure = failure;
      }
      continue;
    }
    if (rule.effect === "deny") {
      return { rule, id: rule.id, effect: "deny", reason: denyReason(rule), defaultStatus: null };
    }
    return {
      rule,
      id: rule.id,
      effect: "allow",
      reason: null,
      defaultStatus: appliesDefaultStatus(rule, change) ? rule.defaultStatus : null,
    };
  }
  if (policy.defaultEffect === "allow") {
    return { rule: null, id: null, effect: "allow", reason: null, defaultStatus: null };
  }
  return {
    rule: null,
    id: nearest ? nearest.id : null,
    effect: "deny",
    reason: nearest ? `${nearestFailure}_denied` : "actor_denied",
    defaultStatus: null,
  };
}

function violation(ruleId, reason, change, extra) {
  return {
    code: "policy_violation",
    rule: ruleId,
    reason,
    ...(extra || {}),
    ...(change?.path ? { path: change.path } : {}),
    ...(change?.bundleId ? { bundleId: change.bundleId } : {}),
    ...(change?.uri ? { uri: change.uri } : {}),
  };
}

// Evaluates one batch. `changes` are { op, bundleId, path, type, frontmatter,
// uri } descriptors (a planned candidate's fields; see describeChange for raw
// updates). Returns { violations, decisions }: decisions[i] is { rule, effect,
// defaultStatus } for changes[i], defaultStatus being the status the caller
// should stamp on a created concept that set none.
function evaluateWritePolicy(policy, input) {
  const actor = input?.actor;
  if (typeof actor !== "string" || !actor.trim()) {
    throw new TypeError("evaluateWritePolicy requires an actor string.");
  }
  if (!input || !Array.isArray(input.changes)) {
    throw new TypeError("evaluateWritePolicy requires a changes array.");
  }
  const described = input.changes.map((change, position) =>
    describeChange(change, position, input.index),
  );
  if (!policy) {
    return { violations: [], decisions: described.map(() => null) };
  }
  if (!isWritePolicy(policy)) {
    throw new TypeError("evaluateWritePolicy requires a policy from parseWritePolicy.");
  }
  const decisions = described.map((change) => decide(policy, actor, change));
  const violations = [];
  decisions.forEach((decision, position) => {
    const change = described[position];
    if (decision.effect === "deny") {
      violations.push(violation(decision.id, decision.reason, change));
      return;
    }
    if (!decision.rule) return;
    const frontmatter = decision.defaultStatus
      ? Object.assign({}, change.frontmatter, { status: decision.defaultStatus })
      : change.frontmatter;
    decision.rule.requiredFields.forEach((field) => {
      if (isEmptyValue(frontmatter[field])) {
        violations.push(violation(decision.id, "missing_required_field", change, { field }));
      }
    });
  });
  const counts = new Map();
  decisions.forEach((decision) => {
    if (decision.rule && decision.effect === "allow") {
      counts.set(decision.rule, (counts.get(decision.rule) || 0) + 1);
    }
  });
  policy.rules.forEach((rule) => {
    const count = counts.get(rule) || 0;
    if (rule && rule.maxConceptsPerBatch !== null && count > rule.maxConceptsPerBatch) {
      violations.push(
        violation(rule.id, "batch_too_large", null, {
          limit: rule.maxConceptsPerBatch,
          count,
        }),
      );
    }
  });
  return {
    violations,
    decisions: decisions.map((decision) => ({
      rule: decision.id,
      effect: decision.effect,
      defaultStatus: decision.defaultStatus,
    })),
  };
}

function policyFileError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

// `--policy <file>` for --root mode: a YAML (or JSON) mapping holding the
// writePolicy fields, optionally wrapped in a top-level `writePolicy:` key.
// Path safety (S-1): a regular file, not a symbolic link, bounded in size.
function loadWritePolicyFile(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw policyFileError("invalid_policy_path", "--policy requires a file path.");
  }
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw policyFileError("policy_file_missing", `Write policy file does not exist: ${resolved}`);
  }
  if (stat.isSymbolicLink()) {
    throw policyFileError("policy_file_symlink", "Write policy file cannot be a symbolic link.");
  }
  if (!stat.isFile()) {
    throw policyFileError("policy_file_not_regular", "Write policy file must be a regular file.");
  }
  if (stat.size > MAX_POLICY_FILE_BYTES) {
    throw policyFileError(
      "policy_file_too_large",
      `Write policy file must not exceed ${MAX_POLICY_FILE_BYTES} bytes.`,
    );
  }
  const text = fs.readFileSync(resolved, "utf8");
  let raw;
  try {
    raw = resolved.endsWith(".json") ? JSON.parse(text) : parseFrontmatterYaml(text);
  } catch (error) {
    throw policyFileError(
      "invalid_policy_file",
      `Write policy file is not a YAML mapping: ${error.message}`,
    );
  }
  if (raw === undefined || raw === null) {
    throw policyFileError("invalid_policy_file", "Write policy file is empty.");
  }
  const body =
    isPlainObject(raw) && hasOwn(raw, "writePolicy") && Object.keys(raw).length === 1
      ? raw.writePolicy
      : raw;
  const parsed = parseWritePolicy(body);
  if (parsed.errors.length || !parsed.policy) {
    const summary = parsed.errors.map((entry) => `${entry.field}: ${entry.message}`).join("; ");
    throw policyFileError(
      "invalid_write_policy",
      `Invalid write policy in ${resolved}: ${summary || "no policy mapping"}`,
      parsed.errors,
    );
  }
  return parsed.policy;
}

module.exports = {
  evaluateWritePolicy,
  isWritePolicy,
  loadWritePolicyFile,
  parseWritePolicy,
  /** @internal Exposed for the glob subset tests. */
  compileGlobPattern,
  /** @internal */
  globMatch,
};
