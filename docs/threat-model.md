# Threat Model

> Status: initial skeleton, expanded this session to record which
> platform-security frameworks apply and how. Full STRIDE walkthrough is
> tracked in `ROADMAP.md` Phase 9.

## Platform security frameworks (how VendorGuard AI itself is built)

These are distinct from the vendor-assessment frameworks in
`packages/framework-engine` (NIST CSF 2.0, ISO 27001, NIST AI RMF, NIST
800-161) — see that package's `catalog.ts` for the full, data-encoded list
including conditional/deferred vendor-facing frameworks. The frameworks
below govern this application, not the vendors it assesses.

| Framework | Applies to | Status | Enforcement mechanism |
|---|---|---|---|
| OWASP API Security Top 10 (2023) | `apps/api` | Active now | Authz required on every route (no endpoint trusts a client-supplied tenant/object ID), rate limiting, strict input validation via Zod, no verbose error leakage — enforced by API code review checklist and integration tests (Phase 3+). |
| OWASP Top 10 (Web, 2021) | `apps/web` | Active now | Secure headers, CSP, output encoding, CSRF protection on state-changing requests, no client-side authorization decisions — Next.js app conventions documented in `docs/architecture.md` (Phase 3). |
| OWASP LLM Top 10 (2025) | `apps/mcp-server`, `packages/ai-client` | Active now | Direct target of the prompt-injection defenses in spec §16: untrusted-content delimiting, tool allowlisting, no model-authored tool calls, human review required for findings. Test suite: `evaluations/prompt-injection` (Phase 6). |
| NIST SP 800-53 Rev. 5 | Platform control baseline | Deferred | Referenced narratively for now; full control-by-control mapping only pursued if formal assessment (e.g. ATO-style) is later in scope. Not required for MVP. |
| MITRE ATT&CK | Azure infra, containers, CI/CD | Deferred | Referenced narratively; full technique-to-mitigation mapping deferred until logging/detection maturity (Log Analytics + App Insights, Phase 8) exists to actually observe the techniques being mitigated. |
| MITRE ATLAS | The platform's own RAG/MCP attack surface | Deferred | Same reasoning as ATT&CK — meaningful once the AI/MCP pipeline (Phase 6) is built and there's a real system to threat-model. |
| ISO/IEC 42001 | Governance of the AI assistant feature | Deferred | Meaningful once the assistant (Phase 6) is fully built; premature to draft an AI management system around a feature that doesn't exist yet. |

## Why some frameworks are "Active now" vs. "Deferred" here

A framework is **Active now** if it can be enforced today through concrete,
checkable engineering practice (code review rules, CI gates, test suites)
even before the relevant app code is fully built — OWASP's three lists are
architecture-level discipline that shapes how `apps/api`, `apps/web`, and
the AI/MCP components get built from the first line of code.

A framework is **Deferred** if applying it meaningfully requires an
artifact that doesn't exist yet (detection tooling for ATT&CK, a built
assistant feature for ATLAS/ISO 42001, or a decision to pursue formal
assessment for 800-53). Marking something "Active" before that artifact
exists would produce a checklist with nothing real to check.

## Full STRIDE / assets / trust-boundary walkthrough

Not yet written — tracked in `ROADMAP.md` Phase 9 alongside
`docs/data-flow.md`, `docs/authorization-model.md`, and
`docs/mcp-security.md`.
