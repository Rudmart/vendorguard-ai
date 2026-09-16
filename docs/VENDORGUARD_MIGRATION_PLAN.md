# VendorGuard AI - Migration Plan (Phase 0 Discovery)

Status: DISCOVERY ONLY, proposed for review - no changes made. Read
alongside VENDORGUARD_TRANSFORMATION_ANALYSIS.md and
VENDORGUARD_TARGET_ARCHITECTURE.md.

---

## 1. Honest Scope Assessment Before Any Phasing Decision

The transformation prompt's own 32-phase plan, done properly with a
quality gate after every phase (Section 49), is a multi-month undertaking
even for an experienced team - and this is a solo, first-software-project
build, alongside an active job search. That is not a reason to avoid the
idea; "AI Governance" is a genuinely valuable, differentiating skill area
right now. It is a reason to be deliberate about how much of the 32-phase
vision to commit to before starting, rather than assuming all of it.

**Recommendation: treat the 32 phases as a menu, not a mandate.** Pick a
meaningfully-sized first slice that produces something real and
demonstrable, prove it end-to-end (tests, security review, working UI),
and decide whether to continue from a position of having shipped something
rather than mid-way through an open-ended rebuild.

---

## 2. Proposed First Slice (if transformation proceeds)

Given the analysis findings - especially that AI risk/impact scoring
already exists on the backend - the highest-value, lowest-risk first slice
is:

**Slice 1: Surface what already exists + add the minimum new model needed
to make "AI Governance" real rather than relabeled TPRM.**

1. Build a real `AiSystem` model (Section 8), scoped down from the full
   spec to: identity, owner, AI type, data categories, lifecycle status,
   risk tier. Skip the full field list (subprocessors, training-data
   considerations, autonomy detail) until a real use case needs it.
2. Surface the existing ai-risk-score/ai-impact-score endpoints in a real
   UI page, connected to AiSystem records instead of only vendor
   assessments.
3. Link Vendor <-> AiSystem (Section 25's "important relationship") so an
   AI system can be internal OR tied to a vendor, without duplicating
   records - this is the one piece of new plumbing that unlocks the
   "third-party AI is one type of AI system" reframing the whole
   transformation is built on.
4. Build the AI Governance Workflow Guide (separate plan already
   discussed) using the existing GRC/TPRM guide pattern - this can ship
   independently of the AiSystem model work and gives an immediate,
   visible result.
5. Fix the two bugs found in discovery (Evidence Library 404, Audit Logs
   wiring) as part of this slice's security/stability baseline, since
   they're small and already identified.

**Explicitly deferred to a later slice, not because they're unimportant,
but because they depend on Slice 1 existing first:** AI Agent Registry,
Use Case Intake, Classification engine, Control Testing, Policies,
Exceptions, Incidents, Monitoring, full Reporting suite, RAG, MCP
expansion, n8n, Azure evidence, jurisdiction packs.

---

## 3. Phased Sequence for Slice 1

Following the transformation prompt's own quality-gate discipline
(Section 49) but scaled to Slice 1's actual size:

| Step | Work | Gate before proceeding |
|---|---|---|
| 1 | Prisma migration: add AiSystem model, Vendor<->AiSystem relation | Migration runs clean against dev DB; no existing data affected |
| 2 | API: CRUD routes for AiSystem, with RBAC + tenant isolation from day one (not retrofitted later) | New routes pass the same tenant-isolation/RBAC test pattern as existing routes |
| 3 | Wire ai-risk-score/ai-impact-score endpoints to accept an AiSystem id, not only a vendor assessment id | Existing vendor-assessment callers of these endpoints still work unchanged |
| 4 | Frontend: AI System list + detail page, surfacing risk/impact scores | Typecheck clean; manual walkthrough in browser |
| 5 | Sidebar: add AI Systems as one new item, clustered with existing AI Inventory/AI Agents per the earlier small-cluster decision - not a full re-reorg | Confirms with the already-approved 3-group structure, no regression to it |
| 6 | AI Governance Workflow Guide page (independent, can happen in parallel with steps 1-5) | Matches GRC/TPRM guide visual/content pattern |
| 7 | Fix Evidence Library link + verify Audit Logs wiring | Both confirmed working in browser |
| 8 | Full test suite + typecheck across the whole monorepo | All 196+ existing tests still pass; new tests added for AiSystem RBAC/tenant isolation |

Each step should be its own small PR, exactly matching the git workflow
already used all session - not one large branch for all of Slice 1.

---

## 4. Risks Specific to This Transformation

- **Terminology drift risk:** "Vendor" and "AI system" are conceptually
  different but will overlap for third-party AI. Getting the
  Vendor<->AiSystem relationship wrong early would be expensive to fix
  later, since both models already have real data in the current
  database. This is the one piece of Slice 1 worth the most design care
  before writing migration code.
- **Scope creep risk:** the 32-phase document is compelling to read
  end-to-end, which makes it tempting to start building several phases at
  once. The quality-gate discipline (stop after each phase, get
  explicit approval) exists specifically to prevent this - it should be
  enforced even within Slice 1's own 8 steps above.
- **Portfolio-narrative risk:** if Slice 1 is started but not finished
  before a job interview or application deadline, "half-built AI
  Governance platform" is a weaker story than "complete, deeply-tested
  TPRM platform." Worth deciding Slice 1's timeline with that in mind,
  not just its technical scope.

---

## 5. What This Plan Deliberately Does NOT Include

Per the transformation prompt's own Section 47 ("Do not overbuild") and
Section 37/39/40/41 ("later, after the governance architecture is
stable"): no RAG, no MCP tool expansion, no n8n, no Azure evidence
integration, no jurisdiction packs, and no new infrastructure (Kubernetes,
message queues, vector databases) are part of this plan. The existing
TypeScript/Next.js/Fastify/PostgreSQL/Prisma stack is sufficient for all
of Slice 1 and, realistically, for most of the full 32-phase vision too.

---

## 6. Recommendation Summary

1. Review this document and the other two alongside it.
2. Decide whether to commit to Slice 1 as scoped above, adjust its size,
   or set the whole transformation aside for now in favor of continuing
   the existing Phase B/C polish roadmap.
3. If Slice 1 proceeds, treat step 1 (the AiSystem/Vendor relationship
   design) as its own reviewable decision before any migration is written
   - this is the one part of Slice 1 genuinely worth slowing down for.
4. Nothing in this plan requires touching the database, running a
   migration, or writing new code. That begins only after explicit
   approval, per the original instruction.