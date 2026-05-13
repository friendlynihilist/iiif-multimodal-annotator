# ROADMAP

> The plan, by deadline. Each phase has a single primary deliverable. Anything that doesn't help the next deliverable is deferred to a later phase.

---

## Phase 1 — Poster + Demo for IIIF Annual Conference

**Window**: 13 May → 1 June 2026
**Hard deadlines inside this phase**:
- 30 May 2026: poster needs to be ready, screenshots required
- 1 June 2026: live demo at the conference

**Primary deliverable**: A working v2 prototype with backend, RDF persistence, at least one working profile other than the default (to demonstrate pluggability concretely), a SPARQL panel, and good-looking screenshots.

**Goals (in priority order)**:

1. Backend up: Fuseki + FastAPI gateway, dockerised.
2. Complete JSON-LD `@context` for all default ontologies (INTERIM, GEKO, MIRO, MLAO, ICON, HICO, LRMoo, CRM).
3. Frontend talks to backend: every annotation create / update / delete round-trips through the API.
4. `loadAnnotations()` re-renders text highlights and image rectangles (SVG paths can wait if needed).
5. Profile system v0: profile manifest format defined, default `interim-geko` profile bundled, **at least one alternative profile** (suggested: `cidoc-crm-bare` for a generic CH use case, OR `iconclass-only` for tagging-only).
6. Profile picker UI: dropdown that switches the active profile and re-paints modality buttons / classes.
7. SPARQL panel: 4th panel type embedding YASGUI, talking to `/sparql` on the backend.
8. Demo data: at least one ekphrasis case (e.g. the Bologna manuscript + La Fornarina) plus one CIDOC-CRM case (could be the same artwork annotated differently to show profile-switching).
9. Screenshots for the poster.

**Explicitly out of scope for Phase 1**:
- Multi-user / authentication (single-user local backend is fine).
- HICO provenance beyond a minimal `dcterms:creator` + timestamp.
- SHACL validation (manifest declares shapes, but enforcement is post-phase).
- Tagging with external authorities (Wikidata / AAT).
- Undo / redo.
- Schema editor UI for user-defined profiles (profiles are file-based for Phase 1).
- Diff / versioning.
- Refactoring of the 2944-line orchestrator beyond what's strictly needed.

---

## Phase 2 — Article for *Umanistica Digitale*

**Window**: 1 → 15 June 2026
**Primary deliverable**: Article submission. The tool is a secondary focus in the article — what matters here is that what we describe in writing actually works.

**Goals**:

1. Stabilisation pass on Phase 1 features. No new architecture.
2. Write-up support: figures, query examples, a clean sample dataset.
3. Fix the most embarrassing of the limitations listed in PROJECT-OVERVIEW §12 that the article would otherwise have to admit.
4. README and quick-start guide on GitHub: anyone reading the article can clone and try.

**Explicitly out of scope**: any feature not already in Phase 1.

---

## Phase 3 — Alpha release + JOCCH submission

**Window**: 15 June → end of July 2026
**Primary deliverable**: A publicly usable alpha. JOCCH paper submission focused on MLAO + the annotator as MLAO's reference implementation.

**Goals**:

1. **Pluggable profiles, real**: Schema Editor UI. The user can define entity classes, properties, and relationships in the browser (no file editing required), save the profile, share it as a JSON+TTL bundle.
2. **MLAO levels** as first-class UI dimension: when the active profile declares annotation levels (e.g. ICON's preiconographic / iconographic / iconological), the annotation creation UI gets a level selector. Annotations carry their level explicitly.
3. **HICO provenance** properly modelled: every annotation has an `hico:InterpretationAct` with author (FOAF/ORCID), timestamp, interpretation type, optional criterion.
4. **Authority service integration**: external lookup against Wikidata, Getty AAT, ULAN, Iconclass — pluggable per profile (like ImMarkus's authority services).
5. **Multi-user**: basic OAuth (or eduGAIN if Hertziana/Max Planck supports it), per-container permissions.
6. **SHACL validation** at write-time.
7. **Annotation versioning** via Memento headers and named-graph history.
8. **Refactoring**: split the orchestrator into modules. Probably long overdue by this point.

---

## Phase 4 — UX testing with art historians

**Window**: September 2026 onwards
**Primary deliverable**: UX feedback rounds with Hertziana colleagues + art historians, leading to a refined v1.0 release.

**Goals**:

1. Recruit 4–8 art historians for moderated sessions.
2. Prepare 2–3 representative tasks (e.g. "annotate the Stanze di Raffaello as both LRMoo expressions and CIDOC-CRM events").
3. Heuristic evaluation + think-aloud sessions.
4. Iterate on UI based on findings.
5. Documentation aimed at non-technical users.

**This is also where the tool stops being a research artefact and starts being a community tool.** Decisions about hosting, citations, DOI for the codebase (Zenodo), and contribution guidelines happen here.

---

## Cross-phase principles

- **Every commit on `main` must keep the demo bootable.** No "WIP, breaks demo" merges to main between now and 1 June.
- **Each phase ends with a tagged release.** `v0.2.0-poster`, `v0.2.1-umadig`, `v0.3.0-alpha`, `v1.0.0` (or thereabouts).
- **The deadlines are the plan.** If a goal threatens a deadline, the goal moves, not the deadline.
