# Architecture

Three layers. Browser → FastAPI gateway → Apache Jena Fuseki. Each layer
talks to the next over HTTP. No direct DB access from the frontend; no
direct triple-store access from outside the gateway.

## Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                              Browser                                │
│                                                                     │
│  <multimodal-annotator>                                             │
│    panels:   text · image · facsimile · (sparql)                    │
│    helpers:  annotation-store · iri-utils · profile loader          │
│    viewers:  OpenSeadragon · Chart.js · YASGUI                      │
│                                                                     │
│  Tabs: Annotate · Query & Analytics · Data Model · Visualization    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │  HTTP — W3C Web Annotation Protocol
                              │         (POST/GET/PUT/DELETE JSON-LD)
                              │       — SPARQL 1.1 Query passthrough
                              │       — IIIF / Wikidata directly from browser
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       FastAPI gateway                                │
│                                                                     │
│  Routes:                                                            │
│   /w3c/{container}/...               WAP CRUD                       │
│   /w3c/{container}/{id}/anchor       MLAO anchor                    │
│   /sparql                            SPARQL passthrough             │
│   /profiles, /profiles/{id}          Profile manifests              │
│   /contexts/{name}.jsonld            Published JSON-LD contexts     │
│   /health                            ok | degraded | down           │
│                                                                     │
│  Services:                                                          │
│   JSON-LD ↔ RDF round-trip (pyld + rdflib)                          │
│   HICO + PROV-O provenance generator                                │
│   ULID-based annotation IRI minting                                 │
│   httpx async client to Fuseki                                      │
│                                                                     │
│  Config (env / .env):                                               │
│   BASE_NS=https://w3id.org/multimodal-annotator/ns/                 │
│   FUSEKI_URL=http://fuseki:3030                                     │
│   FUSEKI_DATASET=ds                                                 │
│   DEFAULT_CREATOR_IRI=<orcid>                                       │
│   CORS_ORIGINS=http://localhost:5173                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │  HTTP — SPARQL 1.1 Query / Update
                              │       — Graph Store Protocol (PUT)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│             Apache Jena Fuseki 5.5.0 + TDB2                          │
│                                                                     │
│  Dataset: ds                                                        │
│  Named graphs (per the bootstrap script and the WAP routes):        │
│   <BASE_NS>graphs/ontology/<profile-id>   profile ontology          │
│   <BASE_NS>annotations/<container>/<ulid> one graph per annotation  │
└─────────────────────────────────────────────────────────────────────┘
```

The browser also talks to two external sources directly, without going
through the gateway:

- IIIF Image / Presentation API endpoints, for tile sources and canvases.
- Wikidata `wbsearchentities` API (CORS-enabled), for the MLAO anchor
  entity autocomplete.

## Why a backend

The v1 tool was local-only: annotations lived in browser memory and could
only be saved to a JSON file. That breaks collaboration, save/resume, and
any "query the corpus" workflow. The Phase 1 backend is the minimum
viable server for those: a triple store with an HTTP gateway in front.

## Why RDF-native

The annotation model is already conceptually RDF (the v1 export claimed
to be JSON-LD; the ontology stack — INTERIM, GEKO, MLAO, HICO, ICON,
LRMoo — is built on RDF). Keeping the store RDF-native means there is
one source of truth; the gateway translates JSON-LD to triples on write
and back on read. See `docs/adr/0002-rdf-native-backend.md`.

## Why Fuseki

Open source, mature, SPARQL 1.1 compliant. TDB2 handles small-to-medium
corpora without tuning. Standard in digital-humanities deployments
(LINCS, Pelagios, ResearchSpace). Free and self-hostable. The SPARQL
surface is the contract — swapping Fuseki for Oxigraph or GraphDB later
does not affect the gateway code.

## Why FastAPI

Python is the de-facto language for RDF tooling (`rdflib`, `pyld`,
`pyshacl`). FastAPI provides async + type-driven validation + an
automatic OpenAPI surface at `/docs`.

## Named graph per annotation

Every annotation lives in its own named graph keyed by the annotation
IRI. Rationale:

- `DELETE /w3c/{container}/{id}` becomes a single `DROP GRAPH`.
- `PUT` becomes `DROP GRAPH` + `INSERT DATA` in one transaction.
- `POST /anchor` (additive) uses `INSERT DATA` without touching siblings.
- The pattern is what Elucidate already uses; it is not novel.

Provenance triples and custom-entity descriptions (when an MLAO anchor
points to a user-minted entity) live in the same graph as the
annotation, so deleting the annotation cleans them up automatically.

## What is deferred

| Concern                       | Status                                  |
|-------------------------------|-----------------------------------------|
| SHACL validation              | Shapes declared in profiles, not yet enforced |
| Authentication / multi-user   | Single-user, `DEFAULT_CREATOR_IRI` from env  |
| Memento versioning            | `PUT` replaces the named graph in place |
| Authority services beyond Wikidata | Phase 3 (AAT, Getty, etc.)         |
| Reasoning (OWL / SHACL)       | Phase 3                                 |
