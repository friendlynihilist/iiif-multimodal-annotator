# Multimodal Annotator

> **Heads up — the project is being rebranded (ADR 0001).** Until recently this tool was called *IIIF INTERIM Annotator*; that name lives on only as the default profile (`profiles/interim-geko`). The full v2 README rewrite lands in PHASE-1 task T3.2 — what follows below is still the v1 documentation, kept as a working reference. For the v2 plan, read `CLAUDE.md`, `ROADMAP.md`, `PHASE-1-POSTER-DEMO.md`, and `docs/architecture/ARCHITECTURE-v2.md`.

Un annotatore semantico basato su Web Components e IIIF per la gestione e l'analisi di fenomeni multimodali (testi, immagini, manoscritti), con un profilo predefinito orientato all'ecfrasi.

## Descrizione

Questo progetto fornisce un'interfaccia web modulare e riusabile per l'annotazione semantica di relazioni intermediali, utilizzando:
- **IIIF** (International Image Interoperability Framework) per le immagini
- **Web Annotations** standard W3C
- **OpenSeadragon** per deep zoom e manipolazione immagini
- **Web Components** per massima riusabilità e interoperabilità

## Caratteristiche

- 📝 **Annotazione testo-immagine**: Collega porzioni di testo a regioni di immagini IIIF
- 🎨 **Supporto IIIF completo**: Carica manifest IIIF Presentation API 2.x e 3.x
- 🔍 **Deep zoom**: Integrazione OpenSeadragon per immagini ad alta risoluzione
- 🧩 **Web Components**: Standard W3C, funziona con qualsiasi framework o vanilla HTML
- 💾 **Export standard**: Esporta annotazioni in formato Web Annotation JSON-LD
- 🎯 **Selettori precisi**: Text Position Selector, Text Quote Selector, IIIF Fragment Selector

## Installazione

```bash
# Clona la repository
git clone https://github.com/friendlynihilist/iiif-multimodal-annotator.git
cd iiif-multimodal-annotator

# Installa dipendenze
npm install

# Avvia il server di sviluppo
npm run dev
```

Il browser si aprirà automaticamente su `http://localhost:5173/examples/index.html`.

## Utilizzo

### Base (HTML)

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Annotator</title>
</head>
<body>
  <iiif-interim-annotator></iiif-interim-annotator>

  <script type="module" src="path/to/iiif-interim-annotator.js"></script>
</body>
</html>
```

### Con attributi personalizzati

```html
<iiif-interim-annotator>
  <iiif-text-panel
    slot="text-panel"
    src="./my-text.txt">
  </iiif-text-panel>

  <iiif-image-panel
    slot="image-panel"
    manifest="https://example.com/iiif/manifest.json">
  </iiif-image-panel>
</iiif-interim-annotator>
```

### Utilizzo programmatico (JavaScript)

```javascript
// Accedi al componente
const annotator = document.querySelector('iiif-interim-annotator');

// Ascolta eventi di annotazione
annotator.addEventListener('annotation-created', (event) => {
  console.log('Nuova annotazione:', event.detail);
});

// Carica annotazioni esistenti
annotator.loadAnnotations([
  {
    "@context": "http://www.w3.org/ns/anno.jsonld",
    "type": "Annotation",
    // ... altre proprietà
  }
]);

// Ottieni tutte le annotazioni
const annotations = annotator.getAnnotations();
```

## Struttura del Progetto

```
iiif-interim-annotator/
├── src/
│   ├── components/
│   │   ├── iiif-interim-annotator.js    # Componente principale
│   │   ├── iiif-text-panel.js           # Pannello testo
│   │   └── iiif-image-panel.js          # Pannello immagini IIIF
│   ├── utils/                           # Utilities
│   └── index.js                         # Entry point
├── examples/
│   ├── index.html                       # Demo completa
│   └── sample-text.txt                  # Testo di esempio
├── data/                                # Annotation lists IIIF
├── ontology/
│   ├── interim.ttl                      # Ontologia INTERIM
│   └── model interim.jpg                # Modello concettuale
├── dist/                                # Build output
├── package.json
├── vite.config.js
└── README.md
```

## Ontologie Utilizzate

- **INTERIM**: Ontologia core per relazioni intermediali
- **MIRO**: Media Interactions and Relations Ontology
- **GEKO**: Ontologia per la modellazione dell'ecfrasi
- **MLAO**: Multi-Level Annotation Ontology
- **ICON**: Iconography Ontology
- **HICO**: Historical Context Ontology
- **CIDOC-CRM**: Conceptual Reference Model
- **LRMoo**: FRBR Object-Oriented

## Build per Produzione

```bash
npm run build
```

I file compilati saranno disponibili in `dist/`:
- `iiif-interim-annotator.js` (ES module)
- `iiif-interim-annotator.umd.js` (UMD, compatibile browser)

## Componenti

### `<iiif-interim-annotator>`

Componente principale che gestisce la sincronizzazione tra pannelli.

**Eventi:**
- `annotation-created`: Emesso quando viene creata una nuova annotazione

**Metodi:**
- `getAnnotations()`: Restituisce array di annotazioni
- `loadAnnotations(annotations)`: Carica annotazioni esistenti

### `<iiif-text-panel>`

Pannello per caricamento e selezione testo.

**Attributi:**
- `src`: URL del file di testo da caricare
- `text`: Testo inline

**Eventi:**
- `text-selected`: Emesso quando viene selezionato del testo

### `<iiif-image-panel>`

Pannello IIIF con OpenSeadragon.

**Attributi:**
- `manifest`: URL del manifest IIIF
- `tileSources`: URL diretto a image service IIIF

**Eventi:**
- `image-region-selected`: Emesso quando viene selezionata una regione

## Formato Annotazioni

Le annotazioni seguono lo standard [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/):

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "Annotation",
  "id": "annotation-1234567890",
  "motivation": "linking",
  "body": {
    "type": "TextualBody",
    "value": "Plato and Aristotle",
    "format": "text/plain",
    "selector": {
      "type": "TextPositionSelector",
      "start": 245,
      "end": 264
    }
  },
  "target": {
    "type": "Image",
    "source": "https://example.com/iiif/image",
    "selector": {
      "type": "FragmentSelector",
      "conformsTo": "http://www.w3.org/TR/media-frags/",
      "value": "xywh=100,200,300,400"
    }
  },
  "created": "2026-01-15T10:30:00Z"
}
```

## Roadmap

- [ ] Supporto per annotazioni multiple sovrapposte
- [ ] Visualizzazione annotazioni esistenti
- [ ] Export in formato RDF/Turtle secondo ontologia INTERIM
- [ ] Integrazione con triple store
- [ ] Supporto per modalità ecfrastiche (GEKO)
- [ ] Livelli concettuali (ICON: preiconografico, iconografico, iconologico)

## Contribuire

Questo è un progetto accademico aperto. Contributi e suggerimenti sono benvenuti!

## Licenza

MIT

## Autore

Carlo Teo Pedretti

## Link

- Repository: https://github.com/friendlynihilist/iiif-multimodal-annotator
- INTERIM Ontology: https://w3id.org/interim/
- IIIF: https://iiif.io/
- Web Annotations: https://www.w3.org/TR/annotation-model/
