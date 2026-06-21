"use strict";

const http = require("http");
const { ConceptAuthoringService } = require("./authoring");
const { FileConceptStore } = require("./store");

function sendJson(res, status, value) {
  const text = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req, limit) {
  const maxBytes = limit || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body exceeds byte limit."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function requireWriteAuth(req, token) {
  if (!token) {
    throw new Error("OKF_WRITE_TOKEN is required for write endpoints.");
  }
  const header = req.headers.authorization || "";
  if (header !== `Bearer ${token}`) {
    const error = new Error("Unauthorized.");
    error.statusCode = 401;
    throw error;
  }
}

function createHttpHandler(service, options) {
  const writeToken = options && options.writeToken;
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/bundles") {
        sendJson(res, 200, service.store.getBundles().map((bundle) => ({
          id: bundle.id,
          include: bundle.include || [],
          exclude: bundle.exclude || [],
        })));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/concepts/validate") {
        sendJson(res, 200, service.validateConcept(await readBody(req)));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/concepts/suggest-path") {
        sendJson(res, 200, service.suggestConceptPath(await readBody(req)));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/proposals") {
        requireWriteAuth(req, writeToken);
        sendJson(res, 200, await service.proposeConcept(await readBody(req)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/proposals") {
        sendJson(res, 200, await service.listProposals({
          bundle: url.searchParams.get("bundle") || "",
          status: url.searchParams.get("status") || "",
        }));
        return;
      }
      const proposalMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)(?:\/(accept|reject))?$/);
      if (proposalMatch && req.method === "GET" && !proposalMatch[2]) {
        sendJson(res, 200, await service.getProposal({ proposalId: proposalMatch[1] }));
        return;
      }
      if (proposalMatch && req.method === "POST" && proposalMatch[2] === "accept") {
        requireWriteAuth(req, writeToken);
        sendJson(res, 200, await service.acceptProposal({ proposalId: proposalMatch[1] }));
        return;
      }
      if (proposalMatch && req.method === "POST" && proposalMatch[2] === "reject") {
        requireWriteAuth(req, writeToken);
        const body = await readBody(req);
        sendJson(res, 200, await service.rejectProposal({ proposalId: proposalMatch[1], reason: body.reason || "" }));
        return;
      }
      sendJson(res, 404, { error: "Not found." });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message || String(error) });
    }
  };
}

async function runHttpServer(options) {
  const config = options || {};
  const store = config.store || FileConceptStore.fromProject(config.projectPath, { proposalRoot: config.proposalRoot });
  const service = config.service || new ConceptAuthoringService(store);
  const server = http.createServer(createHttpHandler(service, { writeToken: config.writeToken }));
  const host = config.host || "127.0.0.1";
  const port = config.port === undefined || config.port === "" ? 8765 : Number(config.port);
  await new Promise((resolve) => server.listen(port, host, resolve));
  return { server, service, url: `http://${host}:${server.address().port}` };
}

module.exports = {
  createHttpHandler,
  runHttpServer,
};
