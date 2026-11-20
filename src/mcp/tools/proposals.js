"use strict";

const {
  DESTRUCTIVE_WRITE,
  GATES,
  LOCAL_WRITE,
  READ_ONLY,
  defineTool,
  expectedToolOperation,
  jsonContent,
  nonEmptyStringParameter,
  objectParameter,
  requireAuthoring,
  stringArrayParameter,
  stringParameter,
} = require("../registry");

// The views of a project (src/mcp/views.js) share its proposal directory: a
// view shows the proposals of its own bundles, and a proposal of another
// bundle answers like one that does not exist.
function inView(state, proposal) {
  return !state.viewBundleIds || state.viewBundleIds.has(proposal?.bundle);
}

const tools = {
  okf_validate_concept: {
    ...defineTool(
      "Validate a proposed new OKF concept without writing a proposal or concept file.",
      READ_ONLY,
      {
        bundle: nonEmptyStringParameter(
          "Writable root id; optional when exactly one local root is configured.",
        ),
        path: nonEmptyStringParameter("Safe bundle relative Markdown path for the concept."),
        frontmatter: objectParameter("Complete YAML frontmatter represented as a JSON object."),
        body: stringParameter("Markdown body for the concept."),
      },
      ["path", "frontmatter"],
    ),
    enabled: GATES.projectHelper,
    handler: async (state, args, principal) =>
      jsonContent(
        await expectedToolOperation(() => requireAuthoring(state, principal).validateConcept(args)),
      ),
  },
  okf_suggest_concept_path: {
    ...defineTool(
      "Suggest a safe bundle relative Markdown path from a concept type and title.",
      READ_ONLY,
      {
        bundle: nonEmptyStringParameter(
          "Writable root id; optional when exactly one local root is configured.",
        ),
        type: nonEmptyStringParameter("Concept type used to build the path."),
        title: nonEmptyStringParameter("Concept title used to build the file name."),
        prefix: stringParameter("Optional bundle relative directory prefix."),
      },
      ["type", "title"],
    ),
    enabled: GATES.projectHelper,
    handler: async (state, args, principal) =>
      jsonContent(
        await expectedToolOperation(() =>
          requireAuthoring(state, principal).suggestConceptPath(args),
        ),
      ),
  },
  okf_propose_concept: {
    ...defineTool(
      "Create a reviewable proposal for a new OKF concept without writing the concept file.",
      LOCAL_WRITE,
      {
        bundle: nonEmptyStringParameter(
          "Writable root id; optional when exactly one local root is configured.",
        ),
        path: nonEmptyStringParameter("Safe bundle relative Markdown path for the new concept."),
        frontmatter: objectParameter("Complete YAML frontmatter represented as a JSON object."),
        body: stringParameter("Markdown body for the new concept."),
        message: stringParameter(
          "Optional review note explaining why the concept should be created.",
        ),
      },
      ["path", "frontmatter"],
    ),
    enabled: GATES.authoringMutation,
    handler: async (state, args, principal) => {
      const result = await expectedToolOperation(() =>
        requireAuthoring(state, principal).proposeConcept(args),
      );
      return jsonContent(result, { isError: result.created === false });
    },
  },
  okf_propose_update: {
    ...defineTool(
      "Create a reviewable update proposal for an existing OKF concept while preserving unspecified content.",
      LOCAL_WRITE,
      {
        uri: nonEmptyStringParameter("Canonical or path based okf URI of the existing concept."),
        frontmatter: objectParameter(
          "Frontmatter fields to add or replace; unspecified fields are preserved.",
          { minProperties: 1 },
        ),
        removeFrontmatterKeys: stringArrayParameter(
          "Frontmatter keys to remove; the id field cannot be removed.",
          { minItems: 1, nonEmptyItems: true },
        ),
        body: stringParameter("Replacement Markdown body; omit it to preserve the current body."),
        message: stringParameter(
          "Optional review note explaining why the concept should be updated.",
        ),
      },
      ["uri"],
      {
        anyOf: [
          { required: ["frontmatter"] },
          { required: ["removeFrontmatterKeys"] },
          { required: ["body"] },
        ],
      },
    ),
    enabled: GATES.authoringMutation,
    handler: async (state, args, principal) => {
      const result = await expectedToolOperation(() =>
        requireAuthoring(state, principal).proposeUpdate(args),
      );
      return jsonContent(result, { isError: result.created === false });
    },
  },
  okf_propose_attested_computation: {
    ...defineTool(
      "Create one coordinated review proposal for an Attested Computation concept and optional external computation file; never execute it.",
      LOCAL_WRITE,
      {
        bundle: nonEmptyStringParameter(
          "Writable root id; optional when exactly one local root is configured.",
        ),
        path: nonEmptyStringParameter(
          "Safe bundle-relative Markdown path for the computation concept.",
        ),
        frontmatter: objectParameter("Complete strict OKF v0.2 Attested Computation frontmatter."),
        body: stringParameter(
          "Markdown body, including inline computation when no computation file is declared.",
        ),
        computationPath: nonEmptyStringParameter(
          "Bundle-relative path of the optional external computation file.",
        ),
        computationContent: stringParameter(
          "Text content for the optional external computation file.",
        ),
        message: stringParameter("Optional review note."),
      },
      ["path", "frontmatter"],
    ),
    enabled: GATES.computationAuthoring,
    handler: async (state, args, principal) => {
      const result = await expectedToolOperation(() =>
        requireAuthoring(state, principal).proposeAttestedComputation(args),
      );
      return jsonContent(result, { isError: result.created === false });
    },
  },
  okf_list_proposals: {
    ...defineTool("List compact metadata for stored authoring proposals.", READ_ONLY, {
      bundle: nonEmptyStringParameter("Limit results to proposals for this bundle id."),
      status: stringParameter("Limit results to this proposal status.", {
        enum: ["proposed", "accepted", "rejected"],
      }),
    }),
    enabled: GATES.proposalRead,
    handler: async (state, args, principal) =>
      jsonContent(
        (
          await expectedToolOperation(() => requireAuthoring(state, principal).listProposals(args))
        ).filter((proposal) => inView(state, proposal)),
      ),
  },
  okf_get_proposal: {
    ...defineTool(
      "Read one authoring proposal, including its candidate content and validation result.",
      READ_ONLY,
      {
        proposalId: nonEmptyStringParameter("Identifier returned when the proposal was created."),
      },
      ["proposalId"],
    ),
    enabled: GATES.proposalRead,
    handler: async (state, args, principal) =>
      jsonContent(
        await expectedToolOperation(async () => {
          const proposal = await requireAuthoring(state, principal).getProposal(args);
          if (!inView(state, proposal)) {
            throw new Error(`Unknown OKF proposal: ${args.proposalId || "<missing>"}`);
          }
          return proposal;
        }),
      ),
  },
  okf_accept_proposal: {
    ...defineTool(
      "Accept a reviewed proposal and write its new or updated concept file after revalidation.",
      DESTRUCTIVE_WRITE,
      {
        proposalId: nonEmptyStringParameter("Identifier of the proposed change to accept."),
      },
      ["proposalId"],
    ),
    enabled: GATES.authoringMutation,
    handler: async (state, args, principal) => {
      const result = await expectedToolOperation(() =>
        requireAuthoring(state, principal).acceptProposal(
          Object.assign({}, args, {
            allowComputation: state.allowComputationAuthoring,
          }),
        ),
      );
      if (result.accepted) {
        state.rebuildIndex();
      }
      return jsonContent(result, { isError: result.accepted === false });
    },
  },
  okf_reject_proposal: {
    ...defineTool(
      "Reject a reviewed proposal so it can no longer be accepted.",
      DESTRUCTIVE_WRITE,
      {
        proposalId: nonEmptyStringParameter("Identifier of the proposed change to reject."),
        reason: stringParameter("Optional explanation recorded with the rejection."),
      },
      ["proposalId"],
    ),
    enabled: GATES.authoringMutation,
    handler: async (state, args, principal) =>
      jsonContent(
        await expectedToolOperation(() => requireAuthoring(state, principal).rejectProposal(args)),
      ),
  },
};

module.exports = { tools };
