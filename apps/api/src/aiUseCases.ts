/**
 * AI Use Cases V1 - HOW and WHY an AI system is used.
 *
 * AI Inventory answers "what AI system exists"; an AiUseCase answers "how and why it is used".
 * One AiSystem has many AiUseCases. Risk and Impact Assessments stay at the AiSystem level in V1:
 * a use case is business context only and never writes to assessments or system classification.
 *
 * Lifecycle (V1): DRAFT -> PENDING_REVIEW (submit) -> APPROVED (human review),
 *                 PENDING_REVIEW -> DRAFT when the review is REJECTED or CHANGES_REQUESTED.
 *                 SUSPENDED / RETIRED exist in the enum only; their transitions are not built.
 * Status and review fields are server-controlled and can never be PATCHed by a client.
 *
 * RBAC: read = ai-system:read; create / edit / submit = ai-system:update; review = ai-use-case:review
 * (ADMIN, REVIEWER). Separation of duties: the reviewer can be neither the creator nor the business
 * owner, and an owner must exist. Fail closed; denied review attempts are audited as DENIED.
 * AI ASSISTS. HUMANS GOVERN. - there is no AI / MCP path that approves a use case.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { AFFECTED_POPULATIONS } from "@vendorguard/shared";
import { sessionOf, hasPermission, cleanText, audit, type Session } from "./aiControlEvidence.js";

export const USE_CASE_STATUSES = ["DRAFT", "PENDING_REVIEW", "APPROVED", "SUSPENDED", "RETIRED"] as const;
export const USE_CASE_DECISION_ROLES = ["ADVISORY", "RECOMMENDS", "DECIDES", "EXECUTES"] as const;
export const USE_CASE_HUMAN_OVERSIGHT = ["REQUIRED", "OPTIONAL", "NOT_APPLICABLE"] as const;
export const USE_CASE_DATA_SENSITIVITY = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export const USE_CASE_REVIEW_DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;

/** Fields a client may never set directly - the server owns tenancy, parentage, lifecycle and review. */
export const PROTECTED_FIELDS = [
  "id",
  "tenantId",
  "aiSystemId",
  "status",
  "createdByUserId",
  "submittedAt",
  "reviewerUserId",
  "reviewDecision",
  "reviewRationale",
  "reviewedAt",
  "createdAt",
  "updatedAt",
] as const;

const TEXT_LIMITS = { name: 200, businessPurpose: 4000, description: 4000, department: 200, intendedUsers: 1000 } as const;
const RATIONALE_MAX = 4000;
const USER_SELECT = { id: true, displayName: true, email: true } as const;
const INCLUDE = {
  aiSystem: { select: { id: true, name: true, lifecycleStatus: true } },
  owner: { select: USER_SELECT },
  createdBy: { select: USER_SELECT },
  reviewer: { select: USER_SELECT },
} as const;

type DecisionRole = (typeof USE_CASE_DECISION_ROLES)[number];
type HumanOversight = (typeof USE_CASE_HUMAN_OVERSIGHT)[number];
type DataSensitivity = (typeof USE_CASE_DATA_SENSITIVITY)[number];

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Owner must be a member of the caller's tenant (cross-tenant owner assignment -> 400). */
async function isTenantMember(tenantId: string, userId: string): Promise<boolean> {
  const membership = await prisma.tenantMembership.findFirst({ where: { userId, tenantId }, select: { userId: true } });
  return membership !== null;
}

function parseAffectedParties(value: unknown): string[] | "invalid" {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((v) => !isOneOf(AFFECTED_POPULATIONS, v))) {
    return "invalid";
  }
  return Array.from(new Set(value as string[]));
}

/** Optional free text: undefined = not supplied, null/"" = clear, otherwise trimmed + length-checked. */
function optionalText(body: Record<string, unknown>, field: keyof typeof TEXT_LIMITS): { ok: true; value: string | null | undefined } | { ok: false } {
  if (!(field in body)) {
    return { ok: true, value: undefined };
  }
  const raw = body[field];
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, value: null };
  }
  const value = cleanText(raw, TEXT_LIMITS[field]);
  return value ? { ok: true, value } : { ok: false };
}

/** Optional enum: undefined = not supplied, null/"" = clear, otherwise must be a listed value. */
function optionalEnum<T extends string>(body: Record<string, unknown>, field: string, list: readonly T[]): { ok: true; value: T | null | undefined } | { ok: false } {
  if (!(field in body)) {
    return { ok: true, value: undefined };
  }
  const raw = body[field];
  if (raw === null || raw === "") {
    return { ok: true, value: null };
  }
  return isOneOf(list, raw) ? { ok: true, value: raw } : { ok: false };
}

/** What still blocks submission. Empty array = ready for human review. */
export function missingForSubmission(u: { ownerUserId: string | null; businessPurpose: string | null; decisionRole: string | null; humanOversight: string | null }): string[] {
  const missing: string[] = [];
  if (!u.ownerUserId) missing.push("owner");
  if (!u.businessPurpose || u.businessPurpose.trim() === "") missing.push("businessPurpose");
  if (!u.decisionRole) missing.push("decisionRole");
  if (!u.humanOversight) missing.push("humanOversight");
  return missing;
}

async function loadUseCase(id: string, tenantId: string) {
  return prisma.aiUseCase.findFirst({ where: { id, tenantId }, include: INCLUDE });
}

function deniedReview(session: Session, id: string, reason: string) {
  return audit(session, "ai_use_case.review_denied", "AiUseCase", id, { reason }, "DENIED");
}

export async function registerAiUseCaseRoutes(app: FastifyInstance): Promise<void> {
  // 1. Tenant-wide list (filters: aiSystemId, status). Reviewers locate work with status=PENDING_REVIEW.
  app.get("/ai-use-cases", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view AI use cases" });
    }
    const query = (request.query ?? {}) as { aiSystemId?: string; status?: string };
    if (query.status !== undefined && query.status !== "" && !isOneOf(USE_CASE_STATUSES, query.status)) {
      return reply.status(400).send({ error: "status must be one of: " + USE_CASE_STATUSES.join(", ") });
    }
    const useCases = await prisma.aiUseCase.findMany({
      where: {
        tenantId: session.tenantId,
        ...(query.aiSystemId ? { aiSystemId: query.aiSystemId } : {}),
        ...(query.status ? { status: query.status as (typeof USE_CASE_STATUSES)[number] } : {}),
      },
      include: INCLUDE,
      orderBy: { updatedAt: "desc" },
    });
    return reply.send({ useCases });
  });

  // 2. Use cases of one AI system (parent tenant-checked: cross-tenant -> 404).
  app.get("/ai-systems/:id/use-cases", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view AI use cases" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true, name: true } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const useCases = await prisma.aiUseCase.findMany({
      where: { tenantId: session.tenantId, aiSystemId: aiSystem.id },
      include: INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return reply.send({ aiSystem, useCases });
  });

  // 3. Create a DRAFT use case under an AI system. Server sets tenant, parent, status and creator.
  app.post("/ai-systems/:id/use-cases", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to create AI use cases" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = cleanText(body.name, TEXT_LIMITS.name);
    const businessPurpose = cleanText(body.businessPurpose, TEXT_LIMITS.businessPurpose);
    if (!name || !businessPurpose) {
      return reply.status(400).send({ error: "name (max 200) and businessPurpose (max 4000) are required" });
    }
    const description = optionalText(body, "description");
    const department = optionalText(body, "department");
    const intendedUsers = optionalText(body, "intendedUsers");
    if (!description.ok || !department.ok || !intendedUsers.ok) {
      return reply.status(400).send({ error: "description (max 4000), department (max 200) and intendedUsers (max 1000) must be text within their limits" });
    }
    const decisionRole = optionalEnum(body, "decisionRole", USE_CASE_DECISION_ROLES);
    if (!decisionRole.ok) {
      return reply.status(400).send({ error: "decisionRole must be one of: " + USE_CASE_DECISION_ROLES.join(", ") });
    }
    const humanOversight = optionalEnum(body, "humanOversight", USE_CASE_HUMAN_OVERSIGHT);
    if (!humanOversight.ok) {
      return reply.status(400).send({ error: "humanOversight must be one of: " + USE_CASE_HUMAN_OVERSIGHT.join(", ") });
    }
    const dataSensitivity = optionalEnum(body, "dataSensitivity", USE_CASE_DATA_SENSITIVITY);
    if (!dataSensitivity.ok) {
      return reply.status(400).send({ error: "dataSensitivity must be one of: " + USE_CASE_DATA_SENSITIVITY.join(", ") });
    }
    const affectedParties = parseAffectedParties(body.affectedParties);
    if (affectedParties === "invalid") {
      return reply.status(400).send({ error: "affectedParties must be a list of: " + AFFECTED_POPULATIONS.join(", ") });
    }
    let ownerUserId: string | null = null;
    if (body.ownerUserId !== undefined && body.ownerUserId !== null && body.ownerUserId !== "") {
      if (typeof body.ownerUserId !== "string" || !(await isTenantMember(session.tenantId, body.ownerUserId))) {
        return reply.status(400).send({ error: "ownerUserId must belong to a user in this tenant" });
      }
      ownerUserId = body.ownerUserId;
    }
    const created = await prisma.aiUseCase.create({
      data: {
        tenantId: session.tenantId,
        aiSystemId: aiSystem.id,
        name,
        businessPurpose,
        description: description.value ?? null,
        department: department.value ?? null,
        intendedUsers: intendedUsers.value ?? null,
        affectedParties,
        decisionRole: (decisionRole.value as DecisionRole | null | undefined) ?? null,
        humanOversight: (humanOversight.value as HumanOversight | null | undefined) ?? null,
        dataSensitivity: (dataSensitivity.value as DataSensitivity | null | undefined) ?? null,
        ownerUserId,
        status: "DRAFT",
        createdByUserId: session.userId,
      },
      include: INCLUDE,
    });
    await audit(session, "ai_use_case.created", "AiUseCase", created.id, { aiSystemId: aiSystem.id, ownerUserId });
    return reply.status(201).send(created);
  });

  // 4. Detail.
  app.get("/ai-use-cases/:id", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view AI use cases" });
    }
    const { id } = request.params as { id: string };
    const useCase = await loadUseCase(id, session.tenantId);
    if (!useCase) {
      return reply.status(404).send({ error: "AI use case not found" });
    }
    return reply.send({ ...useCase, missingForSubmission: missingForSubmission(useCase) });
  });

  // 5. Edit a DRAFT. PENDING_REVIEW / APPROVED (and any other state) -> 409. Protected fields -> 400.
  app.patch("/ai-use-cases/:id", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to edit AI use cases" });
    }
    const { id } = request.params as { id: string };
    const existing = await prisma.aiUseCase.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: "AI use case not found" });
    }
    if (existing.status !== "DRAFT") {
      return reply.status(409).send({ error: "Only a DRAFT use case can be edited" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const protectedSent = PROTECTED_FIELDS.filter((field) => field in body);
    if (protectedSent.length > 0) {
      return reply.status(400).send({ error: `These fields are controlled by VendorGuard and cannot be changed directly: ${protectedSent.join(", ")}` });
    }
    const data: {
      name?: string;
      businessPurpose?: string;
      description?: string | null;
      department?: string | null;
      intendedUsers?: string | null;
      affectedParties?: string[];
      decisionRole?: DecisionRole | null;
      humanOversight?: HumanOversight | null;
      dataSensitivity?: DataSensitivity | null;
      ownerUserId?: string | null;
    } = {};
    for (const field of ["name", "businessPurpose"] as const) {
      if (field in body) {
        const value = cleanText(body[field], TEXT_LIMITS[field]);
        if (!value) {
          return reply.status(400).send({ error: `${field} cannot be empty (max ${TEXT_LIMITS[field]} characters)` });
        }
        data[field] = value;
      }
    }
    for (const field of ["description", "department", "intendedUsers"] as const) {
      const parsed = optionalText(body, field);
      if (!parsed.ok) {
        return reply.status(400).send({ error: `${field} must be text (max ${TEXT_LIMITS[field]} characters)` });
      }
      if (parsed.value !== undefined) {
        data[field] = parsed.value;
      }
    }
    const decisionRole = optionalEnum(body, "decisionRole", USE_CASE_DECISION_ROLES);
    const humanOversight = optionalEnum(body, "humanOversight", USE_CASE_HUMAN_OVERSIGHT);
    const dataSensitivity = optionalEnum(body, "dataSensitivity", USE_CASE_DATA_SENSITIVITY);
    if (!decisionRole.ok || !humanOversight.ok || !dataSensitivity.ok) {
      return reply.status(400).send({ error: "Invalid decisionRole, humanOversight or dataSensitivity" });
    }
    if (decisionRole.value !== undefined) data.decisionRole = decisionRole.value as DecisionRole | null;
    if (humanOversight.value !== undefined) data.humanOversight = humanOversight.value as HumanOversight | null;
    if (dataSensitivity.value !== undefined) data.dataSensitivity = dataSensitivity.value as DataSensitivity | null;
    if ("affectedParties" in body) {
      const parties = parseAffectedParties(body.affectedParties);
      if (parties === "invalid") {
        return reply.status(400).send({ error: "affectedParties must be a list of: " + AFFECTED_POPULATIONS.join(", ") });
      }
      data.affectedParties = parties;
    }
    if ("ownerUserId" in body) {
      if (body.ownerUserId === null || body.ownerUserId === "") {
        data.ownerUserId = null;
      } else if (typeof body.ownerUserId !== "string" || !(await isTenantMember(session.tenantId, body.ownerUserId))) {
        return reply.status(400).send({ error: "ownerUserId must belong to a user in this tenant" });
      } else {
        data.ownerUserId = body.ownerUserId;
      }
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    // Race-safe: only applies while the record is still DRAFT in this tenant.
    const result = await prisma.aiUseCase.updateMany({ where: { id: existing.id, tenantId: session.tenantId, status: "DRAFT" }, data });
    if (result.count === 0) {
      return reply.status(409).send({ error: "Only a DRAFT use case can be edited" });
    }
    const ownerChanged = data.ownerUserId !== undefined && data.ownerUserId !== existing.ownerUserId;
    const fields = Object.keys(data).filter((k) => k !== "ownerUserId" || ownerChanged);
    if (ownerChanged) {
      await audit(session, "ai_use_case.owner_changed", "AiUseCase", existing.id, { from: existing.ownerUserId, to: data.ownerUserId ?? null });
    }
    if (fields.some((k) => k !== "ownerUserId")) {
      await audit(session, "ai_use_case.updated", "AiUseCase", existing.id, { fields: fields.filter((k) => k !== "ownerUserId").join(",") });
    }
    const updated = await loadUseCase(existing.id, session.tenantId);
    return reply.send(updated ? { ...updated, missingForSubmission: missingForSubmission(updated) } : null);
  });

  // 6. Submit for human review: DRAFT -> PENDING_REVIEW (owner, purpose, decision role, oversight required).
  app.post("/ai-use-cases/:id/submit", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to submit AI use cases" });
    }
    const { id } = request.params as { id: string };
    const existing = await prisma.aiUseCase.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: "AI use case not found" });
    }
    if (existing.status !== "DRAFT") {
      return reply.status(409).send({ error: "Only a DRAFT use case can be submitted for review" });
    }
    const missing = missingForSubmission(existing);
    if (missing.length > 0) {
      return reply.status(400).send({ error: `Before submitting, complete: ${missing.join(", ")}`, missing });
    }
    const result = await prisma.aiUseCase.updateMany({
      where: { id: existing.id, tenantId: session.tenantId, status: "DRAFT" },
      data: { status: "PENDING_REVIEW", submittedAt: new Date() },
    });
    if (result.count === 0) {
      return reply.status(409).send({ error: "Only a DRAFT use case can be submitted for review" });
    }
    await audit(session, "ai_use_case.submitted", "AiUseCase", existing.id, { aiSystemId: existing.aiSystemId });
    return reply.send(await loadUseCase(existing.id, session.tenantId));
  });

  // 7. Human review: PENDING_REVIEW -> APPROVED, or back to DRAFT (REJECTED / CHANGES_REQUESTED).
  app.post("/ai-use-cases/:id/review", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    const { id } = request.params as { id: string };
    if (!hasPermission(session, "ai-use-case:review")) {
      await deniedReview(session, id, "missing_permission");
      return reply.status(403).send({ error: "Not authorized to review AI use cases" });
    }
    const existing = await prisma.aiUseCase.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: "AI use case not found" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!isOneOf(USE_CASE_REVIEW_DECISIONS, body.decision)) {
      return reply.status(400).send({ error: "decision must be one of: " + USE_CASE_REVIEW_DECISIONS.join(", ") });
    }
    const rationale = cleanText(body.rationale, RATIONALE_MAX);
    if (!rationale) {
      return reply.status(400).send({ error: "rationale is required (max 4000 characters)" });
    }
    if (existing.status !== "PENDING_REVIEW") {
      await deniedReview(session, existing.id, existing.status === "APPROVED" ? "already_approved" : "not_pending_review");
      return reply.status(409).send({ error: "Only a use case that is pending review can be reviewed. An approved decision cannot be overwritten." });
    }
    if (!existing.ownerUserId) {
      await deniedReview(session, existing.id, "no_owner_assigned");
      return reply.status(403).send({ error: "Review cannot proceed because no business owner is assigned." });
    }
    if (existing.createdByUserId === session.userId) {
      await deniedReview(session, existing.id, "self_review");
      return reply.status(403).send({ error: "Separation of duties: you cannot review a use case you created" });
    }
    if (existing.ownerUserId === session.userId) {
      await deniedReview(session, existing.id, "owner_review");
      return reply.status(403).send({ error: "Separation of duties: the business owner cannot review their own use case" });
    }
    const decision = body.decision;
    const newStatus = decision === "APPROVED" ? "APPROVED" : "DRAFT";
    // Conditional update re-checks state AND separation of duties at decision time (race-safe, fail closed).
    const result = await prisma.aiUseCase.updateMany({
      where: {
        id: existing.id,
        tenantId: session.tenantId,
        status: "PENDING_REVIEW",
        createdByUserId: { not: session.userId },
        ownerUserId: { not: session.userId },
        NOT: { ownerUserId: null },
      },
      data: {
        status: newStatus,
        reviewerUserId: session.userId,
        reviewDecision: decision,
        reviewRationale: rationale,
        reviewedAt: new Date(),
      },
    });
    if (result.count === 0) {
      await deniedReview(session, existing.id, "state_changed");
      return reply.status(409).send({ error: "This use case changed while you were reviewing it. Reload and try again." });
    }
    await audit(session, "ai_use_case.review_recorded", "AiUseCase", existing.id, { decision, status: newStatus });
    return reply.send(await loadUseCase(existing.id, session.tenantId));
  });
}
