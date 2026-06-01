import { AnnotationStore, iriToContainerAndId } from '../store/annotation-store.js';

const CONTAINER_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DEFAULT_CONTAINER = 'demo-bologna';
const DEFAULT_BACKEND_URL = 'http://localhost:8000';

// ── Prefix map mirrored from the backend's PREFIXES in wap.py ───────
// Used by the GEKO export to serialise IRIs in absolute form (the
// poster artefact must be self-describing — no CURIEs leaking into
// the JSON-LD payload). Keep in sync with backend/app/routes/wap.py.
const EXPORT_PREFIX_MAP = {
  mma:     'https://w3id.org/multimodal-annotator/ns/',
  crm:     'http://www.cidoc-crm.org/cidoc-crm/',
  mlao:    'https://w3id.org/mlao/',
  geko:    'https://w3id.org/geko/',
  icon:    'https://w3id.org/icon/ontology/',
  skos:    'http://www.w3.org/2004/02/skos/core#',
  interim: 'https://w3id.org/interim/',
  wd:      'http://www.wikidata.org/entity/',
  rdfs:    'http://www.w3.org/2000/01/rdf-schema#',
  oa:      'http://www.w3.org/ns/oa#',
  lrmoo:   'http://iflastandards.info/ns/lrm/lrmoo/',
};

// ── MLAO Anchor: built-in vocabulary lists ──────────────────────────
// Conceptual Levels (Panofsky / ICON) — used for mlao:hasConceptualLevel.
// The user can extend this set via the Data Model tab (M4 — TODO Phase
// 3: backend persistence; currently localStorage).
const BUILTIN_CONCEPTUAL_LEVELS = [
  { iri: 'icon:PreiconographicalSubject', label: 'Pre-iconographical' },
  { iri: 'icon:IconographicalSubject',    label: 'Iconographical' },
  { iri: 'icon:IconologicalSubject',      label: 'Iconological' },
];
// Entity Classes — used for mlao:isAnchoredTo target typing. CIDOC-CRM
// core + skos:Concept as a generic fallback. Default = crm:E1_Entity
// (accepts anything).
const BUILTIN_ENTITY_CLASSES = [
  { iri: 'crm:E1_Entity',           label: 'E1 — Entity (any)' },
  { iri: 'crm:E21_Person',          label: 'E21 — Person' },
  { iri: 'crm:E22_HumanMadeObject', label: 'E22 — Human-Made Object' },
  { iri: 'crm:E53_Place',           label: 'E53 — Place' },
  { iri: 'crm:E55_Type',            label: 'E55 — Type' },
  { iri: 'skos:Concept',            label: 'skos — Concept' },
];

// Single source of truth for the user-visible product name. Used by
// the header, the about modal, export labels, and (via
// connectedCallback) document.title.
//
// The display name reverts to "INTERIM Annotator" (v3 cosmetic
// revert), but the codebase identifiers — custom element tag,
// package name, file names, RDF prefix mma: — stay "Multimodal
// Annotator" per ADR 0001. Don't hardcode the display string
// anywhere else: read APP_TITLE.
const APP_TITLE = 'INTERIM Annotator';
const APP_SUBTITLE = 'Semantic Annotator for Intermedial Relations';

/**
 * Main container component for the Multimodal Annotator
 * (was: IIIF INTERIM Annotator — Phase 1 partial rename, see ADR 0001 and CLAUDE.md §"Phase 1 rename scope").
 *
 * Manages text, image, facsimile (and Phase 1 forthcoming: sparql) panels with annotation synchronization.
 *
 * Custom element: <multimodal-annotator>
 * Deprecated alias: <iiif-interim-annotator> (subclass, emits console.warn — removed in Phase 3).
 *
 * The internal class name `IIIFInterimAnnotator` is intentionally kept in v0.2.x to minimise diff
 * surface during Phase 1; it is re-exported as `MultimodalAnnotator` for new code paths.
 */
export class IIIFInterimAnnotator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.annotations = []; // Phase 1: a mirror of `this.store.all()`, kept for backwards compatibility with legacy consumers and `exportAnnotations()`. The store is the source of truth.
    this.selectedTextRange = null;
    this.selectedImageRegion = null;
    this.connections = []; // Store connections for redrawing
    this.draggingFrom = null; // Track what element we're dragging from
    this.tempPath = null; // Temporary line following mouse
    this.unlinkedTextElements = []; // Text elements not yet linked
    this.unlinkedImageRects = []; // Image rects not yet linked
    this.panels = []; // Dynamic panel configuration
    this.panelIdCounter = 0;
    this.connectionIndicators = new Map(); // Track indicator circles for off-screen connections

    // T1.5b store integration
    this.store = null;             // populated in _initStore()
    this.container = null;         // resolved in _initStore()
    this._toastStack = null;       // populated after render()
  }

  connectedCallback() {
    // Keep the browser tab in sync with APP_TITLE so any rebrand only
    // has to touch the constant. Preserves any subtitle the host page
    // appended after an em-dash (e.g. "— Demo").
    try {
      const suffixMatch = /\s+—\s+(.+)$/.exec(document.title || '');
      const suffix = suffixMatch ? ` — ${suffixMatch[1]}` : '';
      document.title = `${APP_TITLE}${suffix}`;
    } catch (_) { /* non-fatal */ }

    // Apply persisted theme BEFORE render so the first paint is in the
    // right palette (no dark→light flash on reload).
    this._initTheme();

    this.render();
    this.setupEventListeners();
    this.setupScrollListeners();
    this.initializePanels();
    // Fire-and-forget; store errors surface through the toast stack.
    this._initStore();
  }

  /** Read persisted theme from localStorage (default: dark) and set
   *  the data-theme attribute on the host. The CSS palette swap is
   *  driven entirely by :host([data-theme="light"]). */
  _initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('mma:theme'); } catch (_) { /* no storage */ }
    const theme = (saved === 'light' || saved === 'dark') ? saved : 'dark';
    this._setTheme(theme, /* persist */ false);
  }

  /** Apply a theme and (optionally) persist it. Also swaps the
   *  toggle button's sun/moon icon — the icon shows the OPPOSITE of
   *  the current theme (sun in dark mode = "switch to light").
   *
   *  Mirrors the attribute to <html> so the Query view (mounted on
   *  document.body, outside the shadow root) can re-skin via the
   *  global stylesheet's :root[data-mma-theme="light"] block. */
  _setTheme(theme, persist = true) {
    this.setAttribute('data-theme', theme);
    try { document.documentElement.setAttribute('data-mma-theme', theme); } catch (_) {}

    if (persist) {
      try { localStorage.setItem('mma:theme', theme); } catch (_) { /* no storage */ }
    }
    // Swap icon if the button is already rendered (i.e. after first render).
    const btn = this.shadowRoot?.getElementById('theme-toggle-btn');
    if (!btn) {
      this._repaintViz();
      return;
    }
    const sun  = btn.querySelector('.theme-icon-sun');
    const moon = btn.querySelector('.theme-icon-moon');
    if (sun)  sun.style.display  = theme === 'dark'  ? '' : 'none';
    if (moon) moon.style.display = theme === 'light' ? '' : 'none';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');

    // Viz components draw glow/tier colours from the active theme.
    // HTML overlays use var() and re-paint reactively; canvas
    // bitmaps (donut chart, heatmap overlays) need an explicit
    // re-render. Skip if the viz tab was never opened.
    this._repaintViz();
  }

  /** Re-render the Visualization tab's canvas-bitmap surfaces after
   *  a theme swap. HTML overlays already re-paint via var() and don't
   *  need this. Noop when the data hasn't been loaded yet. */
  _repaintViz() {
    if (!this._vizDataCache) return;
    try { this._renderVizModalities?.(); } catch (_) {}
    try { this._renderVizCodex?.(); }      catch (_) {}
    try { this._renderVizPainting?.(); }   catch (_) {}
  }

  /** Flip dark↔light and persist. Wired to the header's toggle button. */
  _toggleTheme() {
    const current = this.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    this._setTheme(current === 'dark' ? 'light' : 'dark', /* persist */ true);
  }

  // ── MLAO Anchor ────────────────────────────────────────────────────

  /** Combined active vocabulary lists (built-in + Data Model tab
   *  imports). M4 will populate the localStorage half. */
  _getConceptualLevels() {
    let custom = [];
    try {
      const raw = localStorage.getItem('mma:dataModel:conceptualLevels');
      if (raw) custom = JSON.parse(raw);
    } catch (_) { /* corrupt JSON → ignore */ }
    return [...BUILTIN_CONCEPTUAL_LEVELS, ...custom];
  }
  _getEntityClasses() {
    let custom = [];
    try {
      const raw = localStorage.getItem('mma:dataModel:entityClasses');
      if (raw) custom = JSON.parse(raw);
    } catch (_) { /* corrupt JSON → ignore */ }
    return [...BUILTIN_ENTITY_CLASSES, ...custom];
  }

  /** Auto-shown after a linking annotation has been persisted by the
   *  store. Populates the two dropdowns, clears the input, and stamps
   *  the annotation IRI on `this._currentAnchorAnnotationIri` so the
   *  Create button knows where to POST. Skip / Esc / backdrop close
   *  leave the annotation un-anchored. */
  _openAnchorModal(annotationIri, _context = {}, options = {}) {
    if (!annotationIri) return;
    const modal    = this.shadowRoot.getElementById('anchor-modal');
    const overlay  = this.shadowRoot.getElementById('modal-overlay');
    const classSel = this.shadowRoot.getElementById('anchor-entity-class');
    const levelSel = this.shadowRoot.getElementById('anchor-conceptual-level');
    const input    = this.shadowRoot.getElementById('anchor-entity-input');
    const title    = this.shadowRoot.getElementById('anchor-modal-title');
    const createBtn= this.shadowRoot.getElementById('anchor-create-btn');
    if (!modal || !classSel || !levelSel || !input) return;

    const prefill = options.prefill || null;
    const isEdit  = !!prefill;

    // Header swaps between Create and Edit phrasings.
    if (title) title.textContent = isEdit ? 'Edit anchor' : 'Anchor this annotation?';
    if (createBtn) createBtn.textContent = isEdit ? 'Update Anchor' : 'Create Anchor';

    // Populate dropdowns from active vocabularies.
    const renderOpt = (o) => {
      const opt = document.createElement('option');
      opt.value = o.iri;
      opt.textContent = `${o.label} — ${o.iri}`;
      return opt;
    };
    classSel.innerHTML = '';
    this._getEntityClasses().forEach((o) => classSel.appendChild(renderOpt(o)));
    classSel.value = prefill?.entityClass || 'crm:E1_Entity';

    levelSel.innerHTML = '<option value="">— none —</option>';
    this._getConceptualLevels().forEach((o) => levelSel.appendChild(renderOpt(o)));
    levelSel.value = prefill?.hasConceptualLevel || '';

    this._clearAnchorSelection();
    if (prefill?.isAnchoredTo) {
      this._setAnchorSelection({
        iri:      prefill.isAnchoredTo,
        label:    prefill.isAnchoredToLabel || prefill.isAnchoredTo,
        isCustom: !!prefill.isCustomEntity,
      });
    }

    this._currentAnchorAnnotationIri = annotationIri;
    modal.hidden = false;
    overlay?.classList.add('active');
    setTimeout(() => input.focus(), 50);
  }

  _closeAnchorModal() {
    const modal   = this.shadowRoot.getElementById('anchor-modal');
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    if (modal) modal.hidden = true;
    overlay?.classList.remove('active');
    this._currentAnchorAnnotationIri = null;
    this._clearAnchorSelection();
    // Hide any open dropdown so it doesn't ghost across reopenings.
    const results = this.shadowRoot.getElementById('anchor-search-results');
    if (results) { results.hidden = true; results.innerHTML = ''; }
  }

  /** Reset both the chip and the typed value, then show the input. */
  _clearAnchorSelection() {
    this._anchorSelection = null;   // { iri, label, isCustom }
    const chip  = this.shadowRoot.getElementById('anchor-entity-chip');
    const wrap  = this.shadowRoot.getElementById('anchor-search-wrap');
    const input = this.shadowRoot.getElementById('anchor-entity-input');
    if (chip) chip.hidden = true;
    if (wrap) wrap.hidden = false;
    if (input) { input.value = ''; }
  }

  /** Render the selected entity as a chip; hide the search input. */
  _setAnchorSelection({ iri, label, isCustom }) {
    this._anchorSelection = { iri, label: label || iri, isCustom: !!isCustom };
    const chip       = this.shadowRoot.getElementById('anchor-entity-chip');
    const chipLabel  = this.shadowRoot.getElementById('anchor-chip-label');
    const chipIri    = this.shadowRoot.getElementById('anchor-chip-iri');
    const wrap       = this.shadowRoot.getElementById('anchor-search-wrap');
    const results    = this.shadowRoot.getElementById('anchor-search-results');
    if (chipLabel) chipLabel.textContent = this._anchorSelection.label;
    if (chipIri)   chipIri.textContent   = this._anchorSelection.iri;
    if (chip) chip.hidden = false;
    if (wrap) wrap.hidden = true;
    if (results) { results.hidden = true; results.innerHTML = ''; }
  }

  /** Bind the Wikidata search behaviour to the modal's input. Wired
   *  once per shadow render (idempotent via `_anchorSearchWired`). */
  _wireAnchorSearch() {
    if (this._anchorSearchWired) return;
    const input    = this.shadowRoot.getElementById('anchor-entity-input');
    const results  = this.shadowRoot.getElementById('anchor-search-results');
    const clearBtn = this.shadowRoot.getElementById('anchor-chip-clear');
    if (!input || !results || !clearBtn) return;

    let debounceId = null;
    let lastQuery  = '';
    let inflight   = 0;  // abort old responses landing after a newer one

    const render = (html) => { results.innerHTML = html; results.hidden = false; };

    const runSearch = async (q) => {
      const myInflight = ++inflight;
      render(`<li class="anchor-search-loading">Searching Wikidata for &ldquo;${q}&rdquo;…</li>`);
      let hits = [];
      try {
        const url = 'https://www.wikidata.org/w/api.php?'
          + 'action=wbsearchentities'
          + '&search=' + encodeURIComponent(q)
          + '&language=en&format=json&origin=*'
          + '&limit=7';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        hits = Array.isArray(data?.search) ? data.search : [];
      } catch (err) {
        if (myInflight !== inflight) return;
        render(
          `<li class="anchor-search-empty">Wikidata search failed: ${err.message || err}</li>`
          + this._customEntityOptionHtml(q)
        );
        return;
      }
      if (myInflight !== inflight) return;   // a newer search superseded us
      const list = hits.map((h) => {
        const id    = String(h.id || '');
        const label = h.label || id;
        const desc  = h.description || '';
        return `
          <li class="anchor-search-result" data-iri="wd:${id}" data-label="${this._escAttr(label)}">
            <span class="label">${this._escHtml(label)}</span>
            ${desc ? `<span class="description">${this._escHtml(desc)}</span>` : ''}
            <span class="iri">wd:${id}</span>
          </li>`;
      }).join('');
      const empty = hits.length === 0
        ? `<li class="anchor-search-empty">No Wikidata results for &ldquo;${this._escHtml(q)}&rdquo;.</li>`
        : '';
      render(list + empty + this._customEntityOptionHtml(q));
    };

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q === lastQuery) return;
      lastQuery = q;
      clearTimeout(debounceId);
      if (!q) { results.hidden = true; results.innerHTML = ''; return; }
      // 300ms debounce per spec.
      debounceId = setTimeout(() => runSearch(q), 300);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { results.hidden = true; }
    });

    // Click on a result (or the create-custom row) — delegate.
    results.addEventListener('click', (e) => {
      const li = e.target.closest('.anchor-search-result');
      if (!li) return;
      if (li.classList.contains('create-custom')) {
        const label = li.dataset.label || lastQuery;
        const iri = `mma:entities/${this._mintCustomEntitySlug()}`;
        this._setAnchorSelection({ iri, label, isCustom: true });
      } else {
        this._setAnchorSelection({
          iri:   li.dataset.iri,
          label: li.dataset.label,
          isCustom: false,
        });
      }
    });

    clearBtn.addEventListener('click', () => {
      this._clearAnchorSelection();
      setTimeout(() => input.focus(), 30);
    });

    this._anchorSearchWired = true;
  }

  /** HTML for the always-present "+ Create custom entity" option at
   *  the bottom of the dropdown. */
  _customEntityOptionHtml(q) {
    const safe = this._escHtml(q);
    const attr = this._escAttr(q);
    return `
      <li class="anchor-search-result create-custom" data-label="${attr}">
        <span class="label">+ Create custom entity with label &ldquo;${safe}&rdquo;</span>
        <span class="iri">mma:entities/{new-ulid}</span>
      </li>`;
  }

  /** crypto.randomUUID() is universal in modern browsers; strip the
   *  dashes + lowercase for a tidy 32-char slug under mma:entities/.
   *  Not technically a ULID (Phase 1 simplification) but functionally
   *  equivalent for the demo: opaque, unique, sortable-ish. */
  _mintCustomEntitySlug() {
    try {
      return crypto.randomUUID().replace(/-/g, '').toLowerCase();
    } catch (_) {
      // Fallback for ancient browsers / non-secure contexts.
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  _escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  _escAttr(s) {
    return this._escHtml(s).replace(/"/g, '&quot;');
  }

  // ── Data Model tab ─────────────────────────────────────────────────

  /** Populate both lists from built-in + localStorage. Idempotent —
   *  safe to call on every tab activation. */
  _renderDataModelView() {
    this._renderDataModelList('levels',  this._getConceptualLevels(),
      BUILTIN_CONCEPTUAL_LEVELS.map(o => o.iri));
    this._renderDataModelList('classes', this._getEntityClasses(),
      BUILTIN_ENTITY_CLASSES.map(o => o.iri));
    this._wireDataModelButtons();
  }

  /** Render one section's list. `kind` is 'levels' | 'classes'.
   *  `builtinIris` is used to mark items as built-in (faint badge,
   *  no remove button). */
  _renderDataModelList(kind, items, builtinIris) {
    const ul = this.shadowRoot.getElementById(`dm-list-${kind}`);
    if (!ul) return;
    const trashSvg = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    ul.innerHTML = items.map((o) => {
      const isBuiltin = builtinIris.includes(o.iri);
      const removeBtn = isBuiltin
        ? `<span class="dm-item-tag">built-in</span>`
        : `<button class="dm-item-remove" data-iri="${this._escAttr(o.iri)}"
                   title="Remove" aria-label="Remove ${this._escAttr(o.label)}">${trashSvg}</button>`;
      return `
        <li class="dm-item">
          <span class="dm-item-label">${this._escHtml(o.label)}</span>
          <span class="dm-item-iri">${this._escHtml(o.iri)}</span>
          ${removeBtn}
        </li>`;
    }).join('');

    // Wire remove buttons (custom items only).
    ul.querySelectorAll('.dm-item-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const iri = btn.dataset.iri;
        const key = kind === 'levels'
          ? 'mma:dataModel:conceptualLevels'
          : 'mma:dataModel:entityClasses';
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
        arr = arr.filter((x) => x?.iri !== iri);
        try { localStorage.setItem(key, JSON.stringify(arr)); } catch (_) {}
        this._renderDataModelView();
      });
    });
  }

  /** Wire the two "+ Add" buttons + the shared modal's controls.
   *  Idempotent via `_dmButtonsWired`. */
  _wireDataModelButtons() {
    if (this._dmButtonsWired) return;
    const addLevelBtn = this.shadowRoot.getElementById('dm-add-level-btn');
    const addClassBtn = this.shadowRoot.getElementById('dm-add-class-btn');
    const closeBtn   = this.shadowRoot.getElementById('dm-add-modal-close');
    const saveBtn    = this.shadowRoot.getElementById('dm-add-save-btn');
    addLevelBtn?.addEventListener('click', () => this._openDmAddModal('levels'));
    addClassBtn?.addEventListener('click', () => this._openDmAddModal('classes'));
    closeBtn?.addEventListener('click',    () => this._closeDmAddModal());
    saveBtn?.addEventListener('click',     () => this._saveDmAddModal());

    // Esc closes the dm add modal too.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = this.shadowRoot.getElementById('dm-add-modal');
      if (m && !m.hidden) this._closeDmAddModal();
    });
    this._dmButtonsWired = true;
  }

  _openDmAddModal(kind) {
    this._dmAddKind = kind;
    const modal     = this.shadowRoot.getElementById('dm-add-modal');
    const title     = this.shadowRoot.getElementById('dm-add-modal-title');
    const labelInp  = this.shadowRoot.getElementById('dm-add-label');
    const iriInp    = this.shadowRoot.getElementById('dm-add-iri');
    if (!modal) return;
    title.textContent = kind === 'levels'
      ? 'Add custom conceptual level'
      : 'Add custom entity class';
    labelInp.value = '';
    iriInp.value   = '';
    modal.hidden = false;
    setTimeout(() => labelInp.focus(), 50);
  }
  _closeDmAddModal() {
    const modal = this.shadowRoot.getElementById('dm-add-modal');
    if (modal) modal.hidden = true;
    this._dmAddKind = null;
  }
  _saveDmAddModal() {
    const kind     = this._dmAddKind;
    if (!kind) return;
    const labelInp = this.shadowRoot.getElementById('dm-add-label');
    const iriInp   = this.shadowRoot.getElementById('dm-add-iri');
    const label = (labelInp?.value || '').trim();
    const iri   = (iriInp?.value   || '').trim();
    if (!label || !iri) {
      this.updateStatus('Data Model: both label and IRI are required.');
      return;
    }
    const key = kind === 'levels'
      ? 'mma:dataModel:conceptualLevels'
      : 'mma:dataModel:entityClasses';
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
    // Dedup: ignore if same IRI already exists.
    if (arr.some((x) => x?.iri === iri)) {
      this.updateStatus(`Data Model: ${iri} already in list.`);
      this._closeDmAddModal();
      return;
    }
    arr.push({ iri, label });
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (_) {}
    this._closeDmAddModal();
    this._renderDataModelView();
    this.updateStatus(`Added ${kind === 'levels' ? 'conceptual level' : 'entity class'}: ${label}`);
  }

  /** Collect form values, POST to the backend, close on success. The
   *  call is best-effort: any error surfaces in the status bar and
   *  leaves the modal open for retry. */
  async _submitAnchor() {
    const iri = this._currentAnchorAnnotationIri;
    if (!iri) { this._closeAnchorModal(); return; }
    const classSel = this.shadowRoot.getElementById('anchor-entity-class');
    const levelSel = this.shadowRoot.getElementById('anchor-conceptual-level');
    const input    = this.shadowRoot.getElementById('anchor-entity-input');
    const createBtn = this.shadowRoot.getElementById('anchor-create-btn');
    if (!classSel || !levelSel || !input || !createBtn) return;

    const entityClass      = classSel.value || 'crm:E1_Entity';
    const hasConceptualLvl = levelSel.value || null;

    // Prefer the chip selection (Wikidata pick or custom entity);
    // fall back to a raw IRI typed in the input as an escape hatch
    // for power users.
    const sel = this._anchorSelection;
    const isAnchoredTo  = sel?.iri || input.value.trim();
    const isCustom      = !!sel?.isCustom;
    const isAnchoredToLabel = sel?.label || null;

    if (!isAnchoredTo) {
      input.focus();
      this.updateStatus('Anchor: pick a Wikidata hit, create custom, or type an IRI — or click Skip.');
      return;
    }

    const payload = {
      entityClass,
      isAnchoredTo,
      isCustomEntity: isCustom,
    };
    if (isAnchoredToLabel) payload.isAnchoredToLabel = isAnchoredToLabel;
    if (hasConceptualLvl)  payload.hasConceptualLevel = hasConceptualLvl;

    // Derive container + id from the annotation IRI. The cached IRI
    // is in compact CURIE form (mma:annotations/{container}/{ulid})
    // because the backend's JSON-LD compaction shortens it. The
    // helper centralises the expand → regex extraction and works for
    // either compact or expanded input (same fix used by the store's
    // DELETE/PUT paths after the T1.5b iri-utils refactor).
    let parsed;
    try {
      parsed = iriToContainerAndId(iri);
    } catch (err) {
      console.warn('[MMA Anchor] could not parse annotation IRI', iri, err);
      this.updateStatus(`Anchor: unrecognised annotation IRI ${iri}`);
      return;
    }
    const url = `${this._backendUrlForExport()}/w3c/${parsed.container}/${parsed.id}/anchor`;

    createBtn.disabled = true;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
      }
      // Stamp the anchor info onto the cached annotation so the GEKO
      // export picks it up without a round-trip to the backend (and
      // the upcoming M5 anchor icon can read from the same cache).
      try {
        const cached = this.store?.cache?.get(iri);
        if (cached) {
          cached.hasAnchor = {
            type: 'Anchor',
            isAnchoredTo: isAnchoredTo,
            isAnchoredToLabel: isAnchoredToLabel,
            isCustomEntity: isCustom,
            entityClass: entityClass,
            ...(hasConceptualLvl ? { hasConceptualLevel: hasConceptualLvl } : {}),
          };
        }
      } catch (_) { /* cache unavailable — export will simply miss
                       the anchor block until next page load */ }
      this.updateStatus('Anchor created.');
      this._closeAnchorModal();
    } catch (err) {
      console.warn('[MMA Anchor] POST failed', err);
      this.updateStatus(`Anchor failed: ${err.message || err}`);
    } finally {
      createBtn.disabled = false;
    }
  }

  disconnectedCallback() {
    // Clean up listeners
    window.removeEventListener('scroll', this.updateConnectionsHandler, true);
    window.removeEventListener('resize', this.updateConnectionsHandler);

    // Cancel animation frames
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Tear down the Query & Analytics light-DOM mount we attached to
    // document.body at startup, plus the global stylesheet. We leave
    // YASGUI's CDN <script>/<link> in place — they're idempotent and
    // a re-mount of <multimodal-annotator> would reuse them.
    if (this._queryViewMount?.parentNode) {
      this._queryViewMount.parentNode.removeChild(this._queryViewMount);
      this._queryViewMount = null;
    }
    const qStyle = document.getElementById('mma-query-view-style');
    if (qStyle?.parentNode) qStyle.parentNode.removeChild(qStyle);
  }

  // ── T1.5b store integration ─────────────────────────────────────────

  _resolveContainer() {
    // Order: ?container=… in URL → localStorage → DEFAULT_CONTAINER.
    // Mismatch on the regex => fall back + warn (don't surprise the user).
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('container');
      if (fromUrl && CONTAINER_RE.test(fromUrl)) {
        try { localStorage.setItem('mma:lastContainer', fromUrl); } catch (_) {}
        return fromUrl;
      }
      if (fromUrl) {
        console.warn(`[MMA] ignored invalid ?container=${fromUrl}; expected ${CONTAINER_RE}`);
      }
      const stored = (() => {
        try { return localStorage.getItem('mma:lastContainer'); } catch (_) { return null; }
      })();
      if (stored && CONTAINER_RE.test(stored)) return stored;
    } catch (_) { /* fall through to default */ }
    return DEFAULT_CONTAINER;
  }

  _initStore() {
    console.log('[MMA] _initStore() starting');
    this.container = this._resolveContainer();
    const backendUrl = this.getAttribute('backend-url') || DEFAULT_BACKEND_URL;
    this.store = new AnnotationStore({ baseUrl: backendUrl });
    this._toastStack = this.shadowRoot.getElementById('toast-stack');

    console.log(`[MMA] container="${this.container}" backend=${backendUrl} store=`, this.store);

    // Diagnostic helper accessible from DevTools:
    //   document.querySelector('multimodal-annotator').__diag()
    this.__diag = () => ({
      container: this.container,
      backend: backendUrl,
      hasStore: !!this.store,
      cacheSize: this.store?.cache?.size ?? 0,
      annotationsMirror: this.annotations.length,
      connections: this.connections.map(c => ({
        modality: c.modality,
        annotationIri: c.annotationIri,
      })),
      elementsWithIri: Array.from(
        this.shadowRoot.querySelectorAll('iiif-text-panel,iiif-image-panel')
      ).flatMap(p => p.shadowRoot
        ? Array.from(p.shadowRoot.querySelectorAll('[data-annotation-iri]')).map(el => ({
            panel: p.tagName.toLowerCase(),
            tag: el.tagName,
            iri: el.getAttribute('data-annotation-iri'),
          }))
        : []
      ),
    });

    // ── Adapter: store events → legacy kebab-case CustomEvents on `this`.
    // External consumers keep listening to the legacy names; Phase 3 will
    // replace this mapping with native colon-style events.
    this.store.on('annotation:created', (e) => {
      const { annotation, optimistic, tempIri, meta } = e.detail;
      if (optimistic) this._stampIriOnMeta(meta, tempIri);
      this.dispatchEvent(new CustomEvent('annotation-created', {
        detail: annotation, bubbles: true, composed: true,
      }));
    });

    this.store.on('annotation:updated', (e) => {
      const { annotation, tempIri, meta } = e.detail;
      if (tempIri && annotation?.id && annotation.id !== tempIri) {
        this._stampIriOnMeta(meta, annotation.id);
        // Keep `this.annotations` mirror coherent.
        const tmpIdx = this.annotations.findIndex((a) => a?.id === tempIri);
        if (tmpIdx >= 0) this.annotations[tmpIdx] = annotation;
        else this.annotations.push(annotation);
      } else if (annotation?.id) {
        const idx = this.annotations.findIndex((a) => a?.id === annotation.id);
        if (idx >= 0) this.annotations[idx] = annotation;
      }
      this.dispatchEvent(new CustomEvent('annotation-updated', {
        detail: annotation, bubbles: true, composed: true,
      }));
      this.dispatchEvent(new CustomEvent('annotations-updated', {
        detail: { annotations: this.annotations },
      }));
    });

    this.store.on('annotation:removed', (e) => {
      const { iri } = e.detail;
      // Atomic linking design (Phase 1): a single mma annotation IRI lives
      // on multiple visual surfaces (mark, rect, connection line). When
      // the store removes the annotation, every visual tagged with that
      // IRI is purged here in one place, regardless of which surface
      // initiated the delete.
      this._purgeAnnotationVisuals(iri);
      const idx = this.annotations.findIndex((a) => a?.id === iri);
      if (idx >= 0) this.annotations.splice(idx, 1);
      this.dispatchEvent(new CustomEvent('annotation-removed', {
        detail: { iri }, bubbles: true, composed: true,
      }));
    });

    this.store.on('store:error', (e) => {
      const { op, error, kind, message } = e.detail;
      console.warn('[MMA Store]', op, error);
      this._toastStack?.push?.({ kind, message });
    });

    // Initial load. Errors are non-fatal and surface via the toast stack.
    this.store.load(this.container).catch(() => { /* surfaced by store:error */ });

    // Build the Query & Analytics view container in LIGHT DOM (sibling
    // of the orchestrator). YASGUI is known to fight with shadow DOM —
    // mounting in light DOM avoids the CSS scoping headaches.
    this._buildQueryView();
    this._buildVizView();

    // Wire the tab strip
    const tabAnnotate  = this.shadowRoot.getElementById('tab-annotate');
    const tabQuery     = this.shadowRoot.getElementById('tab-query');
    const tabDataModel = this.shadowRoot.getElementById('tab-datamodel');
    const tabViz       = this.shadowRoot.getElementById('tab-viz');
    tabAnnotate?.addEventListener('click',  () => this._activateTab('annotate'));
    tabQuery?.addEventListener('click',     () => this._activateTab('query'));
    tabDataModel?.addEventListener('click', () => this._activateTab('datamodel'));
    tabViz?.addEventListener('click',       () => this._activateTab('viz'));
  }

  // ── T2.5 Query & Analytics tab ─────────────────────────────────────

  /** SPARQL endpoint URL on the configured backend gateway. */
  _sparqlEndpoint() {
    const base = (this.getAttribute('backend-url') || DEFAULT_BACKEND_URL).replace(/\/$/, '');
    return `${base}/sparql`;
  }

  /** POST a SPARQL SELECT query to the backend's passthrough proxy
   *  and return the bindings array. Wrapper used by all the
   *  Visualization queries. Caller deals with empty bindings. */
  async _sparqlSelect(query) {
    const resp = await fetch(this._sparqlEndpoint(), {
      method:  'POST',
      headers: {
        'Accept':       'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ query }).toString(),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`SPARQL HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    const data = await resp.json();
    return data?.results?.bindings || [];
  }

  // ── Visualization tab ──────────────────────────────────────────────

  /** Build the Visualization light-DOM mount + stylesheet once.
   *  Mirror of _buildQueryView's pattern: positioned fixed under
   *  the tab strip, hidden until the tab activates. */
  _buildVizView() {
    if (!document.getElementById('mma-viz-view-style')) {
      const style = document.createElement('style');
      style.id = 'mma-viz-view-style';
      style.textContent = `
        #mma-viz-view {
          position: fixed;
          top: 92px; left: 0; right: 0; bottom: 48px;
          display: none;
          flex-direction: column;
          background: var(--mma-q-bg-base);
          color: var(--mma-q-text-primary);
          font-family: 'IBM Plex Sans', system-ui, sans-serif;
          z-index: 500;
          overflow-y: auto;
          padding: 28px 48px 64px;
        }
        #mma-viz-view.visible { display: flex; }
        #mma-viz-view .viz-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
          margin-bottom: 28px;
        }
        #mma-viz-view .viz-page-title {
          font-family: Spectral, Georgia, serif;
          font-size: 22px;
          font-weight: 500;
          color: var(--mma-q-text-primary);
        }
        #mma-viz-view .viz-refresh-btn {
          height: 30px;
          padding: 0 14px;
          background: transparent;
          color: var(--mma-q-accent);
          border: 1px solid var(--mma-q-accent-ring);
          border-radius: 999px;
          cursor: pointer;
          font-family: inherit;
          font-size: 11.5px;
          font-weight: 500;
          letter-spacing: 0.04em;
        }
        #mma-viz-view .viz-refresh-btn:hover {
          background: var(--mma-q-accent-bg);
        }
        #mma-viz-view .viz-refresh-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        #mma-viz-view .viz-section {
          margin-bottom: 36px;
          border: 1px solid var(--mma-q-border-soft);
          border-radius: 10px;
          background: var(--mma-q-bg-elevated);
          padding: 24px 26px 22px;
        }
        #mma-viz-view .viz-section-header {
          margin-bottom: 16px;
        }
        /* v4 — section titles read like terminal section headers:
           ▸ prefix in mono accent, label in uppercase letter-spaced
           accent. Plays with the dark cyan / light teal accent. */
        #mma-viz-view .viz-section-title {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--mma-q-accent);
          margin: 0 0 4px;
        }
        #mma-viz-view .viz-section-title::before {
          content: "\\25B8\\00a0";   /* ▸ + nbsp */
          color: var(--mma-q-accent);
        }
        #mma-viz-view .viz-section-sub {
          font-size: 12px;
          color: var(--mma-q-text-muted);
          line-height: 1.5;
          margin: 0;
        }
        #mma-viz-view .viz-section-body {
          min-height: 200px;
          position: relative;
        }
        #mma-viz-view .viz-empty,
        #mma-viz-view .viz-loading,
        #mma-viz-view .viz-error {
          padding: 28px 16px;
          font-size: 12.5px;
          color: var(--mma-q-text-faint);
          font-style: italic;
          text-align: center;
        }
        #mma-viz-view .viz-error {
          color: #d77a72;
          font-style: normal;
        }
        /* No image desaturation. Sharp rect outlines on the overlay
           communicate boundaries; the picture stays natural. */
      `;
      document.head.appendChild(style);
    }

    if (!this._vizViewMount) {
      const wrap = document.createElement('div');
      wrap.id = 'mma-viz-view';
      wrap.innerHTML = `
        <div class="viz-toolbar">
          <span class="viz-page-title">Visualization</span>
          <button class="viz-refresh-btn" id="mma-viz-refresh-btn" type="button">Refresh data</button>
        </div>

        <section class="viz-section" data-viz="codex">
          <div class="viz-section-header">
            <h3 class="viz-section-title">Codex view — manuscript heat</h3>
            <p class="viz-section-sub">Annotation density across the manuscript pages. Click a page to inspect.</p>
          </div>
          <div class="viz-section-body" id="mma-viz-codex">
            <div class="viz-loading">Loading…</div>
          </div>
        </section>

        <section class="viz-section" data-viz="painting">
          <div class="viz-section-header">
            <h3 class="viz-section-title">Painting hot zones</h3>
            <p class="viz-section-sub">Which regions of the artwork attract the most ekphrastic attention.</p>
          </div>
          <div class="viz-section-body" id="mma-viz-painting">
            <div class="viz-loading">Loading…</div>
          </div>
        </section>

        <section class="viz-section" data-viz="modalities">
          <div class="viz-section-header">
            <h3 class="viz-section-title">Ekphrastic modalities</h3>
            <p class="viz-section-sub">How annotations distribute across GEKO modalities.</p>
          </div>
          <div class="viz-section-body" id="mma-viz-donut">
            <div class="viz-loading">Loading…</div>
          </div>
        </section>
      `;
      document.body.appendChild(wrap);
      this._vizViewMount = wrap;

      const refreshBtn = wrap.querySelector('#mma-viz-refresh-btn');
      refreshBtn?.addEventListener('click', () => {
        this._vizDataCache = null;
        this._activateVizView({ force: true }).catch(() => {});
      });
    }
  }

  /** Activate the Visualization tab: lazy-load Chart.js then refresh
   *  all three viz sections. Errors per-viz don't tear the others
   *  down (each renderer catches its own and shows an inline message). */
  async _activateVizView({ force = false } = {}) {
    if (!force && this._vizDataCache) {
      // Already loaded; nothing to do (the DOM still holds the
      // last-rendered chart).
      return;
    }
    const refreshBtn = this._vizViewMount?.querySelector('#mma-viz-refresh-btn');
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      await this._loadVizData();
      await this._renderVizModalities();
      await this._renderVizPainting();
      await this._renderVizCodex();
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  /** Run the three SPARQL queries in parallel and cache. */
  async _loadVizData() {
    const [modalities, paintingRegions, facsimileCounts, facsimileRegions] =
      await Promise.all([
        this._sparqlSelect(`
          SELECT ?modality (COUNT(?ann) AS ?count) WHERE {
            GRAPH ?g {
              ?ann a <http://www.w3.org/ns/oa#Annotation> ;
                   <https://w3id.org/geko/hasEkphrasticModality> ?modality .
            }
          } GROUP BY ?modality
        `).catch((e) => { console.warn('[Viz] modalities query failed', e); return []; }),
        this._sparqlSelect(`
          SELECT ?source ?xywh WHERE {
            GRAPH ?g {
              ?ann a <http://www.w3.org/ns/oa#Annotation> ;
                   <http://www.w3.org/ns/oa#hasTarget> ?target .
              ?target a <http://iflastandards.info/ns/lrm/lrmoo/F1_Work> ;
                      <http://www.w3.org/ns/oa#hasSource> ?source ;
                      <http://www.w3.org/ns/oa#hasSelector> ?sel .
              ?sel <http://www.w3.org/1999/02/22-rdf-syntax-ns#value> ?xywh .
              FILTER(STRSTARTS(STR(?xywh), "xywh="))
            }
          }
        `).catch((e) => { console.warn('[Viz] painting query failed', e); return []; }),
        this._sparqlSelect(`
          SELECT ?facsimileCanvas (COUNT(?ann) AS ?count) WHERE {
            GRAPH ?g {
              ?ann a <http://www.w3.org/ns/oa#Annotation> ;
                   <http://www.w3.org/ns/oa#hasTarget> ?target .
              ?target a <http://iflastandards.info/ns/lrm/lrmoo/F2_Expression> ;
                      <http://www.w3.org/ns/oa#hasSource> ?facsimileCanvas .
            }
          } GROUP BY ?facsimileCanvas
        `).catch((e) => { console.warn('[Viz] facsimile counts query failed', e); return []; }),
        this._sparqlSelect(`
          SELECT ?source ?xywh WHERE {
            GRAPH ?g {
              ?ann a <http://www.w3.org/ns/oa#Annotation> ;
                   <http://www.w3.org/ns/oa#hasTarget> ?target .
              ?target a <http://iflastandards.info/ns/lrm/lrmoo/F2_Expression> ;
                      <http://www.w3.org/ns/oa#hasSource> ?source ;
                      <http://www.w3.org/ns/oa#hasSelector> ?sel .
              ?sel <http://www.w3.org/1999/02/22-rdf-syntax-ns#value> ?xywh .
              FILTER(STRSTARTS(STR(?xywh), "xywh="))
            }
          }
        `).catch((e) => { console.warn('[Viz] facsimile regions query failed', e); return []; }),
      ]);
    this._vizDataCache = { modalities, paintingRegions, facsimileCounts, facsimileRegions };
  }

  /** Lazy-load Chart.js from CDN. Idempotent. */
  _loadChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (this._chartJsLoadingPromise) return this._chartJsLoadingPromise;
    this._chartJsLoadingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      s.async = true;
      s.onload  = () => resolve(window.Chart);
      s.onerror = () => reject(new Error('Failed to load Chart.js from CDN'));
      document.head.appendChild(s);
    });
    return this._chartJsLoadingPromise;
  }

  /** Map any incoming modality token (URI, CURIE, vocab string, with
   *  either dynamisation/dynamization spelling) to one of the three
   *  canonical GEKO modality slots. */
  _normalizeModalityForViz(token) {
    if (!token) return null;
    const key = String(token).toLowerCase().split(/[#\/]/).pop().replace(/-/g, '');
    if (key === 'denotation')   return 'denotation';
    if (key === 'dynamisation' || key === 'dynamization') return 'dynamization';
    if (key === 'integration')  return 'integration';
    return null;
  }

  /** Read --mma-mod-* tokens from the orchestrator's :host so the
   *  chart colours track the active theme automatically. */
  _modalityColours() {
    const cs = getComputedStyle(this);
    const pick = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    return {
      denotation:   pick('--mma-mod-denotation',   '#5dcaa5'),
      dynamization: pick('--mma-mod-dynamization', '#7da9d6'),
      integration:  pick('--mma-mod-integration',  '#d09b7a'),
    };
  }

  async _renderVizModalities() {
    const host = this._vizViewMount?.querySelector('#mma-viz-donut');
    if (!host) return;

    // Normalise the SPARQL bindings into the three canonical buckets.
    const buckets = { denotation: 0, dynamization: 0, integration: 0 };
    for (const row of (this._vizDataCache?.modalities || [])) {
      const slot = this._normalizeModalityForViz(row?.modality?.value);
      if (!slot) continue;
      const n = parseInt(row?.count?.value, 10);
      if (Number.isFinite(n)) buckets[slot] += n;
    }
    const total = buckets.denotation + buckets.dynamization + buckets.integration;
    if (total === 0) {
      host.innerHTML = `<div class="viz-empty">No annotations yet to visualize.</div>`;
      return;
    }

    let Chart;
    try {
      Chart = await this._loadChartJs();
    } catch (err) {
      host.innerHTML = `<div class="viz-error">${err.message}</div>`;
      return;
    }

    const colours = this._modalityColours();

    // HTML overlays + legend use var() directly so theme toggle
    // re-paints them without re-rendering. Chart.js canvas pulls
    // its glow + tooltip colours from computed styles below — we
    // re-render the chart on theme change so those stay in sync.
    host.innerHTML = `
      <div class="viz-donut-wrap" style="display:flex;align-items:center;gap:32px;flex-wrap:wrap;">
        <div class="viz-donut-canvas-wrap" style="position:relative;width:240px;height:240px;flex-shrink:0;">
          <canvas id="mma-viz-donut-canvas" width="240" height="240"></canvas>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;">
            <div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:34px;font-weight:600;line-height:1;color:var(--mma-q-text-primary);">${total}</div>
            <div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--mma-q-text-faint);margin-top:6px;">annotations</div>
          </div>
        </div>
        <ul class="viz-donut-legend" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:var(--mma-q-text-body);">
          ${[
            { slot: 'denotation',   label: 'Denotation'   },
            { slot: 'dynamization', label: 'Dynamization' },
            { slot: 'integration',  label: 'Integration'  },
          ].map(({ slot, label }) => {
            const n = buckets[slot];
            const pct = total ? Math.round((n / total) * 100) : 0;
            return `
              <li style="display:flex;align-items:center;gap:12px;">
                <span style="width:12px;height:12px;border-radius:50%;background:${colours[slot]};flex-shrink:0;box-shadow:0 0 6px ${colours[slot]};"></span>
                <span style="min-width:130px;color:var(--mma-q-text-body);">${label}</span>
                <span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;font-weight:600;color:var(--mma-q-text-primary);min-width:32px;text-align:right;">${n}</span>
                <span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;color:var(--mma-q-text-faint);min-width:44px;">${pct}%</span>
              </li>`;
          }).join('')}
        </ul>
      </div>
    `;

    const canvas = host.querySelector('#mma-viz-donut-canvas');
    // Destroy a previous chart instance if we're re-rendering on
    // refresh — Chart.js complains otherwise.
    if (this._donutChart) { try { this._donutChart.destroy(); } catch (_) {} }

    // Tooltip colours pulled from the current theme tokens (read at
    // chart-build time; _setTheme re-invokes _renderVizModalities
    // on toggle so they refresh).
    const cs = getComputedStyle(this);
    const bgElev = (cs.getPropertyValue('--mma-bg-elevated') || '#0d1320').trim();
    const txtP   = (cs.getPropertyValue('--mma-text-primary') || '#e6f4ff').trim();
    const txtB   = (cs.getPropertyValue('--mma-text-body')    || '#c4d4e8').trim();
    const border = (cs.getPropertyValue('--mma-border')       || 'rgba(255,255,255,0.06)').trim();

    this._donutChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Denotation', 'Dynamization', 'Integration'],
        datasets: [{
          data: [buckets.denotation, buckets.dynamization, buckets.integration],
          backgroundColor: [colours.denotation, colours.dynamization, colours.integration],
          borderColor: bgElev,
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: false,
        cutout: '70%',
        plugins: { legend: { display: false }, tooltip: {
          backgroundColor: bgElev,
          titleColor: txtP, bodyColor: txtB,
          borderColor: border, borderWidth: 1,
          padding: 10, cornerRadius: 6,
        } },
        animation: { duration: 600, easing: 'easeOutQuart' },
      },
    });
  }
  /** Parse an "xywh=x,y,w,h" Media Fragment selector value into a
   *  rect object. Returns null on malformed input. */
  _parseXywh(s) {
    const m = /xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)/.exec(String(s || ''));
    if (!m) return null;
    return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  }

  /** Group region rows by source IRI and return the most-annotated
   *  source plus all rects on it. */
  _pickDominantSource(rows) {
    const bySource = new Map();
    for (const row of rows) {
      const src = row?.source?.value;
      const rect = this._parseXywh(row?.xywh?.value);
      if (!src || !rect) continue;
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(rect);
    }
    let best = null;
    for (const [src, rects] of bySource) {
      if (!best || rects.length > best.rects.length) best = { src, rects };
    }
    return best;   // { src, rects } | null
  }

  /** Force-upgrade an http URL to https. Mixed-content blocking
   *  kills http subresources on https origins; many servers happen
   *  to also speak https, so a blind upgrade is worth one try. */
  _maybeUpgradeHttps(url) {
    if (typeof url !== 'string') return url;
    if (url.startsWith('http://')) {
      const upgraded = 'https://' + url.slice('http://'.length);
      console.warn('[Viz] mixed content — upgrading to https:', url, '→', upgraded);
      return upgraded;
    }
    return url;
  }

  /** Extract the image resource from a IIIF Presentation canvas. Not
   *  every canvas advertises an Image API service — some Hertziana /
   *  Europeana / etc. manifests inline a static JPG/PNG instead. The
   *  return shape tells the caller which OSD open mode to use:
   *
   *    { kind: 'imageApi',    serviceId: '<base>' }
   *    { kind: 'staticImage', url:        '<full image URL>' }
   *    null
   *
   *  Handles v3 (body.service[0].id, then body.id) and v2
   *  (resource.service.@id, then resource.@id). */
  _extractImageServiceFromCanvas(canvas) {
    if (!canvas) return null;
    const up = (u) => this._maybeUpgradeHttps(u);

    // ── IIIF Presentation v3 ──
    try {
      const annoPage = canvas.items?.[0];
      const anno     = annoPage?.items?.[0];
      const body     = anno?.body;
      const services = Array.isArray(body?.service) ? body.service
                     : (body?.service ? [body.service] : []);
      for (const svc of services) {
        const id = svc?.id || svc?.['@id'];
        if (id) return { kind: 'imageApi', serviceId: up(id) };
      }
      if (body?.id || body?.['@id']) {
        return { kind: 'staticImage', url: up(body.id || body['@id']) };
      }
    } catch (_) { /* fall through to v2 */ }

    // ── IIIF Presentation v2 ──
    try {
      const image    = canvas.images?.[0];
      const resource = image?.resource;
      const svc      = resource?.service;
      const services = Array.isArray(svc) ? svc : (svc ? [svc] : []);
      for (const s of services) {
        const id = s?.['@id'] || s?.id;
        if (id) return { kind: 'imageApi', serviceId: up(id) };
      }
      if (resource?.['@id'] || resource?.id) {
        return { kind: 'staticImage', url: up(resource['@id'] || resource.id) };
      }
    } catch (_) { /* nothing matched */ }
    return null;
  }

  /** Heuristic: derive the manifest URL that contains `canvasIri`.
   *  Both Europeana and our dl.ficlit demo manifests follow the
   *  `…/<manifestId>/canvas/<N>` → `…/<manifestId>/manifest` rule. */
  _manifestUrlFromCanvasIri(canvasIri) {
    if (!canvasIri) return null;
    // Strip the trailing /canvas/<...> segment then append /manifest.
    const m = /^(.+?)\/canvas\/[^?#]+$/.exec(canvasIri);
    if (m) return `${m[1]}/manifest`;
    return null;
  }

  /** Find the canvas object inside a manifest matching `canvasIri`
   *  (handles v2 and v3). Returns null when not found. */
  _findCanvasInManifest(manifest, canvasIri) {
    if (!manifest || !canvasIri) return null;
    // v3
    if (Array.isArray(manifest.items)) {
      for (const c of manifest.items) {
        if (c.id === canvasIri || c['@id'] === canvasIri) return c;
      }
    }
    // v2
    if (Array.isArray(manifest.sequences)) {
      const canvases = manifest.sequences[0]?.canvases || [];
      for (const c of canvases) {
        if (c['@id'] === canvasIri || c.id === canvasIri) return c;
      }
    }
    return null;
  }

  /** Shared OSD prefixUrl. Matches the version pin already used by
   *  iiif-image-panel so the control icons render uniformly. */
  _osdPrefixUrl() {
    return 'https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/';
  }

  /** Build a heatmap canvas at scaled image-pixel resolution from a
   *  list of {x,y,w,h} rects and mount it as an OSD overlay over
   *  the whole image. Style: SHARP rectangle outlines + faint
   *  tier-coloured fills (per-rect density tier; overlap count
   *  drives the hue). No CSS blur — boundaries stay legible at
   *  every zoom level. Dark theme adds an accent drop-shadow glow.
   *
   *  Wp/Hp = full image pixel dimensions (the OSD content size).
   *  Returns the max overlap count seen (useful for caller stats). */
  _mountHeatmapOverlay(viewer, OSD, rects, Wp, Hp, opts = {}) {
    if (!rects?.length || !Wp || !Hp) return 0;
    const mode = opts.mode || 'radial';
    const isLight = (document.documentElement.getAttribute('data-mma-theme') === 'light');

    // Render at image pixel resolution, capped at 2000px on the long
    // side. With the overlay no longer using CSS blur, the cap is
    // visually safe — strokes stay crisp when OSD scales the canvas.
    const cap = 2000;
    const scale = Math.min(1, cap / Math.max(Wp, Hp));
    const cw = Math.max(1, Math.round(Wp * scale));
    const ch = Math.max(1, Math.round(Hp * scale));

    const off = document.createElement('canvas');
    off.width = cw; off.height = ch;
    const ctx = off.getContext('2d');
    // Per-rect density: count of rects whose AABB intersects this
    // one (the rect itself included). Drives the tier colour so
    // crowded zones read as hotter than isolated regions.
    const intersects = (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const overlaps = rects.map((a) => {
      let n = 1;
      for (const b of rects) {
        if (b !== a && intersects(a, b)) n++;
      }
      return n;
    });
    const maxOv = Math.max(1, ...overlaps);

    // Tier palette (same as codex grid — keeps the whole tab
    // chromatically coherent).
    const tierFor = (intensity) => {
      const dark = isLight ? [
        { fill: 'rgba(200,160,0,0.10)',   solid: '#c8a000' },
        { fill: 'rgba(204,102,0,0.12)',   solid: '#cc6600' },
        { fill: 'rgba(196,0,140,0.14)',   solid: '#c4008c' },
        { fill: 'rgba(0,133,168,0.16)',   solid: '#0085a8' },
      ] : [
        { fill: 'rgba(255,215,0,0.14)',   solid: '#ffd700' },
        { fill: 'rgba(255,140,0,0.16)',   solid: '#ff8c00' },
        { fill: 'rgba(255,0,180,0.18)',   solid: '#ff00b4' },
        { fill: 'rgba(0,212,255,0.20)',   solid: '#00d4ff' },
      ];
      const idx = intensity <= 0.25 ? 0
                : intensity <= 0.5  ? 1
                : intensity <= 0.75 ? 2 : 3;
      return dark[idx];
    };

    // Draw each rect as a sharp coloured outline + faint fill. The
    // fill accumulates visually where rects overlap (normal alpha
    // compositing — not lighter), so dense regions read brighter
    // without losing the boundary information.
    // Stroke width = 4px at image scale → ~2-3px at 1:1 zoom in
    // the viewer, scales with zoom. Bands mode uses the same
    // recipe — line regions are just very wide rects.
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'square';
    rects.forEach((r, i) => {
      const x = r.x * scale, y = r.y * scale;
      const w = r.w * scale, h = r.h * scale;
      const intensity = overlaps[i] / maxOv;
      const t = tierFor(intensity);
      ctx.fillStyle   = t.fill;
      ctx.strokeStyle = t.solid;
      ctx.lineWidth   = mode === 'bands' ? 2 : 3;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2,
                     Math.max(0, w - ctx.lineWidth),
                     Math.max(0, h - ctx.lineWidth));
    });

    // No CSS blur — borders stay crisp. Dark theme adds a faint
    // drop-shadow accent glow so the outlines read on busy images;
    // light stays clean. Normal blend mode (not screen) so the
    // tier colours are accurate over any image background.
    const accent = (getComputedStyle(this).getPropertyValue('--mma-accent') || '#00d4ff').trim();
    off.style.cssText = [
      'pointer-events:none',
      'filter:' + (isLight ? 'none' : `drop-shadow(0 0 3px ${accent})`),
      'opacity:1',
    ].join(';');

    viewer.addOverlay({
      element:  off,
      location: new OSD.Rect(0, 0, 1, Hp / Wp),
    });

    return maxOv;
  }

  /** Heatmap renderer: take the dominant painting source from the
   *  data, mount an OpenSeadragon viewer on its IIIF image, and
   *  paint a static canvas overlay with radial gradients per xywh.
   *  OSD's overlay system handles the zoom/pan transformation
   *  natively — no live redraw needed on update-viewport. */
  async _renderVizPainting() {
    const host = this._vizViewMount?.querySelector('#mma-viz-painting');
    if (!host) return;

    const rows = this._vizDataCache?.paintingRegions || [];
    const dominant = this._pickDominantSource(rows);
    if (!dominant || dominant.rects.length === 0) {
      host.innerHTML = `<div class="viz-empty">No painting annotations yet to visualize.</div>`;
      return;
    }
    const { src, rects } = dominant;

    // Lay out: source label + viewer area + color-image toggle.
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;gap:14px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--mma-q-text-faint);word-break:break-all;">${this._escHtml(src)}</span>
        <span style="font-size:11px;color:var(--mma-q-text-muted);">${rects.length} region${rects.length === 1 ? '' : 's'}</span>
      </div>
      <div id="mma-viz-painting-viewer" style="position:relative;width:100%;height:480px;background:var(--mma-q-bg-sunken);border:1px solid var(--mma-q-border-soft);border-radius:8px;overflow:hidden;"></div>
    `;
    const viewerEl = host.querySelector('#mma-viz-painting-viewer');

    // Ensure OSD is available. The annotator already imports it via
    // the panel components; reuse window.OpenSeadragon.
    if (!window.OpenSeadragon) {
      try {
        await import('openseadragon').then((m) => {
          window.OpenSeadragon = m.default || m.OpenSeadragon || window.OpenSeadragon;
        });
      } catch (err) {
        viewerEl.innerHTML = `<div class="viz-error" style="padding:24px;">OpenSeadragon failed to load: ${this._escHtml(err.message || String(err))}</div>`;
        return;
      }
    }
    const OSD = window.OpenSeadragon;

    // Resolve the image resource for this canvas. The src we got
    // from the SPARQL is a Presentation canvas IRI — OSD needs
    // either an Image API service or a direct image URL. Fetch the
    // manifest, find the canvas, extract a structured {kind, ...}
    // descriptor. On null fall back to a static <img>.
    const manifestUrl = this._manifestUrlFromCanvasIri(src);
    let canvasObj = null;
    let image     = null;
    if (manifestUrl) {
      const manifest = await this._fetchIiifManifest(manifestUrl);
      canvasObj = this._findCanvasInManifest(manifest, src);
      image     = this._extractImageServiceFromCanvas(canvasObj);
    }
    if (!image) {
      viewerEl.innerHTML = `
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--mma-q-bg-sunken);">
          <div class="viz-error" style="padding:24px;">Could not resolve painting image from ${this._escHtml(src)}</div>
        </div>`;
      return;
    }

    // Pick the OSD tilesource shape for the kind we got.
    let tileSources;
    if (image.kind === 'imageApi') {
      tileSources = `${image.serviceId.replace(/\/$/, '')}/info.json`;
    } else {
      // 'staticImage' — OSD's "simple image" type opens a single
      // raster as a one-tile virtual pyramid. No info.json round
      // trip; works for plain JPG/PNG (Hertziana fotothek etc).
      tileSources = { type: 'image', url: image.url };
    }

    // Destroy previous viewer instance on refresh.
    if (this._vizPaintingViewer) {
      try { this._vizPaintingViewer.destroy(); } catch (_) {}
      this._vizPaintingViewer = null;
    }

    let viewer;
    try {
      viewer = OSD({
        element: viewerEl,
        prefixUrl: this._osdPrefixUrl(),
        tileSources,
        showNavigationControl: true,
        showNavigator: false,
        defaultZoomLevel: 0,
        minZoomImageRatio: 0.8,
        maxZoomPixelRatio: 6,
        crossOriginPolicy: 'Anonymous',
      });
    } catch (err) {
      viewerEl.innerHTML = `<div class="viz-error" style="padding:24px;">Viewer init failed: ${this._escHtml(err.message || String(err))}</div>`;
      return;
    }
    this._vizPaintingViewer = viewer;

    // Once the tilesource opens we know the image's pixel size and
    // can draw the heatmap canvas at that resolution. OSD will scale
    // the overlay automatically as the user zooms/pans.
    viewer.addHandler('open', () => {
      try {
        const tiled = viewer.world.getItemAt(0);
        if (!tiled) return;
        const dims = tiled.getContentSize();
        this._mountHeatmapOverlay(viewer, OSD, rects, dims.x, dims.y);
      } catch (err) {
        console.warn('[Viz] painting heatmap overlay failed', err);
      }
    });

    viewer.addHandler('open-failed', (ev) => {
      console.warn('[Viz] painting tilesource open-failed', ev);
      viewerEl.innerHTML = `<div class="viz-error" style="padding:24px;">Could not open painting tilesource: ${this._escHtml(String(ev?.message || src))}</div>`;
    });
  }
  /** Fetch a IIIF manifest (cached). Returns the parsed JSON or null
   *  on failure. */
  async _fetchIiifManifest(url) {
    this._manifestCache = this._manifestCache || new Map();
    if (this._manifestCache.has(url)) return this._manifestCache.get(url);
    try {
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      this._manifestCache.set(url, json);
      return json;
    } catch (err) {
      console.warn('[Viz] manifest fetch failed', url, err);
      this._manifestCache.set(url, null);
      return null;
    }
  }

  /** Best-effort manuscript manifest URL discovery from the
   *  facsimile sources in the loaded data. Falls back to the
   *  hardcoded Bocchi/Raimondi codex if nothing usable surfaces. */
  _deriveManuscriptManifestUrl() {
    const FALLBACK = 'https://dl.ficlit.unibo.it/iiif/2/19266/manifest';
    const rows = this._vizDataCache?.facsimileCounts || [];
    // The recorded `facsimileCanvas` is typically a canvas IRI like
    // .../iiif/2/<id>/canvas/p<N>. The manifest sits at the parent
    // /iiif/2/<id>/manifest. If we can't reverse-engineer it
    // safely, fall back to the known demo manifest.
    for (const row of rows) {
      const v = row?.facsimileCanvas?.value || '';
      const m = /^(.+\/iiif\/\d+\/[^\/]+)\/canvas/.exec(v);
      if (m) return `${m[1]}/manifest`;
    }
    return FALLBACK;
  }

  /** Canvases (IIIF 2.x or 3.x) from a manifest, normalised to a
   *  small dict per canvas:
   *    { id, label, image:{kind,serviceId|url}|null, width, height }
   *  The `image` field comes from _extractImageServiceFromCanvas so
   *  the codex detail viewer can dispatch on imageApi vs staticImage
   *  the same way the painting viewer does. */
  _canvasesFromManifest(manifest) {
    if (!manifest) return [];
    const out = [];
    const labelOf = (c, im) => {
      if (typeof c?.label === 'string') return c.label;
      return c?.label?.en?.[0] || c?.label?.none?.[0] || c?.label?.['@value'] || '';
    };
    // IIIF 2.x
    if (Array.isArray(manifest.sequences)) {
      const canvases = manifest.sequences[0]?.canvases || [];
      for (const c of canvases) {
        const im = c.images?.[0]?.resource;
        out.push({
          id:    c['@id'] || c.id,
          label: labelOf(c, im),
          image: this._extractImageServiceFromCanvas(c),
          width:  c.width  || im?.width  || 0,
          height: c.height || im?.height || 0,
        });
      }
      return out;
    }
    // IIIF 3.x
    if (Array.isArray(manifest.items)) {
      for (const c of manifest.items) {
        const anno = c.items?.[0]?.items?.[0];
        const body = anno?.body;
        out.push({
          id:    c.id,
          label: labelOf(c, body),
          image: this._extractImageServiceFromCanvas(c),
          width:  c.width  || body?.width  || 0,
          height: c.height || body?.height || 0,
        });
      }
      return out;
    }
    return [];
  }

  async _renderVizCodex() {
    const host = this._vizViewMount?.querySelector('#mma-viz-codex');
    if (!host) return;

    const counts = this._vizDataCache?.facsimileCounts || [];
    const countByCanvas = new Map();
    for (const row of counts) {
      const k = row?.facsimileCanvas?.value;
      const n = parseInt(row?.count?.value, 10);
      if (k && Number.isFinite(n)) countByCanvas.set(k, n);
    }

    const manifestUrl = this._deriveManuscriptManifestUrl();
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;gap:14px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--mma-q-text-faint);word-break:break-all;">${this._escHtml(manifestUrl)}</span>
        <span style="font-size:11px;color:var(--mma-q-text-muted);" id="mma-viz-codex-stats"></span>
      </div>
      <div id="mma-viz-codex-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;">
        <div class="viz-loading" style="grid-column:1/-1;">Loading manuscript manifest…</div>
      </div>
      <div id="mma-viz-codex-detail" style="margin-top:24px;"></div>
    `;
    const gridEl   = host.querySelector('#mma-viz-codex-grid');
    const statsEl  = host.querySelector('#mma-viz-codex-stats');

    const manifest = await this._fetchIiifManifest(manifestUrl);
    if (!manifest) {
      gridEl.innerHTML = `<div class="viz-error" style="grid-column:1/-1;">Could not load manifest: ${this._escHtml(manifestUrl)}</div>`;
      return;
    }
    const canvases = this._canvasesFromManifest(manifest);
    if (canvases.length === 0) {
      gridEl.innerHTML = `<div class="viz-empty" style="grid-column:1/-1;">Manifest has no canvases.</div>`;
      return;
    }
    // Max count for intensity normalisation.
    let maxCount = 0;
    for (const c of canvases) {
      const n = countByCanvas.get(c.id) || 0;
      if (n > maxCount) maxCount = n;
    }
    const annotated = canvases.filter((c) => (countByCanvas.get(c.id) || 0) > 0).length;
    if (statsEl) statsEl.textContent = `${canvases.length} pages · ${annotated} annotated · max ${maxCount}/page`;

    // Per-cell band rects: filter facsimileRegions to this canvas.
    // Bands rendered as absolute-positioned %-percent overlays so
    // they scale with the thumbnail container.
    const bandsByCanvas = new Map();
    for (const row of (this._vizDataCache?.facsimileRegions || [])) {
      const src = row?.source?.value;
      if (!src) continue;
      const rect = this._parseXywh(row?.xywh?.value);
      if (!rect) continue;
      if (!bandsByCanvas.has(src)) bandsByCanvas.set(src, []);
      bandsByCanvas.get(src).push(rect);
    }

    // Are we in light theme? Glow only on dark; light gets the
    // desaturated equivalents.
    const isLight = (document.documentElement.getAttribute('data-mma-theme') === 'light');

    // Page-intensity → 4-tier palette (v4 spec). Returns
    // { fill, solid, glow } so bands get the translucent fill,
    // badges/borders the solid colour, dark thumbs the glow.
    const tierColour = (intensity) => {
      if (intensity <= 0)    return null;
      const dark = isLight ? [
        { fill: 'rgba(200,160,0,0.35)',   solid: '#c8a000' },   // low
        { fill: 'rgba(204,102,0,0.50)',   solid: '#cc6600' },   // medium
        { fill: 'rgba(196,0,140,0.55)',   solid: '#c4008c' },   // high
        { fill: 'rgba(0,133,168,0.60)',   solid: '#0085a8' },   // very high
      ] : [
        { fill: 'rgba(255,215,0,0.55)',   solid: '#ffd700' },   // low
        { fill: 'rgba(255,140,0,0.65)',   solid: '#ff8c00' },   // medium
        { fill: 'rgba(255,0,180,0.65)',   solid: '#ff00b4' },   // high
        { fill: 'rgba(0,212,255,0.70)',   solid: '#00d4ff' },   // very high
      ];
      const idx = intensity <= 0.25 ? 0
                : intensity <= 0.5  ? 1
                : intensity <= 0.75 ? 2 : 3;
      return dark[idx];
    };

    gridEl.innerHTML = canvases.map((c, i) => {
      const n = countByCanvas.get(c.id) || 0;
      const intensity = maxCount > 0 ? (n / maxCount) : 0;
      const tier = tierColour(intensity);
      const fill  = tier?.fill  || 'transparent';
      const solid = tier?.solid || 'transparent';
      const isVeryHigh = intensity > 0.75 && n > 0;
      const label = c.label || `Canvas ${i + 1}`;
      const tooltip = `Page ${label} — ${n} annotation${n === 1 ? '' : 's'}`;
      const W = c.width  || 0;
      const H = c.height || 0;
      const rects = bandsByCanvas.get(c.id) || [];

      // Band overlays in PERCENT units so they track the thumbnail
      // container. Dark theme adds a slim glow per band for the
      // "terminal" feel; light stays sharp + clean.
      const bandsHtml = (W > 0 && H > 0 && rects.length)
        ? rects.map((r) => {
            const left = ((r.x) / W * 100).toFixed(2);
            const top  = ((r.y) / H * 100).toFixed(2);
            const w    = ((r.w) / W * 100).toFixed(2);
            const h    = ((r.h) / H * 100).toFixed(2);
            const glow = isLight ? '' : `box-shadow:0 0 4px ${solid};`;
            return `<div class="viz-codex-band" style="position:absolute;left:${left}%;top:${top}%;width:${w}%;height:${h}%;background:${fill};${glow}pointer-events:none;"></div>`;
          }).join('')
        : '';

      // Solid badge — bright tier colour filled, dark ink, mono.
      // Dark theme adds a halo glow so the chip pops on near-black.
      const badgeGlow = (!isLight && tier) ? `box-shadow:0 0 6px ${solid};` : '';
      const badge = n > 0
        ? `<div class="viz-codex-badge" style="position:absolute;top:6px;right:6px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:0.02em;color:var(--mma-q-bg-base);background:${solid};${badgeGlow}border:none;border-radius:999px;padding:3px 7px;line-height:1.2;pointer-events:none;">${n}</div>`
        : '';

      // Bottom page label — mono cyan/accent. Sits over a thin black
      // gradient so it reads on any thumb.
      const labelColor = isLight ? 'var(--mma-accent)' : '#00d4ff';
      const bottomLabel = `
        <div style="position:absolute;left:0;right:0;bottom:0;padding:14px 8px 6px;background:linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0));pointer-events:none;">
          <span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;font-weight:500;letter-spacing:0.05em;color:${labelColor};text-shadow:0 1px 2px rgba(0,0,0,0.6);">${this._escHtml(label)}</span>
        </div>`;

      // Very-high thumbs get a magenta glow ring (dark only).
      const cellGlow = (isVeryHigh && !isLight)
        ? 'box-shadow:0 0 12px rgba(255,0,180,0.25);'
        : '';

      // Image source: imageApi → derivative; staticImage → URL.
      let imageUrl = '';
      let imageKind = '';
      if (c.image?.kind === 'imageApi') {
        imageKind = 'imageApi';
        imageUrl  = `${c.image.serviceId.replace(/\/$/, '')}/full/200,/0/default.jpg`;
      } else if (c.image?.kind === 'staticImage') {
        imageKind = 'staticImage';
        imageUrl  = c.image.url;
      }

      return `
        <button class="viz-codex-cell" type="button"
                data-canvas-id="${this._escAttr(c.id)}"
                data-canvas-label="${this._escAttr(label)}"
                data-image-kind="${this._escAttr(imageKind)}"
                data-image-iri="${this._escAttr(c.image?.serviceId || c.image?.url || '')}"
                data-canvas-width="${W}"
                data-canvas-height="${H}"
                data-annotation-count="${n}"
                title="${this._escAttr(tooltip)}"
                style="background:transparent;border:1px solid var(--mma-q-border-soft);border-radius:6px;padding:0;cursor:pointer;display:flex;flex-direction:column;overflow:hidden;${cellGlow}transition:transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;">
          <div class="viz-codex-thumb" data-pending="1" data-image-url="${this._escAttr(imageUrl)}"
               style="position:relative;width:100%;aspect-ratio:3/4;background:var(--mma-q-bg-sunken);">
            ${bandsHtml}
            ${badge}
            ${bottomLabel}
          </div>
        </button>`;
    }).join('');

    // Hover style + selected.
    if (!document.getElementById('mma-viz-codex-style')) {
      const s = document.createElement('style');
      s.id = 'mma-viz-codex-style';
      s.textContent = `
        .viz-codex-cell:hover { transform: scale(1.02); border-color: var(--mma-q-accent-ring) !important; }
        .viz-codex-cell.selected { border-color: var(--mma-q-accent) !important; box-shadow: 0 0 0 2px var(--mma-q-accent-bg); }
      `;
      document.head.appendChild(s);
    }

    // Lazy-load thumbnails via IntersectionObserver. Inserted at the
    // back of the thumb so the bands + badge + label stay on top
    // (later siblings paint on top in HTML stacking when z-index is
    // unset; explicit insertBefore at index 0 puts the img at the
    // bottom of the stack).
    const io = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const thumb = e.target;
        if (thumb.dataset.pending !== '1') continue;
        thumb.dataset.pending = '0';
        const url = thumb.dataset.imageUrl || '';
        if (!url) { obs.unobserve(thumb); continue; }
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
        img.onerror = () => {
          img.replaceWith(Object.assign(document.createElement('div'), {
            style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10.5px;color:var(--mma-q-text-faint);',
            textContent: 'no thumb',
          }));
        };
        thumb.insertBefore(img, thumb.firstChild);
        obs.unobserve(thumb);
      }
    }, { rootMargin: '200px' });
    gridEl.querySelectorAll('.viz-codex-thumb').forEach((t) => io.observe(t));

    // Click → open detail.
    gridEl.querySelectorAll('.viz-codex-cell').forEach((btn) => {
      btn.addEventListener('click', () => this._openCodexDetail(btn));
    });

    // Legend under the grid — same 4-tier palette as the bands.
    const legendStops = isLight
      ? ['#c8a000', '#cc6600', '#c4008c', '#0085a8']
      : ['#ffd700', '#ff8c00', '#ff00b4', '#00d4ff'];
    const swatch = (c) => `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:10px;border-radius:2px;background:${c};${isLight ? '' : 'box-shadow:0 0 4px ' + c}"></span>`;
    const legend = document.createElement('div');
    legend.style.cssText = 'margin-top:16px;display:flex;align-items:center;gap:16px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:0.04em;color:var(--mma-q-text-faint);text-transform:uppercase;';
    legend.innerHTML = `
      <span>Density</span>
      ${swatch(legendStops[0])}low</span>
      ${swatch(legendStops[1])}medium</span>
      ${swatch(legendStops[2])}high</span>
      ${swatch(legendStops[3])}very high</span>
    `;
    gridEl.insertAdjacentElement('afterend', legend);
  }

  /** Render the per-page detail under the grid: OSD viewer of the
   *  canvas + line-heatmap overlay built from F2_Expression target
   *  xywhs filtered to this source. Known caveat: PAGE-XML line
   *  selectors produce horizontal bands, not blobs — that's the
   *  expected look for the demo. */
  _openCodexDetail(cellBtn) {
    if (!cellBtn) return;
    const canvasId    = cellBtn.dataset.canvasId;
    const canvasLabel = cellBtn.dataset.canvasLabel || canvasId;
    const imageKind   = cellBtn.dataset.imageKind;        // 'imageApi' | 'staticImage' | ''
    const imageIri    = cellBtn.dataset.imageIri || '';   // serviceId or static URL
    const W = parseInt(cellBtn.dataset.canvasWidth,  10) || 0;
    const H = parseInt(cellBtn.dataset.canvasHeight, 10) || 0;
    if (!imageIri || !imageKind) {
      const host   = this._vizViewMount?.querySelector('#mma-viz-codex');
      const detail = host?.querySelector('#mma-viz-codex-detail');
      if (detail) {
        detail.innerHTML = `
          <div class="viz-error" style="padding:24px;">
            No image resource resolved for canvas ${this._escHtml(canvasId)}.
          </div>`;
      }
      return;
    }

    // Highlight the selected cell, un-highlight any previous one.
    const host = this._vizViewMount?.querySelector('#mma-viz-codex');
    host?.querySelectorAll('.viz-codex-cell.selected').forEach((b) => b.classList.remove('selected'));
    cellBtn.classList.add('selected');

    // Filter F2_Expression rects to this canvas.
    const rows = this._vizDataCache?.facsimileRegions || [];
    const rects = [];
    for (const row of rows) {
      if (row?.source?.value !== canvasId) continue;
      const rect = this._parseXywh(row?.xywh?.value);
      if (rect) rects.push(rect);
    }

    const detail = host?.querySelector('#mma-viz-codex-detail');
    if (!detail) return;
    detail.innerHTML = `
      <div style="border:1px solid var(--mma-q-border-soft);border-radius:10px;background:var(--mma-q-bg-elevated);padding:18px 20px 20px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;gap:14px;">
          <div>
            <div style="font-family:Spectral,Georgia,serif;font-size:15px;color:var(--mma-q-text-primary);">${this._escHtml(canvasLabel)}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--mma-q-text-faint);word-break:break-all;margin-top:2px;">${this._escHtml(canvasId)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:11px;color:var(--mma-q-text-muted);">${rects.length} line region${rects.length === 1 ? '' : 's'}</span>
            <button class="viz-refresh-btn" id="mma-viz-codex-detail-close" type="button">Close</button>
          </div>
        </div>
        <div id="mma-viz-codex-detail-viewer" style="position:relative;width:100%;height:560px;background:var(--mma-q-bg-sunken);border:1px solid var(--mma-q-border-soft);border-radius:8px;overflow:hidden;"></div>
      </div>
    `;
    // Smooth scroll to the detail.
    setTimeout(() => detail.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);

    detail.querySelector('#mma-viz-codex-detail-close')?.addEventListener('click', () => {
      cellBtn.classList.remove('selected');
      if (this._vizCodexViewer) {
        try { this._vizCodexViewer.destroy(); } catch (_) {}
        this._vizCodexViewer = null;
      }
      detail.innerHTML = '';
    });

    const viewerEl = detail.querySelector('#mma-viz-codex-detail-viewer');
    const OSD = window.OpenSeadragon;
    if (!OSD) {
      viewerEl.innerHTML = `<div class="viz-error" style="padding:24px;">OpenSeadragon unavailable.</div>`;
      return;
    }

    // Destroy any previous detail viewer.
    if (this._vizCodexViewer) {
      try { this._vizCodexViewer.destroy(); } catch (_) {}
      this._vizCodexViewer = null;
    }

    // OSD tilesource dispatch on kind (same as painting renderer).
    const tileSources = imageKind === 'imageApi'
      ? `${imageIri.replace(/\/$/, '')}/info.json`
      : { type: 'image', url: imageIri };

    let viewer;
    try {
      viewer = OSD({
        element: viewerEl,
        prefixUrl: this._osdPrefixUrl(),
        tileSources,
        showNavigationControl: true,
        showNavigator: false,
        defaultZoomLevel: 0,
        minZoomImageRatio: 0.8,
        maxZoomPixelRatio: 6,
        crossOriginPolicy: 'Anonymous',
      });
    } catch (err) {
      viewerEl.innerHTML = `<div class="viz-error" style="padding:24px;">Viewer init failed: ${this._escHtml(err.message || String(err))}</div>`;
      return;
    }
    this._vizCodexViewer = viewer;

    viewer.addHandler('open', () => {
      try {
        const tiled = viewer.world.getItemAt(0);
        if (!tiled) return;
        const dims = tiled.getContentSize();
        const Wp = W || dims.x;
        const Hp = H || dims.y;
        if (rects.length === 0) return;
        this._mountHeatmapOverlay(viewer, OSD, rects, Wp, Hp, { mode: 'bands' });
      } catch (err) {
        console.warn('[Viz] codex detail heatmap failed', err);
      }
    });

    viewer.addHandler('open-failed', (ev) => {
      console.warn('[Viz] codex tilesource open-failed', ev);
      viewerEl.innerHTML = `<div class="viz-error" style="padding:24px;">Could not open canvas tilesource.</div>`;
    });
  }

  /** Sample queries pre-loaded in the YASGUI dropdown. Predicates
   *  verified live against the running triple store on 2026-05-27. */
  _sampleQueries() {
    return [
      {
        title: 'Annotations by modality',
        query: [
          'PREFIX oa:   <http://www.w3.org/ns/oa#>',
          'PREFIX geko: <https://w3id.org/geko/>',
          '',
          'SELECT ?modality (COUNT(?ann) AS ?count) WHERE {',
          '  GRAPH ?g {',
          '    ?ann a oa:Annotation ;',
          '         geko:hasEkphrasticModality ?modality .',
          '  }',
          '}',
          'GROUP BY ?modality',
          'ORDER BY DESC(?count)',
        ].join('\n'),
      },
      {
        title: 'Ekphrasis per facsimile page',
        query: [
          'PREFIX oa:    <http://www.w3.org/ns/oa#>',
          'PREFIX lrmoo: <http://iflastandards.info/ns/lrm/lrmoo/>',
          '',
          'SELECT ?facsimile_canvas (COUNT(?ann) AS ?annotations) WHERE {',
          '  GRAPH ?g {',
          '    ?ann a oa:Annotation ;',
          '         oa:hasTarget ?target .',
          '    ?target a lrmoo:F2_Expression ;',
          '            oa:hasSource ?facsimile_canvas .',
          '  }',
          '}',
          'GROUP BY ?facsimile_canvas',
          'ORDER BY DESC(?annotations)',
        ].join('\n'),
      },
      {
        title: 'All annotations: text + modality + visual-work canvas',
        query: [
          'PREFIX oa:    <http://www.w3.org/ns/oa#>',
          'PREFIX geko:  <https://w3id.org/geko/>',
          'PREFIX lrmoo: <http://iflastandards.info/ns/lrm/lrmoo/>',
          'PREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
          '',
          'SELECT ?text ?modality ?visual_work_canvas WHERE {',
          '  GRAPH ?g {',
          '    ?ann a oa:Annotation ;',
          '         oa:hasBody ?body ;',
          '         oa:hasTarget ?painting ;',
          '         geko:hasEkphrasticModality ?modality .',
          '    ?body rdf:value ?text .',
          '    ?painting a lrmoo:F1_Work ;',
          '              oa:hasSource ?visual_work_canvas .',
          '  }',
          '}',
          'ORDER BY ?modality',
        ].join('\n'),
      },
      {
        title: 'Annotations created today',
        query: [
          'PREFIX oa:      <http://www.w3.org/ns/oa#>',
          'PREFIX dcterms: <http://purl.org/dc/terms/>',
          'PREFIX xsd:     <http://www.w3.org/2001/XMLSchema#>',
          '',
          'SELECT ?ann ?created WHERE {',
          '  GRAPH ?g {',
          '    ?ann a oa:Annotation ;',
          '         dcterms:created ?created .',
          '    BIND(STRBEFORE(STR(NOW()), "T") AS ?today)',
          '    FILTER (STRSTARTS(STR(?created), ?today))',
          '  }',
          '}',
          'ORDER BY DESC(?created)',
        ].join('\n'),
      },
    ];
  }

  /** Create the Query & Analytics light-DOM view, hidden by default.
   *  Lives at document.body level so YASGUI can take it over without
   *  any shadow-DOM CSS scoping interference. Hidden via class until
   *  the user switches to the Query tab. */
  _buildQueryView() {
    // Install a one-time global stylesheet that defines the Query
    // view's surface tokens + YASGUI overrides. The orchestrator's
    // shadow CSS doesn't reach light DOM, so we duplicate a small
    // palette here. T3 may consolidate by moving the palette to :root.
    if (!document.getElementById('mma-query-view-style')) {
      const style = document.createElement('style');
      style.id = 'mma-query-view-style';
      style.textContent = `
        /* Query view tokens — defined on :root because the Query view
           is mounted on document.body (light DOM), outside the shadow
           tree where the orchestrator's --mma-* tokens live. The
           theme attribute is mirrored to <html> by _setTheme(), so
           toggling dark↔light re-paints both worlds in lockstep. */
        :root {
          --mma-q-bg-base:      #0a0e1a;
          --mma-q-bg-elevated:  #0d1320;
          --mma-q-bg-sunken:    #060912;
          --mma-q-border:       rgba(255,255,255,0.06);
          --mma-q-border-soft:  rgba(255,255,255,0.04);
          --mma-q-text-primary: #e6f4ff;
          --mma-q-text-body:    #c4d4e8;
          --mma-q-text-muted:   #a0aec0;
          --mma-q-text-label:   #8a9cb8;
          --mma-q-text-faint:   #6b7a96;
          --mma-q-accent:       #00d4ff;
          --mma-q-accent-ring:  rgba(0,212,255,0.4);
          --mma-q-accent-ink:   #001824;
          --mma-q-accent-bg:    rgba(0,212,255,0.08);
          --mma-q-magenta:      #ff00b4;
          --mma-q-magenta-bg:   rgba(255,0,180,0.08);
          --mma-q-row-hover:    rgba(0,212,255,0.04);
        }
        :root[data-mma-theme="light"] {
          --mma-q-bg-base:      #f4f6fb;
          --mma-q-bg-elevated:  #ffffff;
          --mma-q-bg-sunken:    #e8ecf3;
          --mma-q-border:       rgba(0,0,0,0.06);
          --mma-q-border-soft:  rgba(0,0,0,0.04);
          --mma-q-text-primary: #0a1628;
          --mma-q-text-body:    #1a2638;
          --mma-q-text-muted:   #3a4458;
          --mma-q-text-label:   #4a5870;
          --mma-q-text-faint:   #5e6b85;
          --mma-q-accent:       #0085a8;
          --mma-q-accent-ring:  rgba(0,133,168,0.4);
          --mma-q-accent-ink:   #ffffff;
          --mma-q-accent-bg:    rgba(0,133,168,0.06);
          --mma-q-magenta:      #c4008c;
          --mma-q-magenta-bg:   rgba(196,0,140,0.06);
          --mma-q-row-hover:    rgba(0,0,0,0.03);
        }
        #mma-query-view {
          position: fixed;
          top: 92px;
          left: 0;
          right: 0;
          bottom: 48px;
          display: none;
          flex-direction: column;
          background: var(--mma-q-bg-base);
          color: var(--mma-q-text-primary);
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          z-index: 500;
          overflow: hidden;
        }
        #mma-query-view.visible { display: flex; }

        /* ─── Toolbar (left dropdown, right faint metadata) ─── */
        .mma-query-toolbar {
          padding: 20px 28px 16px;
          border-bottom: 1px solid var(--mma-q-border);
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 24px;
          flex-shrink: 0;
        }
        .mma-query-toolbar-left {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .mma-query-toolbar-label {
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--mma-q-text-label, #a8adba);
        }
        .mma-query-preset {
          height: 32px;
          padding: 0 12px;
          border: 1px solid var(--mma-q-border);
          border-radius: 6px;
          background: var(--mma-q-bg-elevated);
          color: var(--mma-q-text-primary);
          font-family: inherit;
          font-size: 12.5px;
          cursor: pointer;
          min-width: 300px;
        }
        .mma-query-preset:focus {
          outline: none;
          border-color: var(--mma-q-accent-ring);
        }
        .mma-query-toolbar-right {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          line-height: 1.4;
          white-space: nowrap;
          color: var(--mma-q-text-faint);
        }
        .mma-query-shortcut {
          color: var(--mma-q-text-faint);
        }
        /* Gear button — opens the endpoint settings popover (Bug B3). */
        .mma-query-gear-btn {
          width: 26px;
          height: 26px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--mma-q-border);
          border-radius: 6px;
          background: transparent;
          color: var(--mma-q-text-faint);
          cursor: pointer;
          padding: 0;
          transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
        }
        .mma-query-gear-btn:hover {
          color: var(--mma-q-text-primary);
          border-color: var(--mma-q-border);
          background: var(--mma-q-row-hover);
        }
        .mma-query-gear-btn[aria-expanded="true"] {
          color: var(--mma-q-accent);
          border-color: var(--mma-q-accent-ring);
        }
        .mma-query-settings-popover {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 12px 14px;
          background: var(--mma-q-bg-elevated);
          border: 1px solid var(--mma-q-border);
          border-radius: 6px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.25);
          z-index: 10;
          min-width: 260px;
        }
        .mma-query-popover-label {
          font-size: 9.5px;
          font-weight: 500;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--mma-q-text-label);
          font-family: 'IBM Plex Sans', system-ui, sans-serif;
        }
        .mma-query-popover-value {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 12px;
          color: var(--mma-q-text-body);
          word-break: break-all;
        }

        /* ─── YASGUI mount: takes all remaining height, internal scroll ─── */
        .mma-query-yasgui {
          flex: 1;
          min-height: 0;        /* lets the flex child shrink below its content */
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 18px 28px 24px;
        }
        .mma-query-yasgui-loading {
          padding: 40px 20px;
          color: var(--mma-q-text-faint);
          font-size: 13px;
          text-align: center;
        }
        .mma-query-yasgui-error {
          padding: 24px 20px;
          color: #d77a72;
          font-size: 13px;
          background: rgba(215, 122, 114, 0.08);
          border: 1px solid rgba(215, 122, 114, 0.3);
          border-radius: 8px;
          margin: 20px;
        }

        /* Layout-level YASGUI chrome only. Surface colours, fonts and
           CodeMirror syntax theme are scoped into
           _injectYasguiOverrides() which appends AFTER YASGUI's CDN
           stylesheet — same-specificity rules win without !important. */
        #mma-query-view .yasgui {
          background: transparent;
          border: none;
        }
        #mma-query-view .yasgui .tabsList {
          background: transparent;
          border-bottom: 1px solid var(--mma-q-border-soft);
        }
        #mma-query-view .yasgui .yasqe,
        #mma-query-view .yasgui .yasr {
          border: 1px solid var(--mma-q-border);
          border-radius: 8px;
        }
        /* No margin-top on .yasr — the split-pane handle is the
           separator now. (Was 10px; combined with .yasr_fallback_info
           and YASR's plugin chrome it ate ~135px of table space.) */
        #mma-query-view .yasgui .yasr { margin-top: 0; }
        /* Run button — gold accent stays a layout concern (button is
           outside the CodeMirror area, doesn't fight YASGUI defaults). */
        #mma-query-view .yasgui .yasqe_buttons .yasqe_query {
          background: var(--mma-q-accent);
          color: var(--mma-q-accent-ink);
          border: none;
        }
      `;
      document.head.appendChild(style);
    }

    if (!this._queryViewMount) {
      const wrap = document.createElement('div');
      wrap.id = 'mma-query-view';
      wrap.innerHTML = `
        <div class="mma-query-toolbar">
          <div class="mma-query-toolbar-left">
            <span class="mma-query-toolbar-label">Sample query</span>
            <select class="mma-query-preset" id="mma-query-preset">
              <option value="">— pick a sample —</option>
            </select>
          </div>
          <div class="mma-query-toolbar-right">
            <span class="mma-query-shortcut" aria-hidden="true">⌘ + ↵ to execute</span>
            <button class="mma-query-gear-btn" id="mma-query-gear-btn" type="button"
                    title="Endpoint settings" aria-label="Endpoint settings" aria-expanded="false">
              <!-- Minimal gear glyph; no icon font dependency. -->
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <div class="mma-query-settings-popover" id="mma-query-settings-popover" role="dialog" aria-label="Endpoint settings" hidden>
              <span class="mma-query-popover-label">SPARQL endpoint</span>
              <code class="mma-query-popover-value">${this._sparqlEndpoint()}</code>
            </div>
          </div>
        </div>
        <div class="mma-query-yasgui" id="mma-query-yasgui-mount">
          <div class="mma-query-yasgui-loading">YASGUI will load on first use…</div>
        </div>
      `;
      document.body.appendChild(wrap);
      this._queryViewMount = wrap;

      // Populate the preset dropdown
      const select = wrap.querySelector('#mma-query-preset');
      const presets = this._sampleQueries();
      presets.forEach((q, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = q.title;
        select.appendChild(opt);
      });
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value, 10);
        if (!Number.isInteger(idx)) return;
        const q = presets[idx];
        if (q && this._yasguiInstance) {
          try {
            const tab = this._yasguiInstance.getTab();
            tab.setQuery(q.query);
            // No autorun — let the user hit the play button explicitly
            // so they see what they're about to send. (Phase 3 may add
            // an autorun flag on demo presets.)
          } catch (err) {
            console.warn('[MMA Query] could not set query on YASGUI tab', err);
          }
        }
      });

      // Endpoint settings popover (Bug B3) — gear opens it, outside
      // click or Esc closes it. Popover is just a static display of
      // the resolved endpoint URL; editing it inline is a Phase 3
      // concern (needs request-config persistence).
      const gear    = wrap.querySelector('#mma-query-gear-btn');
      const popover = wrap.querySelector('#mma-query-settings-popover');
      if (gear && popover) {
        const closePopover = () => {
          popover.hidden = true;
          gear.setAttribute('aria-expanded', 'false');
        };
        const openPopover = () => {
          popover.hidden = false;
          gear.setAttribute('aria-expanded', 'true');
        };
        gear.addEventListener('click', (e) => {
          e.stopPropagation();
          popover.hidden ? openPopover() : closePopover();
        });
        // Outside click → close (only when open).
        document.addEventListener('click', (e) => {
          if (popover.hidden) return;
          if (popover.contains(e.target) || gear.contains(e.target)) return;
          closePopover();
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && !popover.hidden) closePopover();
        });
      }
    }
  }

  _activateTab(name) {
    const tabs = ['annotate', 'query', 'datamodel', 'viz'];
    const active = tabs.includes(name) ? name : 'annotate';
    const isAnnotate = active === 'annotate';

    for (const t of tabs) {
      const btn = this.shadowRoot.getElementById(`tab-${t}`);
      if (!btn) continue;
      btn.classList.toggle('active', t === active);
      btn.setAttribute('aria-selected', String(t === active));
    }

    const mainWrapper = this.shadowRoot.querySelector('.main-wrapper');
    const sidebar     = this.shadowRoot.querySelector('.sidebar');
    if (mainWrapper) {
      mainWrapper.classList.toggle('tab-query-active',     active === 'query');
      mainWrapper.classList.toggle('tab-datamodel-active', active === 'datamodel');
      mainWrapper.classList.toggle('tab-viz-active',       active === 'viz');
    }
    if (sidebar) sidebar.style.visibility = isAnnotate ? '' : 'hidden';

    // Toggle the light-DOM Query + Viz mounts and the shadow
    // Data Model section.
    if (this._queryViewMount) this._queryViewMount.classList.toggle('visible', active === 'query');
    if (this._vizViewMount)   this._vizViewMount.classList.toggle('visible',   active === 'viz');
    const dm = this.shadowRoot.getElementById('data-model-view');
    if (dm) dm.hidden = active !== 'datamodel';

    if (active === 'query') {
      this._activateQueryView().catch((err) => {
        console.warn('[MMA Query] YASGUI activation failed:', err);
      });
    }
    if (active === 'datamodel') {
      this._renderDataModelView();
    }
    if (active === 'viz') {
      this._activateVizView().catch((err) => {
        console.warn('[MMA Viz] activation failed:', err);
      });
    }
  }

  /** Inject YASGUI CSS + JS from CDN once, idempotent. */
  _loadYasgui() {
    if (window.Yasgui) return Promise.resolve(window.Yasgui);
    if (this._yasguiLoadingPromise) return this._yasguiLoadingPromise;

    this._yasguiLoadingPromise = new Promise((resolve, reject) => {
      // CSS
      if (!document.getElementById('mma-yasgui-css')) {
        const link = document.createElement('link');
        link.id = 'mma-yasgui-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/@triply/yasgui/build/yasgui.min.css';
        document.head.appendChild(link);
      }
      // JS
      const existing = document.getElementById('mma-yasgui-js');
      if (existing) {
        // Already loading from a prior call — wait
        existing.addEventListener('load', () => resolve(window.Yasgui));
        existing.addEventListener('error', () => reject(new Error('YASGUI CDN load failed')));
        return;
      }
      const script = document.createElement('script');
      script.id = 'mma-yasgui-js';
      script.src = 'https://unpkg.com/@triply/yasgui/build/yasgui.min.js';
      script.onload = () => resolve(window.Yasgui);
      script.onerror = () => reject(new Error('YASGUI CDN load failed'));
      document.head.appendChild(script);
    });
    return this._yasguiLoadingPromise;
  }

  async _activateQueryView() {
    if (this._yasguiInstance) return; // already initialized
    const mount = this._queryViewMount?.querySelector('#mma-query-yasgui-mount');
    if (!mount) return;
    try {
      const Yasgui = await this._loadYasgui();
      // Now that YASGUI's CSS link is in <head>, inject our override
      // stylesheet AFTER it — same-specificity rules of ours win the
      // cascade without resorting to !important.
      this._injectYasguiOverrides();

      // Clear the loading placeholder before YASGUI takes over
      mount.innerHTML = '';
      // Optional: turn off persistence so the YASGUI tab state doesn't
      // outlive the session (Phase 1 demo wants a clean canvas).
      try { Yasgui.Yasr?.defaults?.persistencyExpire && (Yasgui.Yasr.defaults.persistencyExpire = 0); } catch (_) {}

      // Default DataTables pageLength to 25 (was 50). Smaller initial
      // row count = lighter DOM and a more responsive sticky-header
      // scroll. Wrapped in try/catch because YASR's internal config
      // shape changes between minor versions.
      try {
        const tableDefaults = Yasgui.Yasr?.plugins?.table?.defaults;
        if (tableDefaults) tableDefaults.pageSize = 25;
      } catch (_) {}

      this._yasguiInstance = new Yasgui(mount, {
        requestConfig: {
          endpoint: this._sparqlEndpoint(),
          // Use POST so big queries don't hit URL-length limits and
          // CORS preflight matches what the backend already allows.
          method: 'POST',
        },
        copyEndpointOnNewTab: false,
        yasr: {
          // Plugin-level config shape supported by YASGUI 4.x. If a
          // future YASGUI ignores it, the post-render hook below
          // catches the same default via the DataTables API.
          pluginOrder: ['table', 'response', 'boolean'],
          defaultPlugin: 'table',
        },
      });

      // Belt + suspenders: when results render, walk into the active
      // YASR's DataTables instance and force pageLength 25 if it
      // wasn't picked up from the static defaults above.
      try {
        this._yasguiInstance.on?.('query', () => {
          requestAnimationFrame(() => this._applyResultsPageSize(25));
        });
      } catch (_) {}

      // Seed the first sample query into the active tab
      const sample = this._sampleQueries()[0];
      if (sample) {
        try { this._yasguiInstance.getTab().setQuery(sample.query); } catch (_) {}
      }

      // Attach the resize handle once .yasqe + .yasr are in the DOM.
      // YASGUI usually mounts them synchronously; retry a few frames
      // if not, then give up (handle simply absent — layout still
      // works at the CSS default 40/60).
      let tries = 0;
      const tryAttach = () => {
        if (this._attachQueryResizeHandle()) return;
        if (++tries < 30) requestAnimationFrame(tryAttach);
      };
      requestAnimationFrame(tryAttach);
    } catch (err) {
      mount.innerHTML = `
        <div class="mma-query-yasgui-error">
          Failed to load YASGUI from CDN. Check the network connection.
          <br><small>${String(err?.message || err)}</small>
        </div>
      `;
      throw err;
    }
  }

  /** Inject a vertical resize handle between YASGUI's editor (.yasqe)
   *  and results (.yasr) panes. Idempotent — bails out if the handle
   *  is already present. Restores a persisted editor height from
   *  localStorage. Drag listens on document so the cursor doesn't
   *  flicker when the mouse exits the handle mid-drag. Dbl-click
   *  resets to the 40% default. */
  _attachQueryResizeHandle() {
    const mount = this._queryViewMount?.querySelector('.mma-query-yasgui');
    const yasgui = mount?.querySelector('.yasgui');
    if (!yasgui) return false;
    // YASGUI 4 keeps one .yasqe/.yasr pair PER TAB in the DOM —
    // inactive tabs use display:none. Pick the visible pair via
    // offsetParent (null = display:none anywhere up the chain).
    const isVisible = (el) => el && el.offsetParent !== null;
    const editors  = Array.from(yasgui.querySelectorAll('.yasqe'));
    const results_ = Array.from(yasgui.querySelectorAll('.yasr'));
    const editor   = editors.find(isVisible)  || editors[0];
    const results  = results_.find(isVisible) || results_[0];
    if (!editor || !results) return false;

    // YASGUI 4 wraps .yasqe and .yasr in their OWN container divs
    // (likely a React render boundary), so they don't share an
    // immediate parent. Walk up from each until we hit a common
    // ancestor — that's the real flex container. Then the immediate
    // children of that ancestor in the .yasqe / .yasr chains ARE
    // the flex items we need to size and insert the handle between.
    const ancestors = new Set();
    for (let p = editor; p; p = p.parentNode) ancestors.add(p);
    let container = null;
    for (let p = results; p; p = p.parentNode) {
      if (ancestors.has(p)) { container = p; break; }
    }
    if (!container || container === editor || container === results) {
      if (!this._dragAttachWarned) {
        console.warn('[MMA Query] could not find common ancestor for .yasqe and .yasr; resize handle skipped');
        this._dragAttachWarned = true;
      }
      return false;
    }
    const outerOf = (descendant) => {
      let p = descendant;
      while (p && p.parentNode !== container) p = p.parentNode;
      return p;
    };
    const editorWrapper  = outerOf(editor);
    const resultsWrapper = outerOf(results);
    if (!editorWrapper || !resultsWrapper) return false;
    if (container.querySelector(':scope > .mma-resize-handle')) return true; // already there

    // Walk from container up to the .mma-query-yasgui mount, forcing
    // the flex chain on every ancestor. YASGUI 4 inserts unstyled
    // React render-boundary divs between .yasgui and the tab pane;
    // any one of them missing `display:flex` or `min-height:0`
    // breaks the chain and container collapses to content height
    // (was 165.5px in user's log; should be ~600px). flex:1 1 auto
    // not 1 1 0 — auto basis lets natural content seed the layout.
    const forceFlexColumn = (el) => {
      el.style.setProperty('display',        'flex',   '');
      el.style.setProperty('flex-direction', 'column', '');
      el.style.setProperty('min-height',     '0',      '');
      el.style.setProperty('flex',           '1 1 auto', '');
      el.style.setProperty('overflow',       'hidden', '');
    };
    // The container itself: force-grow + fill explicitly.
    container.style.setProperty('display',        'flex',   '');
    container.style.setProperty('flex-direction', 'column', '');
    container.style.setProperty('min-height',     '0',      '');
    container.style.setProperty('flex',           '1 1 auto', '');
    container.style.setProperty('height',         '100%',   '');
    // Climb up to .mma-query-yasgui (the mount we control via CSS)
    // and propagate the flex chain on every intermediate ancestor.
    let node = container.parentNode;
    let steps = 0;
    while (node && node !== mount && steps < 10) {
      forceFlexColumn(node);
      node = node.parentNode;
      steps++;
    }
    // editorWrapper: explicit default basis so something non-trivial
    // is allocated even before the user drags.
    editorWrapper.style.flex      = '0 0 40%';
    editorWrapper.style.minHeight = '120px';
    editorWrapper.style.display   = 'flex';
    editorWrapper.style.flexDirection = 'column';
    editorWrapper.style.overflow  = 'hidden';
    // resultsWrapper fills the rest.
    resultsWrapper.style.flex     = '1 1 0';
    resultsWrapper.style.minHeight = '0';
    resultsWrapper.style.display  = 'flex';
    resultsWrapper.style.flexDirection = 'column';
    resultsWrapper.style.overflow = 'hidden';

    const handle = document.createElement('div');
    handle.className = 'mma-resize-handle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', 'Resize editor and results');
    handle.title = 'Drag to resize · double-click to reset';
    // Insert BETWEEN the two wrappers (siblings under container).
    container.insertBefore(handle, resultsWrapper);

    // Restore persisted size if any (else leave the 40% default).
    this._applyEditorSplitFromStorage(editorWrapper, container);

    // Helper: apply a height to the EDITOR'S WRAPPER (the actual
    // flex item under container). Setting on .yasqe itself does
    // nothing visible when YASGUI puts it inside an intermediate
    // div — that intermediate div is what owns the flex line height.
    const setEditorHeight = (px) => {
      const v = `${px}px`;
      editorWrapper.style.setProperty('height',      v, '');
      editorWrapper.style.setProperty('flex-basis',  v, '');
      editorWrapper.style.setProperty('flex-grow',   '0', '');
      editorWrapper.style.setProperty('flex-shrink', '0', '');
      editorWrapper.style.setProperty('min-height',  '120px', '');
      // Also size the inner .yasqe so CodeMirror fills the wrapper.
      if (editor !== editorWrapper) {
        editor.style.height = '100%';
        editor.style.minHeight = '0';
      }
    };

    const onMove = (event) => {
      // preventDefault during mousemove too — kills the text-selection
      // ghost some browsers initiate even with body userSelect:none.
      event.preventDefault();
      const deltaY = event.clientY - this._dragStartY;
      const containerH = this._dragContainerH;
      let newHeight = this._dragStartEditorHeight + deltaY;
      newHeight = Math.max(120, Math.min(containerH - 180, newHeight));
      setEditorHeight(newHeight);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        const h = Math.round(editorWrapper.getBoundingClientRect().height);
        localStorage.setItem('mma:query-editor-height', String(h));
      } catch (_) { /* no storage */ }
    };
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this._dragStartY            = event.clientY;
      this._dragStartEditorHeight = editorWrapper.getBoundingClientRect().height;
      this._dragContainerH        = container.getBoundingClientRect().height;
      handle.classList.add('dragging');
      // Lock the cursor + suppress text selection across the whole
      // document — prevents flicker if the cursor escapes the 6px
      // handle during a fast drag.
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', () => {
      try { localStorage.removeItem('mma:query-editor-height'); } catch (_) {}
      // Clear all locking properties on both wrapper and inner so
      // YASGUI's default layout takes back over.
      ['height', 'flex-basis', 'flex-grow', 'flex-shrink', 'min-height'].forEach((p) => {
        editorWrapper.style.removeProperty(p);
      });
      if (editor !== editorWrapper) {
        editor.style.removeProperty('height');
        editor.style.removeProperty('min-height');
      }
      // Reseed the default basis so the divider settles back at 40%.
      editorWrapper.style.flex = '0 0 40%';
      editorWrapper.style.minHeight = '120px';
    });
    return true;
  }

  /** Read a persisted editor-wrapper height (px) from localStorage
   *  and apply it via the flex-basis + grow/shrink lock the drag
   *  uses. Rejected if:
   *   - value is missing or NaN
   *   - value equals or is below the 120px floor (almost certainly
   *     a "stuck" artefact from a previous session where the drag
   *     range collapsed to the minimum — auto-clear so the user
   *     returns to the 40% default without manual intervention)
   *   - value would leave less than 180px for the results table */
  _applyEditorSplitFromStorage(editorWrapper, container) {
    let saved = NaN;
    try { saved = parseFloat(localStorage.getItem('mma:query-editor-height') || ''); }
    catch (_) { /* no storage */ }
    if (!Number.isFinite(saved) || saved <= 120) {
      try { localStorage.removeItem('mma:query-editor-height'); } catch (_) {}
      return;
    }
    const containerH = container.getBoundingClientRect().height;
    if (containerH > 0 && saved > containerH - 180) {
      try { localStorage.removeItem('mma:query-editor-height'); } catch (_) {}
      return;
    }
    const v = `${saved}px`;
    editorWrapper.style.setProperty('height',      v, '');
    editorWrapper.style.setProperty('flex-basis',  v, '');
    editorWrapper.style.setProperty('flex-grow',   '0', '');
    editorWrapper.style.setProperty('flex-shrink', '0', '');
    editorWrapper.style.setProperty('min-height',  '120px', '');
  }

  /** Reach into the active YASR's DataTables instance and set
   *  pageLength. Called after every query because YASR recreates the
   *  DataTable on each render, losing earlier API mutations. */
  _applyResultsPageSize(size) {
    try {
      const wrap = this._queryViewMount?.querySelector('.dataTables_wrapper');
      if (!wrap) return;
      // Prefer the jQuery DataTables API that YASR bundles internally.
      const tableEl = wrap.querySelector('table.dataTable');
      const jq = window.jQuery || window.$;
      if (tableEl && jq && jq.fn?.DataTable?.isDataTable?.(tableEl)) {
        jq(tableEl).DataTable().page.len(size).draw();
        return;
      }
      // Fallback: tweak the length select if YASR exposes it.
      const sel = wrap.querySelector('.dataTables_length select');
      if (sel) {
        sel.value = String(size);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (_) { /* best-effort, never throws */ }
  }

  /** Inject the YASGUI-specific overrides (font + syntax theme +
   *  surface colours). Called AFTER YASGUI's CDN stylesheet so my
   *  rules win the cascade at equal specificity without !important.
   *  Idempotent. */
  _injectYasguiOverrides() {
    if (document.getElementById('mma-yasgui-overrides')) return;
    const style = document.createElement('style');
    style.id = 'mma-yasgui-overrides';
    style.textContent = `
      /* ── Editor surface (FIX B4) ───────────────────────────────────
         Only bg + border + font + size are overridden. The SPARQL
         syntax colouring is left to YASGUI/CodeMirror defaults per
         the v3 spec (the user prefers the upstream palette). */
      #mma-query-view .yasqe,
      #mma-query-view .yasqe .CodeMirror {
        background: var(--mma-q-bg-base);
        border: 1px solid var(--mma-q-border-soft);
        border-radius: 8px;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 13.5px;
        line-height: 1.55;
      }
      /* Default text colour only — let cm-* token rules win for syntax. */
      #mma-query-view .yasqe .CodeMirror-line {
        font-family: inherit;
      }
      #mma-query-view .yasqe .CodeMirror-gutters {
        background: transparent;
        border-right: 1px solid var(--mma-q-border-soft);
      }
      #mma-query-view .yasqe .CodeMirror-linenumber {
        color: var(--mma-q-text-faint);
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 11.5px;
      }

      /* ── Full-height flex layout — internal scroll only ──────────
         YASGUI's default layout lets the body grow with the result
         set, which produces a page-level scroll. Force the chain
         .yasgui > content-pane > .yasr > results-table to flex so
         the table itself owns the scroll. */
      #mma-query-view .yasgui {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #mma-query-view .yasgui > .tabsList {
        flex-shrink: 0;
      }
      /* The pane below .tabsList is whatever YASGUI emits — usually
         .tabPanelsContainer or a plain div containing .yasqe + .yasr.
         Match every non-tabsList direct child as a content pane. */
      #mma-query-view .yasgui > *:not(.tabsList) {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      /* Editor: resizable. Default flex-basis 40% of the content
         pane; JS overrides via inline style.height + flex-basis once
         the user drags the handle or a persisted value is restored.
         box-sizing forced to border-box so getBoundingClientRect()
         returns a value consistent with what we feed back into
         style.height — otherwise the cursor "scappa" mid-drag. */
      #mma-query-view .yasqe {
        flex: 0 0 40%;
        height: 40%;
        min-height: 120px;
        box-sizing: border-box;
      }
      #mma-query-view .yasqe .CodeMirror {
        height: 100%;
        min-height: 0;
        max-height: none;
      }

      /* Resize handle — 6px transparent hit zone between the editor
         and results wrappers, with a 1×30px divider line at the
         centre. Hover/drag brightens the line to the accent and
         doubles its width. */
      #mma-query-view .mma-resize-handle {
        flex: 0 0 6px;
        height: 6px;
        background: transparent;
        cursor: ns-resize;
        position: relative;
        user-select: none;
        touch-action: none;
        pointer-events: auto;
        z-index: 5;
      }
      #mma-query-view .mma-resize-handle::before {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 30px;
        height: 1px;
        background: var(--mma-q-border);
        transition: width 0.12s ease, height 0.12s ease, background 0.12s ease;
      }
      #mma-query-view .mma-resize-handle:hover::before,
      #mma-query-view .mma-resize-handle.dragging::before {
        width: 40px;
        height: 2px;
        background: var(--mma-q-accent);
      }

      /* Results: take the rest. min-height MUST be 0 — the canonical
         flexbox pitfall is that a flex child defaults to min-height:
         auto (≈ content-size), which prevents overflow:hidden from
         clipping and the scroll on .yasr_results from ever scattering.
         The 120px floor for the table is enforced by the drag clamp
         (containerH - 180), so the table never collapses while the
         user resizes. */
      #mma-query-view .yasr {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      /* Plugin selector strip stays fixed at the top of .yasr. */
      #mma-query-view .yasr > .yasr_header,
      #mma-query-view .yasr > .yasr_btnGroup {
        flex-shrink: 0;
      }
      /* Any intermediate wrapper YASR may insert between .yasr and
         .yasr_results must also be flex-shrinkable. The :not chain
         MUST exclude .yasr_results — otherwise this rule's
         overflow:hidden cascades onto the scrolling viewport itself
         and kills it (self-inflicted regression caught by user
         DevTools inspection). */
      #mma-query-view .yasr > div:not(.yasr_header):not(.yasr_btnGroup):not(.yasr_results) {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      /* THE scroll surface. display: flex + flex-direction column
         restored — without them DataTables' inner layout collapsed
         and the rendered rows disappeared visually (the data was
         still there in the DOM, just at zero height). margin/padding
         explicitly zeroed to kill the "tantissimo padding" gap the
         user reported between the plugin selector and the rows. */
      #mma-query-view .yasr > .yasr_results,
      #mma-query-view .yasr .yasr_results {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: auto;
        margin: 0;
        padding: 0;
      }
      /* DataTables wrapper inside .yasr_results — content grows
         freely, parent (the scroller) clips. Width pinned so wide
         literal columns don't blow past the viewport. */
      #mma-query-view .yasr_results .dataTables_wrapper {
        width: 100%;
        max-width: 100%;
        overflow: visible;
      }
      /* DataTables internal wrappers — must NOT introduce their own
         scroll, or they break the sticky offset chain on the table
         header. */
      #mma-query-view .yasr .dataTables_wrapper,
      #mma-query-view .yasr .dataTables_scrollBody {
        overflow: visible;
      }
      /* Sticky column headers — pinned to .yasr_results viewport.
         z-index: 2 keeps them above body rows but below any future
         dropdown/popover plumbing. */
      #mma-query-view .mma-query-yasgui .yasr_results table thead,
      #mma-query-view .yasr table thead {
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--mma-q-bg-elevated);
      }
      #mma-query-view .yasr table thead th,
      #mma-query-view .yasr table.dataTable thead th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--mma-q-bg-elevated);
        box-shadow: inset 0 -1px 0 var(--mma-q-border);
      }

      /* ── Ghost context menu (FIX 2) ──────────────────────────────
         YASGUI's tabContextMenu is rendered eagerly and toggled on
         right-click via inline style. Hide by default; the JS toggle
         sets inline display:block which beats this rule (inline > CSS
         without !important). Covers both inline-style and class-based
         reveal patterns. */
      #mma-query-view .yasgui .tabContextMenu,
      #mma-query-view .yasgui [class*='ContextMenu'],
      #mma-query-view .yasgui [class*='contextMenu'] {
        display: none;
      }
      /* If YASGUI shows via class (.open / .shown / .visible) restore: */
      #mma-query-view .yasgui .tabContextMenu.open,
      #mma-query-view .yasgui .tabContextMenu.shown,
      #mma-query-view .yasgui .tabContextMenu.visible {
        display: block;
      }

      /* ── Hide YASGUI's internal endpoint URL bar (Bug B3) ────────
         When still visible, clicking the input triggered the browser's
         autocomplete dropdown for "localhost" entries — disorienting.
         Settings live behind the gear icon in our toolbar instead. */
      #mma-query-view .yasgui .endpoint,
      #mma-query-view .yasgui .endpointText,
      #mma-query-view .yasgui .requestConfig,
      #mma-query-view .yasgui .yasqe_endpointText,
      #mma-query-view .yasgui [class*='endpoint' i] input,
      #mma-query-view .yasgui input[type='url'],
      #mma-query-view .yasgui input[name*='endpoint' i] {
        display: none;
      }

      /* ── Internal YASGUI tab strip — minimalist (FIX 2) ──────────
         YASGUI tabs are the lower nav level; the upper one is the
         shadow's ANNOTATE / QUERY & ANALYTICS strip. Differentiate
         active by text weight + colour, NOT by a coloured underline
         (that fought visually with the upper-level accent line).
         Scoping is restricted to .tab only — broad li selectors
         were masking YASGUI's mascot icon, which lives as another
         child of .tabsList (FIX 1). */
      #mma-query-view .yasgui .tabsList {
        background: transparent;
        border-bottom: 1px solid var(--mma-q-border);
      }
      #mma-query-view .yasgui .tabsList .tab {
        color: var(--mma-q-text-faint);
        font-family: 'IBM Plex Sans', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 400;
        letter-spacing: 0.01em;
        border: 0;
        border-bottom: 0;
        background: transparent;
        cursor: pointer;
        transition: color 0.12s ease;
      }
      #mma-query-view .yasgui .tabsList .tab:hover {
        color: var(--mma-q-text-muted);
      }
      #mma-query-view .yasgui .tabsList .tab.active,
      #mma-query-view .yasgui .tabsList .tab.selected {
        color: var(--mma-q-text-primary);
        font-weight: 500;
        border: 0;
        border-bottom: 0;
        background: transparent;
      }

      /* ── Results / YASR — dark coherent surface (FIX 4) ──────────
         YASGUI ships a white table from DataTables.js. Re-skin the
         whole results surface to the museale palette: elevated bg
         for thead, base bg for cells, gold IRIs, faint lang tags. */
      #mma-query-view .yasr,
      #mma-query-view .yasr .yasr_results {
        background: var(--mma-q-bg-base);
        color: var(--mma-q-text-body);
        border: none;
      }
      #mma-query-view .yasr table,
      #mma-query-view .yasr table.dataTable {
        background: var(--mma-q-bg-base);
        color: var(--mma-q-text-body);
        font-family: 'IBM Plex Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
        font-size: 13px;
        border-collapse: collapse;
        border-spacing: 0;
        width: 100%;
        border: none;
        margin: 0;
      }
      /* Zero any spacing the DataTables theme puts between thead and
         tbody. Browser default thead has no border, but DataTables'
         CSS adds a thicker border-bottom that gets perceived as a gap
         when combined with sticky positioning. */
      #mma-query-view .yasr table thead,
      #mma-query-view .yasr table.dataTable thead {
        margin: 0;
        padding: 0;
        border: 0;
      }
      #mma-query-view .yasr table tbody,
      #mma-query-view .yasr table.dataTable tbody {
        margin: 0;
        padding: 0;
        border: 0;
      }
      #mma-query-view .yasr table tbody tr:first-child td,
      #mma-query-view .yasr table.dataTable tbody tr:first-child td {
        border-top: 0;
      }
      #mma-query-view .yasr table thead th,
      #mma-query-view .yasr table.dataTable thead th {
        background: var(--mma-q-bg-elevated);
        color: var(--mma-q-text-label, #a8adba);
        text-transform: uppercase;
        letter-spacing: 0.10em;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 10.5px;
        font-weight: 500;
        border-bottom: 1px solid var(--mma-q-border);
        border-top: none;
        padding: 10px 14px;
        text-align: left;
      }
      #mma-query-view .yasr table tbody td,
      #mma-query-view .yasr table.dataTable tbody td {
        background: var(--mma-q-bg-base);
        color: var(--mma-q-text-body);
        border-top: 1px solid var(--mma-q-border-soft);
        border-bottom: none;
        padding: 9px 14px;
        word-break: break-word;
      }
      /* Row hover/selection use theme-aware tokens — never raw white,
         which stood out as harshly bright over the dark surface (B2). */
      #mma-query-view .yasr table tbody tr,
      #mma-query-view .yasr table.dataTable tbody tr {
        background: transparent;
      }
      #mma-query-view .yasr table tbody tr:hover td,
      #mma-query-view .yasr table.dataTable tbody tr:hover td {
        background: var(--mma-q-row-hover);
      }
      #mma-query-view .yasr table tbody tr.selected td,
      #mma-query-view .yasr table.dataTable tbody tr.selected td {
        background: var(--mma-q-accent-bg);
      }
      /* IRI / link */
      #mma-query-view .yasr table a,
      #mma-query-view .yasr table tbody a,
      #mma-query-view .yasr .uri a {
        color: var(--mma-q-accent);
        text-decoration: none;
      }
      #mma-query-view .yasr table a:hover {
        text-decoration: underline;
      }
      /* Language / datatype suffix YASR appends to literals */
      #mma-query-view .yasr .lang,
      #mma-query-view .yasr .yasr_literal_lang,
      #mma-query-view .yasr .literalLang,
      #mma-query-view .yasr .datatype,
      #mma-query-view .yasr .literal-suffix {
        color: var(--mma-q-text-faint);
        font-size: 11px;
        margin-left: 4px;
      }

      /* DataTables chrome (pagination, info, filter) */
      #mma-query-view .yasr .dataTables_wrapper {
        background: var(--mma-q-bg-base);
        color: var(--mma-q-text-muted);
        padding: 0;
        margin: 0;
      }
      /* Zero all margins on EVERY direct child of .dataTables_wrapper
         and force the table itself to have no top spacing. Defensive
         against whatever divs DataTables wraps chrome in (.top/.bottom
         /.row/etc varies by build). The visible chrome (info +
         paginate) re-applies its own padding below. */
      #mma-query-view .yasr .dataTables_wrapper > * {
        margin: 0;
      }
      #mma-query-view .yasr table.dataTable,
      #mma-query-view .yasr .dataTables_wrapper table {
        margin: 0 !important;
        border-spacing: 0;
      }
      /* Hide DataTables chrome (length, filter) plus the YASR-side
         duplicates that DON'T use those classes — .tableFilter and
         .pageSizeWrapper live inside .yasr_plugin_control. Also
         hide the row/top Bootstrap wrappers DataTables sometimes
         puts them in, which keep their own padding. */
      #mma-query-view .yasr .dataTables_length,
      #mma-query-view .yasr .dataTables_filter,
      #mma-query-view .yasr .dataTables_wrapper > .top,
      #mma-query-view .yasr .dataTables_wrapper > .row:first-child,
      #mma-query-view .yasr .dataTables_wrapper > .row:has(.dataTables_length),
      #mma-query-view .yasr .dataTables_wrapper > .row:has(.dataTables_filter),
      #mma-query-view .yasr .tableFilter,
      #mma-query-view .yasr .pageSizeWrapper,
      #mma-query-view .yasr .tableControls .switch {
        display: none;
      }
      /* ── The actual culprit found via DOM dump (h=97 of nothing
         between the toolbar and .yasr_results). Empty fallback panel
         that YASR allocates flex space to even when unused. YASGUI
         sets inline style display:flex on it, so !important is the
         only way to win — every other YASR element I targeted
         responded to plain display:none. */
      #mma-query-view .yasr .yasr_fallback_info,
      #mma-query-view .yasr_fallback_info,
      .yasr_fallback_info {
        display: none !important;
      }
      /* YASR drops a generic spacer inside its header — kill. */
      #mma-query-view .yasr .yasr_header .space_element {
        display: none;
      }
      /* Column-resize grip handles inside the table — visually
         redundant for a read-only demo and they introduce a thin
         absolutely-positioned strip that confuses cursor:ns-resize. */
      #mma-query-view .yasr .grip-container {
        display: none;
      }
      /* YASR table plugin uses DataTables scrollY mode, which clones
         the thead into .dataTables_scrollHead and leaves a HIDDEN
         (visibility:hidden, NOT display:none) thead inside
         .dataTables_scrollBody — that hidden thead takes its full
         vertical space, producing the "huge padding" between visible
         header and first row. Two-step fix:
           - kill the scrollHead clone (we rely on sticky thead inside
             the body table for the same effect)
           - collapse the body table's thead so it consumes 0px */
      #mma-query-view .yasr .dataTables_scrollHead {
        display: none;
      }
      #mma-query-view .yasr .dataTables_scroll,
      #mma-query-view .yasr .dataTables_scrollBody {
        overflow: visible;
        max-height: none;
        height: auto;
      }
      /* If DataTables left the body thead with visibility:hidden,
         neutralise the space it eats. Our sticky thead rule
         (position:sticky on thead/th) brings it back visible. */
      #mma-query-view .yasr .dataTables_scrollBody table thead,
      #mma-query-view .yasr .dataTables_scrollBody table thead tr,
      #mma-query-view .yasr .dataTables_scrollBody table thead th {
        visibility: visible !important;
        line-height: 1.3;
      }
      #mma-query-view .yasr .dataTables_info {
        color: var(--mma-q-text-muted);
        font-family: 'IBM Plex Sans', system-ui, sans-serif;
        font-size: 11.5px;
        padding: 6px 14px;
      }
      #mma-query-view .yasr .dataTables_paginate .paginate_button {
        color: var(--mma-q-text-muted) !important;
        background: transparent !important;
        border: 1px solid var(--mma-q-border) !important;
        border-radius: 4px !important;
        padding: 4px 10px !important;
        margin: 0 2px !important;
      }
      #mma-query-view .yasr .dataTables_paginate .paginate_button.current,
      #mma-query-view .yasr .dataTables_paginate .paginate_button.current:hover {
        color: var(--mma-q-accent-ink) !important;
        background: var(--mma-q-accent) !important;
        border-color: var(--mma-q-accent) !important;
      }
      #mma-query-view .yasr .dataTables_paginate .paginate_button.disabled {
        opacity: 0.4;
      }

      /* YASR plugin tab strip (Table / Raw / Pivot / Chart) —
         compact: no padding below the buttons, divider goes right
         against the table thead. */
      #mma-query-view .yasr .yasr_btnGroup,
      #mma-query-view .yasr .yasr_header {
        background: transparent;
        border-bottom: 1px solid var(--mma-q-border-soft);
        padding: 4px 10px 0;
        margin: 0;
      }
      #mma-query-view .yasr .yasr_btnGroup .yasr_btn,
      #mma-query-view .yasr .yasr_btn {
        background: transparent;
        color: var(--mma-q-text-muted);
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 4px 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 11.5px;
      }
      #mma-query-view .yasr .yasr_btn:hover {
        color: var(--mma-q-text-primary);
        border-color: var(--mma-q-border);
      }
      #mma-query-view .yasr .yasr_btn.selected,
      #mma-query-view .yasr .yasr_btn.btn_active,
      #mma-query-view .yasr .yasr_btn.active {
        color: var(--mma-q-accent);
        border-color: var(--mma-q-accent-ring);
        background: var(--mma-q-accent-bg);
      }
    `;
    document.head.appendChild(style);
  }

  /** Stamp the given IRI onto every visual surface in `meta`. SVG and
   *  HTML elements both use the same `data-annotation-iri` attribute so
   *  `_purgeAnnotationVisuals` can query for them uniformly. */
  _stampIriOnMeta(meta, iri) {
    if (!meta || !iri) return;
    const setIri = (el) => {
      if (!el) return;
      // HTMLElement supports `dataset`; SVGElement doesn't until
      // SVG2 / fairly recent browsers — `setAttribute` is universal.
      el.setAttribute('data-annotation-iri', iri);
    };
    setIri(meta.element);
    setIri(meta.textElement);
    setIri(meta.imageRect);
    if (meta.connection) meta.connection.annotationIri = iri;
  }

  /** Atomic cleanup: every DOM element tagged with `iri` (in any panel's
   *  shadow root), every entry in `this.connections` carrying that IRI,
   *  and every panel-local bookkeeping slot referencing those DOM nodes
   *  is dropped. Implements the Phase 1 atomic-linking-deletion rule:
   *  deleting any visual of a linking annotation tears down the whole
   *  annotation. Idempotent: callable from any delete surface (text-
   *  panel popup, image-panel sidebar, connection menu) — whoever fires
   *  `store.remove(iri)` triggers `annotation:removed`, which lands
   *  here exactly once per IRI. */
  _purgeAnnotationVisuals(iri) {
    if (!iri) return;
    let escaped;
    try { escaped = CSS.escape(iri); } catch (_) { escaped = iri; }
    const selector = `[data-annotation-iri="${escaped}"]`;

    const textPanels = this.shadowRoot.querySelectorAll('iiif-text-panel');
    for (const tp of textPanels) {
      if (!tp.shadowRoot) continue;
      const matches = Array.from(tp.shadowRoot.querySelectorAll(selector));
      for (const el of matches) {
        // Text marks should unwrap (replace with text) so the prose flows
        // naturally; everything else gets removed outright.
        if (el.tagName === 'MARK' && el.parentNode) {
          const tn = document.createTextNode(el.textContent);
          el.parentNode.replaceChild(tn, el);
          el.parentNode.normalize?.();
        } else if (el.parentNode) {
          el.remove();
        }
        if (Array.isArray(tp.confirmedElements)) {
          const i = tp.confirmedElements.findIndex((c) => c.element === el);
          if (i >= 0) tp.confirmedElements.splice(i, 1);
        }
      }
    }

    const imagePanels = this.shadowRoot.querySelectorAll('iiif-image-panel');
    for (const ip of imagePanels) {
      if (!ip.shadowRoot) continue;
      const matches = Array.from(ip.shadowRoot.querySelectorAll(selector));
      for (const el of matches) {
        if (el.parentNode) el.remove();
        if (Array.isArray(ip.confirmedRects)) {
          const i = ip.confirmedRects.findIndex((c) => c.element === el);
          if (i >= 0) ip.confirmedRects.splice(i, 1);
        }
      }
    }

    // Connections (path + label live in the orchestrator's overlay SVG).
    for (let i = this.connections.length - 1; i >= 0; i--) {
      const c = this.connections[i];
      if (c.annotationIri === iri) {
        if (c.path) c.path.remove();
        if (c.label) c.label.remove();
        this.connections.splice(i, 1);
      }
    }

    // Unlinked-elements tracking (held by the orchestrator while the
    // user is choosing how to use a selection). Drop any reference to
    // an element with this IRI.
    this.unlinkedTextElements = this.unlinkedTextElements.filter(
      (item) => item.element?.getAttribute?.('data-annotation-iri') !== iri
    );
    this.unlinkedImageRects = this.unlinkedImageRects.filter(
      (item) => item.element?.getAttribute?.('data-annotation-iri') !== iri
    );
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        /* Design system v3 (Phase 1).
         * Teal accent, day/night dual theme, three typefaces:
         *   JetBrains Mono — app title, profile badge, export labels
         *   IBM Plex Sans  — generic UI chrome
         *   Spectral       — transcription body ONLY (no other serif use)
         * Theme switch lives on the host's data-theme attribute; the
         * default is dark, light overrides follow below. */
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Spectral:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

        :host {
          /* ── Typography vars (used by every rule below) ── */
          --mma-font-mono:  'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          --mma-font-sans:  'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          --mma-font-serif: Spectral, Georgia, "Times New Roman", serif;

          /* ── DARK palette (v4 — informatico/terminal) ── */
          --mma-bg-base:      #0a0e1a;
          --mma-bg-elevated:  #0d1320;
          --mma-bg-sunken:    #060912;
          --mma-surface-soft: rgba(255,255,255,0.04);
          --mma-surface-hover:rgba(255,255,255,0.07);
          --mma-border:       rgba(255,255,255,0.06);
          --mma-border-soft:  rgba(255,255,255,0.04);
          --mma-divider:      rgba(0,212,255,0.25);
          --mma-text-primary: #e6f4ff;
          --mma-text-body:    #c4d4e8;
          --mma-text-muted:   #a0aec0;
          --mma-text-label:   #8a9cb8;
          --mma-text-faint:   #6b7a96;
          --mma-accent:       #00d4ff;
          --mma-accent-ink:   #001824;
          --mma-accent-bg:    rgba(0,212,255,0.08);
          --mma-accent-border:rgba(0,212,255,0.4);
          --mma-magenta:      #ff00b4;
          --mma-magenta-bg:   rgba(255,0,180,0.08);
          --mma-row-hover:    rgba(0,212,255,0.04);
          --mma-backdrop:     rgba(0,0,0,0.6);

          /* Modality tokens — v4 cyan/magenta/orange */
          --mma-mod-denotation:   #00d4ff;
          --mma-mod-dynamization: #ff00b4;
          --mma-mod-integration:  #ff8c00;

          /* Back-compat aliases (legacy names still used across this
             file and child components — keep them pointing at the new
             tokens so every existing rule resolves without rewrites). */
          --mma-accent-soft:  var(--mma-accent-bg);
          --mma-accent-ring:  var(--mma-accent-border);
          --mma-modality-denotation:   var(--mma-mod-denotation);
          --mma-modality-dynamization: var(--mma-mod-dynamization);
          --mma-modality-integration:  var(--mma-mod-integration);
          --mma-panel-text:      var(--mma-mod-denotation);
          --mma-panel-facsimile: var(--mma-mod-dynamization);
          --mma-panel-image:     var(--mma-mod-integration);

          --color-black:    var(--mma-bg-elevated);
          --color-white:    var(--mma-text-primary);
          --color-gray-100: var(--mma-surface-soft);
          --color-gray-200: var(--mma-border);
          --color-gray-300: var(--mma-border-soft);
          --color-gray-700: var(--mma-text-muted);
          --color-accent:   var(--mma-accent);
          --spacing-unit:   8px;

          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100vh;
          font-family: var(--mma-font-sans);
          background: var(--mma-bg-base);
          color: var(--mma-text-primary);
        }

        /* ── LIGHT palette ── re-points every token; the rules below
           don't need to know which theme is active. */
        :host([data-theme="light"]) {
          --mma-bg-base:      #f4f6fb;
          --mma-bg-elevated:  #ffffff;
          --mma-bg-sunken:    #e8ecf3;
          --mma-surface-soft: rgba(0,0,0,0.04);
          --mma-surface-hover:rgba(0,0,0,0.06);
          --mma-border:       rgba(0,0,0,0.06);
          --mma-border-soft:  rgba(0,0,0,0.04);
          --mma-divider:      rgba(0,0,0,0.2);
          --mma-text-primary: #0a1628;
          --mma-text-body:    #1a2638;
          --mma-text-muted:   #3a4458;
          --mma-text-label:   #4a5870;
          --mma-text-faint:   #5e6b85;
          --mma-accent:       #0085a8;
          --mma-accent-ink:   #ffffff;
          --mma-accent-bg:    rgba(0,133,168,0.06);
          --mma-accent-border:rgba(0,133,168,0.4);
          --mma-magenta:      #c4008c;
          --mma-magenta-bg:   rgba(196,0,140,0.06);
          --mma-row-hover:    rgba(0,0,0,0.03);
          --mma-backdrop:     rgba(0,0,0,0.3);

          --mma-mod-denotation:   #0085a8;
          --mma-mod-dynamization: #c4008c;
          --mma-mod-integration:  #cc6600;
        }

        .app-header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 52px;
          background: var(--mma-bg-elevated);
          color: var(--mma-text-primary);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          z-index: 10000;
          border-bottom: 1px solid var(--mma-border);
        }

        .app-title-group {
          display: flex;
          align-items: baseline;
          gap: 12px;
          line-height: 1.1;
          min-width: 0;
        }

        .app-title {
          font-family: var(--mma-font-mono);
          font-size: 16px;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: var(--mma-text-primary);
          white-space: nowrap;
        }

        .app-title-divider {
          display: inline-block;
          width: 1px;
          height: 14px;
          background: var(--mma-divider);
          align-self: center;
          flex-shrink: 0;
        }

        .app-subtitle {
          font-family: var(--mma-font-sans);
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 0.02em;
          color: var(--mma-text-faint);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .app-header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .profile-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          font-family: var(--mma-font-mono);
          font-size: 11px;
          font-weight: 500;
          color: var(--mma-accent);
          background: transparent;
          border: 0.5px solid var(--mma-accent-border);
          border-radius: 4px;
          letter-spacing: 0.04em;
        }
        .profile-badge svg { flex-shrink: 0; }

        .app-icon-btn {
          width: 30px;
          height: 30px;
          border: 1px solid var(--mma-border);
          border-radius: 6px;
          background: transparent;
          color: var(--mma-text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .app-icon-btn:hover {
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
          border-color: var(--mma-divider);
        }

        .app-icon-btn svg {
          width: 15px;
          height: 15px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.6;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .app-info-btn { /* legacy hook for click wiring */ }

        /* ── Tab strip (T2.5) — sits below header, above content.
           Switches between Annotate (the existing 3-panel view) and
           Query & Analytics (light-DOM YASGUI view). State of either
           view is preserved when switching: we toggle visibility, never
           unmount the panels. */
        .tab-strip {
          position: fixed;
          top: 52px;
          left: 0;
          right: 0;
          height: 40px;
          background: var(--mma-bg-elevated);
          border-bottom: 1px solid var(--mma-border);
          display: flex;
          align-items: center;
          padding: 0 20px;
          gap: 28px;
          z-index: 9999;
        }

        .tab {
          display: inline-flex;
          align-items: center;
          height: 100%;
          padding: 0 2px;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          font-family: var(--mma-font-sans);
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--mma-text-faint);
          cursor: pointer;
          /* Kill the browser's default blue focus ring — it sat just
             above the active tab's accent underline and looked like a
             second, contrasting line (Query view bug B1). Keyboard
             users still get a visible focus state via :focus-visible. */
          outline: none;
          -webkit-tap-highlight-color: transparent;
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .tab:focus { outline: none; }
        .tab:focus-visible {
          outline: 1px solid var(--mma-accent-border);
          outline-offset: -3px;
        }
        .tab:hover { color: var(--mma-text-muted); }
        .tab.active {
          color: var(--mma-text-primary);
          border-bottom-color: var(--mma-accent);
        }

        .main-wrapper {
          display: flex;
          width: 100%;
          height: calc(100vh - 92px);
          margin-top: 92px;
        }

        .main-wrapper.tab-query-active,
        .main-wrapper.tab-datamodel-active,
        .main-wrapper.tab-viz-active {
          /* For Query / Data Model / Visualization we hide the
             annotate panels so the alternate view can span the full
             content width. Wrapper still occupies its slot so the
             footer stays aligned, but its content is empty. */
          visibility: hidden;
          pointer-events: none;
        }

        /* ─── Data Model view ─────────────────────────────────────
           Lives in shadow DOM (no light-DOM hack needed, this view
           is pure local components). Positioned fixed under the tab
           strip, above the footer toolbar, matches Query view
           geometry. */
        .data-model-view {
          position: fixed;
          top: 92px;
          left: 0;
          right: 0;
          bottom: 48px;
          display: flex;
          flex-direction: column;
          background: var(--mma-bg-base);
          color: var(--mma-text-primary);
          z-index: 500;
          overflow-y: auto;
          padding: 28px 48px 48px;
        }
        .data-model-view[hidden] { display: none; }
        .data-model-view .dm-header {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 28px;
        }
        .data-model-view .dm-title {
          font-family: var(--mma-font-serif);
          font-size: 22px;
          font-weight: 500;
          color: var(--mma-text-primary);
        }
        .data-model-view .dm-subtitle {
          font-size: 12.5px;
          color: var(--mma-text-muted);
          line-height: 1.55;
          max-width: 640px;
        }
        .data-model-view .dm-section {
          margin-bottom: 32px;
          border: 1px solid var(--mma-border-soft);
          border-radius: 10px;
          background: var(--mma-bg-elevated);
          padding: 22px 24px 18px;
        }
        .data-model-view .dm-section-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 4px;
        }
        .data-model-view .dm-section-title {
          font-family: var(--mma-font-serif);
          font-size: 15px;
          font-weight: 500;
          color: var(--mma-text-primary);
        }
        .data-model-view .dm-add-btn {
          height: 28px;
          padding: 0 12px;
          background: transparent;
          color: var(--mma-accent);
          border: 1px solid var(--mma-accent-border);
          border-radius: 999px;
          cursor: pointer;
          font-family: var(--mma-font-sans);
          font-size: 11.5px;
          font-weight: 500;
          letter-spacing: 0.02em;
          transition: background 0.15s ease;
        }
        .data-model-view .dm-add-btn:hover {
          background: var(--mma-accent-bg);
        }
        .data-model-view .dm-section-sub {
          font-size: 11.5px;
          color: var(--mma-text-faint);
          line-height: 1.5;
          margin-bottom: 16px;
        }
        .data-model-view .dm-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .data-model-view .dm-item {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 9px 4px;
          border-top: 1px solid var(--mma-border-soft);
        }
        .data-model-view .dm-item:first-child { border-top: none; }
        .data-model-view .dm-item-label {
          font-family: var(--mma-font-sans);
          font-size: 13px;
          font-weight: 500;
          color: var(--mma-text-primary);
          min-width: 240px;
        }
        .data-model-view .dm-item-iri {
          font-family: var(--mma-font-mono);
          font-size: 11.5px;
          color: var(--mma-text-muted);
          flex: 1;
          word-break: break-all;
        }
        .data-model-view .dm-item-tag {
          font-family: var(--mma-font-mono);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--mma-text-faint);
          padding: 2px 8px;
          border: 1px solid var(--mma-border);
          border-radius: 999px;
        }
        .data-model-view .dm-item-remove {
          width: 24px;
          height: 24px;
          border: 1px solid var(--mma-border);
          border-radius: 6px;
          background: transparent;
          color: var(--mma-text-faint);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .data-model-view .dm-item-remove:hover {
          color: #d77a72;
          border-color: rgba(215, 122, 114, 0.45);
        }
        .data-model-view .dm-item-remove svg {
          width: 12px;
          height: 12px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.6;
        }

        .sidebar {
          position: fixed;
          left: 0;
          top: 92px;
          width: 48px;
          height: calc(100vh - 92px);
          background: var(--mma-bg-elevated);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 12px 0;
          gap: 8px;
          border-right: 1px solid var(--mma-border);
          z-index: 1000;
        }

        .sidebar-btn {
          width: 30px;
          height: 30px;
          border: 1px solid var(--mma-border);
          border-radius: 8px;
          background: transparent;
          color: var(--mma-text-muted);
          font-size: 16px;
          font-weight: 300;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .sidebar-btn:hover {
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
          border-color: var(--mma-surface-hover);
        }

        .sidebar-btn.add {
          margin-bottom: calc(var(--spacing-unit) * 2);
        }

        .panel-list {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing-unit) * 1);
          width: 100%;
          align-items: center;
          flex: 1;
          overflow-y: auto;
          padding: 0;
        }

        .panel-list::-webkit-scrollbar {
          width: 1px;
        }

        .panel-list::-webkit-scrollbar-thumb {
          background: var(--color-gray-700);
        }

        .panel-item {
          width: 30px;
          height: 30px;
          border: 1px solid var(--mma-border);
          border-radius: 8px;
          background: transparent;
          color: var(--mma-text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 400;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
          position: relative;
        }

        .panel-item svg {
          width: 14px;
          height: 14px;
          stroke: var(--mma-text-muted);
        }

        .panel-item:hover {
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
          border-color: var(--mma-surface-hover);
        }

        .panel-item:hover svg { stroke: var(--mma-text-primary); }

        .panel-item.active {
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
          border-color: var(--mma-accent-ring);
        }

        .panel-item.active svg { stroke: var(--mma-accent); }

        .panel-item .remove-btn {
          position: absolute;
          top: -5px;
          right: -5px;
          width: 14px;
          height: 14px;
          border: 1px solid var(--mma-border);
          border-radius: 50%;
          background: var(--mma-bg-elevated);
          color: var(--mma-text-faint);
          font-size: 10px;
          display: none;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          line-height: 1;
        }
        .panel-item:hover .remove-btn { display: flex; }
        .panel-item .remove-btn:hover { color: var(--mma-text-primary); background: var(--mma-surface-hover); }

        .container {
          display: flex;
          width: calc(100% - 48px);
          height: 100%;
          gap: 0;
          padding: 0;
          position: relative;
          margin-left: 48px;
        }

        .panels-area {
          display: flex;
          gap: 1px;
          flex: 1;
          padding-bottom: 46px;
          background: var(--mma-border);
        }

        .panel {
          flex: 1;
          background: var(--mma-bg-base);
          border-radius: 0;
          box-shadow: none;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-width: 320px;
          max-height: 100%;
          position: relative;
          z-index: 1;
        }

        .panel-header {
          padding: 14px 18px 10px;
          border-bottom: 1px solid var(--mma-border-soft);
          background: var(--mma-bg-base);
          color: var(--mma-text-primary);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          cursor: grab;
          user-select: none;
        }

        .panel-header:active { cursor: grabbing; }
        .panel-header:hover  { background: var(--mma-bg-base); }

        .panel-header .panel-title {
          flex: 1;
          pointer-events: none;
          display: flex;
          align-items: center;
          gap: 9px;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--mma-text-label);
        }

        .panel-header .panel-title::before {
          content: '';
          display: inline-block;
          width: 5px;
          height: 14px;
          border-radius: 1px;
          background: var(--mma-text-faint); /* default for unknown panel types */
        }

        .panel-header .panel-title.panel-type-text::before      { background: var(--mma-panel-text); }
        .panel-header .panel-title.panel-type-facsimile::before { background: var(--mma-panel-facsimile); }
        .panel-header .panel-title.panel-type-image::before     { background: var(--mma-panel-image); }

        /* Old SVG icon inside the title is hidden in v2 — the coloured
           bar is the only signature. We still render the SVG for
           accessibility / fallback but it doesn't take visual space. */
        .panel-header .panel-title svg { display: none; }

        .panel-header .close-panel {
          width: 22px;
          height: 22px;
          border: none;
          background: transparent;
          color: var(--mma-text-faint);
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 5px;
          pointer-events: auto;
          transition: background 0.12s ease, color 0.12s ease;
        }

        .panel-header .close-panel:hover {
          background: var(--mma-surface-hover);
          color: var(--mma-text-primary);
        }

        .panel.dragging {
          opacity: 0.4;
        }

        .panel.drag-over {
          border-left: 2px solid var(--color-black);
        }

        .panel-content {
          flex: 1;
          overflow: auto;
        }

        .toolbar {
          position: fixed;
          bottom: 0;
          left: 48px;
          right: 0;
          background: var(--mma-bg-elevated);
          padding: 9px 16px;
          border-top: 1px solid var(--mma-border);
          display: flex;
          gap: 8px;
          align-items: center;
          z-index: 999;
        }

        /* Pill-shaped export buttons with labels — distinguishable at a
           glance from the icon-only utility buttons elsewhere in the UI.
           Labels in JetBrains Mono per the v3 typography spec
           (technical metadata = mono). */
        .toolbar button {
          height: 30px;
          padding: 0 14px;
          border: 1px solid var(--mma-border);
          border-radius: 999px;
          background: var(--mma-surface-soft);
          color: var(--mma-text-muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: var(--mma-font-mono);
          font-size: 11.5px;
          font-weight: 500;
          letter-spacing: 0.01em;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, filter 0.15s ease;
        }

        .toolbar button svg {
          width: 14px;
          height: 14px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.7;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .toolbar button:hover {
          background: var(--mma-surface-hover);
          color: var(--mma-text-primary);
          border-color: var(--mma-surface-hover);
        }

        /* Primary export — accent fill, contrast ink. The GEKO export is
           the canonical poster artefact; the flat export sits next to it.
           Hover via brightness filter so the rule works in both themes. */
        .toolbar button#export-btn {
          background: var(--mma-accent);
          color: var(--mma-accent-ink);
          border-color: var(--mma-accent);
        }
        .toolbar button#export-btn:hover {
          background: var(--mma-accent);
          color: var(--mma-accent-ink);
          border-color: var(--mma-accent);
          filter: brightness(1.08);
        }

        .toolbar button:disabled {
          background: var(--mma-surface-soft);
          cursor: not-allowed;
          opacity: 0.45;
        }

        .status {
          color: var(--mma-text-muted);
          font-size: 11.5px;
          margin-left: auto;
        }

        .copyright {
          color: var(--mma-text-faint);
          font-size: 0.7rem;
          margin-left: calc(var(--spacing-unit) * 2);
        }

        #connection-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 10000;
          overflow: visible;
        }

        #connection-overlay * {
          pointer-events: all;
        }

        .container {
          position: relative;
        }

        .connection-line {
          fill: none;
          stroke-width: 2;
          opacity: 1;
          filter: none;
          will-change: d;
          cursor: pointer;
          pointer-events: all;
          transition: stroke-width 0.1s ease;
        }

        .connection-line:hover {
          stroke-width: 4;
          opacity: 0.8;
        }

        .connection-line.denotation   { stroke: var(--mma-mod-denotation); }
        .connection-line.dynamisation { stroke: var(--mma-mod-dynamization); }
        .connection-line.integration  { stroke: var(--mma-mod-integration); }
        .connection-line.transcription {
          stroke: var(--mma-mod-dynamization);
          stroke-dasharray: 4,4;
        }
        /* Drag-time preview connection — follows the active accent. */
        .connection-line.dragging { stroke: var(--mma-accent); }

        /* Invisible wider stroke for easier clicking */
        .connection-hit-area {
          fill: none;
          stroke: transparent;
          stroke-width: 20;
          cursor: pointer;
          pointer-events: all;
        }

        .connection-label {
          fill: var(--color-black);
          font-size: 10px;
          font-weight: 400;
          text-anchor: middle;
          pointer-events: none;
          paint-order: stroke;
          stroke: var(--color-white);
          stroke-width: 2px;
          will-change: transform;
        }

        /* Connection indicators for off-screen connections */
        .connection-indicator {
          cursor: pointer;
          pointer-events: all;
          transition: all 0.2s ease;
          stroke: transparent;
          stroke-width: 8;
        }

        .connection-indicator:hover {
          filter: brightness(1.3);
          opacity: 0.9;
        }

        .connection-indicator.denotation    { fill: var(--mma-modality-denotation); }
        .connection-indicator.dynamisation  { fill: var(--mma-modality-dynamization); }
        .connection-indicator.integration   { fill: var(--mma-modality-integration); }
        .connection-indicator.transcription { fill: var(--mma-modality-dynamization); }

        /* Larger invisible hit area for indicators */
        .connection-indicator-hitarea {
          fill: transparent;
          pointer-events: none;
        }

        .indicator-count {
          fill: var(--color-white);
          font-size: 10px;
          font-weight: 600;
          text-anchor: middle;
          dominant-baseline: central;
          pointer-events: none;
        }

        /* Radial menu for multiple connections */
        .radial-menu {
          pointer-events: all;
        }

        .radial-menu-line {
          stroke: var(--color-gray-700);
          stroke-width: 1;
          stroke-dasharray: 2,2;
          pointer-events: none;
        }

        .radial-menu-item {
          fill: var(--color-white);
          stroke-width: 2;
          transition: all 0.2s ease;
          pointer-events: all;
        }

        .radial-menu-item.denotation    { stroke: var(--mma-modality-denotation); }
        .radial-menu-item.dynamisation  { stroke: var(--mma-modality-dynamization); }
        .radial-menu-item.integration   { stroke: var(--mma-modality-integration); }
        .radial-menu-item.transcription { stroke: var(--mma-modality-dynamization); }

        .radial-menu-item:hover {
          transform: scale(1.3);
        }
        .radial-menu-item.denotation:hover    { fill: var(--mma-modality-denotation); }
        .radial-menu-item.dynamisation:hover  { fill: var(--mma-modality-dynamization); }
        .radial-menu-item.integration:hover   { fill: var(--mma-modality-integration); }
        .radial-menu-item.transcription:hover { fill: var(--mma-modality-dynamization);
        }

        .radial-menu-label {
          fill: var(--color-black);
          font-size: 11px;
          font-weight: 500;
          text-anchor: middle;
          dominant-baseline: central;
          pointer-events: all;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
        }

        .radial-menu-label-bg {
          fill: var(--color-white);
          stroke: var(--color-black);
          stroke-width: 1;
          opacity: 0.95;
          pointer-events: none;
        }

        /* ── Modal pattern (v2 uniform) ─────────────────────────────
           All modals share a container, header (Spectral title + X
           close), body (padding 14-18). Open/close via .active class.
           Backdrop click + Esc are wired in setupEventListeners. */
        .mma-modal {
          background: var(--mma-bg-elevated);
          border: 1px solid var(--mma-border);
          border-radius: 12px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.45);
          color: var(--mma-text-primary);
          font-family: var(--mma-font-sans);
          min-width: 340px;
          max-width: 420px;
          z-index: 10001;
        }
        .mma-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px 12px;
          border-bottom: 1px solid var(--mma-border-soft);
        }
        .mma-modal-title {
          font-family: var(--mma-font-sans);
          font-size: 15px;
          font-weight: 500;
          color: var(--mma-text-primary);
        }
        .mma-modal-close {
          width: 26px;
          height: 26px;
          border: 1px solid var(--mma-border);
          border-radius: 50%;
          background: transparent;
          color: var(--mma-text-faint);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .mma-modal-close:hover {
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
        }
        .mma-modal-close svg {
          width: 12px;
          height: 12px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.8;
          stroke-linecap: round;
        }
        .mma-modal-body {
          padding: 16px;
        }

        .modality-selector {
          position: fixed;
          z-index: 10001;
          display: none;
          background: var(--mma-bg-elevated);
          border: 1px solid var(--mma-border);
          border-radius: 12px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.45);
          min-width: 280px;
          overflow: hidden;
        }

        .modality-selector.active { display: block; }

        /* ─── Anchor modal (MLAO) ─── */
        .anchor-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 10001;
          min-width: 460px;
          max-width: 520px;
          background: var(--mma-bg-elevated);
          border: 1px solid var(--mma-border);
          border-radius: 12px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.45);
          color: var(--mma-text-primary);
          font-family: var(--mma-font-sans);
        }
        .anchor-modal[hidden] { display: none; }
        .anchor-modal .mma-modal-header {
          gap: 12px;
        }
        .anchor-skip-link {
          margin-left: auto;
          margin-right: 6px;
          background: transparent;
          border: none;
          color: var(--mma-text-muted);
          font-family: var(--mma-font-sans);
          font-size: 12px;
          cursor: pointer;
          text-decoration: underline;
          padding: 4px 6px;
          letter-spacing: 0.01em;
        }
        .anchor-skip-link:hover { color: var(--mma-text-primary); }
        .anchor-modal-body {
          padding: 16px 18px 8px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .anchor-modal-subtitle {
          font-size: 12px;
          line-height: 1.5;
          color: var(--mma-text-muted);
          margin: 0 0 4px;
        }
        .anchor-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .anchor-field-label {
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--mma-text-label);
        }
        .anchor-field-input {
          height: 34px;
          padding: 0 10px;
          font-family: var(--mma-font-mono);
          font-size: 12.5px;
          color: var(--mma-text-body);
          background: var(--mma-bg-base);
          border: 1px solid var(--mma-border);
          border-radius: 6px;
        }
        select.anchor-field-input { padding: 0 28px 0 10px; }
        .anchor-field-input:focus {
          outline: none;
          border-color: var(--mma-accent-border);
        }
        .anchor-field-hint {
          font-size: 10.5px;
          color: var(--mma-text-faint);
          font-style: italic;
        }
        .mma-modal-footer {
          padding: 12px 18px 16px;
          border-top: 1px solid var(--mma-border-soft);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .anchor-create-btn {
          height: 32px;
          padding: 0 18px;
          background: var(--mma-accent);
          color: var(--mma-accent-ink);
          border: 1px solid var(--mma-accent);
          border-radius: 999px;
          font-family: var(--mma-font-sans);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: filter 0.15s ease;
        }
        .anchor-create-btn:hover { filter: brightness(1.08); }
        .anchor-create-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          filter: none;
        }

        /* ── Wikidata search autocomplete + chip ── */
        .anchor-search-wrap {
          position: relative;
        }
        .anchor-search-results {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          z-index: 10002;
          margin: 0;
          padding: 4px 0;
          list-style: none;
          background: var(--mma-bg-elevated);
          border: 1px solid var(--mma-border);
          border-radius: 6px;
          box-shadow: 0 12px 32px rgba(0,0,0,0.35);
          max-height: 280px;
          overflow-y: auto;
        }
        .anchor-search-results[hidden] { display: none; }
        .anchor-search-result {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 12px;
          cursor: pointer;
          border-bottom: 1px solid var(--mma-border-soft);
        }
        .anchor-search-result:last-child { border-bottom: none; }
        .anchor-search-result:hover,
        .anchor-search-result.active {
          background: var(--mma-surface-soft);
        }
        .anchor-search-result .label {
          font-size: 13px;
          color: var(--mma-text-primary);
          font-weight: 500;
        }
        .anchor-search-result .description {
          font-size: 11px;
          color: var(--mma-text-faint);
        }
        .anchor-search-result .iri {
          font-family: var(--mma-font-mono);
          font-size: 10.5px;
          color: var(--mma-text-muted);
        }
        .anchor-search-result.create-custom {
          background: var(--mma-accent-bg);
        }
        .anchor-search-result.create-custom:hover {
          background: color-mix(in srgb, var(--mma-accent) 28%, transparent);
        }
        .anchor-search-result.create-custom .label {
          color: var(--mma-accent);
        }
        .anchor-search-empty,
        .anchor-search-loading {
          padding: 10px 12px;
          color: var(--mma-text-faint);
          font-size: 12px;
          font-style: italic;
        }

        .anchor-entity-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px 6px 12px;
          border: 1px solid var(--mma-accent-border);
          border-radius: 999px;
          background: var(--mma-accent-bg);
          color: var(--mma-text-primary);
          font-family: var(--mma-font-sans);
          font-size: 12px;
          max-width: 100%;
        }
        .anchor-entity-chip[hidden] { display: none; }
        .anchor-chip-label {
          font-weight: 500;
        }
        .anchor-chip-iri {
          font-family: var(--mma-font-mono);
          font-size: 10.5px;
          color: var(--mma-text-muted);
          opacity: 0.85;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 260px;
        }
        .anchor-chip-clear {
          width: 18px;
          height: 18px;
          border: none;
          background: transparent;
          color: var(--mma-text-faint);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border-radius: 50%;
        }
        .anchor-chip-clear:hover {
          color: var(--mma-accent);
          background: var(--mma-surface-soft);
        }

        .modality-buttons {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* Modality options as rows with a coloured dot + sans label */
        .modality-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 16px;
          border: none;
          border-top: 1px solid var(--mma-border-soft);
          border-radius: 0;
          background: transparent;
          color: var(--mma-text-primary);
          cursor: pointer;
          text-align: left;
          font-family: var(--mma-font-sans);
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0;
          transition: background 0.12s ease;
        }
        .modality-btn:first-child { border-top: none; }

        .modality-btn::before {
          content: '';
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--mma-text-faint);
        }

        .modality-btn small {
          display: block;
          font-size: 10.5px;
          font-weight: 400;
          color: var(--mma-text-faint);
          margin-top: 1px;
        }

        .modality-btn strong {
          display: block;
          font-weight: 500;
        }

        .modality-btn:hover { background: var(--mma-surface-soft); }

        .modality-btn.denotation::before    { background: var(--mma-modality-denotation); }
        .modality-btn.dynamisation::before  { background: var(--mma-modality-dynamization); }
        .modality-btn.integration::before   { background: var(--mma-modality-integration); }

        .add-panel-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: var(--mma-bg-elevated);
          border: 1px solid var(--mma-border);
          border-radius: 12px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.45);
          padding: 0;
          z-index: 10001;
          display: none;
          min-width: 360px;
          max-width: 420px;
          overflow: hidden;
        }

        .add-panel-modal.active { display: block; }

        .add-panel-modal h3 { display: none; } /* replaced by .mma-modal-header */

        .panel-type-buttons {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing-unit) * 1);
        }

        .panel-type-btn {
          padding: 14px 16px;
          border: 1px solid var(--mma-border);
          border-radius: 10px;
          background: var(--mma-bg-base);
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 14px;
          color: var(--mma-text-primary);
        }

        .panel-type-btn .icon { display: none; } /* removed in v2 — coloured signature lives on the panel-header bar instead */
        .panel-type-btn .label { flex: 1; }

        .panel-type-btn:hover {
          border-color: var(--mma-accent-ring);
          background: var(--mma-surface-soft);
        }

        .panel-type-btn strong {
          display: block;
          color: var(--mma-text-primary);
          font-family: 'Spectral', Georgia, serif;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 2px;
        }

        .panel-type-btn small {
          color: var(--mma-text-faint);
          font-size: 11.5px;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: var(--mma-backdrop);
          z-index: 10000;
          display: none;
        }

        .modal-overlay.active { display: block; }

        .connection-menu {
          position: fixed;
          background: var(--mma-bg-elevated);
          border: 1px solid var(--mma-border);
          border-radius: 10px;
          padding: 0;
          box-shadow: 0 18px 48px rgba(0,0,0,0.45);
          z-index: 10001;
          display: none;
          min-width: 180px;
          overflow: hidden;
        }

        .connection-menu.active { display: block; }

        .connection-menu-item {
          padding: 10px 14px;
          border: none;
          background: transparent;
          width: 100%;
          text-align: left;
          cursor: pointer;
          color: var(--mma-text-primary);
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          font-size: 12.5px;
          transition: background 0.12s ease;
          border-top: 1px solid var(--mma-border-soft);
        }

        .connection-menu-item:first-child { border-top: none; }
        .connection-menu-item:hover { background: var(--mma-surface-soft); }

        .connection-menu-item.danger { color: #d77a72; }
        .connection-menu-item.danger:hover { background: rgba(215, 122, 114, 0.10); }

        .about-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: var(--mma-bg-elevated);
          border: 1px solid var(--mma-border);
          border-radius: 12px;
          padding: 22px 26px 26px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.45);
          z-index: 10002;
          display: none;
          max-width: 600px;
          max-height: 80vh;
          overflow-y: auto;
          color: var(--mma-text-primary);
        }

        .about-modal.active { display: block; }

        .about-modal h2 {
          margin: 0 0 12px 0;
          font-family: var(--mma-font-mono);
          font-size: 18px;
          font-weight: 500;
          letter-spacing: -0.01em;
          text-transform: none;
          color: var(--mma-text-primary);
        }

        .about-modal h3 {
          margin: 22px 0 8px 0;
          font-family: var(--mma-font-sans);
          font-size: 12px;
          font-weight: 500;
          color: var(--mma-text-label);
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .about-modal p,
        .about-modal li {
          color: var(--mma-text-body);
          font-size: 13px;
          line-height: 1.55;
        }

        .about-modal p {
          margin: 0 0 calc(var(--spacing-unit) * 2) 0;
          line-height: 1.6;
          color: var(--color-gray-700);
        }

        .about-modal ul {
          margin: 0 0 calc(var(--spacing-unit) * 2) 0;
          padding-left: calc(var(--spacing-unit) * 3);
          color: var(--color-gray-700);
        }

        .about-modal li {
          margin-bottom: calc(var(--spacing-unit) * 0.5);
        }

        .about-modal .close-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 26px;
          height: 26px;
          border: 1px solid var(--mma-border);
          background: transparent;
          color: var(--mma-text-faint);
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: background 0.15s ease, color 0.15s ease;
          line-height: 1;
        }

        .about-modal .close-btn:hover {
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
        }

        .color-legend {
          display: flex;
          gap: 18px;
          flex-wrap: wrap;
          margin: 14px 0;
        }

        .color-item {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--mma-text-body);
          font-size: 12.5px;
        }

        .color-box {
          width: 22px;
          height: 10px;
          border-radius: 2px;
        }

        .color-box.denotation    { background: var(--mma-modality-denotation); }
        .color-box.dynamisation  { background: var(--mma-modality-dynamization); }
        .color-box.integration   { background: var(--mma-modality-integration); }
        .color-box.transcription { background: var(--mma-modality-dynamization); }

        /* Global annotation sidebar */
        .annotation-sidebar {
          position: fixed;
          top: 0;
          right: 0;
          width: 380px;
          height: 100vh;
          background: var(--mma-bg-elevated);
          border-left: 1px solid var(--mma-border);
          z-index: 100000;
          transform: translateX(100%);
          transition: transform 0.28s ease;
          display: flex;
          flex-direction: column;
          color: var(--mma-text-primary);
        }

        .annotation-sidebar.visible { transform: translateX(0); }

        .annotation-sidebar-header {
          padding: 14px 16px 12px;
          border-bottom: 1px solid var(--mma-border-soft);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: 'Spectral', Georgia, serif;
          font-weight: 500;
          font-size: 15px;
          color: var(--mma-text-primary);
        }

        .annotation-sidebar-close {
          width: 26px;
          height: 26px;
          border: 1px solid var(--mma-border);
          border-radius: 50%;
          background: transparent;
          color: var(--mma-text-faint);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .annotation-sidebar-close svg {
          width: 12px;
          height: 12px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.8;
          stroke-linecap: round;
        }

        .annotation-sidebar-close:hover {
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
        }

        .annotation-sidebar-content {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
        }

        .annotation-sidebar-content textarea {
          width: 100%;
          min-height: 180px;
          border: 1px solid var(--mma-border);
          border-radius: 8px;
          padding: 10px 12px;
          font-family: inherit;
          font-size: 13px;
          background: var(--mma-bg-base);
          color: var(--mma-text-body);
          resize: vertical;
          line-height: 1.5;
          box-sizing: border-box;
        }

        .annotation-sidebar-content textarea:focus {
          outline: none;
          border-color: var(--mma-accent-ring);
        }

        .annotation-sidebar-content p {
          margin: 0 0 8px 0;
          line-height: 1.55;
          color: var(--mma-text-body);
          font-size: 13px;
        }

        .annotation-sidebar-buttons {
          padding: 14px 16px;
          border-top: 1px solid var(--mma-border-soft);
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }

        /* Action buttons in the footer (Cancel / Save / Delete).
           Explicit :not() exclusion for the header close button so
           it keeps its 26x26 circle from .annotation-sidebar-close
           (higher specificity loses without this exception, and the
           X SVG got clipped inside a 30px-tall pill with 14px of
           horizontal padding). */
        .annotation-sidebar button:not(.annotation-sidebar-close) {
          height: 30px;
          padding: 0 14px;
          border: 1px solid var(--mma-border);
          border-radius: 999px;
          background: var(--mma-surface-soft);
          color: var(--mma-text-primary);
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.02em;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .annotation-sidebar button:not(.annotation-sidebar-close):hover {
          background: var(--mma-surface-hover);
        }

        .annotation-sidebar button.delete-btn {
          background: transparent;
          border-color: rgba(215, 122, 114, 0.45);
          color: #d77a72;
        }

        .annotation-sidebar button.delete-btn:hover {
          background: rgba(215, 122, 114, 0.12);
          border-color: rgba(215, 122, 114, 0.75);
        }

        /* Sidebar backdrop */
        .sidebar-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100vh;
          background: rgba(0, 0, 0, 0.5);
          z-index: 99999;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.28s ease;
        }

        .sidebar-backdrop.visible {
          opacity: 1;
          pointer-events: all;
        }
      </style>

      <header class="app-header">
        <div class="app-title-group">
          <span class="app-title">${APP_TITLE}</span>
          <span class="app-title-divider" aria-hidden="true"></span>
          <span class="app-subtitle">${APP_SUBTITLE}</span>
        </div>
        <div class="app-header-actions">
          <span class="profile-badge" id="profile-badge" title="Active annotation profile: interim-geko">
            <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"
                 fill="none" stroke="currentColor" stroke-width="1.7"
                 stroke-linecap="round" stroke-linejoin="round">
              <!-- brick wall: outer box + a vertical inner divider + a
                   horizontal mid-line offset to suggest interlocking
                   courses of bricks. -->
              <rect x="3" y="4" width="18" height="16" rx="0.5"/>
              <path d="M3 12h18"/>
              <path d="M9 4v8"/>
              <path d="M15 12v8"/>
            </svg>
            <span>INTERIM</span>
          </span>
          <button class="app-icon-btn" id="theme-toggle-btn" title="Switch theme" aria-label="Switch to light theme">
            <!-- Icon swapped at runtime by _applyTheme(); sun in dark mode = "go to light". -->
            <svg class="theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
            <svg class="theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true" style="display:none;">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>
            </svg>
          </button>
          <button class="app-icon-btn app-info-btn" id="app-info-btn" title="About this project" aria-label="About">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          </button>
        </div>
      </header>

      <nav class="tab-strip" role="tablist" aria-label="Workspace tabs">
        <button class="tab active" id="tab-annotate" role="tab" aria-selected="true" aria-controls="view-annotate" data-tab="annotate">Annotate</button>
        <button class="tab" id="tab-query" role="tab" aria-selected="false" aria-controls="view-query" data-tab="query">Query &amp; Analytics</button>
        <button class="tab" id="tab-datamodel" role="tab" aria-selected="false" aria-controls="data-model-view" data-tab="datamodel">Data Model</button>
        <button class="tab" id="tab-viz" role="tab" aria-selected="false" aria-controls="viz-view" data-tab="viz">Visualization</button>
      </nav>

      <div class="main-wrapper">
        <div class="sidebar">
          <button class="sidebar-btn add" id="add-panel-btn" title="Add Panel">+</button>
          <div class="panel-list" id="panel-list"></div>
        </div>

        <div class="container">
          <svg id="connection-overlay"></svg>
          <div class="panels-area" id="panels-area"></div>
        </div>
      </div>

      <!-- Data Model view (third main tab). Body populated lazily by
           _renderDataModelView() on first activation. -->
      <section class="data-model-view" id="data-model-view" hidden>
        <div class="dm-header">
          <span class="dm-title">Data Model</span>
          <span class="dm-subtitle">
            Vocabulary used by the MLAO Anchor flow. Built-in terms ship
            with the interim-geko profile; custom additions are stored
            locally for now (Phase 3 will move them to backend
            persistence).
          </span>
        </div>

        <div class="dm-section" id="dm-section-levels">
          <div class="dm-section-header">
            <span class="dm-section-title">Conceptual Levels</span>
            <button class="dm-add-btn" id="dm-add-level-btn" type="button">+ Add level</button>
          </div>
          <p class="dm-section-sub">
            Levels used to anchor annotations to abstract interpretation
            tiers (e.g. ICON's Panofsky levels). Drives the
            <code>mlao:hasConceptualLevel</code> dropdown in the Anchor
            modal.
          </p>
          <ul class="dm-list" id="dm-list-levels"></ul>
        </div>

        <div class="dm-section" id="dm-section-classes">
          <div class="dm-section-header">
            <span class="dm-section-title">Entity Classes</span>
            <button class="dm-add-btn" id="dm-add-class-btn" type="button">+ Add class</button>
          </div>
          <p class="dm-section-sub">
            Used as types for the real-world entity referenced by
            <code>mlao:isAnchoredTo</code>. CIDOC-CRM core +
            <code>skos:Concept</code> ship as built-in. The default in
            the Anchor modal is <code>crm:E1_Entity</code> (accepts
            anything).
          </p>
          <ul class="dm-list" id="dm-list-classes"></ul>
        </div>
      </section>

      <!-- Shared "Add Custom Vocabulary Item" modal. Re-used by both
           Conceptual Levels and Entity Classes sections (title + the
           field tying it to the right localStorage key are stamped at
           open time). -->
      <div class="anchor-modal mma-modal" id="dm-add-modal" role="dialog" aria-modal="true" aria-labelledby="dm-add-modal-title" hidden>
        <div class="mma-modal-header">
          <span class="mma-modal-title" id="dm-add-modal-title">Add</span>
          <button class="mma-modal-close" id="dm-add-modal-close" aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="mma-modal-body anchor-modal-body">
          <label class="anchor-field">
            <span class="anchor-field-label">Label</span>
            <input id="dm-add-label" class="anchor-field-input" type="text" autocomplete="off"
                   placeholder="e.g. Pre-iconographical" />
          </label>
          <label class="anchor-field">
            <span class="anchor-field-label">IRI / CURIE</span>
            <input id="dm-add-iri" class="anchor-field-input" type="text" autocomplete="off"
                   placeholder="e.g. icon:PreiconographicalSubject" />
            <span class="anchor-field-hint">Full IRI or CURIE (mma:, crm:, mlao:, geko:, icon:, skos:).</span>
          </label>
        </div>
        <div class="mma-modal-footer">
          <button class="anchor-create-btn" id="dm-add-save-btn" type="button">Save</button>
        </div>
      </div>

      <div class="toolbar">
        <button id="export-btn" title="Export as GEKO Ekphrasis collection (Collection → Ekphrasis per page → Annotation)">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          <span>Export</span>
        </button>
        <span class="status" id="status">Ready — Select and confirm text/image, then drag to link</span>
        <span class="copyright">© 2026 Carlo Teo Pedretti</span>
      </div>

      <div class="modality-selector" id="modality-selector" role="dialog" aria-modal="true" aria-labelledby="modality-selector-title">
        <div class="mma-modal-header">
          <span class="mma-modal-title" id="modality-selector-title">Select ekphrastic modality</span>
          <button class="mma-modal-close" id="modality-selector-close" aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modality-buttons">
          <button class="modality-btn denotation" data-modality="denotation">
            <span>
              <strong>Denotation</strong>
              <small>Direct referential link</small>
            </span>
          </button>
          <button class="modality-btn dynamisation" data-modality="dynamisation">
            <span>
              <strong>Dynamization</strong>
              <small>Movement / temporal</small>
            </span>
          </button>
          <button class="modality-btn integration" data-modality="integration">
            <span>
              <strong>Integration</strong>
              <small>Interpretive blend</small>
            </span>
          </button>
        </div>
      </div>

      <!-- MLAO Anchor modal: auto-shown after a linking annotation
           saves. 4 fields: skip / entity class / isAnchoredTo /
           conceptual level. Skip leaves the annotation un-anchored. -->
      <div class="anchor-modal mma-modal" id="anchor-modal" role="dialog" aria-modal="true" aria-labelledby="anchor-modal-title" hidden>
        <div class="mma-modal-header">
          <span class="mma-modal-title" id="anchor-modal-title">Anchor this annotation?</span>
          <button class="anchor-skip-link" id="anchor-skip-btn" type="button">Skip</button>
          <button class="mma-modal-close" id="anchor-modal-close" aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="mma-modal-body anchor-modal-body">
          <p class="anchor-modal-subtitle">
            Optional: anchor the annotation to a real-world entity and
            a conceptual level (MLAO).
          </p>

          <label class="anchor-field">
            <span class="anchor-field-label">Entity class</span>
            <select id="anchor-entity-class" class="anchor-field-input"></select>
            <span class="anchor-field-hint">What kind of entity is this?</span>
          </label>

          <div class="anchor-field anchor-field-search">
            <span class="anchor-field-label">isAnchoredTo &mdash; Real-world entity</span>
            <!-- Selected chip lives here when a result is picked; the
                 input + dropdown live below and are hidden while the
                 chip is shown. -->
            <div class="anchor-entity-chip" id="anchor-entity-chip" hidden>
              <span class="anchor-chip-label" id="anchor-chip-label"></span>
              <span class="anchor-chip-iri"   id="anchor-chip-iri"></span>
              <button class="anchor-chip-clear" id="anchor-chip-clear"
                      type="button" aria-label="Clear selection">
                <svg viewBox="0 0 24 24" width="11" height="11"
                     fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="anchor-search-wrap" id="anchor-search-wrap">
              <input id="anchor-entity-input" class="anchor-field-input"
                     type="text"
                     placeholder="Search Wikidata or create custom…"
                     autocomplete="off" />
              <ul class="anchor-search-results" id="anchor-search-results" hidden></ul>
            </div>
            <span class="anchor-field-hint">
              Searches Wikidata in English. If nothing matches, the
              last item lets you mint a custom entity IRI.
            </span>
          </div>

          <label class="anchor-field">
            <span class="anchor-field-label">Conceptual level</span>
            <select id="anchor-conceptual-level" class="anchor-field-input">
              <option value="">— none —</option>
            </select>
            <span class="anchor-field-hint">At which interpretive tier?</span>
          </label>
        </div>
        <div class="mma-modal-footer">
          <button class="anchor-create-btn" id="anchor-create-btn" type="button">Create Anchor</button>
        </div>
      </div>

      <div class="modal-overlay" id="modal-overlay"></div>
      <div class="add-panel-modal" id="add-panel-modal" role="dialog" aria-modal="true" aria-labelledby="add-panel-title">
        <div class="mma-modal-header">
          <span class="mma-modal-title" id="add-panel-title">Add new panel</span>
          <button class="mma-modal-close" id="add-panel-close" aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="mma-modal-body">
          <div class="panel-type-buttons">
            <button class="panel-type-btn" data-type="text">
              <span class="label">
                <strong>Text panel</strong>
                <small>Annotate textual content</small>
              </span>
            </button>
            <button class="panel-type-btn" data-type="image">
              <span class="label">
                <strong>Image panel</strong>
                <small>IIIF images, paintings</small>
              </span>
            </button>
            <button class="panel-type-btn" data-type="facsimile">
              <span class="label">
                <strong>Facsimile panel</strong>
                <small>Manuscript facsimiles</small>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div class="connection-menu" id="connection-menu" role="menu">
        <button class="connection-menu-item" id="connection-info" role="menuitem">View details</button>
        <button class="connection-menu-item danger" id="connection-delete" role="menuitem">Delete connection</button>
      </div>

      <div class="about-modal" id="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
        <button class="close-btn" id="close-about-btn" aria-label="Close">×</button>
        <h2 id="about-modal-title">${APP_TITLE}</h2>

        <p>
          A web-based tool for creating semantic annotations between manuscript transcriptions and artwork images,
          specifically designed for ekphrastic analysis using the INTERIM and GEKO ontologies.
        </p>

        <h3>Features</h3>
        <ul>
          <li>Multi-canvas IIIF manifest navigation with synchronized panels</li>
          <li>PAGE XML transcription support (Transkribus format)</li>
          <li>Dual annotation models: simple transcription and ekphrastic relations</li>
          <li>Visual drag-and-drop interface for linking text to images</li>
          <li>Persistent annotations across canvas navigation</li>
          <li>Export to Web Annotation Data Model (JSON-LD)</li>
        </ul>

        <h3>Annotation Types</h3>
        <div class="color-legend">
          <div class="color-item">
            <div class="color-box denotation"></div>
            <span>Denotation - Direct reference</span>
          </div>
          <div class="color-item">
            <div class="color-box dynamisation"></div>
            <span>Dynamisation - Movement/temporal</span>
          </div>
          <div class="color-item">
            <div class="color-box integration"></div>
            <span>Integration - Interpretive blend</span>
          </div>
          <div class="color-item">
            <div class="color-box transcription"></div>
            <span>Transcription - Facsimile to text</span>
          </div>
        </div>

        <h3>How to Use</h3>
        <ul>
          <li><strong>Select text:</strong> Highlight text in the Transcription panel and click "Confirm"</li>
          <li><strong>Select image region:</strong> Enable selection mode and draw a rectangle on the image</li>
          <li><strong>Create connection:</strong> Drag from confirmed text to confirmed image region</li>
          <li><strong>Choose modality:</strong> Select the ekphrastic relationship type (for Visual Work panel)</li>
          <li><strong>Manage connections:</strong> Click on connection lines to view details or delete</li>
          <li><strong>Export:</strong> Use the export button to download all annotations as JSON</li>
        </ul>

        <p style="margin-top: calc(var(--spacing-unit) * 3); font-size: 0.85rem; color: var(--color-gray-700);">
          Built with Web Components, OpenSeadragon, and IIIF standards.<br>
          © 2026 Carlo Teo Pedretti
        </p>
      </div>

      <!-- Global annotation sidebar -->
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <div class="annotation-sidebar" id="annotation-sidebar"></div>

      <!-- Non-blocking toast stack for store errors (T1.5b) -->
      <mma-toast-stack id="toast-stack"></mma-toast-stack>
    `;
  }

  setupEventListeners() {
    const exportBtn = this.shadowRoot.getElementById('export-btn');
    const modalityButtons = this.shadowRoot.querySelectorAll('.modality-btn');
    const addPanelBtn = this.shadowRoot.getElementById('add-panel-btn');
    const modalOverlay = this.shadowRoot.getElementById('modal-overlay');
    const addPanelModal = this.shadowRoot.getElementById('add-panel-modal');
    const panelTypeButtons = this.shadowRoot.querySelectorAll('.panel-type-btn');
    const appInfoBtn = this.shadowRoot.getElementById('app-info-btn');
    const aboutModal = this.shadowRoot.getElementById('about-modal');
    const closeAboutBtn = this.shadowRoot.getElementById('close-about-btn');

    // About modal
    appInfoBtn.addEventListener('click', () => this.openAboutModal());
    closeAboutBtn.addEventListener('click', () => this.closeAboutModal());

    // Anchor modal — Skip / X / Create. Esc handled below at document
    // level so it covers backdrop-less invocations too.
    const anchorSkipBtn   = this.shadowRoot.getElementById('anchor-skip-btn');
    const anchorCloseBtn  = this.shadowRoot.getElementById('anchor-modal-close');
    const anchorCreateBtn = this.shadowRoot.getElementById('anchor-create-btn');
    if (anchorSkipBtn)   anchorSkipBtn.addEventListener('click', () => this._closeAnchorModal());
    if (anchorCloseBtn)  anchorCloseBtn.addEventListener('click', () => this._closeAnchorModal());
    if (anchorCreateBtn) anchorCreateBtn.addEventListener('click', () => this._submitAnchor());
    this._wireAnchorSearch();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = this.shadowRoot.getElementById('anchor-modal');
      if (modal && !modal.hidden) this._closeAnchorModal();
    });

    // Theme toggle — runs once render() has wired the button into the
    // shadow tree. _initTheme() already set the attribute pre-render;
    // we call _setTheme again here just to sync the icon visibility.
    const themeBtn = this.shadowRoot.getElementById('theme-toggle-btn');
    if (themeBtn) {
      this._setTheme(this.getAttribute('data-theme') || 'dark', /* persist */ false);
      themeBtn.addEventListener('click', () => this._toggleTheme());
    }

    // Add panel button
    addPanelBtn.addEventListener('click', () => this.openAddPanelModal());

    // Close modal on overlay click
    modalOverlay.addEventListener('click', () => {
      this.closeAddPanelModal();
      this.closeAboutModal();
    });

    // Uniform-modal close buttons (v2 — every modal has an X)
    const addPanelCloseBtn = this.shadowRoot.getElementById('add-panel-close');
    if (addPanelCloseBtn) {
      addPanelCloseBtn.addEventListener('click', () => this.closeAddPanelModal());
    }
    const modalitySelectorCloseBtn = this.shadowRoot.getElementById('modality-selector-close');
    if (modalitySelectorCloseBtn) {
      modalitySelectorCloseBtn.addEventListener('click', () => {
        const modalitySelector = this.shadowRoot.getElementById('modality-selector');
        modalitySelector.classList.remove('active');
        this.pendingConnection = null;
        this.draggingFrom = null;
        this.updateStatus('Selection cancelled');
      });
    }

    // Esc closes any open modal (about / add-panel / modality selector
    // / connection menu / global sidebar). Bound at document level so
    // it works regardless of which surface has focus.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      let handled = false;
      const aboutEl = this.shadowRoot.getElementById('about-modal');
      if (aboutEl?.classList.contains('active')) { this.closeAboutModal(); handled = true; }
      const addPanelEl = this.shadowRoot.getElementById('add-panel-modal');
      if (addPanelEl?.classList.contains('active')) { this.closeAddPanelModal(); handled = true; }
      const modalityEl = this.shadowRoot.getElementById('modality-selector');
      if (modalityEl?.classList.contains('active')) {
        modalityEl.classList.remove('active');
        this.pendingConnection = null;
        this.draggingFrom = null;
        handled = true;
      }
      const connMenuEl = this.shadowRoot.getElementById('connection-menu');
      if (connMenuEl?.classList.contains('active')) { this.hideConnectionMenu(); handled = true; }
      const sidebarEl = this.shadowRoot.getElementById('annotation-sidebar');
      if (sidebarEl?.classList.contains('visible')) {
        sidebarEl.classList.remove('visible');
        const backdropEl = this.shadowRoot.getElementById('sidebar-backdrop');
        backdropEl?.classList.remove('visible');
        handled = true;
      }
      if (handled) e.stopPropagation();
    });

    // Panel type selection
    panelTypeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.addPanel(type);
        this.closeAddPanelModal();
      });
    });

    // Listen for text confirmation (ready to be linked)
    this.addEventListener('text-confirmed', (e) => {
      const { element, selection, annotationType } = e.detail;
      if (annotationType === 'entity-linking') {
        this.unlinkedTextElements.push({ element, selection });
        this.makeDraggable(element, 'text');
        this.updateStatus(`Text ready to link (${this.unlinkedTextElements.length} unlinked)`);
      }
    });

    // Listen for standalone text annotations (comment, tag).
    // The child-panel CustomEvent carries `{element, selection, annotationType, body}`.
    // The orchestrator's OWN re-emitted `annotation-created` (kebab-case adapter
    // for store events) carries the JSON-LD annotation directly — distinguish
    // by the presence of `e.detail.element`.
    this.addEventListener('annotation-created', (e) => {
      if (!e.detail || !e.detail.element) return; // not from a child panel
      const { element, selection, annotationType, body } = e.detail;

      const annotation = this.createStandaloneAnnotation(selection, annotationType, body);
      // Strip client-side id; let the backend mint a ULID.
      delete annotation.id;
      delete annotation['@context'];

      this.store?.create(this.container, annotation, { element })
        .catch(() => { /* surfaced via store:error → toast */ });

      this.updateStatus(`${annotationType} annotation created`);
    });

    // Listen for standalone image annotations (comment, tag) — same pattern.
    this.addEventListener('image-annotation-created', (e) => {
      if (!e.detail || !e.detail.element) return;
      const { element, selection, annotationType, body } = e.detail;

      const annotation = this.createStandaloneImageAnnotation(selection, annotationType, body);
      delete annotation.id;
      delete annotation['@context'];

      this.store?.create(this.container, annotation, { element })
        .catch(() => { /* toast */ });

      this.updateStatus(`Image ${annotationType} annotation created`);
    });

    // Panel-side annotation DELETE — children emit annotation-deleted /
    // image-annotation-deleted; route through the store so the backend
    // graph is dropped. The centralized 'annotation:removed' listener
    // (in _initStore) then purges every visual tagged with that IRI in
    // any panel — implementing the atomic linking-annotation rule
    // (deleting one endpoint tears down the whole annotation).
    //
    // We read the IRI via getAttribute('data-annotation-iri') instead of
    // `dataset.annotationIri` because SVG elements (used by the freehand
    // image selector) lack `dataset` in some browsers.
    const routeDelete = (e) => {
      const el = e.detail?.element;
      const iri = el?.getAttribute?.('data-annotation-iri');
      if (!iri) {
        console.warn('[MMA] annotation-deleted from panel had no data-annotation-iri on element', e.detail);
        return;
      }
      if (!this.store) return;
      this.store.remove(iri).catch((err) => {
        console.warn('[MMA] store.remove rejected', err);
      });
    };
    this.addEventListener('annotation-deleted', routeDelete);
    this.addEventListener('image-annotation-deleted', routeDelete);

    // Listen for show comment sidebar requests
    this.addEventListener('show-comment-sidebar', (e) => {
      const { type, element, selection, selectionData, onCancel, onSave } = e.detail;
      this.showGlobalCommentSidebar(type, onCancel, onSave);
    });

    // Listen for show annotation info requests
    this.addEventListener('show-annotation-info', (e) => {
      const { type, title, message, onDelete, iri } = e.detail;
      // Augment the popup message with an Anchor block if the cached
      // annotation has one. The Edit-anchor handler reopens the modal
      // pre-filled — see _openAnchorModal(iri, {prefill}).
      let augmentedMessage = message;
      let onEditAnchor = null;
      const cached = iri ? this.store?.cache?.get(iri) : null;
      if (cached?.hasAnchor) {
        const a = cached.hasAnchor;
        const safe = (s) => String(s ?? '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const anchorIri = safe(a.isAnchoredTo);
        const label  = a.isAnchoredToLabel ? `${safe(a.isAnchoredToLabel)} <span style="color:var(--mma-text-muted);">(${anchorIri})</span>` : anchorIri;
        const level  = a.hasConceptualLevel
          ? `<p style="margin-top:6px;font-size:12px;color:var(--mma-text-muted);">Level: ${safe(a.hasConceptualLevel)}</p>`
          : '';
        const isCustomBadge = a.isCustomEntity
          ? `<span style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--mma-text-faint);margin-left:6px;">custom</span>`
          : '';
        augmentedMessage = (message || '') + `
          <div style="margin-top:14px;padding:12px 14px;border:1px solid var(--mma-accent-border);border-radius:8px;background:var(--mma-accent-bg);">
            <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--mma-text-label);">⚓ Anchored to ${isCustomBadge}</p>
            <p style="margin:6px 0 0;font-size:13px;color:var(--mma-text-primary);">${label}</p>
            ${level}
          </div>`;
        if (iri) onEditAnchor = () => this._openAnchorModal(iri, {}, { prefill: a });
      }
      this.showGlobalAnnotationInfo(title, augmentedMessage, onDelete, onEditAnchor);
    });

    // Listen for image region selection events
    this.addEventListener('image-region-selected', (e) => {
      this.selectedImageRegion = e.detail;
      // Auto-confirm image selection and make it draggable
      setTimeout(() => {
        // Find the image panel that triggered the event
        const imagePanels = this.shadowRoot.querySelectorAll('iiif-image-panel');

        // Find which panel has the current selection
        let sourcePanel = null;
        let sourcePanelConfig = null;
        for (const panel of imagePanels) {
          const currentRect = panel.shadowRoot?.querySelector('#current-selection-rect');
          if (currentRect) {
            sourcePanel = panel;
            // Find the panel configuration to get panel type
            const panelDiv = panel.closest('.panel');
            if (panelDiv) {
              const panelId = panelDiv.id;
              sourcePanelConfig = this.panels.find(p => p.id === panelId);
            }
            break;
          }
        }

        if (sourcePanel && typeof sourcePanel.confirmCurrentRect === 'function') {
          sourcePanel.confirmCurrentRect();
          // Get both rectangle divs and SVG paths that are confirmed
          const allConfirmedRects = sourcePanel.shadowRoot?.querySelectorAll('.selection-rect.confirmed, svg.confirmed');
          if (allConfirmedRects && allConfirmedRects.length > 0) {
            const rect = allConfirmedRects[allConfirmedRects.length - 1];
            this.unlinkedImageRects.push({
              element: rect,
              selection: e.detail,
              panel: sourcePanel,
              panelType: sourcePanelConfig?.type || 'image' // Store panel type
            });
            this.makeDraggable(rect, 'image');
          }
        }
        this.updateStatus(`Image ready to link (${this.unlinkedImageRects.length} unlinked)`);
      }, 50);
    });

    // Single Export button → GEKO v2 collection (the canonical
    // poster artefact). The legacy flat-JSON-LD exporter
    // (this.exportAnnotations) stays in the class for programmatic
    // callers but is no longer exposed via the toolbar.
    exportBtn.addEventListener('click', () => this.exportAnnotationsGeko());

    // Modality selector buttons
    modalityButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const modality = btn.dataset.modality;
        this.handleModalitySelected(modality);
      });
    });

    // Global mouse events for dragging
    document.addEventListener('mousemove', (e) => this.handleDragMove(e));
    document.addEventListener('mouseup', (e) => this.handleDragEnd(e));

    // Close connection menu on click outside
    document.addEventListener('click', (e) => {
      const menu = this.shadowRoot.getElementById('connection-menu');
      if (menu && !menu.contains(e.target)) {
        this.hideConnectionMenu();
      }
    });
  }

  setupScrollListeners() {
    // Use requestAnimationFrame for smooth updates
    this.rafId = null;
    this.updateConnectionsHandler = () => {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = requestAnimationFrame(() => {
        this.updateAllConnections();
      });
    };

    // Listen to scroll events on window (with capture to catch all scrolling)
    window.addEventListener('scroll', this.updateConnectionsHandler, true);

    // Listen to wheel events (catches momentum scrolling and bounce)
    window.addEventListener('wheel', this.updateConnectionsHandler, { passive: true, capture: true });

    // Listen to touch events for mobile/trackpad
    window.addEventListener('touchmove', this.updateConnectionsHandler, { passive: true, capture: true });

    // Listen to resize events
    window.addEventListener('resize', this.updateConnectionsHandler);

    // Also listen to scroll on the specific scrollable containers
    setTimeout(() => {
      const panels = this.shadowRoot.querySelectorAll('.panel-content');
      panels.forEach(panel => {
        panel.addEventListener('scroll', this.updateConnectionsHandler);
        panel.addEventListener('wheel', this.updateConnectionsHandler, { passive: true });
      });

      // Get all text and image panels and listen to their internal scroll
      const textPanels = this.shadowRoot.querySelectorAll('iiif-text-panel');
      const imagePanels = this.shadowRoot.querySelectorAll('iiif-image-panel');

      textPanels.forEach(textPanel => {
        if (textPanel?.shadowRoot) {
          const textArea = textPanel.shadowRoot.querySelector('.text-area');
          if (textArea) {
            textArea.addEventListener('scroll', this.updateConnectionsHandler);
            textArea.addEventListener('wheel', this.updateConnectionsHandler, { passive: true });
          }
        }
      });

      imagePanels.forEach(imagePanel => {
        if (imagePanel?.shadowRoot) {
          const viewerContainer = imagePanel.shadowRoot.querySelector('.viewer-container');
          if (viewerContainer) {
            viewerContainer.addEventListener('scroll', this.updateConnectionsHandler);
            viewerContainer.addEventListener('wheel', this.updateConnectionsHandler, { passive: true });
          }
        }
      });
    }, 100);

    // Continuous update loop for smooth animations - now at higher priority
    let lastUpdate = performance.now();
    const animate = (currentTime) => {
      // Always update, even if called multiple times per frame
      this.updateAllConnections();
      this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  updateAllConnections() {
    // Redraw all connection lines
    this.connections.forEach((connection, index) => {
      this.updateConnectionLine(connection, index);
    });
  }

  updateConnectionLine(connection, index) {
    const { textElement, imageRect, path, label, modality } = connection;

    // Check if elements still exist
    if (!textElement || !imageRect || !path) return;

    // Check if elements are visible (not display:none and have dimensions)
    const textVisible = textElement.offsetParent !== null &&
                       window.getComputedStyle(textElement).display !== 'none';
    const imageVisible = imageRect.offsetParent !== null &&
                        window.getComputedStyle(imageRect).display !== 'none';

    // If either element is hidden, hide the connection
    if (!textVisible || !imageVisible) {
      path.style.display = 'none';
      if (label) label.style.display = 'none';
      this.hideIndicator(connection);
      return;
    }

    // Show the connection if both elements are visible
    path.style.display = 'block';
    if (label) label.style.display = 'block';

    // Get container bounds for relative positioning
    const container = this.shadowRoot.querySelector('.container');
    if (!container) return;
    const containerBounds = container.getBoundingClientRect();

    // Get element bounds
    const textBounds = textElement.getBoundingClientRect();

    // For SVG elements, get the bounding box of the path, not the SVG container
    let imageBounds;
    if (imageRect.tagName && imageRect.tagName.toLowerCase() === 'svg') {
      const pathElement = imageRect.querySelector('path');
      if (pathElement) {
        // Get the tight bounding box of the path
        const bbox = pathElement.getBBox();
        const svgRect = imageRect.getBoundingClientRect();
        // Convert bbox to screen coordinates
        imageBounds = {
          left: svgRect.left + bbox.x,
          right: svgRect.left + bbox.x + bbox.width,
          top: svgRect.top + bbox.y,
          bottom: svgRect.top + bbox.y + bbox.height,
          width: bbox.width,
          height: bbox.height
        };
      } else {
        imageBounds = imageRect.getBoundingClientRect();
      }
    } else {
      imageBounds = imageRect.getBoundingClientRect();
    }

    // Get text area container to check if text element is in viewport
    // textElement is inside the shadow DOM of the text panel
    const shadowRoot = textElement.getRootNode();
    let textInViewport = true;
    // Buffer: fade ONLY after the endpoint has scrolled past the edge
    // by this many pixels. The previous formula faded while the
    // endpoint was still near the edge but visible (BUG 5).
    const offscreenBuffer = 50;

    if (shadowRoot && shadowRoot.querySelector) {
      const textArea = shadowRoot.querySelector('.text-area');
      if (textArea) {
        const textAreaBounds = textArea.getBoundingClientRect();
        const textTop = textBounds.top;
        const textBottom = textBounds.bottom;

        // Endpoint is "out of view" only when its bottom is above
        // (areaTop − buffer) OR its top is below (areaBottom + buffer).
        if (textBottom < textAreaBounds.top - offscreenBuffer ||
            textTop > textAreaBounds.bottom + offscreenBuffer) {
          textInViewport = false;
        }
      }
    }

    // Calculate coordinates relative to container
    const startX = textBounds.right - containerBounds.left;
    const startY = textBounds.top - containerBounds.top + textBounds.height / 2;
    const endX = imageBounds.left - containerBounds.left;
    const endY = imageBounds.top - containerBounds.top + imageBounds.height / 2;

    // Control points for Bezier curve
    const controlX1 = startX + (endX - startX) * 0.5;
    const controlY1 = startY;
    const controlX2 = startX + (endX - startX) * 0.5;
    const controlY2 = endY;

    // Update path
    const pathData = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
    path.setAttribute('d', pathData);

    // Update label position (middle of the curve)
    if (label) {
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      label.setAttribute('x', midX);
      label.setAttribute('y', midY - 5);
    }

    // Handle fade out and indicator
    if (!textInViewport) {
      // Fade out the connection
      path.style.opacity = '0.1';
      if (label) label.style.opacity = '0';

      // Show indicator circle near the image box
      this.showIndicator(connection, imageBounds, containerBounds);
    } else {
      // Show connection normally
      path.style.opacity = '1';
      if (label) label.style.opacity = '1';

      // Hide indicator
      this.hideIndicator(connection);
    }
  }

  showIndicator(connection, imageBounds, containerBounds) {
    const { imageRect, modality } = connection;
    const imageRectId = imageRect.id || imageRect.dataset.id;

    if (!imageRectId) return;

    // Create a unique key for grouping indicators by image rect and modality
    const indicatorKey = `${imageRectId}-${modality}`;

    // Get or create indicator group for this image rect and modality
    if (!this.connectionIndicators.has(indicatorKey)) {
      const svg = this.shadowRoot.getElementById('connection-overlay');
      if (!svg) return;

      // Create larger invisible hit area for easier clicking
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitArea.setAttribute('class', 'connection-indicator-hitarea');
      hitArea.setAttribute('r', '30'); // Much larger hit area for easy clicking

      // Create indicator circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', `connection-indicator ${modality}`);
      circle.setAttribute('r', '8');

      // Create count text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'indicator-count');

      svg.appendChild(hitArea);
      svg.appendChild(circle);
      svg.appendChild(text);

      this.connectionIndicators.set(indicatorKey, {
        hitArea,
        circle,
        text,
        connections: new Set(),
        imageRect,
        modality
      });
    }

    // Add this connection to the indicator group
    const indicator = this.connectionIndicators.get(indicatorKey);
    indicator.connections.add(connection);

    // Calculate radius proportional to box size (9% of box height, min 9px, max 18px)
    const boxHeight = imageBounds.height;
    const radius = Math.max(9, Math.min(18, boxHeight * 0.09));
    indicator.circle.setAttribute('r', radius);

    // Position indicators inside the box perimeter, along the top edge
    // Stack horizontally if multiple modalities for same image
    const modalityIndex = ['denotation', 'dynamisation', 'integration', 'transcription'].indexOf(modality);
    const spacing = radius * 2.8; // Spacing between indicators
    const offsetX = modalityIndex * spacing;

    // Position inside the box, near the top-right corner with some padding
    const padding = radius + 3;
    const cx = imageBounds.right - containerBounds.left - padding - offsetX;
    const cy = imageBounds.top - containerBounds.top + padding;

    indicator.circle.setAttribute('cx', cx);
    indicator.circle.setAttribute('cy', cy);
    indicator.hitArea.setAttribute('cx', cx);
    indicator.hitArea.setAttribute('cy', cy);

    // Update count with font size proportional to circle
    const count = indicator.connections.size;
    indicator.text.setAttribute('x', cx);
    indicator.text.setAttribute('y', cy);
    indicator.text.setAttribute('font-size', `${radius * 1.2}px`);
    indicator.text.textContent = count > 1 ? count : '';

    // Make indicator clickable only (no auto-open on hover)
    if (!indicator.circle.hasAttribute('data-listener')) {
      indicator.circle.addEventListener('click', (e) => {
        e.stopPropagation();
        const count = indicator.connections.size;

        // Close any other open radial menu first
        this.hideRadialMenu();

        if (count === 1) {
          // Single connection - scroll directly
          this.scrollToConnection(Array.from(indicator.connections)[0]);
        } else {
          // Multiple connections - show radial menu
          this.showRadialMenu(indicator, e);
        }
      });

      indicator.circle.setAttribute('data-listener', 'true');
    }
  }

  hideIndicator(connection) {
    const { imageRect, modality } = connection;
    const imageRectId = imageRect?.id || imageRect?.dataset?.id;

    if (!imageRectId) return;

    const indicatorKey = `${imageRectId}-${modality}`;
    const indicator = this.connectionIndicators.get(indicatorKey);

    if (!indicator) return;

    // Remove this connection from the indicator group
    indicator.connections.delete(connection);

    // If no more connections in this group, remove the indicator
    if (indicator.connections.size === 0) {
      indicator.hitArea.remove();
      indicator.circle.remove();
      indicator.text.remove();
      this.connectionIndicators.delete(indicatorKey);
    } else {
      // Update count
      const count = indicator.connections.size;
      indicator.text.textContent = count > 1 ? count : '';
    }
  }

  scrollToConnection(connection) {
    if (!connection || !connection.textElement) return;

    // Find the text panel containing this element
    const textPanel = connection.textElement.getRootNode().host;
    if (textPanel && textPanel.shadowRoot) {
      const textContainer = textPanel.shadowRoot.querySelector('.text-area');
      if (textContainer) {
        const elementTop = connection.textElement.offsetTop;
        const elementHeight = connection.textElement.offsetHeight;
        const containerHeight = textContainer.clientHeight;

        // Calculate scroll position to center the element
        const targetScroll = elementTop - (containerHeight / 2) + (elementHeight / 2);

        // Smooth scroll
        textContainer.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });

        this.updateStatus(`Scrolling to ${connection.modality} annotation`);
      }
    }
  }

  showRadialMenu(indicator, event) {
    // Hide any existing radial menu
    this.hideRadialMenu();

    const svg = this.shadowRoot.getElementById('connection-overlay');
    if (!svg) return;

    // Get click position (center of the clicked indicator)
    const cx = parseFloat(indicator.circle.getAttribute('cx'));
    const cy = parseFloat(indicator.circle.getAttribute('cy'));

    // Create radial menu container
    const menuGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    menuGroup.setAttribute('class', 'radial-menu');
    menuGroup.setAttribute('id', 'radial-menu');

    // Calculate positions for menu items in a circle
    const connections = Array.from(indicator.connections);
    const numItems = connections.length;
    const menuRadius = 50; // Distance from center
    const itemRadius = 8; // Size of each menu item

    connections.forEach((connection, index) => {
      // Calculate angle for this item (distributed evenly in a circle)
      const angle = (index / numItems) * Math.PI * 2 - Math.PI / 2; // Start from top
      const itemX = cx + Math.cos(angle) * menuRadius;
      const itemY = cy + Math.sin(angle) * menuRadius;

      // Create circle for this menu item
      const menuItem = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      menuItem.setAttribute('cx', itemX);
      menuItem.setAttribute('cy', itemY);
      menuItem.setAttribute('r', itemRadius);
      menuItem.setAttribute('class', `radial-menu-item ${indicator.modality}`);
      menuItem.style.cursor = 'pointer';

      // Add line connecting to center
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx);
      line.setAttribute('y1', cy);
      line.setAttribute('x2', itemX);
      line.setAttribute('y2', itemY);
      line.setAttribute('class', 'radial-menu-line');

      // Get text preview from connection (first 20 chars)
      const textPreview = connection.textElement?.textContent?.trim().substring(0, 20) || `#${index + 1}`;
      const labelText = textPreview.length === 20 ? textPreview + '...' : textPreview;

      // Create background rect for text label
      const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      labelBg.setAttribute('class', 'radial-menu-label-bg');
      labelBg.setAttribute('rx', '3'); // Rounded corners

      // Add text label with preview
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'radial-menu-label');
      label.textContent = labelText;

      // Position label offset from the circle
      const labelOffset = 15; // Distance from circle
      const labelX = itemX + Math.cos(angle) * labelOffset;
      const labelY = itemY + Math.sin(angle) * labelOffset;

      label.setAttribute('x', labelX);
      label.setAttribute('y', labelY);

      // Get text dimensions and position background
      setTimeout(() => {
        const bbox = label.getBBox();
        labelBg.setAttribute('x', bbox.x - 3);
        labelBg.setAttribute('y', bbox.y - 2);
        labelBg.setAttribute('width', bbox.width + 6);
        labelBg.setAttribute('height', bbox.height + 4);
      }, 0);

      // Click handler for both circle and label
      const clickHandler = (e) => {
        e.stopPropagation();
        this.scrollToConnection(connection);
        this.hideRadialMenu();
      };

      menuItem.addEventListener('click', clickHandler);
      label.style.cursor = 'pointer';
      label.addEventListener('click', clickHandler);

      menuGroup.appendChild(line);
      menuGroup.appendChild(menuItem);
      menuGroup.appendChild(labelBg);
      menuGroup.appendChild(label);
    });

    svg.appendChild(menuGroup);

    // Store timeout for mouseleave
    this.radialMenuTimeout = null;

    // Auto-close menu when mouse leaves the menu area
    const handleMouseLeave = () => {
      this.radialMenuTimeout = setTimeout(() => {
        this.hideRadialMenu();
      }, 300); // Small delay to allow moving to menu items
    };

    // Cancel auto-close if mouse enters back into menu
    const handleMouseEnter = () => {
      if (this.radialMenuTimeout) {
        clearTimeout(this.radialMenuTimeout);
        this.radialMenuTimeout = null;
      }
    };

    menuGroup.addEventListener('mouseleave', handleMouseLeave);
    menuGroup.addEventListener('mouseenter', handleMouseEnter);

    // Also setup mouseleave on the indicator
    indicator.hitArea.addEventListener('mouseleave', handleMouseLeave);
    indicator.hitArea.addEventListener('mouseenter', handleMouseEnter);

    // Close menu when clicking elsewhere
    const closeHandler = (e) => {
      if (!menuGroup.contains(e.target) && e.target !== indicator.hitArea) {
        this.hideRadialMenu();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  hideRadialMenu() {
    const menu = this.shadowRoot.getElementById('radial-menu');
    if (menu) {
      menu.remove();
    }
  }

  makeDraggable(element, type) {
    element.style.cursor = 'grab';
    element.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleDragStart(element, type, e);
    });
  }

  handleDragStart(element, type, event) {
    // Look up panelType if dragging from an image
    let panelType = null;
    if (type === 'image') {
      const imageItem = this.unlinkedImageRects.find(i => i.element === element);
      panelType = imageItem?.panelType;
    }

    this.draggingFrom = { element, type, panelType };
    element.style.cursor = 'grabbing';

    // Create temporary path. Class `.dragging` is themed via CSS so
    // it follows the accent on theme switch (no inline stroke).
    const svg = this.shadowRoot.getElementById('connection-overlay');
    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('class', 'connection-line dragging');
    this.tempPath.setAttribute('stroke-width', '3');
    this.tempPath.setAttribute('stroke-dasharray', '5,5');
    svg.appendChild(this.tempPath);

    this.updateStatus('Drag to connect...');
  }

  handleDragMove(event) {
    if (!this.draggingFrom || !this.tempPath) return;

    const { element, type } = this.draggingFrom;

    // Get container bounds for relative positioning
    const container = this.shadowRoot.querySelector('.container');
    if (!container) return;
    const containerBounds = container.getBoundingClientRect();

    // Get start position from the dragging element using getBoundingClientRect
    const bounds = element.getBoundingClientRect();
    let startX, startY;

    if (type === 'text') {
      startX = bounds.right - containerBounds.left;
      startY = bounds.top - containerBounds.top + bounds.height / 2;
    } else {
      // For image rect, use bounds directly (already absolute positioned)
      startX = bounds.left - containerBounds.left;
      startY = bounds.top - containerBounds.top + bounds.height / 2;
    }

    // End position is mouse cursor (also relative to container)
    const endX = event.clientX - containerBounds.left;
    const endY = event.clientY - containerBounds.top;

    // Draw curved line
    const controlX1 = startX + (endX - startX) * 0.5;
    const controlY1 = startY;
    const controlX2 = startX + (endX - startX) * 0.5;
    const controlY2 = endY;

    const pathData = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
    this.tempPath.setAttribute('d', pathData);
  }

  handleDragEnd(event) {
    if (!this.draggingFrom) return;

    const { element: fromElement, type: fromType } = this.draggingFrom;
    fromElement.style.cursor = 'grab';

    // Find if we dropped on a valid target
    const target = this.findDropTarget(event, fromType);

    if (target) {
      // Determine which element is the image (to check panel type)
      const imageTarget = fromType === 'image' ? this.draggingFrom : target;
      const targetPanelType = imageTarget.panelType || target.panelType;

      // Store pending connection
      this.pendingConnection = {
        from: this.draggingFrom,
        to: target
      };

      // Check if this is a facsimile connection (text to facsimile)
      if (targetPanelType === 'facsimile') {
        // For facsimile, create simple transcription annotation directly
        this.createConnectionBetween(this.pendingConnection.from, this.pendingConnection.to, null, 'facsimile');
        this.pendingConnection = null;
        this.draggingFrom = null;
      } else {
        // For painting/image, show modality selector
        const modalitySelector = this.shadowRoot.getElementById('modality-selector');
        modalitySelector.style.left = `${event.clientX + 20}px`;
        modalitySelector.style.top = `${event.clientY - 50}px`;
        modalitySelector.classList.add('active');
        this.updateStatus('Select ekphrastic modality...');
      }
    } else {
      this.updateStatus('Connection cancelled');
      this.draggingFrom = null;
    }

    // Remove temporary path
    if (this.tempPath) {
      this.tempPath.remove();
      this.tempPath = null;
    }
  }

  findDropTarget(event, fromType) {
    // Can only connect text to image or image to text
    const targetType = fromType === 'text' ? 'image' : 'text';
    const targetList = targetType === 'text' ? this.unlinkedTextElements : this.unlinkedImageRects;

    // Find all elements under the mouse and calculate distances
    const candidates = [];

    for (const item of targetList) {
      const bounds = this.getElementBounds(item.element, targetType);
      if (this.isPointInBounds(event.clientX, event.clientY, bounds, item.element)) {
        // Calculate distance from mouse to center of element
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const distance = Math.sqrt(
          Math.pow(event.clientX - centerX, 2) +
          Math.pow(event.clientY - centerY, 2)
        );

        candidates.push({
          element: item.element,
          type: targetType,
          selection: item.selection,
          distance: distance,
          bounds: bounds,
          panelType: item.panelType // Include panel type for images
        });
      }
    }

    // If no candidates, return null
    if (candidates.length === 0) return null;

    // Sort by distance and return the closest one
    candidates.sort((a, b) => a.distance - b.distance);
    const closest = candidates[0];

    return {
      element: closest.element,
      type: closest.type,
      selection: closest.selection,
      panelType: closest.panelType // Pass panel type to caller
    };
  }

  getElementBounds(element, type) {
    // Use getBoundingClientRect directly - it handles all offsets automatically
    return element.getBoundingClientRect();
  }

  isPointInBounds(x, y, bounds, element) {
    // For SVG elements, check if point is actually inside the path
    if (element.tagName && element.tagName.toLowerCase() === 'svg') {
      const pathElement = element.querySelector('path');
      if (pathElement) {
        // Create a point in SVG coordinates
        const svgRect = element.getBoundingClientRect();
        const pt = element.createSVGPoint();
        pt.x = x - svgRect.left;
        pt.y = y - svgRect.top;

        // Check if point is in the path
        // Note: isPointInFill and isPointInStroke might not work in all browsers
        // So we also check a larger bounding area as fallback
        try {
          return pathElement.isPointInFill(pt) || pathElement.isPointInStroke(pt);
        } catch (e) {
          // Fallback: use path bounding box with some padding
          const pathBox = pathElement.getBBox();
          const padding = 10;
          const localX = pt.x;
          const localY = pt.y;
          return localX >= pathBox.x - padding &&
                 localX <= pathBox.x + pathBox.width + padding &&
                 localY >= pathBox.y - padding &&
                 localY <= pathBox.y + pathBox.height + padding;
        }
      }
    }

    // For regular elements (DIV rectangles), use bounding box
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  handleModalitySelected(modality) {
    // Hide modality selector
    const modalitySelector = this.shadowRoot.getElementById('modality-selector');
    modalitySelector.classList.remove('active');

    if (!this.pendingConnection) return;

    // Create connection with selected modality
    this.createConnectionBetween(this.pendingConnection.from, this.pendingConnection.to, modality);

    // Clean up
    this.pendingConnection = null;
    this.draggingFrom = null;
  }

  createConnectionBetween(from, to, modality = 'denotation', panelType = 'image') {
    // Determine which is text and which is image
    let textElement, textSelection, imageRect, imageSelection;

    if (from.type === 'text') {
      textElement = from.element;
      const textItem = this.unlinkedTextElements.find(t => t.element === from.element);
      textSelection = textItem?.selection;
      imageRect = to.element;
      const imageItem = this.unlinkedImageRects.find(i => i.element === to.element);
      imageSelection = imageItem?.selection;
    } else {
      textElement = to.element;
      const textItem = this.unlinkedTextElements.find(t => t.element === to.element);
      textSelection = textItem?.selection;
      imageRect = from.element;
      const imageItem = this.unlinkedImageRects.find(i => i.element === from.element);
      imageSelection = imageItem?.selection;
    }

    if (!textSelection || !imageSelection) return;

    // Check if this connection already exists
    const alreadyConnected = this.connections.some(conn =>
      conn.textElement === textElement && conn.imageRect === imageRect
    );

    if (alreadyConnected) {
      this.updateStatus('Already connected - choose different elements');
      return;
    }

    let annotation;

    // Create different annotation structures based on panel type
    if (panelType === 'facsimile') {
      // Simple Web Annotation for facsimile (transcription)
      annotation = {
        '@context': 'http://www.w3.org/ns/anno.jsonld',
        type: 'Annotation',
        id: `annotation-${Date.now()}`,
        motivation: 'transcribing', // Standard Web Annotation motivation
        body: {
          type: 'TextualBody',
          value: textSelection.text,
          format: 'text/plain',
          selector: textSelection.selector,
          // Include PAGE XML metadata if available
          lineId: textSelection.lineId || null,
          coords: textSelection.coords || null,
          pageNr: textSelection.pageNr || null
        },
        target: {
          type: 'Image',
          source: imageSelection.source,
          selector: imageSelection.selector,
          canvasId: imageSelection.canvasId || null,
          canvasIndex: imageSelection.canvasIndex !== undefined ? imageSelection.canvasIndex : null,
          canvasLabel: imageSelection.canvasLabel || null
        },
        created: new Date().toISOString()
      };

      // Use neutral color for transcription connections
      textElement.classList.add('transcription');
      imageRect.classList.add('transcription');

      // Draw connection line with transcription style
      this.drawConnectionLineBetween(textElement, imageRect, 'transcription');

    } else {
      // INTERIM/GEKO model for painting (ekphrastic analysis)
      const modalityProperty = {
        denotation: 'https://w3id.org/geko/denotation',
        dynamisation: 'https://w3id.org/geko/dynamisation',
        integration: 'https://w3id.org/geko/integration'
      }[modality];

      // Painting target (always present in the linking case).
      const paintingTarget = {
        type: 'SpecificResource',
        source: imageSelection.source,
        selector: imageSelection.selector,
        class: 'lrmoo:F1_Work', // LRMoo Work class
        canvasId: imageSelection.canvasId || null,
        canvasIndex: imageSelection.canvasIndex !== undefined ? imageSelection.canvasIndex : null,
        canvasLabel: imageSelection.canvasLabel || null
      };

      // Facsimile target (added when the text selection came from PAGE-XML,
      // see findPageXmlContext in iiif-text-panel.js). Anchors the
      // ekphrastic text to its physical region on the manuscript canvas.
      // When facsimile data is absent (plain-text / TEI source) we keep
      // the legacy single-target shape so existing consumers don't break.
      let targetField;
      if (textSelection.facsimileCanvasId && textSelection.xywh) {
        const { x, y, w, h } = textSelection.xywh;
        const facsimileTarget = {
          type: 'SpecificResource',
          source: textSelection.facsimileCanvasId,
          selector: {
            type: 'FragmentSelector',
            conformsTo: 'http://www.w3.org/TR/media-frags/',
            value: `xywh=${x},${y},${w},${h}`
          },
          class: 'lrmoo:F2_Expression', // the linguistic-expression realisation lives on the manuscript page
          lineId: textSelection.lineId || null,
          coords: textSelection.coords || null, // original PAGE-XML polygon, preserved
          pageNr: textSelection.pageNr || null
        };
        targetField = [facsimileTarget, paintingTarget];
      } else {
        // Backward-compatible single target — keep the original `type: 'Image'`
        // shape so any consumer that was relying on it keeps working.
        targetField = {
          ...paintingTarget,
          type: 'Image'
        };
      }

      annotation = {
        '@context': 'http://www.w3.org/ns/anno.jsonld',
        type: 'Annotation',
        id: `annotation-${Date.now()}`,
        motivation: 'linking',
        body: {
          type: 'TextualBody',
          value: textSelection.text,
          format: 'text/plain',
          selector: textSelection.selector,
          class: 'lrmoo:F2_Expression' // LRMoo Expression class
        },
        target: targetField,
        property: modalityProperty,
        modality: modality,
        created: new Date().toISOString()
      };

      // Apply modality color to both elements
      textElement.classList.add(modality);
      imageRect.classList.add(modality);

      // Draw permanent connection line with modality
      this.drawConnectionLineBetween(textElement, imageRect, modality);
    }

    // Push to the backend via the store. The visual rect/line are already
    // drawn at this point. The adapter (see _initStore) stamps the temp
    // IRI immediately onto the connection AND onto both endpoints' DOM
    // datasets, then upgrades to the real IRI when the POST settles.
    // Per the Phase 1 atomic-linking design (PHASE-1 §"Known limitations"),
    // a single mma annotation's IRI lives on three visual surfaces:
    // text mark, image rect, and connection line — deleting any one of
    // them tears the whole annotation down.
    const connection = this.connections[this.connections.length - 1];
    const payload = { ...annotation };
    delete payload.id;
    delete payload['@context'];
    delete payload.created;
    if (this.store) {
      this.store.create(this.container, payload, {
        connection,
        textElement,
        imageRect,
      })
        .then((saved) => {
          // Once the annotation has its real backend IRI, prompt the
          // user to attach an MLAO Anchor. Skip leaves it un-anchored.
          // panelType === 'facsimile' is the transcription path which
          // doesn't carry a modality — keep it un-prompted for now.
          if (panelType !== 'facsimile' && saved?.id) {
            this._openAnchorModal(saved.id, { modality, panelType });
          }
        })
        .catch(() => { /* toast */ });
    }

    // DON'T remove from unlinked lists - keep them draggable for multiple connections!
    // Elements stay draggable and can be connected multiple times

    // (The store-adapter re-emits 'annotation-created' downstream with the
    // saved annotation IRI; consumers should listen to that.)

    // Count connections for this text and image
    const textConnections = this.connections.filter(c => c.textElement === textElement).length;
    const imageConnections = this.connections.filter(c => c.imageRect === imageRect).length;

    if (panelType === 'facsimile') {
      this.updateStatus(`Transcription linked! (Text: ${textConnections} links, Facsimile: ${imageConnections} links)`);
    } else {
      this.updateStatus(`Connected via ${modality}! (Text: ${textConnections} links, Image: ${imageConnections} links)`);
    }
  }

  drawConnectionLineBetween(textElement, imageRect, modality = 'denotation') {
    // Get container bounds for relative positioning
    const container = this.shadowRoot.querySelector('.container');
    if (!container) return;
    const containerBounds = container.getBoundingClientRect();

    // Use getBoundingClientRect directly for both elements
    const textBounds = textElement.getBoundingClientRect();

    // For SVG elements, get the bounding box of the path, not the SVG container
    let imageBounds;
    if (imageRect.tagName && imageRect.tagName.toLowerCase() === 'svg') {
      const pathElement = imageRect.querySelector('path');
      if (pathElement) {
        // Get the tight bounding box of the path
        const bbox = pathElement.getBBox();
        const svgRect = imageRect.getBoundingClientRect();
        // Convert bbox to screen coordinates
        imageBounds = {
          left: svgRect.left + bbox.x,
          right: svgRect.left + bbox.x + bbox.width,
          top: svgRect.top + bbox.y,
          bottom: svgRect.top + bbox.y + bbox.height,
          width: bbox.width,
          height: bbox.height
        };
      } else {
        imageBounds = imageRect.getBoundingClientRect();
      }
    } else {
      imageBounds = imageRect.getBoundingClientRect();
    }

    // Calculate coordinates relative to container
    const startX = textBounds.right - containerBounds.left;
    const startY = textBounds.top - containerBounds.top + textBounds.height / 2;
    const endX = imageBounds.left - containerBounds.left;
    const endY = imageBounds.top - containerBounds.top + imageBounds.height / 2;

    const controlX1 = startX + (endX - startX) * 0.5;
    const controlY1 = startY;
    const controlX2 = startX + (endX - startX) * 0.5;
    const controlY2 = endY;

    const svg = this.shadowRoot.getElementById('connection-overlay');

    // Create path with modality class
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const pathData = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
    path.setAttribute('d', pathData);
    path.setAttribute('class', `connection-line ${modality}`);
    path.setAttribute('data-annotation', this.annotations.length - 1);

    // Create label for the connection (property name)
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    label.setAttribute('x', midX);
    label.setAttribute('y', midY - 5);
    label.setAttribute('class', 'connection-label');
    // Different label text for transcription vs ekphrastic modalities
    label.textContent = modality === 'transcription' ? 'transcribing' : `geko:${modality}`;

    // Add click listener to path for connection menu
    const connectionIndex = this.connections.length;
    path.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showConnectionMenu(e, connectionIndex);
    });

    svg.appendChild(path);
    svg.appendChild(label);

    this.connections.push({
      textElement: textElement,
      imageRect: imageRect,
      path: path,
      label: label,
      modality: modality,
      annotationIndex: this.annotations.length - 1
    });
  }

  updateStatus(message) {
    const status = this.shadowRoot.getElementById('status');
    status.textContent = message;
  }

  showConnectionMenu(event, connectionIndex) {
    const menu = this.shadowRoot.getElementById('connection-menu');
    const infoBtn = this.shadowRoot.getElementById('connection-info');
    const deleteBtn = this.shadowRoot.getElementById('connection-delete');

    // Store current connection index
    this.selectedConnectionIndex = connectionIndex;

    // Position menu near click
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.classList.add('active');

    // Remove old listeners
    infoBtn.onclick = null;
    deleteBtn.onclick = null;

    // Add new listeners
    infoBtn.onclick = () => this.showConnectionInfo(connectionIndex);
    deleteBtn.onclick = () => this.deleteConnection(connectionIndex);
  }

  hideConnectionMenu() {
    const menu = this.shadowRoot.getElementById('connection-menu');
    menu.classList.remove('active');
  }

  showConnectionInfo(connectionIndex) {
    const connection = this.connections[connectionIndex];
    if (!connection) return;

    // Prefer the store cache (post-T1.5b source of truth); fall back to
    // the legacy in-memory array index for any pre-store rows.
    const annotation = (this.store && connection.annotationIri
                          ? this.store.get(connection.annotationIri)
                          : null)
                       || this.annotations[connection.annotationIndex];
    if (annotation) {
      const value = annotation.body?.value || annotation.body?.[0]?.value || '';
      const canvasLabel = annotation.target?.canvasLabel
                          || annotation.target?.[0]?.canvasLabel
                          || 'Unknown';
      const created = annotation.created || annotation['dcterms:created'] || '';
      const info = `
Annotation Details:
- Modality: ${connection.modality}
- IRI: ${connection.annotationIri || '(no IRI yet — POST pending)'}
- Text: "${String(value).substring(0, 50)}${String(value).length > 50 ? '...' : ''}"
- Canvas: ${canvasLabel}
- Created: ${created ? new Date(created).toLocaleString() : '(unknown)'}
      `.trim();
      alert(info);
    }

    this.hideConnectionMenu();
  }

  deleteConnection(connectionIndex) {
    const connection = this.connections[connectionIndex];
    if (!connection) return;

    if (this.store && connection.annotationIri) {
      // Per the Phase 1 atomic-linking rule (CHANGELOG §"Known
      // limitations"), removing the connection line removes the whole
      // annotation — both endpoints AND the line. The 'annotation:removed'
      // listener in _initStore handles the centralized DOM cleanup; we
      // just trigger the delete here.
      this.store.remove(connection.annotationIri).catch(() => { /* toast */ });
    } else {
      // Pre-store / legacy fallback: clean up locally only.
      if (connection.path) connection.path.remove();
      if (connection.label) connection.label.remove();
      this.connections.splice(connectionIndex, 1);
      if (connection.annotationIndex !== undefined) {
        this.annotations.splice(connection.annotationIndex, 1);
      }
    }

    this.hideConnectionMenu();
    this.updateStatus('Connection deleted');
  }

  createAnnotation() {
    if (!this.selectedTextRange || !this.selectedImageRegion) return;

    const annotation = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'Annotation',
      id: `annotation-${Date.now()}`,
      motivation: 'linking',
      body: {
        type: 'TextualBody',
        value: this.selectedTextRange.text,
        format: 'text/plain',
        selector: this.selectedTextRange.selector
      },
      target: {
        type: 'Image',
        source: this.selectedImageRegion.source,
        selector: this.selectedImageRegion.selector
      },
      created: new Date().toISOString()
    };

    this.annotations.push(annotation);
    this.dispatchEvent(new CustomEvent('annotation-created', {
      detail: annotation,
      bubbles: true,
      composed: true
    }));

    // Confirm/persist the image rectangle
    const imagePanel = this.querySelector('iiif-image-panel') ||
                       this.shadowRoot.querySelector('slot[name="image-panel"]')?.assignedElements()[0];
    if (imagePanel && typeof imagePanel.confirmCurrentRect === 'function') {
      imagePanel.confirmCurrentRect();
    }

    // Draw connection line
    this.drawConnectionLine();

    this.updateStatus(`Annotation created (${this.annotations.length} total)`);
    this.selectedTextRange = null;
    this.selectedImageRegion = null;
    this.updateLinkButton();
  }

  createStandaloneAnnotation(selection, annotationType, body) {
    const annotation = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'Annotation',
      id: `annotation-${Date.now()}`,
      motivation: annotationType === 'comment' ? 'commenting' : 'tagging',
      body: {
        type: 'TextualBody',
        value: body,
        format: 'text/plain'
      },
      target: {
        type: 'Text',
        selector: selection.selector,
        source: selection.text
      },
      annotationType: annotationType,
      created: new Date().toISOString()
    };

    return annotation;
  }

  createStandaloneImageAnnotation(selection, annotationType, body) {
    const annotation = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'Annotation',
      id: `annotation-${Date.now()}`,
      motivation: annotationType === 'comment' ? 'commenting' : 'tagging',
      body: {
        type: 'TextualBody',
        value: body,
        format: 'text/plain'
      },
      target: {
        type: 'Image',
        source: selection.source,
        selector: selection.selector,
        canvasId: selection.canvasId || null,
        canvasIndex: selection.canvasIndex !== undefined ? selection.canvasIndex : null,
        canvasLabel: selection.canvasLabel || null
      },
      annotationType: annotationType,
      created: new Date().toISOString()
    };

    return annotation;
  }

  drawConnectionLine() {
    // Get text panel and image panel components
    const textPanel = this.querySelector('iiif-text-panel') ||
                      this.shadowRoot.querySelector('slot[name="text-panel"]')?.assignedElements()[0];
    const imagePanel = this.querySelector('iiif-image-panel') ||
                       this.shadowRoot.querySelector('slot[name="image-panel"]')?.assignedElements()[0];

    if (!textPanel || !imagePanel) return;

    // Find the LAST confirmed text element (the one just created)
    const allConfirmedTexts = textPanel.shadowRoot?.querySelectorAll('.text-confirmed');
    if (!allConfirmedTexts || allConfirmedTexts.length === 0) return;
    const textElement = allConfirmedTexts[allConfirmedTexts.length - 1];

    // Find the LAST confirmed image rectangle (the one just created)
    const allConfirmedRects = imagePanel.shadowRoot?.querySelectorAll('.selection-rect.confirmed');
    if (!allConfirmedRects || allConfirmedRects.length === 0) return;
    const imageRect = allConfirmedRects[allConfirmedRects.length - 1];

    // Get bounding rectangles relative to viewport
    const textBounds = textElement.getBoundingClientRect();

    // For image, we need to get the selection canvas position
    const selectionCanvas = imagePanel.shadowRoot?.querySelector('#selection-canvas');
    if (!selectionCanvas) return;

    const canvasBounds = selectionCanvas.getBoundingClientRect();

    // Calculate image region position from the confirmed rectangle
    const rectStyle = imageRect.style;
    const imageBounds = {
      left: canvasBounds.left + parseFloat(rectStyle.left),
      top: canvasBounds.top + parseFloat(rectStyle.top),
      width: parseFloat(rectStyle.width),
      height: parseFloat(rectStyle.height)
    };
    imageBounds.right = imageBounds.left + imageBounds.width;
    imageBounds.bottom = imageBounds.top + imageBounds.height;

    // Calculate connection points (viewport coordinates for position:fixed SVG)
    // Start: right edge, middle of text
    const startX = textBounds.right;
    const startY = textBounds.top + textBounds.height / 2;

    // End: left edge, middle of image region
    const endX = imageBounds.left;
    const endY = imageBounds.top + imageBounds.height / 2;

    // Control points for Bezier curve
    const controlX1 = startX + (endX - startX) * 0.5;
    const controlY1 = startY;
    const controlX2 = startX + (endX - startX) * 0.5;
    const controlY2 = endY;

    // Create SVG path
    const svg = this.shadowRoot.getElementById('connection-overlay');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    const pathData = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
    path.setAttribute('d', pathData);
    path.setAttribute('class', 'connection-line');
    path.setAttribute('data-annotation', this.annotations.length - 1);

    svg.appendChild(path);

    // Store connection for updating on scroll/resize
    this.connections.push({
      textElement: textElement,
      imageRect: imageRect,
      path: path,
      annotationIndex: this.annotations.length - 1
    });
  }

  /** Toggle the [MMA pagexml] diagnostic log on every text panel under
   *  this orchestrator. Invoke from DevTools when investigating
   *  PAGE-XML / facsimile-anchor regressions:
   *
   *    document.querySelector('multimodal-annotator').debugPageXml(true)
   *    document.querySelector('multimodal-annotator').debugPageXml(false)
   *
   *  No-op when no text panel is mounted. Returns the number of panels
   *  the flag was applied to. */
  debugPageXml(on = true) {
    const panels = this.shadowRoot.querySelectorAll('iiif-text-panel');
    panels.forEach((p) => { p._debugPageXml = !!on; });
    return panels.length;
  }

  exportAnnotations() {
    // Source of truth is the store cache after T1.5b. Fall back to the
    // in-memory mirror for any pre-store rows or store-not-yet-ready edge.
    const items = (this.store ? this.store.all() : null) || this.annotations;

    const annotationList = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'AnnotationCollection',
      label: `${APP_TITLE} export`,
      created: new Date().toISOString(),
      items,
    };

    const blob = new Blob([JSON.stringify(annotationList, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mma-annotations-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.updateStatus(`Exported ${items.length} annotation(s)`);
  }

  // ── GEKO v2 export (Task B) ─────────────────────────────────────────

  /**
   * Export annotations as a 3-level GEKO v2 collection:
   *
   *   AnnotationCollection
   *     └─ items[]: one geko:Ekphrasis per facsimile page
   *         └─ items[]: the member oa:Annotation objects of that page
   *
   * Grouping key: the `source` of each annotation's target with class
   * `lrmoo:F2_Expression` (the manuscript canvas). Annotations without
   * a facsimile target — plain-text / TEI / standalone — land in a
   * single "ungrouped" Ekphrasis with `mma:status mma:unanchored`
   * (chosen design vs. grouping by painting canvas: simpler, doesn't
   * fabricate a manuscript anchor that isn't there).
   *
   * GEKO v2 modality normalization on the way out (regardless of the
   * raw v1 spelling): `denotation`/`dynamisation`/`integration` →
   * `https://w3id.org/geko/#Denotation`/`#Dynamization`/`#Integration`
   * (capitalized, `#` fragment separator per the GEKO 2 ontology;
   * `dynamisation` → `Dynamization` with the z spelling pinned). The
   * legacy `modality` and `property` fields are dropped in favour of
   * a single `hasEkphrasticModality` skos:Concept reference.
   *
   * `hasAuthor`, `hasTextualReferent`, `hasIconicReferent` are
   * intentionally omitted on each Ekphrasis and an explicit
   * `rdfs:comment` flags the Phase 3 UI work that will fill them.
   */
  exportAnnotationsGeko() {
    const annotations = (this.store ? this.store.all() : null) || this.annotations;
    const baseNs = 'https://w3id.org/multimodal-annotator/ns/';
    const container = this.container || 'unknown';

    const groups = new Map();   // facsimileCanvasSource → [annotations]
    const ungrouped = [];
    for (const a of annotations) {
      const key = this._facsimileSource(a);
      if (key) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
      } else {
        ungrouped.push(a);
      }
    }

    const ekphrasisItems = [];
    for (const [facsimileSource, members] of groups) {
      const suffix = this._deriveEkphrasisSuffix(facsimileSource);
      ekphrasisItems.push({
        id: `${baseNs}ekphrases/${container}/${suffix}`,
        type: ['Ekphrasis', 'AnnotationPage'],
        label: { en: [`Ekphrasis on ${facsimileSource}`] },
        comment: 'to be filled via UI (Phase 3)',
        // hasAuthor / hasTextualReferent / hasIconicReferent intentionally
        // omitted — the Phase 3 provenance + referent UI populates them.
        items: members.map((m) => this._toGekoAnnotation(m)),
      });
    }
    if (ungrouped.length > 0) {
      ekphrasisItems.push({
        id: `${baseNs}ekphrases/${container}/ungrouped`,
        type: ['Ekphrasis', 'AnnotationPage'],
        label: { en: ['Annotations without a facsimile anchor'] },
        comment: 'these annotations have no PAGE-XML / facsimile source target (plain-text, TEI, or standalone); group them manually via the Phase 3 UI',
        items: ungrouped.map((m) => this._toGekoAnnotation(m)),
      });
    }

    // The exported file references the backend-served default context.
    // Phase 3 may switch to inlining the context for a self-contained
    // artefact; for now a URL keeps the export small and DRY.
    const contextUrl = `${this._backendUrlForExport()}/contexts/interim-geko.jsonld`;

    const collection = {
      '@context': contextUrl,
      type: 'AnnotationCollection',
      label: `${APP_TITLE} — GEKO Ekphrases`,
      created: new Date().toISOString(),
      items: ekphrasisItems,
    };

    // Defensive: replace any residual 'dynamisation' (s) with
    // 'dynamization' (z) per the GEKO v2 ontology. The internal model
    // still uses the legacy s-spelling in some classnames/CSS — the
    // export acts as the spelling boundary. Affects keys (e.g.
    // 'dynamisation' as a context vocab term that re-compacted) and
    // values (e.g. a geko:dynamisation IRI). Wrapped to match the
    // boundary cases only (case-sensitive, no broader matches).
    let payload = JSON.stringify(collection, null, 2);
    payload = payload.replace(/dynamisation/g, 'dynamization');

    const blob = new Blob([payload], { type: 'application/ld+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mma-geko-${Date.now()}.jsonld`;
    a.click();
    URL.revokeObjectURL(url);

    this.updateStatus(
      `Exported ${ekphrasisItems.length} Ekphrasis group(s) ` +
      `(${annotations.length} annotation(s) total)`
    );
  }

  /** Return the `source` IRI of the facsimile target of `annotation`,
   *  or null if none. Discriminates by `lrmoo:F2_Expression` class on
   *  the target's type array (or full IRI suffix, post-round-trip). */
  _facsimileSource(annotation) {
    const targets = Array.isArray(annotation.target)
      ? annotation.target
      : [annotation.target].filter(Boolean);
    for (const t of targets) {
      if (this._isFacsimileTarget(t) && t.source) return t.source;
    }
    return null;
  }

  _isFacsimileTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const tail = (v) => /(?:^|[#\/:])F2_Expression$/.test(String(v));
    if (Array.isArray(target.type)) return target.type.some(tail);
    if (target.type) return tail(target.type);
    // The pre-round-trip cache entry might still carry `class` instead of `type`.
    if (target.class) return tail(target.class);
    return false;
  }

  _deriveEkphrasisSuffix(facsimileCanvasSource) {
    if (!facsimileCanvasSource) return 'unknown';
    // Use the last path segment of the canvas IRI, sanitised.
    const stripped = facsimileCanvasSource.replace(/[?#].*$/, '');
    const tail = stripped.split('/').filter(Boolean).pop() || 'unknown';
    return tail.replace(/[^A-Za-z0-9_-]/g, '') || 'unknown';
  }

  /** Convert a raw cached annotation into its GEKO v2 export shape:
   *  - drop `@context` (the outer collection's applies)
   *  - drop the legacy `modality` / `property` / `annotationType` fields
   *    (`annotationType` is an mma:-internal scratch field that has no
   *    place in a GEKO export)
   *  - strip `lrmoo:F2_Expression` from the body's `type` array — in
   *    GEKO v2 the textual referent is declared on the Ekphrasis via
   *    `hasTextualReferent`, not on each annotation's body. The body
   *    type narrows to plain `TextualBody` to match the Bocchi
   *    reference. The cache and the persisted RDF graph are
   *    intentionally untouched; the strip happens only on the export
   *    path.
   *  - emit a single `hasEkphrasticModality` skos:Concept reference
   *    using the v2 IRI shape (lowercase local part, `#` fragment;
   *    z-spelling for `dynamization`).
   */
  _toGekoAnnotation(annotation) {
    const {
      '@context': _ctx,
      modality,
      property,
      annotationType: _annType,
      body,
      ...rest
    } = annotation;
    const out = { ...rest };

    if (body) out.body = this._cleanGekoBody(body);

    const mod = this._normalizeModality(modality || property);
    if (mod) {
      out.hasEkphrasticModality = {
        id: mod.iri,
        type: 'skos:Concept',
        label: { en: [mod.label] },
      };
    }

    // MLAO Anchor block. Cleans the stamped cache entry into the
    // export shape. IRIs are EXPANDED to absolute form (the poster
    // artefact must be self-describing — no CURIEs leaking out).
    // Wikidata target → string IRI (JSON-LD context declares
    // isAnchoredTo as @type: @id). Custom entity target → embedded
    // object carrying the entity's type + label so the export is
    // self-describing (otherwise the entity description would only
    // live in the RDF graph). hasConceptualLevel is optional.
    const a = annotation.hasAnchor;
    if (a && a.isAnchoredTo) {
      const anchorOut = { type: 'Anchor' };
      if (a.isCustomEntity) {
        anchorOut.isAnchoredTo = {
          id:    this._expandPrefix(a.isAnchoredTo),
          type:  this._expandPrefix(a.entityClass || 'crm:E1_Entity'),
          ...(a.isAnchoredToLabel ? { label: { en: [a.isAnchoredToLabel] } } : {}),
        };
      } else {
        anchorOut.isAnchoredTo = this._expandPrefix(a.isAnchoredTo);
      }
      if (a.hasConceptualLevel) {
        anchorOut.hasConceptualLevel = this._expandPrefix(a.hasConceptualLevel);
      }
      out.hasAnchor = anchorOut;
    }

    return out;
  }

  /** Expand a `prefix:local` CURIE to its absolute IRI using the
   *  EXPORT_PREFIX_MAP. Absolute URLs and unknown prefixes pass
   *  through unchanged so foreign values aren't silently mangled. */
  _expandPrefix(value) {
    if (typeof value !== 'string' || !value) return value;
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    const colon = value.indexOf(':');
    if (colon <= 0) return value;
    const prefix = value.slice(0, colon);
    const local  = value.slice(colon + 1);
    const ns = EXPORT_PREFIX_MAP[prefix];
    return ns ? ns + local : value;
  }

  /** Strip the LRMoo class (`F2_Expression`) from `body.type` for the
   *  GEKO export. If the remaining type list collapses to a single
   *  value, emit it as a string (matches the Bocchi reference); a
   *  multi-value list stays as an array. */
  _cleanGekoBody(body) {
    if (!body || typeof body !== 'object') return body;
    const out = { ...body };
    const isF2 = (v) => /(?:^|[#\/:])F2_Expression$/.test(String(v));
    if (Array.isArray(out.type)) {
      const kept = out.type.filter((v) => !isF2(v));
      if (kept.length === 0) {
        // Pathological case: body was typed *only* as F2_Expression.
        // Fall back to plain TextualBody so the export still validates.
        out.type = 'TextualBody';
      } else if (kept.length === 1) {
        out.type = kept[0];
      } else {
        out.type = kept;
      }
    } else if (typeof out.type === 'string' && isF2(out.type)) {
      out.type = 'TextualBody';
    }
    return out;
  }

  /** Map a raw modality token / property IRI to its GEKO v2 form.
   *  IRI local parts are lowercase per the GEKO 2 ontology
   *  (`#denotation`, `#dynamization`, `#integration`); capitalization
   *  lives only on the `prefLabel` / `label`. The `dynamization` (z)
   *  spelling is forced regardless of the raw `dynamisation` (s). */
  _normalizeModality(token) {
    if (!token) return null;
    const key = String(token).toLowerCase().split(/[#\/]/).pop();
    const map = {
      denotation:    { iri: 'https://w3id.org/geko/#denotation',   label: 'Denotation' },
      dynamisation:  { iri: 'https://w3id.org/geko/#dynamization', label: 'Dynamization' },
      dynamization:  { iri: 'https://w3id.org/geko/#dynamization', label: 'Dynamization' },
      integration:   { iri: 'https://w3id.org/geko/#integration',  label: 'Integration' },
    };
    return map[key] || null;
  }

  /** Best-effort backend URL for the @context reference in the export.
   *  Uses the orchestrator's configured backend URL if available,
   *  otherwise the runtime default. */
  _backendUrlForExport() {
    return (this.getAttribute('backend-url')
            || 'http://localhost:8000').replace(/\/$/, '');
  }

  getAnnotations() {
    return this.store ? this.store.all() : this.annotations;
  }

  loadAnnotations(annotations) {
    this.annotations = Array.isArray(annotations) ? annotations : [];
    this.updateStatus(`Loaded ${this.annotations.length} annotations`);
  }

  // Panel management methods
  initializePanels() {
    // Initialize with default panels if no panels are defined.
    // Layout order (left → right): Transcription, Visual Work, Facsimile.
    // Visual Work sits next to Transcription so the cross-modal
    // linking flow (the demo's main artefact) is the visually
    // adjacent pair; Facsimile is the supporting page reference.
    if (this.panels.length === 0) {
      // Text panel with PAGE XML transcriptions (Transkribus)
      this.addPanel('text', {
        label: 'Transcription',
        mets: '/examples/mets.xml',
        pagexml: '/examples/page/0018_00018.xml' // Load page 18 as default (page with content)
      });

      // Image panel with Europeana manifest (the ekphrastic target)
      this.addPanel('image', {
        label: 'Visual Work',
        manifest: 'https://iiif.europeana.eu/presentation/366/item_7PWBIM2OZFXYT5ZC5Y7IFXBZSNB7TOZ6/manifest'
      });

      // Facsimile panel with IIIF manuscript (Quaderno Raimondi - Università di Bologna)
      this.addPanel('facsimile', {
        label: 'Facsimile',
        manifest: 'https://dl.ficlit.unibo.it/iiif/2/19266/manifest'
      });
    }
  }

  openAddPanelModal() {
    const modal = this.shadowRoot.getElementById('add-panel-modal');
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    modal.classList.add('active');
    overlay.classList.add('active');
  }

  closeAddPanelModal() {
    const modal = this.shadowRoot.getElementById('add-panel-modal');
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    modal.classList.remove('active');
    overlay.classList.remove('active');
  }

  openAboutModal() {
    const modal = this.shadowRoot.getElementById('about-modal');
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    modal.classList.add('active');
    overlay.classList.add('active');
  }

  closeAboutModal() {
    const modal = this.shadowRoot.getElementById('about-modal');
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    modal.classList.remove('active');
    overlay.classList.remove('active');
  }

  addPanel(type, config = {}) {
    const id = `panel-${this.panelIdCounter++}`;
    const panel = {
      id,
      type,
      label: config.label || this.getPanelLabel(type),
      config: config // Store additional configuration
    };

    this.panels.push(panel);
    this.renderPanels();
    this.updateStatus(`Added ${panel.label}`);
  }

  removePanel(id) {
    this.panels = this.panels.filter(p => p.id !== id);
    this.renderPanels();
    this.updateStatus(`Panel removed`);
  }

  getPanelLabel(type) {
    const labels = {
      text: 'Text',
      image: 'Image',
      facsimile: 'Facsimile'
    };
    return labels[type] || type;
  }

  getPanelIcon(type) {
    const icons = {
      text: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12"/><line x1="4" y1="5" x2="12" y2="5"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="11" x2="9" y2="11"/></svg>',
      image: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12"/><circle cx="6" cy="6" r="1.5"/><polyline points="14,14 10,8 6,12 2,10"/></svg>',
      facsimile: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3,2 L10,2 L13,5 L13,14 L3,14 Z"/><polyline points="10,2 10,5 13,5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="10" x2="11" y2="10"/><line x1="5" y1="12" x2="9" y2="12"/></svg>'
    };
    return icons[type] || '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12"/></svg>';
  }

  renderPanels() {
    const panelsArea = this.shadowRoot.getElementById('panels-area');
    const panelList = this.shadowRoot.getElementById('panel-list');

    // Clear existing panels
    panelsArea.innerHTML = '';
    panelList.innerHTML = '';

    // Render each panel
    this.panels.forEach((panel, index) => {
      // Create panel in main area
      const panelDiv = document.createElement('div');
      panelDiv.className = 'panel';
      panelDiv.id = panel.id;

      // Create header
      const header = document.createElement('div');
      header.className = 'panel-header';
      header.draggable = true;
      header.dataset.panelId = panel.id;

      const title = document.createElement('span');
      title.className = `panel-title panel-type-${panel.type}`;
      title.innerHTML = `${this.getPanelIcon(panel.type)} ${panel.label}`;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'close-panel';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removePanel(panel.id);
      });

      header.appendChild(title);
      header.appendChild(closeBtn);

      // Drag and drop event listeners
      header.addEventListener('dragstart', (e) => this.handlePanelDragStart(e, panel.id));
      header.addEventListener('dragend', (e) => this.handlePanelDragEnd(e));

      panelDiv.addEventListener('dragover', (e) => this.handlePanelDragOver(e));
      panelDiv.addEventListener('dragleave', (e) => this.handlePanelDragLeave(e));
      panelDiv.addEventListener('drop', (e) => this.handlePanelDrop(e, panel.id));

      // Create content
      const content = document.createElement('div');
      content.className = 'panel-content';

      // Create the actual panel component
      const panelComponent = this.createPanelElement(panel.type, panel.config);
      content.appendChild(panelComponent);

      panelDiv.appendChild(header);
      panelDiv.appendChild(content);

      panelsArea.appendChild(panelDiv);

      // Set text content after appending (for text panels with initial text)
      if (panel.type === 'text' && panel.config.text) {
        setTimeout(() => {
          if (panelComponent && typeof panelComponent.setTextContent === 'function') {
            panelComponent.setTextContent(panel.config.text);
          }
        }, 50);
      }

      // Attach scroll listeners to the new panel
      setTimeout(() => {
        if (content) {
          content.addEventListener('scroll', this.updateConnectionsHandler);
          content.addEventListener('wheel', this.updateConnectionsHandler, { passive: true });
        }

        // Attach listeners to inner scrollable areas
        if (panel.type === 'text' && panelComponent?.shadowRoot) {
          const textArea = panelComponent.shadowRoot.querySelector('.text-area');
          if (textArea) {
            textArea.addEventListener('scroll', this.updateConnectionsHandler);
            textArea.addEventListener('wheel', this.updateConnectionsHandler, { passive: true });
          }
        } else if ((panel.type === 'image' || panel.type === 'facsimile') && panelComponent?.shadowRoot) {
          const viewerContainer = panelComponent.shadowRoot.querySelector('.viewer-container');
          if (viewerContainer) {
            viewerContainer.addEventListener('scroll', this.updateConnectionsHandler);
            viewerContainer.addEventListener('wheel', this.updateConnectionsHandler, { passive: true });
          }
        }
      }, 100);

      // Create sidebar item
      const sidebarItem = document.createElement('div');
      sidebarItem.className = 'panel-item';
      sidebarItem.title = panel.label;
      sidebarItem.innerHTML = `
        ${this.getPanelIcon(panel.type)}
        <span class="remove-btn" data-id="${panel.id}">×</span>
      `;

      // Add remove handler
      const removeBtn = sidebarItem.querySelector('.remove-btn');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removePanel(panel.id);
      });

      panelList.appendChild(sidebarItem);
    });
  }

  createPanelElement(type, config = {}) {
    if (type === 'text') {
      const panel = document.createElement('iiif-text-panel');
      if (config.src) {
        panel.setAttribute('src', config.src);
      }
      if (config.mets) {
        panel.setAttribute('mets', config.mets);
      }
      if (config.pagexml) {
        panel.setAttribute('pagexml', config.pagexml);
      }
      return panel;
    } else if (type === 'image' || type === 'facsimile') {
      const panel = document.createElement('iiif-image-panel');
      if (config.tileSources) {
        panel.setAttribute('tileSources', config.tileSources);
      }
      if (config.manifest) {
        panel.setAttribute('manifest', config.manifest);
      }
      // Set panel-type attribute so the panel knows what it is
      panel.setAttribute('panel-type', type);
      return panel;
    }

    const placeholder = document.createElement('div');
    placeholder.style.padding = '2rem';
    placeholder.style.textAlign = 'center';
    placeholder.style.color = '#999';
    placeholder.textContent = 'Panel content';
    return placeholder;
  }

  // Panel drag and drop methods
  handlePanelDragStart(event, panelId) {
    this.draggingPanelId = panelId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', panelId);

    // Add dragging class to panel
    const panelDiv = this.shadowRoot.getElementById(panelId);
    if (panelDiv) {
      setTimeout(() => panelDiv.classList.add('dragging'), 0);
    }
  }

  handlePanelDragEnd(event) {
    this.draggingPanelId = null;

    // Remove dragging class from all panels
    const panels = this.shadowRoot.querySelectorAll('.panel');
    panels.forEach(panel => {
      panel.classList.remove('dragging');
      panel.classList.remove('drag-over');
    });
  }

  handlePanelDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const panelDiv = event.currentTarget;
    if (panelDiv.id !== this.draggingPanelId) {
      panelDiv.classList.add('drag-over');
    }
  }

  handlePanelDragLeave(event) {
    const panelDiv = event.currentTarget;
    panelDiv.classList.remove('drag-over');
  }

  handlePanelDrop(event, targetPanelId) {
    event.preventDefault();
    event.stopPropagation();

    const panelDiv = event.currentTarget;
    panelDiv.classList.remove('drag-over');

    if (!this.draggingPanelId || this.draggingPanelId === targetPanelId) {
      return;
    }

    // Find indices
    const draggedIndex = this.panels.findIndex(p => p.id === this.draggingPanelId);
    const targetIndex = this.panels.findIndex(p => p.id === targetPanelId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Reorder panels array
    const [draggedPanel] = this.panels.splice(draggedIndex, 1);
    this.panels.splice(targetIndex, 0, draggedPanel);

    // Re-render panels
    this.renderPanels();
    this.updateStatus('Panels reordered');
  }

  showGlobalCommentSidebar(type, onCancel, onSave) {
    const sidebar = this.shadowRoot.getElementById('annotation-sidebar');
    const backdrop = this.shadowRoot.getElementById('sidebar-backdrop');

    sidebar.innerHTML = `
      <div class="annotation-sidebar-header">
        <span>Add Comment</span>
        <button class="annotation-sidebar-close">
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="annotation-sidebar-content">
        <textarea placeholder="Enter your comment..." id="global-comment-textarea"></textarea>
      </div>
      <div class="annotation-sidebar-buttons">
        <button id="global-comment-cancel">Cancel</button>
        <button id="global-comment-save">Save</button>
      </div>
    `;

    // Show sidebar and backdrop
    setTimeout(() => {
      sidebar.classList.add('visible');
      backdrop.classList.add('visible');
    }, 10);

    const textarea = sidebar.querySelector('#global-comment-textarea');
    const closeBtn = sidebar.querySelector('.annotation-sidebar-close');
    const cancelBtn = sidebar.querySelector('#global-comment-cancel');
    const saveBtn = sidebar.querySelector('#global-comment-save');

    textarea.focus();

    const closeSidebar = () => {
      sidebar.classList.remove('visible');
      backdrop.classList.remove('visible');
      document.removeEventListener('keydown', onEsc);
      setTimeout(() => {
        sidebar.innerHTML = '';
      }, 300);
    };
    const cancel = () => { closeSidebar(); if (onCancel) onCancel(); };
    const onEsc = (e) => { if (e.key === 'Escape') cancel(); };
    document.addEventListener('keydown', onEsc);

    backdrop.addEventListener('click', cancel);
    closeBtn.addEventListener('click', cancel);
    cancelBtn.addEventListener('click', cancel);

    saveBtn.addEventListener('click', () => {
      const comment = textarea.value.trim();
      if (!comment) return;
      closeSidebar();
      if (onSave) onSave(comment);
    });
  }

  showGlobalAnnotationInfo(title, message, onDelete, onEditAnchor = null) {
    const sidebar = this.shadowRoot.getElementById('annotation-sidebar');
    const backdrop = this.shadowRoot.getElementById('sidebar-backdrop');

    // Escape title (display text), let message through as HTML so
    // callers can pass structured content (<p> blocks etc). Callers
    // are responsible for escaping user-supplied values inside the
    // message — iiif-text-panel.showAnnotationInfo does this for
    // comment bodies.
    const escapeTitle = (s) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const editAnchorBtnHtml = onEditAnchor
      ? `<button id="global-annotation-edit-anchor">Edit anchor</button>`
      : '';

    sidebar.innerHTML = `
      <div class="annotation-sidebar-header">
        <span>${escapeTitle(title)}</span>
        <button class="annotation-sidebar-close" aria-label="Close">
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="annotation-sidebar-content">${message}</div>
      <div class="annotation-sidebar-buttons">
        ${editAnchorBtnHtml}
        <button class="delete-btn" id="global-annotation-delete">Delete</button>
      </div>
    `;

    // Show sidebar and backdrop
    setTimeout(() => {
      sidebar.classList.add('visible');
      backdrop.classList.add('visible');
    }, 10);

    const closeBtn = sidebar.querySelector('.annotation-sidebar-close');
    const deleteBtn = sidebar.querySelector('#global-annotation-delete');

    const closeSidebar = () => {
      sidebar.classList.remove('visible');
      backdrop.classList.remove('visible');
      document.removeEventListener('keydown', onEsc);
      setTimeout(() => {
        sidebar.innerHTML = '';
      }, 300);
    };

    const onEsc = (e) => { if (e.key === 'Escape') closeSidebar(); };
    document.addEventListener('keydown', onEsc);

    // Backdrop click + X close
    backdrop.addEventListener('click', closeSidebar);
    closeBtn.addEventListener('click', closeSidebar);

    deleteBtn.addEventListener('click', () => {
      closeSidebar();
      if (onDelete) onDelete();
    });

    const editAnchorBtn = sidebar.querySelector('#global-annotation-edit-anchor');
    if (editAnchorBtn && onEditAnchor) {
      editAnchorBtn.addEventListener('click', () => {
        closeSidebar();
        onEditAnchor();
      });
    }
  }
}

// Primary registration: the canonical Phase 1 tag.
customElements.define('multimodal-annotator', IIIFInterimAnnotator);

// Deprecated alias kept for backwards compatibility. A subclass is required because
// a single class cannot be registered under two tag names. Removed in Phase 3 (ADR 0001).
class IIIFInterimAnnotatorDeprecated extends IIIFInterimAnnotator {
  constructor() {
    super();
    console.warn(
      '<iiif-interim-annotator> is deprecated; use <multimodal-annotator> instead. ' +
      'The alias will be removed in Phase 3 (see docs/adr/0001-rebrand-multimodal.md).'
    );
  }
}
customElements.define('iiif-interim-annotator', IIIFInterimAnnotatorDeprecated);
