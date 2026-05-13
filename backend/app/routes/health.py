"""Three-state `/health` endpoint.

  ok        — Fuseki is reachable AND every profile's ontology graph has
              ≥1 triple.
  degraded  — Fuseki is reachable but one or more profile ontologies are
              missing / empty (operator should run scripts/bootstrap-fuseki.sh).
  down      — Fuseki is not reachable at all.

The endpoint always returns HTTP 200 with the state encoded in the body so
that load balancers and the frontend can read the diagnostic without
distinguishing "service crashed" from "service is reporting degraded".
"""
from __future__ import annotations

from fastapi import APIRouter

from app.services.fuseki import get_client
from app.services.profiles import (
    graph_iri_for_ontology,
    list_profile_ids,
)

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    client = get_client()
    fuseki_up = await client.ping()
    if not fuseki_up:
        return {
            "status": "down",
            "fuseki": False,
            "detail": f"Fuseki unreachable at {client.ping_url}",
        }

    missing: list[dict] = []
    for profile_id in list_profile_ids():
        graph = graph_iri_for_ontology(profile_id)
        count = await client.graph_triple_count(graph)
        if not count:
            # count is None (query failed) or 0 (empty graph). Either way,
            # the bootstrap script needs to run.
            missing.append(
                {
                    "profile": profile_id,
                    "graph": graph,
                    "triples": count if count is not None else "unknown",
                }
            )

    if missing:
        return {
            "status": "degraded",
            "fuseki": True,
            "missing_ontologies": missing,
            "hint": "Run ./scripts/bootstrap-fuseki.sh to load missing graphs.",
        }

    return {"status": "ok", "fuseki": True}
