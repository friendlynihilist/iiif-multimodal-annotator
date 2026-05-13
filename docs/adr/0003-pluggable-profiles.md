# ADR 0003 — Pluggable annotation profiles

**Status**: Accepted
**Date**: 2026-05-13
**Decider**: Carlo Teo Pedretti

---

## Context

The v1 tool hardcodes INTERIM/GEKO modalities and LRMoo class assignments throughout the orchestrator. The "Select Ekphrastic Modality" modal has three buttons (denotation / dynamisation / integration) baked in, with their colors, their labels, and their property URIs all literal in the JavaScript.

This is fine for the author's own research but blocks adoption by anyone with a different ontological framing:
- A CIDOC-CRM-oriented annotator wants to mark regions as `crm:E36_Visual_Item` representing `crm:E22_Human-Made_Object`, with `crm:P138_represents` as the linking property.
- An Iconclass user wants a tagging-only flow: no linking, just regions tagged with `skos:Concept` from the Iconclass thesaurus.
- An art historian working on a specific local data model wants to define their own classes and properties.

The reference tool for this kind of flexibility is ImMarkus (Simon, De Weerdt et al. 2024), which lets the user design their own data model in-browser via a Schema Editor and link annotations to configurable external authority services. ImMarkus is local-only and doesn't address cross-modal annotation; we want the same flexibility in a server-backed, multi-modal context.

## Decision

Adopt a **profile-driven architecture** in which all ontology-specific concepts (entity classes, linking properties, modality colors, annotation motivations, validation rules) are declared in a **profile manifest** that the tool loads at runtime. The tool ships with a default profile (`interim-geko`) and at least one alternative profile (Phase 1) demonstrating the system works.

A profile is a self-contained bundle of files: `manifest.json`, `context.jsonld`, `ontology.ttl`, optional `shapes.ttl`, optional `examples/`. See `ARCHITECTURE-v2.md` for the manifest schema.

Profile sources (in order of precedence to be supported):

1. **Bundled profiles** — shipped with the tool, under `profiles/`. Phase 1.
2. **Backend-hosted profiles** — uploaded to a server instance. Phase 1 (admin-only upload).
3. **User-uploaded profiles** — loaded into the browser session from a `.zip` or remote URL. Phase 3.
4. **In-browser Schema Editor** — interactive creation of profiles. Phase 3.
5. **Profile remixing / inheritance** — `extends` field in the manifest, merging multiple profiles. Phase 4 (maybe).

## Consequences

### Positive

- INTERIM/GEKO/MLAO are no longer a chokepoint for adoption. Anyone can ship a profile.
- Aligns with the FAIR principle that the tool serves the data, not the data the tool.
- Forces a clean separation in the code: rendering layer doesn't know about specific ontologies, profile layer does. This is good architecture independently of the pluggability story.
- A natural unit of academic citation: "we used the `cidoc-crm-bare` profile v0.2.1 with the Multimodal Annotator v1.0".
- Profiles can be versioned, peer-reviewed, published with DOIs.

### Negative

- The frontend code needs to be refactored: every place that mentions `geko:denotation` etc. must read from the manifest. This is a non-trivial part of Phase 1 effort.
- Profile authoring has a learning curve. Phase 3 must include real documentation for profile authors. Phase 1 can lean on file-based authoring for the few profiles we ourselves ship.
- Cross-profile annotation viewing is a new design problem: what happens when a user opens a container of annotations under a profile that doesn't declare those properties? Decision in `ARCHITECTURE-v2.md` §"How the frontend uses a profile": render in neutral grey with a badge.
- Validation across profiles requires SHACL machinery in Phase 3.

### Constraints this places on other decisions

- All UI strings and colors for ontology-specific concepts must come from a manifest, not from CSS files. **No hardcoded modality colors in `iiif-interim-annotator.js`.**
- The annotation JSON-LD `@context` is profile-specific. The export function must use the active profile's context.
- The export format must carry an `interim:profile` predicate identifying the profile under which an annotation was created. This is mandatory for round-trip semantics.

## What this does NOT mean

- Profiles are not "themes". They affect data model and validation, not just appearance.
- Profiles are not interchangeable for existing annotations. An annotation created with GEKO modalities does not become a CIDOC-CRM annotation by switching profiles in the UI.
- Profiles do not isolate annotation containers. Two annotations of different profiles can target the same canvas; they coexist.

## Inspiration / precedent

- **ImMarkus** (Simon, De Weerdt et al. 2024): Schema Editor for entity classes, properties, relationships. Pluggable authority services. Local-first.
- **Recogito** (also Rainer Simon's earlier work): vocabulary-driven annotation, custom tag schemes.
- **CIDOC-CRM Linked Art profiles**: the precedent for "ship a profile that specialises a general ontology for a specific community".
- **Pelagios profiles**: similar pattern for gazetteer use.

We are not reinventing this idea; we are adapting it to a server-backed, multi-modal, IIIF-first context.
