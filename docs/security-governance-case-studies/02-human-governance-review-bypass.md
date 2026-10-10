# Case Study 02 — Human Governance Review Bypass

## 1. Executive Summary

An authenticated legacy finding proposal path allowed an ANALYST to assign a PASS result while disabling the human-review requirement. The resulting finding had no independent review decision. The path conflated authority to propose a finding with authority to finalize its material disposition.

## 2. Severity

**HIGH** — a confirmed governance-control bypass undermines independent review and decision traceability. This is the project's validation severity.

## 3. Lifecycle Area

Legacy vendor-assessment findings, human review, assurance interpretation, and downstream reporting of stored finding status. The separate AI governance finding/remediation workflow passed its existing independent-review checks.

## 4. How the Finding Was Discovered

Investigation compared the proposal endpoint with the authorized finding-review workflow. A database-backed probe used an authenticated ANALYST and isolated development fixtures, then inspected the resulting finding and review-decision count. Temporary probe fixtures were removed.

## 5. Validated Evidence

**VALIDATED FACT**

| Observation                                                                  | Recorded result                             |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| A legacy finding proposal accepted a PASS status from an ANALYST             | HTTP 200                                    |
| The resulting finding disabled the human-review requirement                  | `requiresHumanReview = false`               |
| An independent review decision was required or recorded for that disposition | No; recorded review-decision count was zero |

The probe demonstrated a human caller using a legacy proposal path. It did not demonstrate an AI agent autonomously approving a finding. The implementation nevertheless makes final status possible without the intended independent-review gate.

## 6. Security / Governance Risk

VendorGuard's principle is **AI ASSISTS. HUMANS GOVERN.** Material disposition must be an explicit action by an authorized human reviewer, with traceable authority and rationale.

An analyst's participation is not equivalent to independent review. Allowing proposal authority to clear the review requirement weakens separation of duties and leaves no independent decision record explaining the final result. Downstream consumers can receive a PASS status without evidence that the required review occurred.

Legacy or future automated callers could exercise the same path if granted proposal authority. That is a risk assessment, not an observed autonomous approval.

## 7. Root Cause / Control Gap

The legacy proposal handler accepts a status and writes `requiresHumanReview = false` on both creation and update. Its `finding:propose` permission check does not establish independent review authority or create a review decision.

Primary implementation area: `apps/api/src/index.ts`, specifically the legacy assessment finding proposal handler. The authorized review handler and stored `ReviewDecision` relationship provide the existing governance context against which the bypass was assessed.

The affected proposal path was unchanged by Reporting V1; no Reporting regression was established.

## 8. Implemented Remediation

**IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED** (H1; related M1 also closed).

Legacy finding proposals record the actual proposer and proposed status and remain pending human review. Proposal authority never grants final decision authority. An authorized independent reviewer must provide rationale and a durable decision; the proposer and assessment creator cannot review their own work. Row/advisory locking and transactional decision/audit writes protect concurrent transitions. Later AI analysis or legacy proposals cannot overwrite a final reviewed finding.

`apps/api/src/legacyFindingGovernance.ts` implements proposal/review persistence; API handlers enforce permissions and validated rationale. Unattributed legacy records require an explicit audited reconciliation proposal. Existing identifiers, relationships and genuine decisions are preserved; missing historical proposer identities, rationales and approvals are not invented. Response quarantine prevents unattributed historical dispositions from being presented as reviewed assurance without rewriting stored history.

Related M1 remediation in `governanceDecisionHistory.ts` records append-only use-case, risk and impact decisions with actor, timestamp, decision, rationale, version/context and audit correlation. Complete existing attribution is preserved from actual stored fields; incomplete attribution requires explicit human reconciliation and retains known fields with unknown facts left unknown. The database blocks direct decision-history UPDATE/DELETE; parent deletion cascades remain possible, so this is not indefinite-retention certification.

Regression probes demonstrate analyst proposal-only authority, denied unauthorized/self review, required rationale, authorized independent review, durable audit evidence, protected final decisions, preserved earlier rationales and explicit legacy reconciliation. The separate AI governance findings/remediation workflows remain covered.

## 9. Completed Validation

The original failure paths were repeated as authenticated local API/MCP regression probes, together with authorized success cases. Final API hardening tests passed **28/28** (25 security/governance cases and three visibility-mutation regressions); MCP hardening/context/authentication passed **20/20**. Affected combined API lifecycle suites passed **637/637**.

The final serialized repository run passed **913/913**, with **zero timeouts** while the host remained awake. Typecheck passed; lint passed with zero errors and four pre-existing console warnings; production build passed with all **27 web pages**. Whitespace checks passed. Test assertions and deadlines were preserved.

These are local automated validation results, not production exploitation evidence, production deployment certification, or comprehensive browser certification. See [the hardening validation report](../core-v1-hardening-remediation-validation.md) for scope and migration considerations.

## 10. Current Status

**IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED**.

On 10 October 2026, the human owner accepted the completed remediation and validation and explicitly closed B1, H1, H2, M1 and M2. Closure follows separate design approval, implementation approval, regression validation, and human disposition; it was not inferred from passing tests. Core V1 technical readiness is approved. Deployment and deferred polish remain separate work.

## 11. Governance Lesson

AI ASSISTS. HUMANS GOVERN. Proposal authority and independent final decision authority must remain distinct, with durable rationale and honest historical attribution.
