/**
 * Tests for src/store/annotation-store.js — happy path + error rollback for
 * load / create / update / remove, plus the optimistic-update event order.
 *
 * Uses node:test + node:assert/strict, so no new devDependency. Run:
 *   npm test
 * or directly:
 *   node --test tests/
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { AnnotationStore } from "../src/store/annotation-store.js";

// ── tiny fetch mock ─────────────────────────────────────────────────

function buildResponse({ status = 200, body = null, headers = {} } = {}) {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: (k) => headerMap.get(k.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body ?? "")),
  };
}

function makeFetchMock(routes) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url: String(url), method, body: init.body });
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (!handler) {
      return buildResponse({ status: 404, body: { detail: `no mock for ${key}` } });
    }
    return handler({ url, init, calls });
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

// ── fixtures ────────────────────────────────────────────────────────

const BASE = "http://test.local";
const CONTAINER = "demo";
const REAL_IRI = `https://w3id.org/multimodal-annotator/ns/annotations/${CONTAINER}/01krgr00000000000000000001`;
const REAL_ID = "01krgr00000000000000000001";

function newAnnotationBody() {
  return {
    type: "Annotation",
    motivation: "linking",
    body: { type: "TextualBody", value: "x" },
    target: { source: "https://example.org/c" },
  };
}

function newServerSaved() {
  return {
    id: REAL_IRI,
    type: "Annotation",
    motivation: "linking",
    body: { type: "TextualBody", value: "x" },
    target: { source: "https://example.org/c" },
    created: "2026-05-13T14:00:00Z",
    modified: "2026-05-13T14:00:00Z",
  };
}

// ── tests ───────────────────────────────────────────────────────────

describe("AnnotationStore.load", () => {
  test("populates the cache from the server's AnnotationPage", async () => {
    const fetchImpl = makeFetchMock({
      [`GET ${BASE}/w3c/${CONTAINER}/`]: async () =>
        buildResponse({
          status: 200,
          body: { type: "AnnotationPage", items: [newServerSaved()] },
          headers: { "content-type": "application/ld+json" },
        }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const events = [];
    store.on("store:loaded", (e) => events.push(e.detail));

    const items = await store.load(CONTAINER);

    assert.equal(items.length, 1);
    assert.equal(store.all().length, 1);
    assert.deepEqual(store.get(REAL_IRI).id, REAL_IRI);
    assert.deepEqual(events, [{ container: CONTAINER, count: 1 }]);
  });

  test("on network error emits store:error and rejects", async () => {
    const fetchImpl = async () => {
      throw new TypeError("network down");
    };
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const errors = [];
    store.on("store:error", (e) => errors.push(e.detail));

    await assert.rejects(() => store.load(CONTAINER), /network down/);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].op, "load");
    assert.equal(store.all().length, 0);
  });
});

describe("AnnotationStore.create (optimistic)", () => {
  test("emits annotation:created with temp IRI, then annotation:updated with real IRI", async () => {
    const saved = newServerSaved();
    const fetchImpl = makeFetchMock({
      [`POST ${BASE}/w3c/${CONTAINER}/`]: async () =>
        buildResponse({
          status: 201,
          body: saved,
          headers: { "content-type": "application/ld+json", location: REAL_IRI },
        }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });

    const events = [];
    store.on("annotation:created", (e) => events.push({ type: "created", ...e.detail }));
    store.on("annotation:updated", (e) => events.push({ type: "updated", ...e.detail }));

    const result = await store.create(CONTAINER, newAnnotationBody());

    assert.deepEqual(result, saved);

    // Exactly two events, in the right order.
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "created");
    assert.equal(events[0].optimistic, true);
    assert.ok(events[0].annotation.id.startsWith("temp:"));
    const tempIri = events[0].tempIri;

    assert.equal(events[1].type, "updated");
    assert.equal(events[1].tempIri, tempIri);
    assert.equal(events[1].annotation.id, REAL_IRI);

    // Cache only has the real IRI.
    assert.equal(store.get(REAL_IRI).id, REAL_IRI);
    assert.equal(store.get(tempIri), undefined);
  });

  test("on HTTP error removes the optimistic entry and emits store:error", async () => {
    const fetchImpl = makeFetchMock({
      [`POST ${BASE}/w3c/${CONTAINER}/`]: async () =>
        buildResponse({ status: 500, body: "boom" }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });

    const created = [];
    const errors = [];
    store.on("annotation:created", (e) => created.push(e.detail));
    store.on("store:error", (e) => errors.push(e.detail));

    await assert.rejects(() => store.create(CONTAINER, newAnnotationBody()), /HTTP 500/);

    assert.equal(created.length, 1);
    assert.equal(created[0].optimistic, true);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].op, "create");
    assert.equal(errors[0].tempIri, created[0].tempIri);
    assert.equal(store.all().length, 0);
  });
});

describe("AnnotationStore.update (optimistic)", () => {
  test("applies optimistically, then settles with server response", async () => {
    const updated = { ...newServerSaved(), body: { type: "TextualBody", value: "REVISED" } };
    const fetchImpl = makeFetchMock({
      [`PUT ${BASE}/w3c/${CONTAINER}/${REAL_ID}`]: async () =>
        buildResponse({
          status: 200,
          body: updated,
          headers: { "content-type": "application/ld+json" },
        }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    store.cache.set(REAL_IRI, newServerSaved());

    const events = [];
    store.on("annotation:updated", (e) => events.push(e.detail));

    const result = await store.update(REAL_IRI, {
      ...newAnnotationBody(),
      body: { type: "TextualBody", value: "REVISED" },
    });

    assert.equal(result.body.value, "REVISED");
    // Two updated events: the optimistic apply and the server-confirmed settle.
    assert.equal(events.length, 2);
    assert.equal(events[0].annotation.body.value, "REVISED");
    assert.equal(events[1].annotation.body.value, "REVISED");
    assert.equal(store.get(REAL_IRI).body.value, "REVISED");
  });

  test("on HTTP error rolls back the cache and emits store:error", async () => {
    const fetchImpl = makeFetchMock({
      [`PUT ${BASE}/w3c/${CONTAINER}/${REAL_ID}`]: async () =>
        buildResponse({ status: 500, body: "boom" }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const original = newServerSaved();
    store.cache.set(REAL_IRI, original);

    const errors = [];
    store.on("store:error", (e) => errors.push(e.detail));

    await assert.rejects(
      () => store.update(REAL_IRI, { ...newAnnotationBody(), body: { type: "TextualBody", value: "NOPE" } }),
      /HTTP 500/,
    );

    assert.equal(errors.length, 1);
    assert.equal(errors[0].op, "update");
    assert.deepEqual(store.get(REAL_IRI), original);
  });
});

describe("AnnotationStore.remove (optimistic)", () => {
  test("removes immediately, succeeds on HTTP 204", async () => {
    const fetchImpl = makeFetchMock({
      [`DELETE ${BASE}/w3c/${CONTAINER}/${REAL_ID}`]: async () =>
        buildResponse({ status: 204 }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    store.cache.set(REAL_IRI, newServerSaved());

    const removed = [];
    store.on("annotation:removed", (e) => removed.push(e.detail));

    await store.remove(REAL_IRI);

    assert.equal(removed.length, 1);
    assert.equal(removed[0].iri, REAL_IRI);
    assert.equal(store.get(REAL_IRI), undefined);
  });

  test("on HTTP error reinstates the entry", async () => {
    const fetchImpl = makeFetchMock({
      [`DELETE ${BASE}/w3c/${CONTAINER}/${REAL_ID}`]: async () =>
        buildResponse({ status: 500, body: "boom" }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const ann = newServerSaved();
    store.cache.set(REAL_IRI, ann);

    const errors = [];
    store.on("store:error", (e) => errors.push(e.detail));

    await assert.rejects(() => store.remove(REAL_IRI), /HTTP 500/);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].op, "remove");
    assert.deepEqual(store.get(REAL_IRI), ann);
  });
});

describe("store:error payload", () => {
  test("network error gets kind='network' and a human message", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const errors = [];
    store.on("store:error", (e) => errors.push(e.detail));
    await assert.rejects(() => store.create(CONTAINER, newAnnotationBody()));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].kind, "network");
    assert.match(errors[0].message, /create failed/i);
  });

  test("HTTP 400 gets kind='validation'", async () => {
    const fetchImpl = makeFetchMock({
      [`POST ${BASE}/w3c/${CONTAINER}/`]: async () =>
        buildResponse({ status: 400, body: "bad" }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const errors = [];
    store.on("store:error", (e) => errors.push(e.detail));
    await assert.rejects(() => store.create(CONTAINER, newAnnotationBody()));
    assert.equal(errors[0].kind, "validation");
  });

  test("HTTP 500 gets kind='server'", async () => {
    const fetchImpl = makeFetchMock({
      [`POST ${BASE}/w3c/${CONTAINER}/`]: async () =>
        buildResponse({ status: 500, body: "boom" }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const errors = [];
    store.on("store:error", (e) => errors.push(e.detail));
    await assert.rejects(() => store.create(CONTAINER, newAnnotationBody()));
    assert.equal(errors[0].kind, "server");
  });
});

describe("meta propagation", () => {
  test("create echoes `meta` on both 'annotation:created' and 'annotation:updated'", async () => {
    const fetchImpl = makeFetchMock({
      [`POST ${BASE}/w3c/${CONTAINER}/`]: async () =>
        buildResponse({
          status: 201,
          body: newServerSaved(),
          headers: { "content-type": "application/ld+json" },
        }),
    });
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl });
    const ref = { tag: "my-ref" };
    const seen = [];
    store.on("annotation:created", (e) => seen.push({ ev: "created", meta: e.detail.meta }));
    store.on("annotation:updated", (e) => seen.push({ ev: "updated", meta: e.detail.meta }));
    await store.create(CONTAINER, newAnnotationBody(), ref);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].meta, ref);
    assert.equal(seen[1].meta, ref);
  });
});

describe("on/off return-value", () => {
  test("on() returns an unsubscriber", () => {
    const store = new AnnotationStore({ baseUrl: BASE, fetchImpl: async () => ({}) });
    let count = 0;
    const unsubscribe = store.on("annotation:created", () => (count += 1));
    store.dispatchEvent(new CustomEvent("annotation:created", { detail: {} }));
    assert.equal(count, 1);
    unsubscribe();
    store.dispatchEvent(new CustomEvent("annotation:created", { detail: {} }));
    assert.equal(count, 1);
  });
});
