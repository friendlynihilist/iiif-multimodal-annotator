/**
 * Main container component for IIIF INTERIM Annotator
 * Manages text and image panels with annotation synchronization
 */
export class IIIFInterimAnnotator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.annotations = [];
    this.selectedTextRange = null;
    this.selectedImageRegion = null;
    this.connections = []; // Store connections for redrawing
    this.draggingFrom = null; // Track what element we're dragging from
    this.tempPath = null; // Temporary line following mouse
    this.unlinkedTextElements = []; // Text elements not yet linked
    this.unlinkedImageRects = []; // Image rects not yet linked
    this.panels = []; // Dynamic panel configuration
    this.panelIdCounter = 0;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.setupScrollListeners();
    this.initializePanels();
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
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          width: 100%;
          height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
          background: #ffffff;
          --color-black: #000000;
          --color-white: #ffffff;
          --color-gray-100: #f5f5f5;
          --color-gray-200: #e5e5e5;
          --color-gray-300: #d4d4d4;
          --color-gray-700: #404040;
          --color-accent: #000000;
          --spacing-unit: 8px;
        }

        .sidebar {
          position: fixed;
          left: 0;
          top: 0;
          width: 48px;
          height: 100vh;
          background: var(--color-black);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: calc(var(--spacing-unit) * 1.5) 0;
          gap: calc(var(--spacing-unit) * 1);
          border-right: 1px solid var(--color-black);
          z-index: 1000;
        }

        .sidebar-btn {
          width: 32px;
          height: 32px;
          border: 1px solid var(--color-white);
          border-radius: 0;
          background: transparent;
          color: var(--color-white);
          font-size: 1.2rem;
          font-weight: 300;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: none;
        }

        .sidebar-btn:hover {
          background: var(--color-white);
          color: var(--color-black);
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
          width: 32px;
          height: 32px;
          border: 1px solid var(--color-white);
          border-radius: 0;
          background: transparent;
          color: var(--color-white);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          font-weight: 400;
          cursor: pointer;
          transition: none;
          position: relative;
        }

        .panel-item svg {
          width: 16px;
          height: 16px;
          stroke: var(--color-white);
        }

        .panel-item:hover {
          background: var(--color-white);
          color: var(--color-black);
        }

        .panel-item:hover svg {
          stroke: var(--color-black);
        }

        .panel-item.active {
          background: var(--color-white);
          color: var(--color-black);
        }

        .panel-item.active svg {
          stroke: var(--color-black);
        }

        .panel-item .remove-btn {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 12px;
          height: 12px;
          border: 1px solid var(--color-black);
          border-radius: 0;
          background: var(--color-white);
          color: var(--color-black);
          font-size: 0.6rem;
          display: none;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          line-height: 1;
        }

        .panel-item:hover .remove-btn {
          display: flex;
        }

        .container {
          display: flex;
          width: calc(100% - 48px);
          height: calc(100vh - 40px);
          gap: 0;
          padding: 0;
          position: relative;
          margin-left: 48px;
        }

        .panels-area {
          display: flex;
          gap: 0;
          flex: 1;
          padding-bottom: 40px;
        }

        .panel {
          flex: 1;
          background: var(--color-white);
          border-right: 1px solid var(--color-gray-200);
          border-radius: 0;
          box-shadow: none;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-width: 320px;
          max-height: 100%;
        }

        .panel:last-child {
          border-right: none;
        }

        .panel-header {
          padding: calc(var(--spacing-unit) * 1.5);
          border-bottom: 1px solid var(--color-gray-200);
          font-weight: 400;
          font-size: 0.9rem;
          background: var(--color-white);
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: grab;
          user-select: none;
          transition: none;
        }

        .panel-header:active {
          cursor: grabbing;
        }

        .panel-header:hover {
          background: var(--color-gray-100);
        }

        .panel-header .panel-title {
          flex: 1;
          pointer-events: none;
          display: flex;
          align-items: center;
          gap: calc(var(--spacing-unit) * 1);
        }

        .panel-header .panel-title svg {
          flex-shrink: 0;
        }

        .panel-header .close-panel {
          width: 20px;
          height: 20px;
          border: 1px solid var(--color-gray-300);
          background: transparent;
          color: var(--color-gray-700);
          font-size: 1.2rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 0;
          pointer-events: auto;
          transition: none;
        }

        .panel-header .close-panel:hover {
          background: var(--color-black);
          color: var(--color-white);
          border-color: var(--color-black);
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
          background: var(--color-white);
          padding: calc(var(--spacing-unit) * 1.5) calc(var(--spacing-unit) * 2);
          border-top: 1px solid var(--color-gray-200);
          box-shadow: none;
          display: flex;
          gap: calc(var(--spacing-unit) * 1.5);
          align-items: center;
          z-index: 999;
        }

        .toolbar button {
          padding: calc(var(--spacing-unit) * 1) calc(var(--spacing-unit) * 1.5);
          border: 1px solid var(--color-black);
          border-radius: 0;
          background: var(--color-black);
          color: var(--color-white);
          cursor: pointer;
          font-weight: 400;
          font-size: 0.85rem;
          transition: none;
        }

        .toolbar button:hover {
          background: var(--color-white);
          color: var(--color-black);
        }

        .toolbar button:disabled {
          background: var(--color-gray-300);
          border-color: var(--color-gray-300);
          color: var(--color-gray-700);
          cursor: not-allowed;
        }

        .status {
          color: var(--color-gray-700);
          font-size: 0.8rem;
          margin-left: auto;
        }

        .copyright {
          color: var(--color-gray-700);
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
          z-index: 9999;
          overflow: visible;
        }

        .container {
          position: relative;
        }

        .connection-line {
          fill: none;
          stroke-width: 1.5;
          opacity: 1;
          filter: none;
          will-change: d;
        }

        .connection-line.denotation {
          stroke: #2196F3;
        }

        .connection-line.dynamisation {
          stroke: #FF5722;
        }

        .connection-line.integration {
          stroke: #9C27B0;
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

        .modality-selector {
          position: fixed;
          background: var(--color-white);
          border: 1px solid var(--color-black);
          border-radius: 0;
          padding: calc(var(--spacing-unit) * 2);
          box-shadow: none;
          z-index: 10000;
          display: none;
        }

        .modality-selector.active {
          display: block;
        }

        .modality-selector h3 {
          margin: 0 0 calc(var(--spacing-unit) * 1.5) 0;
          font-size: 0.85rem;
          font-weight: 400;
        }

        .modality-buttons {
          display: flex;
          gap: calc(var(--spacing-unit) * 1);
          flex-direction: column;
        }

        .modality-btn {
          padding: calc(var(--spacing-unit) * 1.5) calc(var(--spacing-unit) * 2);
          border: 1px solid;
          border-radius: 0;
          cursor: pointer;
          font-weight: 400;
          font-size: 0.85rem;
          transition: none;
          text-align: left;
        }

        .modality-btn:hover {
          transform: none;
        }

        .modality-btn.denotation {
          background: var(--color-white);
          border-color: #2196F3;
          color: #2196F3;
        }

        .modality-btn.denotation:hover {
          background: #2196F3;
          color: var(--color-white);
        }

        .modality-btn.dynamisation {
          background: var(--color-white);
          border-color: #FF5722;
          color: #FF5722;
        }

        .modality-btn.dynamisation:hover {
          background: #FF5722;
          color: var(--color-white);
        }

        .modality-btn.integration {
          background: var(--color-white);
          border-color: #9C27B0;
          color: #9C27B0;
        }

        .modality-btn.integration:hover {
          background: #9C27B0;
          color: var(--color-white);
        }

        .add-panel-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: var(--color-white);
          border: 1px solid var(--color-black);
          border-radius: 0;
          padding: calc(var(--spacing-unit) * 3);
          box-shadow: none;
          z-index: 10001;
          display: none;
          min-width: 300px;
        }

        .add-panel-modal.active {
          display: block;
        }

        .add-panel-modal h3 {
          margin: 0 0 calc(var(--spacing-unit) * 2) 0;
          font-size: 1rem;
          font-weight: 400;
          color: var(--color-black);
        }

        .panel-type-buttons {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing-unit) * 1);
        }

        .panel-type-btn {
          padding: calc(var(--spacing-unit) * 1.5);
          border: 1px solid var(--color-gray-300);
          border-radius: 0;
          background: var(--color-white);
          cursor: pointer;
          transition: none;
          text-align: left;
          display: flex;
          align-items: center;
          gap: calc(var(--spacing-unit) * 1.5);
        }

        .panel-type-btn .icon {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .panel-type-btn .icon svg {
          width: 20px;
          height: 20px;
        }

        .panel-type-btn .label {
          flex: 1;
        }

        .panel-type-btn:hover {
          border-color: var(--color-black);
          background: var(--color-gray-100);
        }

        .panel-type-btn strong {
          display: block;
          color: var(--color-black);
          font-weight: 400;
          margin-bottom: calc(var(--spacing-unit) * 0.5);
        }

        .panel-type-btn small {
          color: var(--color-gray-700);
          font-size: 0.8rem;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.4);
          z-index: 10000;
          display: none;
        }

        .modal-overlay.active {
          display: block;
        }
      </style>

      <div class="sidebar">
        <button class="sidebar-btn add" id="add-panel-btn" title="Add Panel">+</button>
        <div class="panel-list" id="panel-list"></div>
      </div>

      <div class="container">
        <svg id="connection-overlay"></svg>
        <div class="panels-area" id="panels-area"></div>
      </div>

      <div class="toolbar">
        <button id="export-btn">Export Annotations</button>
        <span class="status" id="status">Ready - Select and confirm text/image, then drag to link</span>
        <span class="copyright">© 2026 Carlo Teo Pedretti</span>
      </div>

      <div class="modality-selector" id="modality-selector">
        <h3>Select Ekphrastic Modality:</h3>
        <div class="modality-buttons">
          <button class="modality-btn denotation" data-modality="denotation">
            <strong>Denotation</strong><br>
            <small>geko:denotation - Direct reference</small>
          </button>
          <button class="modality-btn dynamisation" data-modality="dynamisation">
            <strong>Dynamisation</strong><br>
            <small>geko:dynamisation - Movement/temporal</small>
          </button>
          <button class="modality-btn integration" data-modality="integration">
            <strong>Integration</strong><br>
            <small>geko:integration - Interpretive blend</small>
          </button>
        </div>
      </div>

      <div class="modal-overlay" id="modal-overlay"></div>
      <div class="add-panel-modal" id="add-panel-modal">
        <h3>Add New Panel</h3>
        <div class="panel-type-buttons">
          <button class="panel-type-btn" data-type="text">
            <span class="icon">${this.getPanelIcon('text')}</span>
            <span class="label">
              <strong>Text Panel</strong>
              <small>For annotating textual content</small>
            </span>
          </button>
          <button class="panel-type-btn" data-type="image">
            <span class="icon">${this.getPanelIcon('image')}</span>
            <span class="label">
              <strong>Image Panel</strong>
              <small>For IIIF images and paintings</small>
            </span>
          </button>
          <button class="panel-type-btn" data-type="facsimile">
            <span class="icon">${this.getPanelIcon('facsimile')}</span>
            <span class="label">
              <strong>Facsimile Panel</strong>
              <small>For manuscript facsimiles</small>
            </span>
          </button>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const exportBtn = this.shadowRoot.getElementById('export-btn');
    const modalityButtons = this.shadowRoot.querySelectorAll('.modality-btn');
    const addPanelBtn = this.shadowRoot.getElementById('add-panel-btn');
    const modalOverlay = this.shadowRoot.getElementById('modal-overlay');
    const addPanelModal = this.shadowRoot.getElementById('add-panel-modal');
    const panelTypeButtons = this.shadowRoot.querySelectorAll('.panel-type-btn');

    // Add panel button
    addPanelBtn.addEventListener('click', () => this.openAddPanelModal());

    // Close modal on overlay click
    modalOverlay.addEventListener('click', () => this.closeAddPanelModal());

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
      const { element, selection } = e.detail;
      this.unlinkedTextElements.push({ element, selection });
      this.makeDraggable(element, 'text');
      this.updateStatus(`Text ready to link (${this.unlinkedTextElements.length} unlinked)`);
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
        for (const panel of imagePanels) {
          const currentRect = panel.shadowRoot?.querySelector('#current-selection-rect');
          if (currentRect) {
            sourcePanel = panel;
            break;
          }
        }

        if (sourcePanel && typeof sourcePanel.confirmCurrentRect === 'function') {
          sourcePanel.confirmCurrentRect();
          const allConfirmedRects = sourcePanel.shadowRoot?.querySelectorAll('.selection-rect.confirmed');
          if (allConfirmedRects && allConfirmedRects.length > 0) {
            const rect = allConfirmedRects[allConfirmedRects.length - 1];
            this.unlinkedImageRects.push({ element: rect, selection: e.detail, panel: sourcePanel });
            this.makeDraggable(rect, 'image');
          }
        }
        this.updateStatus(`Image ready to link (${this.unlinkedImageRects.length} unlinked)`);
      }, 50);
    });

    exportBtn.addEventListener('click', () => this.exportAnnotations());

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
    const { textElement, imageRect, path, label } = connection;

    // Check if elements still exist
    if (!textElement || !imageRect || !path) return;

    // Get container bounds for relative positioning
    const container = this.shadowRoot.querySelector('.container');
    if (!container) return;
    const containerBounds = container.getBoundingClientRect();

    // Get element bounds
    const textBounds = textElement.getBoundingClientRect();
    const imageBounds = imageRect.getBoundingClientRect();

    // Calculate coordinates relative to container (SVG is position:absolute)
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
    this.draggingFrom = { element, type };
    element.style.cursor = 'grabbing';

    // Create temporary path
    const svg = this.shadowRoot.getElementById('connection-overlay');
    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('class', 'connection-line');
    this.tempPath.setAttribute('stroke', '#FFC107');
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
      // Store pending connection and show modality selector
      this.pendingConnection = {
        from: this.draggingFrom,
        to: target
      };

      // Position modality selector near mouse cursor
      const modalitySelector = this.shadowRoot.getElementById('modality-selector');
      modalitySelector.style.left = `${event.clientX + 20}px`;
      modalitySelector.style.top = `${event.clientY - 50}px`;
      modalitySelector.classList.add('active');

      this.updateStatus('Select ekphrastic modality...');
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
      if (this.isPointInBounds(event.clientX, event.clientY, bounds)) {
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
          bounds: bounds
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
      selection: closest.selection
    };
  }

  getElementBounds(element, type) {
    // Use getBoundingClientRect directly - it handles all offsets automatically
    return element.getBoundingClientRect();
  }

  isPointInBounds(x, y, bounds) {
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

  createConnectionBetween(from, to, modality = 'denotation') {
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

    // Property URI based on modality
    const modalityProperty = {
      denotation: 'http://w3id.org/geko/denotation',
      dynamisation: 'http://w3id.org/geko/dynamisation',
      integration: 'http://w3id.org/geko/integration'
    }[modality];

    // Create annotation
    const annotation = {
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
      target: {
        type: 'Image',
        source: imageSelection.source,
        selector: imageSelection.selector,
        class: 'lrmoo:F1_Work' // LRMoo Work class
      },
      property: modalityProperty,
      modality: modality,
      created: new Date().toISOString()
    };

    this.annotations.push(annotation);

    // Apply modality color to both elements
    textElement.classList.add(modality);
    imageRect.classList.add(modality);

    // Draw permanent connection line with modality
    this.drawConnectionLineBetween(textElement, imageRect, modality);

    // DON'T remove from unlinked lists - keep them draggable for multiple connections!
    // Elements stay draggable and can be connected multiple times

    this.dispatchEvent(new CustomEvent('annotation-created', {
      detail: annotation,
      bubbles: true,
      composed: true
    }));

    // Count connections for this text and image
    const textConnections = this.connections.filter(c => c.textElement === textElement).length;
    const imageConnections = this.connections.filter(c => c.imageRect === imageRect).length;

    this.updateStatus(`Connected via ${modality}! (Text: ${textConnections} links, Image: ${imageConnections} links)`);
  }

  drawConnectionLineBetween(textElement, imageRect, modality = 'denotation') {
    // Get container bounds for relative positioning
    const container = this.shadowRoot.querySelector('.container');
    if (!container) return;
    const containerBounds = container.getBoundingClientRect();

    // Use getBoundingClientRect directly for both elements
    const textBounds = textElement.getBoundingClientRect();
    const imageBounds = imageRect.getBoundingClientRect();

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
    label.textContent = `geko:${modality}`;

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

  exportAnnotations() {
    const annotationList = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'AnnotationCollection',
      label: 'INTERIM Annotations',
      created: new Date().toISOString(),
      items: this.annotations
    };

    const blob = new Blob([JSON.stringify(annotationList, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interim-annotations-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.updateStatus('Annotations exported');
  }

  getAnnotations() {
    return this.annotations;
  }

  loadAnnotations(annotations) {
    this.annotations = Array.isArray(annotations) ? annotations : [];
    this.updateStatus(`Loaded ${this.annotations.length} annotations`);
  }

  // Panel management methods
  initializePanels() {
    // Initialize with default panels if no panels are defined
    if (this.panels.length === 0) {
      // Text panel with sample text
      this.addPanel('text', {
        label: 'Text',
        text: `Raphael's "School of Athens" is one of the most famous frescoes of the Renaissance period. Painted between 1509 and 1511, it represents philosophy and depicts many ancient Greek philosophers.

The central figures are Plato and Aristotle. Plato points upward to the heavens, representing his theory of Forms, while Aristotle gestures toward the earth, emphasizing empirical knowledge and ethics.

The fresco demonstrates Raphael's mastery of perspective and his ability to organize numerous figures in a coherent architectural space. The architecture itself, with its coffered barrel vault, represents the classical ideal.

Among the other philosophers depicted are Socrates, Pythagoras, Euclid, and Ptolemy. Some scholars believe that Raphael included portraits of his contemporaries, including Leonardo da Vinci as Plato and Michelangelo as Heraclitus.`
      });

      // Facsimile panel with IIIF manuscript
      this.addPanel('facsimile', {
        label: 'Facsimile',
        tileSources: 'https://iiif.bodleian.ox.ac.uk/iiif/image/b5994701-fcda-4d33-b0a1-ca82c2c9e70b'
      });

      // Image panel with IIIF painting
      this.addPanel('image', {
        label: 'Painting',
        tileSources: 'https://iiif.bodleian.ox.ac.uk/iiif/image/fd20bca8-c608-41e5-a794-f2cffc78f6db'
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
      title.className = 'panel-title';
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
      return panel;
    } else if (type === 'image' || type === 'facsimile') {
      const panel = document.createElement('iiif-image-panel');
      if (config.tileSources) {
        panel.setAttribute('tileSources', config.tileSources);
      }
      if (config.manifest) {
        panel.setAttribute('manifest', config.manifest);
      }
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
}

customElements.define('iiif-interim-annotator', IIIFInterimAnnotator);
