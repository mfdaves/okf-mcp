"use strict";

const crypto = require("crypto");
const { mimeIsText } = require("./assets");
const { conceptSignals, resolveConcept } = require("./indexer");
const { normalizeV02Signals } = require("./v02");

function requireConcept(index, uri) {
  const doc = resolveConcept(index, uri);
  if (!doc || !doc.valid || doc.reserved) {
    throw new Error(`Unknown valid OKF concept: ${uri || "<missing>"}`);
  }
  return doc;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contractEdges(index, doc) {
  return index.edges.filter((edge) => (
    edge.source === doc.uri
    && ["computation", "executor", "attester"].includes(edge.kind)
  ));
}

function targetMetadata(index, edge) {
  if (!edge) {
    return { resolved: false, resolvedAs: "missing", uri: null };
  }
  const asset = index.byAssetUri && index.byAssetUri.get(edge.target);
  if (asset) {
    const resolved = !edge.broken && (!mimeIsText(asset.mimeType) || asset.kind === "text");
    return {
      resolved,
      resolvedAs: resolved ? "asset" : "invalid_text_asset",
      uri: asset.uri,
      bundle: asset.bundle,
      path: asset.path,
      mimeType: asset.mimeType,
      bytes: asset.size,
      sha256: asset.sha256,
    };
  }
  const concept = index.byUri && index.byUri.get(edge.target);
  if (concept) {
    const resolved = !edge.broken && !concept.reserved && concept.valid;
    return {
      resolved,
      resolvedAs: resolved ? "concept" : "invalid_concept",
      uri: concept.uri,
      bundle: concept.bundle,
      path: concept.path,
      mimeType: "text/markdown",
      bytes: Buffer.byteLength(concept.text, "utf8"),
      sha256: sha256(concept.text),
    };
  }
  return {
    resolved: !edge.broken && ["asset", "concept"].includes(edge.resolvedAs),
    resolvedAs: edge.resolvedAs || (edge.external ? "external" : "unresolved"),
    uri: edge.target,
    externalDeclared: Boolean(edge.external),
  };
}

function signalsFor(index, doc, asOf) {
  if (!asOf) {
    return doc.signals;
  }
  const normalized = normalizeV02Signals(doc, { asOf });
  if (normalized.computation && doc.signals && doc.signals.computation) {
    normalized.computation.structuralReady = normalized.computation.ready;
    normalized.computation.assetsReady = doc.signals.computation.assetsReady;
    normalized.computation.attestationReady = Boolean(
      normalized.computation.structuralReady && normalized.computation.assetsReady,
    );
    normalized.computation.ready = normalized.computation.attestationReady;
  }
  return normalized;
}

function inspectAttestedComputation(index, uri, options) {
  const config = options || {};
  const doc = requireConcept(index, uri);
  const signals = signalsFor(index, doc, config.asOf);
  const contract = signals && signals.computation;
  if (!contract) {
    throw new Error(`Concept is not an Attested Computation: ${doc.uri}`);
  }
  const edges = contractEdges(index, doc);
  const computationEdge = edges.find((edge) => edge.kind === "computation");
  const executorEdge = edges.find((edge) => edge.kind === "executor");
  const attesterEdge = edges.find((edge) => edge.kind === "attester");
  let computation;
  if (contract.computation && contract.computation.mode === "inline") {
    const content = contract.computation.content || "";
    const bytes = Buffer.byteLength(content, "utf8");
    const maxContentBytes = Number(config.maxContentBytes || 65536);
    computation = {
      mode: "inline",
      language: contract.computation.language || "",
      resolved: true,
      bytes,
      sha256: sha256(content),
      contentIncluded: Boolean(config.includeComputation && bytes <= maxContentBytes),
      ...(config.includeComputation && bytes <= maxContentBytes ? { content } : {}),
    };
  } else {
    computation = Object.assign({
      mode: contract.computation && contract.computation.mode || "missing",
      resource: contract.computation && contract.computation.path || null,
      contentIncluded: false,
    }, targetMetadata(index, computationEdge));
    if (config.includeComputation && computation.resolvedAs === "asset") {
      const asset = index.byAssetUri.get(computation.uri);
      const maxContentBytes = Number(config.maxContentBytes || 65536);
      if (asset.kind === "text" && asset.size <= maxContentBytes) {
        computation.content = asset.text;
        computation.contentIncluded = true;
      }
    }
  }
  const executor = Object.assign({
    resource: contract.executor && contract.executor.resource || null,
    receiptFields: contract.executor && contract.executor.receipt || [],
  }, targetMetadata(index, executorEdge));
  const attester = Object.assign({
    resource: contract.attester && contract.attester.resource || null,
  }, targetMetadata(index, attesterEdge));
  const assetDiagnostics = (index.warnings || []).filter((entry) => (
    entry.bundle === doc.bundle
    && entry.path === doc.path
    && String(entry.code || "").startsWith("asset_")
  ));
  return {
    uri: doc.uri,
    requestedUri: uri,
    runtime: contract.runtime,
    parameters: contract.parameters || [],
    computation,
    executor,
    attester,
    signals: conceptSignals(Object.assign({}, doc, { signals }), false),
    readiness: {
      structuralContractValid: Boolean(contract.structuralReady),
      assetsResolved: Boolean(contract.assetsReady),
      attestationReady: Boolean(contract.attestationReady),
    },
    capabilities: {
      execution: "not_supported",
      attestation: "not_supported",
    },
    diagnostics: (signals.diagnostics || []).concat(assetDiagnostics),
  };
}

function prepareAttestedComputation(index, uri, parameters, options) {
  const inspection = inspectAttestedComputation(index, uri, options);
  if (!inspection.readiness.attestationReady) {
    throw new Error("Attested Computation is not statically ready.");
  }
  if (!inspection.computation.sha256) {
    throw new Error("Attested Computation has no statically verified computation digest.");
  }
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new Error("parameters must be an object keyed by declared parameter name.");
  }
  const declared = inspection.parameters || [];
  const declaredNames = declared.map((entry) => entry.name);
  const presentNames = Object.keys(parameters).sort();
  const missing = declared.filter((entry) => entry.required && !Object.prototype.hasOwnProperty.call(parameters, entry.name)).map((entry) => entry.name);
  const unexpected = presentNames.filter((name) => !declaredNames.includes(name));
  if (missing.length || unexpected.length) {
    throw new Error(`Parameter contract mismatch (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`);
  }
  return {
    prepared: true,
    uri: inspection.uri,
    runtime: inspection.runtime,
    parameterNames: presentNames,
    parameterDigest: sha256(stableJson(parameters)),
    computationDigest: inspection.computation.sha256 || null,
    expectedReceiptFields: inspection.executor.receiptFields,
    lifecycle: {
      status: inspection.signals.status,
      freshness: inspection.signals.freshness,
      asOf: inspection.signals.asOf,
    },
    executionPerformed: false,
    valuesReturned: false,
  };
}

function checkComputationReceipt(index, uri, receipt) {
  const inspection = inspectAttestedComputation(index, uri);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("receipt must be an object.");
  }
  const expectedFields = inspection.executor.receiptFields || [];
  const presentFields = Object.keys(receipt).sort();
  const missingFields = expectedFields.filter((field) => !Object.prototype.hasOwnProperty.call(receipt, field));
  const unexpectedFields = presentFields.filter((field) => !expectedFields.includes(field));
  return {
    uri: inspection.uri,
    shapeComplete: missingFields.length === 0 && unexpectedFields.length === 0,
    expectedFields,
    presentFields,
    missingFields,
    unexpectedFields,
    attestationPerformed: false,
    receiptPersisted: false,
    valuesReturned: false,
  };
}

function readBundleAsset(index, input) {
  const args = input || {};
  const asset = args.uri
    ? index.byAssetUri && index.byAssetUri.get(args.uri)
    : index.byAssetKey && index.byAssetKey.get(`${args.bundle}\u0000${String(args.path || "").replace(/\\/g, "/")}`);
  if (!asset) {
    throw new Error("Unknown or unreferenced bundle asset.");
  }
  const maxContentBytes = Number(args.maxContentBytes || 65536);
  if (!Number.isSafeInteger(maxContentBytes) || maxContentBytes < 1 || maxContentBytes > 1024 * 1024) {
    throw new Error("maxContentBytes must be between 1 and 1048576.");
  }
  if (asset.size > maxContentBytes) {
    throw new Error(`Asset exceeds requested content limit of ${maxContentBytes} bytes.`);
  }
  let content;
  let contentEncoding;
  if (asset.kind === "text") {
    content = asset.text;
    contentEncoding = "utf-8";
  } else if (asset.base64) {
    content = asset.base64;
    contentEncoding = "base64";
  } else if (asset._contentBytes) {
    const bytes = asset._contentBytes;
    if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) {
      throw new Error("Indexed asset content does not match its recorded digest.");
    }
    content = bytes.toString("base64");
    contentEncoding = "base64";
  } else {
    throw new Error("Indexed asset content is unavailable.");
  }
  return {
    uri: asset.uri,
    bundle: asset.bundle,
    path: asset.path,
    mimeType: asset.mimeType,
    size: asset.size,
    sha256: asset.sha256,
    kind: asset.kind,
    contentEncoding,
    content,
    referencedBy: asset.referencedBy || [],
    remote: Boolean(asset.remote),
  };
}

function getProvenance(index, uri, options) {
  const config = options || {};
  const root = requireConcept(index, uri);
  const maxDepth = Math.max(0, Math.min(Number(config.maxDepth === undefined ? 3 : config.maxDepth), 10));
  const maxNodes = Math.max(1, Math.min(Number(config.maxNodes || 100), 1000));
  const includeExternal = config.includeExternal === true;
  const nodes = [];
  const edges = [];
  const cycles = [];
  const unresolved = [];
  const seen = new Set();
  const queue = [{ uri: root.uri, depth: 0, ancestry: [root.uri] }];
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current.uri)) {
      continue;
    }
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    seen.add(current.uri);
    const doc = index.byUri.get(current.uri);
    nodes.push({
      id: doc.uri,
      kind: "concept",
      bundle: doc.bundle,
      path: doc.path,
      title: doc.title,
      signals: conceptSignals(doc, false),
    });
    if (current.depth >= maxDepth) {
      continue;
    }
    index.edges.filter((edge) => edge.source === doc.uri && edge.kind === "source").forEach((edge) => {
      const targetDoc = index.byUri.get(edge.target);
      const targetAsset = index.byAssetUri && index.byAssetUri.get(edge.target);
      if (targetDoc) {
        edges.push(edge);
        if (current.ancestry.includes(targetDoc.uri)) {
          cycles.push(current.ancestry.concat(targetDoc.uri));
        } else {
          queue.push({ uri: targetDoc.uri, depth: current.depth + 1, ancestry: current.ancestry.concat(targetDoc.uri) });
        }
      } else if (targetAsset) {
        edges.push(edge);
        if (!seen.has(targetAsset.uri) && nodes.length < maxNodes) {
          seen.add(targetAsset.uri);
          nodes.push({
            id: targetAsset.uri,
            kind: "asset",
            bundle: targetAsset.bundle,
            path: targetAsset.path,
            mimeType: targetAsset.mimeType,
            size: targetAsset.size,
            sha256: targetAsset.sha256,
          });
        }
      } else if (edge.external || edge.resolvedAs === "opaque") {
        if (includeExternal) {
          edges.push(edge);
          if (!seen.has(edge.target) && nodes.length < maxNodes) {
            seen.add(edge.target);
            nodes.push({ id: edge.target, kind: edge.resolvedAs === "opaque" ? "opaque" : "external" });
          }
        }
      } else {
        unresolved.push({ source: edge.source, resource: edge.reference, field: edge.field });
      }
    });
  }
  return {
    root: root.uri,
    requestedUri: uri,
    nodes,
    edges,
    cycles,
    unresolved,
    truncated,
    externalFetched: false,
  };
}

module.exports = {
  checkComputationReceipt,
  getProvenance,
  inspectAttestedComputation,
  prepareAttestedComputation,
  readBundleAsset,
  requireConcept,
};
