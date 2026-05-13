# Planning bundle — what to do with these files

This is a starter kit for the v2 refactor. Drop these files into the repo root (paths preserved) and Claude Code will pick them up on the next session.

## Files in priority order

1. **`CLAUDE.md`** — Goes at the repo root. Claude Code reads this automatically every session. It's the briefing: project context, conventions, do-nots, current phase.

2. **`ROADMAP.md`** — Master plan with the five phases and their deadlines. Reference document.

3. **`PHASE-1-POSTER-DEMO.md`** — The atomic task list for the next 19 days. This is what Claude Code should be executing right now. Tasks are ordered; each has a "DONE WHEN" criterion.

4. **`docs/architecture/ARCHITECTURE-v2.md`** — The target architecture. Normative: code that contradicts this should trigger a new ADR rather than a quiet exception.

5. **`docs/adr/0001-rebrand-multimodal.md`** — ADR for the rebrand decision.
6. **`docs/adr/0002-rdf-native-backend.md`** — ADR for Strategy B.
7. **`docs/adr/0003-pluggable-profiles.md`** — ADR for the profile system.

8. **`contexts/multimodal-context.jsonld`** — Seed JSON-LD context. Phase 1 task T1.2 will harden this — verify the namespace URIs first (the file has a leading `_comment` flagging which ones I'm uncertain about, notably LRMoo's IFLA-namespace URL).

## Recommended order for working with Claude Code

1. Commit this entire bundle in one commit with the message: `chore: introduce v2 planning bundle (CLAUDE.md, roadmap, ADRs, context)`.
2. Open Claude Code in the repo.
3. First prompt: "Read CLAUDE.md, then ROADMAP.md, then PHASE-1-POSTER-DEMO.md. Then begin task T1.1 (repo restructure). After each task, propose the changes and let me review before committing."
4. After T1.1 lands, move to T1.2. The context file is already drafted — Claude Code's job is to verify the namespaces, fix any issues, then run a round-trip check with `pyld` against a v1 export.

## What I'm explicitly not providing yet

- **No backend code.** Wanted to keep this bundle focused on planning. The FastAPI skeleton is task T1.3, easy to scaffold once you confirm the broad architecture.
- **No `docker-compose.yml`.** Same reason — trivial once T1.3 starts.
- **No alternative profile (`cidoc-crm-bare` or `iconclass`).** Decision is in T2.3 of PHASE-1 — pick one and we'll build it then.
- **No SHACL shapes.** Phase 3 work.

## Things I want you to push back on before we start executing

These are decisions I made on your behalf in the bundle; before committing, check each one:

1. **The name "Multimodal Annotator"** — picked it as a working title. If you have a better one already in mind, change `CLAUDE.md` §"Naming convention" and ADR 0001 before commit.
2. **The choice of Fuseki over GraphDB / Oxigraph** — Fuseki is my default recommendation, but if you have a preference based on what your Hertziana / Max Planck infrastructure already runs, swap it. The whole architecture works with any SPARQL 1.1 store.
3. **Python / FastAPI for the gateway** — alternative would be Node (Hono / Fastify) if you prefer Node tooling. RDF ecosystem in Python is more mature, but you have to live with whatever you pick.
4. **The second profile suggestion (CIDOC-CRM-bare vs Iconclass-only)** — pick before T2.3 starts.
5. **The 17-day schedule** — does the week-by-week distribution match your actual time availability? If you have other deadlines competing (UniBo grading, Peirce 2026 work, knee rehab), the buffer in Week 3 might already be eaten. Tell Claude Code what's actually realistic.
6. **LRMoo namespace URI** — I noted the uncertainty in the context file. Verify against current IFLA documentation before committing the context file.

## Things I'm aware I haven't covered

- **CI / testing setup.** Phase 1 has no automated tests planned. That's a deliberate sacrifice for speed; flag it in the README and add basic backend tests in Phase 2 stabilisation.
- **Backup / data persistence between Docker restarts.** The TDB2 volume in compose will handle this, but document it explicitly in the README to avoid first-time-user heartbreak.
- **CORS configuration on the backend.** Allow the frontend dev server's origin; for production deployment write it in the docs.
- **Versioning convention.** I assumed semver (`0.2.0-poster`, etc.). If you use CalVer or something else, adjust ROADMAP.md.
