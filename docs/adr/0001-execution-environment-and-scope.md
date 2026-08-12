# ADR 0001: Execution environment and session scope

## Status
Accepted

## Context
VendorGuard AI's full specification (32 sections) describes a production-grade
system: a three-app TypeScript monorepo, a versioned compliance framework
engine, an MCP server, Azure infrastructure as code, GitHub OIDC deployment,
and a responsible-AI evaluation harness. That is realistically weeks of
engineering work, not a single chat turn.

This build was executed inside Claude's sandboxed container tool
(claude.ai), which has:
- No GitHub connector (cannot `git push`, open PRs, or configure branch
  protection / environments against a real repository).
- No Azure connector (cannot run `az deployment group create`, configure
  OIDC federated credentials, or provision real resources).
- No Docker daemon (compose files are validated structurally, not by
  actually starting containers).
- A filesystem that does not persist across sessions.

## Decision
1. Build the largest **genuinely runnable and verifiable** vertical slice
   in this environment: monorepo tooling, environment validation with
   fail-closed production checks, and the deterministic risk-scoring
   engine, each with passing unit tests and clean typechecks actually
   executed in this session (not merely written).
2. Every remaining phase from the specification is tracked precisely in
   `ROADMAP.md`, in the same order and detail as the original spec, so
   no requirement is silently dropped.
3. GitHub Actions workflows and Bicep modules are scaffolded with explicit
   `if: false` guards or placeholder comments where they depend on
   artifacts (Dockerfiles, deployed infra) that don't exist yet, so the
   repository is honest about what is wired vs. what is a documented plan.
4. This repository should be handed to **Claude Code** (or a human
   engineer) running against a real cloned GitHub repo with `gh` and `az`
   CLIs authenticated, to execute Phases 2 (remainder) through 9 with
   real commits, PRs, CI runs, and `az` deployments.

## Consequences
- Positive: nothing in this repository claims to work that wasn't actually
  executed and observed passing (per spec §29-30, "never claim a command
  passed unless you ran it").
- Positive: the scope is honestly bounded, so it's a credible portfolio
  artifact rather than an unverifiable wall of generated code.
- Negative: full MVP completion criteria (§30) are not met by this session
  alone and require continued work in a connected dev environment.
