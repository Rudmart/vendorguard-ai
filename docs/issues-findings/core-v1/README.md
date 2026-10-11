# Core V1 Security & Governance Case Studies

These local case studies document selected findings from VendorGuard AI's Full AI Governance Lifecycle Validation on 10 October 2026, their implemented remediation, completed validation and explicit human closure. They are not a comprehensive security or production deployment certification.

| Case study                                                                                                    | Original severity | Current disposition                                                       |
| ------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| [01 — Cross-Tenant Private Framework Control Exposure](01-cross-tenant-private-framework-control-exposure.md) | BLOCKER           | IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED (B1)                    |
| [02 — Human Governance Review Bypass](02-human-governance-review-bypass.md)                                   | HIGH              | IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED (H1; related M1 closed) |
| [03 — Evidence Authorization Bypass Across AI/MCP Routes](03-evidence-authorization-bypass-ai-mcp.md)         | HIGH              | IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED (H2; related M2 closed) |

## Evidence and scope

Discovery combined source inspection, existing tests and authenticated local API/MCP probes using isolated development fixtures. Sections 1–7 retain original discovery evidence; later sections distinguish corrective implementation and subsequent validation. Fixture identifiers, credentials, tokens, private narratives and reproduction payloads are omitted.

The discovery baseline was commit `67ee07f2ca6f1d94e34b3d41c873c9e9c70b4e48`, whose tree matched merged Reporting V1. Affected discovery paths were unchanged by that implementation; no Reporting V1 regression was established. Baseline validation passed 645/645 lifecycle-focused and 875/875 repository tests, yet additional probes uncovered policy gaps. Those figures describe discovery, not final remediation validation.

Final remediation validation passed **913/913 repository tests**, zero awake-run timeouts, API hardening **28/28**, MCP security/context/authentication **20/20**, typecheck, lint and production build (27 web pages). Lint retained four pre-existing console warnings. See [the detailed hardening report](core-v1-hardening-remediation-validation.md) for integrated checks, query-performance measurements, migration scope and limitations.

Results describe local automated validation. They do not establish production exploitation, unauthorized raw download during original discovery, comprehensive browser certification or final production deployment certification.

## Governance process

**Discover → Investigate → Assess Risk → Design Control → Human Implementation Approval → Remediate → Test → Validate → Human Closure**

Separate approvals governed design and implementation. The human owner explicitly accepted the validated remediation on 10 October 2026 and closed B1, H1, H2, M1 and M2. The targeted visibility performance correction is also accepted. Core V1 technical readiness is approved; passing tests alone did not close the findings.

The original closure report records its pre-publication Git preparation stage. Subsequent CI correction evidence is linked from the lessons learned; those historical statements are not the current publication status. Deferred UI/UX polish, production hardening, Azure deployment and advanced Agent/MCP/RAG phases remain future work. See [the concise lifecycle summary](../../projects/vendorguard-ai/core-v1-lifecycle-validation.md).

## Navigation and lessons

- [Hardening implementation, validation and historical commit inventory](core-v1-hardening-remediation-validation.md)
- [Core V1 Governance & Security Lessons Learned](core-v1-governance-security-lessons-learned.md): decision history, sessions, visibility performance and CI migration enforcement, alongside the three findings above.
- [Completed lifecycle validation](../../projects/vendorguard-ai/core-v1-lifecycle-validation.md)

**AI ASSISTS. HUMANS GOVERN.**

Finding → Risk → Investigation → Root Cause → Remediation → Testing → Evidence → Human Decision → Closure

[Issues & Findings](../README.md) · [VendorGuard AI project](../../projects/vendorguard-ai/README.md)
