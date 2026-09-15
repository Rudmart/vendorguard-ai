# VendorGuard AI - Pre-Public Security Review and Hardening

Status: SAVED FOR LATER - not yet started as of this note.
Reminder trigger: Claude should flag this file before starting any new
security-focused work, per user request, so this review is done
deliberately rather than started by accident.

Already covered by prior polish work (Phase 4A Items 2, 3, 5) and can be
used as a starting point/comparison when this review is actually run:
- Section 3 (RBAC/Authorization) for the main API - 14 gaps found and fixed
- Section 4 (Multi-tenant isolation) - 14 gaps found and fixed (9 original + 5 found during RBAC work)
- Section 11 (MCP security) - audited, found clean, 4 end-to-end regression tests added

Genuinely unreviewed sections as of this note: 2, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16.

---

Act as a Senior Application Security Engineer, Cloud Security Architect, and SaaS Security Reviewer.

VendorGuard AI is moving from a private learning/development lab toward an application that other people may be allowed to use.

Your job is to perform a complete security review of the EXISTING VendorGuard AI codebase and architecture, identify real weaknesses, and safely remediate confirmed security problems.

## IMPORTANT RULE

Do not redesign the application.

Do not add security features simply because they sound useful.

Do not replace working security controls without evidence that they are inadequate.

Follow this process:

DISCOVER then VERIFY then FIND then PRIORITIZE then MITIGATE then TEST then DOCUMENT

Preserve all existing working functionality.

---

# 1. FIRST: UNDERSTAND THE EXISTING APPLICATION

Before changing code, inspect the entire repository and document the current architecture.

VendorGuard currently includes technologies/features such as:

- Next.js frontend
- Fastify API
- PostgreSQL
- Prisma
- Multi-tenant architecture
- Authentication
- RBAC
- Audit logging
- Evidence/file uploads
- Vendor management
- Assessments
- Framework controls
- Findings
- Remediation
- Reports
- Human approval workflows
- AI Assistant
- MCP server

Do not assume any control is missing.

Search the repository and determine what security protections already exist.

Create: SECURITY_REVIEW.md

Document:

- Existing security controls
- Security weaknesses
- Missing controls
- Misconfigured controls
- Controls that exist but are not consistently enforced

---

# 2. AUTHENTICATION SECURITY

Review the complete authentication system.

Check for:

- secure password storage/hashing
- login protections
- brute-force protection
- credential-stuffing resistance
- session security
- session expiration
- secure cookies
- HttpOnly
- Secure
- SameSite
- token validation
- logout invalidation
- password reset security, if implemented
- account enumeration
- authentication bypasses
- session fixation
- stolen/replayed tokens

Verify that protected routes cannot be reached without valid authentication.

If weaknesses exist, remediate them.

Do not break the current login flow.

---

# 3. AUTHORIZATION / RBAC

Authentication does NOT equal authorization.

Review every sensitive API route.

Verify that authorization is enforced by the backend and not merely hidden in the frontend.

Review permissions for:

- vendors
- assessments
- controls
- evidence
- findings
- remediation
- reports
- reviews
- risk acceptance
- administration
- AI functionality
- MCP functionality

Look specifically for IDOR/BOLA vulnerabilities where a user can modify a URL, object ID, API request, or request body and gain access to another resource.

Test unauthorized:

READ, CREATE, UPDATE, DELETE, APPROVE, REJECT, DOWNLOAD, EXPORT

Fix any missing backend authorization.

---

# 4. MULTI-TENANT ISOLATION - CRITICAL

VendorGuard is multi-tenant.

Perform an aggressive tenant-isolation review.

Create at least: Tenant A, Tenant B

Attempt to access Tenant B's resources while authenticated as Tenant A.

Test:

- vendors
- assessments
- controls
- evidence
- findings
- remediation
- reports
- reviews
- audit records
- AI agents if present
- uploaded files

Attempt: GET, POST, PATCH, PUT, DELETE, DOWNLOAD, APPROVE

Manipulate IDs and request bodies.

The tenant identity must come from trusted authenticated server-side context whenever possible, not from a client-controlled tenant ID.

A user from Tenant A must NEVER be able to access Tenant B's information.

Treat any cross-tenant exposure as CRITICAL.

---

# 5. MULTIPLE USERS / CONCURRENCY

VendorGuard must safely support multiple legitimate users at the same time.

Do NOT solve this by preventing multiple people from using the application.

Test scenarios where User A and User B are logged in simultaneously.

Verify:

- sessions remain separate
- user identity never crosses sessions
- tenant identity remains isolated
- one user's data does not appear in another user's session
- simultaneous database writes remain consistent
- duplicate form submissions do not create unintended records
- approvals cannot accidentally execute twice
- updates do not silently overwrite important changes
- race conditions do not corrupt governance records

Pay particular attention to Human Review.

Example: Reviewer A and Reviewer B open the same pending finding. Reviewer A approves it. Reviewer B attempts another final decision using stale data. The application must handle this safely.

For governance decisions, use appropriate transactions, uniqueness constraints, optimistic concurrency, idempotency, or conflict responses where necessary.

Do not introduce unnecessary complexity.

---

# 6. API SECURITY

Review every API endpoint.

Test for:

- missing authentication
- missing authorization
- IDOR/BOLA
- mass assignment
- parameter tampering
- injection
- malformed requests
- oversized requests
- unexpected data types
- insecure error messages
- excessive information exposure
- unrestricted pagination
- unsafe query parameters
- missing validation

Use strict server-side validation.

Never trust frontend validation alone.

---

# 7. INPUT / INJECTION SECURITY

Review every location accepting user-controlled input.

Check for:

- SQL injection
- stored XSS
- reflected XSS
- command injection
- path traversal
- unsafe redirects
- unsafe HTML rendering
- template injection
- malicious filenames
- dangerous serialized data

Verify Prisma/database usage is safe and that raw queries, if any, are reviewed carefully.

Fix confirmed weaknesses.

---

# 8. FILE / EVIDENCE UPLOAD SECURITY

Evidence uploads are security-sensitive.

Review:

- allowed file types
- MIME validation
- extension validation
- file size limits
- filename sanitization
- storage paths
- path traversal
- executable files
- unauthorized downloads
- cross-tenant file access
- direct object access
- malicious content handling

Do not trust the filename or MIME type supplied by the browser.

Ensure evidence belonging to one tenant cannot be downloaded by another tenant.

If malware scanning is not currently available, document it as a deployment recommendation rather than creating a fake scanner.

---

# 9. RATE LIMITING / ABUSE / DENIAL OF SERVICE

Because the application may become publicly reachable, review protections against abuse.

Determine whether appropriate rate limits exist for:

- login
- registration if available
- password reset
- API endpoints
- uploads
- reports
- AI Assistant
- MCP
- expensive database operations

Add reasonable server-side rate limiting where necessary.

Prevent obvious resource-exhaustion attacks using sensible request-size limits, upload-size limits, pagination limits, timeouts, and rate limits.

Do not make normal lab usage frustrating.

---

# 10. AI ASSISTANT SECURITY

Review the AI Assistant separately.

Check for:

- prompt injection
- unauthorized data access
- cross-tenant information exposure
- sensitive information leakage
- unsafe tool execution
- excessive agency
- user-controlled system instructions
- insecure retrieval
- unauthorized actions

Critical principle: AI recommendations must never automatically become governance decisions.

Maintain: AI proposes, then an authorized human reviews, then the human decides.

AI must not bypass RBAC or tenant isolation.

---

# 11. MCP SECURITY

Review the MCP server and any tools exposed through it.

Determine:

- what tools are available
- who can call them
- what data they can access
- whether tenant context is enforced
- whether authentication is enforced
- whether authorization is enforced
- whether tool parameters can be manipulated
- whether MCP can indirectly bypass normal application controls

Treat MCP tools like privileged API endpoints.

The AI Assistant must not receive greater permissions simply because it uses MCP.

---

# 12. SECRETS AND CONFIGURATION

Search for exposed passwords, database credentials, API keys, JWT secrets, AI provider keys, cloud credentials, connection strings, and private tokens.

Check: source files, config files, environment files, logs, test fixtures, seed data, frontend bundles.

Secrets must not be committed or exposed to browsers.

If secrets are discovered in repository history or committed configuration, document that rotation is required.

Do not print secret values into the report.

---

# 13. HTTP / BROWSER SECURITY

Review appropriate protections including HTTPS assumptions, CORS, CSRF, Content Security Policy, security headers, clickjacking protection, MIME sniffing protection, referrer policy, and cookie configuration.

Only implement controls appropriate for the architecture.

---

# 14. ERROR HANDLING AND INFORMATION LEAKAGE

Attempt invalid and malicious requests.

The application must not expose stack traces, SQL details, internal paths, secrets, environment variables, detailed internal architecture, or sensitive user information.

Keep detailed diagnostic information server-side where appropriate.

Return safe client-facing errors.

---

# 15. LOGGING AND AUDIT SECURITY

Verify security-relevant events are logged appropriately, including authentication failures, important permission failures, governance approvals, review decisions, risk acceptance, sensitive administrative actions, and important data changes.

Audit logs must not expose secrets.

Where VendorGuard treats governance decisions as immutable history, verify users cannot silently alter that history.

---

# 16. DEPENDENCY SECURITY

Review application dependencies.

Identify known vulnerable packages, obsolete dependencies, unnecessary packages, and dangerous dependency configurations.

Upgrade vulnerable dependencies carefully.

Do not perform large dependency upgrades unless necessary.

Run regression tests after changes.

---

# 17. SECURITY TESTS

Create automated security-focused tests for critical protections.

At minimum test:

- Authentication: Unauthenticated user to protected resource, expect DENIED
- RBAC: Unauthorized role to privileged action, expect DENIED
- Tenant isolation: Tenant A to Tenant B resource, expect DENIED
- Object manipulation: User changes resource ID to unauthorized resource, expect DENIED
- Evidence: Tenant A to Tenant B evidence, expect DENIED
- Human approval: Unauthorized user to approve finding, expect DENIED
- Concurrency: Two reviewers, same final decision, handled safely
- Input validation: Malformed/malicious request, rejected safely
- Rate limiting: Excessive requests, throttled appropriately
- AI/MCP: AI or MCP to unauthorized tenant/resource, expect DENIED

---

# 18. PRIORITIZE FINDINGS

Classify findings:

CRITICAL: authentication bypass, cross-tenant access, remote code execution, exposed production secrets, authorization bypass of critical governance actions

HIGH: serious RBAC bypass, dangerous uploads, stored XSS, major AI/MCP authorization weakness, serious session weakness

MEDIUM: insufficient rate limiting, security-header problems, excessive error disclosure, moderate validation issues

LOW: hardening improvements with limited practical impact

Fix CRITICAL and HIGH issues first. Then address reasonable MEDIUM issues. Do not spend significant time on cosmetic LOW findings while important vulnerabilities remain.

---

# 19. DO NOT BREAK VENDORGUARD

Preserve the existing database architecture, multi-tenant model, authentication flow, RBAC model, audit architecture, human review model, assessment workflow, evidence workflow, remediation workflow, reporting, AI Assistant, and MCP functionality.

Make the smallest safe change necessary to mitigate each confirmed vulnerability.

Avoid unnecessary architectural rewrites.

---

# 20. FINAL DELIVERABLE

Update SECURITY_REVIEW.md with a table containing: Finding, Severity, Affected Component, Evidence, Mitigation, Status.

Status must be one of: FIXED, PARTIALLY MITIGATED, OPEN, ACCEPTED RISK, REQUIRES INFRASTRUCTURE.

Then provide a Security Review Summary covering: Critical findings discovered, High findings discovered, Medium findings discovered, Low findings discovered, Vulnerabilities fixed, Remaining risks, Tests added, Files changed.

## Public-Use Readiness

Give one conclusion: NOT READY FOR PUBLIC ACCESS, or READY FOR LIMITED LAB USERS, or READY FOR PUBLIC DEPLOYMENT.

Explain why.

Do NOT mark VendorGuard ready for public deployment simply because tests pass.

If protection depends on hosting infrastructure, CDN/WAF, cloud configuration, database configuration, TLS, backups, monitoring, malware scanning, secret management, or deployment architecture that cannot be verified from this repository, clearly state: REQUIRES DEPLOYMENT/INFRASTRUCTURE VERIFICATION.

Finally run the complete existing test suite plus the new security tests and report the results.

The objective is: Keep VendorGuard simple and educational while making it safe for multiple legitimate users and substantially harder to abuse, compromise, or take down.