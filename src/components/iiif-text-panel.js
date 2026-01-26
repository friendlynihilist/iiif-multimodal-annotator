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

    // Listen for canvas changes from image panels
    // Wait a bit to avoid initial loading conflicts
    setTimeout(() => {
      window.addEventListener('canvas-changed', (e) => this.handleCanvasChange(e));
    }, 500);
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
          --color-black: #000000;
          --color-white: #ffffff;
          --color-gray-200: #e5e5e5;
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

        input[type="file"] {
          display: none;
        }

        .file-upload-btn {
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
        }

        .file-upload-btn svg {
          width: 18px;
          height: 18px;
          stroke: var(--color-black);
          fill: none;
          stroke-width: 1.5;
        }

        .file-upload-btn:hover {
          background: var(--color-black);
          border-color: var(--color-black);
        }

        .file-upload-btn:hover svg {
          stroke: var(--color-white);
        }

        .text-area {
          flex: 1;
          padding: calc(var(--spacing-unit) * 3);
          overflow-y: auto;
          line-height: 1.6;
          font-size: 0.95rem;
          user-select: text;
        }

        .text-area::selection {
          background: var(--color-gray-200);
        }

        .text-selected {
          background: #FFEB3B;
          cursor: pointer;
          transition: none;
          padding: 0.1rem 0.2rem;
          border-radius: 0;
        }

        .text-selected:hover {
          background: #FDD835;
        }

        .text-confirmed {
          background: #81C784;
          color: var(--color-white);
          cursor: grab;
          transition: none;
          padding: 0.1rem 0.2rem;
          border-radius: 0;
          box-shadow: none;
        }

        .text-confirmed:hover {
          background: #66BB6A;
          box-shadow: none;
          transform: none;
        }

        .text-confirmed:active {
          cursor: grabbing;
        }

        /* Modality colors for text boxes */
        .text-confirmed.denotation {
          background: #2196F3;
        }

        .text-confirmed.denotation:hover {
          background: #1976D2;
        }

        .text-confirmed.dynamisation {
          background: #FF5722;
        }

        .text-confirmed.dynamisation:hover {
          background: #E64A19;
        }

        .text-confirmed.integration {
          background: #9C27B0;
        }

        .text-confirmed.integration:hover {
          background: #7B1FA2;
        }

        .text-confirmed.transcription {
          background: #4CAF50;
        }

        .text-confirmed.transcription:hover {
          background: #388E3C;
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

        #confirm-selection-btn:not(:disabled) {
          background: #FFEB3B;
          border-color: #FFEB3B;
        }

        #confirm-selection-btn:not(:disabled):hover {
          background: #FDD835;
          border-color: #FDD835;
        }

        #confirm-selection-btn:not(:disabled):hover svg {
          stroke: var(--color-black);
        }

        .info {
          font-size: 0.7rem;
          color: var(--color-gray-700);
          width: 100%;
          flex-basis: 100%;
          margin-top: calc(var(--spacing-unit) * 0.5);
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

        /* Comment form */
        .comment-form {
          position: fixed;
          background: var(--color-white);
          border: 2px solid var(--color-black);
          padding: calc(var(--spacing-unit) * 2);
          z-index: 10000;
          min-width: 300px;
          box-shadow: 4px 4px 0 rgba(0,0,0,0.1);
        }

        .comment-form textarea {
          width: 100%;
          min-height: 100px;
          border: 1px solid var(--color-gray-200);
          padding: calc(var(--spacing-unit) * 1);
          font-family: inherit;
          font-size: 0.9rem;
          resize: vertical;
        }

        .comment-form-buttons {
          display: flex;
          gap: calc(var(--spacing-unit) * 1);
          margin-top: calc(var(--spacing-unit) * 1);
          justify-content: flex-end;
        }

        .comment-form button {
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
          <button id="confirm-selection-btn" disabled title="Confirm text selection">
            <svg viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7"/>
            </svg>
          </button>
          <button id="clear-selection-btn" title="Clear selection">
            <svg viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
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
    const confirmSelectionBtn = this.shadowRoot.getElementById('confirm-selection-btn');
    const clearSelectionBtn = this.shadowRoot.getElementById('clear-selection-btn');
    const textDisplay = this.shadowRoot.getElementById('text-display');

    fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    clearBtn.addEventListener('click', () => this.clearText());
    confirmSelectionBtn.addEventListener('click', () => this.confirmTextSelection());
    clearSelectionBtn.addEventListener('click', () => this.clearSelection());

    // Handle text selection
    textDisplay.addEventListener('mouseup', () => this.handleTextSelection());
  }

  async loadTextFromUrl(url) {
    try {
      const response = await fetch(url);
      const text = await response.text();

      // Detect if XML
      if (url.endsWith('.xml') || text.trim().startsWith('<?xml')) {
        this.parsePageXML(text);
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
        this.parsePageXML(content);
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

    // Enable confirm button
    const confirmBtn = this.shadowRoot.getElementById('confirm-selection-btn');
    confirmBtn.disabled = false;

    this.updateInfo(`Selected (yellow): "${selectedText.substring(0, 30)}${selectedText.length > 30 ? '...' : ''}"`);
  }

  confirmTextSelection() {
    if (!this.currentSelection || !this.currentSelectionElement) {
      return;
    }

    // Change highlight color from yellow to green
    this.currentSelectionElement.className = 'text-confirmed';

    // Store references
    const savedSelection = this.currentSelection;
    const savedElement = this.currentSelectionElement;

    // Show annotation type selector
    this.showAnnotationTypeSelector(savedElement, savedSelection);

    // Disable confirm button
    const confirmBtn = this.shadowRoot.getElementById('confirm-selection-btn');
    confirmBtn.disabled = true;

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
      this.showCommentForm(element, selection);
    } else if (type === 'tag') {
      this.showTagForm(element, selection);
    } else if (type === 'link') {
      // Use existing entity linking system
      this.addToConfirmedElements(element, selection);
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
    }

    // Reset current selection
    this.currentSelection = null;
    this.currentSelectionElement = null;
  }

  showCommentForm(element, selection) {
    // Create form positioned near the element
    const form = document.createElement('div');
    form.className = 'comment-form';

    const rect = element.getBoundingClientRect();
    const shadowRect = this.shadowRoot.host.getBoundingClientRect();
    form.style.left = `${rect.left - shadowRect.left + 20}px`;
    form.style.top = `${rect.bottom - shadowRect.top + 5}px`;

    form.innerHTML = `
      <textarea placeholder="Enter your comment..."></textarea>
      <div class="comment-form-buttons">
        <button id="comment-cancel">Cancel</button>
        <button id="comment-save">Save</button>
      </div>
    `;

    this.shadowRoot.appendChild(form);

    const textarea = form.querySelector('textarea');
    const cancelBtn = form.querySelector('#comment-cancel');
    const saveBtn = form.querySelector('#comment-save');

    textarea.focus();

    cancelBtn.addEventListener('click', () => {
      form.remove();
      // Remove the green highlight
      const parent = element.parentNode;
      const textNode = document.createTextNode(element.textContent);
      parent.replaceChild(textNode, element);
      parent.normalize();
      this.updateInfo(`Comment cancelled`);
    });

    saveBtn.addEventListener('click', () => {
      const comment = textarea.value.trim();
      if (!comment) {
        alert('Please enter a comment');
        return;
      }

      form.remove();

      // Add to confirmed elements
      this.addToConfirmedElements(element, selection);

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

      this.updateInfo(`Comment saved: "${comment.substring(0, 30)}${comment.length > 30 ? '...' : ''}"`);
    });
  }

  showTagForm(element, selection) {
    // Placeholder for now
    this.addToConfirmedElements(element, selection);

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
  }

  addToConfirmedElements(element, selection) {
    // Add to confirmed elements list (these will persist)
    this.confirmedElements.push({
      element: element,
      selection: selection
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

    // Disable confirm button
    const confirmBtn = this.shadowRoot.getElementById('confirm-selection-btn');
    confirmBtn.disabled = true;

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
}

customElements.define('iiif-text-panel', IIIFTextPanel);
