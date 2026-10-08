/** Manual AI incident governance. No autonomous response or evidence-file access. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma, type Prisma, type AiIncident } from "@vendorguard/database";
import {
  sessionOf,
  hasPermission,
  cleanText,
  parseOptionalDate,
  audit,
  type Session,
} from "./aiControlEvidence.js";
import { snapshotOf } from "./aiReassessments.js";
import { roleHasPermission } from "@vendorguard/shared";

export const INCIDENT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_REVIEW",
  "CLOSED",
] as const;
export const INCIDENT_SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
const DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
const TEXT_FIELDS = [
  "title",
  "description",
  "investigationSummary",
  "responseSummary",
  "followUpPlan",
  "closureRationale",
] as const;
const USER = { id: true, displayName: true } as const;
const INCLUDE = {
  aiSystem: { select: { id: true, name: true } },
  aiUseCase: { select: { id: true, name: true } },
  owner: { select: USER },
  reporter: { select: USER },
} as const;
class IncidentError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new IncidentError(status, message);
}
function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}
function bodyOf(request: FastifyRequest): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
}
function text(value: unknown, max = 4000): string {
  return (
    cleanText(value, max) ??
    fail(400, `Required text must be nonempty and at most ${max} characters`)
  );
}
async function load(id: string, tenantId: string) {
  return (
    (await prisma.aiIncident.findFirst({ where: { id, tenantId } })) ??
    fail(404, "Incident not found")
  );
}
async function member(
  tenantId: string,
  value: unknown,
  requireEligible = false,
): Promise<string | null> {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string") fail(400, "Invalid owner");
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId, userId: value },
  });
  if (!membership) fail(404, "Owner not found in tenant");
  if (
    requireEligible &&
    !roleHasPermission(membership.role, "ai-system:update")
  )
    fail(400, "Owner must have incident update permission");
  return value;
}
async function validateContext(
  tenantId: string,
  aiSystemId: string,
  b: Record<string, unknown>,
) {
  for (const field of ["aiUseCaseId", "monitoringReviewId"] as const) {
    const id = b[field];
    if (id === undefined || id === null || id === "") continue;
    if (typeof id !== "string") fail(400, `Invalid ${field}`);
    const found =
      field === "aiUseCaseId"
        ? await prisma.aiUseCase.findFirst({
            where: { id, tenantId, aiSystemId },
          })
        : await prisma.aiMonitoringReview.findFirst({
            where: { id, tenantId, check: { tenantId, aiSystemId } },
          });
    if (!found) fail(404, `${field} not found for this system`);
  }
}
function editable(i: AiIncident) {
  if (i.status !== "OPEN" && i.status !== "IN_PROGRESS")
    fail(409, "Incident is locked while pending review or closed");
}
function revision(i: AiIncident, b: Record<string, unknown>) {
  if (!Number.isInteger(b.revision) || (b.revision as number) < 0)
    fail(400, "revision is required");
  if (b.revision !== i.revision)
    fail(409, "Incident changed; reload before continuing");
}
async function txAudit(
  tx: Prisma.TransactionClient,
  s: Session,
  id: string,
  action: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditEvent.create({
    data: {
      tenantId: s.tenantId,
      actorUserId: s.userId,
      action: `ai_incident.${action}`,
      targetType: "AiIncident",
      targetId: id,
      outcome: "SUCCESS",
      metadataJson: metadata,
    },
  });
}
async function mutate(
  tx: Prisma.TransactionClient,
  s: Session,
  i: AiIncident,
  data: Prisma.AiIncidentUncheckedUpdateManyInput,
) {
  const changed = await tx.aiIncident.updateMany({
    where: {
      id: i.id,
      tenantId: s.tenantId,
      revision: i.revision,
      status: i.status,
      ownerUserId: i.ownerUserId,
      reporterUserId: i.reporterUserId,
      closureSubmitterUserId: i.closureSubmitterUserId,
    },
    data: { ...data, revision: { increment: 1 } },
  });
  if (!changed.count) fail(409, "Incident changed; reload before continuing");
}
async function detail(i: AiIncident, s: Session) {
  const canEvidence =
    hasPermission(s, "evidence:read") ||
    hasPermission(s, "evidence:read-metadata");
  return prisma.aiIncident.findFirst({
    where: { id: i.id, tenantId: s.tenantId },
    include: {
      ...INCLUDE,
      reviews: {
        where: { tenantId: s.tenantId },
        orderBy: { createdAt: "asc" },
        include: { reviewer: { select: USER } },
      },
      findings: {
        where: { tenantId: s.tenantId, finding: { tenantId: s.tenantId } },
        select: {
          finding: {
            select: {
              id: true,
              title: true,
              status: true,
              severity: true,
              remediation: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  ownerUserId: true,
                },
              },
            },
          },
        },
      },
      ...(canEvidence
        ? {
            evidence: {
              where: {
                tenantId: s.tenantId,
                evidenceDocument: { tenantId: s.tenantId, deletedAt: null },
              },
              select: {
                evidenceDocument: {
                  select: {
                    id: true,
                    displayFilename: true,
                    state: true,
                    version: true,
                    expirationDate: true,
                  },
                },
              },
            },
          }
        : {}),
      reassessment: { select: { id: true, status: true, reason: true } },
      monitoringReview: {
        select: { id: true, observation: true, result: true },
      },
    },
  });
}

export async function registerAiIncidentRoutes(
  app: FastifyInstance,
): Promise<void> {
  type Handler = (r: FastifyRequest, s: Session) => Promise<unknown>;
  function route(
    method: "GET" | "POST" | "PATCH",
    url: string,
    permission: string,
    fn: Handler,
  ) {
    app.route({
      method,
      url,
      handler: async (request, reply) => {
        const s = await sessionOf(request);
        if (!s) return reply.status(401).send({ error: "Not logged in" });
        const id = (request.params as { id?: string }).id ?? "list";
        try {
          if (!hasPermission(s, permission))
            fail(403, "Not authorized for this incident operation");
          if (method === "POST" && url === "/ai-systems/:id/incidents")
            reply.code(201);
          return await fn(request, s);
        } catch (e) {
          if (e instanceof IncidentError) {
            if (e.status === 403)
              await audit(
                s,
                "ai_incident.operation_denied",
                "AiIncident",
                id,
                { operation: url, reason: e.message },
                "DENIED",
              );
            return reply.status(e.status).send({ error: e.message });
          }
          if ((e as { code?: string }).code === "P2002")
            return reply.status(409).send({
              error: "Link exists or system already has an open reassessment",
            });
          throw e;
        }
      },
    });
  }
  route("GET", "/ai-incidents", "ai-system:read", async (r, s) => {
    const q = r.query as Record<string, string>;
    if (q.status && !oneOf(INCIDENT_STATUSES, q.status))
      fail(400, "Invalid status");
    if (q.severity && !oneOf(INCIDENT_SEVERITIES, q.severity))
      fail(400, "Invalid severity");
    if (
      q.aiSystemId &&
      !(await prisma.aiSystem.findFirst({
        where: { id: q.aiSystemId, tenantId: s.tenantId },
      }))
    )
      fail(404, "AI system not found");
    if (q.ownerUserId) await member(s.tenantId, q.ownerUserId);
    return {
      incidents: await prisma.aiIncident.findMany({
        where: {
          tenantId: s.tenantId,
          ...(q.aiSystemId ? { aiSystemId: q.aiSystemId } : {}),
          ...(q.ownerUserId ? { ownerUserId: q.ownerUserId } : {}),
          ...(oneOf(INCIDENT_STATUSES, q.status) ? { status: q.status } : {}),
          ...(oneOf(INCIDENT_SEVERITIES, q.severity)
            ? { severity: q.severity }
            : {}),
        },
        include: INCLUDE,
        orderBy: { updatedAt: "desc" },
      }),
    };
  });
  route("GET", "/ai-systems/:id/incidents", "ai-system:read", async (r, s) => {
    const { id } = r.params as { id: string };
    const aiSystem =
      (await prisma.aiSystem.findFirst({
        where: { id, tenantId: s.tenantId },
        select: { id: true, name: true },
      })) ?? fail(404, "AI system not found");
    return {
      aiSystem,
      incidents: await prisma.aiIncident.findMany({
        where: { tenantId: s.tenantId, aiSystemId: id },
        include: INCLUDE,
        orderBy: { updatedAt: "desc" },
      }),
    };
  });
  route(
    "POST",
    "/ai-systems/:id/incidents",
    "ai-system:update",
    async (r, s) => {
      const { id } = r.params as { id: string };
      const b = bodyOf(r);
      if (
        !(await prisma.aiSystem.findFirst({
          where: { id, tenantId: s.tenantId },
        }))
      )
        fail(404, "AI system not found");
      const allowed = [
        "title",
        "description",
        "severity",
        "detectedAt",
        "occurredAt",
        "ownerUserId",
        "aiUseCaseId",
        "monitoringReviewId",
      ];
      if (Object.keys(b).some((k) => !allowed.includes(k)))
        fail(400, "Unknown or server-controlled field");
      const title = text(b.title, 200);
      const description = text(b.description);
      if (!oneOf(INCIDENT_SEVERITIES, b.severity))
        fail(400, "Invalid severity");
      const severity = b.severity;
      const detectedAt = parseOptionalDate(b.detectedAt);
      const occurredAt = parseOptionalDate(b.occurredAt);
      if (
        !detectedAt ||
        detectedAt === "invalid" ||
        occurredAt === "invalid" ||
        detectedAt.getTime() > Date.now() ||
        (occurredAt && occurredAt > detectedAt)
      )
        fail(
          400,
          "Valid detectedAt and occurrence at or before detection are required",
        );
      await validateContext(s.tenantId, id, b);
      const ownerUserId = await member(s.tenantId, b.ownerUserId, true);
      const incident = await prisma.$transaction(async (tx) => {
        const i = await tx.aiIncident.create({
          data: {
            tenantId: s.tenantId,
            aiSystemId: id,
            title,
            description,
            severity,
            detectedAt,
            occurredAt,
            ownerUserId,
            reporterUserId: s.userId!,
            aiUseCaseId: (b.aiUseCaseId as string) || null,
            monitoringReviewId: (b.monitoringReviewId as string) || null,
          },
        });
        await txAudit(tx, s, i.id, "created", { aiSystemId: id, ownerUserId });
        return i;
      });
      return detail(incident, s);
    },
  );
  route("GET", "/ai-incidents/:id", "ai-system:read", async (r, s) =>
    detail(await load((r.params as { id: string }).id, s.tenantId), s),
  );
  route("PATCH", "/ai-incidents/:id", "ai-system:update", async (r, s) => {
    const i = await load((r.params as { id: string }).id, s.tenantId);
    const b = bodyOf(r);
    editable(i);
    revision(i, b);
    const allowed = [
      ...TEXT_FIELDS,
      "severity",
      "ownerUserId",
      "aiUseCaseId",
      "monitoringReviewId",
      "revision",
    ];
    if (Object.keys(b).some((k) => !(allowed as readonly string[]).includes(k)))
      fail(400, "Unknown or server-controlled field");
    const data: Prisma.AiIncidentUncheckedUpdateManyInput = {};
    for (const f of TEXT_FIELDS)
      if (f in b) {
        if (f === "title" || f === "description")
          data[f] = text(b[f], f === "title" ? 200 : 4000);
        else data[f] = b[f] === null || b[f] === "" ? null : text(b[f]);
      }
    if ("severity" in b) {
      if (!oneOf(INCIDENT_SEVERITIES, b.severity))
        fail(400, "Invalid severity");
      data.severity = b.severity;
    }
    if ("ownerUserId" in b) {
      data.ownerUserId = await member(s.tenantId, b.ownerUserId, true);
      if (i.status === "IN_PROGRESS" && !data.ownerUserId)
        fail(400, "Investigation requires an owner");
    }
    await validateContext(s.tenantId, i.aiSystemId, b);
    for (const f of ["aiUseCaseId", "monitoringReviewId"] as const)
      if (f in b) data[f] = (b[f] as string) || null;
    if (!Object.keys(data).length) fail(400, "Nothing to update");
    await prisma.$transaction(async (tx) => {
      await mutate(tx, s, i, data);
      await txAudit(tx, s, i.id, "updated", {
        fields: Object.keys(data).join(","),
      });
      if ("ownerUserId" in b && b.ownerUserId !== i.ownerUserId)
        await txAudit(tx, s, i.id, "owner_changed", {
          from: i.ownerUserId,
          to: (b.ownerUserId as string) || null,
        });
      if ("severity" in b && b.severity !== i.severity)
        await txAudit(tx, s, i.id, "severity_changed", {
          from: i.severity,
          to: b.severity as string,
        });
    });
    return detail(await load(i.id, s.tenantId), s);
  });
  for (const action of ["start", "submit-closure", "review"] as const)
    route(
      "POST",
      `/ai-incidents/:id/${action}`,
      action === "review" ? "ai-incident:review" : "ai-system:update",
      async (r, s) => {
        const i = await load((r.params as { id: string }).id, s.tenantId);
        const b = bodyOf(r);
        revision(i, b);
        const data: Prisma.AiIncidentUncheckedUpdateManyInput = {};
        if (!i.ownerUserId) fail(403, "An owner is required");
        // Review concerns the submitted record; retain historical identities for SoD
        // even if the owner no longer belongs to this tenant.
        if (action !== "review") await member(s.tenantId, i.ownerUserId, true);
        if (action === "start") {
          if (i.status !== "OPEN") fail(409, "Only OPEN incidents can start");
          data.status = "IN_PROGRESS";
        }
        if (action === "submit-closure") {
          if (i.status !== "IN_PROGRESS")
            fail(409, "Only IN_PROGRESS incidents can be submitted");
          if (i.ownerUserId !== s.userId)
            fail(403, "Only the assigned owner can submit closure");
          if (
            [
              i.investigationSummary,
              i.responseSummary,
              i.followUpPlan,
              i.closureRationale,
            ].some((v) => !v?.trim())
          )
            fail(
              400,
              "Investigation, response, follow-up disposition and closure rationale are required",
            );
          data.status = "PENDING_REVIEW";
          data.submittedAt = new Date();
          data.closureSubmitterUserId = s.userId;
        }
        let decision: (typeof DECISIONS)[number] | undefined;
        let rationale: string | undefined;
        if (action === "review") {
          if (i.status !== "PENDING_REVIEW")
            fail(409, "Only PENDING_REVIEW incidents can be reviewed");
          if (
            !i.closureSubmitterUserId ||
            [
              i.reporterUserId,
              i.ownerUserId,
              i.closureSubmitterUserId,
            ].includes(s.userId!)
          )
            fail(
              403,
              "Independent review required: reporter, owner and closure submitter cannot review",
            );
          if (!oneOf(DECISIONS, b.decision))
            fail(400, "Invalid closure decision");
          decision = b.decision;
          rationale = text(b.rationale);
          data.status = decision === "APPROVED" ? "CLOSED" : "IN_PROGRESS";
          data.closedAt = decision === "APPROVED" ? new Date() : null;
        }
        await prisma.$transaction(async (tx) => {
          await mutate(tx, s, i, data);
          if (decision)
            await tx.aiIncidentReview.create({
              data: {
                tenantId: s.tenantId,
                incidentId: i.id,
                reviewerUserId: s.userId!,
                decision,
                rationale: rationale!,
                previousStatus: "PENDING_REVIEW",
                newStatus: decision === "APPROVED" ? "CLOSED" : "IN_PROGRESS",
              },
            });
          await txAudit(
            tx,
            s,
            i.id,
            action === "review"
              ? "review_recorded"
              : action === "start"
                ? "investigation_started"
                : "closure_submitted",
            {
              from: i.status,
              to: data.status as string,
              ...(decision ? { decision } : {}),
            },
          );
        });
        return detail(await load(i.id, s.tenantId), s);
      },
    );
  route(
    "POST",
    "/ai-incidents/:id/evidence",
    "ai-system:update",
    async (r, s) => {
      const i = await load((r.params as { id: string }).id, s.tenantId);
      const b = bodyOf(r);
      editable(i);
      revision(i, b);
      if (!hasPermission(s, "evidence:read"))
        fail(403, "Existing evidence read permission required");
      if (typeof b.evidenceDocumentId !== "string")
        fail(400, "evidenceDocumentId required");
      const vendors = await prisma.aiSystemVendor.findMany({
        where: { tenantId: s.tenantId, aiSystemId: i.aiSystemId },
        select: { vendorId: true },
      });
      const doc =
        (await prisma.evidenceDocument.findFirst({
          where: {
            id: b.evidenceDocumentId,
            tenantId: s.tenantId,
            deletedAt: null,
            OR: [
              { aiSystemId: i.aiSystemId },
              { vendorId: { in: vendors.map((v) => v.vendorId) } },
            ],
          },
        })) ?? fail(404, "Evidence not found for this system");
      if (
        ["QUARANTINED", "REJECTED", "FAILED", "EXPIRED"].includes(doc.state) ||
        (doc.expirationDate && doc.expirationDate < new Date())
      )
        fail(400, "Evidence is blocked or expired");
      await prisma.$transaction(async (tx) => {
        await mutate(tx, s, i, {});
        await tx.aiIncidentEvidence.create({
          data: {
            tenantId: s.tenantId,
            incidentId: i.id,
            evidenceDocumentId: doc.id,
          },
        });
        await txAudit(tx, s, i.id, "evidence_linked", {
          evidenceDocumentId: doc.id,
        });
      });
      return detail(await load(i.id, s.tenantId), s);
    },
  );
  route(
    "POST",
    "/ai-incidents/:id/findings",
    "ai-system:update",
    async (r, s) => {
      const i = await load((r.params as { id: string }).id, s.tenantId);
      const b = bodyOf(r);
      editable(i);
      revision(i, b);
      if (typeof b.findingId !== "string") fail(400, "findingId required");
      const f =
        (await prisma.governanceFinding.findFirst({
          where: {
            id: b.findingId,
            tenantId: s.tenantId,
            aiControlTest: {
              tenantId: s.tenantId,
              aiSystemControl: {
                tenantId: s.tenantId,
                aiSystemId: i.aiSystemId,
              },
            },
          },
        })) ?? fail(404, "Finding not found for this system");
      await prisma.$transaction(async (tx) => {
        await mutate(tx, s, i, {});
        await tx.aiIncidentFinding.create({
          data: { tenantId: s.tenantId, incidentId: i.id, findingId: f.id },
        });
        await txAudit(tx, s, i.id, "finding_linked", { findingId: f.id });
      });
      return detail(await load(i.id, s.tenantId), s);
    },
  );
  route(
    "POST",
    "/ai-incidents/:id/reassessment",
    "ai-system:update",
    async (r, s) => {
      const i = await load((r.params as { id: string }).id, s.tenantId);
      const b = bodyOf(r);
      editable(i);
      revision(i, b);
      if (i.reassessmentId) fail(409, "Reassessment already linked");
      const system =
        (await prisma.aiSystem.findFirst({
          where: { id: i.aiSystemId, tenantId: s.tenantId },
        })) ?? fail(404, "AI system not found");
      if (b.action !== "START" && b.action !== "LINK")
        fail(400, "Choose START or LINK explicitly");
      await prisma.$transaction(async (tx) => {
        let reassessmentId: string;
        if (b.action === "LINK") {
          if (typeof b.reassessmentId !== "string")
            fail(400, "reassessmentId required");
          reassessmentId = (
            (await tx.aiReassessment.findFirst({
              where: {
                id: b.reassessmentId,
                tenantId: s.tenantId,
                aiSystemId: i.aiSystemId,
              },
            })) ?? fail(404, "Reassessment not found for this system")
          ).id;
        } else {
          const priorRisk = await tx.aiRiskAssessment.findFirst({
            where: {
              tenantId: s.tenantId,
              aiSystemId: i.aiSystemId,
              status: "COMPLETED",
            },
            orderBy: { version: "desc" },
          });
          const priorImpact = await tx.aiImpactAssessment.findFirst({
            where: {
              tenantId: s.tenantId,
              aiSystemId: i.aiSystemId,
              status: "COMPLETED",
            },
            orderBy: { version: "desc" },
          });
          const reassessment = await tx.aiReassessment.create({
            data: {
              tenantId: s.tenantId,
              aiSystemId: i.aiSystemId,
              reason: "INCIDENT",
              openCycleKey: i.aiSystemId,
              whatChanged: text(b.whatChanged),
              materialChange: false,
              priorRiskAssessmentId: priorRisk?.id,
              priorImpactAssessmentId: priorImpact?.id,
              snapshotAtStart: snapshotOf(system) as Prisma.InputJsonValue,
              initiatedByUserId: s.userId!,
            },
          });
          reassessmentId = reassessment.id;
          await tx.auditEvent.create({
            data: {
              tenantId: s.tenantId,
              actorUserId: s.userId,
              action: "ai_reassessment.initiated",
              targetType: "AiReassessment",
              targetId: reassessmentId,
              outcome: "SUCCESS",
              metadataJson: { reason: "INCIDENT", incidentId: i.id },
            },
          });
        }
        await mutate(tx, s, i, { reassessmentId });
        await txAudit(
          tx,
          s,
          i.id,
          b.action === "START" ? "reassessment_started" : "reassessment_linked",
          { reassessmentId },
        );
      });
      return detail(await load(i.id, s.tenantId), s);
    },
  );
}
