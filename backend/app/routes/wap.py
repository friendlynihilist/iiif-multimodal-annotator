"""W3C Web Annotation Protocol routes.

Stubs in Phase 1 — the full CRUD ↔ SPARQL Update translation lands in
T1.4. Every method returns 501 with a pointer to the implementing task,
which is preferable to 404 because the route surface itself is part of
the architecture and known to the frontend.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/w3c")

_NOT_YET = "Not yet implemented — scheduled for PHASE-1 task T1.4."


@router.post("/{container}/")
async def create_annotation(container: str):
    raise HTTPException(status_code=501, detail=_NOT_YET)


@router.get("/{container}/")
async def list_annotations(container: str):
    raise HTTPException(status_code=501, detail=_NOT_YET)


@router.get("/{container}/{annotation_id}")
async def get_annotation(container: str, annotation_id: str):
    raise HTTPException(status_code=501, detail=_NOT_YET)


@router.put("/{container}/{annotation_id}")
async def update_annotation(container: str, annotation_id: str):
    raise HTTPException(status_code=501, detail=_NOT_YET)


@router.delete("/{container}/{annotation_id}")
async def delete_annotation(container: str, annotation_id: str):
    raise HTTPException(status_code=501, detail=_NOT_YET)
