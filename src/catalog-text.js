"use strict";

// Catalog text is data, never instructions (plan B-6, S-3). Diagnostic and
// error messages never echo vocabulary a concept used but nobody declared
// (an undeclared relation type, a repeated computation parameter name): any
// such value, however identifier-like, could carry text meant for an agent.
// The messages are constant apart from the concept path and an ordinal, so
// an operator can find the entry; the value itself stays in the structured
// fields beside the message (relationType, field).

function undeclaredRelationTypeMessage(conceptPath, position) {
  return `Relation #${position + 1} of ${conceptPath} uses an undeclared type.`;
}

function repeatedParameterMessage(conceptPath, position) {
  return `Computation parameter #${position + 1} of ${conceptPath || "this concept"} repeats an earlier name.`;
}

module.exports = { repeatedParameterMessage, undeclaredRelationTypeMessage };
