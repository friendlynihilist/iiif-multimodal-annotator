# CLAUDE.md

> Briefing for Claude Code. Read this **first** every session. It is the source of truth for what we are building, the conventions to follow, and the things to never do.

---

## What this project is (one paragraph)

A browser-based, IIIF-aware **multimodal semantic annotator**. The user opens one or more textual sources (plain text / TEI / PAGE-XML) alongside one or more IIIF image resources and creates typed annotations on each, including **typed cross-modal links** (e.g. an ekphrasis: a text span linked to an image region under a specific semantic relation). Annotations are RDF-native and stored in a triple store; the frontend speaks W3C Web Annotation but every write is also a SPARQL update under the hood. The tool is **ontology-agnostic**: it ships with a default "INTERIM/GEKO" profile for ekphrasis research, but anyone can plug in their own profile (CIDOC-CRM, Iconclass-only, or a custom data model).

The codebase already exists at v1 under the name **"IIIF INTERIM Annotator"**. We are now refactoring towards v2 ("Multimodal Annotator") with backend, RDF persistence, and pluggable profiles.

Read `PROJECT-OVERVIEW.md` for the v1 codebase tour. Read `ROADMAP.md` for the milestones. Read `docs/architecture/ARCHITECTURE-v2.md` for where we are going.

---

## Author & context

- **Author**: Carlo Teo Pedretti — researcher at Bibliotheca Hertziana / Max Planck (Rome), affiliated with Sapienza and tutoring at Università di Bologna.
- **Research domain**: digital humanities, intermediality, ekphrasis, semantic annotation of cultural heritage objects.
- **Ontologies authored / co-authored**: INTERIM, GEKO, MLAO. The tool is the practical implementation of these.

---

## Hard deadlines (the only thing that matters in the short term)

| Date | Deliverable | Status |
|---|---|---|
| **30 May 2026** | Poster for IIIF Annual Conference — needs screenshots of working system | NOT STARTED |
| **1 June 2026** | Live demo at IIIF Annual Conference | NOT STARTED |
| **15 June 2026** | Article submission to *Umanistica Digitale* (the tool is a secondary focus) | NOT STARTED |
| **July 2026** | Alpha release; submission to *JOCCH* (focus: MLAO ontology + annotator) | NOT STARTED |
| **September 2026** | UX testing rounds with Hertziana art historians | NOT STARTED |

These dates are non-negotiable. Anything that doesn't help the next deadline is deferred.

---

## What we are building, in three layers

### Layer 1 — Frontend (existing, evolving)

Pure Web Components, OpenSeadragon, Vite. Three custom elements: `<iiif-interim-annotator>` (orchestrator), `<iiif-text-panel>`, `<iiif-image-panel>`. See `PROJECT-OVERVIEW.md` §3 for the architecture.

What changes in v2:
- The hardcoded GEKO modalities (denotation / dynamisation / integration) become **profile-driven**: the buttons, colors, classes, and `property` URIs are loaded from a JSON profile manifest.
- The annotation store moves from in-memory `this.annotations[]` to a backend-synced store with optimistic local updates.
- `loadAnnotations()` must actually re-render (currently a known limitation, see PROJECT-OVERVIEW §12).
- A new SPARQL panel (4th panel type) using YASGUI.
- A Profile Manager UI (load preset / upload custom / inspect active profile).

### Layer 2 — Backend (new)

Python FastAPI gateway in front of Apache Jena Fuseki (TDB2 backend). The gateway:
- Speaks **W3C Web Annotation Protocol** to the frontend (CRUD on `oa:Annotation`).
- Translates each write to a **SPARQL Update** that creates a named graph per annotation.
- Validates incoming annotations against the **SHACL shapes** of the active profile.
- Records **HICO provenance** (`hico:InterpretationAct`) on every write.
- Exposes a **SPARQL query passthrough** for the frontend SPARQL panel.
- Serves the JSON-LD `@context` for the active profile.

### Layer 3 — Profile system (new, the big architectural idea)

A **Profile** is a self-describing bundle that declares:
- Namespaces and a JSON-LD `@context`
- Entity classes (with which panel types they apply to)
- Linking properties (with colors, domains, ranges)
- Tag schemes (SKOS Concept Schemes)
- Annotation motivations and panel types
- Annotation levels (e.g. MLAO/ICON triadic levels, optional)
- SHACL shapes for validation
- Optional reasoning rules

Profiles ship as a folder under `profiles/`:
```
profiles/
├── interim-geko/        # default — ekphrasis research
├── cidoc-crm-bare/      # generic cultural heritage
├── iconclass/           # ICONCLASS-only tagging
└── ...
```

Each profile has: `manifest.json`, `context.jsonld`, `ontology.ttl`, `shapes.ttl`, optional `examples/`.

The tool ships with `interim-geko` as default but is no longer "the INTERIM annotator" — it's "Multimodal Annotator with INTERIM as one of many profiles".

---

## Naming convention for v2

Working name: **Multimodal Annotator** (MMA for short). The repo, the npm package, the demo URL all migrate to this.

`interim` becomes the name of the default profile, not the tool.

If the author later picks a more poetic name, find-replace will not be hard — keep names consistent internally so this stays trivial.

---

## Conventions for this codebase (please respect)

### Code style

- ES modules everywhere. `type: module` in package.json.
- Web Components: open Shadow DOM, `composed: true` on `CustomEvent`s, kebab-case attribute names, camelCase JS properties.
- Tagged template literals for shadow content (no JSX, no virtual DOM).
- No framework dependencies in the frontend. **Do not introduce React, Vue, Lit, Stencil, or anything else.** The author chose vanilla deliberately.
- Backend: Python 3.11+, FastAPI, `rdflib` for RDF, `pyshacl` for validation. Type hints required.
- Async-await preferred over promise chains.
- Comments only where the *why* is non-obvious. The *what* should be readable from the code.

### Visual / UX style

- Flat aesthetic: no border-radius, no box-shadow, no transitions (mostly).
- Primary accent: indigo `#3b3f9f` (currently named `--color-black` in CSS — keep the variable name for legacy compatibility, mark it with a code comment).
- Off-white background: `#f8f6f2`.
- Modality colors are profile-driven; the default INTERIM profile uses the four colors documented in PROJECT-OVERVIEW §4.2.
- Icons monochrome unless they encode a modality.

### Author preferences (verbatim from Carlo, mandatory)

- **Never invent information.** If something is uncertain, say "I don't know" explicitly or search for verifiable sources.
- **Cite verifiable sources** for dates, numbers, specific regulations.
- **Explicitly admit uncertainty** rather than sounding overconfident on unverified things.
- For regulations and technical specs, **search the web first** instead of relying on memory.
- **Never change a position just to please Carlo.** If pushed back on, defend the position with reasons or acknowledge the genuine flaw — but don't capitulate for social reasons.

---

## Things to never do

- **Do not introduce a frontend framework.** See above.
- **Do not hardcode GEKO modalities or INTERIM class names in v2 code paths.** Everything must read from the active profile. The v1 hardcoded values stay only inside the `interim-geko` profile bundle.
- **Do not implement features without a clear path to one of the deadline deliverables.** Ask first.
- **Do not delete or significantly refactor the existing v1 components without a migration plan in the relevant ADR.** Working code is precious right now.
- **Do not commit secrets, API keys, or local Fuseki credentials.** `.env.example` only.
- **Do not write to `loadAnnotations()` without re-rendering.** This is a known bug, fixing it is on the critical path.

---

## How to work with Carlo

- He reads and reviews everything. He'll push back on architectural decisions — that's good; engage with the reasoning, don't just acquiesce.
- Italian is his preferred language for conversation, but the codebase and docs are in English. Mixing is fine: code in English, commit messages in English, but he'll often write issues / questions in Italian.
- He's already a domain expert on the ontologies and on IIIF. Don't over-explain those — they're his work. Do explain backend/RDBMS/infrastructure choices, those are less in his daily flow.
- He'll often be working under deadline pressure. When suggesting work, propose the smallest viable version first, then the polish.

---

## Current phase

We are in **Phase 1: Poster + Demo for IIIF Annual Conference**. See `PHASE-1-POSTER-DEMO.md` for the atomic task list.
