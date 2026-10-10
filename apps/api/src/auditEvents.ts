import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@vendorguard/database";
import { sessionOf, hasPermission } from "./aiControlEvidence.js";
import { ReportError } from "./aiGovernanceReportData.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only reporting-generated scalar keys are displayed; legacy narratives stay private. */
export function safeAuditMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | null> = {};
  const values = value as Record<string, unknown>;
  const enums: Record<string, readonly string[]> = {
    format: ["JSON", "PDF"],
    lifecycleScope: ["operational", "historical", "all"],
    operation: ["summary", "records", "export", "dashboard"],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    const v = values[key];
    if (typeof v === "string" && allowed.includes(v)) result[key] = v;
  }
  if (
    typeof values.definitionVersion === "string" &&
    /^\d{1,3}\.\d{1,3}$/.test(values.definitionVersion)
  )
    result.definitionVersion = values.definitionVersion;
  for (const key of ["metrics", "records"]) {
    const v = values[key];
    if (
      typeof v === "number" &&
      Number.isSafeInteger(v) &&
      v >= 0 &&
      v <= 1000000
    )
      result[key] = v;
  }
  return result;
}
export async function registerAuditEventRoutes(app: FastifyInstance) {
  app.get("/audit-events", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const session = await sessionOf(request);
    if (!session) return reply.code(401).send({ error: "Not logged in" });
    if (!hasPermission(session, "audit:read"))
      return reply
        .code(403)
        .send({ error: "Not authorized to read audit events" });
    try {
      const q = request.query as Record<string, unknown>;
      if (
        Object.keys(q).some(
          (k) =>
            ![
              "action",
              "targetType",
              "targetId",
              "from",
              "to",
              "cursor",
              "limit",
            ].includes(k),
        ) ||
        Object.values(q).some((v) => typeof v !== "string")
      )
        throw new ReportError(400, "Invalid audit query");
      for (const key of ["action", "targetType"])
        if (q[key] && !/^[A-Za-z0-9_.-]{1,100}$/.test(String(q[key])))
          throw new ReportError(400, "Invalid action or target type");
      for (const key of ["targetId", "cursor"])
        if (q[key] && !UUID.test(String(q[key])))
          throw new ReportError(400, "Invalid target ID or cursor");
      const date = (key: string) => {
        if (q[key] === undefined) return undefined;
        if (
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(
            String(q[key]),
          )
        )
          throw new ReportError(400, "Time filters require UTC ISO timestamps");
        const d = new Date(String(q[key]));
        if (!Number.isFinite(d.getTime()))
          throw new ReportError(400, "Invalid timestamp");
        return d;
      };
      const from = date("from"),
        to = date("to");
      if (from && to && from > to)
        throw new ReportError(400, "Invalid time range");
      const limit = q.limit === undefined ? 50 : Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new ReportError(400, "Limit must be 1–100");
      const where: Prisma.AuditEventWhereInput = {
        tenantId: session.tenantId,
        ...(q.action ? { action: String(q.action) } : {}),
        ...(q.targetType ? { targetType: String(q.targetType) } : {}),
        ...(q.targetId ? { targetId: String(q.targetId) } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      };
      if (q.cursor) {
        const cursor = await prisma.auditEvent.findFirst({
          where: { ...where, id: String(q.cursor) },
          select: { id: true, createdAt: true },
        });
        if (!cursor)
          throw new ReportError(
            400,
            "Cursor is not in the authorized filtered result",
          );
        where.AND = [
          {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          },
        ];
      }
      const rows = await prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          actorUserId: true,
          actorSystem: true,
          action: true,
          targetType: true,
          targetId: true,
          outcome: true,
          correlationId: true,
          createdAt: true,
          metadataJson: true,
        },
      });
      const page = rows.slice(0, limit);
      return {
        events: page.map((r) => ({
          ...r,
          metadataJson: safeAuditMetadata(r.metadataJson),
        })),
        nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      };
    } catch (error) {
      if (error instanceof ReportError)
        return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
}
