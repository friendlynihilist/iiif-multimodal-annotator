"""Static JSON-LD context endpoints.

The frontend POSTs annotations with `@context` pointing at one of these
URLs; the backend serves the file unchanged. The default profile context
is currently bundled at `contexts/multimodal-context.jsonld` and aliased
under several names so v1 emissions that mention `interim-geko` still
resolve.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import settings

router = APIRouter()

# Default-profile shortcuts. Phase 2+ may move per-profile contexts under
# profiles/<id>/context.jsonld; for Phase 1 we only ship the default.
_DEFAULT_PROFILE_ALIASES: frozenset[str] = frozenset(
    {"interim-geko", "multimodal-context", "default"}
)


@router.get("/contexts/{name}.jsonld")
def get_context(name: str):
    # 1. Literal filename in contexts/.
    direct = settings.contexts_dir / f"{name}.jsonld"
    if direct.is_file():
        return FileResponse(direct, media_type="application/ld+json")

    # 2. Per-profile context (profiles/<id>/context.jsonld).
    profile_ctx = settings.profiles_dir / name / "context.jsonld"
    if profile_ctx.is_file():
        return FileResponse(profile_ctx, media_type="application/ld+json")

    # 3. Default-profile aliases all resolve to the canonical bundled file.
    if name in _DEFAULT_PROFILE_ALIASES:
        default = settings.contexts_dir / "multimodal-context.jsonld"
        if default.is_file():
            return FileResponse(default, media_type="application/ld+json")

    raise HTTPException(status_code=404, detail=f"context not found: {name}")
