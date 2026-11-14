"use strict";

// The SDK client's own OAuth sign-in against okf-mcp and an authorization
// server that grants exactly the requested scopes, narrowed to the user's
// rights: the scopes okf-mcp asks clients to request decide what an editor
// can do.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} = require("@modelcontextprotocol/client");

const { createHttpAuth } = require("../src/mcp/auth");
const { createMcpHttpHandler } = require("../src/mcp/http");
const { createStateAsync } = require("../src/mcp/server");
const { advertisedScopes } = require("../src/tool-packs");
const { startFakeAuthorizationServer } = require("./fake-authorization-server");

const CLIENT = { clientId: "okf-mcp-rs", clientSecret: "rs-secret" };

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-http-oauth-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "index.md"),
    ["---", 'okf_version: "0.2"', "---", "", "# OAuth", "", "- [Note](note.md)", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "note.md"),
    ["---", "type: Reference", "title: Note", "---", "", "# Note", ""].join("\n"),
  );
  return root;
}

// okf-mcp over HTTP with introspection; its public URL is the address the
// client uses, so the port is bound before the handler is built.
async function startOkfMcp(t, issuer, introspectionUrl) {
  let handler;
  const server = http.createServer((req, res) => {
    handler.handle(req, res).catch(() => res.destroy());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const publicUrl = `http://127.0.0.1:${server.address().port}/mcp`;
  const state = await createStateAsync([], {
    rootPath: makeRoot(t),
    allowWrite: true,
    actor: "process:okf-mcp",
  });
  const auth = createHttpAuth(
    { mode: "introspect", url: introspectionUrl, issuer },
    {
      publicUrl,
      env: {
        OKF_INTROSPECTION_CLIENT_ID: CLIENT.clientId,
        OKF_INTROSPECTION_CLIENT_SECRET: CLIENT.clientSecret,
      },
      scopes: advertisedScopes(state.toolPacks),
    },
  );
  handler = createMcpHttpHandler(state, {
    mcpPath: "/mcp",
    authenticate: auth.authenticate,
    routes: auth.routes,
  });
  t.after(async () => {
    await handler.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return publicUrl;
}

// An OAuth client provider keeping everything in memory; the authorization
// URL is fetched by the test instead of a browser.
class MemoryProvider {
  get redirectUrl() {
    return "http://127.0.0.1:9/callback";
  }

  get clientMetadata() {
    return {
      client_name: "okf-mcp test client",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation() {
    return this.information;
  }

  saveClientInformation(information) {
    this.information = information;
  }

  tokens() {
    return this.savedTokens;
  }

  saveTokens(tokens) {
    this.savedTokens = tokens;
  }

  redirectToAuthorization(url) {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(verifier) {
    this.verifier = verifier;
  }

  codeVerifier() {
    return this.verifier;
  }
}

async function signIn(t, url) {
  const provider = new MemoryProvider();
  const first = new Client({ name: "okf-oauth-test", version: "1" });
  await assert.rejects(
    first.connect(new StreamableHTTPClientTransport(new URL(url), { authProvider: provider })),
    (error) => error instanceof UnauthorizedError,
  );
  const approval = await fetch(provider.authorizationUrl, { redirect: "manual" });
  const code = new URL(approval.headers.get("location")).searchParams.get("code");
  const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
  await transport.finishAuth(code);
  const client = new Client({ name: "okf-oauth-test", version: "1" });
  await client.connect(transport);
  t.after(() => client.close());
  return { client, provider };
}

test("a standard MCP client signing in asks for every scope, so an editor can write", async (t) => {
  const authorization = await startFakeAuthorizationServer(CLIENT);
  t.after(() => authorization.close());
  const url = await startOkfMcp(t, authorization.issuer, authorization.introspectionUrl);

  authorization.signIn({ username: "editor", sub: "1", rights: ["okf.read", "okf.write"] });
  const editor = await signIn(t, url);
  assert.equal(authorization.requested.at(-1), "okf.read okf.write");
  assert.equal(editor.provider.savedTokens.scope, "okf.read okf.write");
  const editorTools = (await editor.client.listTools()).tools.map((tool) => tool.name);
  assert.equal(editorTools.includes("okf_apply_changes"), true);

  // The same request for a user with read rights only is narrowed by the
  // authorization server, and the write tools stay hidden.
  authorization.signIn({ username: "reader", sub: "2", rights: ["okf.read"] });
  const reader = await signIn(t, url);
  assert.equal(authorization.requested.at(-1), "okf.read okf.write");
  assert.equal(reader.provider.savedTokens.scope, "okf.read");
  const readerTools = (await reader.client.listTools()).tools.map((tool) => tool.name);
  assert.equal(readerTools.includes("okf_apply_changes"), false);
  assert.equal(readerTools.includes("search_concepts"), true);
});
