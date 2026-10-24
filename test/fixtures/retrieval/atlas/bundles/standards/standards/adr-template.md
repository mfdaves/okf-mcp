---
type: "Standard"
title: "ADR template and process"
description: "How an architecture decision record is written, numbered, reviewed and superseded."
tags: ["standard", "engineering", "adr-template"]
lang: "en"
sources:
  - id: "wiki"
    resource: "https://wiki.tessera.internal/standards/adr-template"
generated:
  at: "2025-08-10T07:00:00Z"
  by: "human:lucia.bernardi"
verified:
  by: "human:lucia.bernardi"
  at: "2026-07-12T16:00:00Z"
status: "stable"
---

# ADR template and process

Every architecturally significant decision gets an ADR numbered sequentially (ADR-NNN) in the architecture repository. Sections: Context, Decision, Consequences, Related. Status is proposed, accepted, deprecated or superseded; a superseding ADR names the one it replaces and the old one is marked, never deleted. ADRs are reviewed in the weekly architecture meeting with the CTO; a proposed ADR older than 60 days is closed as rejected. The catalog mirrors ADRs as Decision concepts with the same number.
