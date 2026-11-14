"use strict";

// Errors that cross from extension code (producers, tool packs) to a caller
// carry only a bounded code and scalar details; their message is never
// forwarded (B-6).

const PUBLIC_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_ERROR_DETAILS = 16;
const MAX_ERROR_DETAIL_CHARS = 200;
// Tool packs pass on messages a caller needs to correct its request (a
// database's error for a query, for instance): longer strings, truncated.
const TOOL_PACK_DETAILS = Object.freeze({ maxChars: 500, truncate: true });

// The error's own code when it is a bounded identifier, else null.
function publicErrorCode(error) {
  const code = error && typeof error.code === "string" ? error.code : "";
  return PUBLIC_ERROR_CODE.test(code) ? code : null;
}

// The error's `details` reduced to at most 16 entries under identifier keys
// whose values are null, booleans, finite numbers, or single-line strings
// holding none of `secrets`; null when none remain. A string longer than
// `options.maxChars` (default 200) is dropped, or with `options.truncate`
// cut to that length ending in "…".
function boundedErrorDetails(error, secrets, options) {
  const maxChars = options?.maxChars || MAX_ERROR_DETAIL_CHARS;
  const raw =
    error?.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? error.details
      : {};
  const details = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(details).length >= MAX_ERROR_DETAILS) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue;
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      details[key] = value;
    } else if (
      typeof value === "string" &&
      (value.length <= maxChars || options?.truncate) &&
      !/[\p{Cc}]/u.test(value) &&
      !(secrets || []).some((secret) => secret && value.includes(secret))
    ) {
      details[key] = value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
    }
  }
  return Object.keys(details).length ? details : null;
}

module.exports = { TOOL_PACK_DETAILS, boundedErrorDetails, publicErrorCode };
