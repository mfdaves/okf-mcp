"use strict";

const { renderConceptMarkdown } = require("../authoring");
const { evaluateWritePolicy, isWritePolicy, parseWritePolicy } = require("../policy/write-policy");
const { revisionFor } = require("./shared");

// Where the live authoring service meets the write policy (plan W-1, W-2).
// The policy is trusted configuration: a host option (the parsed policy a
// --policy file loads, or the raw mapping) wins, else the project's
// `writePolicy` from okf.project.yaml; with neither, every write by the
// configured actor is allowed as before and receipts are unchanged.
function resolveWritePolicy(config, store) {
  if (config && config.writePolicy !== undefined && config.writePolicy !== null) {
    if (isWritePolicy(config.writePolicy)) {
      return config.writePolicy;
    }
    const parsed = parseWritePolicy(config.writePolicy);
    if (parsed.errors.length || !parsed.policy) {
      const summary = parsed.errors.map((entry) => `${entry.field}: ${entry.message}`).join("; ");
      const error = new Error(`Invalid write policy: ${summary || "no policy mapping"}`);
      error.code = "invalid_write_policy";
      error.details = parsed.errors;
      throw error;
    }
    return parsed.policy;
  }
  const project = store?.project;
  return project && isWritePolicy(project.writePolicy) ? project.writePolicy : null;
}

function describeCandidate(candidate) {
  return {
    op: candidate.op,
    bundleId: candidate.bundle,
    path: candidate.path,
    type: candidate.frontmatter.type,
    frontmatter: candidate.frontmatter,
    uri: candidate.uri,
  };
}

// A created concept that set no status takes the rule's default before
// validation. Frontmatter, rendered bytes and candidate revision change
// together, so what is validated is what is written; the status sits ahead
// of the server-managed `generated` stamp like any other authored field.
function applyDefaultStatus(candidate, status) {
  const { generated, ...rest } = candidate.frontmatter;
  candidate.frontmatter = Object.assign(
    rest,
    { status },
    generated === undefined ? {} : { generated },
  );
  candidate.markdown = renderConceptMarkdown({
    path: candidate.path,
    frontmatter: candidate.frontmatter,
    body: candidate.body,
  });
  candidate.publishedRevision = revisionFor(candidate.markdown);
}

// Evaluates the planned batch. Returns null without a policy, otherwise
// { violations, rules } where rules[i] names the rule that decided
// candidates[i] (null when the default effect did).
function enforceWritePolicy(policy, context) {
  if (!policy) {
    return null;
  }
  const { actor, candidates, index } = context;
  const evaluation = evaluateWritePolicy(policy, {
    actor,
    index,
    changes: candidates.map(describeCandidate),
  });
  evaluation.decisions.forEach((decision, position) => {
    if (decision?.defaultStatus && candidates[position].op === "create") {
      applyDefaultStatus(candidates[position], decision.defaultStatus);
    }
  });
  return {
    violations: evaluation.violations,
    rules: evaluation.decisions.map((decision) => (decision ? decision.rule : null)),
  };
}

// Messages name rules, reasons, paths and URIs, never catalog text (B-6).
function violationMessage(violation) {
  const subject = violation.uri || violation.path || "the batch";
  const rule =
    violation.rule === null || violation.rule === undefined
      ? "default effect"
      : `rule ${violation.rule}`;
  if (violation.reason === "missing_required_field") {
    return `Write policy ${rule} requires frontmatter field ${violation.field} on ${subject}.`;
  }
  if (violation.reason === "batch_too_large") {
    return `Write policy ${rule} allows at most ${violation.limit} concepts per batch; this batch has ${violation.count}.`;
  }
  return `Write policy ${rule} denies this write (${violation.reason}): ${subject}`;
}

// Violations join the batch's validation result as policy-layer diagnostics:
// they invalidate the batch the way a graph error does, so valid,
// readyToApply, status and the apply refusal follow one code path.
function withPolicyViolations(validation, policy) {
  if (!policy?.violations.length) {
    return validation;
  }
  const diagnostics = policy.violations.map((violation) =>
    Object.assign({}, violation, {
      severity: "error",
      layer: "policy",
      message: violationMessage(violation),
    }),
  );
  return Object.assign({}, validation, {
    valid: false,
    validForProject: false,
    diagnostics: validation.diagnostics.concat(diagnostics),
    errors: validation.errors.concat(diagnostics),
  });
}

module.exports = {
  enforceWritePolicy,
  resolveWritePolicy,
  withPolicyViolations,
};
