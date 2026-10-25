"use strict";

const { CONTEXT_LIMITS, PROVENANCE_MODES, assembleContext } = require("../../context/assemble");
const { MAX_QUERY_CHARACTERS, MAX_QUERY_TERMS } = require("../../search/lexical");
const {
  READ_ONLY,
  defineTool,
  expectedToolOperation,
  integerParameter,
  stringParameter,
} = require("../registry");
const { QUERY_GUIDANCE, tools: searchTools } = require("./search");

// C-1, C-3: the description explains the budget, the anchors and the
// provenance and repeats the search guidance (R-11). It is composed from
// constants only and never carries catalog text (B-6, S-3).
const CONTEXT_DESCRIPTION =
  "Assemble a token-budgeted context for a question from the sections of the best-matching OKF " +
  "concepts. Candidates come from the same search as search_concepts (every filter applies; the " +
  "response repeats mode, lowConfidence, queryTerms and droppedTerms and lists the candidate " +
  "concepts); their sections are ranked, deduplicated and packed in rank order while they fit " +
  "budgetTokens. Ranking follows the candidate concept order; within a concept, sections whose " +
  "own text matches the query come first, and a strongly matching section may move ahead of a " +
  "few weaker concepts. The budget covers what is delivered, the whole response as returned: " +
  "usedTokens is ceil(characters / 4) of the entire JSON result, every field included (the " +
  "candidate concepts, queryTerms, the counters and every section field), and the budget is " +
  "never exceeded unless it is smaller than the query echo and the field names alone; when " +
  "the fields around the sections do not fit, the candidate concept list is shortened from " +
  "its tail (omittedConcepts). Each section's tokens is the same estimate for that section; " +
  "the estimator is named in the response. Provenance is compact by default " +
  "(status, freshness, verified, sourceCount); set provenance to full for staleAfter, " +
  "trustTier, the verified and generated events and the sources, or to none to spend all of " +
  "the budget on text. When the best section alone is larger than what the rest of the response " +
  "leaves it is returned on its own, its " +
  "text cut at a sentence boundary, with truncated true; omittedSections counts what did not " +
  "fit. Each section carries uri, " +
  "anchor (the concept URI for the text before the first heading, uri#heading-slug otherwise; " +
  "an okf-mcp extension: body and whitespace edits leave it unchanged, renaming the heading or " +
  "adding a same-named heading before it changes it), heading, title, text, tokens, score, " +
  "relevance, coverage, matchedTerms and the concept's provenance. The response also carries " +
  "confidence: { coverage, topSimilarity, lowConfidence, reasons } from the candidate search " +
  "(as in search_concepts); with abstainOnLowConfidence a low-confidence query returns no " +
  "sections and abstained true. For the query, " +
  `${QUERY_GUIDANCE.charAt(0).toLowerCase()}${QUERY_GUIDANCE.slice(1)}`;

// Filters shared with search_concepts, taken with their descriptions so the
// two tools read the same way and one sentinel test covers both.
const SHARED_PARAMETERS = [
  "mode",
  "minCoverage",
  "minRelevance",
  "freshnessPrior",
  "bundle",
  "types",
  "tagsAny",
  "tagsAll",
  "pathPrefix",
  "relationType",
  "frontmatter",
  "linkedTo",
  "linkedFrom",
  "orphanOnly",
  "statuses",
  "trustTiers",
  "freshness",
  "asOf",
  "hasSources",
  "runtime",
  "attestationReady",
  "generatedBy",
  "verifiedBy",
];

function sharedParameters() {
  const source = searchTools.search_concepts.inputSchema.properties;
  return Object.fromEntries(SHARED_PARAMETERS.map((name) => [name, source[name]]));
}

const tools = {
  get_context: {
    ...defineTool(
      CONTEXT_DESCRIPTION,
      READ_ONLY,
      Object.assign(
        {
          query: stringParameter(
            `Text to assemble context for, matched against concept metadata and section text; maximum ${MAX_QUERY_TERMS} terms after stop words. ${QUERY_GUIDANCE}`,
            { minLength: 1, maxLength: MAX_QUERY_CHARACTERS },
          ),
          budgetTokens: integerParameter(
            "Token budget for the whole response, estimated as ceil(characters / 4) of its JSON and never exceeded.",
            1,
            CONTEXT_LIMITS.budgetTokens.maximum,
            CONTEXT_LIMITS.budgetTokens.default,
          ),
          limit: integerParameter(
            "Maximum number of sections to return; the budget is the primary constraint.",
            1,
            CONTEXT_LIMITS.limit.maximum,
            CONTEXT_LIMITS.limit.default,
          ),
          includeProvenance: {
            type: "boolean",
            description:
              "Attach each section's concept provenance (false is the same as provenance none); it counts against the budget.",
            default: true,
          },
          provenance: stringParameter(
            "compact (default): status, freshness, verified (boolean) and sourceCount; full: status, staleAfter, freshness, trustTier, verified, generated, sources; none: no provenance.",
            { enum: PROVENANCE_MODES.slice(), default: "compact" },
          ),
          abstainOnLowConfidence: {
            type: "boolean",
            description:
              "Return no sections when the candidate search is low-confidence (lowConfidence true); the response keeps the confidence block, the candidate concepts and abstained true. Off by default.",
            default: false,
          },
        },
        sharedParameters(),
      ),
      ["query"],
    ),
    // Compact JSON: the text returned is the serialisation usedTokens measures.
    handler: async (state, args) => {
      const result = await expectedToolOperation(() => assembleContext(state.index, args), {
        translateTypeError: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  },
};

module.exports = { tools };
