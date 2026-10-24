"use strict";

const {
  checkComputationReceipt,
  inspectAttestedComputation,
  prepareAttestedComputation,
} = require("../../computation");
const {
  READ_ONLY,
  booleanParameter,
  defineTool,
  expectedToolOperation,
  integerParameter,
  jsonContent,
  nonEmptyStringParameter,
  objectParameter,
} = require("../registry");

const tools = {
  inspect_attested_computation: {
    ...defineTool(
      "Statically inspect an Attested Computation contract and indexed inert artifacts; never execute it.",
      READ_ONLY,
      {
        uri: nonEmptyStringParameter("Canonical or compatibility URI of the Attested Computation."),
        asOf: nonEmptyStringParameter("UTC ISO date or datetime for freshness evaluation."),
        includeComputation: booleanParameter("Include bounded inline or text computation content."),
        maxContentBytes: integerParameter("Maximum computation bytes to include.", 1, 1048576, 65536),
      },
      ["uri"],
    ),
    handler: async (state, args) => jsonContent(await expectedToolOperation(
      () => inspectAttestedComputation(state.index, args.uri, args),
      { translateTypeError: true },
    )),
  },
  prepare_attested_computation: {
    ...defineTool(
      "Check declared parameters and produce non-executing digests without echoing parameter values.",
      READ_ONLY,
      {
        uri: nonEmptyStringParameter("Canonical or compatibility URI of the Attested Computation."),
        parameters: objectParameter("Parameter values keyed only by declared names."),
        asOf: nonEmptyStringParameter("UTC ISO date or datetime for freshness evaluation."),
      },
      ["uri", "parameters"],
    ),
    handler: async (state, args) => jsonContent(await expectedToolOperation(
      () => prepareAttestedComputation(state.index, args.uri, args.parameters, args),
      { translateTypeError: true },
    )),
  },
  check_computation_receipt: {
    ...defineTool(
      "Check receipt field presence only; never attest, echo values, or persist the receipt.",
      READ_ONLY,
      {
        uri: nonEmptyStringParameter("Canonical or compatibility URI of the Attested Computation."),
        receipt: objectParameter("Ephemeral receipt object; only its field names are returned."),
      },
      ["uri", "receipt"],
    ),
    handler: async (state, args) => jsonContent(await expectedToolOperation(
      () => checkComputationReceipt(state.index, args.uri, args.receipt),
      { translateTypeError: true },
    )),
  },
};

module.exports = { tools };
