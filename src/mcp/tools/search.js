"use strict";

const { searchConcepts } = require("../../search");
const { MAX_QUERY_CHARACTERS, MAX_QUERY_TERMS } = require("../../search-index");
const {
  READ_ONLY,
  booleanParameter,
  defineTool,
  detailParameter,
  expectedToolOperation,
  integerParameter,
  jsonContent,
  nonEmptyStringParameter,
  objectParameter,
  optionalBooleanParameter,
  stringArrayParameter,
  stringParameter,
} = require("../registry");

function listConcepts(index, args) {
  const options = Object.assign({ detail: "compact" }, args || {});
  if (options.type && !options.types) {
    options.types = [options.type];
  }
  if (options.tag && !options.tagsAny) {
    options.tagsAny = [options.tag];
  }
  return searchConcepts(index, options);
}

const tools = {
  list_concepts: {
    ...defineTool(
      "List compact OKF concept summaries with optional bundle, type, tag, and text filters.",
      READ_ONLY,
      {
        query: stringParameter(`Optional all-term text query matched against concept metadata and content; maximum ${MAX_QUERY_TERMS} terms.`, { maxLength: MAX_QUERY_CHARACTERS }),
        bundle: nonEmptyStringParameter("Limit results to this bundle id."),
        type: nonEmptyStringParameter("Limit results to this exact concept type."),
        tag: nonEmptyStringParameter("Limit results to concepts containing this tag."),
        detail: detailParameter("Compact returns only URI, title, type, and description; full includes navigation metadata and signals."),
        limit: integerParameter("Maximum number of concepts to return.", 1, 250, 25),
        offset: integerParameter("Number of matching concepts to skip before returning results.", 0, undefined, 0),
      },
    ),
    handler: (state, args) => jsonContent(listConcepts(state.index, args)),
  },
  search_concepts: {
    ...defineTool(
      "Search OKF concepts and return ranked summaries using text and structured filters.",
      READ_ONLY,
      {
        query: stringParameter(`All-term text query matched against concept metadata and content; maximum ${MAX_QUERY_TERMS} terms.`, { maxLength: MAX_QUERY_CHARACTERS }),
        bundle: nonEmptyStringParameter("Limit results to this bundle id."),
        types: stringArrayParameter("Limit results to any of these concept types.", { nonEmptyItems: true }),
        tagsAny: stringArrayParameter("Require at least one of these tags.", { nonEmptyItems: true }),
        tagsAll: stringArrayParameter("Require all of these tags.", { nonEmptyItems: true }),
        pathPrefix: stringParameter("Limit results to bundle relative paths beginning with this prefix."),
        relationType: nonEmptyStringParameter("Limit results to concepts with an outgoing relation of this type."),
        frontmatter: objectParameter("Exact frontmatter filters; array fields use contains matching."),
        linkedTo: nonEmptyStringParameter("Require an outgoing edge to this concept URI."),
        linkedFrom: nonEmptyStringParameter("Require an incoming edge from this concept URI."),
        orphanOnly: booleanParameter("Return only concepts without incoming or outgoing resolved edges."),
        statuses: stringArrayParameter("Limit results to lifecycle statuses.", { nonEmptyItems: true }),
        trustTiers: stringArrayParameter("Limit results to unverified, machine-confirmed, or human-reviewed trust tiers.", { nonEmptyItems: true }),
        freshness: stringArrayParameter("Limit results to unspecified, fresh, stale, or invalid freshness states.", { nonEmptyItems: true }),
        asOf: nonEmptyStringParameter("UTC ISO date or datetime used for deterministic freshness evaluation."),
        hasSources: optionalBooleanParameter("Require concepts to have or not have normalized sources."),
        runtime: nonEmptyStringParameter("Limit results to this Attested Computation runtime."),
        attestationReady: optionalBooleanParameter("Require static Attested Computation readiness."),
        generatedBy: nonEmptyStringParameter("Limit results to this generator actor."),
        verifiedBy: nonEmptyStringParameter("Limit results to concepts verified by this actor."),
        detail: detailParameter("Compact returns only URI, title, type, and description; full includes ranking, navigation metadata, and signals."),
        limit: integerParameter("Maximum number of concepts to return.", 1, 250, 25),
        offset: integerParameter("Number of matching concepts to skip before returning results.", 0, undefined, 0),
      },
    ),
    handler: async (state, args) => jsonContent(await expectedToolOperation(
      () => searchConcepts(state.index, Object.assign({ detail: "compact" }, args)),
      { translateTypeError: true },
    )),
  },
};

module.exports = { tools };
