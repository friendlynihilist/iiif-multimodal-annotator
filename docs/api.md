# Backend HTTP API

FastAPI gateway at `http://localhost:8000`. JSON-LD where appropriate,
otherwise JSON. Auto-generated OpenAPI surface at
`http://localhost:8000/docs` (Swagger UI) and
`http://localhost:8000/openapi.json`.

All write paths go through the gateway. The Fuseki SPARQL Update
endpoint is not exposed to the browser directly (writes from raw
SPARQL are gated behind admin auth pending Phase 3).

## Annotations — W3C Web Annotation Protocol

Each annotation lives in its own named graph keyed by the annotation
IRI (`<BASE_NS>annotations/<container>/<ulid>`). A `container` is an
opaque name segment under which annotations are grouped — for the
demo, `demo-poster`.

### `POST /w3c/{container}/`

Create an annotation. Mints a ULID for the IRI, stamps
`dcterms:created`, attaches an auto-generated `hico:InterpretationAct`,
and adds the `mma:profile` triple if absent. Returns the saved
annotation framed as JSON-LD.

```bash
curl -X POST http://localhost:8000/w3c/demo-poster/ \
  -H "Content-Type: application/ld+json" \
  -d '{
    "@context": "http://www.w3.org/ns/anno.jsonld",
    "type": "Annotation",
    "motivation": "linking",
    "body":   { "type": "TextualBody", "value": "il turbante" },
    "target": { "type": "SpecificResource",
                "source": "https://example.org/canvas/p1",
                "selector": { "type": "FragmentSelector",
                              "value": "xywh=412,180,260,140" } }
  }'
```

Response: `201 Created` with `Location: <iri>` and the framed
annotation in the body.

### `GET /w3c/{container}/`

List every annotation in the container, embedded into a single
`AnnotationPage`. One CONSTRUCT per item — fine for ≲ a few thousand;
will move to a bulk CONSTRUCT if profiling shows the cost.

### `GET /w3c/{container}/{annotation_id}`

Return one annotation as JSON-LD, framed at the annotation IRI.
`404` if the named graph is empty or absent.

### `PUT /w3c/{container}/{annotation_id}`

Replace the annotation's triples (atomic `DROP GRAPH` + `INSERT
DATA`). Carries `dcterms:created` forward, stamps a fresh
`dcterms:modified`. Every previous `InterpretationAct` is preserved;
the previously-latest one is stamped with `dcterms:isReplacedBy
<new-act>`.

### `DELETE /w3c/{container}/{annotation_id}`

Single `DROP SILENT GRAPH`. Returns `204` on success, `404` if the
graph was empty/absent.

### `POST /w3c/{container}/{annotation_id}/anchor`

Attach an `mlao:Anchor` blank node to an existing annotation.
Re-anchoring is atomic — a single SPARQL Update `DELETE`s the previous
anchor + its triples and `INSERT`s the new ones.

Payload:

```json
{
  "entityClass":        "crm:E1_Entity",
  "isAnchoredTo":       "wd:Q14798562",
  "isAnchoredToLabel":  "La Fornarina",
  "isCustomEntity":     false,
  "hasConceptualLevel": "icon:IconographicalSubject"
}
```

`entityClass` and `isAnchoredTo` are required; the rest are optional.
CURIEs are expanded server-side against the prefix map (`mma`, `crm`,
`mlao`, `geko`, `icon`, `skos`, `interim`, `wd`, `rdfs`). Pass
absolute IRIs to bypass the prefix expansion.

When `isCustomEntity` is `true`, the entity's own `rdf:type` and
`rdfs:label` triples are stored in the same named graph as the
annotation so they get cleaned up on delete.

## SPARQL passthrough

### `POST /sparql` / `GET /sparql`

Forward a SPARQL Query to Fuseki and mirror the response. Forwards
the `Accept` and `Content-Type` headers from the request; returns
Fuseki's body and content-type unchanged. Used by the YASGUI panel
in the Query & Analytics tab and by the visualization queries.

```bash
curl -X POST http://localhost:8000/sparql \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Accept: application/sparql-results+json" \
  --data-urlencode "query=SELECT ?g (COUNT(*) AS ?c) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g"
```

### `POST /sparql/update`

`501 Not Implemented`. Raw SPARQL Update is gated behind admin auth
until Phase 3. Writes go through the WAP routes.

## Profiles

### `GET /profiles`

List every profile manifest on disk under `PROFILES_DIR`.

### `GET /profiles/{profile_id}`

One profile manifest as JSON.

## Contexts

### `GET /contexts/{name}.jsonld`

Serve a published JSON-LD context. The default context is at
`/contexts/multimodal-context.jsonld`. Exported annotations reference
this URL in their `@context`; round-tripping requires the URL to
resolve.

## Health

### `GET /health`

Always returns HTTP 200 with one of three states in the body.
Always-200 is intentional so a load balancer can read the body
without distinguishing "crashed" from "degraded".

| `status`     | meaning                                                    |
|--------------|------------------------------------------------------------|
| `down`       | Fuseki not reachable at `$FUSEKI_URL/$/ping`               |
| `degraded`   | Fuseki up, but ≥1 profile's ontology graph is missing/empty |
| `ok`         | Fuseki up AND every profile's ontology graph has ≥1 triple |

`degraded` includes a `missing_ontologies[]` array and a hint to run
`./scripts/bootstrap-fuseki.sh`.
