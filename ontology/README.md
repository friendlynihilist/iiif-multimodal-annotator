# ontology/

> This directory previously held `interim.ttl` and `model interim.jpg`. As part of the v2 profile-driven architecture (ADR 0003), every ontology is bundled inside the profile it backs.
>
> The INTERIM/GEKO ontology has moved to:
>
> - `profiles/interim-geko/ontology.ttl` (the Turtle file, with the HICO namespace corrected to `https://w3id.org/hico/`)
> - `profiles/interim-geko/model-interim.jpg` (conceptual diagram, renamed without the space)
>
> This `ontology/` directory will be removed entirely in Phase 3. It survives at v0.2.x only so existing external references to the file path `ontology/interim.ttl` produce a clear pointer instead of a 404 in cloned working trees.
