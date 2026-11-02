# Website Accessibility & UI Health Checker: Design Docs

Phase 1 (architecture & planning). Read in this order:

| Doc | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | System architecture, data flow, scan pipeline, scoring, fingerprints, technology choices & versions |
| [02-modules.md](02-modules.md) | All 16 modules: what, how, limitations, tests, debugging |
| [03-database.md](03-database.md) | ER diagram, tables, design decisions, cascades, indexes |
| [../packages/db/prisma/schema.prisma](../packages/db/prisma/schema.prisma) | The Prisma schema (implemented in Phase 2) |
| [04-api.md](04-api.md) | REST API specification |
| [05-security.md](05-security.md) | Threat model, SSRF defence, auth, RBAC, data handling |
| [06-project-structure.md](06-project-structure.md) | Folder structure and scripts |
| [07-user-workflow.md](07-user-workflow.md) | User journeys, scan state machine, page map, layout |
| [08-roadmap.md](08-roadmap.md) | Phases 2–8 with "done when" criteria and risks |
| [09-phase-2-setup.md](09-phase-2-setup.md) | Phase 2 explained: monorepo, config files, dependencies, database, health checks, debugging |
| [10-phase-3-auth.md](10-phase-3-auth.md) | Phase 3 explained: authentication flow, JWT, roles, projects, websites, tests, debugging |
| [VERSIONS.md](VERSIONS.md) | Exact package and image versions, and why |

Diagrams use Mermaid; they render on GitHub and in VS Code (with a Mermaid
preview extension).
