# PAGE XML Support Guide

## Overview

L'annotator ora supporta **PAGE XML** (formato Transkribus) per le trascrizioni dei manoscritti. Il text panel si sincronizza automaticamente con il facsimile, caricando la trascrizione corretta per ogni canvas.

## Architettura

### File Disponibili

```
examples/
├── metadata.xml           # Metadata documento (Transkribus)
├── mets.xml              # Mappatura page → file XML
└── page/                 # Trascrizioni PAGE XML
    ├── 0001_00001.xml    # Pagina 1
    ├── 0002_00002.xml    # Pagina 2
    ├── 0018_00018.xml    # Pagina 18
    └── ...               # 26 pagine totali
```

### Struttura PAGE XML

Ogni file PAGE XML contiene:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15">
  <Metadata>
    <TranskribusMetadata pageNr="18" .../>
  </Metadata>
  <Page imageWidth="1798" imageHeight="2516">
    <TextRegion id="tr_1">
      <TextLine id="tr_1_tl_2">
        <Coords points="224,547 293,543 ..." />  <!-- Coordinate poligonali -->
        <Baseline points="224,532 293,528 ..." />
        <TextEquiv>
          <Unicode>Ritornando a parlare dell'oggetto...</Unicode>
        </TextEquiv>
      </TextLine>
      <!-- More TextLine elements... -->
    </TextRegion>
  </Page>
</PcGts>
```

**Elementi chiave:**
- `pageNr`: Numero pagina (1-based)
- `TextLine id`: ID univoco della riga
- `Coords`: Coordinate poligonali della bounding box della riga
- `Baseline`: Baseline della riga (per rendering preciso)
- `Unicode`: Testo trascritto

## Come Funziona

### 1. Caricamento Iniziale

Al caricamento dell'applicazione:

```javascript
// In iiif-interim-annotator.js
this.addPanel('text', {
  label: 'Transcription',
  mets: '/examples/mets.xml',           // Carica mappatura
  pagexml: '/examples/page/0018_00018.xml'  // Carica pagina default
});
```

**Cosa succede:**
1. Il text panel carica `mets.xml` per la mappatura page → file
2. Carica `0018_00018.xml` come pagina iniziale
3. Parsa il PAGE XML ed estrae le righe di testo
4. Renderizza ogni riga come elemento selezionabile

### 2. Navigazione Sincronizzata

Quando navighi i canvas nel facsimile:

```
[Facsimile Panel]           [Text Panel]
Canvas 1 (pageNr=1)    →    page/0001_00001.xml
Canvas 2 (pageNr=2)    →    page/0002_00002.xml
Canvas 18 (pageNr=18)  →    page/0018_00018.xml
```

**Flusso:**
1. Utente clicca "Next" nel facsimile
2. `iiif-image-panel` emette evento `canvas-changed`
3. `iiif-text-panel` ascolta l'evento
4. Carica automaticamente il PAGE XML corrispondente tramite METS
5. Renderizza la trascrizione della nuova pagina

### 3. Annotazioni con Coordinate

Quando crei un'annotazione su una riga:

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "Annotation",
  "body": {
    "type": "TextualBody",
    "value": "Ritornando a parlare dell'oggetto...",
    "selector": {
      "type": "TextPositionSelector",
      "start": 0,
      "end": 45
    },
    "lineId": "tr_1_tl_2",              // ID della riga nel PAGE XML
    "coords": "224,547 293,543 ...",    // Coordinate poligonali
    "pageNr": 18                         // Numero pagina
  },
  "target": {
    "source": "https://example.org/canvas/page18",
    "canvasId": "https://example.org/canvas/page18",
    "selector": { "value": "xywh=100,200,300,400" }
  }
}
```

**Vantaggi:**
- Ogni annotazione sa **esattamente** dove si trova nel manoscritto
- Coordinate precise per overlay sul facsimile
- Collegamento diretto canvas ↔ linea di testo

## Implementazione Tecnica

### Text Panel API

**Attributi:**
```html
<iiif-text-panel
  mets="/examples/mets.xml"
  pagexml="/examples/page/0001_00001.xml">
</iiif-text-panel>
```

**Metodi pubblici:**
```javascript
// Carica PAGE XML da URL
textPanel.loadPageXML(url)

// Carica pagina specifica tramite METS
textPanel.loadPageByNumber(pageNr)

// Ascolta eventi canvas
window.addEventListener('canvas-changed', (e) => {
  console.log(e.detail); // { canvasIndex, canvasId, canvasLabel }
});
```

### Parser PAGE XML

Il parser estrae:

```javascript
{
  pageNr: "18",
  imageWidth: "1798",
  imageHeight: "2516",
  lines: [
    {
      id: "tr_1_tl_2",
      coords: "224,547 293,543 ...",
      baseline: "224,532 293,528 ...",
      text: "Ritornando a parlare dell'oggetto..."
    },
    // ...
  ]
}
```

### Rendering

Ogni riga diventa un elemento separato:

```html
<div
  data-line-id="tr_1_tl_2"
  data-coords="224,547 293,543 ..."
  data-baseline="224,532 293,528 ...">
  Ritornando a parlare dell'oggetto...
</div>
```

**Questo permette:**
- Selezione per riga
- Preservazione delle coordinate
- Collegamento preciso con il facsimile

## Uso Pratico

### Scenario: Annotare una Descrizione Ecfrastica

1. **Naviga al Canvas 18** (pagina con testo ecfrastico)
   - Il facsimile mostra l'immagine del manoscritto
   - Il text panel carica automaticamente `page/0018_00018.xml`

2. **Seleziona una riga di testo:**
   ```
   "Ritornando a parlare dell'oggetto di quella mia suggestione..."
   ```

3. **Clicca "Confirm Text Selection"**
   - La riga diventa verde e draggabile
   - Le coordinate della riga sono salvate

4. **Naviga al Canvas con l'opera d'arte** (es. Canvas 5 con dipinto)
   - Il facsimile cambia immagine
   - Il text panel rimane sulla trascrizione del Canvas 18

5. **Seleziona regione nell'opera d'arte**

6. **Drag dalla riga di testo → regione immagine**
   - Scegli modalità ecfrastica (denotation, dynamisation, integration)

7. **Annotazione creata:**
   ```json
   {
     "body": {
       "value": "Ritornando a parlare...",
       "lineId": "tr_1_tl_2",
       "coords": "224,547 ...",
       "pageNr": 18
     },
     "target": {
       "canvasId": "canvas/5",
       "selector": "xywh=100,200,300,400"
     }
   }
   ```

## Compatibilità

Il text panel mantiene **backward compatibility**:

- **Plain text**: Continua a funzionare con file `.txt`
- **PAGE XML**: Auto-detect basato su estensione `.xml` o contenuto
- **TEI/XML**: Supporto futuro (parser estendibile)

## Test

Per testare il supporto PAGE XML:

1. Apri `http://localhost:5173/examples/`
2. Naviga i canvas nel pannello Facsimile
3. Osserva il text panel caricare automaticamente le trascrizioni
4. Prova a selezionare e annotare righe di testo
5. Esporta le annotazioni e verifica che includano `lineId`, `coords`, `pageNr`

## File di Test Disponibili

Nel repository:
- `examples/page/0018_00018.xml` - Pagina con molto testo (257 righe XML)
- `examples/mets.xml` - Mappatura completa di tutte le 26 pagine
- `examples/metadata.xml` - Metadata documento Transkribus

## Prossimi Sviluppi

- [ ] Overlay delle coordinate sul facsimile (highlight linea quando hover su testo)
- [ ] Supporto TEI/XML per edizioni critiche
- [ ] Export annotazioni in formato IIIF Annotation Page completo
- [ ] Filtro annotazioni per canvas/pagina
- [ ] Visualizzazione gerarchica (TextRegion → TextLine)
