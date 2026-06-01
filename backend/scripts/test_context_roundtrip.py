#!/usr/bin/env python3
"""
T1.2 round-trip validator for the default profile's JSON-LD @context.

Loads `contexts/multimodal-context.jsonld`, builds annotations that mirror
every shape the v1 frontend currently emits (with the Phase 1 corrections
applied — HICO at purl.org/emmedi/hico/, mma:profile in place of interim:profile),
expands each through pyld, and reports any term that is lost.

A term is "lost" if it is present as a non-`@`-keyed key in the input but no
property with that key's expected IRI ends up in the expanded output. The
script also prints the full expansion of each sample for visual inspection.

Run:
  backend/.venv/bin/python backend/scripts/test_context_roundtrip.py

Exit status:
  0 — every input term has a mapped IRI in the expanded RDF.
  1 — at least one term was dropped (the context needs an entry for it).

This script will be promoted into backend/app/tests/ when T1.3 lands.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from pyld import jsonld
from rdflib import Graph

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTEXT_PATH = REPO_ROOT / "contexts" / "multimodal-context.jsonld"

# ─── Context loading ────────────────────────────────────────────────────────
with CONTEXT_PATH.open() as fh:
    MM_CTX_DOC = json.load(fh)
MM_CTX = MM_CTX_DOC["@context"]

# In production, annotations carry a single `@context` pointing at the
# backend's published profile context (`/contexts/interim-geko.jsonld`).
# The profile context bundles every OA term, so no remote fetch of
# `http://www.w3.org/ns/anno.jsonld` is required at runtime.
COMBINED_CTX: Any = MM_CTX


# ─── Samples that mirror the v1 frontend's actual emission ──────────────────
# (See `createConnectionBetween` in src/components/multimodal-annotator.js
#  for the canonical shape. Phase 1 corrections applied below.)

def sample_ekphrastic_linking() -> dict:
    """Image-panel linking annotation, GEKO denotation modality."""
    return {
        "@context": COMBINED_CTX,
        "type": "Annotation",
        "id": "https://example.org/anno/123",
        "motivation": "linking",
        "body": {
            "type": "TextualBody",
            "value": "il turbante di seta",
            "format": "text/plain",
            "selector": {
                "type": "Choice",
                "items": [
                    {"type": "TextPositionSelector", "start": 245, "end": 264},
                    {"type": "TextQuoteSelector",
                     "exact": "il turbante di seta",
                     "prefix": "...vediamo poi ",
                     "suffix": " che le cinge il capo..."},
                ],
            },
            # Non-standard v1 field: a typing string for the body.
            "class": "lrmoo:F2_Expression",
        },
        "target": {
            "type": "Image",
            "source": "https://example.org/canvas/p1",
            "selector": {
                "type": "FragmentSelector",
                "conformsTo": "http://www.w3.org/TR/media-frags/",
                "value": "xywh=412,180,260,140",
            },
            "class": "lrmoo:F1_Work",
            "canvasId": "https://example.org/canvas/p1",
            "canvasIndex": 0,
            "canvasLabel": "Pagina 1",
        },
        # Non-standard v1 fields: redundant pair (modality token + property URI).
        # The URI here matches the post-fix https form emitted by v0.2.0-dev.
        "property": "https://w3id.org/geko/denotation",
        "modality": "denotation",
        # Phase 1 correction: was `interim:profile`, now `mma:profile`.
        "profile": "https://w3id.org/multimodal-annotator/profiles/interim-geko",
        "created": "2026-05-12T18:42:00Z",
    }


def sample_transcribing() -> dict:
    """Facsimile-panel transcribing annotation, carries PAGE-XML coords."""
    return {
        "@context": COMBINED_CTX,
        "type": "Annotation",
        "id": "https://example.org/anno/456",
        "motivation": "transcribing",
        "body": {
            "type": "TextualBody",
            "value": "Ritornando a parlare dell'oggetto",
            "format": "text/plain",
            "selector": {"type": "TextPositionSelector", "start": 0, "end": 33},
            "lineId": "tr_1_tl_2",
            "coords": "224,547 293,543 360,540 ...",
            "pageNr": 18,
        },
        "target": {
            "type": "Image",
            "source": "https://dl.ficlit.unibo.it/iiif/2/19266/canvas/p18",
            "selector": {
                "type": "FragmentSelector",
                "conformsTo": "http://www.w3.org/TR/media-frags/",
                "value": "xywh=224,540,140,30",
            },
            "canvasId": "https://dl.ficlit.unibo.it/iiif/2/19266/canvas/p18",
            "canvasIndex": 17,
            "canvasLabel": "p18",
        },
        "profile": "https://w3id.org/multimodal-annotator/profiles/interim-geko",
        "created": "2026-05-13T09:30:00Z",
    }


def sample_standalone_comment() -> dict:
    """Standalone (no link) text annotation with a free-text comment body."""
    return {
        "@context": COMBINED_CTX,
        "type": "Annotation",
        "id": "https://example.org/anno/789",
        "motivation": "commenting",
        "body": {
            "type": "TextualBody",
            "value": "Note on the silk turban as a non-symbolic detail.",
            "format": "text/plain",
        },
        "target": {
            "type": "Text",
            "source": "Osservando la Fornarina...",
            "selector": {"type": "TextPositionSelector", "start": 0, "end": 24},
        },
        "annotationType": "comment",
        "profile": "https://w3id.org/multimodal-annotator/profiles/interim-geko",
        "created": "2026-05-13T10:00:00Z",
    }


def sample_with_provenance() -> dict:
    """Canonical interim-geko sample exercising HICO + MLAO + ICON usage."""
    return {
        "@context": COMBINED_CTX,
        "type": "Annotation",
        "id": "https://example.org/anno/relazione-turbante",
        "motivation": "linking",
        "body": {
            "type": "TextualBody",
            "value": "Materic rendering of silk, ignoring symbolic value.",
            "format": "text/plain",
            "language": "en",
        },
        "target": {
            "source": "https://example.org/canvas/p1",
            "selector": {
                "type": "FragmentSelector",
                "value": "xywh=350,120,100,40",
            },
        },
        "hasEkphrasticModality": "denotation",
        "wasGeneratedBy": {
            "type": ["InterpretationAct", "Activity"],
            "hasInterpretationType": "ekphrasis",
            "hasInterpretationCriterion":
                "http://purl.org/emmedi/hico/criterion/iconographical-analysis",
            "creator": "https://orcid.org/0000-0002-4115-0078",
            "startedAtTime": "2026-05-13T11:00:00Z",
        },
        "hasAnchor": {
            "type": "Anchor",
            "hasConceptualLevel": "IconographicalSubject",
            "isAnchoredTo": "https://example.org/concepts/turbante-seta",
        },
        "profile": "https://w3id.org/multimodal-annotator/profiles/interim-geko",
        "created": "2026-05-13T11:00:00Z",
    }


SAMPLES = {
    "ekphrastic_linking":  sample_ekphrastic_linking(),
    "transcribing":        sample_transcribing(),
    "standalone_comment":  sample_standalone_comment(),
    "with_provenance":     sample_with_provenance(),
}


# ─── Walkers ────────────────────────────────────────────────────────────────

def collect_input_keys(obj: Any, keys: set[str] | None = None) -> set[str]:
    """Every non-`@` / non-`_comment_*` key reachable from `obj`."""
    if keys is None:
        keys = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.startswith("@") or k.startswith("_"):
                continue
            keys.add(k)
            collect_input_keys(v, keys)
    elif isinstance(obj, list):
        for item in obj:
            collect_input_keys(item, keys)
    return keys


def collect_expanded_iris(obj: Any, iris: set[str] | None = None) -> set[str]:
    """Every IRI used as a property key (or @type value) in the expanded JSON-LD.

    pyld wraps `@container: @list` values as `{"@list": [...]}`; we descend through
    those wrappers transparently so list-typed terms count as 'present'."""
    if iris is None:
        iris = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "@list":
                # Descend into list-wrapped values.
                collect_expanded_iris(v, iris)
                continue
            if k.startswith("@"):
                if k == "@type":
                    if isinstance(v, list):
                        iris.update(str(t) for t in v)
                    else:
                        iris.add(str(v))
                continue
            iris.add(k)
            collect_expanded_iris(v, iris)
    elif isinstance(obj, list):
        for item in obj:
            collect_expanded_iris(item, iris)
    return iris


# Terms in the @context that are aliases for JSON-LD keywords (e.g.
# `"id": "@id"`). These never appear as keys in the expanded output —
# their values are folded into `@id` / `@type` — so the diagnostic should
# treat them as trivially covered.
def keyword_aliases(ctx: dict) -> set[str]:
    return {term for term, val in ctx.items()
            if isinstance(val, str) and val.startswith("@")}


def term_to_expected_iri(term: str, ctx: dict) -> str | None:
    """Resolve `term` to the IRI it should expand to, per `ctx`. Returns None
    if the term is not declared (i.e., would be dropped on expansion)."""
    entry = ctx.get(term)
    if entry is None:
        return None
    if isinstance(entry, str):
        return _resolve_compact(entry, ctx)
    if isinstance(entry, dict):
        iri = entry.get("@id")
        if iri is None:
            return None
        return _resolve_compact(iri, ctx)
    return None


def _resolve_compact(iri: str, ctx: dict) -> str:
    """If `iri` is a compact form `prefix:local` and the prefix is mapped in
    `ctx`, expand it. Otherwise return as-is."""
    if iri.startswith(("http://", "https://", "urn:")):
        return iri
    if ":" in iri:
        prefix, local = iri.split(":", 1)
        base = ctx.get(prefix)
        if isinstance(base, str):
            return base + local
    return iri


# ─── Main ───────────────────────────────────────────────────────────────────

def main() -> int:
    print(f"Context: {CONTEXT_PATH}")
    term_count = sum(1 for k in MM_CTX if not k.startswith('@'))
    print(f"  terms in @context: {term_count}")
    aliases = keyword_aliases(MM_CTX)
    print(f"  keyword-alias terms (never appear as keys post-expand): {sorted(aliases)}")
    print()

    all_lost: dict[str, set[str]] = {}

    for name, doc in SAMPLES.items():
        print(f"─── {name} " + "─" * (60 - len(name)))
        input_keys = collect_input_keys(doc)
        try:
            expanded = jsonld.expand(doc)
        except Exception as exc:
            print(f"  EXPAND FAILED: {exc}")
            all_lost[name] = input_keys
            continue
        expanded_iris = collect_expanded_iris(expanded)

        lost_for_sample: set[str] = set()
        for key in sorted(input_keys):
            if key in aliases:
                status = "OK (keyword)"
            else:
                expected = term_to_expected_iri(key, MM_CTX)
                if expected is not None and expected in expanded_iris:
                    status = "OK"
                else:
                    status = "LOST"
                    lost_for_sample.add(key)
            print(f"  {status:18s}  {key}")
        if lost_for_sample:
            all_lost[name] = lost_for_sample
        print()

    if not all_lost:
        print("ALL SAMPLES ROUND-TRIP CLEANLY.")
        print()
        print("─── RDF triple counts (rdflib serialisation sanity check) ─────")
        for name, doc in SAMPLES.items():
            expanded = jsonld.expand(doc)
            g = Graph()
            g.parse(data=json.dumps(expanded), format="json-ld")
            print(f"  {name:24s}  {len(g)} triples")
        print()
        print("Turtle of the ekphrastic_linking sample (visual sanity check):")
        expanded = jsonld.expand(SAMPLES["ekphrastic_linking"])
        g = Graph()
        for ns in ("oa", "dcterms", "geko", "interim", "mlao", "icon", "hico",
                   "lrmoo", "crm", "mma", "rdf", "rdfs", "xsd", "skos", "foaf"):
            iri = MM_CTX.get(ns)
            if isinstance(iri, str):
                g.bind(ns, iri)
        g.parse(data=json.dumps(expanded), format="json-ld")
        print(g.serialize(format="turtle"))
        return 0

    print("─── DROPPED TERMS ─────────────────────────────────────────────")
    for sample, terms in all_lost.items():
        print(f"  {sample}: {sorted(terms)}")
    print()
    print("Dump expansion of first failing sample for inspection:")
    failing = next(iter(all_lost))
    expanded = jsonld.expand(SAMPLES[failing])
    print(json.dumps(expanded, indent=2))
    return 1


if __name__ == "__main__":
    sys.exit(main())
