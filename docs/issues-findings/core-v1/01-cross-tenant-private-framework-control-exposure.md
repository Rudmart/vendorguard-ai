# Case Study 01 — Cross-Tenant Private Framework Control Exposure

## 1. Executive Summary

Lifecycle validation identified inconsistent enforcement of private framework ownership. A caller in Tenant A could link an AI risk to Tenant B's private control and retrieve private control information through affected API and MCP paths. The dedicated framework/control-set APIs contained visibility checks, but those checks were not consistently applied elsewhere.

## 2. Severity

**Original severity: BLOCKER** — the confirmed tenant-isolation failure prevented Core V1 readiness acceptance before remediation. This is the project's validation severity, not a calculated CVSS score.

## 3. Lifecycle Area

Framework/control-library access, AI risk assessment, legacy evidence analysis, and MCP control lookup/search/analysis. Affected relationships can carry private control information into another tenant's governance context.

## 4. How the Finding Was Discovered

Source inspection compared framework ownership and dedicated visibility checks with other control consumers. Authenticated, database-backed probes then used isolated local fixtures representing two tenants and one private framework control. Temporary probe fixtures were removed after investigation.

## 5. Validated Evidence

**VALIDATED FACT**

| Observation                                                               | Recorded result                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Tenant A created an AI risk referencing Tenant B's private control        | HTTP 201                                                |
| Tenant A read its assessment with the linked control                      | HTTP 200; Tenant B's private control title was returned |
| Legacy evidence analysis considered the foreign private control           | HTTP 200; the returned finding referenced that control  |
| Tenant A's READ_ONLY user invoked MCP `get_control` and `search_controls` | Both returned the foreign private control               |
| Tenant A's READ_ONLY user invoked MCP `evaluate_evidence`                 | Analysis selected the foreign private control           |

These observations establish a local authorization failure. They do not establish access to every private framework, production exploitation, or exfiltration to an external AI provider. Analysis in the investigation used the deterministic fake provider.

## 6. Security / Governance Risk

Private control titles and narratives may reveal another tenant's governance requirements or internal practices. Cross-tenant links also contaminate authoritative governance records: a risk can reference a control that the caller is not entitled to select or inspect.

MCP expands the affected access surface. An authenticated tool call must enforce resource visibility even when the tool is read-only or advisory. A valid session alone does not authorize access to another tenant's private reference data.

## 7. Root Cause / Control Gap

The database supports both global frameworks (`tenantId` absent) and tenant-owned frameworks. Some consumers still treat controls as universally public, or validate only that a control exists. Candidate selection based on evidence type does not itself enforce framework visibility.

Identified implementation areas:

- `apps/api/src/index.ts`: AI risk control linking and returned assessment relationships; legacy finding control lookup.
- `apps/api/src/evidenceAnalysis.ts`: candidate-control selection.
- `apps/mcp-server/src/index.ts`: control lookup/search and evidence-analysis selection. Source inspection also identifies control mappings as requiring the same visibility rule.
- `packages/database/prisma/schema.prisma`: authoritative framework ownership and control relationships.

Comparison with the Reporting V1 diff found these affected paths unchanged; no Reporting regression was established.

## 8. Implemented Remediation

**IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED** (B1).

The shared database visibility policy permits global frameworks and frameworks belonging to the authenticated current tenant. API and MCP establish request scope only after authentication/membership resolution. Control ownership follows its authoritative framework relationship. Direct reads, selection/linking, searches, analysis candidates, mappings, and nested private relationships apply the same rule before retrieval. Historical unauthorized relationships remain stored, but their private fields are not disclosed. Global and same-tenant authorized access remains available.

Implementation includes `packages/database/src/resource-visibility.ts`, database middleware in `client.ts`, and API/MCP consumers. Denial and success regressions repeat the original risk/control linking, historical nested-read and MCP lookup/search/analysis probes. They also verify that historical links are retained.

### Validated performance/security correction

The first visibility implementation mutated reusable caller-owned selections. Repeated reads appended predicates to a module-level nested selection, progressively expanding SQL. Visibility scoping now copies query containers and operates on request-local objects, retaining Prisma scalar instances and all authorization predicates. Reusing a frozen selection and successive tenant A/B/A contexts leave the caller unchanged and remain isolated.

| Measurement                       | Before correction             | After correction          |
| --------------------------------- | ----------------------------- | ------------------------- |
| Nested visibility predicates      | 1 → 9                         | Stable at 1               |
| Nested predicate text, characters | 221 → 1,757                   | Stable at 221             |
| SQL size, characters              | 963 → 7,668                   | Stable at 963             |
| Reused read duration              | Approximately 12.1 → 193.2 ms | Approximately 5.5–10.5 ms |
| Final planning time               | 137.5 ms                      | 4.8 ms                    |
| Final execution time              | 49.0 ms                       | 0.24 ms                   |

Predicate growth was observed over nine route reads; corrected scope reuse was checked twelve times. The representative local SQL benchmark used twelve reused reads before and after correction. Fresh warm selections produced the same 963-character SQL and approximately 9.5–12.0 ms reads. These measurements establish stable query structure for the tested path, not a production latency guarantee. Three dedicated regressions cover unchanged frozen containers/scalars, stable predicates and tenant switching, and database-backed authorized/denied reuse.

## 9. Completed Validation

The original failure paths were repeated as authenticated local API/MCP regression probes, together with authorized success cases. Final API hardening tests passed **28/28** (25 security/governance cases and three visibility-mutation regressions); MCP hardening/context/authentication passed **20/20**. Affected combined API lifecycle suites passed **637/637**.

The final serialized repository run passed **913/913**, with **zero timeouts** while the host remained awake. Typecheck passed; lint passed with zero errors and four pre-existing console warnings; production build passed with all **27 web pages**. Whitespace checks passed. Test assertions and deadlines were preserved.

These are local automated validation results, not production exploitation evidence, production deployment certification, or comprehensive browser certification. See [the hardening validation report](core-v1-hardening-remediation-validation.md) for scope and migration considerations.

## 10. Current Status

**IMPLEMENTED — VALIDATED — HUMAN APPROVED — CLOSED**.

On 10 October 2026, the human owner accepted the completed remediation and validation and explicitly closed B1, H1, H2, M1 and M2. Closure follows separate design approval, implementation approval, regression validation, and human disposition; it was not inferred from passing tests. Core V1 technical readiness is approved. Deployment and deferred polish remain separate work.

## 11. Governance Lesson

Tenant isolation must follow authoritative ownership through every relationship and access surface. A security control must preserve authorization correctness without creating unsafe or unstable operational behavior. Request-local query ownership is part of reliable authorization enforcement.
