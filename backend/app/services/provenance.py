"""HICO InterpretationAct + PROV-O provenance helpers.

The provenance model (per the briefing decisions on 2026-05-13):

  <annotation>
      a oa:Annotation ;
      prov:wasGeneratedBy <act_current> .

  <act_current>
      a hico:InterpretationAct, prov:Activity ;
      hico:hasInterpretationType "annotation"@en ;
      dcterms:creator <DEFAULT_CREATOR_IRI> ;
      prov:startedAtTime "..."^^xsd:dateTime ;
      rdfs:comment "Auto-generated default..."@en .

  <act_previous>
      a hico:InterpretationAct, prov:Activity ;
      ...
      dcterms:isReplacedBy <act_current> .

On POST the backend either accepts the client's provenance (if a
`prov:wasGeneratedBy` already points at a `hico:InterpretationAct`) or
generates the default Act above. On PUT a NEW Act is always minted; the
previous-most-recent Act gets a `dcterms:isReplacedBy` link to the new
one, and lives on in the named graph alongside it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import DCTERMS, RDF, RDFS, XSD

from app.config import settings
from app.services.iri import mint_interpretation_act_iri

HICO = Namespace("http://purl.org/emmedi/hico/")
PROV = Namespace("http://www.w3.org/ns/prov#")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def find_input_interpretation_act(g: Graph, ann_iri: URIRef) -> URIRef | None:
    """Return the Act the client attached to `ann_iri`, or None.

    A "valid" client-provided Act is something the input graph types as
    `hico:InterpretationAct` (it doesn't have to type it as `prov:Activity`
    too — we'll add that type ourselves if missing to keep the RDF
    consistent with the ontology hierarchy)."""
    for act in g.objects(ann_iri, PROV.wasGeneratedBy):
        if (act, RDF.type, HICO.InterpretationAct) in g:
            return act  # type: ignore[return-value]
    return None


def ensure_activity_type(g: Graph, act: URIRef) -> None:
    """Make sure `act` has both rdf:type hico:InterpretationAct AND
    prov:Activity. Idempotent."""
    g.add((act, RDF.type, HICO.InterpretationAct))
    g.add((act, RDF.type, PROV.Activity))


def add_default_act(g: Graph, ann_iri: URIRef) -> URIRef:
    """Mint and attach a default auto-generated InterpretationAct to
    `ann_iri` in `g`. Returns the new Act IRI."""
    _, act_iri = mint_interpretation_act_iri(str(ann_iri))
    act = URIRef(act_iri)

    ensure_activity_type(g, act)
    g.add((act, HICO.hasInterpretationType, Literal("annotation", lang="en")))
    g.add((act, PROV.startedAtTime, Literal(now_iso(), datatype=XSD.dateTime)))
    g.add((act, RDFS.comment, Literal(
        "Auto-generated default; replace with explicit interpretation in "
        "Phase 3 UI.",
        lang="en",
    )))
    if settings.default_creator_iri:
        g.add((act, DCTERMS.creator, URIRef(settings.default_creator_iri)))

    g.add((ann_iri, PROV.wasGeneratedBy, act))
    return act


def list_acts(g: Graph) -> list[URIRef]:
    """All hico:InterpretationAct IRIs in `g`."""
    return list(g.subjects(RDF.type, HICO.InterpretationAct))  # type: ignore[arg-type]


def latest_act(g: Graph) -> URIRef | None:
    """The Act in `g` that has no outgoing `dcterms:isReplacedBy` —
    i.e. the head of the replacement chain. If multiple candidates
    (shouldn't happen in normal use), pick the one with the largest
    `prov:startedAtTime`."""
    candidates: list[tuple[str, URIRef]] = []
    for act in list_acts(g):
        if any(g.objects(act, DCTERMS.isReplacedBy)):
            continue
        started = next(iter(g.objects(act, PROV.startedAtTime)), Literal(""))
        candidates.append((str(started), act))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def stamp_replacement(g: Graph, old: URIRef, new: URIRef) -> None:
    """Record that `old` was replaced by `new` (dcterms:isReplacedBy)."""
    g.add((old, DCTERMS.isReplacedBy, new))


def filter_act_triples(g: Graph) -> Iterable:
    """Yield every triple in `g` whose subject is an InterpretationAct
    (or its replacement-target). Used to preserve provenance across a
    PUT, which otherwise drops the old annotation triples."""
    acts = set(list_acts(g))
    for s, p, o in g:
        if s in acts:
            yield (s, p, o)
