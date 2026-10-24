"use strict";

// Catalog text is data, never instructions (plan B-6, S-3): diagnostic and
// error messages name paths and URIs, not frontmatter values. A few messages
// name a value an operator must look up, such as an undeclared relation type
// or a duplicated computation parameter. Those echo it only when it is a
// plain identifier, the shape a declared vocabulary entry has; anything else
// is written as "(unlisted)" and stays in the structured fields beside the
// message.
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_./-]{0,63}$/;

function displayIdentifier(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return IDENTIFIER.test(text) ? text : "(unlisted)";
}

module.exports = { displayIdentifier };
