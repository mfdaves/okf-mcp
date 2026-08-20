---
id: okf://okf-mcp/specs/attested-computation
type: OKF Data Contract
title: Attested Computation Support
description: Static OKF v0.2 computation contract interpretation and non-execution boundary.
tags: [okf, computation, attestation, safety]
relations:
  - type: depends_on
    target: okf://okf-mcp/specs/concept-format
  - type: configured_by
    target: repo://src/v02.js
  - type: configured_by
    target: repo://src/computation.js
  - type: checked_by
    target: repo://test/v02-integration.test.js
---

# Attested Computation Support

An Attested Computation declares a runtime, typed parameters, exactly one inline or file computation, an executor resource with expected receipt fields, and an attester resource. Structural readiness is separate from resolution of bundle-local artifacts, lifecycle freshness, and verification trust.

The runtime can inspect this contract, hash the sanctioned computation, check declared parameter names, and compare receipt field names. Parameter and receipt values are not returned or persisted.

No tool executes the computation, executor, or attester. External resources are not fetched on demand. Execution and actual attestation remain unsupported until a separately allowlisted adapter, sandbox, ABI, cost, credential, and receipt policy exists.
