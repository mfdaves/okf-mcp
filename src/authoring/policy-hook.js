"use strict";

const { normalizeSlashes, splitFrontmatter } = require("../parser");
const { evaluateWritePolicy, isWritePolicy, parseWritePolicy } = require("../policy/write-policy");
const { renderConceptMarkdown } = require("./render");
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

function policyDiagnostics(violations) {
  return violations.map((violation) =>
    Object.assign({}, violation, {
      severity: "error",
      layer: "policy",
      message: violationMessage(violation),
    }),
  );
}

// Violations join the batch's validation result as policy-layer diagnostics:
// they invalidate the batch the way a graph error does, so valid,
// readyToApply, status and the apply refusal follow one code path.
function withPolicyViolations(validation, policy) {
  if (!policy?.violations.length) {
    return validation;
  }
  const diagnostics = policyDiagnostics(policy.violations);
  return Object.assign({}, validation, {
    valid: false,
    validForProject: false,
    diagnostics: validation.diagnostics.concat(diagnostics),
    errors: validation.errors.concat(diagnostics),
  });
}

// Proposals are writes too (plan W-1): a proposal is judged when it is
// created, against the proposing actor, and again when it is accepted,
// against the actor recorded on it (else the accepting one). Without any
// actor the write is unattributed and the default effect decides. Returns
// null without a policy, else { violations, defaultStatus }.
function evaluateProposal(policy, actor, proposal) {
  if (!policy) {
    return null;
  }
  const frontmatter =
    proposal.frontmatter && typeof proposal.frontmatter === "object" ? proposal.frontmatter : {};
  const evaluation = evaluateWritePolicy(policy, {
    actor: actor || null,
    changes: [
      {
        op: proposal.op === "create" || proposal.op === "create_computation" ? "create" : "update",
        bundleId: proposal.bundle,
        path: proposal.path,
        type: typeof frontmatter.type === "string" ? frontmatter.type : null,
        frontmatter,
        uri: proposal.uri || proposal.targetUri || null,
      },
    ],
  });
  return {
    violations: evaluation.violations,
    defaultStatus: evaluation.decisions[0]?.defaultStatus || null,
  };
}

// A proposal validation refused by the policy: invalid, with the
// violations as policy-layer errors beside the structured list.
function refusedProposal(result, validation, violations) {
  const errors = policyDiagnostics(violations);
  return Object.assign(result, {
    validation: Object.assign({}, validation, {
      valid: false,
      errors: (validation.errors || []).concat(errors),
    }),
    policyViolations: violations,
  });
}

// Producers publish under process:<name> and are exempt unless the policy
// sets applyToProducers. Created and updated concept files are judged as one
// batch; unchanged and deleted paths, and the reserved index.md and log.md
// documents, are not writes of a concept. Returns null when the policy does
// not apply, else the violations.
function evaluateProducerFiles(policy, instance, files, changes) {
  if (!policy?.applyToProducers) {
    return null;
  }
  const created = new Set(changes.create);
  const written = new Set(changes.create.concat(changes.update));
  const described = files
    .filter((file) => written.has(file.path) && /\.md$/i.test(file.path))
    .filter((file) => !/(^|\/)(index|log)\.md$/i.test(normalizeSlashes(file.path)))
    .map((file) => {
      let frontmatter = {};
      try {
        frontmatter = splitFrontmatter(file.content).frontmatter || {};
      } catch {
        // Unparseable output fails producer validation on its own.
      }
      const relative = normalizeSlashes(file.path);
      return {
        op: created.has(file.path) ? "create" : "update",
        bundleId: instance.bundle,
        path: relative,
        type: typeof frontmatter.type === "string" ? frontmatter.type : null,
        frontmatter,
        uri: `okf://${instance.bundle}/${relative.replace(/\.md$/i, "")}`,
      };
    });
  return evaluateWritePolicy(policy, { actor: `process:${instance.name}`, changes: described })
    .violations;
}

module.exports = {
  enforceWritePolicy,
  evaluateProducerFiles,
  evaluateProposal,
  policyDiagnostics,
  refusedProposal,
  resolveWritePolicy,
  withPolicyViolations,
};
