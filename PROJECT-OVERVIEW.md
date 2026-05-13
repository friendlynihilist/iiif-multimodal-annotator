# Multimodal Annotator — Project Overview (v1 code, pre-rebrand)

> **Purpose of this document.** A complete, self-contained briefing for an LLM (or a new developer) who has never seen this codebase. Reading this should be enough to navigate the source, understand the data flow, the UI layout, the annotation model, the ontologies in play, and the conventions used throughout the project — without having to read every file.
>
> **Naming note.** This document was written under the old name *IIIF INTERIM Annotator*. The rebrand to *Multimodal Annotator* (ADR 0001) is partial in Phase 1: external identifiers (custom element tag, package, repo) are renamed; internal class names, CSS classes, CSS variables, and custom event names stay put until Phase 3. Read this overview as documenting the **v1** code; for the **v2** plan read `CLAUDE.md`, `ROADMAP.md`, and `docs/architecture/ARCHITECTURE-v2.md`.

---

## 1. What this project is

**IIIF INTERIM Annotator** is a browser-based, framework-agnostic semantic annotator for **intermedial relations** — in particular, **ekphrasis** (literary descriptions of artworks). It lets a user open one or more textual sources (plain text, TEI XML, or PAGE XML transcriptions from Transkribus) **alongside** one or more IIIF image resources (manuscript facsimiles, paintings), and create **typed visual links** between text spans and image regions.

It is built on:

- **Web Components** (Custom Elements + Shadow DOM) — no framework dependency.
- **OpenSeadragon 4.1** — IIIF deep-zoom viewer.
- **Vite 5** — dev server and bundler.
- **W3C Web Annotation Data Model** as the export format (JSON-LD, `oa:Annotation`).
- An RDF ontology stack — **INTERIM / MIRO / GEKO / MLAO / ICON / HICO / CIDOC-CRM / LRMoo** — under which exported annotations are meant to be interpreted.

It is a **single-page** app: `examples/index.html` mounts a single `<iiif-interim-annotator>` element which spawns and orchestrates child panels.

Author: Carlo Teo Pedretti. License: MIT.

---

## 2. Repository layout

```
interim-annotator/
├── examples/                  # Vite root: the demo app
│   ├── index.html             # 32 lines — just mounts <iiif-interim-annotator>
│   ├── sample-text.txt
│   ├── metadata.xml           # Transkribus document metadata
│   ├── mets.xml               # METS map: page number → PAGE XML file
│   └── page/                  # 26 PAGE XML transcriptions, 0001..0026
│
├── public/                    # Vite publicDir (served from ../public)
│   ├── examples/              # mirror of examples/ for prod build
│   ├── images/                # seq1..seq5.jpg
│   ├── peirce-manifest.json
│   └── peirce-pragmatism.xml
│
├── src/
│   ├── index.js               # Entry point: registers the 3 custom elements
│   ├── components/
│   │   ├── iiif-interim-annotator.js   # Main orchestrator (2944 lines)
│   │   ├── iiif-text-panel.js          # Text panel + XML parsers (1323 lines)
│   │   └── iiif-image-panel.js         # OpenSeadragon panel (1753 lines)
│   └── utils/                 # currently empty
│
├── data/                      # Sample IIIF annotation lists (Bologna ms.)
├── ontology/
│   ├── interim.ttl            # The INTERIM ontology (Turtle)
│   └── model interim.jpg      # Conceptual diagram
│
├── dist/                      # Vite build output
├── package.json               # type: module
├── vite.config.js             # root=examples, publicDir=../public
├── netlify.toml
├── README.md                  # User-facing
├── MULTI-CANVAS-GUIDE.md      # How multi-canvas annotations work
├── PAGE-XML-GUIDE.md          # How PAGE XML / METS sync works
└── PROJECT-OVERVIEW.md        # ← this file
```

**Dev server:** `npm run dev` runs Vite with `root: 'examples'` and serves at `http://localhost:5173/`. The demo lives at `/` (which resolves to `examples/index.html`). `vite.config.js` aliases `/src` → `./src`, so `<script type="module" src="/src/index.js">` works.

**Build:** `npm run build` emits to `dist/`. `netlify.toml` is wired to deploy `dist`.

---

## 3. Component architecture

There are **exactly three** custom elements. All extend `HTMLElement` and use **open Shadow DOM**.

| Element                       | File                                  | Role                                        |
|-------------------------------|---------------------------------------|---------------------------------------------|
| `<iiif-interim-annotator>`    | `src/components/iiif-interim-annotator.js` | Top-level shell. Owns layout, sidebar, toolbar, modals, annotation store, and the SVG overlay that draws connection curves. |
| `<iiif-text-panel>`           | `src/components/iiif-text-panel.js`   | Loads/displays text or XML; handles text selection and per-line PAGE XML rendering. |
| `<iiif-image-panel>`          | `src/components/iiif-image-panel.js`  | Hosts an OpenSeadragon viewer; handles rectangle/freehand region selection and IIIF manifest navigation. |

The orchestrator **owns** the panels (it instantiates them in `renderPanels()` based on its `this.panels` array). Children communicate **upward** via bubbling `CustomEvent`s with `composed: true` (to cross shadow boundaries). The orchestrator never reads child state by reaching into shadow roots for control purposes — only for visual layout (finding rect positions, etc.).

### 3.1 Default boot

`initializePanels()` (in the orchestrator) seeds three panels on first connect:

```js
addPanel('text',      { label: 'Transcription', mets: '/examples/mets.xml',
                        pagexml: '/examples/page/0018_00018.xml' });
addPanel('facsimile', { label: 'Facsimile',
                        manifest: 'https://dl.ficlit.unibo.it/iiif/2/19266/manifest' });
addPanel('image',     { label: 'Painting',
                        manifest: 'https://iiif.europeana.eu/presentation/366/item_7PWBIM2OZFXYT5ZC5Y7IFXBZSNB7TOZ6/manifest' });
```

So out-of-the-box the user sees: **Transcription | Facsimile | Painting**. The defaults are hard-coded; there is no project-file format yet.

### 3.2 Panel types

- `text`     → `<iiif-text-panel>`
- `image`    → `<iiif-image-panel panel-type="image">`   (treated as **painting** — supports GEKO modalities)
- `facsimile`→ `<iiif-image-panel panel-type="facsimile">` (treated as **manuscript** — uses `transcribing` motivation, no modality picker)

The image panel's behaviour is identical at the DOM level; the **panel-type attribute** is what the orchestrator branches on to pick the annotation schema and the connection-line style.

---

## 4. UI layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  app-header  (48px, indigo #3b3f9f)                                 [?] │  ← about modal
├──┬──────────────────────────────────────────────────────────────────────┤
│  │  panels-area (flex row, each panel min-width 320px)                  │
│  │  ┌────────────────┬───────────────────┬──────────────────┐           │
│  │  │ Transcription  │ Facsimile         │ Painting         │           │
│  │  │ panel-header   │ panel-header      │ panel-header     │           │
│  │  │ ┌────────────┐ │ ┌───────────────┐ │ ┌──────────────┐ │           │
│ ╳ │  │ │ controls   │ │ │ controls      │ │ │ controls     │ │           │
│ + │  │ ├────────────┤ │ ├───────────────┤ │ ├──────────────┤ │           │
│ … │  │ │            │ │ │ navigation    │ │ │ navigation   │ │           │
│  │  │ │ text-area  │ │ │ help          │ │ │ help         │ │           │
│  │  │ │  (lines)   │ │ │ viewer-       │ │ │ viewer-      │ │           │
│  │  │ │            │ │ │  container    │ │ │  container   │ │           │
│  │  │ │            │ │ │ (OpenSeadr.)  │ │ │ (OpenSeadr.) │ │           │
│  │  │ └────────────┘ │ └───────────────┘ │ └──────────────┘ │           │
│  │  └────────────────┴───────────────────┴──────────────────┘           │
│  │                                                                      │
│  │  ← `#connection-overlay` SVG covers .container, z-index 10000        │
│  │     (pointer-events: none on container, all on its children)         │
├──┴──────────────────────────────────────────────────────────────────────┤
│  toolbar  (fixed bottom, left:48px, right:0)                            │
│  [⤓ export]  status…           © 2026 Carlo Teo Pedretti                │
└─────────────────────────────────────────────────────────────────────────┘
   ↑
   sidebar (fixed, width 48px, indigo): [+ add-panel]  then one .panel-item per panel
```

**Floating UI elements (z-index ladder):**

- `connection-overlay` SVG ........... 10 000  (lines, labels, indicators, radial menus)
- `modal-overlay` (backdrop) .......... 10 000
- `add-panel-modal`, `modality-selector` 10 001
- `connection-menu` ................... 10 001
- `about-modal` ....................... 10 002
- `sidebar-backdrop` .................. 99 999
- `annotation-sidebar` ................ 100 000

Note the **annotation sidebar lives at the orchestrator level** (recent commit `ff43c11`), not inside each panel — earlier versions had per-panel sidebars.

### 4.1 Design tokens (CSS custom props)

Defined on `:host` of `<iiif-interim-annotator>`:

```
--color-black: #3b3f9f    /* actually indigo, not black — kept for legacy */
--color-white: #f8f6f2    /* off-white background */
--color-gray-100..700
--color-accent: #6bd8a4
--spacing-unit: 8px
```

The look is **deliberately flat**: no border-radius, no box-shadow, `transition: none` almost everywhere, 1px borders, monochrome icons. Modality colors are the only chromatic accents.

### 4.2 Modality color palette (used end-to-end)

| Modality      | Color    | Meaning                                  | GEKO concept                    |
|---------------|----------|------------------------------------------|---------------------------------|
| `denotation`  | `#2196F3` blue   | Direct reference                  | `geko:denotation`              |
| `dynamisation`| `#FF5722` deep orange | Movement / temporal           | `geko:dynamisation`            |
| `integration` | `#9C27B0` purple | Interpretive blend                | `geko:integration`             |
| `transcription` | `#4CAF50` green dashed | Facsimile→text (not an ekphrastic modality, used for manuscript transcription links) | `oa:Motivation` `transcribing` |

These colors appear consistently in:
- The text "confirmed" highlight (`.text-confirmed.<modality>`)
- The image rectangle/SVG path border (`.selection-rect.confirmed.<modality>`, `svg.confirmed.<modality> path`)
- The SVG Bezier connection line (`.connection-line.<modality>`)
- The off-screen indicator dot (`.connection-indicator.<modality>`)
- The radial menu items (`.radial-menu-item.<modality>`)
- The "Select Ekphrastic Modality" modal buttons (`.modality-btn.<modality>`)

---

## 5. Annotation data model

### 5.1 Three annotation types (top-level UX choice)

When a user makes a text selection or image selection, a **floating bar** offers four actions:

1. **Comment** — opens the global sidebar; user types free text; produces a standalone annotation with `motivation: 'commenting'`.
2. **Tag** — placeholder, currently emits `body: '[Tag functionality - coming soon]'` and `motivation: 'tagging'`.
3. **Link (entity linking)** — turns the selection **green & draggable**; user drags from text → image (or vice versa) to create a typed connection.
4. **Delete** — discards the selection.

### 5.2 Standalone annotations (comment / tag)

Created by `createStandaloneAnnotation()` (text) / `createStandaloneImageAnnotation()` (image) in `iiif-interim-annotator.js`. They have no `body→target` link; the body holds the user comment and the target points to the source text or image region.

### 5.3 Linking annotations — two sub-flavors

Created by `createConnectionBetween(from, to, modality, panelType)` after a successful drag-and-drop. The orchestrator picks one of two schemas based on the **target panel's type**:

**A. Facsimile (panelType = `'facsimile'`) — "transcription"**

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "Annotation",
  "id": "annotation-<timestamp>",
  "motivation": "transcribing",
  "body": {
    "type": "TextualBody",
    "value": "<text>",
    "format": "text/plain",
    "selector": <TextPositionSelector | TextQuoteSelector | Choice>,
    "lineId": "<PAGE XML TextLine id, if any>",
    "coords": "<polygon points, if any>",
    "pageNr": "<int, if any>"
  },
  "target": {
    "type": "Image",
    "source": "<canvasId or image URL>",
    "selector": <FragmentSelector "xywh=…" | SvgSelector>,
    "canvasId": "...",
    "canvasIndex": <int>,
    "canvasLabel": "..."
  },
  "created": "<ISO-8601>"
}
```

**B. Painting/image (panelType = `'image'`) — INTERIM/GEKO ekphrastic relation**

Same shape, plus:
- `motivation: "linking"`
- `body.class: "lrmoo:F2_Expression"`
- `target.class: "lrmoo:F1_Work"`
- `property: "http://w3id.org/geko/<modality>"` (denotation / dynamisation / integration)
- `modality: "<modality>"`

### 5.4 Export format

`exportAnnotations()` downloads `interim-annotations-<ts>.json`:

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "AnnotationCollection",
  "label": "INTERIM Annotations",
  "created": "<ISO-8601>",
  "items": [ ...all annotations... ]
}
```

There is **no import**. `loadAnnotations(arr)` exists on the public API but the function only assigns to `this.annotations` and updates status — it does **not** re-render highlights or connection lines yet.

---

## 6. The connection-line system

This is the most intricate piece of the orchestrator. Three CSS coordinate systems have to stay in sync:

- The **text element**, scrolled inside a panel's `.text-area` (inside a shadow root).
- The **image rectangle / SVG path**, drawn on a `#selection-canvas` inside the image panel's shadow root, but whose pixel position is recomputed by OpenSeadragon every frame as the user pans/zooms.
- The **SVG `<path>` curve** in `#connection-overlay`, which lives at the orchestrator's `.container` level and uses container-relative coordinates.

### 6.1 Lifecycle

1. **Create.** When a connection is committed, `drawConnectionLineBetween(textEl, imageRect, modality)` creates a cubic Bezier `<path>` plus a `<text>` label and pushes onto `this.connections[]`:
   ```
   { textElement, imageRect, path, label, modality, annotationIndex }
   ```
2. **Update.** A `requestAnimationFrame` loop in `setupScrollListeners()` calls `updateAllConnections()` **every frame** (yes, every frame — intentionally, to track OpenSeadragon's continuous animations). Each call re-runs `updateConnectionLine(conn)`.
3. **Visibility / fade.** If either endpoint is `display:none`, the path hides. If the text endpoint is **scrolled out of its panel's viewport** (with a `fadeThreshold = 80px`), the path fades to `opacity: 0.1` and the system shows a **colored indicator dot** anchored on the image rect's top-right corner.
4. **Indicator stacking.** Multiple connections targeting the same image rect at the same modality share **one** indicator with a numeric badge. Modalities stack horizontally (denotation, dynamisation, integration, transcription).
5. **Radial menu.** Clicking an indicator with `count > 1` opens a SVG radial menu (`showRadialMenu`) listing previews of each connected text snippet (first 20 chars). Clicking an item runs `scrollToConnection(conn)` which smooth-scrolls the text-area to center the element.

### 6.2 Important gotchas baked into the code

- The path is drawn with container-relative coords using `getBoundingClientRect()` minus `container.getBoundingClientRect()`. Anything that breaks the `.container` positioning (margins, transforms on ancestors) will misalign the lines.
- For freehand selections (SVG), `imageBounds` uses the inner `<path>`'s `getBBox()` for tightness instead of the outer SVG box.
- `scrollToConnection` reads `textElement.offsetTop` — this only works because the text element is positioned relative to the scrolled `.text-area`.
- `isPointInBounds` for SVG paths tries `isPointInFill / isPointInStroke`, falls back to bbox+10px padding.
- `findDropTarget` picks the **closest** candidate by distance from cursor when multiple targets overlap.

---

## 7. Event surface

### 7.1 Events the orchestrator listens for (all bubbled from panels)

| Event                          | Source            | Detail                                              | What the orchestrator does |
|--------------------------------|-------------------|-----------------------------------------------------|-----------------------------|
| `text-confirmed`               | text panel        | `{element, selection, annotationType:'entity-linking'}` | Push to `unlinkedTextElements`, call `makeDraggable(el,'text')`. |
| `image-region-selected`        | image panel       | `{source, canvasId, canvasIndex, canvasLabel, selector, region/viewport/path}` | Call `panel.confirmCurrentRect()`, push to `unlinkedImageRects`, make draggable. |
| `annotation-created`           | text panel        | `{element, selection, annotationType, body}`        | Create standalone text annotation. |
| `image-annotation-created`     | image panel       | `{element, selection, annotationType, body}`        | Create standalone image annotation. |
| `show-comment-sidebar`         | text/image panel  | `{type, onCancel, onSave}`                          | Open `#annotation-sidebar` with a textarea. |
| `show-annotation-info`         | text/image panel  | `{type, title, message, onDelete}`                  | Open `#annotation-sidebar` in read/delete mode. |

### 7.2 Events the orchestrator emits

| Event                  | Detail                       | When                                      |
|------------------------|------------------------------|-------------------------------------------|
| `annotation-created`   | the annotation object        | After any annotation enters `this.annotations`. |
| `annotations-updated`  | `{annotations: [...]}`       | After standalone annotations. |

### 7.3 Window-level events (cross-panel sync)

`<iiif-image-panel>` dispatches **`canvas-changed`** on `window` (well, via bubble+composed; the panel uses `this.dispatchEvent`, then it bubbles to window via the DOM):

```
detail: { canvasIndex, canvasId, canvasLabel, totalCanvases, panelType }
```

`<iiif-text-panel>` subscribes via `window.addEventListener('canvas-changed', …)` and **only reacts when `panelType === 'facsimile'`** — this is what auto-loads the matching PAGE XML when the user pages through the manuscript. Painting-panel page flips do **not** affect the text panel.

---

## 8. Text panel internals (`iiif-text-panel.js`)

### 8.1 Observed attributes

```
src       → plain text or auto-detected XML
text      → inline text content
pagexml   → URL of a PAGE XML file
mets      → URL of a METS file (for page-number ↔ file mapping)
```

`connectedCallback` is **async**: METS must finish loading before PAGE XML, so the constructor order matters.

### 8.2 Text loading paths

- **Plain text** (`.txt` or non-XML content) → `setTextContent(text)`.
- **TEI XML** (`detectXMLType()` checks namespace `http://www.tei-c.org/ns/1.0`) → `parseTEIXML()` extracts the first 10 `<div type="page">` elements; recursively descends, handling `<lb>` (newline), `<add>` (brackets), `<del>` (skipped), `<gap>` (`[...]`), `<unclear>` (`[?]`).
- **PAGE XML** (presence of `<Page>` element) → `parsePageXML()`:
  - Extracts `pageNr` from `<TranskribusMetadata>`.
  - Builds `{id, coords, baseline, text}` for each `<TextLine>`.
  - `renderPageXML()` creates one container `<div data-page-nr>` per page and caches them in `this.pageContainers`. Only the current page's container is visible (`display: block`); others stay in the DOM hidden, so cross-page annotations persist when the user comes back.

### 8.3 Selection workflow

`mouseup` on the text-area:
1. Reads the shadow selection range.
2. Walks `preSelectionRange` to compute character `start/end` offsets within `this.textContent`.
3. Builds a `Choice` selector containing both a **TextPositionSelector** (start/end) and a **TextQuoteSelector** (exact + 50-char prefix/suffix).
4. Wraps the range in `<mark class="text-selected">` (yellow).
5. Inline-appends an `.annotation-type-selector` bar with 4 icon buttons.

Clicking a button routes to `handleAnnotationType()`:
- `comment` → emit `show-comment-sidebar` upstream.
- `tag`     → set class to `text-confirmed`, emit `annotation-created` with placeholder body.
- `link`    → set class to `text-confirmed`, emit `text-confirmed` (note: that's the *event name*, not the same as the CSS class).
- `delete`  → unwrap the mark.

Clicking an existing `.text-confirmed` opens `showAnnotationInfo()` (in-shadow popup) — earlier versions did this differently (see commit history).

### 8.4 METS-based page navigation

`loadMETS()` parses METS, indexes `<file SEQ="…">` → `<FLocat ns2:href|xlink:href|href>`. When a facsimile `canvas-changed` event arrives, the text panel computes `pageNr = canvasIndex + 1` and calls `loadPageByNumber(pageNr)`, which resolves the href to `/examples/<href>` and fetches that XML.

The hard-coded 26-page cap is enforced (`if (pageNr <= 26)`) because the bundled Transkribus export has 26 pages.

---

## 9. Image panel internals (`iiif-image-panel.js`)

### 9.1 Observed attributes

```
manifest    → IIIF Presentation API 2.x or 3.x manifest URL
tileSources → direct IIIF Image API or direct .jpg/.png URL
panel-type  → 'image' | 'facsimile' (default 'image')
```

### 9.2 Viewer setup

`initializeViewer()` creates an OpenSeadragon instance with:

- `showNavigationControl: true`, `showNavigator: true` (bottom-right minimap)
- `sequenceMode: false` — we drive navigation manually via canvas buttons.
- `minZoomLevel: 0.5`, `maxZoomLevel: 10`.
- `constrainDuringPan: false`, `visibilityRatio: 0.8`.
- `gestureSettingsMouse.clickToZoom: false`.

Listens to `animation` and `resize` events to call `updateConfirmedRectsPositions()` — this is what keeps rectangles glued to the image as you pan/zoom (it stores each rect's **viewport-rect**, not pixel coords, so they survive zoom changes).

### 9.3 Manifest parsing

`loadManifest()`:
- IIIF 2.x: walks `manifest.sequences[0].canvases[]`; pulls `images[0].resource.service[@id]` (or direct URL if no service).
- IIIF 3.x: walks `manifest.items[]`; pulls `items[0].items[0].body.service[id]` (or direct URL).
- Builds `this.canvases = [{id, label, tileSource, width, height}]`.
- **Default canvas:** `index 17 (page 18)` if it exists, otherwise `0`. This default exists because the Bologna manuscript's page 18 is the first one with substantive transcription. It applies to **every** manifest you load, which may be surprising for short manifests.

### 9.4 Selection (two modes)

Toggle "select region" → activates `#selection-canvas` overlay (transparent, `pointer-events: auto`).

- **Rectangle mode** (default): `mousedown/move/up` draws a `<div class="selection-rect">`. On `mouseup` (if w>5 && h>5), builds a `FragmentSelector` with `xywh=x,y,w,h` in **image-pixel coords** (converted from viewer coords via `viewerElementToViewportRectangle` × image dimensions).

- **Freehand mode** (toggle button next to select): builds a points array on `mousemove`, draws an SVG `<path>`. The path **auto-closes** if the cursor returns within 12px of the start *after* 40 points — `pathClosed` flips, the path turns green, and `mouseup` finalizes it. Builds an `SvgSelector` with the closed path string.

After a selection finishes, `showFloatingAnnotationSelector()` puts the same four-icon bar (comment / tag / link / delete) right next to the rect. `handleImageAnnotationType()` routes:
- `comment` → emit `show-comment-sidebar`.
- `tag`     → confirm rect, emit `image-annotation-created` placeholder.
- `link`    → emit `image-region-selected` (this is what the orchestrator catches).
- `delete`  → clear the rect.

### 9.5 Per-canvas selection persistence

When the user paginates:
1. `saveCurrentCanvasSelections()` snapshots `this.confirmedRects` into `this.rectsByCanvas[currentIndex]`.
2. `hideAllSelections()` sets `display:none` on every rect (does **not** remove from DOM).
3. New canvas loads, `restoreCanvasSelections(newIndex)` toggles them back to `display:block`.
4. `updateConfirmedRectsPositions()` re-pixelizes them against the new viewport.

This is why `updateConnectionLine` checks `offsetParent !== null` — it auto-hides connection paths for rects whose canvas isn't shown.

---

## 10. Ontology stack (TL;DR)

`ontology/interim.ttl` declares (with prefixes for each):

- **INTERIM** (core, this repo): `IntermedialRelation`, `IntermedialObject`, `Medium`, `producesObject`, `hasSourceMedium`, `hasTargetMedium`.
- **MIRO** (Bohnenkamp 2020): `MediaCombination`, `MediaTransposition`, `IntermedialReference`, `EkphrasticRelation`. MIRO equivalents are declared on INTERIM core classes/props.
- **GEKO** (this project's ekphrasis ontology): `Ekphrasis`, `MimeticEkphrasis`, `NotionalEkphrasis`; properties `hasTextualReferent` (→ `lrmoo:F2_Expression`), `hasIconicReferent` (→ `lrmoo:F1_Work`), `hasEkphrasticModality` (→ `skos:ConceptScheme`), `hasAuthor` (a property chain via LRMoo creation event). SKOS scheme `geko:modalitiesScheme` with concepts `denotation`, `dynamisation`, `integration` — **these are the three buttons in the modality picker**.
- **MLAO** (Multi-Level Annotation): `Anchor`, `hasAnchor`, `isAnchoredTo`, `hasConceptualLevel` (union over ICON levels).
- **ICON** (Panofsky-style): `PreiconographicalSubject`, `IconographicalSubject`, `IconologicalSubject`.
- **HICO**: `wasGeneratedBy` → `InterpretationAct` (provenance of the annotation).
- **W3C Web Annotation** (`oa:`) and **IIIF** (`sc:`) classes are imported.
- **CIDOC-CRM** + **LRMoo** as upper-level model.

The exported JSON-LD's `body.class` / `target.class` strings (`lrmoo:F2_Expression`, `lrmoo:F1_Work`) tie back to this ontology, but **the @context shipped is only `oa`** — there is no JSON-LD context that resolves the LRMoo / GEKO prefixes. Anyone consuming the export needs to supply one.

---

## 11. Public JS API

```js
const annotator = document.querySelector('iiif-interim-annotator');

annotator.getAnnotations();           // → Array
annotator.loadAnnotations(arr);       // stores in this.annotations only — no re-render yet
annotator.addPanel(type, config);     // type: 'text' | 'image' | 'facsimile'
annotator.removePanel(id);

annotator.addEventListener('annotation-created', e => e.detail);
annotator.addEventListener('annotations-updated', e => e.detail.annotations);
```

The two child elements also accept the attributes documented in §8.1 and §9.1; they can be used standalone if someone wanted to (they bubble events that the orchestrator would otherwise catch).

---

## 12. Known limitations / rough edges (read this before changing behaviour)

These are deliberate or accidental quirks already present in `main` — not bugs to chase blindly, but things to be aware of:

- **`loadAnnotations()` does not render.** Loading a saved set does **not** restore highlights or connection curves. It only fills the array. (Re-rendering would require resolving each `TextPositionSelector` back to a DOM range, and each `FragmentSelector` back to a viewport rect — neither is implemented.)
- **The 80px fade threshold** in `updateConnectionLine` is hard-coded; very short text panels can keep connections faded permanently.
- **rAF runs forever.** `setupScrollListeners` schedules a recursive `requestAnimationFrame` that never stops. CPU is non-trivial when many panels and connections exist. There's a `disconnectedCallback` cleanup but if the orchestrator stays mounted it just runs forever.
- **Page-18 default.** `loadCanvasByIndex(17)` is forced for any manifest with ≥18 canvases. For short manifests it falls back to 0. There is no attribute to override this.
- **METS path is hard-coded** to `/examples/<href>` (`loadPageByNumber`). Changing the deployment path breaks page sync.
- **`pageContainers` keyed by `pageNr`** as a string — if two PAGE XML files share a pageNr you get collisions.
- **`createAnnotation()` (the old, pre-drag flow) is dead code** but still present at line 2328. The live path is `createConnectionBetween()`.
- **`drawConnectionLine()` (no Between)** is also dead code (line 2422) — used by the old single-pair flow.
- **`isPointInBounds` SVG branch** can mis-detect on browsers without `isPointInFill`; the fallback uses bbox+10px padding which is permissive.
- **`tag` annotations are placeholders.** Body is the literal string `'[Tag functionality - coming soon]'`.
- **`highlightAnnotation()` in the text panel is a TODO**.
- **`utils/` directory is empty.**
- **Tooltips on the indigo header use `transition: none`** intentionally to match the flat aesthetic.
- **`window.addEventListener('canvas-changed', …)`** in the text panel is added after a `setTimeout(…, 500)` to avoid initial-load races; if you remove that delay the first paint can fight itself.
- **No persistence layer.** Refresh = annotations gone.
- **No undo/redo.**
- **No collaborative / multi-user features.**

---

## 13. How to extend (cheat sheet)

| Want to…                                | Where to touch                                                                                  |
|-----------------------------------------|-------------------------------------------------------------------------------------------------|
| Add a new panel type                    | `addPanel`, `getPanelLabel`, `getPanelIcon`, `createPanelElement` in `iiif-interim-annotator.js`. Add a new `panel-type-btn` in the add-panel modal. |
| Add a new ekphrastic modality           | Add CSS class blocks for `.text-confirmed.<x>`, `.selection-rect.confirmed.<x>`, `svg.confirmed.<x> path`, `.connection-line.<x>`, `.connection-indicator.<x>`, `.modality-btn.<x>`. Add a `<button class="modality-btn">` in the modality selector. Extend `modalityProperty` map in `createConnectionBetween`. Extend the indicator-index array `['denotation','dynamisation','integration','transcription']` in `showIndicator`. |
| Support a new XML dialect               | Add a branch in `detectXMLType()` and write the parser. Pattern: build `this.pageXMLData = {pageNr, lines: [{id, coords, baseline, text}]}`, then call `renderPageXML()`. |
| Re-render annotations on load           | Implement in `loadAnnotations()`: walk each annotation, locate the matching panel by `target.source`/`canvasId`, resolve the selector to DOM, then call `drawConnectionLineBetween`. |
| Implement tagging                       | Replace the placeholder in `showTagForm` (text panel) and the `tag` branch in `handleImageAnnotationType` (image panel). |
| Persist annotations                     | Hook the `annotations-updated` event on the orchestrator, serialise to `localStorage` or a backend. |
| Add highlight on linked text on hover image rect | Subscribe to mouseenter on `.selection-rect.confirmed`, find matching connection in `this.connections`, toggle a CSS class on `connection.textElement`. |
| Change the indigo accent                | The `--color-black` token in `:host` (it's actually `#3b3f9f`). |

---

## 14. Useful pointers when reading the code

- The orchestrator's `render()` method is one giant tagged template literal that ends at line ~1194. Everything after is methods.
- Search for `dispatchEvent(new CustomEvent('` to find every event surface.
- The "is this still draggable after a connection?" decision is at the comment `// DON'T remove from unlinked lists — keep them draggable for multiple connections!` in `createConnectionBetween`. So one text selection can be linked to many image rects (and vice versa), each producing its own annotation.
- Recent UI churn (last 5 commits) moved annotation editing UI from per-panel sidebars to a single global sidebar and unified the comment/tag/link/delete bar between text and image. If you find duplicate-looking sidebar code, the global one in the orchestrator is canonical.

---

## 15. Sample annotation JSON-LD (output of `Export annotations`)

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "AnnotationCollection",
  "label": "INTERIM Annotations",
  "created": "2026-05-12T18:42:00Z",
  "items": [
    {
      "@context": "http://www.w3.org/ns/anno.jsonld",
      "type": "Annotation",
      "id": "annotation-1746046920000",
      "motivation": "linking",
      "body": {
        "type": "TextualBody",
        "value": "il turbante di seta",
        "format": "text/plain",
        "selector": {
          "type": "Choice",
          "items": [
            { "type": "TextPositionSelector", "start": 245, "end": 264 },
            { "type": "TextQuoteSelector", "exact": "il turbante di seta",
              "prefix": "...vediamo poi ", "suffix": " che le cinge il capo..." }
          ]
        },
        "class": "lrmoo:F2_Expression"
      },
      "target": {
        "type": "Image",
        "source": "https://iiif.europeana.eu/.../canvas/p1",
        "selector": {
          "type": "FragmentSelector",
          "conformsTo": "http://www.w3.org/TR/media-frags/",
          "value": "xywh=412,180,260,140"
        },
        "class": "lrmoo:F1_Work",
        "canvasId": "https://iiif.europeana.eu/.../canvas/p1",
        "canvasIndex": 0,
        "canvasLabel": "La Fornarina"
      },
      "property": "http://w3id.org/geko/denotation",
      "modality": "denotation",
      "created": "2026-05-12T18:42:00Z"
    }
  ]
}
```

---

## 16. External resources

- INTERIM ontology: <https://w3id.org/interim/>
- GEKO ontology: <https://w3id.org/geko/>
- MIRO ontology: <https://w3id.org/miro/>
- MLAO ontology: <https://w3id.org/mlao/>
- ICON ontology: <https://w3id.org/icon/ontology/>
- IIIF Presentation API: <https://iiif.io/api/presentation/>
- W3C Web Annotation Data Model: <https://www.w3.org/TR/annotation-model/>
- OpenSeadragon: <https://openseadragon.github.io/>
- Transkribus / PAGE XML schema: <https://github.com/PRImA-Research-Lab/PAGE-XML>
- Repo: <https://github.com/friendlynihilist/iiif-multimodal-annotator>
