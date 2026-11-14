"use strict";

// The principal an MCP call runs for (plan I-2a):
//   { subject, actor, scopes: Set, name?, email? }
// `okf.read` is required for any call and `okf.write` for the live write
// tools and producer runs; other scope strings (such as odoo.read) gate
// tool-pack tools (src/tool-packs.js). Over stdio the principal comes from the
// flags (actor = --actor, okf.write only with --write) and also holds the
// scopes the configured tool packs declare; over HTTP it comes from the
// authentication mode (src/mcp/auth.js), or is anonymous read-only.

const READ_SCOPE = "okf.read";
const WRITE_SCOPE = "okf.write";
const KNOWN_SCOPES = Object.freeze([READ_SCOPE, WRITE_SCOPE]);
const SCOPE_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/;

function flagsPrincipal(state) {
  return {
    subject: "stdio",
    actor: state?.actor || null,
    scopes: new Set(
      (state?.allowWrite ? [READ_SCOPE, WRITE_SCOPE] : [READ_SCOPE]).concat(
        state?.toolPackScopes || [],
      ),
    ),
  };
}

function anonymousPrincipal() {
  return { subject: "anonymous", actor: null, scopes: new Set([READ_SCOPE]) };
}

function canWrite(principal) {
  return Boolean(principal?.scopes?.has(WRITE_SCOPE));
}

// What a write made for this principal hands the authoring services: its
// actor, and as git author its name and email, each when it carries one.
function principalWriteContext(principal) {
  const author = Object.assign(
    principal?.name ? { name: principal.name } : {},
    principal?.email ? { email: principal.email } : {},
  );
  return {
    ...(principal?.actor ? { actor: principal.actor } : {}),
    ...(Object.keys(author).length ? { author } : {}),
  };
}

module.exports = {
  KNOWN_SCOPES,
  READ_SCOPE,
  SCOPE_NAME,
  WRITE_SCOPE,
  anonymousPrincipal,
  canWrite,
  flagsPrincipal,
  principalWriteContext,
};
