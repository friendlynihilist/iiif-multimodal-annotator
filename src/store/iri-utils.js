/**
 * IRI normalization helpers.
 *
 * The Multimodal Annotator stack routinely sees IRIs in both compact
 * (CURIE-like) and expanded form. The backend's JSON-LD compaction
 * yields `"id": "mma:annotations/<container>/<ulid>"` in responses,
 * while URL routing on the client (DELETE / PUT against the WAP
 * gateway) needs the path tail extracted — which is unambiguous only
 * from the expanded form.
 *
 * The mismatch surfaced as the T1.5b P0 delete bug (`Cannot parse
 * annotation IRI: mma:annotations/...` thrown inside
 * `iriToContainerAndId` before any fetch). This module centralises the
 * normalization so the store, the upcoming reload path (T1.6), the
 * SPARQL panel (T2.5) and the export function all go through one place.
 *
 * Whenever you touch an IRI on the client, route it through here.
 *
 * The namespace constants below mirror the `mma` term in
 * `contexts/multimodal-context.jsonld`. They are intentionally hard-
 * coded in Phase 1 because the bundled default profile pins them; if
 * a future profile registers a different tool namespace, override via
 * `setMmaNamespace()` at boot.
 */

let MMA_NS = "https://w3id.org/multimodal-annotator/ns/";
let MMA_PREFIX = "mma:";

/**
 * Override the namespace + prefix at boot (e.g. from the active
 * profile's manifest). Pass the absolute namespace IRI; the prefix is
 * left untouched unless you also pass it.
 */
export function setMmaNamespace(ns, prefix) {
  if (typeof ns === "string" && ns) MMA_NS = ns;
  if (typeof prefix === "string" && prefix) MMA_PREFIX = prefix;
}

export function getMmaNamespace() {
  return { ns: MMA_NS, prefix: MMA_PREFIX };
}

/**
 * Return the absolute http(s) form of an IRI. Compact `mma:` IRIs are
 * expanded; absolute URLs are passed through; anything else throws an
 * Error whose message includes the input and the two accepted shapes.
 */
export function expandIri(iri) {
  if (typeof iri !== "string" || !iri) {
    throw new TypeError(
      `expandIri: expected a non-empty string, got ${typeof iri}`
    );
  }
  if (iri.startsWith("http://") || iri.startsWith("https://")) return iri;
  if (iri.startsWith(MMA_PREFIX)) {
    return MMA_NS + iri.slice(MMA_PREFIX.length);
  }
  throw new Error(
    `expandIri: unrecognised IRI form. Expected http://, https://, or "${MMA_PREFIX}…". ` +
      `Got: ${iri}`
  );
}

/**
 * Return the compact `mma:`-prefixed form of an IRI for IRIs under our
 * namespace. Foreign absolute URLs are returned unchanged so callers
 * can store mixed-origin data without losing information.
 */
export function compactIri(iri) {
  if (typeof iri !== "string" || !iri) {
    throw new TypeError(
      `compactIri: expected a non-empty string, got ${typeof iri}`
    );
  }
  if (iri.startsWith(MMA_NS)) return MMA_PREFIX + iri.slice(MMA_NS.length);
  return iri;
}

/**
 * `true` if two IRIs refer to the same resource once normalized.
 * Useful for cache lookups where one side may be compact and the other
 * expanded.
 */
export function iriEquals(a, b) {
  if (a === b) return true;
  try {
    return expandIri(a) === expandIri(b);
  } catch (_) {
    return false;
  }
}
