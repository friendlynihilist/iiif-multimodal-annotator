"""JSON-LD ↔ RDF round-trip helpers.

We route both directions through pyld so the conversion matches what
`backend/scripts/test_context_roundtrip.py` validates. rdflib is the
in-memory triple store and serialises to N-Quads for the trip out.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from pyld import jsonld
from rdflib import Graph

from app.config import settings


@lru_cache(maxsize=1)
def load_default_context() -> dict[str, Any]:
    """Return the parsed `contexts/multimodal-context.jsonld`. Cached for
    the lifetime of the process; restart to pick up edits."""
    path = settings.contexts_dir / "multimodal-context.jsonld"
    with path.open() as fh:
        return json.load(fh)


_KNOWN_CONTEXT_PATHS = (
    "/contexts/interim-geko.jsonld",
    "/contexts/multimodal-context.jsonld",
    "/contexts/default.jsonld",
)


def _is_known_context_url(url: str) -> bool:
    return any(url.endswith(p) for p in _KNOWN_CONTEXT_PATHS)


def _inline_known_contexts(ctx: Any) -> Any:
    """Walk `ctx` (a JSON-LD @context value) and replace string URLs
    pointing at our own served context paths with the bundled inline
    context. Other URL contexts (W3C, IIIF) are passed through unchanged
    — pyld will try to dereference them. For Phase 1 we expect clients
    to use our context or inline their own."""
    default_ctx = load_default_context()["@context"]
    if isinstance(ctx, str):
        return default_ctx if _is_known_context_url(ctx) else ctx
    if isinstance(ctx, list):
        return [_inline_known_contexts(c) for c in ctx]
    return ctx  # dict / @context object — already inline


def jsonld_doc_to_graph(doc: dict[str, Any]) -> Graph:
    """Expand `doc` and return an rdflib Graph of the resulting triples.

    If the input has no `@context`, the profile default is attached. If
    it does, references to our own served context URLs are swapped
    inline (so pyld doesn't need a document loader at runtime); other
    references are left to pyld's default resolution.
    """
    if "@context" not in doc:
        doc = {**doc, "@context": load_default_context()["@context"]}
    else:
        doc = {**doc, "@context": _inline_known_contexts(doc["@context"])}
    expanded = jsonld.expand(doc)
    g = Graph()
    g.parse(data=json.dumps(expanded), format="json-ld")
    return g


def graph_to_jsonld(g: Graph, frame_iri: str | None = None) -> dict[str, Any]:
    """Serialise `g` back to compacted JSON-LD using the profile context.

    With `frame_iri`, the result is framed so the named node is the
    top-level subject (and everything else nests under it). Without a
    frame, the structure is whatever pyld produces from the RDF.
    """
    if len(g) == 0:
        return {"@context": load_default_context()["@context"]}

    # rdflib's nquads serializer requires a context-aware store; a plain
    # Graph isn't one. N-Triples is unambiguous and pyld.from_rdf accepts
    # it via the application/n-quads format (which is a superset).
    nt = g.serialize(format="nt")
    expanded = jsonld.from_rdf(nt, options={"format": "application/n-quads"})

    ctx_doc = load_default_context()
    if frame_iri is None:
        return jsonld.compact(expanded, ctx_doc["@context"])

    frame = {
        "@context": ctx_doc["@context"],
        "@id": frame_iri,
    }
    return jsonld.frame(expanded, frame)
