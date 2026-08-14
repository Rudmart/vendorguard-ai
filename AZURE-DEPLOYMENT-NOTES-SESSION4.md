# Session 4 - Login Bug: Root Cause Analysis & Fixes

**Date:** August 13, 2026
**Symptom:** Login form submits successfully (200 response), but the app always bounces back to /login instead of showing the dashboard.

---

## Summary

Three separate, real bugs were found and fixed. All three had been latent in the deployment setup and only surfaced because this was the first full rebuild since the API's dependencies changed.

| # | Bug | File(s) | Fix |
|---|-----|---------|-----|
| 1 | Session cookie scoped to API's subdomain only, invisible to the web server on a different subdomain | apps/api/src/auth-routes.ts | Added domain scoping to the shared parent domain |
| 2 | Deploy package.json was missing fastify, @fastify/cors, @fastify/cookie - container crash-looped on startup | apps/api/dist/package.json | Added the missing dependencies |
| 3 | Compiled index.js still had unresolved import statements for internal workspace packages that do not exist outside the monorepo | apps/api/package.json (new bundle script) | Added an esbuild bundling step |

---

## Root Cause #1: Cross-Domain Cookie Scoping

**Symptom:** Cookie was set correctly by the API (confirmed via Set-Cookie header, correct SameSite=None; Secure; HttpOnly), and the browser did store it - but the web server Next.js Server Component (apps/web/src/app/page.tsx) could never see it.

**Why:** vg_session was scoped to vendorguard-api-container...azurecontainerapps.io by default. The web app runs on a different subdomain (vendorguard-web-container...). Server Components only see cookies sent to their own domain - the API's cookie was invisible to it.

**Fix:** apps/api/src/auth-routes.ts - added domain: ".delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io" to the setCookie options.

Both vendorguard-web-container... and vendorguard-api-container... share this parent domain, so scoping the cookie there makes it visible to both.

**Diagnostic tools built to find this:**
- diagnose_login.py - tests health, CORS preflight, login, and session check against the live API using Python requests
- browser_login_test.py - uses Playwright to drive a real Chrome browser and check what the browser actually does with the cookie

---

## Root Cause #2: Missing Dependencies in Deploy package.json

Discovered while checking why the first redeploy (cookie-fix-v3) went into a crash loop.

**Symptom:** Container app showed runningState: "ActivationFailed", "1/1 Container crashing".

**Root cause:** apps/api/dist/package.json (the standalone deploy manifest) only listed @prisma/client as a dependency. fastify and the fastify plugins were missing entirely, so npm install --production inside the Docker build only installed 1 package instead of the ~56 actually needed.

**Fix:** Added the missing dependencies to apps/api/dist/package.json:
dependencies: @prisma/client 5.20.0, fastify 4.28.1, @fastify/cors 8, @fastify/cookie 9

**How we found it:** Queried Azure Log Analytics directly for container console logs. Found: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'fastify' imported from /app/index.js

---

## Root Cause #3: Workspace Packages Not Bundled

After fixing #2, the container started but still crashed with a different error.

**Symptom:** Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@vendorguard/database' imported from /app/index.js

**Root cause:** The dist/index.js shipped to the deploy folder was produced by plain tsc compilation, which preserves import statements as-is. Internal workspace packages (@vendorguard/database, @vendorguard/risk-engine, etc.) are not published to npm - they only exist inside the monorepo's node_modules symlinks. Once copied into a standalone deploy folder, those imports cannot resolve.

**Fix:** Added a proper esbuild bundling script in apps/api/package.json:
"bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js --external:@prisma/client --external:fastify --external:@fastify/cors --external:@fastify/cookie"

Result: bundle size went from ~1KB (broken, plain-compiled) to ~123KB (correctly bundled with workspace code inlined).

---

## Deployment Process Used (Manual - see note below)

# 1. Compile + bundle
cd apps/api
npm run build
npm run bundle

# 2. Build and push Docker image via ACR Tasks (no local Docker needed)
az acr build --registry ca8c9cc7f33bacr --image vendorguard-api-container:cookie-fix-v5 --file dist\Dockerfile dist

# 3. Deploy to Container App
az containerapp update --name vendorguard-api-container --resource-group vendorguard-prod-rg --image ca8c9cc7f33bacr.azurecr.io/vendorguard-api-container:cookie-fix-v5

# 4. Verify health
az containerapp revision list --name vendorguard-api-container --resource-group vendorguard-prod-rg -o table

**Known gap:** This entire process is manual. There is no CI/CD pipeline yet - every one of the three bugs above went undetected until a human manually deployed and manually checked logs. A GitHub Actions workflow that runs build + bundle + a container smoke test on every push would have caught bugs #2 and #3 automatically, before they ever reached the live site. This is the next priority.

---

## Repo Inventory (as of this session)

**Built and working:**
- Auth (login/logout, sessions, multi-tenant tenantId, roles)
- Vendor CRUD (list + add confirmed; detail/edit/delete not yet confirmed)
- Risk scoring engine (packages/risk-engine, 6-factor calculateInherentRisk())
- Database (Postgres/Prisma)
- 5 real framework datasets with populated controls.json: FFIEC Outsourcing, GLBA Safeguards, ISO 22301, NIST 800-161, NIST 800-66
- Docker + Azure Container Apps deployment (manual, now confirmed working)

**Scaffolded but empty (folders exist, no files inside):**
- apps/mcp-server - no MCP server implementation yet
- evaluations/ (compliance-accuracy, golden-dataset, prompt-injection) - no eval scripts or test data
- infrastructure/ (environments, modules, policies) - no Bicep/Terraform; deploys are fully manual

---

## New Diagnostic Tools Added This Session

- diagnose_login.py - HTTP-level diagnostic (health, CORS, login, session) against the live API
- browser_login_test.py - Playwright-based real-browser test (catches cookie/redirect behavior that HTTP-only tools miss)
- .dockerignore - excludes node_modules, .git, dist, env files from Docker build context
