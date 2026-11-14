"use strict";

// The principal an MCP call runs for (plan I-2a):
//   { subject, actor, scopes: Set, name?, email? }
// `okf.read` is required for any call and `okf.write` for the live write
// tools and producer runs. Over stdio the principal comes from the flags
// (actor = --actor, okf.write only with --write); over HTTP from the
// authentication mode (src/mcp/auth.js), or anonymous read-only without one.

const READ_SCOPE = "okf.read";
const WRITE_SCOPE = "okf.write";
const KNOWN_SCOPES = Object.freeze([READ_SCOPE, WRITE_SCOPE]);

function flagsPrincipal(state) {
  return {
    subject: "stdio",
    actor: state?.actor || null,
    scopes: new Set(state?.allowWrite ? [READ_SCOPE, WRITE_SCOPE] : [READ_SCOPE]),
  };
}

function anonymousPrincipal() {
  return { subject: "anonymous", actor: null, scopes: new Set([READ_SCOPE]) };
}

function canWrite(principal) {
  return Boolean(principal?.scopes?.has(WRITE_SCOPE));
}

// What a write made for this principal hands the authoring services: its
// actor, and the git author when it carries both a name and an email.
function principalWriteContext(principal) {
  return {
    ...(principal?.actor ? { actor: principal.actor } : {}),
    ...(principal?.name && principal?.email
      ? { author: { name: principal.name, email: principal.email } }
      : {}),
  };
}

module.exports = {
  KNOWN_SCOPES,
  READ_SCOPE,
  WRITE_SCOPE,
  anonymousPrincipal,
  canWrite,
  flagsPrincipal,
  principalWriteContext,
};
