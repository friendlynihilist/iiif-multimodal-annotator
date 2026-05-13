"""FastAPI entry point for the Multimodal Annotator backend gateway."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import contexts as contexts_routes
from app.routes import health as health_routes
from app.routes import profiles as profiles_routes
from app.routes import sparql as sparql_routes
from app.routes import wap as wap_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("mma")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Multimodal Annotator backend starting")
    settings.warn_if_insecure()
    log.info("Fuseki URL:     %s (dataset: %s)",
             settings.fuseki_url, settings.fuseki_dataset)
    log.info("Profile dir:    %s", settings.profiles_dir)
    log.info("Context dir:    %s", settings.contexts_dir)
    log.info("Graph base IRI: %s/<profile_id>", settings.graph_base)
    log.info("CORS origins:   %s", list(settings.cors_origins) or "(none)")
    yield
    log.info("Multimodal Annotator backend shutting down")


app = FastAPI(
    title="Multimodal Annotator backend",
    version="0.2.0-dev",
    lifespan=lifespan,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

app.include_router(health_routes.router)
app.include_router(profiles_routes.router)
app.include_router(contexts_routes.router)
app.include_router(wap_routes.router)
app.include_router(sparql_routes.router)
