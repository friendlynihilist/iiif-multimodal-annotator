"""SPARQL passthrough endpoints (T2.5).

The frontend SPARQL panel (YASGUI in the Query & Analytics tab) hits
these routes instead of talking to Fuseki directly. That keeps CORS,
auth, and any future SHACL / query-rewriting concerns on the gateway,
not the triple store. For Phase 1 this is a thin proxy: every query
goes through to Fuseki untransformed.

- `GET /sparql` / `POST /sparql` — SPARQL Query (read).
- `POST /sparql/update` — SPARQL Update; left as 501 in Phase 1 until
  T3 introduces auth. Writes flow through the WAP routes (T1.4)
  for now; raw Update is admin-only.
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from app.services.fuseki import get_client

log = logging.getLogger("mma.sparql")
router = APIRouter()

# Conservative timeout — long enough for the kind of small-corpus
# analytics the poster demo runs (counts, group-bys); short enough
# that the UI doesn't hang on a misbehaving query.
_TIMEOUT_SECONDS = 30.0


async def _proxy_query(request: Request) -> Response:
    """Forward an incoming SPARQL Query to Fuseki, mirror the response."""
    fuseki = get_client()
    accept = request.headers.get("accept") or "application/sparql-results+json"

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        if request.method == "POST":
            body = await request.body()
            content_type = (
                request.headers.get("content-type")
                or "application/x-www-form-urlencoded"
            )
            resp = await client.post(
                fuseki.sparql_url,
                content=body,
                headers={"Accept": accept, "Content-Type": content_type},
                auth=fuseki.auth,
            )
        else:
            resp = await client.get(
                fuseki.sparql_url,
                params=dict(request.query_params),
                headers={"Accept": accept},
                auth=fuseki.auth,
            )

    # Return Fuseki's payload with its Content-Type intact (JSON, XML,
    # CSV, TSV — YASGUI handles all of them based on the chosen render).
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type"),
    )


@router.post("/sparql")
async def sparql_query_post(request: Request) -> Response:
    return await _proxy_query(request)


@router.get("/sparql")
async def sparql_query_get(request: Request) -> Response:
    return await _proxy_query(request)


@router.post("/sparql/update")
async def sparql_update():
    # Writes go through the WAP CRUD surface (T1.4). Raw SPARQL Update
    # access stays gated behind admin auth until Phase 3.
    raise HTTPException(
        status_code=501,
        detail="Raw SPARQL Update is admin-only; pending Phase 3 auth.",
    )
