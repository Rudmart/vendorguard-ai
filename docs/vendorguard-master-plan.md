# VendorGuard AI - Complete Master Plan

Last updated: after M11 merged, M12 in progress.

Execution rule for everything below: one phase at a time. Compile-check after every real code change, test it live, commit in small batches before moving to the next phase.

---

## PHASE 1 - Close Out M11 - DONE

M11 (MCP Compliance Server) is fully complete and merged into master via PR #52. All 12 tools built against the real database, tenant scoping, audit logging, prompt-injection defenses, 6 passing security tests, documentation written, a real Fastify vulnerability documented and deferred with an explicit exception, and a real lockfile corruption bug found and fixed.

---

## PHASE 2 - Milestone 12: Human Approval Workflow - IN PROGRESS

Branch: feature/human-approval-workflow

Done so far:
- RBAC enforced on the finding review endpoint - viewing a finding no longer implies authority to review it
- Review queue endpoint built (GET /reviews/findings) - tenant-scoped, requires review authority, confirmed working live
- Frontend Pending Reviews page built and tested end-to-end - real ReviewDecision records confirmed created in the database on submit
- Discovered a pre-existing but completely disconnected RiskAcceptance model and wired it up, enforcing requireRiskAcceptanceAuthority (ADMIN/REVIEWER only)

Still needed before M12 is genuinely complete:
- A real automated test suite for all of the above (currently only manually verified)

Deliberately deferred to Polish phase:
- Concurrency/duplicate-decision protection
- Queue filtering and pagination
- A frontend page for Risk Acceptance

---

## PHASE 3 - Core Stabilization Review

Before touching anything new, confirm the full 12-milestone core is genuinely solid. A partial check already done: pnpm typecheck passes cleanly across all 16 tasks / 10 packages.

---

## PHASE 4 - Polish (60 steps)

### Phase A - Production Security Blockers (P0)
1. Fix production dev-login guard
2. Revalidate tenant isolation across every resource type - DONE. Audited all 41 API routes; found 9 real cross-tenant vulnerabilities (GET /assessments, GET /assessments/:id, GET /assessments/:id/framework-mapping, GET /questionnaires/:id, PATCH /remediations/:id, GET /ai-inventory, GET /vendors, GET /vendors/:id, GET /vendors/:id/risk-score - the last two had no auth check at all). Fixed by wiring in packages/auth's existing but previously-unused assertOwnedByTenant guard (findUnique routes) and adding tenantId to Prisma where clauses (findMany routes). Widened assertOwnedByTenant's context param type from full RequestContext to { tenantId: string } so it accepts the actual dev-mode SessionCookie shape - no behavior change, all 25 auth package tests plus full app test suite still pass. Branch: polish/tenant-isolation-audit.
3. Revalidate RBAC against an explicit permission matrix - DONE. Audited apps/api/src/index.ts against packages/shared/src/domain.ts's ROLE_PERMISSIONS matrix (ADMIN/ANALYST/REVIEWER/AUDITOR/READ_ONLY) and packages/auth/src/rbac.ts's requirePermission/requireRole guards. Found only 2 of ~30 mutating routes originally enforced any permission check at all. Added a new questionnaire:review permission (ADMIN+REVIEWER) for the questionnaire approval gate, which had no dedicated permission before. Widened requirePermission's context param type to { tenantId: string; role: Role } (same pattern as assertOwnedByTenant) to accept the actual dev-mode SessionCookie shape. Fixed all 14 confirmed RBAC gaps across 3 PRs (#58, #59, #61): questionnaire review/approve (each with separation-of-duties check blocking self-approval), POST /vendors, PATCH /vendors/:id, DELETE /vendors/:id, POST /vendors/:id/assessments, POST /assessments/:id/findings, POST /vendors/:id/remediations, PATCH /remediations/:id, POST /vendors/:id/evidence, POST /vendors/:id/evidence/upload, POST /assessments/:id/questionnaire, PATCH /questionnaires/:id/responses, POST /questionnaires/:id/submit. Also found and fixed 5 bonus tenant-isolation gaps the earlier tenant-isolation audit had missed (false-positived as safe because tenantId appeared in an unrelated audit-log line rather than a real ownership check). All 16 typecheck tasks and full test suite (including 25 auth package tests) pass; all merges had all 6 CI checks green.
4. Test M12 approval-bypass scenarios
5. Test MCP authorization regression
6. Fix AI citation relevance

## PHASE A.5 - GRC Workflow Guide (NEW)

A teaching/learning sidebar page for users new to GRC, placed near the top of the sidebar (right under Executive Dashboard), not grouped with the P1 workflow items below.

Purpose: help users understand that GRC is a connected process, not a set of separate screens.

Content: a short intro paragraph, a compact progress-strip visual of the 9-step sequence at the top, then a vertical walkthrough of 9 numbered steps (Dashboard, Vendors, Assessments, Risk, Controls, Evidence, Findings, Remediation, Reports), each with a short plain-English explanation and a button linking to the real existing page that handles that part of the lifecycle. Risk and Findings both link into Assessment Workspace; Controls links to Framework Explorer.

Explicitly out of scope for v1: no fake completion tracking, no new backend endpoints - every button routes to a page that already exists.

Placement rationale: this is a UX/education addition, sits alongside Phase A/B polish work rather than blocking it, and does not affect the P0 security blockers ahead of it.

---

### Phase B - Workflow and UX (P1)
7. Reorder sidebar - full plan (from user's own audit of the application, saved verbatim):

TPRM WORKFLOW
1. Executive Dashboard - The landing/control-tower view showing the overall vendor risk posture.
2. Vendor Inventory - The master list of all third-party vendors being tracked.
3. Assessment Workspace - Where the user evaluates a vendor, checks controls, answers assessment questions and determines the risk score.
4. Pending Reviews - Where AI-generated findings or recommendations requiring human judgment are reviewed and approved, rejected, or challenged.
5. Remediation Tracker - Where identified issues and required corrective actions are tracked through to completion.
6. Vendor Reports - Where the final assessment and risk information can be presented to management, auditors, clients, etc.

GOVERNANCE and REFERENCE
7. Evidence Library - The repository for contracts, certificates, security reports, policies and other evidence supporting the assessment.
8. Framework Explorer - The reference area for NIST, ISO, HIPAA and other frameworks against which the vendors are assessed.
9. Audit Logs - The permanent record of activities, decisions, approvals and changes for accountability and auditability.
10. AI Agents - The registry of the organization's own AI systems, kept separate from the vendor workflow since these are internally developed or deployed AI systems rather than third-party vendors. Depends on Phase 4.5 (Agent Registry) being built first - show as "soon" until then.

SYSTEM
11. Administration - Users, roles, permissions and platform configuration.

AI Assistant should NOT be a numbered sidebar item - it is not a step in the process, it is a helper accessible at any point. Make it a persistent/global feature (header button or floating assistant) instead.

Pending Reviews should visually demonstrate the core governance principle: AI Recommendation -> Human Review -> Human Decision -> Decision Recorded -> Remediation, if required. This should be shown in the UI, not just described in documentation.

Terminology suggestions for a first-time user: "Assessment Workspace" -> "Vendor Assessments"; "Framework Explorer" -> "Compliance Frameworks".

Guiding principle: the sidebar should reflect the user's journey through the process, rather than simply listing all the features available in the application.
8. Implement real global search or remove placeholder
9. Standardize status vocabulary
10. Standardize page layouts
11. Standardize forms/buttons/tables
12. Improve navigation/breadcrumbs

### Phase C - States and Accessibility (P1)
13. Loading states
14. Empty states
15. Error states
16. Permission states
17. Accessibility pass (WCAG 2.2 AA)
18. Responsive design pass

### Phase D - GRC Workflow Quality (P1)
19. Vendor lifecycle transitions
20. Risk terminology consistency
21. Evidence workflow display
22. Findings/remediation traceability
23. AI vs human decision visual distinction
24. Audit trail readability

### Phase E - Technical Hardening (P0/P1)
25. Input validation review
26. XSS/output encoding review
27. CSRF review
28. IDOR testing
29. File upload security
30. Rate limiting
31. Session security
32. Dependency vulnerability scan (Fastify 4 to 5 upgrade belongs here)

### Phase F - Performance and Data Integrity (P2)
33. Frontend performance
34. API performance
35. Database queries
36. Pagination
37. Indexes
38. Referential integrity
39. Duplicate-prevention logic
40. Delete vs archive vs deactivate

### Phase G - Operations (P2)
41. Structured logging
42. Correlation-ID validation end-to-end
43. Health/readiness endpoints
44. Production environment validation
45. Remove dev/debug behavior from production

### Phase H - Final Client-Facing Polish (P2)
46. Login page polish
47. Dashboard polish
48. Help text/tooltips
49. Report/export presentation polish
50. Branding consistency

### Phase I - Final Validation
51. Full regression test
52. Security regression test
53. Accessibility spot check
54. Responsive test
55. Role-based workflow test
56. AI citation accuracy test
57. MCP test
58. Human approval test
59. Executive/demo walkthrough
60. Freeze stable release

Nice-to-have (P3): saved searches, favorites, keyboard shortcuts, notification center, theme options, in-app tutorials.

---

## PHASE 4.5 - Agent Registry (NEW)

A genuinely separate concept from the existing AI Inventory page, which is just a filtered view of vendors flagged as AI-related. This tracks the organization's own AI agents/systems directly, independent of any vendor, matching EU AI Act and NIST AI RMF Map function requirements.

Scope deliberately kept minimal for v1. Explicitly excluded: shadow-AI discovery, runtime monitoring, agent identities/OAuth scopes, agent-to-agent maps, MCP runtime inspection, kill switches, automatic risk scoring, automated EU AI Act classification, model cards, dataset inventories, prompt logging, agent versioning, continuous control monitoring.

Data model: AiAgent (id, tenantId, name, description, purpose, ownerUserId, ownerTeam, autonomyLevel, deploymentStatus, riskTier, dataAccessSummary, requiresHumanOversight, createdByUserId, updatedByUserId, retiredAt, retirementReason, timestamps) and AiAgentFrameworkMapping, a join table reusing the existing framework-mapping engine rather than building a second one.

API routes: POST /ai-agents, GET /ai-agents, GET /ai-agents/:id, PATCH /ai-agents/:id, PUT /ai-agents/:id/frameworks, POST /ai-agents/:id/retire (lifecycle action, never hard-delete).

RBAC: three capabilities, ai_agent.read, ai_agent.manage, ai_agent.retire, mapped onto existing roles.

Frontend: new sidebar item AI Agents at /governance/ai-agents, does not replace existing AI Inventory. Simple table with basic filters, a simple create/edit form (no wizard), a detail page with Edit/Retire actions.

Explicitly deferred for v1: no human-approval integration on every edit, no governanceStatus field until backed by a real approval workflow.

Test scenarios: Data/API validation and retirement behavior, tenant isolation aggressively tested, full RBAC permission matrix, framework mapping correctness, lifecycle transitions (retirement final in v1), audit events for every lifecycle action.

End-to-end demo: register a real Consumer Loan Assessment Agent, confirm applicable controls display via the existing framework engine, move through the lifecycle, confirm audit trail, retire it, confirm it remains historically available.

Placement rationale: sits after Polish so it inherits a clean, hardened codebase, and before RAG so RAG's scope can include agent data from the start.

---

## PHASE 5 - RAG (Cross-Vendor / Cross-Document Search)

Only after Phase 4.5 is complete. pgvector on existing Postgres. Pipeline: upload, validation, extraction, chunking, metadata, embedding, storage. Authorization before retrieval, never after. MCP and RAG stay conceptually distinct. 18 test scenarios.

---

## PHASE 6 - Azure Deployment

Only after Phase 5 and its security testing are complete. Dockerfiles, Bicep infrastructure, Managed Identity, CI/CD wiring, environment separation, security baseline check. Estimated total: ~$30-50/month.

---

## PHASE 7 - Later (explicitly deferred)

n8n automation, Azure Continuous Compliance, Learning Platform mode, Consulting Simulation mode.

---

## PHASE 8 - Demo/Portfolio Video (Absolute Last)

Recorded only after every phase above is genuinely done, showing the real, fully deployed, fully finished product live on Azure.

---

## Standing Rules

- Don't rename RAG/Azure/n8n/Agent Registry as new numbered core milestones
- Don't change the risk-scoring formula without explicit sign-off
- Don't let AI make final governance decisions, ever
- Don't let MCP, RAG, n8n, or the Agent Registry bypass VendorGuard's own authorization
- VendorGuard's own database stays the system of record, always
- One phase at a time; verify before advancing
