# PHASE 1 — Poster + Demo (13 May → 1 June 2026)

> 19 days. Atomic tasks below, in execution order. Each task ends with a **DONE WHEN** check.
> A task that can't be checked off is not yet done.

---

## Schedule overview

```
Week 1 (13–19 May)   ▕████████░░░░░░░░░░░░░░░░░░░░░░░▏  scaffolding & backend
Week 2 (20–26 May)   ▕░░░░░░░░████████░░░░░░░░░░░░░░░▏  profile system & SPARQL
Week 3 (27–31 May)   ▕░░░░░░░░░░░░░░░░████████░░░░░░░▏  demo data + polish + screenshots
Day  1 June          ▕░░░░░░░░░░░░░░░░░░░░░░░░░░░░███▏  IIIF conference demo
```

---

## Week 1 — scaffolding & backend (13–19 May)

### T1.1 — Repo restructure for v2

- Create the v2 directory layout:
  ```
  /backend/           ← new: FastAPI service
  /profiles/          ← new: ontology profiles
  /contexts/          ← new: published JSON-LD contexts
  /src/               ← existing frontend
  /docs/              ← architecture, ADRs, guides
  /examples/          ← demo data, sample annotations
  /docker-compose.yml ← orchestration
  ```
- Move `ontology/interim.ttl` to `profiles/interim-geko/ontology.ttl` (do not delete original yet — leave a note pointing to the new location).
- **Apply the Phase 1 rename** (external identifiers only — see CLAUDE.md §"Phase 1 rename scope"):
  - Rename file `src/components/iiif-interim-annotator.js` → `src/components/multimodal-annotator.js` (use `git mv` to preserve history).
  - Register the primary custom element tag `<multimodal-annotator>`. Also register the deprecated alias `<iiif-interim-annotator>` as a thin subclass that emits a `console.warn`.
  - Update `src/index.js` import paths and re-export the class under both `IIIFInterimAnnotator` (kept) and `MultimodalAnnotator` (new alias).
  - Update `examples/index.html`: replace `<iiif-interim-annotator>` with `<multimodal-annotator>`, change `<title>` to "Multimodal Annotator — Demo".
  - Update `package.json` `name` to `iiif-multimodal-annotator`.
  - Update README and PROJECT-OVERVIEW headings (full README rewrite happens in T3.2).
  - **Do NOT touch**: CSS variable `--color-black`, CSS class names, custom event names, the `IIIFInterimAnnotator` JS class name, `<iiif-text-panel>` / `<iiif-image-panel>` tags.
- Add `CHANGELOG.md` with a `## [Unreleased]` section.

**DONE WHEN**: new structure exists, frontend still builds and runs with `npm run dev`, `<multimodal-annotator>` is the canonical tag in the demo HTML, and `<iiif-interim-annotator>` still works (with a console warning) for backwards compatibility.

### T1.2 — JSON-LD `@context` for the default profile

This is the prerequisite to RDF anything. See `contexts/multimodal-context.jsonld` for the seed file — extend / verify it.

- Make sure every term used in the v1 export (`oa:`, `lrmoo:`, `geko:`, `interim:`, `miro:`, `mlao:`, `icon:`, `hico:`, `crm:`, `skos:`, `dcterms:`) is in the context, **plus the new `mma:` namespace** (`https://w3id.org/multimodal-annotator/ns/`).
- For each term, decide `@id` and `@type` (especially `@type: @id` for URI-valued properties).
- **HICO namespace is `https://w3id.org/hico/`** (NOT `http://purl.org/emmedi/hico/`). Fix in both the `@context` and the v1 `ontology/interim.ttl` (which currently uses the old URI) before round-trip testing.
- The `profile` term resolves to `mma:profile`, not `interim:profile`.
- Serve the context from the backend (next task) at `/contexts/interim-geko.jsonld` and also save a copy in `contexts/`.
- Validate with `pyld` (or any JSON-LD processor): `pyld.jsonld.expand(annotation_export)` must round-trip cleanly.

**DONE WHEN**: a v1 export (with HICO + `profile` predicate updated) replayed through the new context expands to RDF triples without dropped terms.

### T1.3 — Backend skeleton (FastAPI + Fuseki via Docker Compose)

- `docker-compose.yml` with two services:
  - `fuseki`: official `secoresearch/fuseki` or `stain/jena-fuseki` image, TDB2, persistent volume.
  - `backend`: built from `backend/Dockerfile` (Python 3.11, FastAPI, uvicorn).
- Backend dependencies (`pyproject.toml` or `requirements.txt`): `fastapi`, `uvicorn`, `rdflib`, `pyld`, `httpx`, `python-multipart`, `python-dotenv`.
- Add a root-level `.env.example` (committed) with:
  ```
  BASE_NS=https://w3id.org/multimodal-annotator/ns/
  DEFAULT_CREATOR_IRI=https://orcid.org/0000-0002-4115-0078
  FUSEKI_URL=http://fuseki:3030/mma
  CORS_ORIGINS=http://localhost:5173
  ```
  Backend reads env on startup; `BASE_NS` and `DEFAULT_CREATOR_IRI` are used by the SPARQL Update builder and the HICO provenance generator respectively. Enable CORS for `CORS_ORIGINS` so the Vite dev server can call the API.
- Backend skeleton routes (all stubbed initially):
  - `GET  /health`
  - `GET  /profiles` → list available profiles
  - `GET  /profiles/{id}` → return manifest + context
  - `GET  /contexts/{id}.jsonld`
  - `POST /w3c/{container}/` → create annotation (WAP)
  - `GET  /w3c/{container}/` → list annotations in container
  - `GET  /w3c/{container}/{id}` → get one annotation
  - `PUT  /w3c/{container}/{id}` → update
  - `DELETE /w3c/{container}/{id}` → delete
  - `POST /sparql` → SPARQL query passthrough
  - `POST /sparql/update` → SPARQL update (admin only later, public for Phase 1)
- **Ontology loading is OUT of the backend startup path.** A separate
  idempotent script `scripts/bootstrap-fuseki.sh` (a) polls
  `$FUSEKI_URL/$/ping` until ready, (b) PUTs every
  `profiles/<id>/ontology.ttl` into named graph
  `${BASE_NS}graphs/ontology/<id>` via the Graph Store Protocol, (c)
  verifies the load with a COUNT query. The backend's `/health` endpoint
  reports `degraded` (with a list of missing graphs) until the script
  has run. This split lets the backend start even when Fuseki is still
  booting, and lets ops re-seed the demo dataset by re-running one
  script without restarting any container.

**DONE WHEN**: `docker compose up`, then `curl localhost:8000/health` returns 200, and `curl localhost:8000/profiles` returns at least the `interim-geko` manifest.

### T1.4 — Implement WAP CRUD via SPARQL Update

For each WAP endpoint, write the SPARQL translation:

- `POST` → mint an annotation IRI, parse incoming JSON-LD, convert to RDF (`pyld` + `rdflib`), wrap in `INSERT DATA { GRAPH <iri> { ... } }`, send to Fuseki.
- `GET` → `CONSTRUCT { ?s ?p ?o } FROM <iri> WHERE { ?s ?p ?o }`, serialise as JSON-LD with profile's context.
- `PUT` → `DELETE { GRAPH <iri> { ?s ?p ?o } } INSERT DATA { ... }`.
- `DELETE` → `DROP GRAPH <iri>`.
- Each annotation gets its own named graph keyed by its IRI.

For Phase 1, the "container" notion can be flat (one container per profile, or one global container). Don't overthink containers yet.

**DONE WHEN**: round-trip works. POST an annotation, GET it back, modify it via PUT, GET shows the modification, DELETE removes it, GET returns 404.

### T1.5 — Frontend: replace in-memory store with backend sync

The current orchestrator stores annotations in `this.annotations[]` and exports them on demand. Replace with:

- A new `src/store/annotation-store.js` module (NOT a class on the orchestrator) that exposes:
  - `async load(containerId)` → fetches all annotations for a container
  - `async create(annotation)` → POSTs, returns the server-assigned IRI
  - `async update(iri, patch)` → PUTs
  - `async remove(iri)` → DELETEs
  - Events: `annotation:created`, `annotation:updated`, `annotation:removed`
- The orchestrator subscribes to these events and updates the visible UI.
- Optimistic updates: the UI reflects the change immediately, server confirms later. On 4xx/5xx, revert and surface a non-blocking error.
- The "Export" button stays — it now triggers a server-side `CONSTRUCT` and downloads the resulting JSON-LD (with the proper `@context`).

**DONE WHEN**: every annotation action in the UI is mirrored by an HTTP call visible in DevTools Network panel, and refreshing the page restores the annotations from the server.

### T1.6 — `loadAnnotations()` re-renders

The current `loadAnnotations()` only fills `this.annotations`. Make it actually paint highlights and rectangles:

- For each annotation:
  - Resolve `target.source` → which panel renders this source? (Match by panel config.)
  - For a text body / target with `TextPositionSelector`: find the text panel, walk the DOM to that character offset, wrap a `<mark class="text-confirmed">` around the range.
  - For an image target with `FragmentSelector xywh=...`: find the image panel, convert pixel coords back to viewport coords, create a `<div class="selection-rect confirmed">` at that position, push into `confirmedRects`.
  - For an `SvgSelector`: parse the path, draw on `#selection-canvas` of the image panel.
  - Once both endpoints exist, call `drawConnectionLineBetween` to recreate the curve.
- Honour the active profile's modality colors when applying CSS classes.

**DONE WHEN**: a fresh page reload restores not just the data but the **visible** highlights, rectangles, and curves.

---

## Week 2 — profile system & SPARQL (20–26 May)

### T2.1 — Profile manifest format

Document `profiles/<id>/manifest.json` schema. See `docs/architecture/ARCHITECTURE-v2.md` for the full schema. Minimum fields for Phase 1:

```json
{
  "id": "interim-geko",
  "name": "INTERIM / GEKO Ekphrasis",
  "description": "Default profile for intermedial relations and ekphrasis research.",
  "version": "0.1.0",
  "context": "context.jsonld",
  "ontology": "ontology.ttl",
  "namespaces": { "interim": "...", "geko": "...", ... },
  "entityClasses": [
    { "id": "lrmoo:F1_Work", "label": "Work", "applicableTo": ["image"] },
    { "id": "lrmoo:F2_Expression", "label": "Expression", "applicableTo": ["text"] }
  ],
  "linkingProperties": [
    {
      "id": "geko:denotation",
      "label": "Denotation",
      "color": "#2196F3",
      "shortcut": "D",
      "domain": "lrmoo:F2_Expression",
      "range": "lrmoo:F1_Work"
    },
    ...
  ],
  "panelTypes": ["text", "image", "facsimile"],
  "annotationMotivations": ["linking", "commenting", "tagging", "transcribing"]
}
```

**DONE WHEN**: a schema file (`docs/profile-manifest.schema.json`) is committed, and `interim-geko/manifest.json` validates against it.

### T2.2 — Build the default `interim-geko` profile

- Extract every hardcoded INTERIM/GEKO value from `iiif-interim-annotator.js` and put it in `profiles/interim-geko/manifest.json`.
- Move the ontology to `profiles/interim-geko/ontology.ttl`.
- Move the context to `profiles/interim-geko/context.jsonld` (and also publish at `contexts/`).

**DONE WHEN**: the profile bundle is complete and the backend `GET /profiles/interim-geko` returns it.

### T2.3 — Build the `cidoc-crm-bare` profile (locked)

The second profile is **`cidoc-crm-bare`**: the same cross-modal scenario as the default, modelled with CIDOC-CRM instead of GEKO.

- Entity classes: `crm:E22_Human-Made_Object` (for images), `crm:E36_Visual_Item` (for images / regions), `crm:E33_Linguistic_Object` (for text).
- Single linking property: `crm:P138_represents` (text region → image region or visual item → human-made object, depending on the modelling stance the profile picks — document the choice in the profile README).
- **No modality multiplicity**: a single linking property, single color (use a neutral indigo for clarity in side-by-side screenshots).
- Tag schemes: none (Phase 1).

Build the corresponding `manifest.json` + minimal `ontology.ttl` + `context.jsonld`. **The point is to demonstrate pluggability concretely in the demo** — same regions, same artworks, different ontological framing.

**DONE WHEN**: backend exposes both `interim-geko` and `cidoc-crm-bare`; switching profile in the UI changes the modality button(s), color(s), and the `@context` used on save; existing annotations under the other profile render greyed-out with a "different profile" badge.

### T2.4 — Profile picker UI

- Add a profile dropdown in the app header (right of the title, before the help button).
- On profile change:
  - Fetch the new manifest.
  - Re-render modality buttons in the modality selector modal.
  - Re-render CSS variables for modality colors.
  - **Do NOT delete existing annotations.** They keep their original `property` URI; if the new profile doesn't recognise it, render them in greyscale with a small "different profile" indicator.
- Persist the choice in `localStorage` (per browser, not per backend container — that comes in Phase 3).

**DONE WHEN**: switching profile in the dropdown visibly changes the UI without page reload.

### T2.5 — SPARQL panel

- New panel type: `sparql`. Add `case 'sparql'` to `addPanel`, `getPanelLabel`, `getPanelIcon`, `createPanelElement`.
- New custom element: `<mma-sparql-panel>` (file `src/components/mma-sparql-panel.js`).
- Embed YASGUI (https://github.com/TriplyDB/Yasgui) — load from CDN to start, vendor it later.
- Configure YASGUI to point at `/sparql` on the backend.
- Ship 3–4 example queries baked into the panel:
  - "All annotations of modality `denotation`"
  - "All ekphrastic relations involving canvas X"
  - "Annotations created today"
  - "Counts by modality"

**DONE WHEN**: the user can open a SPARQL panel, run a query, see results, all hitting the live triple store.

---

## Week 3 — demo data + polish + screenshots (27–31 May)

### T3.1 — Demo dataset

Curate a small, high-quality demo dataset:
- The Bologna manuscript (already in `examples/`) with PAGE XML for at least 3 pages of actual ekphrastic content.
- Two paintings annotated: La Fornarina (already referenced) + one more (suggest: Raphael's *Stanze* detail, IIIF-available from Vatican).
- 15–25 pre-made annotations covering all three GEKO modalities.
- 5–8 annotations in the alternative profile to show the same regions tagged differently.

**DONE WHEN**: visiting the demo URL with `?profile=interim-geko` shows the ekphrasis case; switching to the alternative profile re-paints the same regions with the alternative schema.

### T3.2 — README rewrite

The current README is v1. Rewrite for v2:
- New name (Multimodal Annotator) up top.
- One-paragraph description.
- "What it does" — three bullet points with screenshots.
- "Profiles" section explaining the pluggability concept with one example.
- Quick start: `git clone && docker compose up && open localhost:5173`.
- Link to the IIIF poster PDF once it's done.

**DONE WHEN**: a stranger can clone the repo and have a working demo in under 5 minutes.

### T3.3 — Screenshots for the poster

Plan at least:
1. **Hero shot**: text + facsimile + painting + connection lines, with a SPARQL panel on the right showing the corresponding triple.
2. **Profile picker**: dropdown open showing two profiles, with a tooltip explaining "switch annotation schema".
3. **The same annotation in two profiles**: side-by-side comparison.
4. **A SPARQL query and its result**: maybe "find all ekphrasis with `dynamisation` modality".

Use a high-DPI display, zoom to 110% in the browser, capture at 2× resolution.

**DONE WHEN**: at least 4 poster-grade screenshots exist in `docs/poster/screenshots/` at 2880×1800 or better.

### T3.4 — Pre-flight checklist for the demo

A day-of-demo checklist in `docs/demo-checklist.md`:
- Backend running locally on conference WiFi? Have a fallback (ngrok? local-only mode?).
- All ontologies pre-loaded? Verify after every `docker compose down/up`.
- Browser console clean? No CORS errors? No 404s?
- A "reset demo" button or script that re-seeds the database with the demo dataset in <30 seconds, in case something goes wrong mid-demo.

**DONE WHEN**: the checklist exists and has been walked through at least twice from a clean machine.

### T3.5 — STRETCH: Iconclass authority service for tagging

> Cuttable if Week 3 runs over. The poster works without this, but it's the kind of detail that lands well in a live demo and in screenshots.

- Add a minimal authority-service hook callable from the "tag" annotation flow on any panel (independent of the active profile — applicable to every profile that declares `tagging` in `annotationMotivations`).
- UI: when the user clicks "tag", show an autocomplete input that queries `https://iconclass.org/{notation}.json` as the user types a notation prefix. Display matching entries (notation + textual correlate).
- Selecting a result writes the annotation body as:
  ```json
  {
    "type": "SpecificResource",
    "source": "https://iconclass.org/{notation}",
    "purpose": "tagging"
  }
  ```
  with the body's RDF type being `skos:Concept` and `rdfs:label` carrying the textual correlate.
- The Iconclass IRI is dereferenceable — no further configuration needed.
- Document the dependency on the public `iconclass.org` JSON API; pre-cache the lookups for the demo dataset so the live demo doesn't depend on conference WiFi.

**DONE WHEN**: the user can tag a selection with an Iconclass concept via autocomplete; the saved annotation body references `https://iconclass.org/...`; SPARQL `SELECT ?notation WHERE { ?body a skos:Concept ; oa:hasSource ?notation . FILTER(CONTAINS(STR(?notation), "iconclass.org")) }` returns the tagged concept.

---

## Risk register & contingencies

| Risk | Likelihood | Mitigation |
|---|---|---|
| `loadAnnotations()` re-render is harder than expected (resolving `TextPositionSelector` on PAGE-XML rendered text in shadow DOM) | Medium | Fallback: render highlights using the saved `lineId` + `coords` directly, skip the position-selector resolution path for v2.0. Document as known limitation. |
| Fuseki / Docker setup eats too much time | Low | Fallback: Oxigraph (single binary, no Java). Cost: lose Jena's reasoning, but for Phase 1 we don't need it yet. |
| SPARQL panel doesn't render YASGUI inside shadow DOM cleanly | Medium | YASGUI uses light DOM and global CSS. Use light DOM for this one panel, OR iframe it. |
| Network issues at the conference | High | Run the full stack locally on laptop. Pre-download all IIIF tiles for the demo dataset to a local cache. |
| The second profile (CIDOC or Iconclass) isn't ready in time | Medium | Cut it to a minimal "demo-only" profile with 2 classes and 1 property, just enough to show the picker works. |
| Backend introduces a latency that breaks the connection-line `requestAnimationFrame` loop | Low | Annotations cache locally after first load; only writes go through HTTP. The rAF loop touches local state. |

---

## What is NOT in Phase 1 (write it here to resist the temptation)

- Schema Editor UI for creating new profiles in the browser
- Authority service integration (Wikidata, AAT, ULAN)
- MLAO levels as a UI dimension
- HICO `InterpretationAct` beyond minimal `dcterms:creator`
- Authentication, multi-user, permissions
- SHACL validation enforcement (declared but not enforced)
- Diff / versioning / Memento
- Undo / redo
- Refactoring of `iiif-interim-annotator.js` beyond what's needed
- Smart selection tools, AI-assisted drawing
- Translation / transcription via LLMs
- Renaming `iiif-interim-annotator` custom element (cosmetic; deferred to keep diffs small)

**Each of these is in Phase 3. Do not start any of them before 2 June.**
