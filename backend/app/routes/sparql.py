"""SPARQL passthrough endpoints.

Stubs in Phase 1 — T1.4/T2.5 will flesh these out into pass-through proxies
to Fuseki with response shape preserved (so YASGUI in the SPARQL panel can
talk directly to /sparql).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()

_NOT_YET = "Not yet implemented — scheduled for PHASE-1 task T1.4/T2.5."


@router.post("/sparql")
async def sparql_query():
    raise HTTPException(status_code=501, detail=_NOT_YET)


@router.post("/sparql/update")
async def sparql_update():
    raise HTTPException(status_code=501, detail=_NOT_YET)
