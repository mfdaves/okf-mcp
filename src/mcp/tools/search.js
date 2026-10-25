"use strict";

const { MAX_QUERY_CHARACTERS, MAX_QUERY_TERMS } = require("../../search/lexical");
const { SEARCH_MODES, searchConcepts } = require("../../search/query");
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

// R-11: the description asks for keywords in the catalog's languages and exact
// identifiers, and explains the confidence fields. It must stay free of
// catalog text (B-6, S-3): it is composed from constants only.
const QUERY_GUIDANCE =
  "Write it as keywords in the catalog's languages (Italian and English word endings and " +
  "accents are normalised) and put identifiers, codes, paths, SKUs and exact titles in double " +
  "quotes: quoted text is matched literally (no stemming, accents and single letters kept) " +
  "against ids, paths, aliases, titles and raw tokens, and unquoted tokens with digits or " +
  "hyphens stay literal too. Leave out question words; unquoted stop words and single letters " +
  "are dropped.";

const SEARCH_DESCRIPTION =
  "Search OKF concepts with a text query and structured filters; returns ranked summaries " +
  `with match confidence. ${QUERY_GUIDANCE} Mode auto lists the concepts matching every ` +
  "term first and, when there are only a few of them, follows them with concepts matching " +
  "some of the terms (mode auto in the response; any when nothing matches every term). The " +
  "response reports the mode that ran, queryTerms and droppedTerms, allTermsTotal (how many concepts match every term), and " +
  "lowConfidence, true when the any-term fallback produced the page and its best result " +
  "matched fewer than half of the terms: treat such results as weak and rephrase or narrow " +
  "with filters. Each result carries coverage (share of query terms it matched) and relevance " +
  "(score relative to the top result). When the server has an embedder configured, ranking is " +
  "hybrid by default: lexical and semantic similarity are fused, so concepts that use other " +
  "words for the same idea are found too; relevance is then fused, mode and coverage keep " +
  "their lexical meaning (lowConfidence reads the top result shown), and each result adds lexicalScore, denseScore and " +
  "fusedScore. The response then reports hybrid (whether fusion ran) and embedder, whose " +
  "degraded flag says the semantic side could not run and the results are lexical only. " +
  "Hybrid responses also report alphaUsed, the weight of the semantic side for this query, " +
  "and alphaReason: fixed, or under the adaptive weight literal_terms (quoted or " +
  "identifier-like terms and a concept matching every term), all_terms (several concepts " +
  "match every term), weak_lexical " +
  "(nothing matches even half of the terms) or interpolated (in between). Every response to a " +
  "query also carries confidence: { coverage (of the top result), topSimilarity (the best " +
  "semantic similarity when the embedder ran, else null), lowConfidence, reasons }; with an " +
  "embedder lowConfidence is also true when the top result matched fewer than half of the " +
  "terms and no concept reaches the server's similarity threshold (reasons " +
  "weak_lexical_match, low_similarity).";

const HYBRID_DESCRIPTION =
  "Fuse lexical and semantic ranking when the server has an embedder configured (the default " +
  "there); false ranks lexically and makes no embedding request. Ignored without an embedder.";

// Options only the server supplies; never accepted from tool arguments.
const RUNTIME_OPTIONS = [
  "autoFill",
  "queryVector",
  "vectorCache",
  "embedUnits",
  "alpha",
  "adaptiveAlpha",
  "minSimilarity",
  "fusionNormalization",
];

async function runSearch(state, args) {
  const options = Object.assign({ detail: "compact" }, args || {});
  RUNTIME_OPTIONS.forEach((key) => {
    delete options[key];
  });
  if (state.embeddings) {
    return state.embeddings.search(state.index, options);
  }
  const response = searchConcepts(state.index, options);
  if (options.hybrid !== true) {
    return response;
  }
  const results = response.results;
  delete response.results;
  return Object.assign(response, {
    hybrid: false,
    embedder: { id: null, remote: null, dimension: null, degraded: true, code: "not_configured" },
    results,
  });
}

const MODE_DESCRIPTION =
  "auto lists concepts matching every term first and appends concepts matching some terms " +
  "when only a few match all of them; all requires every term (the pre-0.10 behaviour); any " +
  "ranks concepts matching at least one term. The response's mode field says which one ran " +
  "(auto when both kinds are listed).";

function modeParameter() {
  return stringParameter(MODE_DESCRIPTION, { enum: SEARCH_MODES.slice(), default: "auto" });
}

function unitIntervalParameter(description) {
  return { type: "number", description, minimum: 0, maximum: 1 };
}

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
        query: stringParameter(
          `Optional text query applied together with the listing filters; maximum ${MAX_QUERY_TERMS} terms after stop words. ${QUERY_GUIDANCE}`,
          { maxLength: MAX_QUERY_CHARACTERS },
        ),
        mode: modeParameter(),
        bundle: nonEmptyStringParameter("Limit results to this bundle id."),
        type: nonEmptyStringParameter("Limit results to this exact concept type."),
        tag: nonEmptyStringParameter("Limit results to concepts containing this tag."),
        detail: detailParameter(
          "Compact returns only URI, title, type, and description, plus coverage and relevance when a query is given; full includes navigation metadata and signals.",
        ),
        limit: integerParameter("Maximum number of concepts to return.", 1, 250, 25),
        offset: integerParameter(
          "Number of matching concepts to skip before returning results.",
          0,
          undefined,
          0,
        ),
      },
    ),
    handler: async (state, args) =>
      jsonContent(
        await expectedToolOperation(() => listConcepts(state.index, args), {
          translateTypeError: true,
        }),
      ),
  },
  search_concepts: {
    ...defineTool(SEARCH_DESCRIPTION, READ_ONLY, {
      query: stringParameter(
        `Text query matched against concept metadata and content; maximum ${MAX_QUERY_TERMS} terms after stop words. ${QUERY_GUIDANCE}`,
        { maxLength: MAX_QUERY_CHARACTERS },
      ),
      mode: modeParameter(),
      minCoverage: unitIntervalParameter(
        "Drop results that matched a smaller share of the query terms than this; off by default. Can leave total at 0.",
      ),
      minRelevance: unitIntervalParameter(
        "Drop results whose score relative to the top result is below this; off by default. Can leave total at 0.",
      ),
      hybrid: optionalBooleanParameter(HYBRID_DESCRIPTION),
      freshnessPrior: booleanParameter(
        "Multiply scores by 0.5 for deprecated, 0.7 for stale, and 0.85 for draft concepts before ranking; off by default.",
      ),
      bundle: nonEmptyStringParameter("Limit results to this bundle id."),
      types: stringArrayParameter("Limit results to any of these concept types.", {
        nonEmptyItems: true,
      }),
      tagsAny: stringArrayParameter("Require at least one of these tags.", {
        nonEmptyItems: true,
      }),
      tagsAll: stringArrayParameter("Require all of these tags.", { nonEmptyItems: true }),
      pathPrefix: stringParameter(
        "Limit results to bundle relative paths beginning with this prefix.",
      ),
      relationType: nonEmptyStringParameter(
        "Limit results to concepts with an outgoing relation of this type.",
      ),
      frontmatter: objectParameter(
        "Exact frontmatter filters; array fields use contains matching.",
      ),
      linkedTo: nonEmptyStringParameter("Require an outgoing edge to this concept URI."),
      linkedFrom: nonEmptyStringParameter("Require an incoming edge from this concept URI."),
      orphanOnly: booleanParameter(
        "Return only concepts without incoming or outgoing resolved edges.",
      ),
      statuses: stringArrayParameter("Limit results to lifecycle statuses.", {
        nonEmptyItems: true,
      }),
      trustTiers: stringArrayParameter(
        "Limit results to unverified, machine-confirmed, or human-reviewed trust tiers.",
        { nonEmptyItems: true },
      ),
      freshness: stringArrayParameter(
        "Limit results to unspecified, fresh, stale, or invalid freshness states.",
        { nonEmptyItems: true },
      ),
      asOf: nonEmptyStringParameter(
        "UTC ISO date or datetime used for deterministic freshness evaluation.",
      ),
      hasSources: optionalBooleanParameter(
        "Require concepts to have or not have normalized sources.",
      ),
      runtime: nonEmptyStringParameter("Limit results to this Attested Computation runtime."),
      attestationReady: optionalBooleanParameter("Require static Attested Computation readiness."),
      generatedBy: nonEmptyStringParameter("Limit results to this generator actor."),
      verifiedBy: nonEmptyStringParameter("Limit results to concepts verified by this actor."),
      detail: detailParameter(
        "Compact returns URI, title, type, description, coverage, and relevance; full adds score, snippet, matchedTerms, navigation metadata, and signals.",
      ),
      limit: integerParameter("Maximum number of concepts to return.", 1, 250, 25),
      offset: integerParameter(
        "Number of matching concepts to skip before returning results.",
        0,
        undefined,
        0,
      ),
    }),
    handler: async (state, args) =>
      jsonContent(
        await expectedToolOperation(() => runSearch(state, args), { translateTypeError: true }),
      ),
  },
  embedding_status: {
    ...defineTool(
      "Report the hybrid search embedder: its id, whether text leaves the machine (remote), the " +
        "vector dimension, whether searches are degraded to lexical only and why, the vector " +
        "cache row count, the startup and last preparation receipts, and token usage. Listed " +
        "only when an embedder is configured.",
      READ_ONLY,
      {},
    ),
    enabled: (state) => Boolean(state?.embeddings),
    handler: async (state) => jsonContent(state.embeddings.status()),
  },
};

module.exports = { QUERY_GUIDANCE, tools };
