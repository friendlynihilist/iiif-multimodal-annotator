# ADR 0002 — RDF-native backend (Strategy B)

**Status**: Accepted
**Date**: 2026-05-13
**Decider**: Carlo Teo Pedretti

---

## Context

The v1 tool stores annotations in memory and exports them as JSON-LD. It has no backend. For the IIIF poster, the JOCCH submission, and the community-tool ambition, persistence is required. There were three architectural options on the table:

- **Strategy A**: Add a W3C-compliant annotation server (Elucidate, AnnoRepo, miiify, or SAS) as primary persistence. Add a separate triple store (Fuseki) for the ontological knowledge graph. Sync annotations from the annotation server into the triple store on writes.
- **Strategy B**: Use a triple store as primary persistence. Each annotation is a named graph. Front the triple store with a FastAPI gateway that speaks W3C Web Annotation Protocol on its public surface and SPARQL Update on its private surface.
- **Strategy C**: Use SAS (the only existing annotation server that already runs on Jena). Get the SPARQL endpoint for free.

## Decision

Adopt **Strategy B**.

## Rationale

### Why not Strategy A

Strategy A is the conservative DH-standard architecture. Its problems for this project:

- The ontologies in the default profile (INTERIM, GEKO, MLAO, HICO, ICON) are not decoration on top of plain W3C annotations — they are the substance of the annotations. Querying for "all ekphrastic relations with denotation modality where the source expression was created by author X" requires RDF reasoning across the ontology graph and the annotation graph in a single SPARQL query. Two separate stores with periodic sync produces inevitable drift.
- Two systems mean two ops surfaces, two auth surfaces, two backup surfaces. For a research tool, that is overhead without payoff.
- HICO provenance ties every annotation to an `hico:InterpretationAct`, and these acts are themselves first-class entities that researchers will want to query. They belong in the same graph as the annotations.

### Why not Strategy C

SAS is a fine tool. Two specific issues:

- SAS is opinionated about its workflow (Mirador-centric, collection management built in). For a custom frontend with multi-panel cross-modal interaction, we'd fight more than we'd benefit.
- SAS's data model isn't ours. Adapting it to carry MLAO levels, HICO provenance, and arbitrary profile-specific properties would mean modifying SAS — at which point we're maintaining a fork of someone else's project.

### Why Strategy B works

- One system, one source of truth.
- The W3C Web Annotation Protocol is well-defined enough that translating its CRUD into SPARQL Update is mechanical, not creative work.
- Named graphs per annotation give us: per-annotation versioning (free), per-annotation auth (Phase 3), per-annotation deletion as a single `DROP GRAPH`.
- Reasoning, SHACL validation, federated queries with other LOD sources — all available because we're already RDF-native.
- We can still publish a W3C-compliant API surface, so anyone who wants to use the data with Mirador or another IIIF tool can do so.

## Consequences

### Positive

- Single source of truth.
- RDF-native from day one — no triplification pipeline to maintain.
- SPARQL is a first-class user feature (the SPARQL panel), not a backend-only convenience.
- HICO provenance is "free": just more triples in the same graph.
- Aligns with the LOD / Linked Pasts community direction.

### Negative

- We are writing the WAP→SPARQL gateway ourselves. Code we'd otherwise inherit from Elucidate / AnnoRepo. Mitigated by: it's not very much code, and it's the part we want full control over.
- Triple stores are slower than purpose-built annotation servers on pure-CRUD workloads. For research-corpus sizes (tens of thousands of annotations, max), this is irrelevant. If we ever cross a million annotations, revisit.
- SPARQL skill is required to debug. Not a serious problem for the author or for likely contributors.

## Implementation notes

- Use Apache Jena Fuseki with TDB2 backend for Phase 1. Decision can be revisited if reasoning needs grow (then GraphDB) or if Java-free deployment is wanted (then Oxigraph).
- Use FastAPI for the gateway. `rdflib` for RDF manipulation, `pyld` for JSON-LD round-tripping, `pyshacl` for validation (Phase 3+).
- The gateway exposes:
  - `/w3c/{container}/...` — Web Annotation Protocol surface
  - `/sparql` — SPARQL 1.1 Query (Phase 1 public, Phase 3 maybe authed)
  - `/sparql/update` — SPARQL 1.1 Update (Phase 1 public, Phase 3 admin-only)
  - `/profiles/...` — profile manifests and contexts
- One annotation = one named graph, named after the annotation IRI.
- The ontology of each profile lives in its own named graph (`g:ontology:<profile-id>`).
- HICO `InterpretationAct` resources live in the same graph as the annotation they describe.

## Reversibility

Strategy B is not irreversible. If at some point we want to add an annotation server in front (e.g. for compatibility with a specific community tool), we can: the SPARQL store remains as the single source of truth and the annotation server becomes a cache + a different API surface. The reverse migration is harder (from A to B), so starting at B is the lower-regret choice.
