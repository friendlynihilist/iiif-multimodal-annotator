# Profiles

A profile is a bundle of files that tells the tool which ontology to
use, which modalities the user can pick, and which JSON-LD context to
serialise with. One profile is active per session. The default profile
is `interim-geko` (ekphrasis research).

The profile system is described in `docs/adr/0003-pluggable-profiles.md`.
This document is the operational reference.

## Bundle layout

```
profiles/<profile-id>/
├── manifest.json     # required — see "Manifest" below
├── context.jsonld    # required — JSON-LD context for the namespaces used
├── ontology.ttl      # required — RDF ontology (classes, properties, hierarchies)
├── shapes.ttl        # optional — SHACL shapes (declared, not enforced yet)
└── examples/         # optional — example annotations in JSON-LD
```

The bundled default (`profiles/interim-geko/`) also includes a
`model-interim.jpg` diagram of the conceptual model.

## Manifest

The minimum schema. Field descriptions are kept short here; see the
canonical example at `profiles/interim-geko/manifest.json`.

```json
{
  "id": "interim-geko",
  "name": "INTERIM / GEKO Ekphrasis",
  "description": "...",
  "version": "0.1.0",
  "authors": [{ "name": "...", "orcid": "..." }],
  "license": "CC-BY-4.0",

  "context": "context.jsonld",
  "ontology": "ontology.ttl",
  "shapes":   "shapes.ttl",

  "namespaces": {
    "interim": "https://w3id.org/interim/",
    "geko":    "https://w3id.org/geko/",
    "mlao":    "https://w3id.org/mlao/",
    "icon":    "https://w3id.org/icon/ontology/",
    "hico":    "http://purl.org/emmedi/hico/",
    "lrmoo":   "http://iflastandards.info/ns/lrm/lrmoo/",
    "crm":     "http://www.cidoc-crm.org/cidoc-crm/"
  },

  "entityClasses":     [ ... ],
  "linkingProperties": [ ... ],   // modalities
  "tagSchemes":        [ ... ],
  "annotationMotivations": ["linking", "commenting", "tagging", "transcribing"],
  "panelTypes":        ["text", "image", "facsimile", "sparql"],
  "annotationLevels":  [ ... ],   // ICON / Panofsky tiers
  "authorityServices": []         // Phase 3
}
```

### entityClasses

Classes the user can pick from when typing a target or anchored entity.
Each entry: `{ id, label, description?, applicableTo: ["text"|"image"],
color?: "#hex" }`. `applicableTo` filters which panel types show this
class in the picker.

### linkingProperties

The "modalities" presented in the modality-selector modal after the user
draws a connection between a text span and an image region. Each entry:
`{ id, label, description, color, shortcut, domain, range }`.
`shortcut` is a single keypress. `domain` / `range` are LRMoo / CRM
classes.

The default profile declares three: GEKO `denotation`, `dynamisation`,
`integration`. These are the canonical ekphrastic modalities.

### annotationLevels

The ICON / Panofsky tiers exposed in the MLAO anchor modal as
`hasConceptualLevel`. Default: pre-iconographical, iconographical,
iconological.

## How the frontend consumes a profile

On load:

1. The modality-selector modal renders one button per
   `linkingProperty`. Label, colour, and shortcut come from the
   manifest.
2. The entity-class dropdown (in the anchor modal) shows one option per
   `entityClass`, filtered by `applicableTo` and the active panel.
3. Annotations are serialised against the profile's `context.jsonld`.
4. The Data Model tab lists the built-in entity classes and conceptual
   levels and lets the user extend them at runtime; custom additions are
   stored in `localStorage` (Phase 3 will move them to backend
   persistence).

## How the backend consumes a profile

1. `scripts/bootstrap-fuseki.sh` discovers every `profiles/<id>/` with
   an `ontology.ttl` and `PUT`s it into the named graph
   `<BASE_NS>graphs/ontology/<id>` via the Graph Store Protocol.
   Idempotent — re-run any time an ontology changes.
2. `GET /profiles` returns the manifest of every profile found on disk
   (the `PROFILES_DIR`).
3. `GET /profiles/{id}` returns one manifest. The frontend reads this
   at boot to populate the UI.
4. `GET /contexts/{name}.jsonld` serves the profile's JSON-LD context.
5. `/health` reports `degraded` (with a `missing_ontologies[]` array)
   as long as any profile's graph has zero triples.

## Adding a new profile

1. Create `profiles/<your-id>/` with `manifest.json`, `context.jsonld`,
   `ontology.ttl`.
2. Restart the backend container so the filesystem scan picks it up:

   ```bash
   docker compose up -d --build backend
   ```

3. Re-run the bootstrap to load the new ontology graph:

   ```bash
   ./scripts/bootstrap-fuseki.sh
   ```

4. `curl localhost:8000/profiles` to verify it appears.
5. `curl localhost:8000/health` to confirm it returns `ok` (no
   `missing_ontologies` for your new profile).

There is no profile-switcher UI in Phase 1. The active profile is the
one the frontend hardcodes its references against (currently
`interim-geko`). Profile selection at runtime is a Phase 3 concern.
