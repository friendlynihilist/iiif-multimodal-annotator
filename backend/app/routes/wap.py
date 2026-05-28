"""W3C Web Annotation Protocol — CRUD over named-graph-per-annotation.

URL surface:

    POST   /w3c/{container}/                          create
    GET    /w3c/{container}/                          list IRIs in container
    GET    /w3c/{container}/{annotation_id}           read one
    PUT    /w3c/{container}/{annotation_id}           replace one (Acts accumulate)
    DELETE /w3c/{container}/{annotation_id}           hard delete (graph + Acts)
    POST   /w3c/{container}/{annotation_id}/anchor    attach mlao:hasAnchor

Storage model: each annotation lives in its own named graph keyed by the
annotation IRI. PUT preserves every historical InterpretationAct and
stamps the previous most-recent one with `dcterms:isReplacedBy <new>`.
DELETE drops the whole graph (no soft-delete in Phase 1). The /anchor
sub-route INSERT-appends an mlao:Anchor blank node + optional custom
entity triples to the same graph (additive — no DROP).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from rdflib import BNode, Graph, Literal, Namespace, URIRef
from rdflib.namespace import DCTERMS, RDF, XSD

from app.config import settings
from app.services import provenance
from app.services.fuseki import get_client
from app.services.iri import (
    CONTAINER_PATTERN,
    annotation_iri,
    is_valid_container,
    mint_annotation_iri,
)
from app.services.jsonld import (
    graph_to_jsonld,
    jsonld_doc_to_graph,
    load_default_context,
)
from app.services.provenance import HICO, PROV

log = logging.getLogger("mma.wap")
router = APIRouter(prefix="/w3c")

JSON_LD_MIME = "application/ld+json"

OA   = Namespace("http://www.w3.org/ns/oa#")
MLAO = Namespace("https://w3id.org/mlao/")
RDFS = Namespace("http://www.w3.org/2000/01/rdf-schema#")


# ─── helpers ────────────────────────────────────────────────────────

def _validate_container(container: str) -> None:
    if not is_valid_container(container):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid container name {container!r}; must match "
                f"{CONTAINER_PATTERN.pattern}."
            ),
        )


def _validate_annotation_id(annotation_id: str) -> None:
    # ULID = 26 chars Crockford Base32. Lowercased: still 26 chars.
    # Be liberal with what we accept on read (anything matching the
    # general id-segment pattern), strict on what we mint.
    if not annotation_id or "/" in annotation_id or len(annotation_id) > 64:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid annotation id {annotation_id!r}.",
        )


def _stamp_dcterms(g: Graph, ann: URIRef, *, created: bool) -> None:
    now = Literal(provenance.now_iso(), datatype=XSD.dateTime)
    if created:
        # Only set dcterms:created on POST. PUT touches dcterms:modified.
        if not any(g.objects(ann, DCTERMS.created)):
            g.add((ann, DCTERMS.created, now))
    g.set((ann, DCTERMS.modified, now))


def _default_profile_iri() -> URIRef:
    # Phase 1: every annotation is stamped with the interim-geko profile
    # IRI unless the input declares its own `mma:profile`. T2.x will
    # let the request carry a `?profile=` parameter.
    return URIRef(
        settings.base_ns.rstrip("/") + "/profiles/interim-geko"
    )


def _ensure_profile(g: Graph, ann: URIRef) -> None:
    MMA_profile = URIRef(settings.base_ns.rstrip("/") + "/profile")  # not used
    # The context maps `profile` to `mma:profile`. Look for it via the
    # canonical IRI.
    mma_profile = URIRef(settings.base_ns + "profile")
    if any(g.objects(ann, mma_profile)):
        return
    g.add((ann, mma_profile, _default_profile_iri()))


def _ensure_annotation_type(g: Graph, ann: URIRef) -> None:
    """Make sure `ann` is at least typed `oa:Annotation`. Other types
    (lrmoo:F2_Expression, etc.) from the input are preserved as-is."""
    g.add((ann, RDF.type, OA.Annotation))


def _serialize_nt(g: Graph) -> str:
    return g.serialize(format="nt")


# ─── routes ─────────────────────────────────────────────────────────

@router.post("/{container}/")
async def create_annotation(container: str, request: Request) -> Response:
    _validate_container(container)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Request body must be JSON-LD.")
    if not isinstance(body, dict):
        raise HTTPException(400, "Request body must be a JSON object.")

    ann_id, ann_iri_str = mint_annotation_iri(container)
    body_with_id = {**body, "id": ann_iri_str}

    # Parse JSON-LD → rdflib Graph.
    try:
        g = jsonld_doc_to_graph(body_with_id)
    except Exception as exc:
        raise HTTPException(400, f"Could not parse JSON-LD body: {exc}")

    ann = URIRef(ann_iri_str)
    _ensure_annotation_type(g, ann)
    _ensure_profile(g, ann)
    _stamp_dcterms(g, ann, created=True)

    # Provenance: keep client-supplied Act or generate the default.
    existing_act = provenance.find_input_interpretation_act(g, ann)
    if existing_act is None:
        provenance.add_default_act(g, ann)
    else:
        provenance.ensure_activity_type(g, existing_act)

    nt = _serialize_nt(g)
    await get_client().insert_graph(ann_iri_str, nt)

    saved_nt = await get_client().construct_graph(ann_iri_str)
    saved_g = Graph()
    saved_g.parse(data=saved_nt, format="nt")
    response_doc = graph_to_jsonld(saved_g, frame_iri=ann_iri_str)

    return JSONResponse(
        content=response_doc,
        media_type=JSON_LD_MIME,
        status_code=201,
        headers={"Location": ann_iri_str},
    )


@router.get("/{container}/")
async def list_annotations(container: str) -> dict[str, Any]:
    """Embed every annotation in the container in the response so the
    frontend store can hydrate with a single request. Each item carries
    no `@context` of its own — the outer one applies. Phase 1 acceptance
    is fine with `O(N) CONSTRUCT` for ≤ a few thousand annotations per
    container; T3+ may switch to a single bulk CONSTRUCT if a profiling
    pass shows the per-item overhead matters."""
    _validate_container(container)
    prefix = annotation_iri(container, "")
    fuseki = get_client()
    graphs = await fuseki.list_graphs_with_prefix(prefix)

    items = []
    for iri in graphs:
        nt = await fuseki.construct_graph(iri)
        if not nt.strip():
            continue
        g = Graph()
        g.parse(data=nt, format="nt")
        doc = graph_to_jsonld(g, frame_iri=iri)
        doc.pop("@context", None)
        items.append(doc)

    return {
        "@context": load_default_context()["@context"],
        "id": prefix,
        "type": "AnnotationPage",
        "items": items,
    }


@router.get("/{container}/{annotation_id}")
async def get_annotation(container: str, annotation_id: str) -> Response:
    _validate_container(container)
    _validate_annotation_id(annotation_id)
    iri = annotation_iri(container, annotation_id)

    nt = await get_client().construct_graph(iri)
    if not nt.strip():
        raise HTTPException(status_code=404, detail=f"No annotation at {iri}.")

    g = Graph()
    g.parse(data=nt, format="nt")
    return JSONResponse(
        content=graph_to_jsonld(g, frame_iri=iri),
        media_type=JSON_LD_MIME,
    )


@router.put("/{container}/{annotation_id}")
async def update_annotation(
    container: str, annotation_id: str, request: Request
) -> Response:
    _validate_container(container)
    _validate_annotation_id(annotation_id)
    iri = annotation_iri(container, annotation_id)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Request body must be JSON-LD.")
    if not isinstance(body, dict):
        raise HTTPException(400, "Request body must be a JSON object.")

    fuseki = get_client()

    # Read the existing graph; 404 if absent.
    existing_nt = await fuseki.construct_graph(iri)
    if not existing_nt.strip():
        raise HTTPException(status_code=404,
                            detail=f"No annotation at {iri} to update.")
    existing_g = Graph()
    existing_g.parse(data=existing_nt, format="nt")

    # Parse the incoming body into a fresh Graph.
    body_with_id = {**body, "id": iri}
    try:
        new_g = jsonld_doc_to_graph(body_with_id)
    except Exception as exc:
        raise HTTPException(400, f"Could not parse JSON-LD body: {exc}")

    ann = URIRef(iri)
    _ensure_annotation_type(new_g, ann)
    _ensure_profile(new_g, ann)

    # Carry the original dcterms:created forward; stamp dcterms:modified.
    for created in existing_g.objects(ann, DCTERMS.created):
        new_g.set((ann, DCTERMS.created, created))
    if not any(new_g.objects(ann, DCTERMS.created)):
        new_g.add((ann, DCTERMS.created,
                   Literal(provenance.now_iso(), datatype=XSD.dateTime)))
    _stamp_dcterms(new_g, ann, created=False)

    # Preserve every historical Act. The new annotation triples replace
    # the old annotation triples but the Acts accumulate.
    for triple in provenance.filter_act_triples(existing_g):
        new_g.add(triple)

    # Mint a fresh Act for this PUT and link the previous-latest to it.
    previous_latest = provenance.latest_act(existing_g)
    new_act = provenance.add_default_act(new_g, ann)
    if previous_latest is not None:
        provenance.stamp_replacement(new_g, previous_latest, new_act)

    # If the client included its own Act on the PUT, accept it instead
    # of the auto-generated one — but the replacement chain still uses
    # whichever Act ends up as the new latest.
    client_act = provenance.find_input_interpretation_act(new_g, ann)
    if client_act is not None and client_act != new_act:
        # The client's Act wins; remove our auto-generated one and
        # re-stamp the replacement chain to point at the client's IRI.
        for t in list(new_g.triples((new_act, None, None))):
            new_g.remove(t)
        new_g.remove((ann, PROV.wasGeneratedBy, new_act))
        if previous_latest is not None:
            new_g.remove((previous_latest, DCTERMS.isReplacedBy, new_act))
            provenance.stamp_replacement(new_g, previous_latest, client_act)
        provenance.ensure_activity_type(new_g, client_act)

    # Atomic DROP + INSERT.
    nt = _serialize_nt(new_g)
    await fuseki.replace_graph(iri, nt)

    refreshed_nt = await fuseki.construct_graph(iri)
    refreshed_g = Graph()
    refreshed_g.parse(data=refreshed_nt, format="nt")
    return JSONResponse(
        content=graph_to_jsonld(refreshed_g, frame_iri=iri),
        media_type=JSON_LD_MIME,
    )


@router.post("/{container}/{annotation_id}/anchor")
async def create_annotation_anchor(
    container: str, annotation_id: str, request: Request,
) -> Response:
    """Attach an `mlao:hasAnchor` blank node to an existing annotation.

    Payload (JSON):
        {
          "entityClass":          "crm:E1_Entity",          # required
          "isAnchoredTo":         "http://.../entity/Q...", # required
          "isAnchoredToLabel":    "turban",                 # optional
          "isCustomEntity":       false,                    # default false
          "hasConceptualLevel":   "https://w3id.org/icon/ontology/..."  # optional
        }

    For Phase 1 the anchor is APPENDED to the annotation's named graph
    (additive INSERT DATA). Re-anchoring will accumulate triples; M5
    introduces a separate edit path that DELETEs the old anchor first.
    When `isCustomEntity` is true, the entity's own RDF type + label
    are added to the SAME graph (auto-cleanup on annotation delete).
    """
    _validate_container(container)
    _validate_annotation_id(annotation_id)
    iri = annotation_iri(container, annotation_id)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Request body must be JSON.")
    if not isinstance(body, dict):
        raise HTTPException(400, "Request body must be a JSON object.")

    entity_class = body.get("entityClass")
    anchored_to  = body.get("isAnchoredTo")
    if not entity_class or not isinstance(entity_class, str):
        raise HTTPException(400, "Missing/invalid 'entityClass'.")
    if not anchored_to or not isinstance(anchored_to, str):
        raise HTTPException(400, "Missing/invalid 'isAnchoredTo'.")
    anchored_to_label = body.get("isAnchoredToLabel")
    is_custom         = bool(body.get("isCustomEntity", False))
    conceptual_level  = body.get("hasConceptualLevel")

    # CURIE → IRI expansion. Frontend uses the same prefixes that live
    # in the bundled JSON-LD context; here we mirror the minimal set
    # needed for the anchor payload. Anything not matching a prefix is
    # passed through as a full IRI.
    PREFIXES = {
        "mma":     settings.base_ns,
        "crm":     "http://www.cidoc-crm.org/cidoc-crm/",
        "mlao":    "https://w3id.org/mlao/",
        "geko":    "https://w3id.org/geko/",
        "icon":    "https://w3id.org/icon/ontology/",
        "skos":    "http://www.w3.org/2004/02/skos/core#",
        "interim": "https://w3id.org/interim/",
        "wd":      "http://www.wikidata.org/entity/",
        "rdfs":    "http://www.w3.org/2000/01/rdf-schema#",
    }
    def expand(curie_or_iri: str) -> str:
        if "://" in curie_or_iri:
            return curie_or_iri
        if ":" in curie_or_iri:
            prefix, _, local = curie_or_iri.partition(":")
            if prefix in PREFIXES:
                return PREFIXES[prefix] + local
        return curie_or_iri

    fuseki = get_client()

    # 404 if the annotation graph doesn't exist.
    if not await fuseki.graph_exists(iri):
        raise HTTPException(status_code=404,
                            detail=f"No annotation at {iri} to anchor.")

    # Build the anchor triples in a fresh Graph, then serialize as NT
    # and INSERT into the annotation's named graph (additive).
    g = Graph()
    ann      = URIRef(iri)
    anchor   = BNode()
    target   = URIRef(expand(anchored_to))
    klass    = URIRef(expand(entity_class))

    g.add((ann,    MLAO.hasAnchor,     anchor))
    g.add((anchor, RDF.type,           MLAO.Anchor))
    g.add((anchor, MLAO.isAnchoredTo,  target))
    if conceptual_level:
        g.add((anchor, MLAO.hasConceptualLevel, URIRef(expand(conceptual_level))))

    # Custom entity: stamp its type + label in the same graph so
    # deleting the annotation cleans them up automatically.
    if is_custom:
        g.add((target, RDF.type, klass))
        if anchored_to_label:
            g.add((target, RDFS.label, Literal(anchored_to_label, lang="en")))

    # Also stamp dcterms:modified on the annotation to reflect the
    # edit. dcterms:created on the annotation is preserved because we
    # never DROP, only INSERT.
    g.add((ann, DCTERMS.modified,
           Literal(provenance.now_iso(), datatype=XSD.dateTime)))

    nt = _serialize_nt(g)
    await fuseki.insert_graph(iri, nt)

    # Return the updated annotation, framed as JSON-LD.
    refreshed_nt = await fuseki.construct_graph(iri)
    refreshed_g = Graph()
    refreshed_g.parse(data=refreshed_nt, format="nt")
    return JSONResponse(
        content=graph_to_jsonld(refreshed_g, frame_iri=iri),
        media_type=JSON_LD_MIME,
    )


@router.delete("/{container}/{annotation_id}")
async def delete_annotation(container: str, annotation_id: str) -> Response:
    _validate_container(container)
    _validate_annotation_id(annotation_id)
    iri = annotation_iri(container, annotation_id)

    fuseki = get_client()
    existing_nt = await fuseki.construct_graph(iri)
    if not existing_nt.strip():
        raise HTTPException(status_code=404,
                            detail=f"No annotation at {iri} to delete.")

    await fuseki.drop_graph(iri)
    return Response(status_code=204)
