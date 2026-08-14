# VendorGuard AI - Build Plan (Updated)

Last updated: August 13, 2026, after the login-bug debugging + CI/CD session.

This replaces guesswork with an accurate picture: what's actually built, what's stubbed, and a prioritized checklist for what's left. Update the checkboxes as you go so this stays trustworthy.

---

## Current State Summary

Done and verified working:
- Auth (login/logout, multi-tenant sessions via tenantId, roles)
- Vendor list + add (detail/edit/delete not yet built)
- Risk scoring engine (packages/risk-engine, 6-factor calculateInherentRisk(), fully tested - 17 passing tests)
- Database (Postgres/Prisma, deployed on Azure)
- 5 real framework datasets with populated controls.json: FFIEC Outsourcing, GLBA Safeguards, ISO 22301, NIST 800-161, NIST 800-66
- Docker + Azure Container Apps deployment, now via a correct esbuild-bundled build
- Real CI/CD: every PR to master requires lint, typecheck, unit tests, secret scanning (gitleaks), CodeQL, dependency review, and Bicep lint to pass - all verified green end-to-end
- Public GitHub repo (unlocks free branch protection + Advanced Security)
- Rotated, non-leaked database credentials

Scaffolded but empty (folders exist, zero files inside):
- apps/mcp-server
- evaluations/ (compliance-accuracy, golden-dataset, prompt-injection)
- infrastructure/ (environments, modules, policies) - all deploys are manual az acr build / az containerapp update commands run by hand

---

## Prioritized Checklist

### Tier 1 - Small (a few hours each)

- [ ] Vendor detail page - view a single vendor's full profile
- [ ] Vendor edit - update fields on an existing vendor
- [ ] Vendor delete - with a confirmation step
- [ ] RBAC enforcement on routes - role already exists in the session but most API routes do not check it yet
- [ ] Wire up remaining frameworks: NIST AI RMF, NIST 800-53, ISO 27001, SOC 2, OWASP LLM Top 10

### Tier 2 - Medium (roughly a day or two each)

- [ ] Assessment workflow - questionnaire UI, answers feed into calculateInherentRisk() (already built), auto-generate findings
- [ ] Evidence repository - file upload (SOC2 reports, policies, etc.) to Azure Blob Storage, metadata stored in DB, linked to vendors/controls
- [ ] Executive report generator - pulls existing vendor/risk/finding data into a summary view or export
- [ ] Evidence staleness rule - flag evidence older than 12 months as a finding

### Tier 3 - Large (the real differentiators, multi-day each)

- [ ] MCP server (apps/mcp-server - currently empty)
  - Expose list_frameworks(), list_controls(), get_control(), search_controls() over the 5 framework datasets already sitting in frameworks/
  - This is the single highest-leverage remaining piece - everything else in Tier 3 depends on it
- [ ] AI Assistant (Azure OpenAI + function calling)
  - Depends on MCP server existing first
  - Wire to backend APIs so it answers from real data, not hallucination
  - Implement the example prompts from the original spec
- [ ] Infrastructure-as-Code (infrastructure/ - currently empty)
  - Bicep for the resources managed by hand today: Container Apps, Postgres, Container Registry, Key Vault
  - Turns deploys from a manual multi-step dance into az deployment group create
  - Directly prevents a repeat of today's silently broken deploy saga
- [ ] Evaluations (evaluations/ - currently empty)
  - golden-dataset: known-good input/output pairs for the AI Assistant
  - compliance-accuracy: does the risk engine + framework mapping produce correct results
  - prompt-injection: adversarial testing once the AI Assistant exists
  - Needs the AI Assistant built first to be meaningful

---

## Suggested order for tomorrow

1. Pick 1-2 Tier 1 items (vendor detail + edit are natural next steps)
2. If time remains, start on the MCP server skeleton since it is the biggest unlock and the framework data is already sitting there ready to be exposed

## Resume protocol

Check this file's checkboxes first, then check the repo directly for anything marked incomplete - do not assume, verify.
