# VendorGuard AI — Project Overview

VendorGuard AI is the primary portfolio project: a platform for AI governance and third-party risk management. It connects authoritative lifecycle records with human review, tenant isolation, role-based permissions and audited decisions.

**AI ASSISTS. HUMANS GOVERN.** AI analysis is advisory; material governance decisions require authorized human action.

## Current capabilities and completed Core V1 work

The validated AI governance lifecycle covers inventory, use-case intake, risk and impact assessments, framework applicability, controls/testing, evidence, findings/remediation, risk acceptance, monitoring/reassessment, incidents, retirement and Executive & Governance Reporting. Historical records and outstanding obligations remain visible after retirement; reporting respects permissions and generation/export audit requirements.

Core V1 technical lifecycle/security validation was completed and human-approved. The recorded final local validation passed 913/913 tests with zero timeouts, API/MCP security probes, typecheck, lint and build; all 27 pages built. Four pre-existing lint warnings remained. See the [lifecycle validation summary](core-v1-lifecycle-validation.md) for scope and limits.

Vendor assessment, deterministic risk scoring, evidence-grounded assistance and controlled MCP tools are also documented project capabilities. Framework control content is illustrative rather than a complete compliance catalog. No AI Governance Score or automatic compliance certification is implied.

This is **not production certification or final production deployment approval**.

## Architecture

Next.js web application, Fastify API and MCP server with shared TypeScript packages, Prisma/PostgreSQL records, authorization policies and audit evidence.

- [Master Build Plan & Architecture Contract](vendorguard-master-plan.md): lifecycle/object design, human authority and planned expansion.
- [Governed AI Assistant architecture](m10-ai-assistant-architecture.md): Milestone 10 implementation and practical validation evidence.
- [MCP architecture](m11-mcp-architecture.md): Milestone 11 implementation, tool boundaries and validation evidence.
- [Threat-model reference](../../threat-model.md) and [pre-public security review plan](../../security-review-plan.md): planning/reference material, not proof of completed deployment controls.

Milestone documents describe their original stages. Earlier test counts, session design and dependency statements must be read alongside later hardening evidence.

## Security and governance validation

Individual findings belong in [Issues & Findings](../../issues-findings/README.md).

- [Core V1 findings and human-approved closure](../../issues-findings/core-v1/README.md)
- [Hardening implementation and validation evidence](../../issues-findings/core-v1/core-v1-hardening-remediation-validation.md)
- [Governance & Security Lessons Learned](../../issues-findings/core-v1/core-v1-governance-security-lessons-learned.md)

## Historical deployment information

[Azure deployment progress notes](deployment-history/AZURE-DEPLOYMENT-NOTES.md) preserve earlier observations and constraints. They do not establish current cloud availability/security, and their commands are not current deployment instructions. Historical connection details are redacted; Git history is not rewritten.

[Deployment/CI investigations](../../issues-findings/deployment-ci-history/README.md) record past failures and corrections. [Archived build plans](../../archive/BUILD-PLAN-UPDATED.md) and [framework status](../../archive/FRAMEWORK-MAPPING-STATUS.md) describe superseded stages.

## Future and planned work

The architecture contract describes later AI Agent assistance (section 31), MCP governance (section 32), and RAG (section 33). These are future scope, not completed standalone labs. Final UI/UX polish, production hardening and Azure deployment remain separate from Core V1 technical approval.

[Labs](../../labs/README.md) distinguishes practical project experience from standalone exercises. The root [legacy roadmap](../../../ROADMAP.md) records the original phased plan; the architecture contract and validation summary provide later scope/completion evidence.
