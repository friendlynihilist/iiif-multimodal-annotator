"""Profile-manifest endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services.profiles import list_profile_ids, load_manifest

router = APIRouter()


@router.get("/profiles")
def list_profiles() -> dict:
    return {"profiles": [load_manifest(pid) for pid in list_profile_ids()]}


@router.get("/profiles/{profile_id}")
def get_profile(profile_id: str) -> dict:
    try:
        return load_manifest(profile_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404,
                            detail=f"unknown profile: {profile_id}")
