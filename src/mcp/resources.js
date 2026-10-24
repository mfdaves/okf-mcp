"use strict";

const { ResourceNotFoundError } = require("@modelcontextprotocol/server");

function canonicalResourceUri(uri) {
  try {
    return new URL(uri).href;
  } catch {
    return uri;
  }
}

function listResources(index) {
  return {
    resources: index.documents.map((doc) => ({
      uri: canonicalResourceUri(doc.uri),
      name: doc.title,
      description: doc.description || `${doc.kind} ${doc.path}`,
      mimeType: "text/markdown",
    })),
  };
}

function readResource(index, uri) {
  const doc =
    index.byUri.get(uri) ||
    index.documents.find((candidate) => canonicalResourceUri(candidate.uri) === uri);
  if (!doc) {
    throw new ResourceNotFoundError(uri);
  }
  return {
    contents: [
      {
        uri: canonicalResourceUri(doc.uri),
        mimeType: "text/markdown",
        text: doc.text,
      },
    ],
  };
}

module.exports = {
  listResources,
  readResource,
};
