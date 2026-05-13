# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **HICO namespace correction** (supersedes the change in `1b5236c`
  T1.2 and the earlier briefing). The canonical RDF namespace for HICO 2.0
  is `http://purl.org/emmedi/hico/` (Daquino's URI used in real triples),
  NOT `https://w3id.org/hico/` — that URL is only a redirect to the
  documentation page and does not belong in `@prefix hico:`. Reverted in:
  - `contexts/multimodal-context.jsonld` (`hico` prefix; context header
    comment updated to explain the difference)
  - `profiles/interim-geko/ontology.ttl` (`@prefix hico:`)
  - `profiles/interim-geko/manifest.json` (`namespaces.hico`)
  - `docs/architecture/ARCHITECTURE-v2.md` (Turtle example)
  - `CLAUDE.md` "Things to never do" entry (now positively reinforces
    `purl.org/emmedi/hico/`)
  - `PHASE-1-POSTER-DEMO.md` T1.2 acceptance criteria
  - `ontology/README.md` deprecation pointer
  - `backend/scripts/test_context_roundtrip.py` (docstring + sample IRI)
- **Provenance properties moved from HICO to PROV-O.** HICO 2.0 is built
  on top of PROV-O: `hico:InterpretationAct` is a sub-class of
  `prov:Activity`; there is no `hico:wasGeneratedBy`. Changes in
  `contexts/multimodal-context.jsonld`:
  - `wasGeneratedBy` term now resolves to `prov:wasGeneratedBy`
    (was: `hico:wasGeneratedBy`)
  - Added `Activity → prov:Activity`,
    `startedAtTime → prov:startedAtTime (xsd:dateTime)`,
    `endedAtTime → prov:endedAtTime (xsd:dateTime)`
  - Added HICO class aliases `InterpretationType`,
    `InterpretationCriterion`, plus the property `isExtractedFrom`
  - The example annotation in `ARCHITECTURE-v2.md` now uses
    `prov:wasGeneratedBy` on the annotation and
    `prov:startedAtTime` on the InterpretationAct (was `dcterms:date`),
    and declares `prov:Activity` as a second type on the act.
  This makes the briefing's recommended provenance shape (T1.4b)
  consistent with the real ontology before the round-trip test for
  T1.4 runs.
- **rdflib pin loosened** (`>=7.6.0` instead of `==7.1.1`). The previous
  pin worked on Python 3.11 (the Docker target) but `RDF.value` access
  in `rdflib/resource.py` raises `AttributeError` under Python 3.14
  (the host's pyenv default), which blocked re-running the round-trip
  validator in the local venv. 7.6.0+ works on both.

### Added
- **T1.3** — FastAPI backend gateway skeleton under `backend/app/`:
  - `app/main.py` wires CORS middleware and five route modules
  - `app/config.py` loads env vars into a frozen `Settings` dataclass and
    emits a startup WARN if `FUSEKI_ADMIN_PASSWORD` matches any of
    `{changeme, admin, password, fuseki, ""}`
  - `app/services/fuseki.py` is an async httpx client (Phase 1: `ping`
    and `graph_triple_count`)
  - `app/services/profiles.py` reads profile manifests from the filesystem
  - `app/routes/health.py` returns one of `ok | degraded | down` with
    HTTP 200 + state body (so LBs can read body without confusing
    "crashed" with "degraded"). `degraded` enumerates missing ontology
    graphs and points to the bootstrap script
  - `app/routes/profiles.py`: `GET /profiles` and `GET /profiles/{id}`
  - `app/routes/contexts.py`: `GET /contexts/{name}.jsonld` with default-
    profile aliases (`interim-geko` / `multimodal-context` / `default`)
  - `app/routes/wap.py` and `app/routes/sparql.py` are 501-stubs that
    name the implementing task (T1.4 / T2.5) in their detail field
- **T1.3** — `backend/Dockerfile` (python:3.11-slim + curl for healthchecks
  + the pinned dependency set in `backend/requirements.txt`).
- **T1.3** — `scripts/bootstrap-fuseki.sh`: idempotent ontology loader.
  Waits for `$FUSEKI_URL/$/ping`, PUTs every `profiles/<id>/ontology.ttl`
  to its named graph via the Graph Store Protocol, then verifies with a
  COUNT query. Re-runnable to re-seed mid-demo without restarting any
  container.
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
- **T1.3** — `docker-compose.yml`: image pinned to
  `secoresearch/fuseki:5.5.0` (actively maintained against Jena 5.5.0 on
  JDK 21; the stain/jena-fuseki image is on 4.x and no longer
  recommended). Admin password reads from `${FUSEKI_ADMIN_PASSWORD:-
  changeme}`. The volume mounts the secoresearch default
  `/fuseki-base/databases` so the pre-configured `ds` dataset with TDB +
  Lucene persists across `docker compose down`. The backend uses
  `depends_on: - fuseki` (started, not healthy) so it can boot and
  report `degraded` via `/health` while Fuseki finishes warming up.
  Live-verification fixes (post-commit `6af4934`):
  * `ENABLE_DATA_WRITE: "true"` added — without it the dataset's GSP
    service is `gsp-r` (read-only) and the bootstrap PUT returns
    `HTTP 405: HTTP method not allowed: PUT : Read-only`. Confirmed by
    inspecting `/docker-entrypoint.sh` of secoresearch/fuseki:5.5.0.
  * Healthcheck command switched from `curl` (not installed in the
    image) to `wget -qO-`, which IS present. Fuseki now reports
    `healthy` ~6s after start.
- **T1.3** — `.env.example`: adds `FUSEKI_DATASET=ds`,
  `FUSEKI_ADMIN_USER=admin`, `FUSEKI_ADMIN_PASSWORD=changeme` (with a
  CHANGE-BEFORE-PUBLIC-DEPLOY comment), and `FUSEKI_JVM_ARGS=-Xmx2g`.
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
