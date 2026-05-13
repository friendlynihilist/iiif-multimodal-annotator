/**
 * AnnotationStore — HTTP client + local cache + optimistic updates for the
 * Multimodal Annotator backend gateway (T1.4 WAP CRUD).
 *
 * Phase 1 (T1.5) — this module is intentionally NOT wired into the
 * orchestrator yet (see PHASE-1 T1.5b plan). It is a standalone module
 * with its own tests so the contract can be verified independently of
 * the rest of the frontend.
 *
 * Event surface (EventTarget):
 *   'annotation:created' — { annotation, optimistic: boolean, tempIri?: string }
 *   'annotation:updated' — { annotation, previous?: Annotation, tempIri?: string }
 *   'annotation:removed' — { iri }
 *   'store:loaded'       — { container, count }
 *   'store:error'        — { op, error, iri?, tempIri? }
 *
 * Public methods:
 *   load(container)              GET /w3c/{container}/  → fills cache, returns Annotation[]
 *   create(container, body)      POST /w3c/{container}/ → returns the saved Annotation
 *   update(iri, body)            PUT  /w3c/{container}/{id}
 *   remove(iri)                  DELETE /w3c/{container}/{id}
 *   get(iri)                     read-through cache
 *   all()                        Array copy of the cache
 *
 * Optimistic semantics:
 *   - create()  immediately emits 'annotation:created' with `optimistic: true` and a
 *               `temp:` IRI; the cache key is the temp IRI. When the POST responds,
 *               the cache entry is reseated under the server-assigned IRI and
 *               'annotation:updated' fires carrying `tempIri` so listeners can
 *               swap their references. On HTTP error, the temp entry is removed and
 *               'store:error' fires.
 *   - update()  applies the patch immediately to the cache, fires 'annotation:updated'
 *               with `previous`. On HTTP error the previous value is restored and
 *               'store:error' fires.
 *   - remove()  pulls the entry out of the cache, fires 'annotation:removed'. On
 *               HTTP error the entry is reinstated and 'store:error' fires.
 */

const TEMP_IRI_PREFIX = "temp:";
let tempCounter = 0;

function nextTempIri() {
  tempCounter += 1;
  return `${TEMP_IRI_PREFIX}${Date.now().toString(36)}-${tempCounter}`;
}

function iriToContainerAndId(iri) {
  // …/annotations/<container>/<id>   (and optionally /interpretation/<id>)
  // We only need the (container, id) for the annotation itself.
  const match = iri.match(/\/annotations\/([^\/]+)\/([^\/]+)(?:\/.*)?$/);
  if (!match) {
    throw new Error(`Cannot parse annotation IRI: ${iri}`);
  }
  return { container: match[1], id: match[2] };
}

export class AnnotationStore extends EventTarget {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - Backend root (e.g. http://localhost:8000).
   * @param {(input: RequestInfo|URL, init?: RequestInit) => Promise<Response>} [options.fetchImpl] - Override for tests.
   */
  constructor({ baseUrl = "", fetchImpl } = {}) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this._fetch = fetchImpl || ((url, opts) => globalThis.fetch(url, opts));
    this.cache = new Map();
  }

  // ── private ───────────────────────────────────────────────────────

  _url(container, id = "") {
    const c = container.replace(/^\/+|\/+$/g, "");
    return id
      ? `${this.baseUrl}/w3c/${c}/${encodeURIComponent(id)}`
      : `${this.baseUrl}/w3c/${c}/`;
  }

  _emit(event, detail) {
    this.dispatchEvent(new CustomEvent(event, { detail }));
  }

  async _request(method, url, body) {
    const init = {
      method,
      headers: { Accept: "application/ld+json" },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/ld+json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const resp = await this._fetch(url, init);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const err = new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
      err.status = resp.status;
      err.responseBody = text;
      throw err;
    }
    if (resp.status === 204) return null;
    const ct = resp.headers.get?.("content-type") || "";
    if (ct.includes("json")) return resp.json();
    return resp.text();
  }

  // ── public ────────────────────────────────────────────────────────

  on(event, handler) {
    this.addEventListener(event, handler);
    return () => this.removeEventListener(event, handler);
  }

  off(event, handler) {
    this.removeEventListener(event, handler);
  }

  get(iri) {
    return this.cache.get(iri);
  }

  all() {
    return Array.from(this.cache.values());
  }

  /** Replace the cache with the contents of `container` on the server. */
  async load(container) {
    let page;
    try {
      page = await this._request("GET", this._url(container));
    } catch (error) {
      this._emit("store:error", { op: "load", error });
      throw error;
    }

    const items = Array.isArray(page?.items) ? page.items : [];
    this.cache.clear();
    for (const ann of items) {
      if (ann && ann.id) this.cache.set(ann.id, ann);
    }
    this._emit("store:loaded", { container, count: this.cache.size });
    return items;
  }

  /** Create an annotation. Optimistic: emits `created` immediately with a
   *  temp IRI, then `updated` after the server assigns the real IRI. */
  async create(container, body) {
    const tempIri = nextTempIri();
    const optimistic = { ...body, id: tempIri };
    this.cache.set(tempIri, optimistic);
    this._emit("annotation:created", {
      annotation: optimistic,
      optimistic: true,
      tempIri,
    });

    let saved;
    try {
      saved = await this._request("POST", this._url(container), body);
    } catch (error) {
      this.cache.delete(tempIri);
      this._emit("store:error", { op: "create", error, tempIri });
      throw error;
    }

    if (!saved || !saved.id) {
      this.cache.delete(tempIri);
      const error = new Error("Server response missing annotation id");
      this._emit("store:error", { op: "create", error, tempIri });
      throw error;
    }

    this.cache.delete(tempIri);
    this.cache.set(saved.id, saved);
    this._emit("annotation:updated", {
      annotation: saved,
      previous: optimistic,
      tempIri,
    });
    return saved;
  }

  /** Replace an annotation. Optimistic: applies locally first, rolls back on error. */
  async update(iri, body) {
    const previous = this.cache.get(iri);
    const { container, id } = iriToContainerAndId(iri);

    // Optimistic apply.
    const optimistic = { ...body, id: iri };
    this.cache.set(iri, optimistic);
    this._emit("annotation:updated", { annotation: optimistic, previous });

    let saved;
    try {
      saved = await this._request("PUT", this._url(container, id), body);
    } catch (error) {
      // Rollback.
      if (previous) this.cache.set(iri, previous);
      else this.cache.delete(iri);
      this._emit("store:error", { op: "update", error, iri });
      // Emit a corrective updated so listeners can snap back to `previous`.
      this._emit("annotation:updated", {
        annotation: previous,
        previous: optimistic,
      });
      throw error;
    }

    if (saved && saved.id) {
      this.cache.set(saved.id, saved);
      this._emit("annotation:updated", {
        annotation: saved,
        previous: optimistic,
      });
    }
    return saved;
  }

  /** Delete an annotation. Optimistic: removes locally, reinstates on error. */
  async remove(iri) {
    const previous = this.cache.get(iri);
    const { container, id } = iriToContainerAndId(iri);

    this.cache.delete(iri);
    this._emit("annotation:removed", { iri });

    try {
      await this._request("DELETE", this._url(container, id));
    } catch (error) {
      // Rollback.
      if (previous) {
        this.cache.set(iri, previous);
        this._emit("annotation:created", {
          annotation: previous,
          optimistic: false,
        });
      }
      this._emit("store:error", { op: "remove", error, iri });
      throw error;
    }
  }
}
