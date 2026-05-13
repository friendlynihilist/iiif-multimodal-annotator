"""IRI minting and container-name validation.

All annotation IRIs follow the HTTP pattern documented in CHANGELOG and
ARCHITECTURE-v2:

    <BASE_NS>annotations/<container>/<ulid_lowercase>

InterpretationAct IRIs nest under the annotation they describe:

    <BASE_NS>annotations/<container>/<ulid>/interpretation/<ulid>

ULIDs are generated in lowercase so the IRIs are visually consistent
with the conventional opaque-id-as-URL-path style. ULIDs sort
lexicographically by creation time, which is what we want for the
chain-of-InterpretationActs accumulated by PUT.
"""
from __future__ import annotations

import re

from ulid import ULID

from app.config import settings

CONTAINER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


def is_valid_container(container: str) -> bool:
    return bool(CONTAINER_PATTERN.fullmatch(container))


def new_ulid() -> str:
    """Crockford Base32 ULID, lowercased."""
    return str(ULID()).lower()


def annotation_base() -> str:
    return settings.base_ns.rstrip("/") + "/annotations"


def annotation_iri(container: str, annotation_id: str) -> str:
    return f"{annotation_base()}/{container}/{annotation_id}"


def mint_annotation_iri(container: str) -> tuple[str, str]:
    """Return `(annotation_id, full_iri)`. The id is a fresh ULID."""
    aid = new_ulid()
    return aid, annotation_iri(container, aid)


def mint_interpretation_act_iri(ann_iri: str) -> tuple[str, str]:
    """Return `(act_id, full_iri)` for a fresh InterpretationAct under
    the given annotation IRI."""
    aid = new_ulid()
    return aid, f"{ann_iri.rstrip('/')}/interpretation/{aid}"
