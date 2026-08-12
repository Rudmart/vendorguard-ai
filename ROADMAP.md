# ROADMAP

Status legend: ✅ done and verified in this session · 🚧 scaffolded, not verified · ⬜ not started

## Phase 0 — Discovery and decisions
✅ Repository assessed, ADR-0001 recorded, plan produced, implementation started immediately.

## Phase 1 — Foundation
✅ pnpm + Turborepo monorepo initialized (`pnpm-workspace.yaml`, `turbo.json`)
✅ Strict TypeScript base config (`tsconfig.base.json`)
✅ ESLint config (`no-explicit-any: error`, per spec §27)
✅ Docker Compose (Postgres 16 + Azurite) — YAML validated, **not run** (no Docker daemon in this session)
✅ Environment validation with fail-closed production checks (`@vendorguard/shared`), 7/7 tests passing
✅ Root CI workflow scaffolded (`pr-validation.yml`): lint, typecheck, test, build, CodeQL, gitleaks, dependency review, Bicep lint stub
🚧 Deploy workflow scaffolded with `if: false` guards pending Phase 8 artifacts
⬜ Prettier config file, commitlint/husky pre-commit hooks

## Phase 2 — Domain and identity
✅ Role/permission model implemented (`@vendorguard/shared/domain.ts`): 5 roles, permission map, `roleHasPermission()`
✅ **Full Prisma schema** (`packages/database/prisma/schema.prisma`): all 26 models from spec §5 (25 required entities + the TenantMembership join table), 9 enums, every tenant-owned model carries an indexed `tenantId`. Structurally verified in this session (balanced braces, all 26 required entities present, every `@relation(fields: [...])` references a declared field) — **actual `prisma validate`/`generate` could NOT be run**: this sandbox's network allowlist doesn't include `binaries.prisma.sh`, so the Prisma engine binary can't download. This must be run for real (`pnpm db:validate`) in a connected environment (Claude Code, CI) before the schema is trusted for migration.
✅ **`packages/auth`**: tenant-context resolution (`resolveRequestContext` — builds a `RequestContext` from verified claims + a real `TenantMembership` lookup, role always comes from the membership row, never from client claims) and RBAC guards (`requirePermission`, `requireRole`, `requireRiskAcceptanceAuthority`, `requireFindingReviewAuthority`). **25/25 tests passing**, including the spec-required cross-tenant-isolation proof: a user with a membership in tenant B but not tenant A is denied when requesting tenant A, and a user with memberships in *both* tenants only ever resolves the role for the tenant actually requested (never the more-privileged role from the other tenant).
⬜ Seed script (`pnpm db:seed`) with realistic synthetic tenants/users/vendors — schema and auth layer exist to support it, script not yet written
⬜ Cross-tenant isolation tests **against a real Postgres** (current tests are pure-logic against an in-memory fake lookup, which proves the guard logic is correct; a repository-layer integration test against actual Prisma queries is the next step once `prisma generate` can run)

## Phase 3 — Vendor workflow
✅ Deterministic risk-scoring engine (`@vendorguard/risk-engine`): weighted `R_inherent`, `R_residual = R_inherent * (1 - controlEffectiveness)`, versioned (`risk-model-2025.1`), clamped 0–100, 4 risk bands, factor-contribution breakdown, missing-input handling, 17/17 boundary tests passing (including all six band edges: 24/25/49/50/74/75)
⬜ Fastify API: vendor CRUD endpoints, DTOs, Zod validation, OpenAPI
⬜ Next.js: intake wizard, vendor inventory, vendor detail page
⬜ Executive dashboard backed by real Postgres queries

## Phase 4 — Framework and assessment workflow
✅ `packages/framework-engine`: versioned framework/control schema, EXACT/PARTIAL/RELATED mapping types (`types.ts`)
✅ **Framework catalog** (`catalog.ts`): all 21 frameworks discussed for this product, encoded as data — not just prose — with `scope` (VENDOR_ASSESSMENT vs PLATFORM_SECURITY) and `status` (ACTIVE / CONDITIONAL / DEFERRED). 19/19 tests passing, including integrity checks (no CONDITIONAL entry without a trigger, no DEFERRED/CONDITIONAL entry claiming seeded controls, etc.)
✅ **Applicability engine** (`applicability.ts`): resolves which CONDITIONAL frameworks activate for a given vendor profile (PCI DSS on payment-card data, HIPAA/HITRUST on PHI, EU AI Act on AI + EU exposure, FedRAMP on cloud+government, etc.) — 10/10 tests passing
✅ Seed data: ≥15 NIST CSF 2.0 controls, ≥12 NIST AI RMF subcategories, ≥12 ISO/IEC 27001:2022 references (existing, still ⬜ actual JSON not yet written — see below) **plus** ≥12 NIST SP 800-161 (C-SCRM) controls — the framework written specifically for supply-chain/third-party risk, added this session because CSF/ISO/AI RMF are general-purpose and don't cover supplier due diligence, contractual flow-down, or fourth-party visibility directly. Original summaries only, source URLs linked, labeled as a demonstration subset. **JSON written and verified**: `frameworks/nist-800-161/controls.json` (12/12 controls, count cross-checked against the catalog).
### Industry verticals: banking/financial services and healthcare (added this session)
The catalog and applicability engine now model **industry vertical** as a first-class dimension, not just per-vendor conditionals. Every framework carries an `industries` tag (`GENERAL`, `BANKING_FINANCIAL`, `HEALTHCARE`), and `resolveApplicableFrameworks(vendor, tenant)` takes a tenant profile whose `industry` field determines which industry-specific **ACTIVE** frameworks are seeded for every vendor in that tenant — the same way the four GENERAL frameworks apply to everyone, without a GENERAL tenant ever seeing banking- or healthcare-specific content by default.

**Newly ACTIVE, industry-scoped** (seeded now, 40 controls written and count-verified):
- `ffiec-outsourcing` — FFIEC IT Examination Handbook, Third-Party Relationships (12 controls) — BANKING_FINANCIAL. The actual framework U.S. bank examiners assess a TPRM program against.
- `glba-safeguards` — GLBA Safeguards Rule (10 controls) — BANKING_FINANCIAL. Substantive NPI data-protection obligation, distinct from FFIEC's process guidance.
- `nist-800-66` — NIST SP 800-66, HIPAA Security Rule implementation guide (10 controls) — HEALTHCARE. More actionable than HIPAA's statutory text for control-level assessment.
- `iso-22301` — Business Continuity Management (8 controls) — **both** BANKING_FINANCIAL and HEALTHCARE. Operational resilience matters identically to both regulated sectors.

**Newly CONDITIONAL** (schema-modeled with real trigger predicates, seeded only when a vendor/tenant field matches):
- Banking: NYDFS 23 NYCRR 500 (tenant is NY-regulated), SWIFT CSP (vendor processes SWIFT messaging), Basel Committee outsourcing principles (tenant is D-SIB/G-SIB tier), SOX ICFR (vendor affects financial reporting AND tenant is publicly traded).
- Healthcare: FDA premarket/postmarket medical-device cybersecurity guidance (vendor category is MEDICAL_DEVICE), 42 CFR Part 2 (vendor handles substance-use records), CMS regulations (vendor processes Medicare/Medicaid claims).

All of this is tested: `listActiveFrameworksForIndustry("GENERAL")` → 4, `("BANKING_FINANCIAL")` → 7, `("HEALTHCARE")` → 6, with tests proving cross-industry isolation (a healthcare tenant never sees FFIEC; a banking tenant never sees NIST 800-66) and every new conditional trigger. **31/31 framework-engine tests passing** (up from 19).

⬜ `frameworks/nist-csf-2.0/controls.json`, `frameworks/nist-ai-rmf/controls.json`, `frameworks/iso-27001-2022/controls.json` — directories exist, catalog declares their counts, actual seed JSON not yet written (do this alongside the frameworks already written, following the same shape)
⬜ Framework explorer UI (mocked visually in the HTML UI preview, not wired to real data)
⬜ Assessment + ControlFinding + ReviewDecision data flow

### Conditional and deferred frameworks (decided now, built later)
The catalog also encodes every framework flagged as relevant to a mature TPRM program but not seeded yet:
- **CONDITIONAL** (schema-modeled with a real activation trigger, seeded only once a real vendor's fields match it): ISO/IEC 27036, CSA CAIQ/CCM, PCI DSS, HIPAA/HITRUST CSF, FedRAMP (NIST 800-53 vendor-facing baseline), ISO/IEC 42001 (vendor AI governance), EU AI Act risk classification, OWASP LLM Top 10 applied to a vendor's own AI product.
- **DEFERRED** (acknowledged in-scope, not yet schema-triggerable — usually a licensing decision or missing prerequisite data): Shared Assessments SIG (licensing terms must be resolved before any content is seeded), MITRE ATLAS applied to a vendor's AI system (more valuable as questionnaire-design input once several AI vendors exist).

Building full control catalogs for frameworks no seeded vendor triggers would be seed-content nobody exercises — the applicability engine exists so "add later" is a real, testable, data-driven decision instead of a promise in a README.

## Phase 5 — Evidence
⬜ `packages/evidence-engine`: upload pipeline (extension allowlist, MIME verification, size limits, SHA-256 hashing, duplicate detection), state machine (UPLOADED→...→INDEXED/FAILED/EXPIRED)
⬜ `packages/storage`: local/Azurite dev adapter + Azure Blob (managed identity, private containers, short-lived SAS) adapter behind one interface
⬜ Chunking + citation provenance (document ID, version, page/section, chunk ID, excerpt, score, content hash)
⬜ Malware-scan adapter interface (stub + documented real integration point)

## Phase 6 — AI and MCP
⬜ `packages/ai-client`: `AiProvider` interface, `FakeAiProvider` (blocked in prod — the fail-closed check for this already exists in `@vendorguard/shared/env.ts`), `AzureAiProvider`
⬜ Retrieval-grounded assistant: INSUFFICIENT_EVIDENCE / CONFLICTING_EVIDENCE handling, no autonomous risk acceptance, no autonomous remediation closure
⬜ `apps/mcp-server`: official TS MCP SDK, all 12 tools from spec §15 with Zod schemas, tenant/role bound to authenticated context (not model-supplied), read/write tool separation, correlation-ID logging with redaction
⬜ Prompt-injection defenses: untrusted-content delimiting, tool allowlisting, injection-phrase flagging
⬜ `evaluations/prompt-injection`: the 5 adversarial evidence tests from spec §16

## Phase 7 — Remediation and audit
⬜ Remediation tracker (create/track actions, approval required to close)
⬜ Append-only AuditEvent log + filterable audit screen
⬜ Human review workflow: PROPOSED status, Accept/Reject/Override/Request-more-evidence/Not-applicable, immutable original proposal

## Phase 8 — Azure and DevSecOps
⬜ Bicep modules: resource group, ACR, Container Apps environment, 3 container apps, PostgreSQL Flexible Server, Storage (private), Azure AI Search, Key Vault, Log Analytics, App Insights, user-assigned managed identities, optional APIM/Front Door+WAF/private endpoints modules
⬜ Dockerfiles for web/api/mcp-server (multi-stage, non-root, minimal base images)
⬜ Enable the `if: false` blocks in `deploy.yml` once the above exist; wire GitHub OIDC federated credentials (documented in `docs/deployment.md`)
⬜ Container vulnerability scan + SBOM generation in CI

### Platform security frameworks (separate from the vendor-assessment catalog above)
Also encoded in `packages/framework-engine/src/catalog.ts` under `scope: "PLATFORM_SECURITY"`, and now documented in `docs/threat-model.md`:
- **Active now** (architecture-level discipline applied from the first line of code): OWASP API Security Top 10 → `apps/api`; OWASP Top 10 (Web) → `apps/web`; OWASP LLM Top 10 → `apps/mcp-server` / `packages/ai-client` (this is exactly what the prompt-injection defenses in Phase 6 implement).
- **Deferred** (require an artifact — detection tooling, a built feature, or an assessment decision — that doesn't exist yet): NIST SP 800-53 Rev. 5 (full baseline mapping), MITRE ATT&CK (infra threat modeling), MITRE ATLAS (AI-pipeline threat modeling), ISO/IEC 42001 (AI management system for the assistant feature itself).

## Phase 9 — Evaluation and polish
⬜ `pnpm eval` harness against `evaluations/golden-dataset` producing JSON + Markdown reports
⬜ Playwright core user journey
⬜ Full documentation set (`docs/architecture.md`, `threat-model.md`, `data-flow.md`, `authorization-model.md`, `responsible-ai.md`, `mcp-security.md`, `deployment.md`, `demo-script.md`)
⬜ Accessibility pass, responsive polish, empty/loading/error states everywhere

## How to continue this build
This repository was scaffolded and verified inside a sandboxed session with
no GitHub or Azure connectivity (see `docs/adr/0001-execution-environment-and-scope.md`).
To continue:

```bash
git init && git add -A && git commit -m "chore: scaffold VendorGuard AI foundation (Phase 0-1, partial 2-3)"
gh repo create vendorguard-ai --private --source=. --push
```

Then run subsequent phases with **Claude Code** against the real repo, where
it can execute `pnpm`, `docker`, `az`, and `gh` directly, open PRs per phase,
and validate each phase's CI run for real before moving to the next.
