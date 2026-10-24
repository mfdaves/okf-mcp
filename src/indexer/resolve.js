"use strict";

const path = require("node:path");
const { normalizeSlashes } = require("../parser");

function portableConceptKeys(value) {
  const normalized = normalizeSlashes(String(value || ""))
    .replace(/^\/+/, "")
    .split("#")[0];
  if (!normalized) return [];
  return normalized.toLowerCase().endsWith(".md")
    ? [normalized, normalized.slice(0, -3)]
    : [normalized, `${normalized}.md`];
}

function portableConceptMatches(index, value) {
  for (const key of portableConceptKeys(value)) {
    const matches = (index.documents || []).filter(
      (doc) => doc.conceptId === key || doc.path === key,
    );
    if (matches.length) {
      return matches.sort((left, right) => left.uri.localeCompare(right.uri));
    }
  }
  return [];
}

function resolveConcept(index, locator) {
  const raw = String(locator || "").trim();
  if (!raw || !index) {
    return null;
  }
  const fragmentless = normalizeSlashes(raw).split("#")[0];
  const byUri = index.byUri && (index.byUri.get(raw) || index.byUri.get(fragmentless));
  if (byUri) {
    return byUri;
  }
  if (
    (index.ambiguousAliases || new Set()).has(raw) ||
    (index.ambiguousAliases || new Set()).has(fragmentless)
  ) {
    return null;
  }
  const uriMatch = fragmentless.match(/^okf:\/\/([^/]+)\/(.+)$/);
  if (fragmentless.startsWith("okf://")) {
    if (!uriMatch || (index.bundles || []).some((bundle) => bundle.id === uriMatch[1])) {
      return null;
    }
  }
  for (const key of portableConceptKeys(
    uriMatch ? `${uriMatch[1]}/${uriMatch[2]}` : fragmentless,
  )) {
    if ((index.ambiguousConceptIds || new Set()).has(key)) return null;
    const owner = index.byConceptId?.get(key);
    if (owner) return owner;
  }
  return null;
}

function normalizeConceptTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function conceptTitleSlug(value) {
  return normalizeConceptTitle(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function conceptIsGeneratedFile(doc) {
  const frontmatter = doc?.frontmatter || {};
  return Boolean(
    (doc && (doc.generatedFile === true || doc.isGenerated === true)) ||
      frontmatter.generated_file === true ||
      frontmatter.generatedFile === true,
  );
}

function conceptMatchSummary(doc, matchReasons) {
  const generated = doc?.signals?.generated;
  return {
    uri: doc.uri,
    bundle: doc.bundle,
    path: doc.path,
    conceptId: doc.conceptId || doc.path.replace(/\.md$/i, ""),
    type: doc.type || doc.frontmatter?.type,
    title: doc.title,
    generatedBy: generated?.by || null,
    ...(conceptIsGeneratedFile(doc) ? { generatedFile: true } : {}),
    ...(matchReasons?.length ? { matchReasons } : {}),
  };
}

function findConceptMatches(index, options) {
  const config = options || {};
  const title = config.title === undefined ? null : normalizeConceptTitle(config.title);
  const prefix = normalizeSlashes(String(config.pathPrefix || "")).replace(/^\/+|\/+$/g, "");
  const documents =
    index && Array.isArray(index.concepts)
      ? index.concepts
      : index && Array.isArray(index.documents)
        ? index.documents
        : [];
  return documents
    .filter(
      (doc) =>
        doc &&
        doc.valid !== false &&
        !doc.reserved &&
        typeof doc.path === "string" &&
        (!config.bundle || doc.bundle === config.bundle) &&
        (!config.type || doc.type === config.type) &&
        (title === null || normalizeConceptTitle(doc.title) === title) &&
        (!prefix || doc.path === prefix || doc.path.startsWith(`${prefix}/`)),
    )
    .sort(
      (left, right) => left.path.localeCompare(right.path) || left.uri.localeCompare(right.uri),
    );
}

function recoveryReceipt(locator, entries, limit, allowRetry, forcedAmbiguity) {
  const maximum = Math.max(1, Math.min(Number(limit || 5), 20));
  const candidates = entries
    .slice(0, maximum)
    .map((entry) => conceptMatchSummary(entry.doc, entry.reasons));
  const actionable = entries.length === 1 && entries[0].doc.valid && !entries[0].doc.reserved;
  return {
    status:
      forcedAmbiguity || entries.length > 1
        ? "ambiguous"
        : actionable
          ? "replacement_found"
          : "not_found",
    requestedLocator: locator,
    candidates,
    omitted: Math.max(0, entries.length - candidates.length),
    ...(allowRetry && !forcedAmbiguity && actionable
      ? { retryWith: { uri: entries[0].doc.uri } }
      : {}),
  };
}

function recoverConceptLocator(index, locator, options) {
  const config = options || {};
  const raw = normalizeSlashes(String(locator || "").trim()).split("#")[0];
  const uriMatch = raw.match(/^okf:\/\/([^/]+)\/(.+)$/);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw) && !uriMatch) {
    return { status: "not_found", requestedLocator: raw, candidates: [], omitted: 0 };
  }
  const knownBundle = uriMatch && (index.bundles || []).some((entry) => entry.id === uriMatch[1]);
  const bundle = knownBundle ? uriMatch[1] : config.bundle || "";
  const portablePath = (
    uriMatch && knownBundle ? uriMatch[2] : raw.replace(/^okf:\/\//, "")
  ).replace(/^\/+/, "");
  const aliasOwners = (index.documents || [])
    .filter(
      (doc) =>
        (index.ambiguousAliases || new Set()).has(raw) && (doc.uriAliases || []).includes(raw),
    )
    .sort((left, right) => left.uri.localeCompare(right.uri));
  const exact = aliasOwners.length
    ? aliasOwners
    : knownBundle
      ? []
      : portableConceptMatches(index, portablePath);
  if (exact.length) {
    const portableAmbiguous = portableConceptKeys(portablePath).some((key) =>
      (index.ambiguousConceptIds || new Set()).has(key),
    );
    return recoveryReceipt(
      raw,
      exact.map((doc) => ({
        doc,
        reasons: [aliasOwners.length ? "uri_alias" : "portable_id"],
      })),
      config.limit,
      !aliasOwners.length && !portableAmbiguous,
      aliasOwners.length > 0 || portableAmbiguous,
    );
  }
  const requestedPath = portablePath.replace(/\.md$/i, "");
  const requestedBase = path.posix.basename(requestedPath).toLowerCase();
  const requestedSlug = conceptTitleSlug(requestedBase);
  const ranked = [];
  if (!requestedSlug) return recoveryReceipt(raw, [], config.limit, false);
  findConceptMatches(index, { bundle }).forEach((doc) => {
    const base = path.posix.basename(doc.conceptId || doc.path.replace(/\.md$/i, "")).toLowerCase();
    const reasons = [];
    if (base === requestedBase) reasons.push("path_basename");
    if (conceptTitleSlug(doc.title) === requestedSlug) reasons.push("title_slug");
    if ((doc.aliases || []).some((alias) => conceptTitleSlug(alias) === requestedSlug))
      reasons.push("alias");
    if (!reasons.length) return;
    ranked.push({
      doc,
      reasons,
      score:
        (reasons.includes("path_basename") ? 4 : 0) +
        (reasons.includes("title_slug") ? 2 : 0) +
        (reasons.includes("alias") ? 1 : 0),
    });
  });
  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.doc.path.localeCompare(right.doc.path) ||
      left.doc.uri.localeCompare(right.doc.uri),
  );
  return recoveryReceipt(raw, ranked, config.limit, true);
}

function conceptSignals(doc, detailed) {
  const signals = doc.signals || {};
  const computation = signals.computation;
  const output = {
    status: signals.status,
    staleAfter: signals.staleAfter,
    freshness: signals.freshness,
    asOf: signals.asOf,
    trustTier: signals.trustTier,
    sourceCount: Array.isArray(signals.sources) ? signals.sources.length : 0,
    hasSources: Array.isArray(signals.sources) && signals.sources.length > 0,
    sourcesOrigin: signals.sourcesOrigin,
    generated: signals.generated,
    generatedOrigin: signals.generatedOrigin,
    computation: computation
      ? {
          runtime: computation.runtime,
          // The computation block is null when the contract has no usable
          // source; the summary keeps that null rather than dropping the key.
          mode: computation.computation ? computation.computation.mode : null,
          attestationReady: Boolean(computation.attestationReady),
          structuralReady: Boolean(computation.structuralReady),
          assetsReady: Boolean(computation.assetsReady),
        }
      : null,
  };
  if (detailed) {
    output.resource = signals.resource;
    output.sources = signals.sources || [];
    output.usageWindow = signals.usageWindow;
    output.verifiedEvents = signals.verifiedEvents || [];
    output.diagnostics = signals.diagnostics || [];
    if (computation) {
      output.computation = Object.assign({}, computation);
    }
  }
  return output;
}

function conceptSummary(doc) {
  return {
    uri: doc.uri,
    bundle: doc.bundle,
    path: doc.path,
    pathUri: doc.pathUri,
    conceptId: doc.conceptId,
    uriAliases: doc.uriAliases || [],
    type: doc.type,
    title: doc.title,
    description: doc.description,
    tags: doc.tags,
    aliases: doc.aliases,
    signals: conceptSignals(doc, false),
  };
}

module.exports = {
  conceptIsGeneratedFile,
  conceptMatchSummary,
  conceptSignals,
  conceptSummary,
  findConceptMatches,
  normalizeConceptTitle,
  portableConceptKeys,
  recoverConceptLocator,
  resolveConcept,
};
