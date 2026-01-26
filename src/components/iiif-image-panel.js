import OpenSeadragon from 'openseadragon';

/**
 * Image panel component with IIIF support via OpenSeadragon
 * Allows region selection for annotation
 */
export class IIIFImagePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.viewer = null;
    this.selectionOverlay = null;
    this.isDrawing = false;
    this.isSelecting = false;
    this.drawingMode = 'rectangle'; // 'rectangle' or 'freehand'
    this.startPoint = null;
    this.currentRect = null;
    this.currentPath = []; // Store points for freehand drawing
    this.pathClosed = false; // Track if freehand path is closed
    this.overlayElement = null;
    this.confirmedRects = []; // Store all confirmed (persistent) rectangles for current canvas
    this.rectsByCanvas = {}; // Store selections by canvas index: { canvasIndex: [rectData, ...] }
    this.canvases = []; // All canvases from manifest
    this.currentCanvasIndex = 0; // Current canvas index
    this.manifestData = null; // Store full manifest
    this.manifestUrl = null; // Store manifest URL
    this.currentSelectionData = null; // Store current selection for annotation type choice
  }

  static get observedAttributes() {
    return ['manifest', 'tileSources', 'panel-type'];
  }

  connectedCallback() {
    this.render();
    this.initializeViewer();
  }

  disconnectedCallback() {
    if (this.viewer) {
      this.viewer.destroy();
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this.viewer) return;

    if (name === 'manifest') {
      this.loadManifest(newValue);
    } else if (name === 'tileSources') {
      this.loadTileSource(newValue);
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          position: relative;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          --color-black: #000000;
          --color-white: #ffffff;
          --color-gray-200: #e5e5e5;
          --color-gray-300: #d4d4d4;
          --color-gray-700: #404040;
          --spacing-unit: 8px;
        }

        .container {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .controls {
          padding: calc(var(--spacing-unit) * 1.5);
          border-bottom: 1px solid var(--color-gray-200);
          display: flex;
          gap: calc(var(--spacing-unit) * 1);
          align-items: center;
          flex-wrap: wrap;
        }

        input {
          flex: 1;
          min-width: 150px;
          padding: calc(var(--spacing-unit) * 0.75);
          border: 1px solid var(--color-gray-200);
          border-radius: 0;
          font-size: 0.75rem;
          font-family: inherit;
        }

        input:focus {
          outline: none;
          border-color: var(--color-black);
        }

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
          transition: none;
          flex-shrink: 0;
        }

        button svg {
          width: 18px;
          height: 18px;
          stroke: var(--color-black);
          fill: none;
          stroke-width: 1.5;
        }

        button:hover {
          background: var(--color-black);
          border-color: var(--color-black);
        }

        button:hover svg {
          stroke: var(--color-white);
        }

        button.active {
          background: var(--color-black);
          border-color: var(--color-black);
        }

        button.active svg {
          stroke: var(--color-white);
        }

        /* Floating annotation type selector */
        .annotation-type-selector-floating {
          position: absolute;
          display: flex;
          gap: 4px;
          background: var(--color-white);
          border: 1px solid var(--color-black);
          padding: 4px;
          z-index: 1000;
          box-shadow: 2px 2px 0 rgba(0,0,0,0.1);
        }

        .annotation-type-btn-floating {
          width: 28px;
          height: 28px;
          border: 1px solid var(--color-black);
          background: var(--color-white);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: all 0.2s ease;
        }

        .annotation-type-btn-floating svg {
          width: 16px;
          height: 16px;
          stroke: var(--color-black);
          fill: none;
          stroke-width: 1.5;
        }

        .annotation-type-btn-floating:hover {
          background: var(--color-black);
        }

        .annotation-type-btn-floating:hover svg {
          stroke: var(--color-white);
        }

        .annotation-type-btn-floating.delete {
          border-color: #f44336;
        }

        .annotation-type-btn-floating.delete svg {
          stroke: #f44336;
        }

        .annotation-type-btn-floating.delete:hover {
          background: #f44336;
        }

        .annotation-type-btn-floating.delete:hover svg {
          stroke: var(--color-white);
        }

        /* Comment sidebar */
        .comment-sidebar {
          position: absolute;
          top: 0;
          right: 0;
          width: 350px;
          height: 100%;
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

        .viewer-container {
          flex: 1;
          position: relative;
          background: #333;
        }

        #openseadragon {
          width: 100%;
          height: 100%;
        }

        #selection-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 100;
          cursor: default;
          pointer-events: none;
          overflow: hidden;
        }

        #selection-canvas.active {
          cursor: crosshair;
          pointer-events: auto;
        }

        .selection-rect {
          position: absolute;
          border: 2px solid #FFC107;
          background: rgba(255, 193, 7, 0.2);
          pointer-events: none;
          z-index: 101;
        }

        .selection-rect.confirmed {
          border: 2px solid #4CAF50;
          background: rgba(76, 175, 80, 0.3);
          z-index: 100;
          cursor: default;
          transition: none;
          pointer-events: none;
          will-change: transform;
        }

        /* Modality colors for image boxes */
        .selection-rect.confirmed.denotation {
          border: 2px solid #2196F3;
          background: rgba(33, 150, 243, 0.3);
        }

        .selection-rect.confirmed.denotation:hover {
          border: 3px solid #1976D2;
          background: rgba(25, 118, 210, 0.4);
        }

        .selection-rect.confirmed.dynamisation {
          border: 2px solid #FF5722;
          background: rgba(255, 87, 34, 0.3);
        }

        .selection-rect.confirmed.dynamisation:hover {
          border: 3px solid #E64A19;
          background: rgba(230, 74, 25, 0.4);
        }

        .selection-rect.confirmed.integration {
          border: 2px solid #9C27B0;
          background: rgba(156, 39, 176, 0.3);
        }

        .selection-rect.confirmed.integration:hover {
          border: 3px solid #7B1FA2;
          background: rgba(123, 31, 162, 0.4);
        }

        .selection-rect.confirmed.transcription {
          border: 2px solid #4CAF50;
          background: rgba(76, 175, 80, 0.25);
        }

        /* SVG freehand paths */
        svg.confirmed {
          cursor: default;
          pointer-events: none;
          z-index: 100;
        }

        svg.confirmed path {
          pointer-events: none;
        }

        /* Modality colors for SVG paths */
        svg.confirmed.denotation path {
          stroke: #2196F3;
          fill: rgba(33, 150, 243, 0.3);
        }

        svg.confirmed.dynamisation path {
          stroke: #FF5722;
          fill: rgba(255, 87, 34, 0.3);
        }

        svg.confirmed.integration path {
          stroke: #9C27B0;
          fill: rgba(156, 39, 176, 0.3);
        }

        svg.confirmed.transcription path {
          stroke: #4CAF50;
          fill: rgba(76, 175, 80, 0.25);
        }

        .info {
          font-size: 0.75rem;
          color: var(--color-gray-700);
          margin-left: auto;
        }

        .help {
          font-size: 0.75rem;
          color: var(--color-gray-700);
          padding: calc(var(--spacing-unit) * 1) calc(var(--spacing-unit) * 1.5);
          background: var(--color-white);
          border-bottom: 1px solid var(--color-gray-200);
        }

        .navigation {
          display: flex;
          align-items: center;
          gap: calc(var(--spacing-unit) * 1);
          padding: calc(var(--spacing-unit) * 1) calc(var(--spacing-unit) * 1.5);
          background: var(--color-white);
          border-bottom: 1px solid var(--color-gray-200);
        }

        .navigation.hidden {
          display: none;
        }

        .nav-btn {
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
          transition: none;
        }

        .nav-btn svg {
          width: 18px;
          height: 18px;
          stroke: var(--color-black);
          fill: none;
          stroke-width: 1.5;
        }

        .nav-btn:hover:not(:disabled) {
          background: var(--color-black);
          border-color: var(--color-black);
        }

        .nav-btn:hover:not(:disabled) svg {
          stroke: var(--color-white);
        }

        .nav-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .page-indicator {
          font-size: 0.8rem;
          color: var(--color-gray-700);
          min-width: 80px;
          text-align: center;
        }

        .canvas-label {
          font-size: 0.75rem;
          color: var(--color-gray-700);
          flex: 1;
          text-align: right;
        }

        .metadata-panel {
          padding: calc(var(--spacing-unit) * 1.5);
          background: var(--color-gray-100);
          border-bottom: 1px solid var(--color-gray-200);
          font-size: 0.75rem;
          max-height: 150px;
          overflow-y: auto;
          display: none;
        }

        .metadata-panel.visible {
          display: block;
        }

        .metadata-title {
          font-weight: 600;
          font-size: 0.85rem;
          margin-bottom: calc(var(--spacing-unit) * 1);
          color: var(--color-black);
        }

        .metadata-item {
          margin-bottom: calc(var(--spacing-unit) * 0.75);
          display: flex;
          gap: calc(var(--spacing-unit) * 1);
        }

        .metadata-label {
          font-weight: 500;
          color: var(--color-gray-700);
          min-width: 100px;
        }

        .metadata-value {
          color: var(--color-black);
          flex: 1;
        }

        .toggle-metadata {
          font-size: 0.7rem;
          padding: calc(var(--spacing-unit) * 0.5) calc(var(--spacing-unit) * 1);
        }
      </style>

      <div class="container">
        <div class="controls">
          <input
            type="text"
            id="manifest-input"
            placeholder="IIIF Manifest URL or Image URL"
          />
          <button id="load-btn" title="Load manifest">
            <svg viewBox="0 0 24 24">
              <path d="M4 12l6-6v4h10v4H10v4z"/>
            </svg>
          </button>
          <button id="select-btn" title="Select region">
            <svg viewBox="0 0 24 24">
              <path d="M3 3h7M3 3v7M21 3h-7M21 3v7M3 21h7M3 21v-7M21 21h-7M21 21v-7"/>
            </svg>
          </button>
          <button id="drawing-mode-btn" title="Switch to freehand drawing">
            <svg viewBox="0 0 24 24">
              <path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>
            </svg>
          </button>
          <button id="clear-selection-btn" title="Clear selection">
            <svg viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
          <button class="toggle-metadata" id="toggle-metadata-btn" title="Show info">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
          </button>
          <span class="info" id="info">No image loaded</span>
        </div>
        <div class="metadata-panel" id="metadata-panel">
          <div class="metadata-title" id="metadata-title">Manifest Information</div>
          <div id="metadata-content"></div>
        </div>
        <div class="navigation hidden" id="navigation">
          <button class="nav-btn" id="prev-btn" disabled title="Previous canvas">
            <svg viewBox="0 0 24 24">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span class="page-indicator" id="page-indicator">1 / 1</span>
          <button class="nav-btn" id="next-btn" disabled title="Next canvas">
            <svg viewBox="0 0 24 24">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
          <span class="canvas-label" id="canvas-label"></span>
        </div>
        <div class="help">
          Click "Select Region" then drag on the image to select an area
        </div>
        <div class="viewer-container">
          <div id="openseadragon"></div>
          <div id="selection-canvas"></div>
        </div>
      </div>
    `;
  }

  initializeViewer() {
    const container = this.shadowRoot.getElementById('openseadragon');

    this.viewer = OpenSeadragon({
      element: container,
      prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/',
      showNavigationControl: true,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      sequenceMode: false,
      showReferenceStrip: false,
      debugMode: false,
      minZoomLevel: 0.5,
      maxZoomLevel: 10,
      visibilityRatio: 0.8,
      constrainDuringPan: false,
      gestureSettingsMouse: {
        clickToZoom: false
      }
    });

    // Listen to viewport changes (zoom/pan)
    this.viewer.addHandler('animation', () => {
      this.updateConfirmedRectsPositions();
    });

    this.viewer.addHandler('resize', () => {
      this.updateConfirmedRectsPositions();
    });

    this.setupEventListeners();

    // Load from attribute if provided
    if (this.hasAttribute('manifest')) {
      this.loadManifest(this.getAttribute('manifest'));
    } else if (this.hasAttribute('tileSources')) {
      this.loadTileSource(this.getAttribute('tileSources'));
    }
  }

  setupEventListeners() {
    const loadBtn = this.shadowRoot.getElementById('load-btn');
    const selectBtn = this.shadowRoot.getElementById('select-btn');
    const drawingModeBtn = this.shadowRoot.getElementById('drawing-mode-btn');
    const clearSelectionBtn = this.shadowRoot.getElementById('clear-selection-btn');
    const manifestInput = this.shadowRoot.getElementById('manifest-input');
    const prevBtn = this.shadowRoot.getElementById('prev-btn');
    const nextBtn = this.shadowRoot.getElementById('next-btn');
    const toggleMetadataBtn = this.shadowRoot.getElementById('toggle-metadata-btn');

    loadBtn.addEventListener('click', () => {
      const url = manifestInput.value.trim();
      if (url) {
        this.loadImageSource(url);
      }
    });

    manifestInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const url = manifestInput.value.trim();
        if (url) {
          this.loadImageSource(url);
        }
      }
    });

    selectBtn.addEventListener('click', () => this.toggleSelectionMode());
    drawingModeBtn.addEventListener('click', () => this.toggleDrawingMode());
    clearSelectionBtn.addEventListener('click', () => this.clearSelection());

    // Navigation buttons
    prevBtn.addEventListener('click', () => this.previousCanvas());
    nextBtn.addEventListener('click', () => this.nextCanvas());

    // Metadata toggle
    toggleMetadataBtn.addEventListener('click', () => this.toggleMetadata());

    // Setup mouse events on selection canvas
    const selectionCanvas = this.shadowRoot.getElementById('selection-canvas');

    selectionCanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    selectionCanvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    selectionCanvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    selectionCanvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));
  }

  toggleSelectionMode() {
    this.isDrawing = !this.isDrawing;
    const selectBtn = this.shadowRoot.getElementById('select-btn');
    const selectionCanvas = this.shadowRoot.getElementById('selection-canvas');

    if (this.isDrawing) {
      selectBtn.classList.add('active');
      selectBtn.title = 'Selection active - click to disable';
      selectionCanvas.classList.add('active');
      const modeText = this.drawingMode === 'rectangle' ? 'rectangle' : 'freehand path';
      this.updateInfo(`Click and drag to draw ${modeText}`);
    } else {
      selectBtn.classList.remove('active');
      selectBtn.title = 'Select region';
      selectionCanvas.classList.remove('active');
      this.updateInfo('Selection mode disabled');
    }
  }

  toggleDrawingMode() {
    const btn = this.shadowRoot.getElementById('drawing-mode-btn');
    const selectBtn = this.shadowRoot.getElementById('select-btn');
    const selectionCanvas = this.shadowRoot.getElementById('selection-canvas');

    if (this.drawingMode === 'freehand') {
      // Switch back to rectangle
      this.drawingMode = 'rectangle';
      this.isDrawing = false;
      btn.classList.remove('active');
      selectBtn.classList.remove('active');
      selectionCanvas.classList.remove('active');
      btn.title = 'Switch to freehand drawing';
      this.updateInfo('Rectangle selection mode');
    } else {
      // Switch to freehand and activate drawing
      this.drawingMode = 'freehand';
      this.isDrawing = true;
      btn.classList.add('active');
      selectBtn.classList.add('active');
      selectionCanvas.classList.add('active');
      btn.title = 'Disable freehand drawing';
      selectBtn.title = 'Freehand drawing active';
      this.updateInfo('Freehand drawing mode - draw on the image');
    }
  }

  onMouseDown(e) {
    if (!this.isDrawing) return;

    const rect = e.currentTarget.getBoundingClientRect();
    this.isSelecting = true;

    // Clamp start point to stay within canvas bounds
    let startX = e.clientX - rect.left;
    let startY = e.clientY - rect.top;
    startX = Math.max(0, Math.min(startX, rect.width));
    startY = Math.max(0, Math.min(startY, rect.height));

    this.startPoint = {
      x: startX,
      y: startY
    };

    // Initialize path for freehand drawing
    if (this.drawingMode === 'freehand') {
      this.currentPath = [{ x: startX, y: startY }];
      this.pathClosed = false;
    }

    // Remove only the current (non-confirmed) selection rectangle
    this.clearCurrentSelectionRect();
  }

  onMouseMove(e) {
    if (!this.isDrawing || !this.isSelecting || !this.startPoint) return;

    const rect = e.currentTarget.getBoundingClientRect();

    // Clamp current point to stay within canvas bounds
    let currentX = e.clientX - rect.left;
    let currentY = e.clientY - rect.top;
    currentX = Math.max(0, Math.min(currentX, rect.width));
    currentY = Math.max(0, Math.min(currentY, rect.height));

    const currentPoint = {
      x: currentX,
      y: currentY
    };

    if (this.drawingMode === 'freehand') {
      // Check if close to starting point for snap (only after drawing enough points)
      const snapDistance = 12; // pixels
      const minPointsBeforeSnap = 40; // Require more points before allowing snap
      const distToStart = Math.sqrt(
        Math.pow(currentPoint.x - this.startPoint.x, 2) +
        Math.pow(currentPoint.y - this.startPoint.y, 2)
      );

      if (distToStart < snapDistance && this.currentPath.length > minPointsBeforeSnap) {
        // Snap to start point and mark as closed
        if (!this.pathClosed) {
          this.currentPath.push(this.startPoint);
          this.pathClosed = true;
          this.drawFreehandPath(this.currentPath, true); // true = closed path
          // Auto-complete the selection on next mouseup
        }
      } else if (!this.pathClosed) {
        // Add point to path only if not already closed
        this.currentPath.push(currentPoint);
        this.drawFreehandPath(this.currentPath, false);
      }
    } else {
      // Calculate rectangle
      const x = Math.min(this.startPoint.x, currentPoint.x);
      const y = Math.min(this.startPoint.y, currentPoint.y);
      const width = Math.abs(currentPoint.x - this.startPoint.x);
      const height = Math.abs(currentPoint.y - this.startPoint.y);

      this.drawSelectionRect(x, y, width, height);
    }
  }

  onMouseUp(e) {
    if (!this.isDrawing || !this.isSelecting || !this.startPoint) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const imageWidth = this.viewer.world.getItemAt(0)?.source.dimensions?.x || 1000;
    const imageHeight = this.viewer.world.getItemAt(0)?.source.dimensions?.y || 1000;

    // Get the current canvas (if loaded from manifest)
    const currentCanvas = this.getCurrentCanvas();
    const canvasId = currentCanvas ? currentCanvas.id : null;
    const source = this.viewer.world.getItemAt(0)?.source;
    const imageUrl = source?.['@id'] || source?.id || this.getAttribute('tileSources') || '';

    if (this.drawingMode === 'freehand') {
      // Only save if path has enough points
      if (this.currentPath.length > 10) {
        // If not already closed, add final point
        if (!this.pathClosed) {
          let endX = e.clientX - rect.left;
          let endY = e.clientY - rect.top;
          endX = Math.max(0, Math.min(endX, rect.width));
          endY = Math.max(0, Math.min(endY, rect.height));
          this.currentPath.push({ x: endX, y: endY });
        }

        // Convert path points to image coordinates
        const imagePath = this.currentPath.map(point => {
          const viewportPoint = this.viewer.viewport.viewerElementToViewportCoordinates(
            new OpenSeadragon.Point(point.x, point.y)
          );
          return {
            x: Math.round(viewportPoint.x * imageWidth),
            y: Math.round(viewportPoint.y * imageHeight)
          };
        });

        // Create SVG path string
        const pathString = imagePath.map((p, i) =>
          `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
        ).join(' ') + ' Z'; // Close the path

        // Create SVG selector
        const selector = {
          type: 'SvgSelector',
          value: `<svg xmlns="http://www.w3.org/2000/svg"><path d="${pathString}" /></svg>`
        };

        const selectionData = {
          source: canvasId || imageUrl,
          canvasId: canvasId,
          canvasIndex: this.currentCanvasIndex,
          canvasLabel: currentCanvas ? currentCanvas.label : null,
          selector: selector,
          path: imagePath,
          svgPath: pathString,
          viewport: null
        };

        // Store selection data for later use
        this.currentSelectionData = selectionData;

        // Show floating annotation selector immediately
        const currentSelection = this.shadowRoot.getElementById('current-selection-rect');
        if (currentSelection) {
          const rect = currentSelection.getBoundingClientRect();
          const container = this.shadowRoot.querySelector('.viewer-container');
          const containerRect = container.getBoundingClientRect();
          this.showFloatingAnnotationSelector(rect, containerRect);
        }

        this.updateInfo(`Freehand path drawn - Choose annotation type`);
      } else {
        this.updateInfo('Path too short - draw a longer path');
      }

    } else {
      // Rectangle mode
      let endX = e.clientX - rect.left;
      let endY = e.clientY - rect.top;
      endX = Math.max(0, Math.min(endX, rect.width));
      endY = Math.max(0, Math.min(endY, rect.height));

      const endPoint = {
        x: endX,
        y: endY
      };

      // Calculate final rectangle in pixel coordinates
      const pixelX = Math.min(this.startPoint.x, endPoint.x);
      const pixelY = Math.min(this.startPoint.y, endPoint.y);
      const pixelWidth = Math.abs(endPoint.x - this.startPoint.x);
      const pixelHeight = Math.abs(endPoint.y - this.startPoint.y);

      // Convert to viewport coordinates
      const viewportRect = this.viewer.viewport.viewerElementToViewportRectangle(
        new OpenSeadragon.Rect(pixelX, pixelY, pixelWidth, pixelHeight)
      );

      const x = Math.round(viewportRect.x * imageWidth);
      const y = Math.round(viewportRect.y * imageHeight);
      const w = Math.round(viewportRect.width * imageWidth);
      const h = Math.round(viewportRect.height * imageHeight);

      // Only create annotation if rectangle has meaningful size
      if (w > 5 && h > 5) {
        // Create IIIF fragment selector
        const selector = {
          type: 'FragmentSelector',
          conformsTo: 'http://www.w3.org/TR/media-frags/',
          value: `xywh=${x},${y},${w},${h}`
        };

        const selectionData = {
          source: canvasId || imageUrl,
          canvasId: canvasId,
          canvasIndex: this.currentCanvasIndex,
          canvasLabel: currentCanvas ? currentCanvas.label : null,
          selector: selector,
          region: { x, y, w, h },
          viewport: {
            x: viewportRect.x,
            y: viewportRect.y,
            width: viewportRect.width,
            height: viewportRect.height
          }
        };

        // Store selection data for later use
        this.currentSelectionData = selectionData;

        // Show floating annotation selector immediately
        const currentSelection = this.shadowRoot.getElementById('current-selection-rect');
        if (currentSelection) {
          const rect = currentSelection.getBoundingClientRect();
          const container = this.shadowRoot.querySelector('.viewer-container');
          const containerRect = container.getBoundingClientRect();
          this.showFloatingAnnotationSelector(rect, containerRect);
        }

        this.updateInfo(`Region selected: ${w}x${h} - Choose annotation type`);
      }
    }

    this.isSelecting = false;
    this.startPoint = null;
    this.currentPath = [];
    this.pathClosed = false;
  }

  drawSelectionRect(x, y, width, height) {
    // Remove existing current rect (not confirmed ones)
    this.clearCurrentSelectionRect();

    // Create new rect
    const rectDiv = document.createElement('div');
    rectDiv.className = 'selection-rect';
    rectDiv.id = 'current-selection-rect';
    rectDiv.style.left = x + 'px';
    rectDiv.style.top = y + 'px';
    rectDiv.style.width = width + 'px';
    rectDiv.style.height = height + 'px';

    const canvas = this.shadowRoot.getElementById('selection-canvas');
    canvas.appendChild(rectDiv);
  }

  clearCurrentSelectionRect() {
    const existingRect = this.shadowRoot.getElementById('current-selection-rect');
    if (existingRect && !existingRect.classList.contains('confirmed')) {
      existingRect.remove();
    }
  }

  confirmCurrentRect() {
    // Make the current selection (rectangle or freehand path) permanent
    const currentSelection = this.shadowRoot.getElementById('current-selection-rect');
    if (currentSelection) {
      // Change ID so it won't be removed by clearCurrentSelectionRect
      const rectId = `confirmed-rect-${this.confirmedRects.length}`;
      currentSelection.id = rectId;
      currentSelection.classList.add('confirmed');

      let viewportRect = null;

      // Check if it's a rectangle (div) or freehand (svg)
      if (currentSelection.tagName === 'DIV') {
        // Store viewport coordinates for scaling (rectangles only)
        const pixelRect = {
          x: parseFloat(currentSelection.style.left),
          y: parseFloat(currentSelection.style.top),
          width: parseFloat(currentSelection.style.width),
          height: parseFloat(currentSelection.style.height)
        };

        // Convert pixel coords to viewport coords
        const vRect = this.viewer.viewport.viewerElementToViewportRectangle(
          new OpenSeadragon.Rect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
        );

        viewportRect = {
          x: vRect.x,
          y: vRect.y,
          width: vRect.width,
          height: vRect.height
        };
      } else if (currentSelection.tagName && currentSelection.tagName.toLowerCase() === 'svg') {
        // For SVG paths, we don't need viewport rect (path is already in pixel coords)
        // The path element inside contains the actual drawing
        const pathElement = currentSelection.querySelector('path');
        if (pathElement) {
          // Change stroke color to show it's confirmed
          pathElement.setAttribute('stroke', '#4CAF50');
          pathElement.setAttribute('fill', 'rgba(76, 175, 80, 0.3)');
        }
        // Disable pointer events - box is now read-only
        currentSelection.style.pointerEvents = 'none';
      }

      // Disable pointer events for all confirmed selections to prevent interference
      currentSelection.style.pointerEvents = 'none';
      currentSelection.style.cursor = 'default';

      this.confirmedRects.push({
        element: currentSelection,
        viewportRect: viewportRect
      });
    }
  }

  drawFreehandPath(points, closed = false) {
    // Remove existing current path
    this.clearCurrentSelectionRect();

    if (points.length < 2) return;

    // Create SVG path element
    const canvas = this.shadowRoot.getElementById('selection-canvas');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'current-selection-rect'; // Use same ID to be cleared by clearCurrentSelectionRect
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    // Create path data
    let pathData = points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ');

    // Close path if requested
    if (closed) {
      pathData += ' Z';
    }

    path.setAttribute('d', pathData);
    path.setAttribute('stroke', closed ? '#4CAF50' : '#FFC107'); // Green when closed
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', closed ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 193, 7, 0.2)');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');

    svg.appendChild(path);
    canvas.appendChild(svg);

    // Add a circle at start point to show where to snap
    if (!closed && points.length > 5) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', this.startPoint.x);
      circle.setAttribute('cy', this.startPoint.y);
      circle.setAttribute('r', '15');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#4CAF50');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('stroke-dasharray', '4,4');
      svg.appendChild(circle);
    }
  }

  clearSelection() {
    this.clearCurrentSelectionRect();
    this.startPoint = null;
    this.isSelecting = false;
    this.currentPath = [];
    this.pathClosed = false;
    this.currentSelectionData = null;

    // Remove any floating UI
    const floatingSelector = this.shadowRoot.querySelector('.annotation-type-selector-floating');
    if (floatingSelector) floatingSelector.remove();

    const sidebar = this.shadowRoot.querySelector('.comment-sidebar');
    if (sidebar) {
      sidebar.classList.remove('visible');
      setTimeout(() => sidebar.remove(), 300);
    }

    this.updateInfo('Selection cleared');
  }

  async loadImageSource(url) {
    try {
      // Try to detect if it's a manifest or direct image
      if (url.includes('manifest') || url.endsWith('.json')) {
        await this.loadManifest(url);
      } else {
        this.loadTileSource(url);
      }
    } catch (error) {
      console.error('Error loading image source:', error);
      this.updateInfo('Error loading image');
    }
  }

  async loadManifest(manifestUrl) {
    try {
      const response = await fetch(manifestUrl);
      const manifest = await response.json();

      this.manifestData = manifest;
      this.manifestUrl = manifestUrl;
      this.canvases = [];
      this.currentCanvasIndex = 0;

      // Extract and render metadata
      this.renderMetadata(manifest);

      // IIIF Presentation API 2.x or 3.x
      if (manifest.sequences && manifest.sequences[0]) {
        // IIIF 2.x
        const canvases = manifest.sequences[0].canvases;
        console.log('Parsing IIIF 2.x manifest:', canvases.length, 'canvases');

        this.canvases = canvases.map(canvas => {
          const resource = canvas.images && canvas.images[0] ? canvas.images[0].resource : null;
          let tileSource = null;

          if (resource) {
            // Try to get service (if exists)
            if (resource.service) {
              const service = Array.isArray(resource.service) ? resource.service[0] : resource.service;
              tileSource = service['@id'] || service.id;
            } else {
              // No service - use direct image URL
              tileSource = resource['@id'] || resource.id;
            }
          }

          return {
            id: canvas['@id'],
            label: canvas.label || 'Untitled',
            tileSource: tileSource,
            width: canvas.width,
            height: canvas.height
          };
        });
      } else if (manifest.items && manifest.items.length > 0) {
        // IIIF 3.x
        console.log('Parsing IIIF 3.x manifest:', manifest.items.length, 'canvases');

        this.canvases = manifest.items.map(canvas => {
          const anno = canvas.items[0].items[0];
          const service = anno.body.service ? (Array.isArray(anno.body.service) ? anno.body.service[0] : anno.body.service) : null;

          let tileSource = null;
          if (service) {
            tileSource = service.id || service['@id'];
          } else {
            // No service - use direct image URL
            tileSource = anno.body.id || anno.body['@id'];
          }

          return {
            id: canvas.id,
            label: this.extractLabel(canvas.label),
            tileSource: tileSource,
            width: canvas.width,
            height: canvas.height
          };
        });
      }

      console.log('Parsed canvases:', this.canvases.length);

      if (this.canvases.length > 0) {
        // Show navigation if multiple canvases
        if (this.canvases.length > 1) {
          this.showNavigation();
        } else {
          this.hideNavigation();
        }

        // Load canvas 18 (index 17) by default - it has transcription content
        // Fall back to canvas 0 if there aren't enough canvases
        const initialCanvas = this.canvases.length > 17 ? 17 : 0;
        this.loadCanvasByIndex(initialCanvas);
        this.updateInfo(`IIIF Manifest loaded (${this.canvases.length} canvas${this.canvases.length > 1 ? 'es' : ''})`);
      } else {
        throw new Error('No canvases found in manifest');
      }
    } catch (error) {
      console.error('Error loading manifest:', error);
      this.updateInfo('Error loading manifest: ' + error.message);
    }
  }

  extractLabel(label) {
    if (!label) return null;
    if (typeof label === 'string') return label;

    // Handle IIIF 3.x format: { "en": ["text"] } or { "en": "text" }
    if (typeof label === 'object' && !Array.isArray(label)) {
      // Try common language codes
      const langs = ['en', 'it', 'de', 'fr', 'es', '@none'];
      for (const lang of langs) {
        if (label[lang]) {
          const val = label[lang];
          return Array.isArray(val) ? val.join(', ') : val;
        }
      }

      // IIIF 2.x format: { "@value": "text", "@language": "en" }
      if (label['@value']) {
        return label['@value'];
      }

      // Fallback: get first key
      const keys = Object.keys(label);
      if (keys.length > 0) {
        const val = label[keys[0]];
        return Array.isArray(val) ? val.join(', ') : val;
      }
    }

    // Handle arrays
    if (Array.isArray(label)) {
      return label.map(l => this.extractLabel(l)).filter(Boolean).join(', ');
    }

    return null;
  }

  loadTileSource(tileSource) {
    try {
      if (!tileSource) {
        throw new Error('No tile source provided');
      }

      let source = tileSource;

      console.log('Loading tile source:', tileSource);

      // Handle different source types
      if (source.includes('/iiif/') && !source.match(/\.(jpg|png|jpeg)$/i)) {
        // IIIF Image API - needs /info.json
        if (!source.endsWith('info.json')) {
          source = source + '/info.json';
        }
        console.log('IIIF Image API source:', source);
        this.viewer.open(source);
      } else if (source.match(/\.(jpg|png|jpeg)$/i)) {
        // Direct image URL (e.g., Wikimedia Commons)
        console.log('Direct image URL - using simple tile source');
        this.viewer.open({
          type: 'image',
          url: source
        });
      } else {
        // Unknown format, try as-is
        console.log('Unknown source format, trying as-is');
        this.viewer.open(source);
      }

      this.updateInfo('Image loaded');
    } catch (error) {
      console.error('Error loading tile source:', error);
      this.updateInfo('Error loading image: ' + error.message);
    }
  }

  updateInfo(message) {
    const info = this.shadowRoot.getElementById('info');
    info.textContent = message;
  }

  // Canvas navigation methods
  loadCanvasByIndex(index) {
    if (index < 0 || index >= this.canvases.length) return;

    // Save current canvas selections before switching
    this.saveCurrentCanvasSelections();

    // Hide all current selections
    this.hideAllSelections();

    this.currentCanvasIndex = index;
    const canvas = this.canvases[index];

    // Load the canvas image
    if (canvas.tileSource) {
      this.loadTileSource(canvas.tileSource);
    }

    // Restore selections for the new canvas
    this.restoreCanvasSelections(index);

    // Update navigation UI
    this.updateNavigationUI();

    // Dispatch event for canvas change
    this.dispatchEvent(new CustomEvent('canvas-changed', {
      detail: {
        canvasIndex: index,
        canvasId: canvas.id,
        canvasLabel: canvas.label,
        totalCanvases: this.canvases.length,
        panelType: this.getAttribute('panel-type') || 'image' // Include panel type
      },
      bubbles: true,
      composed: true
    }));
  }

  previousCanvas() {
    if (this.currentCanvasIndex > 0) {
      this.loadCanvasByIndex(this.currentCanvasIndex - 1);
    }
  }

  nextCanvas() {
    if (this.currentCanvasIndex < this.canvases.length - 1) {
      this.loadCanvasByIndex(this.currentCanvasIndex + 1);
    }
  }

  showNavigation() {
    const nav = this.shadowRoot.getElementById('navigation');
    nav.classList.remove('hidden');
    this.updateNavigationUI();
  }

  hideNavigation() {
    const nav = this.shadowRoot.getElementById('navigation');
    nav.classList.add('hidden');
  }

  updateNavigationUI() {
    const prevBtn = this.shadowRoot.getElementById('prev-btn');
    const nextBtn = this.shadowRoot.getElementById('next-btn');
    const pageIndicator = this.shadowRoot.getElementById('page-indicator');
    const canvasLabel = this.shadowRoot.getElementById('canvas-label');

    // Update buttons state
    prevBtn.disabled = this.currentCanvasIndex === 0;
    nextBtn.disabled = this.currentCanvasIndex === this.canvases.length - 1;

    // Update page indicator
    pageIndicator.textContent = `${this.currentCanvasIndex + 1} / ${this.canvases.length}`;

    // Update canvas label
    if (this.canvases[this.currentCanvasIndex]) {
      canvasLabel.textContent = this.canvases[this.currentCanvasIndex].label;
    }
  }

  clearAllSelections() {
    // Remove all confirmed rectangles
    const canvas = this.shadowRoot.getElementById('selection-canvas');
    if (canvas) {
      const allRects = canvas.querySelectorAll('.selection-rect');
      allRects.forEach(rect => rect.remove());
    }
    this.confirmedRects = [];
    this.clearCurrentSelectionRect();
  }

  saveCurrentCanvasSelections() {
    // Save current confirmed rectangles for the current canvas
    if (this.confirmedRects.length > 0) {
      this.rectsByCanvas[this.currentCanvasIndex] = [...this.confirmedRects];
    }
  }

  hideAllSelections() {
    // Hide all rectangles instead of removing them
    this.confirmedRects.forEach(rectData => {
      if (rectData.element) {
        rectData.element.style.display = 'none';
      }
    });
  }

  restoreCanvasSelections(canvasIndex) {
    // Clear current confirmed rects array
    this.confirmedRects = [];

    // Restore selections for this canvas if they exist
    if (this.rectsByCanvas[canvasIndex]) {
      const savedRects = this.rectsByCanvas[canvasIndex];

      savedRects.forEach(rectData => {
        if (rectData.element) {
          // Show the element again
          rectData.element.style.display = 'block';

          // Add back to confirmed rects
          this.confirmedRects.push(rectData);
        }
      });

      // Update positions based on viewport
      this.updateConfirmedRectsPositions();
    }
  }

  updateConfirmedRectsPositions() {
    if (!this.viewer || !this.viewer.viewport) return;

    // Update positions of all confirmed rectangles based on current viewport
    this.confirmedRects.forEach(rectData => {
      const { element, viewportRect } = rectData;
      if (!element || !viewportRect) return;

      // Convert viewport coordinates back to pixel coordinates
      const pixelRect = this.viewer.viewport.viewportToViewerElementRectangle(
        new OpenSeadragon.Rect(
          viewportRect.x,
          viewportRect.y,
          viewportRect.width,
          viewportRect.height
        )
      );

      // Update element position and size
      element.style.left = pixelRect.x + 'px';
      element.style.top = pixelRect.y + 'px';
      element.style.width = pixelRect.width + 'px';
      element.style.height = pixelRect.height + 'px';
    });
  }

  getCurrentCanvas() {
    return this.canvases[this.currentCanvasIndex] || null;
  }

  getCurrentCanvasId() {
    const canvas = this.getCurrentCanvas();
    return canvas ? canvas.id : null;
  }

  // Metadata display methods
  toggleMetadata() {
    const panel = this.shadowRoot.getElementById('metadata-panel');
    const btn = this.shadowRoot.getElementById('toggle-metadata-btn');

    if (panel.classList.contains('visible')) {
      panel.classList.remove('visible');
      btn.title = 'Show Info';
    } else {
      panel.classList.add('visible');
      btn.title = 'Hide Info';
    }
  }

  renderMetadata(manifest) {
    const metadataContent = this.shadowRoot.getElementById('metadata-content');
    const metadataTitle = this.shadowRoot.getElementById('metadata-title');

    if (!manifest) {
      metadataContent.innerHTML = '<p>No metadata available</p>';
      return;
    }

    // Extract label
    const label = this.extractLabel(manifest.label) || 'Untitled';
    metadataTitle.textContent = label;

    let html = '';

    // Description
    if (manifest.description) {
      const desc = this.extractLabel(manifest.description);
      if (desc) {
        html += `<div class="metadata-item">
          <span class="metadata-label">Description:</span>
          <span class="metadata-value">${desc}</span>
        </div>`;
      }
    }

    // Attribution
    if (manifest.attribution) {
      const attr = this.extractLabel(manifest.attribution);
      if (attr) {
        html += `<div class="metadata-item">
          <span class="metadata-label">Attribution:</span>
          <span class="metadata-value">${attr}</span>
        </div>`;
      }
    }

    // Metadata array (IIIF 2.x and 3.x)
    if (manifest.metadata && Array.isArray(manifest.metadata)) {
      manifest.metadata.forEach(item => {
        const label = this.extractLabel(item.label);
        const value = this.extractLabel(item.value);
        if (label && value) {
          html += `<div class="metadata-item">
            <span class="metadata-label">${label}:</span>
            <span class="metadata-value">${value}</span>
          </div>`;
        }
      });
    }

    // License
    if (manifest.license) {
      const license = Array.isArray(manifest.license) ? manifest.license[0] : manifest.license;
      html += `<div class="metadata-item">
        <span class="metadata-label">License:</span>
        <span class="metadata-value"><a href="${license}" target="_blank">${license}</a></span>
      </div>`;
    }

    // Provider (IIIF 3.x)
    if (manifest.provider && Array.isArray(manifest.provider)) {
      manifest.provider.forEach(prov => {
        const provLabel = this.extractLabel(prov.label);
        if (provLabel) {
          html += `<div class="metadata-item">
            <span class="metadata-label">Provider:</span>
            <span class="metadata-value">${provLabel}</span>
          </div>`;
        }
      });
    }

    // Manifest URL
    if (this.manifestUrl) {
      html += `<div class="metadata-item">
        <span class="metadata-label">Manifest:</span>
        <span class="metadata-value"><a href="${this.manifestUrl}" target="_blank">${this.manifestUrl}</a></span>
      </div>`;
    }

    // Canvas count
    const canvasCount = this.canvases ? this.canvases.length : 0;
    html += `<div class="metadata-item">
      <span class="metadata-label">Canvas count:</span>
      <span class="metadata-value">${canvasCount}</span>
    </div>`;

    metadataContent.innerHTML = html || '<p>No metadata available</p>';
  }

  showFloatingAnnotationSelector(selectionRect, containerRect) {
    // Remove any existing selector
    const existing = this.shadowRoot.querySelector('.annotation-type-selector-floating');
    if (existing) existing.remove();

    const selector = document.createElement('div');
    selector.className = 'annotation-type-selector-floating';

    // Position to the right of the selection
    const left = selectionRect.right - containerRect.left + 10;
    const top = selectionRect.top - containerRect.top;
    selector.style.left = `${left}px`;
    selector.style.top = `${top}px`;

    // Create four buttons with SVG icons
    selector.innerHTML = `
      <button class="annotation-type-btn-floating" data-type="comment" title="Free comment">
        <svg viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button class="annotation-type-btn-floating" data-type="tag" title="Tag">
        <svg viewBox="0 0 24 24">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <circle cx="7" cy="7" r="1"/>
        </svg>
      </button>
      <button class="annotation-type-btn-floating" data-type="link" title="Link to text">
        <svg viewBox="0 0 24 24">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </button>
      <button class="annotation-type-btn-floating delete" data-type="delete" title="Delete selection">
        <svg viewBox="0 0 24 24">
          <path d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        </svg>
      </button>
    `;

    const container = this.shadowRoot.querySelector('.viewer-container');
    container.appendChild(selector);

    // Add click listeners
    const buttons = selector.querySelectorAll('.annotation-type-btn-floating');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.type;
        selector.remove();
        this.handleImageAnnotationType(type);
      });
    });
  }

  handleImageAnnotationType(type) {
    if (!this.currentSelectionData) return;

    const selectionData = this.currentSelectionData;

    if (type === 'delete') {
      // Remove the current selection
      this.clearCurrentSelectionRect();
      this.currentSelectionData = null;
      this.updateInfo('Selection deleted');
      return;
    }

    if (type === 'comment') {
      // Show comment sidebar
      this.showCommentSidebar(selectionData);
    } else if (type === 'tag') {
      // For tag, confirm the rectangle and create standalone annotation
      this.confirmCurrentRect();

      // Get the confirmed element
      const allConfirmedRects = this.shadowRoot.querySelectorAll('.selection-rect.confirmed, svg.confirmed');
      const confirmedElement = allConfirmedRects[allConfirmedRects.length - 1];

      // Tag placeholder
      this.dispatchEvent(new CustomEvent('image-annotation-created', {
        detail: {
          element: confirmedElement,
          selection: selectionData,
          annotationType: 'tag',
          body: '[Tag functionality - coming soon]'
        },
        bubbles: true,
        composed: true
      }));
      this.updateInfo('Tag annotation (placeholder)');
      this.currentSelectionData = null;

    } else if (type === 'link') {
      // For linking, dispatch the normal event for entity linking
      this.dispatchEvent(new CustomEvent('image-region-selected', {
        detail: selectionData,
        bubbles: true,
        composed: true
      }));

      this.updateInfo('Image ready to link');
      this.currentSelectionData = null;
    }
  }

  showCommentSidebar(selectionData) {
    // Remove any existing sidebar
    const existing = this.shadowRoot.querySelector('.comment-sidebar');
    if (existing) existing.remove();

    const container = this.shadowRoot.querySelector('.viewer-container');

    // Create sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'comment-sidebar';

    sidebar.innerHTML = `
      <div class="comment-sidebar-header">
        <span>Add Comment</span>
        <button class="comment-sidebar-close">
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="comment-sidebar-content">
        <textarea placeholder="Enter your comment..." id="comment-textarea"></textarea>
      </div>
      <div class="comment-sidebar-buttons">
        <button id="sidebar-comment-cancel">Cancel</button>
        <button id="sidebar-comment-save">Save</button>
      </div>
    `;

    container.appendChild(sidebar);

    // Trigger animation
    setTimeout(() => sidebar.classList.add('visible'), 10);

    const textarea = sidebar.querySelector('#comment-textarea');
    const closeBtn = sidebar.querySelector('.comment-sidebar-close');
    const cancelBtn = sidebar.querySelector('#sidebar-comment-cancel');
    const saveBtn = sidebar.querySelector('#sidebar-comment-save');

    textarea.focus();

    const closeSidebar = () => {
      sidebar.classList.remove('visible');
      setTimeout(() => sidebar.remove(), 300);
    };

    closeBtn.addEventListener('click', () => {
      closeSidebar();
      this.clearCurrentSelectionRect();
      this.currentSelectionData = null;
      this.updateInfo('Comment cancelled');
    });

    cancelBtn.addEventListener('click', () => {
      closeSidebar();
      this.clearCurrentSelectionRect();
      this.currentSelectionData = null;
      this.updateInfo('Comment cancelled');
    });

    saveBtn.addEventListener('click', () => {
      const comment = textarea.value.trim();
      if (!comment) {
        return;
      }

      closeSidebar();

      // Confirm the rectangle
      this.confirmCurrentRect();

      // Get the confirmed element
      const allConfirmedRects = this.shadowRoot.querySelectorAll('.selection-rect.confirmed, svg.confirmed');
      const confirmedElement = allConfirmedRects[allConfirmedRects.length - 1];

      // Dispatch event
      this.dispatchEvent(new CustomEvent('image-annotation-created', {
        detail: {
          element: confirmedElement,
          selection: selectionData,
          annotationType: 'comment',
          body: comment
        },
        bubbles: true,
        composed: true
      }));

      this.updateInfo(`Comment saved`);
      this.currentSelectionData = null;
    });
  }
}

customElements.define('iiif-image-panel', IIIFImagePanel);
