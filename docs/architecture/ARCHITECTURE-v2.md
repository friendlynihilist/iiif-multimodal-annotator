# Architecture v2

> The target architecture. Phase 1 implements a subset; later phases fill in the rest. This document is normative for new code: if you're about to write something that contradicts what's here, open an ADR first.

---

## High-level diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                              Browser                                │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ <multimodal-annotator>  (was: <iiif-interim-annotator>)     │   │
│  │                                                              │   │
│  │  ┌─────────┬──────────┬──────────┬──────────┐               │   │
│  │  │  Text   │Facsimile │  Image   │ SPARQL   │   panels       │   │
│  │  │  panel  │  panel   │  panel   │  panel   │                │   │
│  │  └─────────┴──────────┴──────────┴──────────┘               │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────┐               │   │
│  │  │ annotation-store.js  (HTTP client)       │               │   │
│  │  │ profile-loader.js                        │               │   │
│  │  │ connection-renderer.js                   │               │   │
│  │  └──────────────────────────────────────────┘               │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │  W3C Web Annotation Protocol (HTTP/JSON-LD)
                              │  + SPARQL 1.1 Query (HTTP)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       FastAPI Gateway                                │
│                                                                     │
│  Routes:                                                            │
│   /w3c/{container}/...   WAP CRUD                                   │
│   /sparql                SPARQL passthrough                         │
│   /profiles              Profile manifests                          │
│   /contexts/{id}.jsonld  Published contexts                         │
│   /shapes/{id}.ttl       SHACL shapes  (Phase 3+)                   │
│                                                                     │
│  Internal services:                                                 │
│   - JSON-LD ↔ RDF (pyld + rdflib)                                   │
│   - SHACL validation (pyshacl)              (Phase 3+)              │
│   - HICO provenance generator                                       │
│   - Auth (OAuth / API key)                  (Phase 3+)              │
│                                                                     │
│  Env config (.env):                                                 │
│   BASE_NS=https://w3id.org/multimodal-annotator/ns/                 │
│   DEFAULT_CREATOR_IRI=https://orcid.org/0000-0002-4115-0078         │
│   FUSEKI_URL=http://fuseki:3030/mma                                 │
│   CORS_ORIGINS=http://localhost:5173                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │  SPARQL 1.1 Query/Update Protocol
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Apache Jena Fuseki + TDB2                          │
│                                                                     │
│  Named graphs:                                                      │
│   g:ontology:interim-geko    (default-profile ontologies)           │
│   g:ontology:cidoc-crm-bare  (other profile)                        │
│   g:annotation:<iri>         (one graph per annotation)             │
│   g:provenance               (HICO InterpretationActs)              │
│   g:thesauri                 (Wikidata / AAT snapshots, Phase 3+)   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why this shape

### Why a backend at all

The v1 tool is local-only: annotations live in memory, export to JSON, load... doesn't render. This is fine for a single-user demo but breaks every collaboration scenario, every "save and resume" scenario, every "query my corpus" scenario.

For the IIIF poster + community-tool ambition, a server is necessary. The minimum viable server is: triple store + HTTP gateway.

### Why Strategy B (RDF-native), not separate annotation server + triple store

Discussed in `docs/adr/0002-rdf-native-backend.md`. Short version: the annotations already are conceptually RDF (the v1 export pretends to be JSON-LD); the ontology stack (INTERIM, GEKO, MLAO, HICO, ICON) requires RDF reasoning to be useful; keeping two systems in sync is more work than fronting one system with a WAP-shaped API.

### Why Fuseki specifically

- Open source, mature, SPARQL 1.1 fully compliant.
- Standard in DH (LINCS, ResearchSpace, Pelagios, many MPI-era projects use it).
- TDB2 backend handles small-to-medium corpora (up to tens of millions of triples) without tuning.
- Jena has a programmatic Python equivalent path via `rdflib` for the gateway-side logic.
- Free and self-hostable. GraphDB Free is a fine alternative with nicer UI; if Carlo prefers the GraphDB workbench for inspection, swap the image — the SPARQL surface is identical.

Phase 1 uses Fuseki. Future alternatives (Oxigraph for embedded use, GraphDB for reasoning-heavy workloads) are not foreclosed.

### Why FastAPI

- Python is the lingua franca for RDF tooling (`rdflib`, `pyld`, `pyshacl`, `owlrl`).
- FastAPI gives async + automatic OpenAPI docs + type-driven validation.
- It's easy to make Phase 1 work and easy to dockerise.
- Carlo is comfortable with Python.

### Why named-graph-per-annotation

- Updates and history come for free: a `PUT` is `DROP GRAPH` + `INSERT DATA`, version history is just "old graphs not dropped".
- Per-annotation deletion is a single `DROP GRAPH`.
- Per-annotation querying / authorization (Phase 3) is a single graph filter.
- It's the pattern Elucidate already uses, so it's not novel.

---

## Profile system

### What a profile is

A self-describing bundle of files that tells the tool what to look like and how to validate. The user picks one profile per session (Phase 1) or per container (Phase 3+).

### Files in a profile bundle

```
profiles/<id>/
├── manifest.json        # the schema below
├── context.jsonld       # JSON-LD context resolving all profile namespaces
├── ontology.ttl         # the RDF ontology (classes, properties, sub-class hierarchies)
├── shapes.ttl           # SHACL shapes for validating annotations (Phase 3+)
├── README.md            # human-readable description
└── examples/            # optional: example annotations in JSON-LD
    └── *.jsonld
```

### Manifest schema (Phase 1 minimum)

```json
{
  "$schema": "https://w3id.org/multimodal-annotator/profile-manifest.schema.json",
  "id": "interim-geko",
  "name": "INTERIM / GEKO Ekphrasis",
  "description": "Default profile for intermedial relations and ekphrasis research.",
  "version": "0.1.0",
  "authors": [
    { "name": "Carlo Teo Pedretti", "orcid": "..." }
  ],
  "license": "CC-BY-4.0",

  "context": "context.jsonld",
  "ontology": "ontology.ttl",
  "shapes": "shapes.ttl",

  "namespaces": {
    "interim": "https://w3id.org/interim/",
    "geko": "https://w3id.org/geko/",
    "mlao": "https://w3id.org/mlao/",
    "icon": "https://w3id.org/icon/ontology/",
    "hico": "http://purl.org/emmedi/hico/",
    "lrmoo": "http://iflastandards.info/ns/lrm/lrmoo/",
    "crm": "http://www.cidoc-crm.org/cidoc-crm/"
  },

  "entityClasses": [
    {
      "id": "lrmoo:F1_Work",
      "label": "Work",
      "description": "Distinct intellectual creation realised through expressions.",
      "applicableTo": ["image"],
      "color": null
    },
    {
      "id": "lrmoo:F2_Expression",
      "label": "Expression",
      "description": "The actualisation of a Work, e.g. a specific text.",
      "applicableTo": ["text"],
      "color": null
    },
    {
      "id": "interim:IntermedialObject",
      "label": "Intermedial Object",
      "applicableTo": ["text", "image"]
    }
  ],

  "linkingProperties": [
    {
      "id": "geko:denotation",
      "label": "Denotation",
      "description": "Direct referential link from text to image.",
      "color": "#2196F3",
      "shortcut": "D",
      "domain": "lrmoo:F2_Expression",
      "range": "lrmoo:F1_Work"
    },
    {
      "id": "geko:dynamisation",
      "label": "Dynamisation",
      "description": "Temporal / movement-based ekphrastic link.",
      "color": "#FF5722",
      "shortcut": "Y",
      "domain": "lrmoo:F2_Expression",
      "range": "lrmoo:F1_Work"
    },
    {
      "id": "geko:integration",
      "label": "Integration",
      "description": "Interpretive ekphrastic blend.",
      "color": "#9C27B0",
      "shortcut": "I",
      "domain": "lrmoo:F2_Expression",
      "range": "lrmoo:F1_Work"
    }
  ],

  "tagSchemes": [
    {
      "id": "geko:modalitiesScheme",
      "label": "Ekphrastic Modalities",
      "type": "skos:ConceptScheme"
    }
  ],

  "annotationMotivations": ["linking", "commenting", "tagging", "transcribing"],
  "panelTypes": ["text", "image", "facsimile", "sparql"],

  "annotationLevels": [
    { "id": "icon:PreiconographicalSubject", "label": "Pre-iconographical" },
    { "id": "icon:IconographicalSubject", "label": "Iconographical" },
    { "id": "icon:IconologicalSubject", "label": "Iconological" }
  ],

  "authorityServices": []
}
```

`annotationLevels` is declared in Phase 1 but only used as a UI feature in Phase 3. `authorityServices` (Wikidata, AAT, etc.) is Phase 3.

### How the frontend uses a profile

On profile load:
1. Inject `--modality-<id>` CSS variables for every `linkingProperty`.
2. Re-render the modality selector modal: one button per `linkingProperty`, label/colour/shortcut from the manifest.
3. Re-render the entity class dropdown (in the tagging / linking flows): one option per `entityClass`, filtered by the current panel's `panelType`.
4. Use the manifest's `namespaces` and `context` URL when serialising annotations.
5. When showing existing annotations whose `property` URI is not declared by the current profile, render them with a neutral grey and a "different profile" badge.

### How the backend uses a profile

1. **Out-of-band**, `scripts/bootstrap-fuseki.sh` loads every profile's `ontology.ttl` into a named graph `${BASE_NS}graphs/ontology/<id>` via the Graph Store Protocol. The script is idempotent (the GSP `PUT` semantics replace the graph) and runs against a healthy Fuseki, not at backend startup — this lets the backend come up regardless of Fuseki state and lets ops re-seed without restarts.
2. The backend's `/health` endpoint reports `degraded` (with a list of missing graphs) until every profile's ontology graph has ≥1 triple.
3. On annotation write, the gateway looks up which profile the annotation belongs to via the **`mma:profile`** predicate on the annotation (the tool-owned namespace, configurable via `BASE_NS`). Containers may also be profile-keyed.
4. (Phase 3+) Validate the annotation against the profile's `shapes.ttl` before committing.

### Tool namespace (`mma:`)

`mma:` is the namespace owned by the annotator tool itself (distinct from any profile's ontology). It carries predicates that describe how an annotation was created by *this* tool — currently just `mma:profile`, but extensible (e.g. `mma:createdWithVersion`, `mma:annotationLevel` in Phase 3).

```
mma:  https://w3id.org/multimodal-annotator/ns/
```

The base is read from the `BASE_NS` environment variable at gateway startup. Changing `BASE_NS` rebases every `mma:*` term and is the single point of edit if the canonical tool URI changes.

---

## Annotation model in RDF

A linking annotation (text → image, with GEKO denotation) under the default profile becomes:

```turtle
@prefix oa:    <http://www.w3.org/ns/oa#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix lrmoo: <http://iflastandards.info/ns/lrm/lrmoo/> .
@prefix geko:  <https://w3id.org/geko/> .
@prefix hico:  <http://purl.org/emmedi/hico/> .
@prefix prov:  <http://www.w3.org/ns/prov#> .
@prefix mma:   <https://w3id.org/multimodal-annotator/ns/> .

GRAPH <https://anno.example.org/annotations/a-2026-05-12T184200Z> {

  <a-2026-05-12T184200Z>
      a oa:Annotation ;
      oa:motivation oa:linking ;
      oa:hasBody    <a-2026-05-12T184200Z/body> ;
      oa:hasTarget  <a-2026-05-12T184200Z/target> ;
      dcterms:created "2026-05-12T18:42:00Z"^^xsd:dateTime ;
      prov:wasGeneratedBy <a-2026-05-12T184200Z/interpretation> ;
      geko:hasEkphrasticModality geko:denotation ;
      mma:profile <https://w3id.org/multimodal-annotator/profiles/interim-geko> .

  <a-2026-05-12T184200Z/body>
      a oa:TextualBody, lrmoo:F2_Expression ;
      oa:value "il turbante di seta" ;
      dcterms:format "text/plain" ;
      oa:hasSelector [
        a oa:TextPositionSelector ;
        oa:start 245 ;
        oa:end 264
      ] , [
        a oa:TextQuoteSelector ;
        oa:exact "il turbante di seta" ;
        oa:prefix "...vediamo poi " ;
        oa:suffix " che le cinge il capo..."
      ] .

  <a-2026-05-12T184200Z/target>
      a oa:SpecificResource, lrmoo:F1_Work ;
      oa:hasSource <https://iiif.europeana.eu/.../canvas/p1> ;
      oa:hasSelector [
        a oa:FragmentSelector ;
        dcterms:conformsTo <http://www.w3.org/TR/media-frags/> ;
        rdf:value "xywh=412,180,260,140"
      ] .

  <a-2026-05-12T184200Z/interpretation>
      a hico:InterpretationAct, prov:Activity ;
      hico:hasInterpretationType "ekphrasis"@en ;
      dcterms:creator <https://orcid.org/0000-0000-0000-0000> ;
      prov:startedAtTime "2026-05-12T18:42:00Z"^^xsd:dateTime .
}
```

The same content is what the frontend POSTs as JSON-LD; the gateway converts.

---

## Roundtrip rules

These are invariants the system MUST satisfy:

1. **An annotation POSTed as JSON-LD, GETted later, must expand to the same RDF triples.** This is verified by `pyld.jsonld.expand(...)` equivalence.
2. **An annotation displayed in the UI, exported, and reloaded, must reproduce the same visual state.** This is the bug we're fixing in T1.6.
3. **An annotation created under profile A and viewed under profile B must remain identifiable as "from profile A"** via the `mma:profile` predicate (tool-owned namespace `https://w3id.org/multimodal-annotator/ns/`, base configurable via `BASE_NS`).
4. **The `@context` URL referenced in any exported annotation must resolve to a stable, versioned JSON-LD context** served from the backend. No floating definitions.

---

## What's deferred

- **Authentication & multi-user**: Phase 3. Until then, single-user backend per deployment.
- **Schema Editor UI**: Phase 3. Until then, profiles are file-based.
- **SHACL enforcement**: Phase 3. Until then, shapes are declared but the gateway is permissive.
- **Memento versioning**: Phase 3. Until then, PUT replaces the named graph in place.
- **Authority service integration**: Phase 3. Until then, tags are plain strings or simple URIs.
- **Refactoring of the orchestrator file**: Phase 3 or when the file becomes a merge-conflict factory.
