---
id: okf://okf-mcp/workflows/producer-publication
type: OKF Workflow
title: Producer Publication
description: Preview and apply workflow for publishing validated producer-owned OKF v0.2 files without overwriting user-owned content.
tags: [producer, publication, workflow, safety]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/producer-host
  - type: checked_by
    target: okf://okf-mcp/policies/authoring-safety
  - type: configured_by
    target: repo://src/producer-publisher.js
---

# Producer Publication

One configured producer owns generated paths in one local bundle. The host records that ownership in `.okf-producer.json` with the producer identity, version, bundle, sorted relative paths, and SHA-256 content digests.

Preview reads the prior manifest, rejects foreign or corrupt ownership, computes created, updated, unchanged, and stale-owned paths, and constructs the complete future graph. An existing path not owned by the manifest is a collision rather than an implicit adoption. An owned file whose current digest differs from the manifest is a manual-edit conflict. Stale removal is allowed only when the current digest still matches the previous manifest.

A producer restamps its generation time on every run, so a digest comparison alone would report the whole bundle as updated. The host compares each candidate against the published file with that stamp excluded. A source that did not change reports `unchanged`, keeps the published bytes, and leaves the manifest identical, which keeps the publication diff a statement about the source rather than about the run.

Ownership is necessary but not sufficient to destroy work. A file the host would rewrite or remove must itself carry native generation provenance, so a corrupt, hand-merged, or forged manifest cannot direct a producer at hand-authored content.

Run regenerates under the process-local writer queue. It stages candidate bytes, rechecks revisions immediately before publication, applies owned changes, removes eligible stale files, writes the next manifest last, and validates persisted state. A normal failure rolls matching operation-owned bytes back to their prior state. Concurrent replacement is preserved and reported rather than overwritten during rollback.

Directories emptied by a stale deletion are removed with their last managed file. Successful publication refreshes the server index. It does not commit or push Git state, mutate the metadata source, sample application rows, or claim that generated knowledge has been independently verified.
