/**
 * Convert a PAGE-XML polygon points string ("x,y x,y x,y …") to a
 * bounding-box {x, y, w, h} (Media Fragments xywh-compatible). Returns
 * `null` if the input is empty or has no parseable numeric pair.
 */
function polygonToXywh(pointsString) {
  if (!pointsString || typeof pointsString !== 'string') return null;
  const pairs = pointsString.trim().split(/\s+/);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pair of pairs) {
    const idx = pair.indexOf(',');
    if (idx < 0) continue;
    const x = parseInt(pair.slice(0, idx), 10);
    const y = parseInt(pair.slice(idx + 1), 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Walk up the DOM from `node` to find the closest PAGE-XML line container
 * (a `<div data-line-id data-coords>`) and the page container above it
 * (the wrapper that carries `data-page-nr`). Returns `null` when the
 * selection doesn't live under PAGE-XML structure (plain-text / TEI source).
 */
function findPageXmlContext(node) {
  let el = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentNode;
  let lineEl = null;
  let containerEl = null;
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    if (!lineEl && el.dataset && el.dataset.lineId) lineEl = el;
    if (!containerEl && el.dataset && el.dataset.pageNr) containerEl = el;
    if (lineEl && containerEl) break;
    el = el.parentNode;
  }
  if (!lineEl) return null;
  return {
    lineId: lineEl.dataset.lineId || null,
    coords: lineEl.dataset.coords || null,
    pageNr: containerEl?.dataset?.pageNr || null,
  };
}

/**
 * Text panel component for displaying and selecting text portions
 * Supports word-level and character-level selection
 * Supports PAGE XML format (Transkribus)
 */
export class IIIFTextPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.textContent = '';
    this.annotations = [];
    this.currentSelection = null;
    this.currentSelectionElement = null;
    this.confirmedElements = []; // Store all confirmed (green) text elements for current page
    this.pageContainers = {}; // Store page containers by page number: { pageNr: containerElement }
    this.pageXMLData = null; // Store parsed PAGE XML data
    this.currentPageNr = null; // Current page number
    this.metsData = null; // METS file data for page mapping
    this.currentFacsimileCanvasId = null; // T1.4+ — last facsimile canvas IRI seen via the canvas-changed bus; used to anchor PAGE-XML selections back to their physical page on the manuscript.
    this._debugPageXml = false; // Toggle from DevTools to surface [MMA pagexml] traces; see _pageXmlLog().
  }

  static get observedAttributes() {
    return ['src', 'text', 'pagexml', 'mets'];
  }

  async connectedCallback() {
    this.render();
    this.setupEventListeners();

    // Load METS first if provided (wait for it)
    if (this.hasAttribute('mets')) {
      await this.loadMETS(this.getAttribute('mets'));
    }

    // Then load text/PAGE XML
    if (this.hasAttribute('src')) {
      this.loadTextFromUrl(this.getAttribute('src'));
    } else if (this.hasAttribute('text')) {
      this.setTextContent(this.getAttribute('text'));
    } else if (this.hasAttribute('pagexml')) {
      this.loadPageXML(this.getAttribute('pagexml'));
    }

    // canvas-changed subscription happens synchronously in
    // setupEventListeners() above. The historical 500ms setTimeout
    // here caused the facsimile panel's initial dispatch (from
    // loadCanvasByIndex during loadManifest) to land BEFORE the
    // listener was attached, so currentFacsimileCanvasId stayed null
    // and Task A's dual-target capture silently fell back to
    // single-target. Fix verified 2026-05-27 (logs showed pageXmlCtx
    // OK but facsimileCanvasId=null at first selection post-load).
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === 'src') {
      this.loadTextFromUrl(newValue);
    } else if (name === 'text') {
      this.setTextContent(newValue);
    } else if (name === 'pagexml') {
      this.loadPageXML(newValue);
    } else if (name === 'mets') {
      this.loadMETS(newValue);
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          background: var(--mma-bg-base, #14161c);
          color: var(--mma-text-primary, #e8e6f0);
          /* Legacy aliases — values inherit from the orchestrator's :host
             when this panel is hosted inside <multimodal-annotator>;
             fallbacks keep the dark theme working in standalone use. */
          --color-black:    var(--mma-bg-elevated, #1a1d26);
          --color-white:    var(--mma-text-primary, #e8e6f0);
          --color-gray-200: var(--mma-border, rgba(255,255,255,0.07));
          --color-gray-700: var(--mma-text-muted, #9a9cab);
          --spacing-unit:   8px;
        }

        .container {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .controls {
          padding: 8px 12px;
          border-bottom: 1px solid var(--mma-border, rgba(255,255,255,0.07));
          background: var(--mma-bg-base, #14161c);
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }

        input[type="file"] {
          display: none;
        }

        .file-upload-btn {
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          border-radius: 6px;
          background: var(--mma-surface-soft, rgba(255,255,255,0.04));
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.12s ease;
        }

        .file-upload-btn svg {
          width: 15px;
          height: 15px;
          stroke: var(--mma-text-muted, #9a9cab);
          fill: none;
          stroke-width: 1.6;
          transition: stroke 0.12s ease;
        }

        .file-upload-btn:hover {
          background: var(--mma-surface-hover, rgba(255,255,255,0.08));
        }

        .file-upload-btn:hover svg {
          stroke: var(--mma-text-primary, #e8e6f0);
        }

        .text-area {
          flex: 1;
          padding: 18px 22px 26px;
          overflow-y: auto;
          /* Spectral on purpose — humanistic prose (manuscript
             transcription), not UI text. The token --mma-font-serif
             is set on the parent component's :host and inherits down
             through the shadow boundary, so theme/font changes here
             follow the parent automatically. */
          font-family: var(--mma-font-serif, Spectral, Georgia, serif);
          line-height: 1.9;
          font-size: 14.5px;
          font-weight: 400;
          color: var(--mma-text-body);
          background: var(--mma-bg-base);
          user-select: text;
        }

        /* Highlights are computed from --mma-mod-* tokens via color-mix
           so they swap automatically when the host's theme attribute
           flips (dark↔light). The token values are defined on the
           parent component and inherit through the shadow boundary. */

        .text-area::selection {
          background: color-mix(in srgb, var(--mma-accent) 28%, transparent);
          color: var(--mma-text-primary);
        }

        /* Pending highlight while the user is choosing what to do
           with the selection. Once confirmed it morphs into the
           underline style of .text-confirmed. */
        .text-selected {
          background: color-mix(in srgb, var(--mma-accent) 20%, transparent);
          color: inherit;
          cursor: pointer;
          padding: 0 1px;
          border-bottom: 1.5px dashed var(--mma-accent-border);
        }
        .text-selected:hover {
          background: color-mix(in srgb, var(--mma-accent) 28%, transparent);
        }

        /* Confirmed annotation — accent underline, not a solid box.
           Reads as scholarly mark-up over the manuscript text. */
        .text-confirmed {
          background: var(--mma-accent-bg);
          color: inherit;
          cursor: grab;
          padding: 0 1px;
          border-bottom: 1.5px solid var(--mma-accent);
          position: relative;
          transition: background 0.15s ease;
        }
        .text-confirmed:hover {
          background: color-mix(in srgb, var(--mma-accent) 32%, transparent);
        }
        .text-confirmed:active { cursor: grabbing; }

        /* Modality-specific underline + tint — all derived from the
           --mma-mod-* tokens, so they re-paint on theme switch. */
        .text-confirmed.denotation {
          background: color-mix(in srgb, var(--mma-mod-denotation) 20%, transparent);
          border-bottom-color: var(--mma-mod-denotation);
        }
        .text-confirmed.denotation:hover {
          background: color-mix(in srgb, var(--mma-mod-denotation) 32%, transparent);
        }

        .text-confirmed.dynamisation {
          background: color-mix(in srgb, var(--mma-mod-dynamization) 22%, transparent);
          border-bottom-color: var(--mma-mod-dynamization);
        }
        .text-confirmed.dynamisation:hover {
          background: color-mix(in srgb, var(--mma-mod-dynamization) 34%, transparent);
        }

        .text-confirmed.integration {
          background: color-mix(in srgb, var(--mma-mod-integration) 22%, transparent);
          border-bottom-color: var(--mma-mod-integration);
        }
        .text-confirmed.integration:hover {
          background: color-mix(in srgb, var(--mma-mod-integration) 34%, transparent);
        }

        .text-confirmed.transcription {
          background: color-mix(in srgb, var(--mma-mod-dynamization) 18%, transparent);
          border-bottom-color: var(--mma-mod-dynamization);
          border-bottom-style: dashed;
        }
        .text-confirmed.transcription:hover {
          background: color-mix(in srgb, var(--mma-mod-dynamization) 28%, transparent);
        }

        /* (annotation-info popup CSS removed — popup is now rendered
           by the orchestrator's global annotation-sidebar, themed
           uniformly with the rest of the UI.) */

        button {
          width: 32px;
          height: 32px;
          padding: 0;
          border: 1px solid var(--color-gray-200);
          border-radius: 0;
          background: var(--color-white);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: none;
        }

        button svg {
          width: 18px;
          height: 18px;
          stroke: var(--color-black);
          fill: none;
          stroke-width: 1.5;
        }

        button:hover:not(:disabled) {
          background: var(--color-black);
          border-color: var(--color-black);
        }

        button:hover:not(:disabled) svg {
          stroke: var(--color-white);
        }

        button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .info {
          font-size: 11px;
          color: var(--mma-text-faint, #5a5c69);
          width: 100%;
          flex-basis: 100%;
          margin-top: 4px;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
        }

        /* Annotation type selector */
        .annotation-type-selector {
          display: inline-flex;
          gap: 4px;
          margin-left: 8px;
          vertical-align: middle;
          position: relative;
        }

        .annotation-type-btn {
          width: 24px;
          height: 24px;
          border: 1px solid var(--color-black);
          background: var(--color-white);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          padding: 0;
        }

        .annotation-type-btn svg {
          width: 14px;
          height: 14px;
          stroke: var(--color-black);
          fill: none;
          stroke-width: 1.5;
        }

        .annotation-type-btn:hover {
          background: var(--color-black);
          transform: scale(1.1);
        }

        .annotation-type-btn:hover svg {
          stroke: var(--color-white);
        }

        .annotation-type-btn.delete {
          border-color: #f44336;
        }

        .annotation-type-btn.delete svg {
          stroke: #f44336;
        }

        .annotation-type-btn.delete:hover {
          background: #f44336;
        }

        .annotation-type-btn.delete:hover svg {
          stroke: var(--color-white);
        }

        /* Comment sidebar */
        .comment-sidebar {
          position: fixed;
          top: 0;
          right: 0;
          width: 350px;
          height: 100vh;
          background: var(--color-white);
          border-left: 2px solid var(--color-black);
          z-index: 10000;
          transform: translateX(100%);
          transition: transform 0.3s ease;
          display: flex;
          flex-direction: column;
        }

        .comment-sidebar.visible {
          transform: translateX(0);
        }

        .comment-sidebar-header {
          padding: calc(var(--spacing-unit) * 2);
          border-bottom: 1px solid var(--color-gray-200);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
        }

        .comment-sidebar-close {
          width: 24px;
          height: 24px;
          border: 1px solid var(--color-black);
          background: var(--color-white);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        .comment-sidebar-close svg {
          width: 14px;
          height: 14px;
          stroke: var(--color-black);
          fill: none;
          stroke-width: 1.5;
        }

        .comment-sidebar-close:hover {
          background: var(--color-black);
        }

        .comment-sidebar-close:hover svg {
          stroke: var(--color-white);
        }

        .comment-sidebar-content {
          flex: 1;
          padding: calc(var(--spacing-unit) * 2);
          overflow-y: auto;
        }

        .comment-sidebar textarea {
          width: 100%;
          min-height: 150px;
          border: 1px solid var(--color-gray-200);
          padding: calc(var(--spacing-unit) * 1.5);
          font-family: inherit;
          font-size: 0.9rem;
          resize: vertical;
        }

        .comment-sidebar-buttons {
          padding: calc(var(--spacing-unit) * 2);
          border-top: 1px solid var(--color-gray-200);
          display: flex;
          gap: calc(var(--spacing-unit) * 1);
          justify-content: flex-end;
        }

        .comment-sidebar button {
          width: auto;
          padding: calc(var(--spacing-unit) * 1) calc(var(--spacing-unit) * 2);
        }
      </style>

      <div class="container">
        <div class="controls">
          <input type="file" id="file-input" accept=".txt,.xml,.html" />
          <label for="file-input" class="file-upload-btn" title="Upload text/XML file">
            <svg viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
          </label>
          <button id="clear-btn" title="Clear all text">
            <svg viewBox="0 0 24 24">
              <path d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
            </svg>
          </button>
          <span class="info" id="info">No text loaded</span>
        </div>
        <div class="text-area" id="text-display"></div>
      </div>
    `;
  }

  setupEventListeners() {
    const fileInput = this.shadowRoot.getElementById('file-input');
    const clearBtn = this.shadowRoot.getElementById('clear-btn');
    const textDisplay = this.shadowRoot.getElementById('text-display');

    fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    clearBtn.addEventListener('click', () => this.clearText());

    // Handle text selection
    textDisplay.addEventListener('mouseup', (e) => {
      // Check if clicking on existing annotation
      if (e.target.classList.contains('text-confirmed')) {
        this.showAnnotationInfo(e.target);
        return;
      }
      this.handleTextSelection();
    });

    // Subscribe to facsimile canvas-changed events SYNCHRONOUSLY (no
    // setTimeout). The previous 500ms delay produced a race where the
    // facsimile panel's initial dispatch landed before this listener
    // existed and currentFacsimileCanvasId stayed null, silently
    // breaking Task A's PAGE-XML → facsimile target capture. Stash the
    // bound handler so disconnectedCallback can unsubscribe cleanly
    // and hot-reload doesn't accumulate listeners.
    this._boundCanvasChange = (e) => this.handleCanvasChange(e);
    window.addEventListener('canvas-changed', this._boundCanvasChange);
    this._pageXmlLog('window canvas-changed listener attached SYNCHRONOUSLY in setupEventListeners');
  }

  disconnectedCallback() {
    if (this._boundCanvasChange) {
      window.removeEventListener('canvas-changed', this._boundCanvasChange);
      this._boundCanvasChange = null;
    }
  }

  /** Gated logger for PAGE-XML / facsimile-anchor diagnostics. The flag
   *  is off by default so the demo console stays clean; an operator
   *  can flip it on at runtime via DevTools:
   *
   *    document.querySelector('multimodal-annotator').debugPageXml(true)
   *
   *  (the orchestrator helper toggles the flag on every text panel),
   *  or directly:
   *
   *    p = document.querySelector('multimodal-annotator')
   *           .shadowRoot.querySelector('iiif-text-panel');
   *    p._debugPageXml = true;
   *
   *  Then make a selection and watch the [MMA pagexml] traces. Race
   *  conditions are subtle and this lets us re-investigate without
   *  rebuilding. */
  _pageXmlLog(...args) {
    if (this._debugPageXml) console.log('[MMA pagexml]', ...args);
  }

  /** Safety net for the PAGE-XML facsimile-anchor flow (Task A part B):
   *  walk up to the orchestrator host and query any sibling
   *  iiif-image-panel typed as `facsimile` for its current canvas IRI.
   *  Used when `currentFacsimileCanvasId` is still null at selection
   *  time (the event-bus subscription missed the initial dispatch, or
   *  HMR dropped the listener). Returns null if no facsimile panel is
   *  reachable or none has a canvas loaded. */
  _queryFacsimileCanvasIdFromSibling() {
    try {
      const host = this.getRootNode()?.host;
      if (!host?.shadowRoot) return null;
      const panels = host.shadowRoot.querySelectorAll(
        'iiif-image-panel[panel-type="facsimile"]'
      );
      for (const p of panels) {
        if (typeof p.getCurrentCanvasId === 'function') {
          const id = p.getCurrentCanvasId();
          if (id) return id;
        }
      }
    } catch (_) { /* opaque shadow / detached / etc. — give up quietly */ }
    return null;
  }

  async loadTextFromUrl(url) {
    try {
      const response = await fetch(url);
      const text = await response.text();

      // Detect if XML
      if (url.endsWith('.xml') || text.trim().startsWith('<?xml')) {
        const xmlType = this.detectXMLType(text);
        if (xmlType === 'tei') {
          this.parseTEIXML(text);
        } else if (xmlType === 'page') {
          this.parsePageXML(text);
        } else {
          this.updateInfo('Unknown XML format');
        }
      } else {
        this.setTextContent(text);
      }
    } catch (error) {
      console.error('Error loading text:', error);
      this.updateInfo('Error loading text file');
    }
  }

  handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;

      // Detect if XML based on file extension or content
      if (file.name.endsWith('.xml') || content.trim().startsWith('<?xml')) {
        const xmlType = this.detectXMLType(content);
        if (xmlType === 'tei') {
          this.parseTEIXML(content);
        } else if (xmlType === 'page') {
          this.parsePageXML(content);
        } else {
          this.updateInfo('Unknown XML format');
        }
      } else {
        this.setTextContent(content);
      }
    };
    reader.readAsText(file);
  }

  setTextContent(text) {
    this.textContent = text;
    const textDisplay = this.shadowRoot.getElementById('text-display');
    textDisplay.textContent = text;
    this.updateInfo(`Loaded ${text.length} characters`);
  }

  handleTextSelection() {
    const selection = this.shadowRoot.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Remove previous YELLOW selection if exists (but keep green confirmed ones)
    if (this.currentSelectionElement && this.currentSelectionElement.className === 'text-selected') {
      const parent = this.currentSelectionElement.parentNode;
      const textNode = document.createTextNode(this.currentSelectionElement.textContent);
      parent.replaceChild(textNode, this.currentSelectionElement);
      parent.normalize(); // Merge adjacent text nodes
    }

    // Get the range of the selection
    const range = selection.getRangeAt(0);
    const textDisplay = this.shadowRoot.getElementById('text-display');

    // Calculate character offset within the full text
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(textDisplay);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;
    const end = start + selectedText.length;

    // Create a text position selector (Web Annotation standard)
    const selector = {
      type: 'TextPositionSelector',
      start: start,
      end: end
    };

    // Also create a TextQuoteSelector for robustness
    const quoteSelector = {
      type: 'TextQuoteSelector',
      exact: selectedText,
      prefix: this.textContent.substring(Math.max(0, start - 50), start),
      suffix: this.textContent.substring(end, Math.min(this.textContent.length, end + 50))
    };

    const selectionData = {
      text: selectedText,
      selector: {
        type: 'Choice',
        items: [selector, quoteSelector]
      },
      start: start,
      end: end
    };

    // If the selection lives under a PAGE-XML line div, propagate the
    // facsimile anchor (line id, original polygon, computed xywh, page
    // number, canvas IRI). The orchestrator uses these to emit a
    // SpecificResource target on the facsimile alongside the existing
    // painting target — see createConnectionBetween in
    // multimodal-annotator.js. Plain-text / TEI selections leave these
    // fields undefined and the orchestrator falls back to single-target.

    // (1) trace where the selection begins
    const anchorNode = range.startContainer;
    this._pageXmlLog('handleTextSelection — selection anchor', {
      anchorNode,
      anchorNodeType: anchorNode?.nodeType,
      anchorNodeName: anchorNode?.nodeName,
      anchorTextSample: typeof anchorNode?.textContent === 'string'
        ? anchorNode.textContent.slice(0, 40)
        : null,
      anchorParentElement: anchorNode?.parentElement,
      anchorParentTag: anchorNode?.parentElement?.tagName,
      anchorParentDataset: anchorNode?.parentElement?.dataset
        ? { ...anchorNode.parentElement.dataset }
        : null,
    });

    // (2) walk the ancestor chain via findPageXmlContext
    const pageXmlCtx = findPageXmlContext(range.startContainer);
    this._pageXmlLog('findPageXmlContext →',
      pageXmlCtx ? pageXmlCtx : 'NOT FOUND (no <div data-line-id> ancestor)');

    // Fallback (Task A part B): if the event-bus subscription hasn't
    // produced a facsimile canvasId yet (race at startup, or HMR
    // dropped the listener), query the orchestrator's sibling
    // facsimile panel directly via its getCurrentCanvasId() API.
    if (pageXmlCtx && !this.currentFacsimileCanvasId) {
      const recovered = this._queryFacsimileCanvasIdFromSibling();
      if (recovered) {
        this.currentFacsimileCanvasId = recovered;
        this._pageXmlLog('fallback lookup recovered facsimileCanvasId =', recovered);
      }
    }

    // (3) what is currentFacsimileCanvasId at this moment?
    this._pageXmlLog('currentFacsimileCanvasId =', this.currentFacsimileCanvasId);

    if (pageXmlCtx) {
      selectionData.lineId = pageXmlCtx.lineId;
      selectionData.coords = pageXmlCtx.coords;            // original PAGE-XML polygon, preserved
      selectionData.xywh = polygonToXywh(pageXmlCtx.coords); // bounding box for Media Fragments
      selectionData.pageNr = pageXmlCtx.pageNr;
      selectionData.facsimileCanvasId = this.currentFacsimileCanvasId;
    }

    // (4) final selectionData PAGE-XML fields
    this._pageXmlLog('selectionData PAGE-XML fields →', {
      lineId: selectionData.lineId,
      coords: selectionData.coords,
      xywh: selectionData.xywh,
      pageNr: selectionData.pageNr,
      facsimileCanvasId: selectionData.facsimileCanvasId,
    });

    // Save current selection
    this.currentSelection = selectionData;

    // Wrap selected text in a mark element with yellow highlight
    const mark = document.createElement('mark');
    mark.className = 'text-selected';
    mark.textContent = selectedText;

    try {
      range.deleteContents();
      range.insertNode(mark);
      this.currentSelectionElement = mark;
    } catch (error) {
      console.error('Error highlighting text:', error);
    }

    // Clear the browser selection
    selection.removeAllRanges();

    // Show annotation type selector immediately
    this.showAnnotationTypeSelector(mark, selectionData);

    this.updateInfo(`Choose annotation type`);
  }

  showAnnotationTypeSelector(element, selection) {
    // Create inline selector with three icons
    const selector = document.createElement('span');
    selector.className = 'annotation-type-selector';
    selector.innerHTML = `
      <button class="annotation-type-btn" data-type="comment" title="Free comment">
        <svg viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button class="annotation-type-btn" data-type="tag" title="Tag">
        <svg viewBox="0 0 24 24">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <circle cx="7" cy="7" r="1"/>
        </svg>
      </button>
      <button class="annotation-type-btn" data-type="link" title="Entity linking">
        <svg viewBox="0 0 24 24">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </button>
      <button class="annotation-type-btn delete" data-type="delete" title="Delete selection">
        <svg viewBox="0 0 24 24">
          <path d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        </svg>
      </button>
    `;

    // Insert after the element
    element.parentNode.insertBefore(selector, element.nextSibling);

    // Add event listeners
    const buttons = selector.querySelectorAll('.annotation-type-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.type;
        this.handleAnnotationType(type, element, selection, selector);
      });
    });
  }

  handleAnnotationType(type, element, selection, selector) {
    // Remove the selector buttons
    selector.remove();

    if (type === 'delete') {
      // Remove the element and clear selection
      const parent = element.parentNode;
      const textNode = document.createTextNode(element.textContent);
      parent.replaceChild(textNode, element);
      parent.normalize();
      this.currentSelection = null;
      this.currentSelectionElement = null;
      this.updateInfo('Selection deleted');
      return;
    }

    if (type === 'comment') {
      this.showCommentSidebar(element, selection);
    } else if (type === 'tag') {
      this.showTagForm(element, selection);
    } else if (type === 'link') {
      // Change to green and use existing entity linking system
      element.className = 'text-confirmed';
      this.addToConfirmedElements(element, selection, { type: 'entity-linking' });
      this.dispatchEvent(new CustomEvent('text-confirmed', {
        detail: {
          element: element,
          selection: selection,
          annotationType: 'entity-linking'
        },
        bubbles: true,
        composed: true
      }));
      this.updateInfo(`Entity linking mode - Ready to connect`);

      // Reset current selection
      this.currentSelection = null;
      this.currentSelectionElement = null;
    }
  }

  showCommentSidebar(element, selection) {
    // Emit event to show global sidebar
    this.dispatchEvent(new CustomEvent('show-comment-sidebar', {
      detail: {
        type: 'text',
        element: element,
        selection: selection,
        onCancel: () => {
          // Remove the yellow highlight
          const parent = element.parentNode;
          if (parent) {
            const textNode = document.createTextNode(element.textContent);
            parent.replaceChild(textNode, element);
            parent.normalize();
          }
          this.currentSelection = null;
          this.currentSelectionElement = null;
          this.updateInfo('Comment cancelled');
        },
        onSave: (comment) => {
          // Change to green
          element.className = 'text-confirmed';

          // Add to confirmed elements with body so showAnnotationInfo
          // can render the comment text later.
          this.addToConfirmedElements(element, selection, { type: 'comment', body: comment });

          // Dispatch event with comment
          this.dispatchEvent(new CustomEvent('annotation-created', {
            detail: {
              element: element,
              selection: selection,
              annotationType: 'comment',
              body: comment
            },
            bubbles: true,
            composed: true
          }));

          this.updateInfo(`Comment saved`);

          // Reset current selection
          this.currentSelection = null;
          this.currentSelectionElement = null;
        }
      },
      bubbles: true,
      composed: true
    }));
  }

  showTagForm(element, selection) {
    // Change to green
    element.className = 'text-confirmed';

    // Placeholder for now
    this.addToConfirmedElements(element, selection, { type: 'tag', body: '[Tag functionality — coming soon]' });

    this.dispatchEvent(new CustomEvent('annotation-created', {
      detail: {
        element: element,
        selection: selection,
        annotationType: 'tag',
        body: '[Tag functionality - coming soon]'
      },
      bubbles: true,
      composed: true
    }));

    this.updateInfo(`Tag annotation (placeholder)`);

    // Reset current selection
    this.currentSelection = null;
    this.currentSelectionElement = null;
  }

  addToConfirmedElements(element, selection, extras = {}) {
    // Add to confirmed elements list (these will persist). `extras`
    // carries the annotation type and body so showAnnotationInfo
    // can render the comment/tag value instead of the source span.
    this.confirmedElements.push({
      element: element,
      selection: selection,
      type: extras.type || null,
      body: extras.body || null,
    });
  }

  clearSelection() {
    // Remove ONLY the current yellow highlight from DOM (keep green confirmed ones)
    if (this.currentSelectionElement && this.currentSelectionElement.className === 'text-selected') {
      const parent = this.currentSelectionElement.parentNode;
      const textNode = document.createTextNode(this.currentSelectionElement.textContent);
      parent.replaceChild(textNode, this.currentSelectionElement);
      parent.normalize();
    }

    // Clear browser selection
    const selection = this.shadowRoot.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    // Reset current state only
    this.currentSelection = null;
    this.currentSelectionElement = null;

    // Remove any inline buttons
    const selector = this.shadowRoot.querySelector('.annotation-type-selector');
    if (selector) selector.remove();

    // Remove any sidebar
    const sidebar = this.shadowRoot.querySelector('.comment-sidebar');
    if (sidebar) {
      sidebar.classList.remove('visible');
      setTimeout(() => sidebar.remove(), 300);
    }

    this.updateInfo('Current selection cleared');
  }

  clearText() {
    this.textContent = '';
    const textDisplay = this.shadowRoot.getElementById('text-display');
    textDisplay.textContent = '';
    this.updateInfo('Text cleared');
  }

  updateInfo(message) {
    const info = this.shadowRoot.getElementById('info');
    info.textContent = message;
  }

  highlightAnnotation(annotation) {
    // TODO: Implement highlighting of existing annotations
    // This will wrap text segments in <mark> elements
  }

  // XML Detection and Parsing Methods

  detectXMLType(xmlText) {
    // Parse XML to detect type
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      console.error('XML parsing error:', parserError.textContent);
      return null;
    }

    // Detect TEI XML (check for TEI namespace and root element)
    const teiElement = xmlDoc.querySelector('TEI');
    if (teiElement && teiElement.namespaceURI === 'http://www.tei-c.org/ns/1.0') {
      return 'tei';
    }

    // Detect PAGE XML (check for Page element)
    const pageElement = xmlDoc.querySelector('Page');
    if (pageElement) {
      return 'page';
    }

    return null;
  }

  parseTEIXML(xmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      // Check for parsing errors
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        console.error('TEI XML parsing error:', parserError.textContent);
        this.updateInfo('Error parsing TEI XML');
        return;
      }

      // Extract text from TEI body
      const bodyElement = xmlDoc.querySelector('body');
      if (!bodyElement) {
        this.updateInfo('No body element found in TEI XML');
        return;
      }

      // Extract all page divs
      const pageDivs = bodyElement.querySelectorAll('div[type="page"]');

      if (pageDivs.length === 0) {
        this.updateInfo('No page divs found in TEI XML');
        return;
      }

      // Load first 10 pages
      const pagesToLoad = Math.min(10, pageDivs.length);
      const textParts = [];

      for (let i = 0; i < pagesToLoad; i++) {
        const pageDiv = pageDivs[i];
        const pageText = this.extractTextFromTEIElement(pageDiv);

        if (pageText.trim()) {
          // Add page separator (except for the first page)
          if (i > 0) {
            textParts.push('\n\n--- Page ' + (i + 1) + ' ---\n\n');
          }
          textParts.push(pageText);
        }
      }

      const fullText = textParts.join('');
      this.setTextContent(fullText);
      this.updateInfo(`Loaded TEI XML - Pages 1-${pagesToLoad} of ${pageDivs.length} (${fullText.length} characters)`);
    } catch (error) {
      console.error('Error parsing TEI XML:', error);
      this.updateInfo('Error parsing TEI XML: ' + error.message);
    }
  }

  extractTextFromTEIElement(element) {
    // Recursively extract text from TEI element, handling special tags
    let text = '';

    element.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.nodeName.toLowerCase();

        switch (tagName) {
          case 'lb':
            // Line break
            text += '\n';
            break;
          case 'pb':
            // Page break (already handled at div level)
            break;
          case 'add':
            // Addition - include in text with brackets
            text += ' [' + this.extractTextFromTEIElement(node) + '] ';
            break;
          case 'del':
            // Deletion - skip or show with strikethrough (we'll skip for now)
            // text += ' [deleted: ' + this.extractTextFromTEIElement(node) + '] ';
            break;
          case 'hi':
            // Highlight - just include the text
            text += this.extractTextFromTEIElement(node);
            break;
          case 'gap':
            // Gap in text
            text += '[...]';
            break;
          case 'unclear':
            // Unclear text
            text += '[' + this.extractTextFromTEIElement(node) + '?]';
            break;
          default:
            // For all other elements, recursively extract text
            text += this.extractTextFromTEIElement(node);
        }
      }
    });

    return text;
  }

  // PAGE XML Support Methods

  async loadPageXML(url) {
    try {
      console.log('Loading PAGE XML from:', url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xmlText = await response.text();
      console.log('PAGE XML loaded, length:', xmlText.length);
      this.parsePageXML(xmlText);
    } catch (error) {
      console.error('Error loading PAGE XML from', url, ':', error);
      this.updateInfo('Error loading PAGE XML file: ' + error.message);
    }
  }

  async loadMETS(url) {
    try {
      console.log('Loading METS from:', url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      // Check for parsing errors
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        console.error('METS parsing error:', parserError.textContent);
        this.updateInfo('Error parsing METS file');
        return;
      }

      this.metsData = xmlDoc;
      const fileCount = xmlDoc.querySelectorAll('file').length;
      console.log('METS loaded successfully:', fileCount, 'files');
      this.updateInfo(`METS loaded (${fileCount} pages)`);
    } catch (error) {
      console.error('Error loading METS from', url, ':', error);
      this.updateInfo('Error loading METS file: ' + error.message);
    }
  }

  parsePageXML(xmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      // Check for parsing errors
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        console.error('XML parsing error:', parserError.textContent);
        this.updateInfo('Error parsing PAGE XML');
        return;
      }

      // Extract page metadata
      const pageElement = xmlDoc.querySelector('Page');
      const pageNr = xmlDoc.querySelector('TranskribusMetadata')?.getAttribute('pageNr');

      console.log('Parsing PAGE XML:', { pageNr, linesCount: xmlDoc.querySelectorAll('TextLine').length });

      this.currentPageNr = pageNr;
      this.pageXMLData = {
        pageNr: pageNr,
        imageWidth: pageElement?.getAttribute('imageWidth'),
        imageHeight: pageElement?.getAttribute('imageHeight'),
        lines: []
      };

      // Extract text lines
      const textLines = xmlDoc.querySelectorAll('TextLine');
      textLines.forEach(line => {
        const lineId = line.getAttribute('id');
        const coords = line.querySelector('Coords')?.getAttribute('points');
        const baseline = line.querySelector('Baseline')?.getAttribute('points');
        const unicode = line.querySelector('Unicode')?.textContent || '';

        if (unicode.trim()) {
          this.pageXMLData.lines.push({
            id: lineId,
            coords: coords,
            baseline: baseline,
            text: unicode
          });
        }
      });

      console.log('Parsed lines:', this.pageXMLData.lines.length);

      // Render the text lines
      this.renderPageXML();
      this.updateInfo(`Loaded PAGE XML: Page ${pageNr || 'unknown'} (${this.pageXMLData.lines.length} lines)`);
    } catch (error) {
      console.error('Error in parsePageXML:', error);
      this.updateInfo('Error parsing PAGE XML: ' + error.message);
    }
  }

  renderPageXML() {
    if (!this.pageXMLData) {
      console.warn('No PAGE XML data to render');
      return;
    }

    const textDisplay = this.shadowRoot.getElementById('text-display');
    if (!textDisplay) {
      console.error('Text display element not found');
      return;
    }

    const pageNr = this.pageXMLData.pageNr;

    // Hide all other page containers
    Object.keys(this.pageContainers).forEach(pnr => {
      if (pnr !== pageNr) {
        this.pageContainers[pnr].style.display = 'none';
      }
    });

    // Check if this page already has a container
    if (this.pageContainers[pageNr]) {
      // Page already rendered, just show it
      this.pageContainers[pageNr].style.display = 'block';
      console.log('Showing existing container for page', pageNr);

      // Update confirmed elements list from this container
      this.confirmedElements = [];
      const confirmedElems = this.pageContainers[pageNr].querySelectorAll('.text-confirmed');
      confirmedElems.forEach(elem => {
        // Find the corresponding item in unlinkedTextElements
        const textItem = {
          element: elem,
          selection: {
            text: elem.textContent,
            // We can reconstruct other properties if needed
          }
        };
        this.confirmedElements.push(textItem);
      });

      return;
    }

    // Create new container for this page
    const container = document.createElement('div');
    container.style.cssText = 'line-height: 1.8; font-family: Georgia, serif;';
    container.dataset.pageNr = pageNr;

    if (this.pageXMLData.lines.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'padding: 2rem; text-align: center; color: #999; font-style: italic;';
      emptyMsg.textContent = `Page ${pageNr || 'unknown'} has no transcription`;
      container.appendChild(emptyMsg);
      this.updateInfo(`Page ${pageNr || 'unknown'}: No text transcribed`);
    } else {
      this.pageXMLData.lines.forEach((line, index) => {
        const lineDiv = document.createElement('div');
        lineDiv.style.cssText = 'margin-bottom: 0.5rem; cursor: text;';
        lineDiv.textContent = line.text;
        lineDiv.dataset.lineId = line.id;
        lineDiv.dataset.coords = line.coords || '';
        lineDiv.dataset.baseline = line.baseline || '';

        container.appendChild(lineDiv);
      });
    }

    // Store container for this page
    this.pageContainers[pageNr] = container;
    textDisplay.appendChild(container);

    // Update textContent for plain text operations
    this.textContent = this.pageXMLData.lines.map(l => l.text).join('\n');

    console.log('Rendered new container for page', pageNr, 'with', this.pageXMLData.lines.length, 'lines');
  }

  loadPageByNumber(pageNr) {
    if (!this.metsData) {
      console.warn('METS data not loaded');
      return;
    }

    console.log('Looking for page number:', pageNr);

    // Find the file in METS for this page number
    const fileElements = this.metsData.querySelectorAll('file');
    for (const fileEl of fileElements) {
      const seq = parseInt(fileEl.getAttribute('SEQ'));
      if (seq === pageNr) {
        const flocatEl = fileEl.querySelector('FLocat');
        if (!flocatEl) {
          console.warn('No FLocat element found');
          continue;
        }

        // Try multiple ways to get href attribute
        let href = flocatEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||  // Standard xlink:href
                   flocatEl.getAttribute('ns2:href') ||   // ns2:href (Transkribus METS)
                   flocatEl.getAttribute('xlink:href') ||  // Prefixed attribute
                   flocatEl.getAttribute('href');          // Plain href

        if (href) {
          // Build path relative to current location
          const fullPath = `/examples/${href}`;
          console.log('Loading PAGE XML for page', pageNr, ':', fullPath);
          this.loadPageXML(fullPath);
          return;
        } else {
          console.warn('Could not find href attribute on FLocat element');
        }
      }
    }

    console.warn(`No PAGE XML found for page ${pageNr}`);
    this.updateInfo(`No PAGE XML found for page ${pageNr}`);
  }

  handleCanvasChange(event) {
    // Only sync with facsimile panels, not other image panels (like painting)
    const detail = event.detail;

    // Skip if this event is not from a facsimile panel
    if (detail.panelType !== 'facsimile') {
      return;
    }

    // Remember the facsimile canvas IRI so PAGE-XML text selections can be
    // anchored back to their physical region on the manuscript when the
    // user creates a linking annotation. The orchestrator emits this as
    // the source of target[0] (facsimile SpecificResource).
    if (detail.canvasId) {
      this.currentFacsimileCanvasId = detail.canvasId;
      this._pageXmlLog('handleCanvasChange — recorded facsimile canvasId =',
        detail.canvasId, '(canvasIndex', detail.canvasIndex, ', panelType', detail.panelType, ')');
    } else {
      this._pageXmlLog('handleCanvasChange — facsimile event WITHOUT canvasId!', detail);
    }

    if (!this.metsData) {
      // No METS loaded, don't try to sync
      return;
    }

    const { canvasIndex, canvasLabel } = detail;
    const pageNr = canvasIndex + 1;

    // Only load if page number is within METS range (26 pages)
    if (pageNr <= 26) {
      this.loadPageByNumber(pageNr);
    }
  }

  enableCanvasSync() {
    // Enable syncing with canvas navigation
    if (!this._canvasSyncEnabled) {
      window.addEventListener('canvas-changed', (e) => this.handleCanvasChange(e));
      this._canvasSyncEnabled = true;
      console.log('Canvas sync enabled for text panel');
    }
  }

  showAnnotationInfo(element) {
    // Find annotation data
    const confirmed = this.confirmedElements.find(c => c.element === element);
    if (!confirmed) return;

    // Resolve a friendly title from the stored type OR the modality
    // class on the element (for entity-linking annotations).
    let typeText = 'Annotation';
    if (confirmed.type === 'comment') typeText = 'Comment';
    else if (confirmed.type === 'tag') typeText = 'Tag';
    else if (element.classList.contains('denotation'))    typeText = 'Entity Linking: Denotation';
    else if (element.classList.contains('dynamisation'))  typeText = 'Entity Linking: Dynamisation';
    else if (element.classList.contains('integration'))   typeText = 'Entity Linking: Integration';
    else if (element.classList.contains('transcription')) typeText = 'Entity Linking: Transcription';

    // Body text: prefer the stored annotation body (comment/tag value),
    // fall back to the source span for entity-linking annotations
    // where there is no separate body. Strip out HTML — the panel
    // renders message as innerHTML, this avoids injection from
    // user-typed comments.
    const escape = (s) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sourceSpan = `&ldquo;${escape(confirmed.selection.text)}&rdquo;`;
    const body = confirmed.body
      ? `<p>${escape(confirmed.body)}</p><p style="opacity:.6;font-style:italic;margin-top:8px;">on ${sourceSpan}</p>`
      : `<p>${sourceSpan}</p>`;

    // Route through the orchestrator's themed annotation-sidebar
    // (single source of truth for the info popup).
    this.dispatchEvent(new CustomEvent('show-annotation-info', {
      detail: {
        type: 'text',
        title: typeText,
        message: body,
        onDelete: () => {
          // Remove element
          const parent = element.parentNode;
          const textNode = document.createTextNode(element.textContent);
          parent.replaceChild(textNode, element);
          parent.normalize();

          // Remove from confirmed elements
          const index = this.confirmedElements.indexOf(confirmed);
          if (index > -1) {
            this.confirmedElements.splice(index, 1);
          }

          // Dispatch delete event
          this.dispatchEvent(new CustomEvent('annotation-deleted', {
            detail: {
              element: element,
              selection: confirmed.selection,
            },
            bubbles: true,
            composed: true,
          }));

          this.updateInfo('Annotation deleted');
        },
      },
      bubbles: true,
      composed: true,
    }));
  }
}

customElements.define('iiif-text-panel', IIIFTextPanel);
