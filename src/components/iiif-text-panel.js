/**
 * Text panel component for displaying and selecting text portions
 * Supports word-level and character-level selection
 */
export class IIIFTextPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.textContent = '';
    this.annotations = [];
    this.currentSelection = null;
    this.currentSelectionElement = null;
    this.confirmedElements = []; // Store all confirmed (green) text elements
  }

  static get observedAttributes() {
    return ['src', 'text'];
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();

    // Load text if src attribute is provided
    if (this.hasAttribute('src')) {
      this.loadTextFromUrl(this.getAttribute('src'));
    } else if (this.hasAttribute('text')) {
      this.setTextContent(this.getAttribute('text'));
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === 'src') {
      this.loadTextFromUrl(newValue);
    } else if (name === 'text') {
      this.setTextContent(newValue);
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
          font-size: 0.8rem;
          flex-shrink: 1;
          min-width: 100px;
          border: 1px solid var(--color-gray-200);
          border-radius: 0;
          padding: calc(var(--spacing-unit) * 0.5);
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
          box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.3);
        }

        .text-confirmed.dynamisation {
          background: #FF5722;
        }

        .text-confirmed.dynamisation:hover {
          background: #E64A19;
          box-shadow: 0 0 0 3px rgba(255, 87, 34, 0.3);
        }

        .text-confirmed.integration {
          background: #9C27B0;
        }

        .text-confirmed.integration:hover {
          background: #7B1FA2;
          box-shadow: 0 0 0 3px rgba(156, 39, 176, 0.3);
        }

        button {
          padding: calc(var(--spacing-unit) * 0.75) calc(var(--spacing-unit) * 1.25);
          border: 1px solid var(--color-gray-200);
          border-radius: 0;
          background: var(--color-white);
          cursor: pointer;
          font-size: 0.75rem;
          white-space: nowrap;
          flex-shrink: 0;
          transition: none;
        }

        button:hover:not(:disabled) {
          background: var(--color-black);
          color: var(--color-white);
          border-color: var(--color-black);
        }

        button:disabled {
          opacity: 0.5;
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

        .info {
          font-size: 0.7rem;
          color: var(--color-gray-700);
          width: 100%;
          flex-basis: 100%;
          margin-top: calc(var(--spacing-unit) * 0.5);
        }
      </style>

      <div class="container">
        <div class="controls">
          <input type="file" id="file-input" accept=".txt,.xml,.html" />
          <button id="confirm-selection-btn" disabled>Confirm Text Selection</button>
          <button id="clear-selection-btn">Clear Selection</button>
          <button id="clear-btn">Clear Text</button>
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
      this.setTextContent(text);
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
      this.setTextContent(e.target.result);
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

    // Add to confirmed elements list (these will persist)
    this.confirmedElements.push({
      element: this.currentSelectionElement,
      selection: this.currentSelection
    });

    // Dispatch event to parent annotator with element reference
    this.dispatchEvent(new CustomEvent('text-confirmed', {
      detail: {
        element: this.currentSelectionElement,
        selection: this.currentSelection
      },
      bubbles: true,
      composed: true
    }));

    // Store for later reference
    const savedSelection = this.currentSelection;
    const savedElement = this.currentSelectionElement;

    // Reset current selection (ready for next annotation)
    this.currentSelection = null;
    this.currentSelectionElement = null;

    // Disable confirm button
    const confirmBtn = this.shadowRoot.getElementById('confirm-selection-btn');
    confirmBtn.disabled = true;

    this.updateInfo(`Confirmed (green) - Ready to link or select next`);
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
}

customElements.define('iiif-text-panel', IIIFTextPanel);
