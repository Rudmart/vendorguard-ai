# VendorGuard AI
# Master Build Plan & Architecture Contract

**Status:** Canonical  
**Baseline:** Steps 1–12 complete  
**Purpose:** Governing architecture for all future VendorGuard AI development

---

# 1. Purpose of This Document

This document is the permanent architectural contract for VendorGuard AI.

Every future implementation Step must be compared against this document before code is changed.

The Master Build Plan defines:

- what VendorGuard AI is;
- what it is not;
- the canonical product terminology;
- the canonical future navigation;
- the governance lifecycle;
- module boundaries;
- system-of-record responsibilities;
- human-vs-AI authority;
- RBAC and separation-of-duties principles;
- audit expectations;
- tenant-isolation requirements;
- completed architecture through Step 12;
- the remaining destination architecture;
- the expected future build sequence;
- prohibited architectural drift.

A Step brief provides authorization to build a specific portion of this plan.

This document does NOT authorize building ahead.

---

# 2. Mandatory Rule for Every Future Step

Before implementing any future Step:

1. Read this Master Build Plan.
2. Inspect the current repository.
3. Compare the requested Step against both.
4. Identify existing functionality that can be reused.
5. Identify conflicts or terminology differences.
6. STOP if the Step would contradict the Master Build Plan.
7. STOP if repository reality materially differs from assumptions in the Step.
8. Report the discrepancy before implementation.

Follow:

**Master Plan → Inspect → Report → Approve Architecture → Build → Test → Report → Approve → Next**

Never interpret this Master Build Plan as permission to implement future functionality early.

---

# 3. Anti-Drift Rule

Claude must NOT independently:

- rename a sidebar item;
- invent a sidebar item;
- add a sidebar section;
- rename an approved module;
- invent a product module;
- invent a governance concept;
- rename an approved governance concept;
- create a duplicate workflow;
- create a duplicate risk system;
- create a duplicate Finding system;
- create a duplicate remediation system;
- create a duplicate evidence system;
- create a duplicate control system;
- create a duplicate AI-system registry;
- invent a new user-facing role;
- invent a lifecycle state because it sounds useful;
- expose internal database names as product navigation;
- reorganize the sidebar;
- build an empty placeholder page;
- build future functionality merely because the schema makes it convenient.

If a new concept genuinely appears necessary:

**STOP and report it.**

Do not silently implement it.

---

# 4. Product Identity

VendorGuard AI is an:

**AI Governance, Risk, Compliance & Assurance platform and hands-on governance homelab.**

It teaches and demonstrates how organizations govern AI systems through a complete lifecycle.

VendorGuard is NOT primarily a vendor-risk product anymore.

Third-Party Risk Management remains an important module, but it is one component of the larger AI governance architecture.

The platform should allow learners and practitioners to perform realistic:

- AI inventory;
- AI use-case governance;
- classification;
- AI risk assessment;
- AI impact assessment;
- framework applicability;
- control mapping;
- evidence collection;
- evidence review;
- control testing;
- Finding management;
- remediation;
- verification;
- risk acceptance;
- reassessment;
- monitoring;
- incident governance;
- reporting;
- audit/readiness activities.

The homelab comes first.

Productization, commercial SaaS hardening, and consulting operations come later.

---

# 5. Core Product Philosophy

VendorGuard should teach real governance work.

The user should not merely click through a software demo.

They should perform activities similar to those performed by:

- AI Governance professionals;
- GRC analysts;
- AI Risk professionals;
- compliance professionals;
- internal auditors;
- control testers;
- third-party risk professionals;
- assurance reviewers.

The platform should continually reinforce:

**AI assists. Humans govern.**

---

# 6. System of Record

VendorGuard is the authoritative governance system of record.

External components may assist VendorGuard later, but they do not become authoritative decision makers.

Future architecture may include:

- AI models;
- RAG;
- MCP;
- n8n;
- external evidence sources;
- cloud integrations;
- governance agents.

Their purpose is to:

- retrieve;
- summarize;
- analyze;
- recommend;
- automate low-risk administrative activity.

They must not independently make consequential governance decisions.

VendorGuard remains authoritative for:

- approvals;
- Findings;
- control-test conclusions;
- risk acceptance;
- remediation verification;
- governance status;
- audit history.

---

# 7. Human Authority Principle

AI may:

- summarize;
- classify provisionally;
- identify potential risks;
- suggest controls;
- suggest evidence;
- identify potential deficiencies;
- draft remediation;
- highlight anomalies;
- recommend next actions.

AI must NOT autonomously:

- approve an AI system;
- reject an AI system;
- make final legal determinations;
- make final compliance determinations;
- certify compliance;
- finalize a control-test conclusion;
- confirm a Finding;
- dismiss a Finding;
- accept risk;
- verify its own remediation;
- close a Finding;
- issue a final audit opinion.

Consequential governance decisions require authorized humans.

---

# 8. Canonical Governance Lifecycle

The target VendorGuard lifecycle is:

**Discover**

→ **Register**

→ **Assign Ownership**

→ **Define Use Case**

→ **Classify**

→ **Risk Assessment**

→ **Impact Assessment**

→ **Determine Requirements / Framework Applicability**

→ **Map Controls**

→ **Collect Evidence**

→ **Human Evidence Review**

→ **Control Testing**

→ **Finding**

→ **Human Finding Review**

→ **Treatment Decision**

→ **Remediation OR Risk Acceptance**

→ **Verification / Approval**

→ **Reassessment**

→ **Production Monitoring**

→ **Incident / New Finding when required**

→ **Retirement**

This lifecycle is canonical.

Do not reorder it merely to fit implementation convenience.

Not every AI system must necessarily exercise every branch, but the architecture must support the lifecycle.

---

# 9. Critical Governance Object Separation

The following concepts are distinct.

Do NOT collapse them.

## Risk

A potential uncertain event or condition that may cause harm.

## Impact

The consequence or effect AI may have on people, organizations, operations, rights, safety, compliance, or other relevant areas.

## Control

A safeguard or governance mechanism intended to manage risk or meet a requirement.

## Evidence

Information demonstrating that a control, process, activity, or assertion exists or occurred.

## Evidence Review

A human determination about whether submitted evidence is acceptable for its intended assurance purpose.

## Control Test

A structured evaluation of control design and/or operation.

## Finding

A formally recognized deficiency.

## Remediation

Corrective action intended to resolve a deficiency.

## Remediation Verification

Independent human confirmation that corrective action adequately resolved the Finding.

## Risk Acceptance

An authorized decision to tolerate residual or unresolved risk.

## Reassessment

A later evaluation triggered by time, material change, monitoring, remediation, incident, or another governance condition.

## Incident

An event involving an AI system that requires investigation, response, escalation, or governance action.

These objects must remain conceptually separate even where their database relationships connect them.

---

# 10. Canonical Future Sidebar

The following is the approved target navigation.

Names are RESERVED.

Claude must not rename them without explicit approval.

---

## OVERVIEW

### Dashboard

Purpose:

Provide high-level governance posture, work requiring attention, risk, Findings, remediation, compliance, and lifecycle status.

Do not turn Dashboard into an operational workflow itself.

### My Work

Purpose:

Provide a user-centered view of governance work assigned to or requiring action from the current user.

Potential future content includes:

- reviews;
- approvals;
- remediation tasks;
- reassessments;
- evidence requests;
- expiring acceptance decisions.

Do not build until authorized.

---

# 11. AI GOVERNANCE

## AI Inventory

Canonical inventory of governed AI systems.

This is the primary registry for AI systems.

Do not create another AI-system registry.

---

## AI Use Cases

Business and operational purposes for AI systems.

Use cases connect governance decisions to why and how an AI system is used.

---

## AI Agents

Future registry/governance capability for autonomous or semi-autonomous AI agents.

This is NOT authorization to build the AI Registrar Agent.

Do not confuse:

**AI Agents navigation**

with

**governance automation agents used internally by VendorGuard.**

Those are separate concepts.

---

## Pending Reviews

Human governance decisions awaiting authorized review.

This should ultimately provide a unified human-review experience where appropriate.

Do not automatically put every workflow into Pending Reviews.

Integration should occur deliberately.

---

# 12. AI RISK

## Risk Register

Canonical view of identified AI risks.

Do not create a second AI risk registry.

---

## Risk Assessments

Structured assessment of AI risks.

Risk assessment and impact assessment remain separate.

---

## Impact Assessments

Structured evaluation of potential AI impacts.

Do not merge Impact Assessment into Risk Assessment merely because fields overlap.

---

## Findings

Canonical user-facing location for formal AI governance Findings.

Internal implementation currently uses:

`GovernanceFinding`

The user-facing term remains:

**Finding**

Do NOT create a sidebar item called:

- Governance Findings
- AI Governance Findings
- Assurance Findings

unless explicitly approved.

---

## Risk Acceptance

Future governed workflow for consciously accepting residual or unresolved risk.

Risk Acceptance is NOT:

- remediation;
- Finding closure;
- approval;
- waiver;
- exception;
- acknowledgment.

Expected future concepts include:

- risk being accepted;
- residual risk;
- justification;
- accountable risk owner;
- authorized approver;
- approval rationale;
- acceptance date;
- expiration/review date;
- conditions;
- reassessment.

Final architecture must be inspected before implementation.

---

## Remediation

Canonical remediation tracking experience.

Existing underlying implementation uses shared:

`RemediationAction`

Do NOT create separate sidebar entries such as:

- AI Remediation
- Governance Remediation
- Finding Remediation
- Corrective Actions

without approval.

---

# 13. THIRD-PARTY AI

Third-Party AI is one module within VendorGuard.

It does NOT define the overall product architecture.

## Vendor Inventory

Registry of external vendors/providers relevant to AI governance and third-party risk.

## Vendor Assessments

Assessment workflows for third parties.

## Vendor Monitoring

Future monitoring of relevant vendor changes and governance conditions.

## Vendor Reports

Vendor-focused reporting.

Existing vendor architecture should be preserved unless deliberately migrated.

Do not force AI-system governance objects to become vendor objects.

---

# 14. COMPLIANCE & ASSURANCE

## Compliance Frameworks

Framework applicability and governance requirements.

VendorGuard already contains seeded frameworks and controls.

Reuse the framework architecture.

Do not create duplicate framework catalogs.

---

## Controls

Canonical control library and control-governance experience.

Controls may relate to:

- frameworks;
- AI systems;
- risks;
- evidence;
- testing;
- Findings.

Do not create separate competing control libraries.

---

## Evidence Library

Canonical evidence repository.

Evidence may support multiple governance purposes.

Evidence submission is not equivalent to evidence acceptance.

Evidence acceptance is not equivalent to control effectiveness.

---

## Control Testing

Formal assurance testing.

Current architecture includes:

`AiControlTest`

and associated evidence relationships.

Testing must preserve:

- tester;
- method;
- evidence;
- design conclusion;
- operating conclusion;
- overall effectiveness;
- rationale;
- date;
- history.

Completed tests remain immutable.

Retesting creates a new test record.

---

## Policies

Future policy-management capability.

Do not build until authorized.

Policies are governance documents and requirements.

Do not confuse Policies with Controls.

---

## Exceptions

Future governed exception workflow.

Do not build until authorized.

An Exception is NOT automatically:

- a Finding;
- Risk Acceptance;
- remediation;
- policy approval.

Architecture must be defined before implementation.

---

# 15. MONITORING

## Governance Monitoring

Future capability for monitoring governance-relevant changes.

Examples may eventually include:

- lifecycle changes;
- material system changes;
- evidence expiration;
- control conditions;
- acceptance expiration;
- governance obligations.

Do not build a generic technical-security monitoring platform.

---

## Reassessments

Future workflow for renewed governance evaluation.

Potential triggers include:

- scheduled review;
- material system change;
- material use-case change;
- new regulation;
- Finding remediation;
- risk acceptance expiration;
- incident;
- monitoring signal.

Reassessment should reuse existing assessment architecture where possible.

---

## AI Incidents

Future governance workflow for AI-related incidents.

Do not build SOC/SIEM functionality.

VendorGuard governs AI incidents; it is not intended to become a full security operations platform.

---

# 16. REPORTING

## Executive Reports

Leadership-level governance reporting.

Existing reporting functionality must be preserved.

---

## AI Risk Reports

Future risk-focused reporting.

---

## Compliance Reports

Future framework/control/compliance-focused reporting.

---

## Audit Packages

Future exportable assurance package.

Potential contents may include:

- scope;
- AI system;
- applicable requirements;
- controls;
- evidence;
- evidence reviews;
- tests;
- Findings;
- remediation;
- verification;
- approvals;
- risk acceptance;
- audit trail.

Do not implement until authorized.

---

# 17. LEARNING CENTER

VendorGuard is also a hands-on learning environment.

The Learning Center should teach governance concepts and then direct learners into actual VendorGuard workflows.

Canonical navigation:

## AI Governance Workflow

Teach the end-to-end governance lifecycle.

## AI Risk Workflow

Teach AI risk identification, assessment, treatment, acceptance, and reassessment.

## AI Third-Party Risk Workflow

Teach governance of external AI vendors/providers.

Do not create dozens of tutorial sidebar entries.

The Learning Center should remain structured and purposeful.

---

# 18. SYSTEM

## Audit Logs

Canonical view of governance activity history.

Audit history is a core control, not merely debugging information.

---

## Administration

Canonical administrative configuration location.

Do not create separate sidebar items for ordinary settings unless explicitly approved.

---

# 19. AI Assistant Placement

The AI Assistant remains in the global TOP BAR.

It is NOT a sidebar lifecycle module.

Do not create:

- AI Assistant sidebar page;
- Copilot sidebar page;
- Governance Chat sidebar page.

The assistant works across VendorGuard.

---

# 20. Navigation vs Internal Model Names

Database names do not automatically become product names.

Examples:

Internal:

`GovernanceFinding`

Product:

**Finding**

Internal:

`RemediationVerification`

Product concept:

**Verification**

Internal:

`AiSystemControlEvidence`

Product:

**Evidence**

Internal architecture may require precise technical names.

Navigation must use approved product terminology.

Never create navigation from model names automatically.

---

# 21. No Empty Navigation

The canonical sidebar describes the target architecture.

It does NOT mean every item must appear immediately.

A navigation item should become active when enough functionality exists for it to provide meaningful user value.

Do NOT create empty pages simply to make the sidebar resemble the future design.

Until functionality exists, the target item may remain absent.

---

# 22. Completed Baseline — Steps 1–12

The current repository is not greenfield.

Preserve the architecture already built.

---

## Foundation

Existing platform foundation includes:

- authentication;
- tenancy;
- RBAC;
- audit infrastructure;
- vendor architecture;
- AI-system architecture;
- governance workflow foundations;
- reporting;
- AI Assistant;
- MCP-related functionality.

Do not rebuild these systems.

---

## AI System Governance

VendorGuard supports AI-system registration and governance information.

The AI system remains the central governed object for internal AI governance.

---

## Risk Assessment

AI risk-assessment architecture exists.

Reuse it.

Do not create a new risk-assessment engine.

---

## Impact Assessment

AI impact-assessment architecture exists.

Preserve independent human review.

---

## Framework Applicability & Control Mapping

AI systems can be associated with applicable frameworks and controls.

Framework and control architecture must be reused.

---

# 23. Step 9 — Evidence & Assurance

Completed.

Architecture includes:

- `EvidenceDocument.vendorId` optional;
- `EvidenceDocument.aiSystemId` optional;
- `AiSystemControlEvidence`;
- `AiControlEvidenceReview`.

Evidence assurance statuses are derived:

- No Evidence
- Pending
- Accepted
- Rejected

Evidence submission and evidence review use separation of duties.

Important:

**Evidence accepted ≠ Control effective.**

---

# 24. Step 10 — Control Testing

Completed.

Architecture includes:

`AiControlTest`

`AiControlTestEvidence`

Test methods include:

- DOCUMENT_REVIEW
- INTERVIEW
- OBSERVATION
- SAMPLE_TESTING
- CONFIGURATION_REVIEW
- OTHER

Effectiveness:

- NOT_ASSESSED
- INEFFECTIVE
- PARTIALLY_EFFECTIVE
- EFFECTIVE

Completed tests are immutable.

Retesting creates a new test.

Control-testing conclusions remain human-governed.

Important:

**Control Test ≠ Finding.**

---

# 25. Step 11 — Findings

Completed.

Legacy:

`ControlFinding`

is a vendor control-evaluation result and must not be mistaken for the new AI governance Finding lifecycle.

AI governance uses:

`GovernanceFinding`

Status:

- PENDING_REVIEW
- OPEN
- DISMISSED
- CLOSED

Finding decisions:

- CONFIRM
- DISMISS

Creation is currently manual from qualifying completed control tests.

Human review determines whether the proposed Finding becomes OPEN or DISMISSED.

CLOSED is reserved for legitimate lifecycle closure.

Important:

**Machine-detected deficiency ≠ authoritative Finding.**

Human review is required.

---

# 26. Step 12 — Remediation, Verification & Finding Closure

Completed.

Shared:

`RemediationAction`

was extended with an optional unique relationship to `GovernanceFinding`.

One remediation currently exists per GovernanceFinding.

Lifecycle:

OPEN

→ IN_PROGRESS

→ PENDING_VERIFICATION

Then:

### VERIFIED

Remediation:

→ CLOSED

GovernanceFinding:

→ CLOSED

### REJECTED

Remediation:

→ IN_PROGRESS

GovernanceFinding:

remains OPEN

Verification history is append-only through:

`RemediationVerification`

Required governance principle:

**remediation owner ≠ verifier**

Only the owner submits GovernanceFinding remediation for verification.

Verification is performed by an authorized independent human.

Important:

**Remediation completed ≠ independently verified.**

**Finding closure requires successful verification.**

---

# 27. Risk Acceptance — Future Required Capability

Risk Acceptance remains intentionally unimplemented for GovernanceFindings as of the Step 12 baseline.

This is a major remaining lifecycle capability.

Risk Acceptance must remain separate from remediation.

Conceptually:

### Remediation path

Finding

→ Remediation

→ Verification

→ Finding CLOSED

### Acceptance path

Risk / unresolved condition

→ Risk Acceptance request

→ Authorized human review

→ Approved or rejected

→ time-bound acceptance

→ reassessment / expiration

The final relationship between Findings and Risk Acceptance must be inspected before implementation.

Do NOT assume Risk Acceptance automatically closes a Finding.

Do NOT build Risk Acceptance until its specific Step is approved.

---

# 28. Future Lifecycle Build Plan

The following describes the target remaining architecture.

It is a planning sequence, NOT authorization to build.

Exact Step numbers are assigned only when a Step brief is approved.

---

## PHASE A — Complete Risk Treatment

### Risk Acceptance

Build governed, explicit, time-bound residual-risk acceptance.

Must include human authority and auditability.

---

## PHASE B — Reassessment

Implement reassessment of governed AI systems.

Reuse existing:

- classification;
- risk;
- impact;
- controls;
- evidence;
- tests

where appropriate.

Do not duplicate assessment engines.

---

## PHASE C — Production Governance / Monitoring

Build governance monitoring for deployed AI systems.

Focus on governance-relevant signals, not generic infrastructure monitoring.

---

## PHASE D — AI Incident Governance

Implement AI incident registration, assessment, ownership, response, escalation, and governance linkage.

Do not create a SIEM.

---

## PHASE E — Retirement

Complete the AI lifecycle with controlled retirement/decommissioning.

Preserve historical governance records.

---

# 29. Compliance & Assurance Expansion

After the core lifecycle is stable, expand assurance capabilities deliberately.

Potential approved destination capabilities include:

### Policies

Policy inventory and governance.

### Exceptions

Formal exception requests and approval.

### Evidence Requests / PBC

Structured requests for assurance evidence where appropriate.

### Enhanced Workpapers

Formal assurance workpapers where needed.

### Sampling

Structured sample definition and testing support.

### Retesting

Explicit post-remediation or scheduled control retesting.

### Audit Packages

Traceable assurance exports.

Do not build these opportunistically during unrelated Steps.

---

# 30. Monitoring & Continuous Assurance — Later Phase

Later VendorGuard may support:

- evidence expiration monitoring;
- acceptance expiration monitoring;
- reassessment reminders;
- vendor monitoring;
- control monitoring;
- governance-event monitoring;
- scheduled reports.

Only after the core lifecycle is complete should orchestration such as n8n be considered.

Automation must not bypass human authority.

---

# 31. AI Agents — Later Phase

Future small governance agents may include narrowly scoped assistance.

The planned Registrar concept may eventually assist with:

- discovering candidate AI systems;
- collecting registration information;
- suggesting classification;
- routing registrations.

But it must not autonomously make authoritative governance decisions.

Do NOT build the AI Registrar Agent before explicit authorization.

Do not build a multi-agent architecture merely because it is technically interesting.

---

# 32. MCP

MCP should provide controlled access to VendorGuard capabilities.

MCP does not become a second governance system.

MCP tools should:

- respect tenancy;
- respect RBAC;
- respect auditability;
- expose approved operations.

Do not duplicate business logic inside MCP when authoritative application services already exist.

---

# 33. RAG

Future RAG capabilities may retrieve authorized governance information.

RAG may help:

- answer questions;
- summarize policies;
- locate evidence;
- identify applicable controls;
- support governance analysis.

RAG output remains advisory.

RAG does not approve or certify anything.

---

# 34. n8n

n8n may eventually orchestrate:

- reminders;
- notifications;
- scheduled governance activities;
- report distribution;
- evidence requests;
- reassessment triggers.

n8n is NOT the authoritative governance engine.

Business rules remain in VendorGuard.

Do not introduce n8n until explicitly authorized.

---

# 35. Data Architecture Principle

Prefer extending existing authoritative models over creating parallel models.

Before creating any model, ask:

1. Does an existing object already represent this concept?
2. Can it safely support another relationship?
3. Would a new model create duplicate state?
4. Is history required?
5. Is the information authoritative or derived?
6. Does the new model represent a genuinely different governance concept?

Prefer:

**shared authoritative object + explicit relationships**

over:

**duplicate module-specific copies.**

---

# 36. History Principle

Governance history matters.

Where a decision is consequential, prefer preserving history rather than overwriting it.

Examples:

- evidence review history;
- control-test history;
- Finding review;
- remediation verification;
- risk acceptance approval;
- reassessment history.

Do not destroy previous governance decisions merely because a later decision supersedes them.

---

# 37. Derived vs Stored State

Do not persist state unnecessarily.

Examples:

If overdue status can safely be derived from:

- due date;
- current date;
- closure state

then prefer derived presentation rather than automated mutation unless business requirements require stored state.

Avoid duplicated authoritative state.

---

# 38. RBAC Principle

Backend authorization is authoritative.

UI hiding is not security.

Reuse existing permissions where semantics match.

Create new permissions only when the governance action is genuinely distinct.

Roles should not multiply unnecessarily.

Current broad role concepts include existing VendorGuard roles such as:

- ADMIN
- ANALYST
- REVIEWER
- AUDITOR

Do not invent new user-facing roles without approval.

---

# 39. Separation of Duties

Apply separation of duties where a person would otherwise approve their own consequential work.

Examples already established:

- evidence submitter vs evidence reviewer;
- control owner/evidence contributor vs tester;
- Finding creator vs Finding reviewer;
- remediation owner vs remediation verifier.

Do not apply SoD mechanically to every action.

Use it where independence materially improves governance integrity.

---

# 40. Tenant Isolation

Tenant isolation is mandatory.

Every relevant object relationship must be tenant validated.

Cross-tenant access should follow existing safe behavior, normally:

**404**

Do not leak whether another tenant's object exists.

Tenant isolation applies to:

- APIs;
- relationships;
- ownership;
- evidence;
- Findings;
- remediation;
- verification;
- risk acceptance;
- reports;
- MCP;
- future automation.

---

# 41. Auditability

Consequential governance actions must be auditable.

Audit events should answer:

- who;
- did what;
- to which object;
- when;
- with what decision;
- under what tenant.

Do not log sensitive evidence unnecessarily.

Future governance actions requiring audit include:

- approvals;
- rejections;
- risk acceptance;
- verification;
- closure;
- ownership changes;
- consequential status changes.

Audit logs are governance records, not debugging logs.

---

# 42. Concurrency

Authoritative decisions must protect against stale or simultaneous actions.

Where two users may make a consequential transition:

**first valid authoritative transition wins.**

Stale conflicting attempts should normally produce:

**409 Conflict**

Use existing conditional-update patterns.

Do not overengineer distributed locking.

---

# 43. Immutability

Completed governance records should generally become immutable when alteration would rewrite history.

Existing example:

Completed `AiControlTest`.

For later corrections:

prefer a new record, reassessment, retest, review, or superseding decision rather than rewriting history.

---

# 44. UI Design Principle

The UI should reflect governance work, not database structure.

Each page should help the user understand:

- what object they are governing;
- current status;
- why action is required;
- who owns it;
- what decision is available;
- what evidence supports it;
- what happened previously;
- what happens next.

Avoid exposing implementation complexity unnecessarily.

---

# 45. Learning Design Principle

VendorGuard should teach:

**Concept → Why it matters → Example → Perform the work → Review the result**

Do not replace real workflows with canned educational simulations.

Learners should use the actual governance engine.

---

# 46. Industry Scenarios

VendorGuard should remain a universal governance engine.

Industry-specific homelab scenarios may later demonstrate the engine in contexts such as regulated industries.

Do not fork the core platform into industry-specific applications.

Prefer:

**one engine + multiple scenarios**

over:

**multiple industry products.**

---

# 47. Technical Security Boundary

VendorGuard needs appropriate application security.

But this project should not drift into building:

- SIEM;
- SOC;
- EDR;
- model firewall;
- runtime AI security gateway;
- penetration-testing platform;
- cloud-security posture manager.

Technical security integrations may supply governance evidence later.

VendorGuard remains focused on governance, risk, compliance, and assurance.

---

# 48. Production Hardening Boundary

The current priority is the working homelab and governance lifecycle.

Production SaaS hardening is a later explicit phase.

Do not derail lifecycle development with premature:

- hyperscale architecture;
- multi-region design;
- enterprise billing;
- production marketplace integrations;
- elaborate infrastructure;
- unnecessary microservices.

Build cleanly enough that future hardening is possible.

Do not prematurely optimize.

---

# 49. Consulting Boundary

VendorGuard should first become a strong working homelab and portfolio platform.

Consulting engagement simulation and commercial consulting workflows come later.

Do not build consulting operations into current governance Steps unless explicitly authorized.

---

# 50. Existing Backlog Is Not Automatic Scope

Known backlog currently includes items such as:

- legacy vendor/AI-risk remediation verification semantics;
- legacy remediation audit gaps;
- vendor Finding audit gaps;
- possible `ControlFinding` race condition;
- vendor-specific `FindingEvidence`;
- AI Findings integration into Pending Reviews;
- Finding owner-picker improvements;
- Azurite healthcheck issue.

Backlog items do NOT automatically become part of the next Step.

Only fix them when:

1. the current Step requires it;
2. they cause a regression;
3. they are explicitly approved.

---

# 51. Preserve Existing Working Functionality

Future development must protect:

- vendor workflows;
- AI-system workflows;
- authentication;
- tenancy;
- RBAC;
- audit;
- evidence;
- evidence review;
- control testing;
- Findings;
- remediation;
- verification;
- reports;
- AI Assistant;
- MCP.

Use additive migrations whenever possible.

Do not destroy valid existing data.

---

# 52. Migration Rule

Before schema changes:

1. inspect current schema;
2. inspect consumers;
3. identify existing data;
4. determine migration impact;
5. prefer additive migration;
6. verify migration SQL;
7. preserve existing rows;
8. verify database after application.

No destructive migration without explicit approval.

---

# 53. API Rule

Do not create speculative APIs.

Build only APIs required for approved workflows.

Reuse authoritative services where possible.

APIs must enforce:

- authentication;
- tenant isolation;
- RBAC;
- lifecycle rules;
- SoD;
- validation;
- concurrency;
- auditability.

The UI must not contain authoritative governance rules that the API does not enforce.

---

# 54. Testing Standard

Every future Step should include appropriate:

- unit/service tests;
- API tests;
- RBAC tests;
- tenant-isolation tests;
- SoD tests;
- concurrency tests;
- audit tests;
- regression tests.

Also run:

- full test suite;
- typecheck;
- lint;
- production build.

Schema changes require database verification.

User-facing workflows require browser walkthrough.

---

# 55. Browser Verification Standard

A browser walkthrough should demonstrate the actual governance lifecycle added by the Step.

Do not merely verify that a page loads.

Exercise:

- valid action;
- invalid action;
- role restrictions;
- lifecycle transitions;
- history;
- relevant navigation;
- regression-sensitive areas.

---

# 56. Build Discipline

For every future Step:

### Phase 1 — Inspection

Read-only.

No code changes.

### Phase 2 — Architecture Report

Report:

- existing implementation;
- conflicts;
- reuse opportunities;
- blast radius;
- proposed minimal architecture.

STOP.

### Phase 3 — Architecture Approval

Wait for approval.

### Phase 4 — Build

Implement only approved scope.

### Phase 5 — Verification

Run:

- tests;
- typecheck;
- lint;
- build;
- DB verification;
- browser walkthrough.

### Phase 6 — Completion Report

STOP.

Do not begin the next Step.

---

# 57. Git Discipline

Do not mix unrelated cleanup into feature work.

Keep Steps reviewable.

Before declaring a Step complete:

- working tree should be understood;
- migrations should be accounted for;
- tests should pass;
- regression behavior should be checked.

Do not begin the next Step on an unverified baseline.

---

# 58. Canonical Terminology Contract

Use these user-facing names:

**AI System**

**AI Use Case**

**AI Agent**

**Risk**

**Risk Assessment**

**Impact Assessment**

**Framework**

**Control**

**Evidence**

**Evidence Review**

**Control Test**

**Finding**

**Remediation**

**Verification**

**Risk Acceptance**

**Reassessment**

**AI Incident**

**Audit Log**

Do not casually invent synonyms for navigation or primary objects.

For example, do not rename Finding to:

- Issue
- Observation
- Deficiency Record
- Governance Finding

in navigation without approval.

Descriptions may use words like deficiency when explaining what a Finding means.

The object remains:

**Finding**

---

# 59. Sidebar Contract

The target sidebar is exactly:

## Overview
- Dashboard
- My Work

## AI Governance
- AI Inventory
- AI Use Cases
- AI Agents
- Pending Reviews

## AI Risk
- Risk Register
- Risk Assessments
- Impact Assessments
- Findings
- Risk Acceptance
- Remediation

## Third-Party AI
- Vendor Inventory
- Vendor Assessments
- Vendor Monitoring
- Vendor Reports

## Compliance & Assurance
- Compliance Frameworks
- Controls
- Evidence Library
- Control Testing
- Policies
- Exceptions

## Monitoring
- Governance Monitoring
- Reassessments
- AI Incidents

## Reporting
- Executive Reports
- AI Risk Reports
- Compliance Reports
- Audit Packages

## Learning Center
- AI Governance Workflow
- AI Risk Workflow
- AI Third-Party Risk Workflow

## System
- Audit Logs
- Administration

And:

**AI Assistant remains in the top bar.**

Do not change this navigation contract without explicit architectural approval.

---

# 60. Important Sidebar Implementation Rule

This is the TARGET sidebar.

Do NOT immediately replace the current sidebar with every future item.

Only expose an item when its workflow is meaningfully implemented.

Therefore:

**canonical destination ≠ permission to create placeholders**

When adding a page in a future Step, use the exact approved name and correct section from this contract.

---

# 61. Architecture Conflict Rule

If a future Step brief says something that conflicts with this document:

STOP.

Report:

**MASTER PLAN CONFLICT**

Then identify:

- Master Plan requirement;
- Step requirement;
- repository reality;
- recommended resolution.

Do not choose silently.

---

# 62. Repository Conflict Rule

If repository inspection reveals that this document is inaccurate because implementation evolved:

Do NOT silently redesign the repository.

Report:

**REPOSITORY / MASTER PLAN DISCREPANCY**

Explain:

- expected architecture;
- actual architecture;
- impact;
- safest recommendation.

Wait for approval.

---

# 63. Naming Conflict Rule

If Claude believes a different name would be better:

do not rename it.

Report the suggestion separately.

Example:

“Current approved navigation is `Findings`. I recommend `Governance Findings` because X.”

Then STOP on that naming change.

Unless approved, continue using:

**Findings**

---

# 64. Future-Step Scope Rule

Every Step must answer:

**Which exact portion of the canonical lifecycle does this Step complete?**

If the proposed work does not clearly advance the lifecycle, resolve an approved backlog item, or support the learning environment, challenge the scope before building.

---

# 65. Definition of Done for the Core Homelab

The core VendorGuard homelab is complete when a learner can realistically govern an AI system through:

**Discovery / Registration**

→ ownership

→ use case

→ classification

→ risk assessment

→ impact assessment

→ requirements/framework applicability

→ controls

→ evidence

→ evidence review

→ control testing

→ Finding

→ Finding review

→ remediation OR risk acceptance

→ verification/approval

→ reassessment

→ production governance monitoring

→ incident handling where applicable

→ retirement

with:

- human authority;
- RBAC;
- separation of duties;
- tenant isolation;
- auditability;
- history;
- reporting;
- understandable UI.

---

# 66. Definition of Success

VendorGuard succeeds when someone using the homelab can explain not just:

**“I used GRC software.”**

but:

**“I governed an AI system through its lifecycle, assessed risk and impact, mapped requirements and controls, collected and reviewed evidence, tested controls, documented Findings, remediated deficiencies, independently verified remediation, made explicit risk-treatment decisions, reassessed the system, monitored governance obligations, and preserved an auditable record of human decisions.”**

That is the product we are building.

---

# 67. Current Authorized Baseline

As of this Master Plan:

**Steps 1–12 are complete.**

The latest completed lifecycle capability is:

**Remediation → Independent Verification → Finding Closure**

Risk Acceptance has intentionally NOT yet been implemented as part of the GovernanceFinding lifecycle.

No future Step is authorized merely by appearing in this document.

The next Step must receive its own approved brief.

---

# 68. Instruction to Claude for Every New Step

At the beginning of every future Step, treat this document as authoritative architectural context.

Before writing code:

1. identify the lifecycle stage being implemented;
2. identify the canonical sidebar location;
3. identify existing models/services that should be reused;
4. identify terminology that must remain unchanged;
5. inspect the repository;
6. report any conflicts;
7. propose the smallest additive architecture;
8. STOP for approval.

During implementation:

- do not build ahead;
- do not rename;
- do not invent navigation;
- do not create duplicate governance systems;
- do not weaken human approval;
- do not weaken tenant isolation;
- do not weaken RBAC;
- do not bypass auditability;
- do not destroy governance history.

At completion:

**Build → Test → Database Verify → Browser Walkthrough → Report → STOP**

Never begin the next Step automatically.