# Core V1 Governance & Security Lessons Learned

VendorGuard AI's Core V1 technical lifecycle/security validation was completed and human-approved. B1, H1, H2, M1 and M2 were remediated, validated and explicitly closed by the human owner. This is not production certification or final production deployment approval. UI/UX polish, production hardening, Azure deployment and advanced Agent/MCP/RAG work remain separate phases.

**AI ASSISTS. HUMANS GOVERN.** Investigation and automated evidence support governance decisions; they do not replace accountable human approval.

## 1. Cross-Tenant Resource Exposure

Validation found that a caller could link a risk to another tenant's private framework control and retrieve private control information through affected API and MCP routes. Dedicated framework listings had checks, but other consumers did not consistently follow framework ownership. The original probes established local exposure, not production exploitation.

Tenant isolation protects confidentiality and the integrity of governance records. A risk linked to an unauthorized control can misrepresent the requirements applicable to that tenant. The implemented shared policy permits global or current-tenant frameworks and follows ownership through controls, mappings, analysis candidates and nested relationships. Historical unauthorized links remain stored, while private fields are hidden.

**Lesson:** authorization must follow authoritative resource ownership through every route and relationship. Authentication and a secure listing endpoint do not make alternate consumers safe. Test both foreign-resource denial and legitimate global/same-tenant access.

Source: [Cross-Tenant Private Framework Control Exposure](01-cross-tenant-private-framework-control-exposure.md).

## 2. Human Governance Review Bypass

The legacy proposal route allowed an ANALYST to assign PASS and clear the human-review requirement without an independent decision. The observed bypass involved a human caller; it was not evidence of autonomous AI approval.

The correction separates proposal from final decision authority. Proposals record their actual proposer and remain pending. An authorized independent reviewer supplies rationale and a durable, audited decision. The proposer and assessment creator cannot approve their own work, and later analysis/proposals cannot overwrite final reviewed findings. Unattributed legacy records require explicit audited reconciliation rather than fabricated approvals or identities.

**Lesson:** participation in an assessment does not establish independent approval authority. Separation of duties must be enforced in stored transitions and alternate paths, with human rationale and traceable decisions—not just presented as a UI convention.

Source: [Human Governance Review Bypass](02-human-governance-review-bypass.md).

## 3. Evidence Authorization

Original probes found that READ_ONLY was denied by a direct evidence endpoint but could obtain metadata through alternate AI-system/MCP routes and invoke MCP analysis without the intended evidence authority. Unauthorized raw-file download was not established by those discovery probes.

Metadata, content/download and analysis are distinct operations. Filenames can disclose sensitive governance context; permission to view an AI system does not authorize processing its evidence. The shared operation-specific policy applies across API/MCP paths before content retrieval or analysis. AUDITOR metadata access does not grant content or analysis. Eligible independent reviewers/testers receive only narrowly scoped metadata for a specific governance record; those exceptions grant no general browsing, download or analysis. Restricted evidence is represented explicitly, not as zero or no evidence.

**Lesson:** least privilege requires consistent resource-operation authorization across interfaces. MCP tool access is an authorization boundary, not an exemption from application policy. Test denied and permitted operations separately, including the limits of contextual exceptions.

Source: [Evidence Authorization Bypass Across AI/MCP Routes](03-evidence-authorization-bypass-ai-mcp.md).

## 4. Governance Decision History

Earlier review rationales could be overwritten as records moved through subsequent reviews. A latest-status field alone cannot explain who made an earlier decision, why it was made, or which version was reviewed.

Append-only use-case, risk and impact decision history now preserves actor, timestamp, decision, rationale, version/context and audit correlation. Complete historical attribution is preserved from actual stored facts. Incomplete attribution requires explicit human reconciliation, with missing facts left unknown. Migration-defined database protection rejects direct history UPDATE/DELETE. Parent deletion cascades remain possible; this is not indefinite-retention enforcement.

**Lesson:** accountability requires durable decision evidence alongside current operational state. Do not reconstruct missing rationale or retroactive approval. Validate history preservation and mutation denial, and distinguish append-only controls from a broader retention policy.

Sources: [Human Governance Review Bypass](02-human-governance-review-bypass.md) and [hardening validation report](core-v1-hardening-remediation-validation.md).

## 5. Session Security

The retained-cookie replay finding showed why clearing a browser cookie is insufficient logout enforcement. A previously issued credential must lose server-side authority.

API and MCP now share database-backed signed sessions with a seven-day absolute maximum and no silent renewal. Authenticated requests validate signature, expiration, active stored session, revocation and current membership. Logout revokes the stored session before reporting success. Membership removal invalidates access, including replay after membership recreation; authentication/storage failures fail closed. Existing claim-only cookies require a new login.

**Lesson:** the server must remain authoritative for session lifetime and revocation. Evaluate retained credentials, membership changes and database failures—not only the normal browser logout flow.

Sources: [Evidence Authorization Bypass Across AI/MCP Routes](03-evidence-authorization-bypass-ai-mcp.md) and [hardening validation report](core-v1-hardening-remediation-validation.md).

## 6. Security Middleware Performance Regression

The first visibility implementation mutated reusable caller-owned query selections. Repeated requests appended nested security predicates, expanding SQL and query cost. This was an established mutation defect, not a reason to relax authorization or increase test deadlines.

The correction copies query containers and scopes request-local objects while preserving authorization predicates and Prisma scalar instances. Regression coverage checks frozen/reused selections, stable structure and successive tenant contexts.

The documented local measurements showed nested predicates growing from 1 to 9 before correction and remaining at 1 afterward. SQL grew from 963 to 7,668 characters before and remained at 963 afterward. Reused reads grew from approximately 12.1 to 193.2 ms before; corrected reads measured approximately 5.5–10.5 ms. These are representative local measurements, not a production latency guarantee.

**Lesson:** a security control must preserve authorization correctness without creating unsafe or unstable operational behavior. Keep request state local, investigate cumulative query growth, and validate security and performance together. Separately, unfinished test operations must be drained so they cannot contaminate the next test or fixture teardown.

Sources: [Cross-Tenant Private Framework Control Exposure](01-cross-tenant-private-framework-control-exposure.md) and [hardening validation report](core-v1-hardening-remediation-validation.md).

## 7. CI / Database Migration Lesson

The initial GitHub CI run used `prisma db push --skip-generate`. Tables and generated Prisma models were present, but schema shape did not establish enforcement of migration-defined controls. The committed SQL also defines the `governance_decisions_append_only` trigger and the custom one-parent constraint; schema-only synchronization did not execute that SQL.

The M1 test attempted to UPDATE an existing decision's rationale to `overwrite` and expected rejection. In CI the UPDATE succeeded; it did not create a new decision. Local validation passed because the migration and trigger were installed. The test exposed a meaningful database-integrity difference rather than a flaky assertion.

CI was changed to `prisma migrate deploy`, executing the committed migration SQL without modifying migrations. The subsequent run applied the hardening migration and passed all 28 API Core Hardening tests, including mutation rejection. A separate H2 CI failure exposed ambient storage-constructor configuration: the authorized-download test now supplies temporary test-only configuration, restores it afterward, and retains its mocked download and real authorization route.

**Lesson:** validate the controls that actually execute in the database, not merely matching models and columns. Migration-defined protections belong in CI initialization. Preserve assertions when environment differences expose missing controls; do not replace rejection tests with weaker expectations.

Sources: [hardening report's migration scope](core-v1-hardening-remediation-validation.md), the [committed CI workflow](../../../.github/workflows/pr-validation.yml), [CI correction commit](https://github.com/Rudmart/vendorguard-ai/commit/48551c47ab7942856729b258593f1e81ad1dff70), and [successful CI validation run](https://github.com/Rudmart/vendorguard-ai/actions/runs/38098481434). The linked workflow/commit/run supply subsequent CI evidence not yet incorporated into the original closure report.

## Validation and Human Closure

The accepted local validation passed **913/913 repository tests with zero timeouts**, API hardening **28/28**, and MCP security/context/authentication **20/20**. Typecheck, lint and production build passed; lint retained four pre-existing warnings, and all 27 web pages built. The subsequent CI correction passed its validation and security checks. Local totals should not be relabeled as identical CI coverage.

Original security probes revealed gaps despite an earlier passing suite. Findings were investigated, remediation designs and implementation were separately approved, original denied/authorized paths were retested, and the human owner reviewed the evidence before closure. Passing tests were evidence for that decision, not an automatic certification.

Source: [Core V1 Lifecycle Validation](../../projects/vendorguard-ai/core-v1-lifecycle-validation.md).

## How I Would Explain This in an Interview

“As an AI Governance/GRC practitioner, I participated in identifying authorization and human-review gaps, reviewing their risks, and approving targeted remediation. I required evidence for both denied actions and legitimate workflows, including tenant isolation, independent review, preserved rationales and revoked sessions. When CI exposed missing database enforcement, I treated it as a control-validation issue and approved a narrow correction rather than weakening the assertion. I reviewed the resulting evidence and made the human closure decision. AI assisted the investigation and implementation; accountable humans approved the controls and closure. The outcome was human-approved Core V1 technical validation, not production certification.”

## Governance Workflow

Finding
→ Risk
→ Investigation
→ Root Cause
→ Remediation
→ Testing
→ Evidence
→ Human Decision
→ Closure
