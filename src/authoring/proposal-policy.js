"use strict";

const { evaluateProposal, policyDiagnostics, refusedProposal } = require("./policy-hook");

// The write policy applied to the proposal flow of ConceptAuthoringService
// (plan W-1): every kind of proposal is judged when it would be stored,
// against the proposing actor, and again before acceptance writes it,
// against the actor recorded on it, else the accepting one. Kept out of
// src/authoring.js, which is held under a shrink-only size ratchet (Q-1).

// Validates a proposal about to be stored and applies the policy to it:
// { refused } when invalid or denied; otherwise the request and its
// validation, re-validated once with the default status a matching rule
// stamps on a create that set none.
function checkProposal(service, op, input, validate) {
  const validation = validate(input);
  if (!validation.valid) {
    return { refused: { created: false, validation } };
  }
  const policy = evaluateProposal(service.writePolicy, service.actor, {
    op,
    bundle: validation.bundle,
    path: validation.path,
    uri: validation.uri,
    frontmatter: input.frontmatter,
  });
  if (policy?.violations.length) {
    return { refused: refusedProposal({ created: false }, validation, policy.violations) };
  }
  if (!policy?.defaultStatus) {
    return { request: input, validation };
  }
  const request = Object.assign({}, input, {
    frontmatter: Object.assign({}, input.frontmatter, { status: policy.defaultStatus }),
  });
  const stamped = validate(request);
  return stamped.valid
    ? { request, validation: stamped }
    : { refused: { created: false, validation: stamped } };
}

// An update proposal's refusal, or null when the policy allows it.
function refuseUpdate(service, validation, existing, frontmatter) {
  const policy = evaluateProposal(service.writePolicy, service.actor, {
    op: "update",
    bundle: validation.bundle,
    path: validation.path,
    uri: existing.uri,
    frontmatter,
  });
  return policy?.violations.length
    ? refusedProposal({ created: false, op: "update" }, validation, policy.violations)
    : null;
}

// Every proposal a migration would store, judged before any is stored: the
// child updates and the index.md version declaration. Returns the refusal,
// or null when the policy allows them all.
function refuseMigration(service, bundleId, plan) {
  if (!service.writePolicy) {
    return null;
  }
  const proposals = plan.conceptProposals.map((step) => {
    const existing = service.resolveConcept(step.target.uri);
    return {
      op: "update",
      bundle: existing.bundle,
      path: existing.path,
      uri: existing.uri,
      frontmatter: Object.assign({}, existing.frontmatter, step.arguments.frontmatter),
    };
  });
  if (plan.versionDeclaration) {
    proposals.push({
      op: "migration_index",
      bundle: bundleId,
      path: "index.md",
      frontmatter: { okf_version: "0.2" },
    });
  }
  const violations = proposals.flatMap(
    (proposal) => evaluateProposal(service.writePolicy, service.actor, proposal).violations,
  );
  return violations.length
    ? { created: false, plan, policyViolations: violations, errors: policyDiagnostics(violations) }
    : null;
}

// Acceptance re-validates the stored frontmatter and publishes the bytes that
// validation renders. A create the policy stamps with a default status (one
// stored without it, or before the policy existed) is accepted through this
// delegate, so the published concept carries the status it was judged with.
// The stored proposal is not rewritten outside the store's proposal lock.
function withDefaultStatus(service, status) {
  const stamp = (candidate) =>
    Object.assign({}, candidate, {
      frontmatter: Object.assign({}, candidate.frontmatter, { status }),
    });
  return Object.create(service, {
    validateConcept: {
      value: (candidate, options) => service.validateConcept(stamp(candidate), options),
    },
    validateAttestedComputation: {
      value: (candidate, options) => service.validateAttestedComputation(stamp(candidate), options),
    },
  });
}

// The policy's verdict before acceptance: { refused } with the violations,
// or { acceptor }, the service (or its status-stamping delegate) the store
// accepts through. A proposal no longer "proposed" is left to the store,
// which reports its status.
async function prepareAcceptance(service, proposalId) {
  if (!service.writePolicy) {
    return { acceptor: service };
  }
  const proposal = await service.store.getProposal(proposalId);
  const policy =
    proposal.status === "proposed"
      ? evaluateProposal(service.writePolicy, proposal.proposedBy || service.actor, proposal)
      : null;
  if (policy?.violations.length) {
    return {
      refused: {
        accepted: false,
        proposal,
        policyViolations: policy.violations,
        errors: policyDiagnostics(policy.violations),
      },
    };
  }
  return {
    acceptor: policy?.defaultStatus ? withDefaultStatus(service, policy.defaultStatus) : service,
  };
}

module.exports = { checkProposal, prepareAcceptance, refuseMigration, refuseUpdate };
