# Multi-Canvas Navigation Guide

## Overview

L'annotator ora supporta manifest IIIF con più canvas (pagine). Ogni annotazione viene automaticamente legata al canvas specifico su cui è stata creata.

## Come Funziona

### 1. Caricamento Manifest Multi-Canvas

Quando carichi un manifest IIIF con più canvas (es. un quaderno con 20 pagine):

```javascript
// Nel pannello Image, inserisci l'URL del manifest:
// file:///path/to/test-multicanvas-manifest.json
```

Il viewer automaticamente:
- Estrae tutti i canvas dal manifest
- Carica il primo canvas
- Mostra i controlli di navigazione se ci sono più canvas

### 2. Controlli di Navigazione

**UI disponibile:**
```
[← Prev]  [1 / 3]  [Next →]  Pagina 1
```

- **← Prev**: Va al canvas precedente
- **Next →**: Va al canvas successivo
- **1 / 3**: Indica canvas corrente / totale
- **Pagina 1**: Mostra il label del canvas corrente

### 3. Annotazioni Legate ai Canvas

**Quando crei un'annotazione:**

1. Selezioni testo nel text panel
2. Selezioni regione immagine nel canvas corrente (es. Canvas 2)
3. Colleghi i due elementi
4. Scegli la modalità ecfrastica

**L'annotazione risultante include:**

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "Annotation",
  "id": "annotation-1737471234567",
  "motivation": "linking",
  "body": {
    "type": "TextualBody",
    "value": "...il turbante di seta...",
    "selector": {...}
  },
  "target": {
    "type": "Image",
    "source": "https://example.org/canvas/page2",  // <-- Canvas ID
    "selector": {
      "type": "FragmentSelector",
      "value": "xywh=100,200,300,400"
    },
    "canvasId": "https://example.org/canvas/page2",    // Metadata del canvas
    "canvasIndex": 1,                                   // Indice (0-based)
    "canvasLabel": "Pagina 2"                          // Label leggibile
  },
  "property": "http://w3id.org/geko/denotation",
  "modality": "denotation",
  "created": "2026-01-21T11:30:00Z"
}
```

### 4. Gestione Selezioni per Canvas

**Importante:** Quando cambi canvas:
- Le selezioni rettangolari sul canvas vengono pulite automaticamente
- Le annotazioni salvate rimangono nel sistema
- Puoi creare nuove annotazioni sul nuovo canvas

## Esempio d'Uso: Quaderno Raimondi

### Scenario Tipico

Hai un manifest del Quaderno Raimondi con 15 pagine:

```
Canvas 1: Pagina con descrizione della Fornarina (testo)
Canvas 2: Pagina con descrizione di San Sebastiano (testo)
Canvas 3: Immagine della Fornarina
Canvas 4: Immagine di San Sebastiano
...
```

### Workflow

1. **Carica il manifest** nel pannello Facsimile
2. **Naviga a Canvas 1** (descrizione Fornarina)
3. Seleziona il testo "...turbante di seta..."
4. **Naviga a Canvas 3** (immagine Fornarina)
5. Seleziona regione del turbante nell'immagine
6. Collega testo → immagine con modalità "denotation"

**Risultato:** Annotazione con target su Canvas 3, anche se il testo è su Canvas 1 (in un altro pannello).

## Export Annotazioni

Quando esporti le annotazioni, ogni annotazione include:
- `target.canvasId`: URI completo del canvas IIIF
- `target.canvasIndex`: Indice numerico (utile per ordinamento)
- `target.canvasLabel`: Label leggibile

Questo permette di:
- Filtrare annotazioni per canvas
- Ricostruire la visualizzazione canvas-specifica
- Mantenere la relazione tra testo e immagine attraverso canvas diversi

## Eventi Disponibili

### canvas-changed

Evento dispatched quando cambi canvas:

```javascript
imagepanel.addEventListener('canvas-changed', (e) => {
  console.log('Canvas cambiato:', e.detail);
  // {
  //   canvasIndex: 1,
  //   canvasId: "https://example.org/canvas/page2",
  //   canvasLabel: "Pagina 2",
  //   totalCanvases: 3
  // }
});
```

## Test

Ho creato `test-multicanvas-manifest.json` con 3 canvas per testing:
- Pagina 1: Manoscritto Bodleian
- Pagina 2: Dipinto diverso
- Pagina 3: La Fornarina

Per testare:
1. Apri `examples/index.html` nel browser
2. Nel pannello Image/Facsimile, carica:
   ```
   file:///path/to/interim-annotator/test-multicanvas-manifest.json
   ```
3. Usa i controlli Prev/Next per navigare
4. Crea annotazioni su canvas diversi
5. Esporta e verifica che ogni annotazione abbia il `canvasId` corretto
