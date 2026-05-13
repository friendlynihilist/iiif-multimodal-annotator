"""Profile manifest loading.

A profile lives under `profiles/<id>/` and is declared by a `manifest.json`
that matches the schema in ARCHITECTURE-v2 §"Manifest schema". The loader
is read-only and stateless — Phase 1 has no profile-writing API.
"""
from __future__ import annotations

import json
from typing import Any

from app.config import settings


def list_profile_ids() -> list[str]:
    """Sorted IDs of every profile directory that has a manifest.json."""
    root = settings.profiles_dir
    if not root.is_dir():
        return []
    return sorted(
        p.name
        for p in root.iterdir()
        if p.is_dir() and (p / "manifest.json").is_file()
    )


def load_manifest(profile_id: str) -> dict[str, Any]:
    manifest_path = settings.profiles_dir / profile_id / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(profile_id)
    with manifest_path.open() as fh:
        return json.load(fh)


def graph_iri_for_ontology(profile_id: str) -> str:
    """Named-graph IRI under which the profile's ontology lives in Fuseki.

    Matches `scripts/bootstrap-fuseki.sh`'s `${BASE_NS}graphs/ontology/<id>`
    convention so the health check and the loader agree on where to look.
    """
    return f"{settings.graph_base}/{profile_id}"
