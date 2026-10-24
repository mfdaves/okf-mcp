"use strict";

const { producerReceipt } = require("../../producers");
const {
  GATES,
  PRODUCER_PREVIEW,
  PRODUCER_RUN,
  READ_ONLY,
  defineTool,
  detailParameter,
  expectedToolOperation,
  jsonContent,
  nonEmptyStringParameter,
} = require("../registry");

const tools = {
  okf_list_producers: {
    ...defineTool(
      "List configured producer instances without loading or executing their packages.",
      READ_ONLY,
    ),
    enabled: GATES.producer,
    handler: (state) => jsonContent(state.producerService.list(), { structured: true }),
  },
  okf_preview_producer: {
    ...defineTool(
      "Read source metadata, generate a candidate OKF 0.2 bundle, and validate its publication diff without writing files.",
      PRODUCER_PREVIEW,
      {
        producer: nonEmptyStringParameter("Configured producer instance name."),
        detail: detailParameter(
          "Receipt detail level; full includes bounded bundle-relative changed paths.",
        ),
      },
      ["producer"],
    ),
    enabled: GATES.producer,
    handler: async (state, args) => {
      const result = await expectedToolOperation(
        () =>
          state.producerService.preview(args.producer, {
            additionalBundles: state.remoteBundles,
          }),
        { translateTypeError: true },
      );
      return jsonContent(producerReceipt(result, args.detail || "compact"), { structured: true });
    },
  },
  okf_run_producer: {
    ...defineTool(
      "Regenerate, strictly validate, safely publish, and reindex one configured OKF producer.",
      PRODUCER_RUN,
      {
        producer: nonEmptyStringParameter("Configured producer instance name."),
        detail: detailParameter(
          "Receipt detail level; full includes bounded bundle-relative changed paths.",
        ),
      },
      ["producer"],
    ),
    enabled: GATES.producerWrite,
    handler: async (state, args) => {
      const result = await expectedToolOperation(
        () =>
          state.producerService.run(args.producer, {
            additionalBundles: state.remoteBundles,
          }),
        { translateTypeError: true },
      );
      if (result.applied) state.rebuildIndex();
      return jsonContent(producerReceipt(result, args.detail || "compact"), {
        structured: true,
        isError: result.applied === false,
      });
    },
  },
};

module.exports = { tools };
