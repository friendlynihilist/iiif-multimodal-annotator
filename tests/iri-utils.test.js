/**
 * Tests for src/store/iri-utils.js — IRI normalization helpers.
 *
 * Run via the npm script `npm test` (Node's node:test runner; zero
 * devDependencies).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  expandIri,
  compactIri,
  iriEquals,
  getMmaNamespace,
  setMmaNamespace,
} from "../src/store/iri-utils.js";

describe("expandIri", () => {
  test("passes http:// IRIs through unchanged", () => {
    assert.equal(
      expandIri("http://example.org/foo"),
      "http://example.org/foo"
    );
  });

  test("passes https:// IRIs through unchanged", () => {
    const iri = "https://w3id.org/multimodal-annotator/ns/annotations/c/01H";
    assert.equal(expandIri(iri), iri);
  });

  test("expands a compact mma: IRI to the full namespace", () => {
    assert.equal(
      expandIri("mma:annotations/demo-bologna/01h"),
      "https://w3id.org/multimodal-annotator/ns/annotations/demo-bologna/01h"
    );
  });

  test("throws on empty / non-string input", () => {
    assert.throws(() => expandIri(""), /non-empty string/);
    assert.throws(() => expandIri(null), /non-empty string/);
    assert.throws(() => expandIri(undefined), /non-empty string/);
    assert.throws(() => expandIri(42), /non-empty string/);
  });

  test("throws on unrecognised IRI shape with a helpful message", () => {
    assert.throws(
      () => expandIri("urn:isbn:0451450523"),
      /unrecognised IRI form.*urn:isbn:0451450523/
    );
  });
});

describe("compactIri", () => {
  test("compacts an absolute mma namespace IRI", () => {
    assert.equal(
      compactIri(
        "https://w3id.org/multimodal-annotator/ns/annotations/demo/01h"
      ),
      "mma:annotations/demo/01h"
    );
  });

  test("passes foreign URLs through unchanged", () => {
    assert.equal(
      compactIri("http://www.cidoc-crm.org/cidoc-crm/E22_Human-Made_Object"),
      "http://www.cidoc-crm.org/cidoc-crm/E22_Human-Made_Object"
    );
  });

  test("passes an already-compact mma: IRI through", () => {
    assert.equal(
      compactIri("mma:annotations/x/01"),
      "mma:annotations/x/01"
    );
  });
});

describe("iriEquals", () => {
  test("treats compact and expanded forms as equal", () => {
    assert.ok(
      iriEquals(
        "mma:annotations/demo/01h",
        "https://w3id.org/multimodal-annotator/ns/annotations/demo/01h"
      )
    );
  });

  test("returns false for genuinely different IRIs", () => {
    assert.equal(
      iriEquals(
        "mma:annotations/demo/01h",
        "mma:annotations/demo/02j"
      ),
      false
    );
  });

  test("returns false for unrecognised shapes that aren't byte-equal", () => {
    assert.equal(iriEquals("foo:bar", "baz:qux"), false);
  });

  test("returns true for two byte-equal strings even if they don't expand", () => {
    assert.equal(iriEquals("foo:bar", "foo:bar"), true);
  });
});

describe("setMmaNamespace", () => {
  test("changes the namespace used by expandIri / compactIri", () => {
    const before = getMmaNamespace();
    try {
      setMmaNamespace("https://example.org/tool/", "tool:");
      assert.equal(expandIri("tool:foo/bar"), "https://example.org/tool/foo/bar");
      assert.equal(
        compactIri("https://example.org/tool/foo/bar"),
        "tool:foo/bar"
      );
    } finally {
      // Restore the default so subsequent tests see the default.
      setMmaNamespace(before.ns, before.prefix);
    }
  });
});
