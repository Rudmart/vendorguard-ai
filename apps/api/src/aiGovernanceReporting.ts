import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@vendorguard/database";
import { REPORT_DEFINITION_VERSION } from "@vendorguard/shared";
import { sessionOf, hasPermission, type Session } from "./aiControlEvidence.js";
import {
  loadReportData,
  ReportError,
  type ReportFilter,
} from "./aiGovernanceReportData.js";
import { buildReport } from "./aiGovernanceReportMetrics.js";
import { renderGovernanceReportPdf } from "./aiGovernanceReportPdf.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseReportQuery(value: unknown, records = false) {
  const q = (value ?? {}) as Record<string, unknown>;
  const allowed = records
    ? ["aiSystemId", "lifecycleScope", "metric", "cursor", "limit"]
    : ["aiSystemId", "lifecycleScope"];
  if (
    Object.keys(q).some((k) => !allowed.includes(k)) ||
    Object.values(q).some((v) => typeof v !== "string")
  )
    throw new ReportError(400, "Invalid report query");
  if (q.aiSystemId && !UUID.test(String(q.aiSystemId)))
    throw new ReportError(400, "Invalid AI system ID");
  const lifecycleScope = q.lifecycleScope ?? "operational";
  if (!["operational", "historical", "all"].includes(String(lifecycleScope)))
    throw new ReportError(400, "Invalid lifecycle scope");
  const limit = q.limit === undefined ? 50 : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ReportError(400, "Limit must be 1–100");
  if (records && (typeof q.metric !== "string" || q.metric.length > 100))
    throw new ReportError(400, "Metric is required");
  if (
    q.cursor &&
    (String(q.cursor).length > 120 ||
      !/^[A-Za-z]+:[0-9a-f-]+$/i.test(String(q.cursor)))
  )
    throw new ReportError(400, "Invalid cursor");
  const filter: ReportFilter = {
    lifecycleScope: lifecycleScope as ReportFilter["lifecycleScope"],
    ...(q.aiSystemId ? { aiSystemId: String(q.aiSystemId) } : {}),
  };
  return {
    filter,
    limit,
    metric: q.metric as string | undefined,
    cursor: q.cursor as string | undefined,
  };
}
export async function reportAudit(
  session: Session,
  request: FastifyRequest,
  action: string,
  outcome: string,
  metadata: Record<string, string | number | null> = {},
) {
  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action,
      targetType: "GovernanceReport",
      outcome,
      correlationId: request.id,
      metadataJson: {
        definitionVersion: REPORT_DEFINITION_VERSION,
        ...metadata,
      },
    },
  });
}
export async function authorizedReport(session: Session, filter: ReportFilter) {
  if (!hasPermission(session, "report:read"))
    throw new ReportError(403, "Not authorized to view governance reports");
  return buildReport(await loadReportData(session, filter.aiSystemId), filter);
}
export async function registerGovernanceReportRoutes(app: FastifyInstance) {
  for (const kind of ["summary", "records", "export"] as const) {
    const path =
      "/reports/ai-governance" + (kind === "summary" ? "" : "/" + kind);
    app.get(path, async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const session = await sessionOf(request);
      if (!session) return reply.code(401).send({ error: "Not logged in" });
      try {
        if (
          !hasPermission(
            session,
            kind === "export" ? "report:export" : "report:read",
          )
        )
          throw new ReportError(
            403,
            "Not authorized for this reporting operation",
          );
        const q = parseReportQuery(request.query, kind === "records");
        const { report, records } = await authorizedReport(session, q.filter);
        if (kind === "records") {
          const metric = report.metrics.find((m) => m.key === q.metric);
          if (!metric) throw new ReportError(400, "Unknown metric");
          if (metric.access === "RESTRICTED")
            throw new ReportError(403, "Evidence information is restricted");
          const all = records.get(metric.key) ?? [];
          const found = q.cursor
            ? all.findIndex((r) => r.type + ":" + r.id === q.cursor)
            : -1;
          if (q.cursor && found < 0)
            throw new ReportError(
              400,
              "Cursor is not in the current authorized result; refresh the live report",
            );
          const page = all.slice(found + 1, found + 1 + q.limit),
            last = page[page.length - 1];
          await reportAudit(
            session,
            request,
            "governance_report.generated",
            "SUCCESS",
            {
              lifecycleScope: q.filter.lifecycleScope,
              aiSystemId: q.filter.aiSystemId ?? null,
              metric: metric.key,
              records: page.length,
            },
          );
          return {
            definitionVersion: report.definitionVersion,
            generatedAt: report.generatedAt,
            metric,
            records: page,
            total: all.length,
            nextCursor:
              last && found + 1 + page.length < all.length
                ? last.type + ":" + last.id
                : null,
          };
        }
        const metadata = {
          lifecycleScope: q.filter.lifecycleScope,
          aiSystemId: q.filter.aiSystemId ?? null,
          format: kind === "export" ? "PDF" : "JSON",
          metrics: report.metrics.length,
        };
        if (kind === "export") {
          const pdf = await renderGovernanceReportPdf(report, records);
          await reportAudit(
            session,
            request,
            "governance_report.exported",
            "SUCCESS",
            metadata,
          );
          return reply
            .header("Content-Type", "application/pdf")
            .header(
              "Content-Disposition",
              'attachment; filename="ai-governance-report.pdf"',
            )
            .send(pdf);
        }
        await reportAudit(
          session,
          request,
          "governance_report.generated",
          "SUCCESS",
          metadata,
        );
        return report;
      } catch (error) {
        if (error instanceof ReportError) {
          if (error.statusCode === 403)
            await reportAudit(
              session,
              request,
              "governance_report.denied",
              "DENIED",
              { operation: kind },
            );
          return reply.code(error.statusCode).send({ error: error.message });
        }
        request.log.error({ err: error }, "Governance report failed");
        // Fail closed. No report is returned if required auditing fails.
        try {
          await reportAudit(
            session,
            request,
            "governance_report.failed",
            "ERROR",
            { operation: kind },
          );
        } catch {
          /* Original failure remains authoritative. */
        }
        return reply
          .code(500)
          .send({ error: "Report could not be generated or audited" });
      }
    });
  }
}
