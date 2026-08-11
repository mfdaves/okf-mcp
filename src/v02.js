"use strict";

const { itemLiteral, markdownStructure, sectionNodes } = require("./markdown");

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function validActor(value) {
  if (!nonEmptyString(value) || /\s/.test(value)) {
    return false;
  }
  return /^human:.+/.test(value)
    || /^process:.+/.test(value)
    || /^[^/]+\/[^/]+$/.test(value);
}

function diagnostic(code, field, message) {
  return {
    code,
    field,
    severity: "warning",
    layer: "v0.2",
    message,
  };
}

function validIsoDate(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function validIsoDateTime(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/,
  );
  if (!match || !validIsoDate(match[1])) {
    return false;
  }
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] === undefined ? 0 : Number(match[4]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  return hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
    && Number.isFinite(Date.parse(value));
}

function normalizeAsOf(value) {
  if (value === undefined || value === null || value === "") {
    return new Date().toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("asOf must be a valid Date, ISO date, or ISO datetime.");
    }
    return value.toISOString().slice(0, 10);
  }
  if (validIsoDate(value)) {
    return value;
  }
  if (validIsoDateTime(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  throw new TypeError("asOf must be a valid Date, ISO date, or ISO datetime.");
}

function normalizeUsageWindow(value, field, diagnostics) {
  if (value === undefined) {
    return null;
  }
  if (!isPlainObject(value) || !validIsoDate(value.from) || !validIsoDate(value.to) || value.from > value.to) {
    diagnostics.push(diagnostic(
      "invalid_usage_window",
      field,
      "usage_window must contain valid from and to ISO dates with from not later than to.",
    ));
    return null;
  }
  return Object.assign({}, value, {
    from: value.from,
    to: value.to,
  });
}

function extractLegacyCitations(body) {
  const structure = markdownStructure(body);
  const citations = [];
  structure.headings
    .filter((heading) => heading.level === 1 && heading.text.toLowerCase() === "citations")
    .forEach((heading) => {
      const lists = new Set(sectionNodes(heading, { stopAtAnyHeading: true }).filter((node) => node.type === "list"));
      structure.items
        .filter((item) => lists.has(item.node.parent))
        .forEach((item) => {
          const raw = itemLiteral(structure, item);
          if (!raw) {
            return;
          }
          const markdownLink = raw.match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
          citations.push({
            ...(markdownLink ? { title: markdownLink[1].trim() } : {}),
            resource: markdownLink ? markdownLink[2].trim() : raw.replace(/^`|`$/g, ""),
            legacy: true,
            valid: true,
            raw,
          });
        });
  });

  return citations;
}

function normalizeSources(frontmatter, body, diagnostics) {
  const native = hasOwn(frontmatter, "sources");
  const usageWindow = normalizeUsageWindow(frontmatter.usage_window, "usage_window", diagnostics);
  if (!native) {
    const legacy = extractLegacyCitations(body);
    return {
      sources: legacy,
      origin: legacy.length ? "legacy_citations" : "none",
      usageWindow,
    };
  }
  if (!Array.isArray(frontmatter.sources)) {
    diagnostics.push(diagnostic("invalid_sources", "sources", "sources must be a list when present."));
    return { sources: [], origin: "native", usageWindow };
  }

  const sources = frontmatter.sources.map((entry, index) => {
    const field = `sources[${index}]`;
    if (!isPlainObject(entry)) {
      diagnostics.push(diagnostic("invalid_source_entry", field, "Each sources entry must be a mapping."));
      return { raw: entry, legacy: false, valid: false };
    }
    let valid = true;
    if (!nonEmptyString(entry.resource)) {
      diagnostics.push(diagnostic("missing_source_resource", `${field}.resource`, "A source entry requires a non-empty resource."));
      valid = false;
    }
    if (hasOwn(entry, "id") && !nonEmptyString(entry.id)) {
      diagnostics.push(diagnostic("invalid_source_id", `${field}.id`, "A source id must be a non-empty scalar."));
      valid = false;
    }
    if (hasOwn(entry, "author") && !nonEmptyString(entry.author)) {
      diagnostics.push(diagnostic("invalid_source_author", `${field}.author`, "A source author must be a non-empty actor scalar."));
      valid = false;
    }
    if (hasOwn(entry, "usage_count") && (
      typeof entry.usage_count !== "number"
      || !Number.isFinite(entry.usage_count)
      || entry.usage_count < 0
    )) {
      diagnostics.push(diagnostic("invalid_source_usage_count", `${field}.usage_count`, "A source usage_count must be a non-negative finite number."));
      valid = false;
    }
    if (hasOwn(entry, "last_modified") && !validIsoDate(entry.last_modified)) {
      diagnostics.push(diagnostic("invalid_source_last_modified", `${field}.last_modified`, "A source last_modified value must be an ISO date."));
      valid = false;
    }
    const localDiagnosticsBefore = diagnostics.length;
    const entryUsageWindow = normalizeUsageWindow(entry.usage_window, `${field}.usage_window`, diagnostics);
    if (diagnostics.length > localDiagnosticsBefore) {
      valid = false;
    }
    return Object.assign({}, entry, {
      legacy: false,
      valid,
      usageWindow: entryUsageWindow || usageWindow,
    });
  });
  return { sources, origin: "native", usageWindow };
}

function normalizeGenerated(frontmatter, diagnostics) {
  if (hasOwn(frontmatter, "generated")) {
    const value = frontmatter.generated;
    if (!isPlainObject(value)) {
      diagnostics.push(diagnostic("invalid_generated", "generated", "generated must be a mapping when present."));
      return { generated: null, origin: "native" };
    }
    let valid = true;
    if (!validActor(value.by)) {
      diagnostics.push(diagnostic("missing_generated_by", "generated.by", "generated.by requires a non-empty actor."));
      valid = false;
    }
    if (hasOwn(value, "at") && !validIsoDateTime(value.at)) {
      diagnostics.push(diagnostic("invalid_generated_at", "generated.at", "generated.at must be an ISO datetime when present."));
      valid = false;
    }
    return {
      generated: Object.assign({}, value, {
        by: validActor(value.by) ? value.by : null,
        at: hasOwn(value, "at") && validIsoDateTime(value.at) ? value.at : null,
        legacy: false,
        valid,
      }),
      origin: "native",
    };
  }
  if (hasOwn(frontmatter, "timestamp")) {
    if (!validIsoDateTime(frontmatter.timestamp)) {
      diagnostics.push(diagnostic("invalid_legacy_timestamp", "timestamp", "Legacy timestamp must be an ISO datetime."));
      return { generated: null, origin: "legacy_timestamp" };
    }
    return {
      generated: {
        by: null,
        at: frontmatter.timestamp,
        legacy: true,
        valid: true,
      },
      origin: "legacy_timestamp",
    };
  }
  return { generated: null, origin: "none" };
}

function normalizeVerified(value, present, diagnostics) {
  if (!present) {
    return { events: [], valid: true };
  }
  const candidates = isPlainObject(value) ? [value] : value;
  if (!Array.isArray(candidates)) {
    diagnostics.push(diagnostic("invalid_verified", "verified", "verified must be a mapping or a list of mappings."));
    return { events: [], valid: false };
  }

  const events = [];
  let valid = true;
  candidates.forEach((entry, index) => {
    const field = `verified[${index}]`;
    if (!isPlainObject(entry)) {
      diagnostics.push(diagnostic("invalid_verified_event", field, "Each verification event must be a mapping."));
      valid = false;
      return;
    }
    if (!validActor(entry.by)) {
      diagnostics.push(diagnostic("invalid_verified_actor", `${field}.by`, "A verification event requires a non-empty actor."));
      valid = false;
    }
    if (!validIsoDateTime(entry.at)) {
      diagnostics.push(diagnostic("invalid_verified_at", `${field}.at`, "A verification event requires an ISO datetime."));
      valid = false;
    }
    events.push(Object.assign({}, entry, {
      by: validActor(entry.by) ? entry.by : null,
      at: validIsoDateTime(entry.at) ? entry.at : null,
    }));
  });
  return valid ? { events, valid: true } : { events: [], valid: false };
}

function deriveTrustTier(events, valid) {
  if (!valid || !Array.isArray(events) || events.length === 0) {
    return "unverified";
  }
  return events.some((entry) => /^human:.+/.test(String(entry.by || "")))
    ? "human-reviewed"
    : "machine-confirmed";
}

function normalizeLifecycle(frontmatter, asOf, diagnostics) {
  let status = "stable";
  if (hasOwn(frontmatter, "status")) {
    if (typeof frontmatter.status === "string" && ["draft", "stable", "deprecated"].includes(frontmatter.status)) {
      status = frontmatter.status;
    } else {
      status = null;
      diagnostics.push(diagnostic("invalid_status", "status", "status must be draft, stable, or deprecated."));
    }
  }

  let staleAfter = null;
  let freshness = "unspecified";
  if (hasOwn(frontmatter, "stale_after")) {
    if (validIsoDate(frontmatter.stale_after)) {
      staleAfter = frontmatter.stale_after;
      freshness = asOf >= staleAfter ? "stale" : "fresh";
    } else {
      freshness = "invalid";
      diagnostics.push(diagnostic("invalid_stale_after", "stale_after", "stale_after must be an ISO date."));
    }
  }
  return { status, staleAfter, freshness, asOf };
}

function extractInlineComputation(body) {
  const structure = markdownStructure(body);
  const blocks = [];
  const sections = structure.headings.filter((heading) => (
    heading.level === 1 && heading.text.toLowerCase() === "computation"
  ));
  sections.forEach((heading) => {
    const nodes = new Set(sectionNodes(heading, { stopAtAnyHeading: true }));
    structure.codeBlocks
      .filter((block) => nodes.has(block.node))
      .forEach((block) => {
        blocks.push({
          language: block.language,
          content: block.content,
          closed: Boolean(block.fenced && block.closed),
        });
      });
  });
  return {
    sectionCount: sections.length,
    blocks,
  };
}

function normalizeParameters(value, diagnostics) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("invalid_computation_parameters", "parameters", "parameters must be a list when present."));
    return null;
  }
  let valid = true;
  const seen = new Set();
  const parameters = value.map((entry, index) => {
    const field = `parameters[${index}]`;
    if (!isPlainObject(entry)
      || !nonEmptyString(entry.name)
      || !nonEmptyString(entry.type)
      || typeof entry.required !== "boolean") {
      diagnostics.push(diagnostic(
        "invalid_computation_parameter",
        field,
        "Each parameter requires non-empty name and type scalars plus a boolean required field.",
      ));
      valid = false;
      return isPlainObject(entry) ? Object.assign({}, entry, { valid: false }) : { raw: entry, valid: false };
    }
    const name = String(entry.name);
    if (seen.has(name)) {
      diagnostics.push(diagnostic("duplicate_computation_parameter", `${field}.name`, `Duplicate computation parameter: ${name}`));
      valid = false;
    }
    seen.add(name);
    return Object.assign({}, entry, {
      name,
      type: String(entry.type),
      valid: true,
    });
  });
  return valid ? parameters : null;
}

function normalizeExecutor(value, diagnostics) {
  if (value === undefined) {
    diagnostics.push(diagnostic("missing_computation_executor", "executor", "An attestable computation requires an executor contract."));
    return null;
  }
  if (!isPlainObject(value)) {
    diagnostics.push(diagnostic("invalid_computation_executor", "executor", "executor must be a mapping."));
    return null;
  }
  let valid = true;
  if (!nonEmptyString(value.resource)) {
    diagnostics.push(diagnostic("missing_executor_resource", "executor.resource", "executor.resource must be a non-empty path or URI."));
    valid = false;
  }
  if (!Array.isArray(value.receipt)
    || value.receipt.length === 0
    || value.receipt.some((entry) => !nonEmptyString(entry))) {
    diagnostics.push(diagnostic("invalid_executor_receipt", "executor.receipt", "executor.receipt must be a non-empty list of field names."));
    valid = false;
  }
  const receipt = Array.isArray(value.receipt) ? value.receipt.map(String) : [];
  if (new Set(receipt).size !== receipt.length) {
    diagnostics.push(diagnostic("duplicate_executor_receipt_field", "executor.receipt", "executor.receipt field names must be unique."));
    valid = false;
  }
  return Object.assign({}, value, {
    resource: nonEmptyString(value.resource) ? value.resource : null,
    receipt,
    valid,
  });
}

function normalizeAttester(value, diagnostics) {
  if (value === undefined) {
    diagnostics.push(diagnostic("missing_computation_attester", "attester", "An attestable computation requires an attester contract."));
    return null;
  }
  if (!isPlainObject(value)) {
    diagnostics.push(diagnostic("invalid_computation_attester", "attester", "attester must be a mapping."));
    return null;
  }
  const valid = nonEmptyString(value.resource);
  if (!valid) {
    diagnostics.push(diagnostic("missing_attester_resource", "attester.resource", "attester.resource must be a non-empty path or URI."));
  }
  return Object.assign({}, value, {
    resource: valid ? value.resource : null,
    valid,
  });
}

function normalizeAttestedComputation(frontmatter, body, diagnostics) {
  if (frontmatter.type !== "Attested Computation") {
    return null;
  }
  const start = diagnostics.length;
  let runtime = null;
  if (!hasOwn(frontmatter, "runtime")) {
    diagnostics.push(diagnostic("missing_computation_runtime", "runtime", "An Attested Computation requires runtime."));
  } else if (!nonEmptyString(frontmatter.runtime)) {
    diagnostics.push(diagnostic("invalid_computation_runtime", "runtime", "runtime must be a non-empty scalar."));
  } else {
    runtime = String(frontmatter.runtime);
  }

  const parameters = normalizeParameters(frontmatter.parameters, diagnostics);
  const inline = extractInlineComputation(body);
  const hasFileField = hasOwn(frontmatter, "computation");
  const filePath = hasFileField && nonEmptyString(frontmatter.computation)
    ? frontmatter.computation
    : null;
  if (hasFileField && !filePath) {
    diagnostics.push(diagnostic("invalid_computation_path", "computation", "computation must be a non-empty path when present."));
  }
  if (inline.sectionCount > 1
    || inline.blocks.some((block) => !block.closed || !block.content.trim())
    || inline.blocks.length > 1) {
    diagnostics.push(diagnostic(
      "invalid_inline_computation",
      "body.# Computation",
      "Inline computation requires one # Computation section containing exactly one closed fenced code block.",
    ));
  }
  if (hasFileField && inline.blocks.length > 0) {
    diagnostics.push(diagnostic(
      "conflicting_computation_sources",
      "computation",
      "Use either computation file path or an inline fenced computation, not both.",
    ));
  }

  let computation = null;
  if (filePath && inline.blocks.length === 0) {
    computation = { mode: "file", path: filePath };
  } else if (!hasFileField && inline.sectionCount === 1 && inline.blocks.length === 1 && inline.blocks[0].closed) {
    computation = Object.assign({ mode: "inline" }, inline.blocks[0]);
  } else if (!hasFileField && inline.blocks.length === 0) {
    diagnostics.push(diagnostic(
      "missing_computation",
      "body.# Computation",
      "Provide computation as a file path or one fenced block under # Computation.",
    ));
  }

  const executor = normalizeExecutor(frontmatter.executor, diagnostics);
  const attester = normalizeAttester(frontmatter.attester, diagnostics);
  return {
    runtime,
    parameters,
    computation,
    executor,
    attester,
    inline,
    ready: diagnostics.length === start,
  };
}

function normalizeV02Signals(documentOrFrontmatter, options) {
  const input = documentOrFrontmatter || {};
  const document = isPlainObject(input) && isPlainObject(input.frontmatter) ? input : null;
  const frontmatter = document ? input.frontmatter : (isPlainObject(input) ? input : {});
  const config = options || {};
  const body = hasOwn(config, "body") ? config.body : document && hasOwn(document, "body") ? document.body : "";
  const asOf = normalizeAsOf(config.asOf);
  const diagnostics = [];

  let resource = null;
  if (hasOwn(frontmatter, "resource")) {
    if (nonEmptyString(frontmatter.resource)) {
      resource = frontmatter.resource;
    } else {
      diagnostics.push(diagnostic("invalid_resource", "resource", "resource must be a non-empty path or URI when present."));
    }
  }
  const provenance = normalizeSources(frontmatter, body, diagnostics);
  const generation = normalizeGenerated(frontmatter, diagnostics);
  const verification = normalizeVerified(frontmatter.verified, hasOwn(frontmatter, "verified"), diagnostics);
  const lifecycle = normalizeLifecycle(frontmatter, asOf, diagnostics);
  const computation = normalizeAttestedComputation(frontmatter, body, diagnostics);

  return {
    raw: frontmatter,
    resource,
    sources: provenance.sources,
    sourcesOrigin: provenance.origin,
    usageWindow: provenance.usageWindow,
    generated: generation.generated,
    generatedOrigin: generation.origin,
    verifiedEvents: verification.events,
    trustTier: deriveTrustTier(verification.events, verification.valid),
    status: lifecycle.status,
    staleAfter: lifecycle.staleAfter,
    freshness: lifecycle.freshness,
    asOf: lifecycle.asOf,
    computation,
    diagnostics,
  };
}

module.exports = {
  normalizeV02Signals,
};
