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

/** Map an Error to a coarse category the UI can colour-code. */
function classifyError(error) {
  const status = error?.status;
  if (status === undefined) return "network";          // fetch threw
  if (status >= 400 && status < 500) return "validation";
  return "server";                                     // 5xx and anything else
}

function shortMessage(op, error) {
  if (error?.status) return `${op} failed: HTTP ${error.status}`;
  return `${op} failed: ${error?.message || "unknown error"}`;
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
    // DEBUG (T1.5b P0 diag) — remove once delete is confirmed working.
    if (typeof console !== "undefined" && console.debug) {
      console.log(`[MMA Store] ${method} ${url}`);
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
      this._emit("store:error", {
        op: "load", error,
        kind: classifyError(error),
        message: shortMessage("load", error),
      });
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
   *  temp IRI, then `updated` after the server assigns the real IRI.
   *
   *  `meta` is an opaque object the caller can pass to correlate the event
   *  flow with its own bookkeeping (e.g. the DOM elements representing the
   *  pending annotation). It's echoed back on every event emitted for this
   *  particular call. */
  async create(container, body, meta) {
    const tempIri = nextTempIri();
    const optimistic = { ...body, id: tempIri };
    this.cache.set(tempIri, optimistic);
    this._emit("annotation:created", {
      annotation: optimistic,
      optimistic: true,
      tempIri,
      meta,
    });

    let saved;
    try {
      saved = await this._request("POST", this._url(container), body);
    } catch (error) {
      this.cache.delete(tempIri);
      this._emit("store:error", {
        op: "create", error, tempIri, meta,
        kind: classifyError(error),
        message: shortMessage("create", error),
      });
      throw error;
    }

    if (!saved || !saved.id) {
      this.cache.delete(tempIri);
      const error = new Error("Server response missing annotation id");
      this._emit("store:error", {
        op: "create", error, tempIri, meta,
        kind: "server",
        message: shortMessage("create", error),
      });
      throw error;
    }

    this.cache.delete(tempIri);
    this.cache.set(saved.id, saved);
    this._emit("annotation:updated", {
      annotation: saved,
      previous: optimistic,
      tempIri,
      meta,
    });
    return saved;
  }

  /** Replace an annotation. Optimistic: applies locally first, rolls back on error. */
  async update(iri, body, meta) {
    const previous = this.cache.get(iri);
    const { container, id } = iriToContainerAndId(iri);

    // Optimistic apply.
    const optimistic = { ...body, id: iri };
    this.cache.set(iri, optimistic);
    this._emit("annotation:updated", { annotation: optimistic, previous, meta });

    let saved;
    try {
      saved = await this._request("PUT", this._url(container, id), body);
    } catch (error) {
      // Rollback.
      if (previous) this.cache.set(iri, previous);
      else this.cache.delete(iri);
      this._emit("store:error", {
        op: "update", error, iri, meta,
        kind: classifyError(error),
        message: shortMessage("update", error),
      });
      // Emit a corrective updated so listeners can snap back to `previous`.
      this._emit("annotation:updated", {
        annotation: previous,
        previous: optimistic,
        meta,
      });
      throw error;
    }

    if (saved && saved.id) {
      this.cache.set(saved.id, saved);
      this._emit("annotation:updated", {
        annotation: saved,
        previous: optimistic,
        meta,
      });
    }
    return saved;
  }

  /** Delete an annotation. Optimistic: removes locally, reinstates on error. */
  async remove(iri, meta) {
    // DEBUG (T1.5b P0 diag) — surface the IRI the orchestrator handed us.
    if (typeof console !== "undefined" && console.debug) {
      console.log(`[MMA Store] remove() called with iri = ${JSON.stringify(iri)}`);
    }
    if (!iri || typeof iri !== "string") {
      const error = new Error(`remove() requires a string IRI, got ${typeof iri}`);
      this._emit("store:error", {
        op: "remove", error, iri, meta,
        kind: "validation",
        message: `remove failed: missing IRI on the visual element`,
      });
      throw error;
    }
    const previous = this.cache.get(iri);
    let parsed;
    try {
      parsed = iriToContainerAndId(iri);
    } catch (error) {
      this._emit("store:error", {
        op: "remove", error, iri, meta,
        kind: "validation",
        message: `remove failed: unparseable IRI ${iri}`,
      });
      throw error;
    }
    const { container, id } = parsed;

    this.cache.delete(iri);
    this._emit("annotation:removed", { iri, meta });

    try {
      await this._request("DELETE", this._url(container, id));
    } catch (error) {
      // Rollback.
      if (previous) {
        this.cache.set(iri, previous);
        this._emit("annotation:created", {
          annotation: previous,
          optimistic: false,
          meta,
        });
      }
      this._emit("store:error", {
        op: "remove", error, iri, meta,
        kind: classifyError(error),
        message: shortMessage("remove", error),
      });
      throw error;
    }
  }
}
