"""Async httpx client for Apache Jena Fuseki.

Phase 1 implements only what `/health` needs (ping + a triple-count query
against a named graph). T1.4 will extend this with full SPARQL Query /
Update and Graph Store Protocol surfaces.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import settings

log = logging.getLogger("mma.fuseki")


class FusekiClient:
    def __init__(
        self,
        base_url: str,
        dataset: str,
        user: str,
        password: str,
        timeout: float = 5.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.dataset = dataset
        self.auth: tuple[str, str] = (user, password)
        self.timeout = timeout

    @property
    def ping_url(self) -> str:
        return f"{self.base_url}/$/ping"

    @property
    def sparql_url(self) -> str:
        return f"{self.base_url}/{self.dataset}/sparql"

    async def ping(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(self.ping_url)
                return resp.status_code == 200
        except (httpx.HTTPError, OSError) as exc:
            log.debug("Fuseki ping failed: %s", exc)
            return False

    async def graph_triple_count(self, graph_iri: str) -> Optional[int]:
        """Return the triple count for `graph_iri`, or None if the query
        fails (separately distinguishable from "graph exists but is empty",
        which returns 0)."""
        query = (
            "SELECT (COUNT(*) AS ?c) "
            f"WHERE {{ GRAPH <{graph_iri}> {{ ?s ?p ?o }} }}"
        )
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    self.sparql_url,
                    data={"query": query},
                    headers={"Accept": "application/sparql-results+json"},
                    auth=self.auth,
                )
                resp.raise_for_status()
                body = resp.json()
                bindings = body["results"]["bindings"]
                if not bindings:
                    return 0
                return int(bindings[0]["c"]["value"])
        except (httpx.HTTPError, OSError, KeyError, ValueError) as exc:
            log.warning("graph_triple_count failed for <%s>: %s", graph_iri, exc)
            return None


def get_client() -> FusekiClient:
    return FusekiClient(
        base_url=settings.fuseki_url,
        dataset=settings.fuseki_dataset,
        user=settings.fuseki_admin_user,
        password=settings.fuseki_admin_password,
    )
