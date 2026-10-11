# Core V1 hardening remediation validation

Validation and human closure date: 10 October 2026.
**IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED** for B1, H1, H2, M1 and M2.
The human owner explicitly accepted the evidence and Core V1 technical readiness. This is not production deployment certification.

## Implementation

| Finding | Implemented control                                                                                                                                                                                                                                                                            | Disposition |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| B1      | Shared global-or-current-tenant framework/control visibility for API/MCP, including nested relationships and analysis candidates. Historical unauthorized links are retained but private fields are hidden. Query containers are copied before scoping; reusable selections are never mutated. | CLOSED      |
| H2      | Shared operation-specific evidence authorization before retrieval/analysis. Narrow independent-review and assigned-independent-test metadata contexts grant no browsing/content/download/analysis. Restricted information is explicit, not zero.                                               | CLOSED      |
| H1      | Actual-attributed pending proposals; authorized independent review, rationale, durable decision and audit. Final reviewed findings resist later AI/legacy overwrite. Unattributed legacy records require audited reconciliation without fabricated history.                                    | CLOSED      |
| M1      | Append-only use-case/risk/impact decisions preserve actor/time/decision/rationale/version/context/audit correlation. Known historical attribution is preserved; missing facts stay unknown and require explicit human reconciliation.                                                          | CLOSED      |
| M2      | Shared database-backed signed API/MCP sessions, seven-day absolute maximum, no renewal, current membership validation, durable logout revocation and fail-closed database errors.                                                                                                              | CLOSED      |

The evidence UI changes are limited to permission-aware restricted/null handling and download visibility. No deferred UI redesign is included. This documentation/commit-preparation step made no further application changes.

## Migration and deployment considerations

One additive migration: `packages/database/prisma/migrations/20261010120000_core_v1_final_hardening/migration.sql`.
It adds proposal attribution, stored sessions, governance decisions, foreign keys/indexes, a one-parent constraint and an append-only trigger. Direct history UPDATE/DELETE is blocked; parent deletion cascades remain possible. This is not indefinite-retention enforcement.

Local migration deployment passed; the validation reported all 24 migrations up to date. Two pre-existing migrations were marked applied only after read-only schema comparison established their schema was already present. No database reset or deletion of historical relationships was performed.

Existing claim-only cookies require a new login. API and MCP must share the configured signing secret. No production/Azure deployment is certified by this work.

## Test changes

New API hardening file: 28 cases, including three visibility-mutation regressions. New MCP hardening file: 10 cases; together with existing context/authentication coverage, the MCP probe run has 20 cases. Two test-session helpers issue actual stored sessions. Existing fixtures were adapted to session storage, authorized evidence roles and actual independent finding review.

Findings and Remediation track complete test bodies and request promises and drain unfinished operations before the next test and fixture teardown. This prevents contamination; it does not hide a timeout or replace the production query-copy correction. Concurrent request barriers, existing Retirement draining, all existing assertions and deadlines remain preserved. No runner configuration or timeout was changed.

## Final validation evidence

| Check                                    | Result                                                |
| ---------------------------------------- | ----------------------------------------------------- |
| Visibility mutation regressions          | 3/3 PASS                                              |
| Governance Findings                      | 18/18 PASS                                            |
| Governance Remediation                   | 21/21 PASS                                            |
| Retirement                               | 72/72 PASS                                            |
| API Core Hardening                       | 28/28 PASS                                            |
| Combined affected API lifecycle suites   | 637/637 PASS; 550.23 s                                |
| MCP security/context/authentication      | 20/20 PASS                                            |
| Complete serialized repository           | 913/913 PASS; zero timeouts; 11m28.203s               |
| Typecheck                                | PASS; 16 tasks                                        |
| Lint                                     | PASS; zero errors; four pre-existing console warnings |
| Production build                         | PASS; nine tasks; all 27 web pages                    |
| Whitespace/diff checks                   | PASS                                                  |
| Post-build original API/MCP probe repeat | API 28/28 PASS; MCP 20/20 PASS                        |

Repository totals: API 734, MCP 20, auth 25, frameworks 38, shared 33, AI client 9, storage 5 and risk 49. Test/build artifacts and benchmark logs remained outside the commit in local temporary storage. Documentation-only closure updates did not require repeating the application suites; the figures above are the accepted completed validation, not a new run during Git preparation.

## Investigation and performance evidence

Earlier combined validation passed 632/634 and repository validation passed 904/910, with timeouts. Investigation demonstrated mutation of a reusable nested selection, causing progressive visibility-predicate/SQL accumulation. The corrected implementation copies plain query containers while preserving Prisma scalar instances and all security predicates.

| Measurement           | Before                        | After                     |
| --------------------- | ----------------------------- | ------------------------- |
| Nested predicates     | 1 → 9                         | Stable at 1               |
| Nested predicate text | 221 → 1,757 characters        | Stable at 221             |
| Reused SQL size       | 963 → 7,668 characters        | Stable at 963             |
| Reused read duration  | Approximately 12.1 → 193.2 ms | Approximately 5.5–10.5 ms |
| Final planning time   | 137.5 ms                      | 4.8 ms                    |
| Final execution time  | 49.0 ms                       | 0.24 ms                   |

Predicate observation used nine reads before and twelve scoped reuses after; the representative SQL benchmark used twelve reused reads in each implementation. Fresh warm selections had equivalent 963-character SQL and approximately 9.5–12.0 ms reads. These are local measurements of the tested query, not a whole-application production performance guarantee.

A subsequent interrupted full-run attempt timed out during documented Windows Modern Standby, with a roughly 256.7-second request gap. Work stopped for investigation. Final validation used a temporary awake guard without changing persistent power settings or test deadlines; no further standby occurred during that validation and zero timeouts remained. The guard was released afterward.

A security control must preserve authorization correctness without creating unsafe or unstable operational behavior.

## Original security probes and human disposition

Repeated denied/authorized probes establish foreign private API/MCP control exclusion with own/global success; historical-link preservation; proposal-only analyst authority; independent rationale/decision/audit; final-review overwrite protection; alternate evidence and MCP analysis denial before lookup; metadata-only contextual exceptions; preserved earlier rationale and honest legacy reconciliation; logout replay, expiry, membership-removal and storage-error rejection.

These are authenticated local automated API/MCP probes. No deployed production exploitation or comprehensive browser certification is claimed. No new functional/security regression was demonstrated in final validation. All five findings and the targeted performance regression are accepted as remediated and validated; the human explicitly approved closure and technical readiness.

Recommendation: **CORE V1 READY — technical validation approved**. UI/UX polish, production hardening, Azure deployment and advanced Agent/MCP/RAG work remain separate future phases.

## Documentation and Git scope

The three case studies preserve original discovery evidence and now document actual implementation, denied/authorized validation, performance evidence where applicable and human-approved closure. Their index distinguishes the historical baseline from final validation. A concise lifecycle summary is included. Publication to GitHub awaits separately approved push/PR; no push, PR or merge is part of this step.

## Exact file inventory

> Historical inventory of the approved hardening commit. Paths and pre-publication statements below describe that recorded stage and are intentionally retained; current navigation is available in the [findings index](README.md).

Production/schema files (26):

- `apps/api/src/aiControlEvidence.ts`
- `apps/api/src/aiControlTests.ts`
- `apps/api/src/aiGovernanceReportData.ts`
- `apps/api/src/aiIncidents.ts`
- `apps/api/src/aiSystemRetirement.ts`
- `apps/api/src/aiUseCases.ts`
- `apps/api/src/aiWorkQueues.ts`
- `apps/api/src/assistantContext.ts`
- `apps/api/src/auth-routes.ts`
- `apps/api/src/evidenceAnalysis.ts`
- `apps/api/src/index.ts`
- `apps/api/src/session.ts`
- `apps/mcp-server/src/context.ts`
- `apps/mcp-server/src/index.ts`
- `apps/web/src/app/ai-system-controls/[controlRecordId]/evidence/control-testing.tsx`
- `apps/web/src/app/ai-system-controls/[controlRecordId]/evidence/page.tsx`
- `packages/auth/src/index.ts`
- `packages/auth/src/session-cookie.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/client.ts`
- `packages/database/src/index.ts`
- `apps/api/src/governanceDecisionHistory.ts`
- `apps/api/src/legacyFindingGovernance.ts`
- `packages/auth/src/evidence-policy.ts`
- `packages/database/src/resource-visibility.ts`
- `packages/database/src/session-store.ts`

Tests/helpers (35):

- `apps/api/src/aiAssessmentOpenVersionGuard.test.ts`
- `apps/api/src/aiControlEvidence.test.ts`
- `apps/api/src/aiControlSet.test.ts`
- `apps/api/src/aiControlTests.test.ts`
- `apps/api/src/aiGlobalLists.test.ts`
- `apps/api/src/aiGovernanceFindings.test.ts`
- `apps/api/src/aiGovernanceRemediation.test.ts`
- `apps/api/src/aiGovernanceReporting.test.ts`
- `apps/api/src/aiImpactAssessment.test.ts`
- `apps/api/src/aiIncidents.test.ts`
- `apps/api/src/aiMonitoring.test.ts`
- `apps/api/src/aiReassessments.test.ts`
- `apps/api/src/aiRetirementRemediation.test.ts`
- `apps/api/src/aiRiskAcceptance.test.ts`
- `apps/api/src/aiRiskAssessment.test.ts`
- `apps/api/src/aiSystem.test.ts`
- `apps/api/src/aiSystemGovernance.test.ts`
- `apps/api/src/aiSystemRetirement.test.ts`
- `apps/api/src/aiUseCases.test.ts`
- `apps/api/src/aiWorkQueues.test.ts`
- `apps/api/src/evidenceAnalysis.test.ts`
- `apps/api/src/legacyAuthorizationHardening.test.ts`
- `apps/api/src/ownerPickers.test.ts`
- `apps/api/src/questionnaireApproval.test.ts`
- `apps/api/src/readAuthorizationHardening.test.ts`
- `apps/api/src/reviews.test.ts`
- `apps/api/src/routeAuthorization.test.ts`
- `apps/api/src/sessionAuthority.test.ts`
- `apps/api/src/sessionSecurity.test.ts`
- `apps/mcp-server/src/authRegression.test.ts`
- `apps/mcp-server/src/context.test.ts`
- `apps/api/src/coreHardening.test.ts`
- `apps/api/src/testSession.ts`
- `apps/mcp-server/src/coreHardening.test.ts`
- `apps/mcp-server/src/testSession.ts`

## Documentation files (6)

- `docs/core-v1-hardening-remediation-validation.md`
- `docs/core-v1-lifecycle-validation.md`
- `docs/security-governance-case-studies/README.md`
- `docs/security-governance-case-studies/01-cross-tenant-private-framework-control-exposure.md`
- `docs/security-governance-case-studies/02-human-governance-review-bypass.md`
- `docs/security-governance-case-studies/03-evidence-authorization-bypass-ai-mcp.md`

## Migration file (1)

- `packages/database/prisma/migrations/20261010120000_core_v1_final_hardening/migration.sql`

Total approved commit scope: **68 files** — 26 production/schema, 35 tests/helpers, one migration and six documentation files. No credentials, environment files, generated build artifacts, temporary diagnostics or deferred UI polish belong to this scope. Commit identity and final Git status are reported separately after commit creation.
