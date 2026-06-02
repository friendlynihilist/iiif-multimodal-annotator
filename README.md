# Multimodal Annotator

A research prototype for semantic annotation across text and image. Users open
text sources (plain text, TEI, PAGE-XML) alongside IIIF image resources, then
link text spans to image regions under a typed ekphrastic relation. The
linked structure is stored as W3C Web Annotations in RDF. The ontology stack
is pluggable per project; the default profile is INTERIM (ekphrasis research).

## Stack

The frontend is a small Vite app made of vanilla Web Components — no
framework dependency, on purpose. OpenSeadragon handles IIIF tile sources;
Chart.js draws the visualisation tab.

The gateway is a FastAPI service in Python. It converts JSON-LD to RDF on
write and back on read, and exposes the W3C Web Annotation Protocol plus a
SPARQL passthrough for the in-browser query panel.

Storage is Apache Jena Fuseki with the TDB2 backend, run from Docker. One
named graph per annotation; one named graph per profile ontology. See
`docs/architecture.md` for the rationale.

## Quick start

Requires Docker, Node 18+, and npm.

```bash
git clone https://github.com/friendlynihilist/iiif-multimodal-annotator.git
cd iiif-multimodal-annotator
cp .env.example .env                # adjust FUSEKI_ADMIN_PASSWORD if exposed
docker compose up -d                # starts Fuseki + the FastAPI backend
./scripts/bootstrap-fuseki.sh       # loads every profile's ontology into Fuseki
npm install
npm run dev                         # frontend on http://localhost:5173
```

Health check:

```bash
curl localhost:8000/health          # "ok" once bootstrap has run
```

Stop:

```bash
docker compose down                 # data persists in the fuseki-data volume
docker compose down -v              # also drops the triple store
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — three-layer architecture,
  named-graph-per-annotation rationale
- [`docs/data-model.md`](docs/data-model.md) — annotation structure,
  dual-target pattern, MLAO anchor, JSON-LD example
- [`docs/profiles.md`](docs/profiles.md) — pluggable profile bundles
- [`docs/api.md`](docs/api.md) — backend HTTP endpoints
- [`docs/development.md`](docs/development.md) — repository layout, build,
  restart cycles, running without Docker
- [`docs/adr/`](docs/adr/) — historical decision records

## Status

Research prototype. Phase 1 milestone: poster + live demo at the IIIF Annual
Conference 2026.

## Author and licence

Carlo Teo Pedretti, https://orcid.org/0000-0002-4115-0078 - Bibliotheca Hertziana - Max Planck Institute for Art History (Rome); 
<br>
Maria Francesca Bocchi, https://orcid.org/0009-0003-0559-0409 - Alma Mater Studiorum - University of Bologna, Italy.

- Code: MIT (see `package.json`).
- Default `interim-geko` profile bundle (`profiles/interim-geko/`): CC-BY-4.0
  (see `profiles/interim-geko/manifest.json`).
