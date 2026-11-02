# Website Accessibility & UI Health Checker: Design Docs

Phase 1 (architecture & planning). Read in this order:

| Doc | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | System architecture, data flow, scan pipeline, scoring, fingerprints, technology choices & versions |
| [02-modules.md](02-modules.md) | All 16 modules: what, how, limitations, tests, debugging |
| [03-database.md](03-database.md) | ER diagram, tables, design decisions, cascades, indexes |
| [schema.draft.prisma](schema.draft.prisma) | Full draft Prisma schema (validated) |
| [04-api.md](04-api.md) | REST API specification |
| [05-security.md](05-security.md) | Threat model, SSRF defence, auth, RBAC, data handling |
| [06-project-structure.md](06-project-structure.md) | Folder structure and scripts |
| [07-user-workflow.md](07-user-workflow.md) | User journeys, scan state machine, page map, layout |
| [08-roadmap.md](08-roadmap.md) | Phases 2–8 with "done when" criteria and risks |

Diagrams use Mermaid; they render on GitHub and in VS Code (with a Mermaid
preview extension).
