---
id: okf://okf-mcp/workflows/v02-migration
type: OKF Workflow
title: OKF v0.2 Migration
description: Review-only compatibility migration for existing v0.1 and mixed knowledge catalogs.
tags: [okf, migration, proposals, compatibility]
relations:
  - type: depends_on
    target: okf://okf-mcp/runtime/file-concept-store
  - type: checked_by
    target: okf://okf-mcp/policies/authoring-safety
  - type: configured_by
    target: repo://src/migration.js
  - type: checked_by
    target: repo://test/migration.test.js
---

# OKF v0.2 Migration

The read-only checker classifies a bundle as v0.1, mixed, v0.2, undeclared, or blocked. It inventories legacy timestamps and citations, truthful actor-mapping needs, generated files, identity collisions, referenced assets, and version-declaration readiness.

The migration adds native fields without removing legacy content. A timestamp becomes `generated.at` only with a confirmed truthful `generated.by`; unambiguous citations become minimal `sources`. Native fields win and generated files are changed at their generator. A manifest and per-file proposals require review and explicit acceptance.

The root version proposal depends on accepted child proposals and complete catalog validation.
