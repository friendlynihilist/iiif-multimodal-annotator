# ADR 0001 — Rebrand to "Multimodal Annotator"

**Status**: Accepted
**Date**: 2026-05-13
**Decider**: Carlo Teo Pedretti

---

## Context

The tool is currently named "IIIF INTERIM Annotator". This name implies:
- The tool is *the* annotator for the INTERIM ontology specifically.
- Users who don't subscribe to INTERIM/GEKO would need a different tool.
- The tool is opinionated about ekphrasis as its use case.

The author wants the tool to become a community resource for researchers and art historians who may want to annotate using their own ontologies (CIDOC-CRM, Iconclass, custom schemas), in the spirit of ImMarkus. INTERIM/GEKO/MLAO should remain as the *default* profile shipped with the tool, but not as the identity of the tool.

The author also wants to support single-medium use: a user who only wants to annotate text, or only an image, should be served — not just the cross-modal case.

## Decision

Rename the tool to **Multimodal Annotator** (working title; potentially shortened to MMA).

Specifically:
- The repository will move from `iiif-interim-annotator` to `multimodal-annotator`.
- The npm package and CLI commands change accordingly.
- The custom HTML element renames from `<iiif-interim-annotator>` to `<multimodal-annotator>` over the course of Phase 1, with a deprecation alias kept until the JOCCH submission.
- `INTERIM` becomes the identifier of the default profile (`profiles/interim-geko/`), not of the tool.

## Consequences

### Positive

- Honest positioning: a generic multimodal IIIF annotator that ships with INTERIM as one example use case.
- Lowers the barrier for adoption by researchers who don't share the INTERIM/GEKO framing.
- Aligns with the planned profile system (ADR 0003): if profiles are first-class, the tool can't be named after one of them.
- Future-proofs the JOCCH paper, which presents MLAO + the annotator as separable contributions.

### Negative

- Existing citations of "INTERIM Annotator" become slightly stale. The repo's old URL should redirect.
- Some inertia: 2944 lines of orchestrator code currently use `iiif-interim-annotator` in CSS, file names, and event types. Mechanical rename only; not a blocker.
- The author's published work (thesis, papers) refers to "INTERIM Annotator" by name. Document the rename clearly in the README and add a "previously known as" note.

### Migration

- **Phase 1**: The new name appears in README, package.json, and as a deprecation alias for the custom element. The element itself still works under its old tag for the demo.
- **Phase 3**: Hard rename. Old tag removed.

## Naming rationale

"Multimodal Annotator" is descriptive, accurate, and Google-able. It clearly separates the tool from the ontology stack it ships with. If a more evocative name (Polyphon, etc.) is preferred later, find-replace is mechanical because we're consistent now.
