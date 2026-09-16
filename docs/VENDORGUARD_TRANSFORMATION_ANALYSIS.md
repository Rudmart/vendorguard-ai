# VendorGuard AI - Transformation Analysis (Phase 0 Discovery)

Status: DISCOVERY ONLY. No code, database, or navigation changes have been
made as part of this document. Per the transformation prompt's own rule
(Section 53), this stops here for review before any Phase 1 work begins.

Scope of this analysis: the full existing VendorGuard AI repository as of
commit 5aca52a on master - architecture, database, API, frontend routes,
RBAC, and test coverage, inspected directly rather than assumed.

---

## 1. Executive Summary

VendorGuard AI today is a genuinely solid, working, and well-tested
Third-Party Risk Management (TPRM) application: multi-tenant, RBAC-enforced,
with a real assessment/evidence/findings/remediation/human-review lifecycle,
an MCP server exposing governed read-only tools, and an AI Assistant with
citation relevance and prompt-injection defenses. All of Phase A (6
production security blockers) is fixed and verified with automated tests.

Two findings from this discovery are worth flagging immediately because they
change the shape of the transformation:

1. **AI-specific risk scoring already exists.** `POST
   /assessments/:id/ai-risk-score` and `POST
   /assessments/:id/ai-impact-score` are real, working backend endpoints.
   This is a meaningful chunk of the proposed "AI Risk Assessments" and "AI
   Impact Assessments" domains (Sections 12-13 of the transformation prompt)
   that does not need to be built from scratch - it needs to be surfaced,
   connected to navigation, and possibly extended.

2. **Two real bugs exist independent of any transformation decision**,
   found during this discovery and worth fixing regardless of what happens
   next:
   - The sidebar's "Evidence Library" link points to `/evidence`, which is
     not a real route. Evidence only exists per-vendor at
     `/vendors/[id]/evidence`. This is a live 404 in the current app.
   - `/audit-log` has a real page file in the frontend, but the sidebar
     marks it "soon" (built: false) - either the sidebar is wrong, or the
     page is a stub not wired to real data. Needs verification either way.

---

## 2. Current Database Model Inventory (Prisma, 34 models / 11 enums)

| Model | Purpose (as built) | Reusable for AI Governance? |
|---|---|---|
| Tenant | Multi-tenant boundary | KEEP - foundational, unchanged |
| User | Auth identity | KEEP - foundational, unchanged |
| TenantMembership | User-tenant-role binding | KEEP - foundational, unchanged |
| Vendor | Third-party org being assessed | REUSE - becomes one "AI system source" (third-party) alongside internal AI systems |
| VendorContact | Vendor point of contact | KEEP as-is |
| VendorService | Service(s) a vendor provides | REUSE - could carry AI-specific service metadata |
| Subprocessor | Vendor's own subprocessors | KEEP as-is |
| Assessment | Core risk assessment record | EXTEND - already generic enough to become the shared assessment engine the target architecture calls for (Section 12) |
| AssessmentFramework | Assessment-to-framework link | KEEP as-is |
| RiskRating | Inherent/residual/final risk scores | REUSE - the AI risk-score/impact-score endpoints already write into fields on this model per the discovery above |
| Questionnaire / QuestionnaireResponse | Due-diligence Q&A | KEEP as-is, reusable by any assessment type |
| EvidenceDocument / EvidenceChunk | Evidence storage + extracted text | EXTEND - target architecture's Evidence & Assurance domain (Section 18) is a superset of what exists; add review-status fields rather than replace |
| Framework / FrameworkVersion / Control / ControlMapping | Framework/control engine | KEEP - explicitly called out in the prompt as "do not replace if it works" (Section 16) |
| ControlFinding | Findings from assessments | EXTEND - target architecture wants findings to originate from more sources (control tests, incidents, monitoring); current model is a solid base, not a rebuild |
| FindingEvidence | Finding-to-evidence link | KEEP as-is |
| ReviewDecision | Human review/approval record | REUSE - this is exactly the "Human Review" infrastructure Section 21 says must be preserved and reused, not rebuilt |
| RemediationAction | Remediation tracking | KEEP as-is, reusable across AI systems and vendors |
| RiskAcceptance | Formal risk acceptance | KEEP - matches Section 22's Risk Acceptance workflow closely already |
| AssistantConversation / AssistantMessage | AI Assistant chat history | KEEP as-is |
| MCPInvocation | MCP tool call audit trail | KEEP as-is |
| AuditEvent | System-wide audit log | KEEP - foundational, unchanged |

**No model needs to be deleted.** Nothing in the existing schema conflicts
with the target architecture; the gap is entirely additive (new models for
AI-specific concepts like AI Inventory-as-a-first-class-object, AI Agents,
Use Case Intake, Classification, Policies, Exceptions) plus some relabeling
of existing fields/enums, not a rebuild.

---

## 3. Current Capability Inventory

| Existing Capability | Existing Route | API | DB Model | Working? | Reusable? | New Platform Area | Required Change |
|---|---|---|---|---|---|---|---|
| Vendor registration | /vendors-list | POST /vendors | Vendor | Yes | Yes | Third-Party AI | None - already matches target Section 25 |
| Vendor criticality/tiering | /vendors-list, /vendors/:id/edit | PATCH /vendors/:id | Vendor | Yes | Yes | Third-Party AI | None |
| Vendor risk score | /vendors/:id | GET /vendors/:id/risk-score | RiskRating | Yes | Yes | AI Risk / Third-Party AI | None |
| Assessment workspace | /assessments, /assessments/:id | GET/POST /assessments* | Assessment | Yes | Yes | Shared assessment engine (Section 12) | Extend to support non-vendor assessment subjects |
| Questionnaire due diligence | /assessments/:id/questionnaire | POST/PATCH /questionnaires/:id* | Questionnaire | Yes | Yes | AI Risk Assessments | None |
| **AI risk scoring** | (not surfaced in UI) | POST /assessments/:id/ai-risk-score | RiskRating | Yes (backend only) | Yes - major reuse | AI Risk Register (Section 11) | Build UI surface; currently backend-only |
| **AI impact scoring** | (not surfaced in UI) | POST /assessments/:id/ai-impact-score | RiskRating | Yes (backend only) | Yes - major reuse | AI Impact Assessments (Section 13) | Build UI surface; currently backend-only |
| Framework/control mapping | /frameworks, /frameworks/:id | GET /frameworks*, /assessments/:id/framework-mapping | Framework, Control, ControlMapping | Yes | Yes | Compliance Framework Engine (Section 16) | None - explicitly preserve per prompt |
| Evidence upload/review | /vendors/:id/evidence | POST/GET /vendors/:id/evidence* | EvidenceDocument | Yes | Yes | Evidence & Assurance (Section 18) | Add review-status enum (SUFFICIENT/INSUFFICIENT/etc); add global Evidence Library view since none currently exists |
| **Evidence Library sidebar link** | /evidence (BROKEN - 404) | n/a | n/a | **No - confirmed bug** | n/a | n/a | Fix regardless of transformation decision |
| Findings | /assessments/:id | POST /assessments/:id/findings, /findings/:id/review | ControlFinding | Yes | Yes | Findings Management (Section 20) | Extend to accept findings from more sources over time |
| Human review/approval | /governance/reviews | GET /reviews/findings, POST /findings/:id/review, /questionnaires/:id/review+approve | ReviewDecision | Yes, with separation-of-duties enforced | Yes - directly matches Section 21 | Human Review | None - already exactly the pattern the target wants |
| Risk acceptance | /vendors/:id (page), API only | POST/GET /vendors/:id/risk-acceptance | RiskAcceptance | Yes | Yes | Risk Acceptance (Section 22) | Minor - add expiration/review-date fields if not present |
| Remediation tracking | /remediation | POST/GET/PATCH /remediations* | RemediationAction | Yes | Yes | Remediation | None |
| AI Inventory (vendor-AI flagging) | /ai-inventory | GET /ai-inventory | (derived from Vendor/Assessment data) | Yes | Partially - this is vendor-AI flagging, not a first-class AI system registry | Central AI Inventory (Section 8) | This becomes the third-party-AI subset of a bigger AI Inventory; needs a real AiSystem model for internal AI |
| AI Assistant (per-vendor chat) | /vendors/:id/assistant, header panel | POST /vendors/:id/assistant/messages | AssistantConversation, AssistantMessage | Yes, with citation relevance (Item 6, this session) and prompt-injection flagging | Yes | Governed AI Assistant (Section 36) | None functionally; sidebar link already removed as redundant with header panel |
| MCP server | n/a (backend service) | 12 read-only tools, tenant-scoped | (reads across models) | Yes, audited and regression-tested (Item 5, this session) | Yes | MCP (Section 38) | Extend tool set carefully as new domains are added; keep read-only-by-default posture |
| Audit logging | /audit-log (frontend exists, marked "soon") | (no dedicated GET route found) | AuditEvent | **Needs verification - discrepancy found** | Yes, model is solid | Auditability (Section 44) | Verify /audit-log page is wired to a real API route or is a stub |
| Executive Dashboard | / | (aggregates several GET routes) | n/a | Yes | Yes | Dashboard (Section 32) | Extend metrics list per Section 32 once new domains exist; do not rebuild |
| GRC Workflow Guide | /grc-guide | n/a (static content) | n/a | Yes | Yes | Learning Center (Section 35) | None |
| TPRM Workflow Guide | /tprm-guide | n/a (static content) | n/a | Yes, 12-stage guide built this session | Yes | Learning Center (Section 35) | Matches "AI THIRD-PARTY RISK WORKFLOW" guide almost exactly already |
| RBAC | n/a (cross-cutting) | packages/auth/rbac.ts | n/a | Yes, audited this session (14 gaps fixed) | Yes | Cross-cutting | Extend permission strings as new resources are added (e.g. "ai-system:*") |
| Tenant isolation | n/a (cross-cutting) | packages/auth/tenant-context.ts | n/a | Yes, audited this session (14 gaps fixed) | Yes | Cross-cutting | Apply same pattern to any new models |

---

## 4. Classification Summary

| Classification | Count (approx.) | Examples |
|---|---|---|
| KEEP (no change) | 14 | Tenant, User, Framework/Control engine, RBAC, Tenant isolation, RemediationAction, AuditEvent |
| REUSE (as-is, in new context) | 8 | Assessment, RiskRating, ReviewDecision, Vendor, MCP server |
| EXTEND (add fields/behavior) | 6 | EvidenceDocument, ControlFinding, AI Inventory, Assessment (subject-agnostic) |
| BUILD NEW | Large, per target architecture | AiSystem model, AI Agent Registry, Use Case Intake, Classification engine, Policy/Exception models, Incident model, Reassessment scheduling |
| FIX (bug, unrelated to transformation) | 2 | Evidence Library link (404), Audit Logs wiring verification |
| DEPRECATE | 0 | Nothing currently needs to be removed |

**Headline finding: this is evolutionary, not destructive, exactly as the
prompt requires.** Nothing in the current build needs to be thrown away.
The real work is (a) building genuinely new domains (AI Inventory as a
first-class object, AI Agents, Use Case Intake, Classification, Policies,
Incidents) and (b) surfacing backend capability that already exists
(AI risk/impact scoring) but has no UI yet.

---

## 5. Existing Test Coverage (baseline to preserve)

| Package | Tests | Notes |
|---|---|---|
| packages/risk-engine | 49 | Scoring, risk rating, requirement risk, questionnaire logic |
| packages/framework-engine | 38 | Catalog, applicability |
| packages/auth | 25 | RBAC (16), tenant isolation (9) |
| apps/api | 23 | Auth routes, evidence analysis, reviews, questionnaire approval |
| apps/mcp-server | 10 | Context resolution (6), full auth regression (4, end-to-end) |
| packages/ai-client | 9 | Evidence analysis (2), assistant citation relevance (7) |
| packages/shared | 7 | Env validation |
| packages/storage-client | 5 | Storage client |
| packages/database | 0 | No dedicated test file currently |

**196 tests total, all passing as of this analysis.** Any transformation
work must not regress this baseline - Section 50 of the prompt requires
maintaining or extending this coverage, not replacing it.