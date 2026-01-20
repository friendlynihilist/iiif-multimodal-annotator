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
    this.startPoint = null;
    this.currentRect = null;
    this.overlayElement = null;
    this.confirmedRects = []; // Store all confirmed (persistent) rectangles
  }

  static get observedAttributes() {
    return ['manifest', 'tileSources'];
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
          min-width: 200px;
          padding: calc(var(--spacing-unit) * 0.75);
          border: 1px solid var(--color-gray-200);
          border-radius: 0;
          font-size: 0.8rem;
        }

        button {
          padding: calc(var(--spacing-unit) * 0.75) calc(var(--spacing-unit) * 1.25);
          border: 1px solid var(--color-gray-200);
          border-radius: 0;
          background: var(--color-white);
          cursor: pointer;
          font-size: 0.75rem;
          transition: none;
        }

        button:hover {
          background: var(--color-black);
          color: var(--color-white);
          border-color: var(--color-black);
        }

        button.active {
          background: #4CAF50;
          color: var(--color-white);
          border-color: #4CAF50;
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
          z-index: 1000;
          cursor: crosshair;
          display: none;
          overflow: hidden;
        }

        #selection-canvas.active {
          display: block;
        }

        .selection-rect {
          position: absolute;
          border: 2px solid #4CAF50;
          background: rgba(76, 175, 80, 0.2);
          pointer-events: none;
          z-index: 1001;
        }

        .selection-rect.confirmed {
          border: 2px solid #388E3C;
          background: rgba(56, 142, 60, 0.3);
          z-index: 1000;
          cursor: grab;
          transition: none;
          pointer-events: auto;
        }

        .selection-rect.confirmed:hover {
          border: 3px solid #2E7D32;
          background: rgba(46, 125, 50, 0.4);
          box-shadow: none;
        }

        .selection-rect.confirmed:active {
          cursor: grabbing;
        }

        /* Modality colors for image boxes */
        .selection-rect.confirmed.denotation {
          border: 2px solid #2196F3;
          background: rgba(33, 150, 243, 0.3);
        }

        .selection-rect.confirmed.denotation:hover {
          border: 3px solid #1976D2;
          background: rgba(25, 118, 210, 0.4);
          box-shadow: none;
        }

        .selection-rect.confirmed.dynamisation {
          border: 2px solid #FF5722;
          background: rgba(255, 87, 34, 0.3);
        }

        .selection-rect.confirmed.dynamisation:hover {
          border: 3px solid #E64A19;
          background: rgba(230, 74, 25, 0.4);
          box-shadow: none;
        }

        .selection-rect.confirmed.integration {
          border: 2px solid #9C27B0;
          background: rgba(156, 39, 176, 0.3);
        }

        .selection-rect.confirmed.integration:hover {
          border: 3px solid #7B1FA2;
          background: rgba(123, 31, 162, 0.4);
          box-shadow: none;
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
      </style>

      <div class="container">
        <div class="controls">
          <input
            type="text"
            id="manifest-input"
            placeholder="IIIF Manifest URL or Image URL"
          />
          <button id="load-btn">Load</button>
          <button id="select-btn">Select Region</button>
          <button id="clear-selection-btn">Clear Selection</button>
          <span class="info" id="info">No image loaded</span>
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
    const clearSelectionBtn = this.shadowRoot.getElementById('clear-selection-btn');
    const manifestInput = this.shadowRoot.getElementById('manifest-input');

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
    clearSelectionBtn.addEventListener('click', () => this.clearSelection());

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
      selectBtn.textContent = 'Selection Active ✓';
      selectionCanvas.classList.add('active');
      this.updateInfo('Click and drag to select a region');
    } else {
      selectBtn.classList.remove('active');
      selectBtn.textContent = 'Select Region';
      selectionCanvas.classList.remove('active');
      this.updateInfo('Selection mode disabled');
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

    // Calculate rectangle
    const x = Math.min(this.startPoint.x, currentPoint.x);
    const y = Math.min(this.startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - this.startPoint.x);
    const height = Math.abs(currentPoint.y - this.startPoint.y);

    this.drawSelectionRect(x, y, width, height);
  }

  onMouseUp(e) {
    if (!this.isDrawing || !this.isSelecting || !this.startPoint) return;

    const rect = e.currentTarget.getBoundingClientRect();

    // Clamp end point to stay within canvas bounds
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

    // Convert to image coordinates
    const imageWidth = this.viewer.world.getItemAt(0)?.source.dimensions?.x || 1000;
    const imageHeight = this.viewer.world.getItemAt(0)?.source.dimensions?.y || 1000;

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

      // Get the current image source
      const source = this.viewer.world.getItemAt(0)?.source;
      const imageUrl = source?.['@id'] || source?.id || this.getAttribute('tileSources') || '';

      const selectionData = {
        source: imageUrl,
        selector: selector,
        region: { x, y, w, h },
        viewport: {
          x: viewportRect.x,
          y: viewportRect.y,
          width: viewportRect.width,
          height: viewportRect.height
        }
      };

      // Dispatch event
      this.dispatchEvent(new CustomEvent('image-region-selected', {
        detail: selectionData,
        bubbles: true,
        composed: true
      }));

      this.updateInfo(`Region selected: ${w}x${h} at (${x}, ${y})`);
    }

    this.isSelecting = false;
    this.startPoint = null;
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
    // Make the current selection rectangle permanent
    const currentRect = this.shadowRoot.getElementById('current-selection-rect');
    if (currentRect) {
      // Change ID so it won't be removed by clearCurrentSelectionRect
      currentRect.id = `confirmed-rect-${this.confirmedRects.length}`;
      currentRect.classList.add('confirmed');
      this.confirmedRects.push(currentRect);
    }
  }

  clearSelection() {
    this.clearCurrentSelectionRect();
    this.startPoint = null;
    this.isSelecting = false;
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

      // IIIF Presentation API 2.x or 3.x
      let tileSource;

      if (manifest.sequences && manifest.sequences[0]) {
        // IIIF 2.x
        const canvas = manifest.sequences[0].canvases[0];
        tileSource = canvas.images[0].resource.service['@id'] || canvas.images[0].resource.service.id;
      } else if (manifest.items && manifest.items[0]) {
        // IIIF 3.x
        const canvas = manifest.items[0];
        const anno = canvas.items[0].items[0];
        tileSource = anno.body.service[0].id || anno.body.service[0]['@id'];
      }

      if (tileSource) {
        this.loadTileSource(tileSource);
        this.updateInfo('IIIF Manifest loaded');
      } else {
        throw new Error('Could not parse manifest');
      }
    } catch (error) {
      console.error('Error loading manifest:', error);
      this.updateInfo('Error loading manifest');
    }
  }

  loadTileSource(tileSource) {
    try {
      // Ensure IIIF Image API URLs have /info.json
      let source = tileSource;
      if (source.includes('iiif') && !source.endsWith('info.json') && !source.endsWith('.jpg') && !source.endsWith('.png')) {
        source = source + '/info.json';
      }

      this.viewer.open(source);
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
}

customElements.define('iiif-image-panel', IIIFImagePanel);
