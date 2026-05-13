#!/usr/bin/env python3
"""End-to-end check that xsd:integer literals round-trip to JSON numbers
(not strings) through the WAP gateway.

Required because the frontend store (T1.5) will do arithmetic on
selector.start / selector.end, and string concatenation instead of
addition would be a particularly nasty silent bug.

Asserts:
  - body.selector.start / .end come back as Python int (not str) after
    POST and after GET
  - the same applies in the embedded list endpoint

Run:
  backend/.venv/bin/python backend/scripts/test_wap_native_types.py
"""
from __future__ import annotations

import sys

import httpx

BASE = "http://localhost:8000"
CONTAINER = "native-types-test"
TIMEOUT = 10.0


def assert_int(label: str, value) -> None:
    assert isinstance(value, int) and not isinstance(value, bool), (
        f"{label}: expected int, got {type(value).__name__} = {value!r}"
    )
    print(f"  ✓ {label} = {value} ({type(value).__name__})")


def main() -> int:
    payload = {
        "@context": f"{BASE}/contexts/interim-geko.jsonld",
        "type": "Annotation",
        "motivation": "linking",
        "body": {
            "type": "TextualBody",
            "value": "test native types",
            "format": "text/plain",
            "selector": {
                "type": "TextPositionSelector",
                "start": 245,
                "end": 264,
            },
        },
        "target": {
            "type": "SpecificResource",
            "source": "https://example.org/canvas/x",
            "selector": {
                "type": "FragmentSelector",
                "value": "xywh=0,0,100,100",
            },
        },
    }

    # POST
    with httpx.Client(timeout=TIMEOUT) as client:
        r = client.post(
            f"{BASE}/w3c/{CONTAINER}/",
            json=payload,
            headers={"Content-Type": "application/ld+json"},
        )
        r.raise_for_status()
        post_body = r.json()
        location = r.headers["location"]
        print(f"POST {r.status_code}  → {location}")
        sel = post_body["body"]["selector"]
        assert_int("post.body.selector.start", sel["start"])
        assert_int("post.body.selector.end",   sel["end"])

        # GET single
        ann_id = location.rsplit("/", 1)[-1]
        g = client.get(f"{BASE}/w3c/{CONTAINER}/{ann_id}")
        g.raise_for_status()
        get_body = g.json()
        sel = get_body["body"]["selector"]
        print(f"GET  {g.status_code}")
        assert_int("get.body.selector.start", sel["start"])
        assert_int("get.body.selector.end",   sel["end"])

        # GET list (embedded items)
        page = client.get(f"{BASE}/w3c/{CONTAINER}/")
        page.raise_for_status()
        pdoc = page.json()
        assert pdoc["type"] == "AnnotationPage", "list endpoint should return AnnotationPage"
        matching = [it for it in pdoc["items"] if it.get("id", "").endswith(ann_id)]
        assert matching, f"list endpoint did not embed annotation {ann_id}"
        sel = matching[0]["body"]["selector"]
        print(f"LIST {page.status_code}  ({len(pdoc['items'])} item(s))")
        assert_int("list.items[*].body.selector.start", sel["start"])
        assert_int("list.items[*].body.selector.end",   sel["end"])

        # Cleanup
        d = client.delete(f"{BASE}/w3c/{CONTAINER}/{ann_id}")
        d.raise_for_status()
        print(f"DELETE {d.status_code}")

    print("\n✓ Native types survive POST → triple store → GET / LIST.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
