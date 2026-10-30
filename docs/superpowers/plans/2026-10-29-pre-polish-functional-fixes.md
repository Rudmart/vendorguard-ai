# Pre-polish functional fixes implementation plan

**Goal:** Complete the approved vendor reassessment, independent vendor risk acceptance and scoped framework-library additions without redesigning the application.

**Architecture:** Reuse Vendor, Assessment, Questionnaire, ControlFinding, RiskAcceptance, tenant-scoped authorization and transactional audit patterns. Add reassessment linkage and acceptance snapshot/context fields through an additive migration; preserve legacy records without backfill.

**Spec:** Marine/PFC controlled implementation approval, 2026-10-29, attached to the working conversation.

**Constraints:** AI ASSISTS. HUMANS GOVERN. No weakening of RBAC, tenant boundaries, independent review, evidence validation or lifecycle safeguards. No redesign, unrelated features, commit or push. Do not access the untracked inspection report.

## Execution

- [ ] Add failing API regression tests for vendor acceptance requests, independent decisions, cross-tenant/role denials, duplicates, concurrency, snapshots and audit rollback; and reassessment history, linkage, trigger/material-change persistence and reviewed completion.
- [ ] Add nullable acceptance context fields and a vendor reassessment table with an additive migration; generate client and deploy only this approved migration. No historical data backfill or reseed.
- [ ] Implement narrowly scoped vendor governance routes, reusing assessment/questionnaire flows and current source data. Serialize competing vendor governance writes and make audit persistence atomic.
- [ ] Add focused framework tests; extend existing catalog identifiers, applicability and source-linked scoped content. Avoid restricted control text and automatic compliance conclusions. Make assessment choices load from the available authoritative library.
- [ ] Expose vendor monitoring/reassessment and acceptance using the current vendor page and existing form styles. No sidebar, dashboard or navigation restructuring.
- [ ] Challenge stale/concurrent requests, invalid relationships, unauthorized roles and audit failures. Preserve old records and avoid changing source finding/remediation state.
- [ ] Run focused and relevant combined regression tests sequentially, then repository typecheck, lint, production builds and whitespace/diff checks. Record exact results and stop for human review.

## Review focus

- Foreign IDs and inactive/deleted vendors fail closed without partial records.
- Requesters cannot decide their own acceptance; repeat/stale decisions cannot overwrite attribution.
- Reassessment completion requires independently approved questionnaire state and retains prior assessment data.
- Acceptance snapshots remain historical; changed source risk requires a fresh request.
- Framework availability and scoped summaries never constitute compliance or certification.
