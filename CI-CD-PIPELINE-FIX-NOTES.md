# CI/CD Pipeline Fix - PR Validation Never Running

**Date:** August 13, 2026

## Issue

.github/workflows/pr-validation.yml - a thorough pipeline covering lint, typecheck, tests, build, secret scanning (gitleaks), CodeQL security analysis, dependency review, and Bicep linting - had never run once, despite existing in the repo since initial setup.

## Root Cause

The workflow's trigger was:

on:
  pull_request:
    branches: [main]

This repository's default branch is master, not main. Since every PR targets master, the trigger condition never matched, and the workflow silently never fired. GitHub Actions gives no warning when a trigger condition never matches - it just never appears in the Actions history, which made this easy to miss.

How it was found: Branch protection was set up to require install-and-validate, secret-scan, and codeql status checks before merging. A real PR (#10) was opened to test the new protection rule end-to-end. The PR Checks tab stayed at 0 for 9+ minutes, prompting investigation via the Actions tab, which showed only Dependabot runs - no PR Validation runs, ever, in the repo history.

## Fix

on:
  pull_request:
    branches: [master]  # was: [main]

## Second Issue Uncovered: Real Lint Errors

Once the pipeline actually ran for the first time, it immediately caught two pre-existing lint errors in apps/web/src/app/page.tsx that had never been caught before:

44:37  error  Unexpected any. Specify a different type  no-explicit-any
64:43  error  Unexpected any. Specify a different type  no-explicit-any

Both were (vendor: any) in .map() callbacks over vendor data.

### Fix

Added a proper Vendor type based on the fields actually used in the file:

type VendorRisk = {
  band: string;
  score: number;
};

type Vendor = {
  id: string;
  legalName: string;
  serviceDescription: string;
  serviceCategory: string;
  criticality: string | null;
  risk: VendorRisk | null;
};

And replaced both vendor: any with vendor: Vendor.

Verified locally before pushing:

npm run lint    (0 errors)
npm run build   (compiles, types check, static pages generate successfully)

## Takeaway

A CI pipeline that is configured but never actually verified to run provides zero protection - it is worse than having no pipeline at all in one specific way: it creates false confidence that checks are happening when they are not. Always confirm a new workflow has actually executed (check the Actions tab) before relying on it, especially for branch protection requirements.

## Related

See AZURE-DEPLOYMENT-NOTES-SESSION4.md for the login/deployment bugs found and fixed in the same overall debugging session.
