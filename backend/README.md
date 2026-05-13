# Backend — FastAPI gateway

> Placeholder. Scaffolding lands in **PHASE-1 task T1.3**.
>
> When implemented, this directory will contain:
>
> ```
> backend/
> ├── Dockerfile
> ├── pyproject.toml
> ├── app/
> │   ├── __init__.py
> │   ├── main.py              # FastAPI entry point
> │   ├── config.py            # reads BASE_NS, DEFAULT_CREATOR_IRI, FUSEKI_URL, CORS_ORIGINS
> │   ├── routes/
> │   │   ├── health.py
> │   │   ├── profiles.py
> │   │   ├── contexts.py
> │   │   ├── wap.py           # W3C Web Annotation Protocol CRUD
> │   │   └── sparql.py        # SPARQL passthrough
> │   ├── services/
> │   │   ├── jsonld.py        # JSON-LD ↔ RDF round-tripping (pyld + rdflib)
> │   │   ├── sparql_client.py # Fuseki client
> │   │   ├── hico.py          # provenance generator
> │   │   └── profile_loader.py
> │   └── tests/
> ```
>
> See `docs/architecture/ARCHITECTURE-v2.md` for the design.
