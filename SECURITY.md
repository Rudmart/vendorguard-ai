# Security Policy

## Project status
VendorGuard AI is a **portfolio project** demonstrating secure architecture
patterns for AI-powered enterprise software. It is not currently deployed
as a production service. See `ROADMAP.md` for build status.

## Supported versions
Only the `main` branch is supported. There are no released versions yet.

## Reporting a vulnerability
This is a portfolio repository without a live deployment or user data at
risk. If you find a security issue in the code or infrastructure templates,
please open a private GitHub Security Advisory on the repository rather than
a public issue.

## Secure development expectations
- No real credentials, connection strings, or API keys are ever committed.
  `.env` is git-ignored; only `.env.example` (placeholder values) is tracked.
- No real vendor documents or personal data are used anywhere in seed data,
  fixtures, or demo evidence — all seeded evidence is synthetic.
- Environment loading fails closed: production-mode services refuse to start
  with development auth, the fake AI provider, non-Azure storage, or sample
  secrets (`packages/shared/src/env.ts`, enforced by tests).
- All authorization decisions are enforced server-side; a hidden UI button
  is never treated as an authorization control.
- Dependency and container vulnerabilities are tracked via Dependabot and
  (once containers exist) CI-integrated scanning — see `ROADMAP.md` Phase 8.

## Demo environments
Any future hosted demo of this project will use synthetic data only and
will be clearly labeled as a non-production demonstration environment.
