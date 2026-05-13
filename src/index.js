/**
 * Multimodal Annotator — entry point
 * (was: MLAO Multimodal Annotator / IIIF INTERIM Annotator. Phase 1 partial rename: ADR 0001.)
 *
 * Registers the three custom elements and exposes the orchestrator class for programmatic use.
 *
 * @author Carlo Teo Pedretti
 * @license MIT
 */

// Side-effect imports: each module calls customElements.define().
import './components/multimodal-annotator.js';
import './components/iiif-text-panel.js';
import './components/iiif-image-panel.js';
import './components/mma-toast-stack.js';

// Programmatic exports. `MultimodalAnnotator` is the canonical alias; the legacy
// `IIIFInterimAnnotator` name is kept for v0.2.x compatibility.
export { IIIFInterimAnnotator, IIIFInterimAnnotator as MultimodalAnnotator } from './components/multimodal-annotator.js';
export { IIIFTextPanel } from './components/iiif-text-panel.js';
export { IIIFImagePanel } from './components/iiif-image-panel.js';

export const version = '0.2.0-dev';

console.log('Multimodal Annotator loaded — v' + version);
