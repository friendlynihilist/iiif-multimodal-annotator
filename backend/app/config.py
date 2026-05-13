"""Environment-driven configuration. Loaded once at startup.

Phase 1 reads everything from environment variables (populated either by
docker-compose's `env_file: .env` or by a local shell exporting them). The
default values mirror `.env.example` so that running the backend without
any env still does something sensible against a locally-running Fuseki on
http://localhost:3030.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("mma.config")

REPO_ROOT = Path(__file__).resolve().parents[2]

# Passwords listed here trigger an insecure-default WARN at startup. Add
# vendor defaults here if we ever discover Fuseki ships with a different
# one.
_INSECURE_DEFAULTS: frozenset[str] = frozenset(
    {"changeme", "admin", "password", "fuseki", ""}
)


@dataclass(frozen=True)
class Settings:
    base_ns: str
    default_creator_iri: str
    fuseki_url: str
    fuseki_dataset: str
    fuseki_admin_user: str
    fuseki_admin_password: str
    cors_origins: tuple[str, ...]
    profiles_dir: Path
    contexts_dir: Path

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            base_ns=os.environ.get(
                "BASE_NS", "https://w3id.org/multimodal-annotator/ns/"
            ),
            default_creator_iri=os.environ.get("DEFAULT_CREATOR_IRI", ""),
            fuseki_url=os.environ.get("FUSEKI_URL", "http://localhost:3030"),
            fuseki_dataset=os.environ.get("FUSEKI_DATASET", "ds"),
            fuseki_admin_user=os.environ.get("FUSEKI_ADMIN_USER", "admin"),
            fuseki_admin_password=os.environ.get(
                "FUSEKI_ADMIN_PASSWORD", "changeme"
            ),
            cors_origins=tuple(
                origin.strip()
                for origin in os.environ.get("CORS_ORIGINS", "").split(",")
                if origin.strip()
            ),
            profiles_dir=Path(
                os.environ.get("PROFILES_DIR", str(REPO_ROOT / "profiles"))
            ),
            contexts_dir=Path(
                os.environ.get("CONTEXTS_DIR", str(REPO_ROOT / "contexts"))
            ),
        )

    @property
    def graph_base(self) -> str:
        """Base IRI under which profile-ontology named graphs are stored.

        `g:ontology:<id>` in ARCHITECTURE-v2 shorthand maps to
        `<base_ns>graphs/ontology/<id>` as a dereferenceable URL.
        """
        return self.base_ns.rstrip("/") + "/graphs/ontology"

    def warn_if_insecure(self) -> None:
        """Log a WARN when the admin password is a well-known default. The
        user explicitly asked for this safety net so we don't deploy with
        `changeme` to the September UX tests."""
        if self.fuseki_admin_password in _INSECURE_DEFAULTS:
            log.warning(
                "FUSEKI_ADMIN_PASSWORD is set to the well-known default %r. "
                "CHANGE BEFORE ANY PUBLIC DEPLOY.",
                self.fuseki_admin_password,
            )


settings = Settings.from_env()
