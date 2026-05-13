# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **T1.2** — `backend/scripts/test_context_roundtrip.py`: pyld + rdflib
  driven round-trip validator for the default profile's JSON-LD context.
  Four samples cover every emission shape of the v1 frontend (ekphrastic
  linking, transcribing, standalone comment, HICO+MLAO+ICON provenance);
  all expand cleanly to RDF with no dropped terms. The script will be
  promoted into `backend/app/tests/` when T1.3 lands.
- `backend/` directory (placeholder; FastAPI scaffolding lands in T1.3).
- `profiles/` directory with the first profile bundle: `profiles/interim-geko/`
  containing `manifest.json` (new), `ontology.ttl` (moved from `ontology/`),
  and `model-interim.jpg` (moved; renamed to remove the space).
- `docker-compose.yml` stub orchestrating `fuseki` (port 3030) and `backend`
  (port 8000).
- `.env.example` with `BASE_NS`, `DEFAULT_CREATOR_IRI`, `FUSEKI_URL`,
  `CORS_ORIGINS`.
- `CHANGELOG.md` (this file).
- v2 planning bundle (already on `main`): `CLAUDE.md`, `ROADMAP.md`,
  `PHASE-1-POSTER-DEMO.md`, `HANDOFF.md`, three ADRs under `docs/adr/`, the
  v2 architecture document under `docs/architecture/`, and the seed JSON-LD
  context under `contexts/`.
- `PROJECT-OVERVIEW.md` (v1 code tour, with a deprecation header).
- Primary custom element tag: `<multimodal-annotator>`.
- Tool-owned namespace `mma:` (`https://w3id.org/multimodal-annotator/ns/`,
  configurable via `BASE_NS`). The `mma:profile` predicate replaces the
  legacy `interim:profile` placeholder on every exported triple.

### Changed
- **T1.2** — `contexts/multimodal-context.jsonld`: removed in-context
  `_comment_*` keys (they are not valid JSON-LD term definitions and
  caused pyld to fail expansion). Added `dctypes:` prefix and the W3C
  resource types `Image / Text / Video / Audio / Dataset / Software`.
  Added the full OA motivation vocabulary as context terms (`linking`,
  `commenting`, `tagging`, `transcribing`, plus the rest from
  anno.jsonld) and `painting` (IIIF). Added context entries for every
  non-standard v1 field so they round-trip without loss: `class →
  rdf:type`, `property → geko:hasEkphrasticModality`, `modality →
  geko:hasEkphrasticModality (@vocab)`, `canvasId/canvasIndex/
  canvasLabel/lineId/coords/pageNr/annotationType → mma:*`.
- **T1.2** — `src/components/multimodal-annotator.js`: the
  `modalityProperty` map now emits `https://w3id.org/geko/...` instead
  of `http://w3id.org/geko/...`, aligning with the canonical w3id.org
  namespace and removing a duplicate `geko:hasEkphrasticModality`
  triple in the round-trip output.
- **Repository renamed**: `iiif-interim-annotator` → `iiif-multimodal-annotator`
  (the IIIF prefix retained for discoverability; supersedes ADR 0001's
  bare `multimodal-annotator` proposal).
- **Package renamed**: `iiif-interim-annotator` → `iiif-multimodal-annotator`
  in `package.json`. Version bumped to `0.2.0-dev`.
- **Main component file renamed**: `src/components/iiif-interim-annotator.js`
  → `src/components/multimodal-annotator.js` (preserved git history via
  `git mv`).
- **HICO namespace corrected** everywhere from `http://purl.org/emmedi/hico/`
  to `https://w3id.org/hico/` (in the `@context`, in the moved ontology,
  in architecture docs).
- Demo HTML (`examples/index.html`) uses `<multimodal-annotator>` and the
  page title is "Multimodal Annotator — Demo".
- `src/index.js` exports the orchestrator under both `IIIFInterimAnnotator`
  (legacy) and `MultimodalAnnotator` (new).
- `contexts/multimodal-context.jsonld` adds `mma:` and changes `profile`
  to resolve to `mma:profile`. Comment header updated to mark namespaces
  verified.

### Deprecated
- Custom element tag `<iiif-interim-annotator>` is now a subclass alias of
  `<multimodal-annotator>` and emits a `console.warn` on construction. It
  will be removed in Phase 3 (ADR 0001).
- `ontology/` directory: empty after the move, kept only as a pointer
  (`ontology/README.md`) until Phase 3.

### Removed
- (nothing yet)

### Internal
- Phase 1 rename is intentionally partial. CSS variables (e.g.
  `--color-black`), CSS class names, custom event names, and the internal
  JS class name `IIIFInterimAnnotator` are unchanged in v0.2.x and will
  be touched in Phase 3.

## [0.1.0] — 2026 (v1, pre-rebrand)

The pre-rebrand v1 codebase as it was when this CHANGELOG was introduced.
See `git log` for the granular history; commit `fc412c2` is the first
commit after history rewrite (see `HANDOFF.md`).
