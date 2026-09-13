# Milestone 11 - MCP Compliance Server

## 1. What is MCP, in plain terms

MCP is a controlled way for an AI to fetch real data from an application, instead of guessing or being given unrestricted database access. Think of it like a waiter: the AI cannot walk into the kitchen and grab whatever it wants - it asks the waiter, the MCP server, for a specific predefined item off a fixed menu, and the waiter checks whether that request is actually allowed before bringing back exactly that, and only that.

## 2. Architecture

The AI Assistant sends an HTTP request to the MCP server. The server reads the real session cookie and re-verifies the current role from the TenantMembership table in the database, never trusting the role stored in the cookie itself. This builds a real request context containing the user id, tenant id, role, and a correlation id. A fresh MCP server instance is created for this one request, bound to that context, with the 12 allowed tools registered. When a tool is called, the tool name is checked against an explicit allowed list first. The tool then runs a real database query, always scoped to the tenant id from the context. Finally, the server writes a real audit log entry recording the tenant, the user, the tool name, the outcome, and the correlation id.

## 3. The 12 tools

get_vendor, get_risk, get_assessment, get_framework, get_control, search_controls, map_controls, get_evidence, evaluate_evidence, get_findings, get_remediation, generate_report.

All 12 read from the real database using Prisma, none rely on static or hardcoded data. The evaluate_evidence tool is deliberately analysis-only: it runs the AI evaluation and returns the result, but never creates or saves a finding record itself. Creating an actual finding stays a separate, human-reviewed action that belongs to Milestone 12, matching the required separation between read tools and write tools.

## 4. Trust boundaries

The single most important rule in this server is that role always comes from the database, never from anything the client claims.

The session cookie tells the server who is asking and which tenant they are asking about. But the actual permission level, the role, is looked up fresh on every single request from the real TenantMembership table, never read from the cookie itself. This means even a tampered or forged cookie claiming admin cannot grant elevated access if the real membership record says otherwise.

This was proven with a live test that tampered a real session cookie to claim a different role, and the resolved context still correctly returned the real database role. Tenant scoping works the same way, every tool query includes the tenant id pulled from the server side context, never from anything supplied in the tool call arguments.

## 5. Prompt injection defenses

Two concrete defenses are in place. First, tool allowlisting: an explicit list of allowed tool names is checked before any tool logic runs. A request for any tool name outside this list is denied and audited, rather than silently falling through. Second, untrusted content delimiting: evidence document text is treated as untrusted data, not instructions. Before evidence text is sent to the AI model, it is checked with the same injection detection function already proven in Milestone 10 AI Assistant, reused directly rather than reimplemented, so both parts of the system share one tested defense.

## 6. Live tested evidence

Six passing automated tests prove the authentication boundary rejects requests with no session, a malformed session, and a forged session with no real database membership, and correctly assigns a unique correlation id to every request. A real tool call was also confirmed to produce a matching real audit log entry in the live database, containing the tool name, the outcome, and the correlation id.

## 7. Known security risks and how they are addressed

Cross tenant data leakage is addressed by scoping every query to the tenant id from the verified server side context. A forged or stale session cookie is addressed by always re-reading the current role from the database on every request. Prompt injection through uploaded evidence is addressed by treating evidence text as untrusted content and screening it before it reaches the AI model. A known limitation not yet addressed is full schema validation on tool inputs, which the original specification calls for. Tools currently use plain JSON schemas with manual casting, matching the pattern already used by the pre-existing tools. This is a real, tracked gap, not something glossed over.

## 8. Deferred dependency risk

The mcp-server depends on Fastify 4.28.1, which has 4 known security advisories including one high severity Content-Type validation bypass. The fix requires upgrading to Fastify 5, a major version change affecting apps/api as well, not a safe patch-version bump. This is deliberately deferred to the master plan Phase 4 dependency vulnerability scan rather than fixed here, and an explicit, documented exception is configured in the dependency review workflow in the meantime.
