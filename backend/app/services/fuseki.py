"""Async httpx client for Apache Jena Fuseki.

T1.3 implemented `ping` + `graph_triple_count` for the health check.
T1.4 extends this with SPARQL Update / CONSTRUCT / ASK / listing graphs
by IRI prefix, so the WAP routes can CRUD entire annotation graphs.
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

    @property
    def update_url(self) -> str:
        return f"{self.base_url}/{self.dataset}/update"

    async def ping(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(self.ping_url)
                return resp.status_code == 200
        except (httpx.HTTPError, OSError) as exc:
            log.debug("Fuseki ping failed: %s", exc)
            return False

    # ── SPARQL Update ────────────────────────────────────────────────

    async def sparql_update(self, update: str) -> None:
        """POST a SPARQL Update. Raises on non-2xx."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                self.update_url,
                data={"update": update},
                auth=self.auth,
            )
            resp.raise_for_status()

    async def insert_graph(self, graph_iri: str, ntriples: str) -> None:
        """Wrap `ntriples` (a string of N-Triples) in `INSERT DATA
        { GRAPH <iri> { ... } }` and send. Safe for graphs that
        already exist (additive)."""
        update = (
            f"INSERT DATA {{ GRAPH <{graph_iri}> {{\n{ntriples}\n}} }}"
        )
        await self.sparql_update(update)

    async def replace_graph(self, graph_iri: str, ntriples: str) -> None:
        """DROP + INSERT in one update, so the named graph atomically
        becomes exactly `ntriples`."""
        update = (
            f"DROP SILENT GRAPH <{graph_iri}> ;\n"
            f"INSERT DATA {{ GRAPH <{graph_iri}> {{\n{ntriples}\n}} }}"
        )
        await self.sparql_update(update)

    async def drop_graph(self, graph_iri: str) -> None:
        await self.sparql_update(f"DROP SILENT GRAPH <{graph_iri}>")

    # ── SPARQL Query ─────────────────────────────────────────────────

    async def construct_graph(self, graph_iri: str) -> str:
        """Return every triple in `graph_iri` as N-Triples (or empty
        string if the graph is absent or empty)."""
        query = (
            f"CONSTRUCT {{ ?s ?p ?o }} "
            f"WHERE {{ GRAPH <{graph_iri}> {{ ?s ?p ?o }} }}"
        )
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                self.sparql_url,
                data={"query": query},
                headers={"Accept": "application/n-triples"},
                auth=self.auth,
            )
            resp.raise_for_status()
            return resp.text

    async def graph_exists(self, graph_iri: str) -> bool:
        query = f"ASK {{ GRAPH <{graph_iri}> {{ ?s ?p ?o }} }}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                self.sparql_url,
                data={"query": query},
                headers={"Accept": "application/sparql-results+json"},
                auth=self.auth,
            )
            resp.raise_for_status()
            return bool(resp.json().get("boolean"))

    async def list_graphs_with_prefix(self, prefix: str) -> list[str]:
        """Distinct named graphs whose IRI starts with `prefix`. Useful
        for listing all annotations in a container."""
        query = (
            "SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } "
            f"FILTER(STRSTARTS(STR(?g), \"{prefix}\")) }} "
            "ORDER BY ?g"
        )
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                self.sparql_url,
                data={"query": query},
                headers={"Accept": "application/sparql-results+json"},
                auth=self.auth,
            )
            resp.raise_for_status()
            return [b["g"]["value"]
                    for b in resp.json()["results"]["bindings"]]

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
