# Framework Mapping Status

Last updated: August 14, 2026

This document explains, in plain terms, which compliance/regulatory frameworks VendorGuard AI currently has data for, and how that data does (or does not yet) connect to the running application. Written to be shareable - if you are explaining this project to someone, this page is the accurate, current answer.

---

## The short version

VendorGuard AI is being built to map vendor risk against multiple industry frameworks - NIST, ISO, FFIEC, GLBA, and others - so that a single vendor assessment can show compliance status across every framework that applies to it, instead of doing that work manually per framework.

Right now: the underlying data for 5 frameworks exists and is structured correctly. It is not yet connected to the live application - no API endpoint, screen, or AI Assistant currently reads it. That connection is the next major piece of work (the MCP server, described below).

---

## Framework status table

| Framework | Data exists? | Notes |
|---|---|---|
| FFIEC Outsourcing | YES | Real control data present |
| GLBA Safeguards | YES | Real control data present |
| ISO 22301 (Business Continuity) | YES | Real control data present |
| NIST 800-161 (Supply Chain Risk) | YES | Real control data present - this is the framework written specifically for third-party/vendor risk, the core purpose of this platform |
| NIST 800-66 | YES | Real control data present |
| ISO 27001:2022 | SCAFFOLDED | Folder exists, no data yet |
| NIST AI RMF | SCAFFOLDED | Folder exists, no data yet |
| NIST CSF 2.0 | SCAFFOLDED | Folder exists, no data yet |
| ISO 42001 (AI Management System) | NOT STARTED | No folder exists yet |
| SOC 2 | NOT STARTED | No folder exists yet |
| OWASP LLM Top 10 | NOT STARTED | No folder exists yet |
| NIST 800-53 | NOT STARTED | No folder exists yet |

Legend:
- YES = structured control data is written and ready to use
- SCAFFOLDED = a placeholder exists, signaling intent, but no actual content yet
- NOT STARTED = nothing exists yet for this framework

---

## Important: having the data is not the same as the app using it

This is the part that is easy to gloss over when explaining the project, so it is worth stating directly:

None of the 5 frameworks with real data are currently connected to the running application. There is no API route, no page, and no AI Assistant call that reads from the frameworks folder today. The data is correctly structured and sitting in the repository, ready to be used - but nothing in the live app queries it yet.

### Why this matters

If you are describing this project to someone, the accurate claim is:

"We have structured, real control data for 5 frameworks, including the one written specifically for third-party risk management. The next step is building the service layer (an MCP server) that actually exposes this data to the application and its AI Assistant."

Not:

"The app supports 5 compliance frameworks." (This would overstate where things stand - the app does not consume this data yet.)

---

## What connects this data to the app: the MCP server

MCP stands for Model Context Protocol - it is the mechanism by which an AI Assistant (or any other part of the app) can look up structured data on demand, rather than guessing or hallucinating.

The plan (from BUILD-PLAN-UPDATED.md, Tier 3) is for apps/mcp-server to expose functions like:
- list_frameworks() - what frameworks are available
- list_controls() - what controls exist within a framework
- get_control() - details on a specific control
- search_controls() - find controls matching a query

Once this exists, the application (and its AI Assistant) can genuinely answer questions like "Which vendors fail NIST 800-161?" by querying real data - instead of that being aspirational.

Current status of apps/mcp-server: empty folder, not started.

---

## Recommended next steps (in order)

1. Fill in the 3 scaffolded frameworks (ISO 27001:2022, NIST AI RMF, NIST CSF 2.0) - same controls.json pattern as the existing 5, low effort since the pattern is proven
2. Add ISO 42001 - genuinely relevant given this is an AI governance platform, currently has zero data
3. Build the MCP server - this is what turns "we have framework data" into "the app can actually use framework data." This is the single highest-leverage piece of remaining work, since every AI Assistant feature in the original spec depends on it existing first.

---

## Related documents

- BUILD-PLAN-UPDATED.md - full prioritized checklist for the whole project
- frameworks/*/controls.json - the actual data files referenced in this document
