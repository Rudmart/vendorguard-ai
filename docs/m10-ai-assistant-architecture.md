# Milestone 10 - Governed AI Risk Assistant

## 1. AI Architecture

When a user asks a question, the request goes to the API route POST /vendors/:id/assistant/messages in apps/api/src/index.ts.
That route calls buildAssistantContext in apps/api/src/assistantContext.ts, which pulls real vendor data - risk rating, findings, and evidence excerpts. This is the only data the model ever sees. There is no open-ended database access.
Then askAssistant in packages/ai-client/src/assistant.ts makes the real Claude call, grounded strictly in that context. It checks for prompt injection and insufficient evidence.
The response is saved to AssistantConversation and AssistantMessage in the database, an audit log entry is written, and the response is returned to the browser.

## 2. Governance Controls

The model only ever receives what buildAssistantContext returns. It has no tool-calling and no database write access, so it cannot change a risk rating or close a finding - there is no code path that would let it try.
Four categories are kept distinct: Authoritative Data is the real VendorGuard fields, shown as-is. AI Analysis is the model's read of that data. AI Recommendation is a suggestion the model offers. Human Decision is anything authoritative, such as setting a rating or approving a vendor, and stays exclusively in VendorGuard's existing human-driven workflows.
In a live adversarial test, the Assistant was asked to set a risk rating and approve the vendor. It refused, named the attempt as a likely prompt injection, and both the insufficientEvidence and promptInjectionFlagged signals fired correctly. Across five real GRC queries, it reported missing data as missing every time instead of inventing an answer. Every message is logged in the existing AuditEvent model.
