# Development

Setup, repository layout, build cycles, common operations.

## First-time setup

Requires: Docker (with `docker compose`), Node 18+, npm, Python 3.11+
(for running the backend outside Docker).

```bash
git clone https://github.com/friendlynihilist/iiif-multimodal-annotator.git
cd iiif-multimodal-annotator
cp .env.example .env                 # adjust FUSEKI_ADMIN_PASSWORD
docker compose up -d                 # starts Fuseki + the FastAPI backend
./scripts/bootstrap-fuseki.sh        # loads every profile's ontology
npm install
npm run dev                          # frontend on http://localhost:5173
```

The Vite dev server proxies nothing — frontend calls
`http://localhost:8000` for the backend directly, so make sure
`CORS_ORIGINS=http://localhost:5173` in `.env`.

## Repository layout

```
.
├── backend/                FastAPI gateway
│   ├── Dockerfile          # python:3.11-slim + requirements + COPY app/
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py         # FastAPI entry, CORS, router wiring
│   │   ├── config.py       # env loader, insecure-password sniff
│   │   ├── routes/         # health / profiles / contexts / wap / sparql
│   │   └── services/       # fuseki httpx client, profiles loader,
│   │                       # iri minting, provenance, jsonld round-trip
│   └── scripts/
│       └── test_context_roundtrip.py   # T1.2 validator
│
├── contexts/
│   └── multimodal-context.jsonld   # served at /contexts/<name>.jsonld
│
├── profiles/
│   └── interim-geko/       # default profile bundle
│       ├── manifest.json
│       ├── context.jsonld
│       ├── ontology.ttl
│       ├── ontology.jsonld # lossless TTL→JSON-LD serialization
│       └── model-interim.jpg
│
├── src/                    Frontend (Web Components, vanilla JS)
│   ├── index.js            # registers <multimodal-annotator>
│   ├── components/
│   │   ├── multimodal-annotator.js   # orchestrator (panels, tabs, modals, viz)
│   │   ├── iiif-text-panel.js        # text + TEI + PAGE-XML
│   │   └── iiif-image-panel.js       # OpenSeadragon + IIIF
│   └── store/
│       ├── annotation-store.js       # EventTarget store, optimistic CRUD
│       └── iri-utils.js              # mma: expand/compact helpers
│
├── public/                 Vite static assets (served at /...)
│   ├── peirce-manifest.json
│   ├── peirce-pragmatism.xml
│   ├── images/             # peirce manuscript canvases
│   └── examples/           # bocchi codex mets + PAGE-XML pages
│
├── examples/
│   └── index.html          # Vite root entry (publicDir maps to ../public)
│
├── scripts/
│   └── bootstrap-fuseki.sh # idempotent ontology loader
│
├── tests/                  node --test (built-in test runner)
│   ├── store.test.js
│   └── iri-utils.test.js
│
├── docs/                   this directory
│   ├── architecture.md
│   ├── data-model.md
│   ├── profiles.md
│   ├── api.md
│   ├── development.md
│   └── adr/                accepted decision records
│
├── docker-compose.yml      Fuseki + backend
├── vite.config.js          root: 'examples', publicDir: '../public'
├── package.json
└── .env.example
```

`.backup/` is gitignored and holds legacy files moved during the
cleanup pass (old changelog, briefing, scratch data, dead example
duplicates). Recover with `git mv .backup/<file> <file>` if needed.

## Build and test

Frontend:

```bash
npm run dev      # Vite dev server with HMR
npm run build    # → dist/, called by Netlify / static hosts
npm run preview  # serve dist/ locally
npm test         # node --test tests/store.test.js tests/iri-utils.test.js
```

Backend (Python tests run inside the venv):

```bash
backend/.venv/bin/python backend/scripts/test_context_roundtrip.py
```

## Backend cycles

### With Docker (default)

The Docker image bakes the Python code at build time. Changing
`backend/app/**` requires a rebuild:

```bash
docker compose up -d --build backend
```

`./profiles` and `./contexts` are bind-mounted read-only, so changes
there are picked up without a rebuild.

### Without Docker

```bash
backend/.venv/bin/pip install -r backend/requirements.txt
export FUSEKI_URL=http://localhost:3030
export FUSEKI_DATASET=ds
export FUSEKI_ADMIN_PASSWORD=changeme
export PROFILES_DIR=$(pwd)/profiles
export CONTEXTS_DIR=$(pwd)/contexts
backend/.venv/bin/uvicorn app.main:app --reload --app-dir backend
```

A Fuseki must be reachable. `docker compose up -d fuseki` (just the
fuseki service) is the easiest way.

## Re-running the bootstrap

After editing any `profiles/<id>/ontology.ttl`:

```bash
./scripts/bootstrap-fuseki.sh
```

The script uses the Graph Store Protocol `PUT` to replace the ontology
named graph wholesale; running it against an already-bootstrapped
Fuseki is safe. It also prints a triple-count per graph for
verification.

## Reading the health endpoint

```bash
curl localhost:8000/health
```

- `{"status":"ok",...}` — Fuseki up, every profile graph populated.
- `{"status":"degraded","missing_ontologies":[...]}` — run the
  bootstrap.
- `{"status":"down",...}` — Fuseki not reachable; check
  `docker compose ps`.

## Insecure-default password warning

`config.warn_if_insecure()` logs a WARN at backend startup if
`FUSEKI_ADMIN_PASSWORD` is one of `{changeme, admin, password, fuseki, ""}`.
Change before any public deploy.

## Conventions

- ES modules everywhere on the frontend. `type: "module"` in
  `package.json`.
- Open Shadow DOM on every Web Component. `composed: true` on every
  `CustomEvent`.
- Tagged template literals for shadow content; no JSX.
- No frontend framework dependency. The annotator is vanilla on
  purpose. OpenSeadragon, Chart.js, YASGUI are the only browser
  libraries.
- Python 3.11+, type hints, `from __future__ import annotations` at
  the top of every backend module.
- Comments only where the *why* is non-obvious.
