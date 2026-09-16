# VendorGuard AI - Target Architecture (Phase 0 Discovery)

Status: DISCOVERY ONLY, proposed for review - no changes made. Read
alongside VENDORGUARD_TRANSFORMATION_ANALYSIS.md, which this builds on.

---

## 1. Target Domain Model (adapted to what actually exists)

The transformation prompt's Section 6 lists 10 target domains. Mapped
against the real capability inventory from the analysis document, here is
what each domain actually requires:

| Target Domain | Mostly New Build | Mostly Reuse/Extend |
|---|---|---|
| 1. AI Governance | AiSystem model, Use Case Intake, Classification | AI Assistant (reuse as-is) |
| 2. AI Risk Management | AI Risk Register, Impact Assessment UI | ai-risk-score/ai-impact-score endpoints (already built), Assessment/RiskRating models |
| 3. Third-Party AI Risk | Vendor-to-AiSystem link | Everything else - this domain is ~90% the existing TPRM functionality, relabeled |
| 4. Compliance & Assurance | Control Testing, Evidence review-status enum | Framework/Control engine (preserve as-is per prompt) |
| 5. Monitoring | Governance monitoring queries (overdue/expired conditions) | Existing status fields on Assessment/RiskAcceptance/RemediationAction already carry what's needed to compute these |
| 6. Reporting | Report templates beyond the existing per-vendor Executive Report | Existing executive-report generation logic |
| 7. Learning Center | AI Governance Workflow Guide (new, per user's separate plan) | GRC Workflow Guide, TPRM Workflow Guide (already built, reuse pattern exactly) |
| 8. System Administration | Real Administration page (currently unbuilt placeholder) | RBAC/tenant infrastructure (preserve as-is) |
| 9. Governed AI Assistant | None - already governed correctly | Keep exactly as-is; extend tool/answer scope later per Section 36 |
| 10. Integration/Automation | n8n orchestration (explicitly later-phase per Section 39) | n/a - do not build now |

**This confirms the analysis document's headline finding**: domains 3, 7,
and 9 are close to fully reusable today. Domains 1, 2, and 4 have a real
backend head start (AI scoring endpoints, framework engine) but need new
UI and some new models. Domains 5, 6, 8, 10 are the least started.

---

## 2. Proposed Sidebar (reconciled with what was just shipped)

Two sidebar structures are in tension right now:

- The 3-group structure (TPRM Workflow / Governance & Reference /
  Education) shipped this session, based on extensive back-and-forth
  review and approval.
- The much larger target sidebar in transformation prompt Section 7,
  which assumes most of the 32-phase build already exists.

**Recommendation: do not adopt the full target sidebar yet.** It has
navigation items (AI Use Cases, Risk Register, Impact Assessments, Vendor
Monitoring, Control Testing, Policies, Exceptions, AI Incidents, My Work,
multiple report types) for capabilities that do not exist. The
transformation prompt's own Section 7 rule - "Do not create empty
navigation items merely to make the application appear complete" -
argues directly against adopting the full target sidebar before the
underlying features exist.

**Proposed near-term evolution** (only if the transformation proceeds):
grow the existing 3-group sidebar incrementally, one real capability at a
time, rather than replacing it wholesale:

- When AI Inventory becomes a first-class object (not just vendor-AI
  flagging) and AI Agents ships, cluster them together within Governance
  & Reference, as already discussed and agreed for the smaller
  AI-cluster addition.
- When AI Risk Register / Impact Assessment UI ships, it likely belongs
  inside TPRM Workflow or a small new "AI Risk" group, decided at that
  time against what actually got built - not decided speculatively now.
- Each new domain earns its own sidebar group only once real, working
  pages exist for it - matching the discipline already used for GRC and
  TPRM guides.

---

## 3. What Is Genuinely New Build vs. Relabeling

Being precise about this matters for scoping honestly:

**Relabeling / connecting existing work (low effort, high value):**
- Surfacing the existing ai-risk-score/ai-impact-score endpoints in the
  UI
- Renaming "AI Inventory" conceptually to be understood as "third-party
  AI inventory" once a broader AiSystem model exists
- Presenting the existing Assessment/ReviewDecision/RiskAcceptance
  infrastructure as the shared "Human Review" and "Risk Treatment"
  engine the target architecture calls for - these already work close to
  the exact pattern requested (AI proposes, human decides, decisions are
  attributable)

**Genuinely new build (real backend + frontend work):**
- AiSystem model (internal AI systems, distinct from vendors)
- AI Agent Registry (explicitly Section 26 - separate from vendors, v1
  governance-focused only, no runtime monitoring)
- Use Case Intake workflow (Section 9)
- Classification engine with human-confirm/override (Section 10)
- Policy and Exception models (Sections 30-31)
- AI Incident model (Section 29)
- Reassessment/material-change scheduling (Section 27, also identified
  as a real gap by the TPRM Workflow Guide's own stage 11)
- Control Testing (Section 19) - a genuinely new concept, not present in
  the current schema at all

**Fix regardless of transformation decision:**
- Evidence Library sidebar link (404)
- Audit Logs wiring verification

---

## 4. Security & Governance Principles Already Satisfied

The transformation prompt's Section 2 core principle - "AI assists,
humans govern" - and Section 42's security requirements are not aspirational
here; they are already substantially built and verified:

- Separation of duties (a submitter cannot approve their own work) - built
  and tested (questionnaireApproval.test.ts, 10 tests)
- Tenant isolation - audited, 14 gaps fixed, tested end-to-end including
  the MCP server (authRegression.test.ts, 4 tests)
- RBAC - audited against an explicit permission matrix, 14 gaps fixed, 16
  tests
- AI Assistant citation relevance (an AI must never claim it used evidence
  it did not actually use) - fixed and tested this session, 7 tests
- MCP tools inherit tenant context and are read-only by default, matching
  Section 38 exactly ("MCP tools must inherit the user's authorization
  context")

**This means Phase 1 ("Security/stability baseline") of the transformation
prompt's own 32-phase plan is functionally already complete** for
everything that currently exists. Phase 1 work for new domains (AiSystem,
Agents, etc.) would still need the same audit-and-test discipline applied
fresh, since new models mean new attack surface.