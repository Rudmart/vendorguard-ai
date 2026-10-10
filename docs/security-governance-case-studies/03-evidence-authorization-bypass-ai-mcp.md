# Case Study 03 — Evidence Authorization Bypass Across AI/MCP Routes

## 1. Executive Summary

Lifecycle validation found inconsistent evidence authorization across access paths. A tested READ_ONLY user was denied by the direct evidence endpoint but could obtain evidence metadata through AI-system and MCP routes. MCP evidence analysis also operated without the expected evidence authority.

## 2. Severity

**HIGH** — confirmed metadata exposure and analysis authorization gaps violate the intended least-privilege boundary. This is the project's validation severity.

## 3. Lifecycle Area

Evidence management, AI-system evidence relationships, MCP evidence retrieval, and advisory evidence analysis.

## 4. How the Finding Was Discovered

Investigators compared the existing role-permission catalog with evidence-access checks across direct API, AI-system, and MCP routes. Authenticated local probes used the same READ_ONLY identity and isolated development evidence fixtures. Temporary probe fixtures were removed after investigation.

## 5. Validated Evidence

**VALIDATED FACT**

| Access path                        | Recorded result for the tested READ_ONLY user                 |
| ---------------------------------- | ------------------------------------------------------------- |
| Direct evidence endpoint           | HTTP 403                                                      |
| Alternate AI-system evidence route | HTTP 200; evidence metadata included the filename             |
| MCP `get_evidence`                 | Returned evidence metadata, including the filename            |
| MCP `evaluate_evidence`            | Operated successfully without the expected evidence authority |

**Evidence boundary:** the investigation confirmed metadata and analysis authorization problems. It **did not establish unauthorized raw-file download**. It also did not establish that full document content was returned to the caller or transmitted to an external AI provider; the analysis probe used the deterministic fake provider.

## 6. Security / Governance Risk

Filenames and document metadata can reveal the existence, subject, or timing of sensitive governance evidence even without file bytes. Analysis is also a distinct resource operation: permission to read an AI system does not automatically authorize processing its evidence.

Least privilege must apply across direct API, AI features, and MCP tools. Otherwise an alternate interface can undermine a correctly denied direct request. Legitimate governance-review needs should be explicitly authorized rather than satisfied by unrestricted metadata access.

## 7. Root Cause / Control Gap

The direct evidence API applies evidence permissions. The affected AI-system evidence route instead relies on `ai-system:read`, while affected MCP handlers authenticate tenant membership without enforcing the expected evidence operation permissions. Tenant scoping alone is insufficient to enforce role-based confidentiality within a tenant.

Identified implementation areas:

- `apps/api/src/aiControlEvidence.ts`: AI-system evidence listing and control-evidence read paths.
- `apps/mcp-server/src/index.ts`: evidence retrieval and analysis handlers.
- `packages/shared/src/domain.ts`: the authoritative role-permission catalog used to assess the inconsistency.

The metadata-listing and MCP paths described here were unchanged by Reporting V1. Reporting's own restricted-evidence handling passed; no Reporting regression was established.

## 8. Implemented Remediation

**IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED** (H2; related M2 also closed).

`packages/auth/src/evidence-policy.ts` supplies one operation-specific authorization policy used across API/MCP metadata, content/download and analysis paths. Authorization precedes document content/chunk retrieval and analysis. ADMIN/ANALYST retain permitted access; AUDITOR metadata permission does not grant content or analysis; REVIEWER/READ_ONLY have no general evidence browsing authority.

An eligible independent reviewer may receive narrowly scoped metadata for a specific pending evidence-review record. The assigned independent tester may receive metadata for the specific active control test. Independence, assignment and record context are checked server-side. Neither exception grants general browsing, raw content, download or analysis. Alternate evidence lists, assistant context, assurance, incidents, retirement and reporting apply the policy; restricted information remains explicitly restricted/null rather than being represented as zero or no evidence. The evidence UI handles restricted metadata and displays download links only with content permission; no deferred visual redesign was performed.

Denied and authorized regression probes repeat the alternate metadata and MCP analysis failures, exercise content/download separately, verify denial before document lookup, and prove both context exceptions remain metadata-only. The original discovery did not establish unauthorized raw download; the correction's download-denial tests are new validation evidence rather than an expanded claim about that discovery.

Related M2 remediation uses shared API/MCP database-backed signed sessions with a seven-day absolute maximum and no silent renewal. Every authenticated request checks stored session validity, revocation, expiration and current membership. Logout revokes storage before reporting success; storage failures fail closed. Retained-cookie replay, expiry, membership removal/recreation, invalid signatures, old claim-only cookies and database failures are covered. Existing claim-only cookies require a new login; API/MCP must share the configured signing secret.

## 9. Completed Validation

The original failure paths were repeated as authenticated local API/MCP regression probes, together with authorized success cases. Final API hardening tests passed **28/28** (25 security/governance cases and three visibility-mutation regressions); MCP hardening/context/authentication passed **20/20**. Affected combined API lifecycle suites passed **637/637**.

The final serialized repository run passed **913/913**, with **zero timeouts** while the host remained awake. Typecheck passed; lint passed with zero errors and four pre-existing console warnings; production build passed with all **27 web pages**. Whitespace checks passed. Test assertions and deadlines were preserved.

These are local automated validation results, not production exploitation evidence, production deployment certification, or comprehensive browser certification. See [the hardening validation report](../core-v1-hardening-remediation-validation.md) for scope and migration considerations.

## 10. Current Status

**IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED**.

On 10 October 2026, the human owner accepted the completed remediation and validation and explicitly closed B1, H1, H2, M1 and M2. Closure follows separate design approval, implementation approval, regression validation, and human disposition; it was not inferred from passing tests. Core V1 technical readiness is approved. Deployment and deferred polish remain separate work.

## 11. Governance Lesson

Authentication is not resource authorization. Every evidence route and MCP tool must enforce the intended operation before loading sensitive information; narrow review context must never become general access authority.
