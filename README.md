# VendorGuard AI

An AI-powered third-party risk management portal for security, procurement,
compliance, and risk teams — a portfolio project demonstrating Azure cloud
architecture, AI/RAG engineering, Model Context Protocol integration, and
security-first product design.

> **Build status:** Foundation phase complete and verified; most product
> phases are scaffolded/planned but not yet implemented. See
> [`ROADMAP.md`](./ROADMAP.md) for exactly what is done vs. outstanding, and
> [`docs/adr/0001-execution-environment-and-scope.md`](./docs/adr/0001-execution-environment-and-scope.md)
> for why.

## Product overview
VendorGuard AI supports third-party risk teams end to end, purpose-built for **banking/financial services and healthcare** organizations alongside general enterprise use: register a vendor → complete an inherent-risk questionnaire → get a deterministic, explainable risk score, automatically assessed against the frameworks your industry is actually examined against (FFIEC/GLBA for banks, HIPAA/NIST 800-66 for healthcare, NIST CSF/ISO 27001/800-161 for everyone) → upload evidence (SOC 2 reports, ISO certificates, pen-test summaries, DPAs, AI model cards) → ask an evidence-grounded AI assistant about the vendor → have the assistant invoke an MCP compliance server to propose control findings → have a human reviewer accept, reject, or override each finding → track remediation → generate an executive summary. Every important action is written to an append-only audit log.

**The AI assistant is a copilot, not the risk authority.** Final
assessments, control findings, and risk acceptance always require human
review — see [`docs/responsible-ai.md`](./docs/responsible-ai.md) (planned).

## Main features (target scope)
- Deterministic, versioned, explainable risk scoring (implemented — see below)
- Framework-independent compliance engine mapped to NIST CSF 2.0, NIST AI
  RMF, and ISO/IEC 27001:2022 (illustrative demonstration subsets, not full
  coverage)
- Evidence pipeline with provenance-backed citations
- MCP compliance server with tenant/role-bound, Zod-validated tools
- Prompt-injection resistant retrieval and tool-calling
- Human-in-the-loop review workflow with immutable machine proposals
- Tenant-isolated RBAC (5 roles) enforced server-side
- Append-only audit log
- Azure Container Apps deployment via Bicep + GitHub OIDC (no stored secrets)

## What's actually implemented and verified right now
| Area | Status |
|---|---|
| Monorepo tooling (pnpm + Turborepo + strict TS + ESLint) | ✅ built, installs cleanly |
| Environment validation, fail-closed on insecure production config | ✅ 7/7 tests passing |
| Deterministic risk-scoring engine (`R_inherent`, `R_residual`) | ✅ 17/17 boundary tests passing |
| Framework catalog (32 frameworks: 8 active + 15 conditional + 9 deferred, across general/banking/healthcare verticals and vendor-assessment/platform-security scopes) | ✅ 31/31 tests passing |
| Framework applicability engine (industry-vertical resolution + PCI/HIPAA/EU AI Act/FedRAMP/NYDFS/SWIFT/Basel/SOX/FDA/etc. trigger resolution) | ✅ 31/31 tests passing |
| Seed data: NIST SP 800-161, FFIEC Third-Party Relationships, GLBA Safeguards Rule, NIST SP 800-66, ISO 22301 — 52 controls total | ✅ written, counts verified against catalog |
| Full Prisma schema (26 models, 9 enums, all spec §5 entities) | ✅ structurally verified — `prisma validate` blocked by sandbox network allowlist, must run in a connected environment |
| Tenant isolation + RBAC (`@vendorguard/auth`) | ✅ 25/25 tests passing, including cross-tenant denial |
| RBAC role/permission model | ✅ implemented |
| Docker Compose (Postgres + Azurite) | ✅ written, YAML-validated (not run — see ADR-0001) |
| CI workflow (lint/typecheck/test/build/CodeQL/secret-scan/dependency-review) | 🚧 scaffolded |
| Everything else in the original spec (Prisma schema, API, web app, MCP server, evidence pipeline, Bicep, deploy workflow) | ⬜ planned, tracked in `ROADMAP.md` |

## Architecture (target)
```
apps/
  web/            Next.js (App Router) dashboard
  api/            Fastify REST API
  mcp-server/     MCP compliance server (official TS SDK)
packages/
  database/       Prisma schema + client
  shared/         env validation, domain enums, RBAC permission map   ✅ implemented
  auth/           tenant context + authorization middleware
  risk-engine/    deterministic risk scoring                          ✅ implemented
  framework-engine/  versioned compliance framework schema
  evidence-engine/   upload/extraction/citation pipeline
  ai-client/      AiProvider interface (fake + Azure implementations)
  storage/        blob storage abstraction (local/Azurite/Azure)
  observability/  OpenTelemetry-compatible structured logging
  ui/             shared React components
frameworks/       seeded NIST CSF 2.0 / NIST AI RMF / ISO 27001 subsets
evaluations/      golden dataset, prompt-injection tests, eval harness
infrastructure/   Bicep modules for Azure Container Apps deployment
```
See [`docs/architecture.md`](./docs/architecture.md) for the full context/
container/component views (planned).

## Technology stack
TypeScript monorepo · pnpm · Turborepo · Next.js · Fastify · Prisma ·
PostgreSQL · Zod · Model Context Protocol (official TS SDK) · Azure AI
Foundry · Azure Blob Storage · Azure AI Search · Azure Container Apps ·
Bicep · GitHub Actions (OIDC) · Vitest · Playwright · OpenTelemetry.

## Quick start
```bash
cp .env.example .env
pnpm install
docker compose up -d      # Postgres + Azurite (requires Docker locally)
pnpm db:migrate            # not yet available — Prisma schema is Phase 2
pnpm db:seed                # not yet available — Phase 2
pnpm dev                    # not yet available — apps/* are Phase 3+
```

What you **can** run today:
```bash
pnpm install
pnpm --filter @vendorguard/shared test              # 7 fail-closed env tests
pnpm --filter @vendorguard/risk-engine test          # 17 risk-scoring boundary tests
pnpm --filter @vendorguard/framework-engine test     # 19 catalog + applicability tests
pnpm --filter @vendorguard/shared typecheck
pnpm --filter @vendorguard/risk-engine typecheck
pnpm --filter @vendorguard/framework-engine typecheck
```

## Security design
- Fail-closed environment validation: production refuses to start with dev
  auth, the fake AI provider, non-Azure storage, or placeholder secrets.
- Deterministic risk scoring — an LLM never sets the final score.
- Tenant isolation enforced server-side from authenticated context, never
  from client-supplied IDs (design in `packages/auth`, not yet implemented).
- See [`docs/threat-model.md`](./docs/threat-model.md) and
  [`docs/mcp-security.md`](./docs/mcp-security.md) (planned).

## MCP overview
A dedicated MCP server exposes 12 read/validate/propose tools to the AI
assistant, each authorized against the authenticated actor's tenant and
role — never a model-supplied tenant argument. Risk acceptance is
intentionally **not** an available MCP tool. See `ROADMAP.md` Phase 6.

## Azure deployment
Target: Azure Container Apps for all three services, PostgreSQL Flexible
Server, Blob Storage (private, managed identity), Azure AI Search, Key
Vault, and GitHub Actions OIDC federation for secretless deployment. See
`ROADMAP.md` Phase 8 and `docs/deployment.md` (planned).

## CI/CD
`.github/workflows/pr-validation.yml` runs lint/typecheck/test/build plus
CodeQL, gitleaks, and dependency review on every PR.
`.github/workflows/deploy.yml` is scaffolded for OIDC-based Azure deployment
with build-once/promote-by-digest and required production approval, gated
behind `if: false` until Dockerfiles and Bicep modules exist (Phase 8).

## Limitations
This is a portfolio project, not an audited compliance product. Framework
control seed data is an illustrative demonstration subset, not full
NIST/ISO coverage, and is not a substitute for a real compliance program.
See `ROADMAP.md` for exact build status and `docs/responsible-ai.md`
(planned) for AI-specific limitations.

## Roadmap
See [`ROADMAP.md`](./ROADMAP.md).
