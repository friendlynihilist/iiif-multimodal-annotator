# Backend — FastAPI gateway

> Phase 1 scaffolding (T1.3). CRUD over the W3C Web Annotation Protocol
> and SPARQL pass-through land in T1.4; HICO provenance and SHACL
> validation are Phase 3.

## Layout

```
backend/
├── Dockerfile
├── requirements.txt
├── .venv/                       # local dev venv (gitignored)
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI entry + middleware + router wiring
│   ├── config.py                # env loader, password sniff
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── health.py            # GET /health  (ok | degraded | down)
│   │   ├── profiles.py          # GET /profiles, GET /profiles/{id}
│   │   ├── contexts.py          # GET /contexts/{name}.jsonld
│   │   ├── wap.py               # POST/GET/PUT/DELETE /w3c/{container}/...
│   │   └── sparql.py            # POST /sparql, /sparql/update
│   └── services/
│       ├── __init__.py
│       ├── fuseki.py            # async httpx client (ping, COUNT)
│       └── profiles.py          # filesystem profile loader
└── scripts/
    └── test_context_roundtrip.py   # T1.2 validator (run with .venv/bin/python)
```

## Run with docker compose

```bash
cp .env.example .env       # then edit FUSEKI_ADMIN_PASSWORD
docker compose up -d
./scripts/bootstrap-fuseki.sh    # idempotent ontology loader
curl localhost:8000/health        # → {"status":"ok","fuseki":true}
curl localhost:8000/profiles      # → {"profiles":[{...interim-geko manifest...}]}
```

## Run locally (without docker)

Requires Fuseki running somewhere reachable (e.g. via `docker compose up
fuseki`).

```bash
backend/.venv/bin/pip install -r backend/requirements.txt
export FUSEKI_URL=http://localhost:3030
export FUSEKI_DATASET=ds
export FUSEKI_ADMIN_PASSWORD=changeme
export PROFILES_DIR=$(pwd)/profiles
export CONTEXTS_DIR=$(pwd)/contexts
backend/.venv/bin/uvicorn app.main:app --reload --app-dir backend
```

## What's NOT here yet

| Endpoint                                     | Status   | Lands in |
|---------------------------------------------|----------|----------|
| `GET /health`                               | working  | T1.3     |
| `GET /profiles`, `GET /profiles/{id}`       | working  | T1.3     |
| `GET /contexts/{name}.jsonld`               | working  | T1.3     |
| `POST/GET/PUT/DELETE /w3c/{container}/...`  | 501 stub | T1.4     |
| `POST /sparql`, `POST /sparql/update`       | 501 stub | T1.4/T2.5|
| HICO provenance generator                   | absent   | Phase 3  |
| SHACL validation                            | absent   | Phase 3  |
| OAuth / API key                             | absent   | Phase 3  |

## Health-check semantics

The `/health` endpoint always returns HTTP 200 with one of three states
in the body:

| status     | meaning                                                                |
|-----------|-------------------------------------------------------------------------|
| `down`     | Fuseki not reachable at `$FUSEKI_URL/$/ping`                          |
| `degraded` | Fuseki up, but ≥1 profile's ontology graph is missing/empty           |
| `ok`       | Fuseki up AND every profile's ontology graph has ≥1 triple            |

`degraded` includes a `missing_ontologies[]` array and a hint to run the
bootstrap script. Always-200 is intentional so a load balancer can read
the body without distinguishing "crashed" from "degraded".

## Insecure-default warning

`config.warn_if_insecure()` logs a WARN at startup if
`FUSEKI_ADMIN_PASSWORD` is one of `{changeme, admin, password, fuseki, ""}`.
The user explicitly asked for this safety net (so the September UX-test
deploy doesn't slip out the door with `changeme`).
