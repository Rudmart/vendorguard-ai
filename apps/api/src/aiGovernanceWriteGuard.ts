/** Shared guard for AI governance writes. Read routes remain unchanged. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  databaseClient,
  governanceTransaction,
  Prisma,
} from "@vendorguard/database";
import { sessionOf } from "./aiControlEvidence.js";

export class GovernanceConflict extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public guardViolation = false,
  ) {
    super(message);
  }
}
type Row = Record<string, unknown>;
type Reader = {
  findMany(args: unknown): Promise<Row[]>;
  findUnique(args: unknown): Promise<Row | null>;
};
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND")
      return (Array.isArray(condition) ? condition : [condition]).every((x) =>
        matches(row, x as Row),
      );
    if (key === "OR") return (condition as Row[]).some((x) => matches(row, x));
    if (key === "NOT")
      return !(Array.isArray(condition) ? condition : [condition]).some((x) =>
        matches(row, x as Row),
      );
    const value = row[key];
    if (
      condition &&
      typeof condition === "object" &&
      !(condition instanceof Date)
    ) {
      return Object.entries(condition).every(([op, expected]) => {
        if (op === "equals") return value === expected;
        if (op === "in") return (expected as unknown[]).includes(value);
        if (op === "notIn") return !(expected as unknown[]).includes(value);
        if (op === "not") return !matches(row, { [key]: expected });
        throw new Error(`Unsupported governance guard predicate: ${key}.${op}`);
      });
    }
    return value === condition;
  });
}
function delegate(name: string): Reader {
  const records = governanceTransaction.getStore()?.records[name];
  if (!records)
    throw new Error("Governance lookups require the locked tenant snapshot");
  return {
    async findMany(args) {
      return records.filter((row) =>
        matches(row, (args as { where: Row }).where),
      );
    },
    async findUnique(args) {
      return (
        records.find((row) => matches(row, (args as { where: Row }).where)) ??
        null
      );
    },
  };
}
const operational: Record<string, string> = {
  AiSystem: "aiSystem",
  AiSystemVendor: "aiSystemVendor",
  AiUseCase: "aiUseCase",
  AiRiskAssessment: "aiRiskAssessment",
  AiImpactAssessment: "aiImpactAssessment",
  AiRisk: "aiRisk",
  AiImpact: "aiImpact",
  AiSystemFrameworkApplicability: "aiSystemFrameworkApplicability",
  AiSystemControl: "aiSystemControl",
  AiSystemControlEvidence: "aiSystemControlEvidence",
  AiControlTest: "aiControlTest",
  AiControlTestEvidence: "aiControlTestEvidence",
  AiMonitoringCheck: "aiMonitoringCheck",
  AiMonitoringReview: "aiMonitoringReview",
  AiReassessment: "aiReassessment",
  RiskAcceptance: "riskAcceptance",
};
async function systemId(model: string, row: Row): Promise<string | null> {
  if (model === "AiSystem") return typeof row.id === "string" ? row.id : null;
  if (typeof row.aiSystemId === "string") return row.aiSystemId;
  const parents: Record<string, [string, string, string]> = {
    AiRisk: ["assessmentId", "aiRiskAssessment", "AiRiskAssessment"],
    AiImpact: ["assessmentId", "aiImpactAssessment", "AiImpactAssessment"],
    AiSystemControlEvidence: [
      "aiSystemControlId",
      "aiSystemControl",
      "AiSystemControl",
    ],
    AiControlTest: ["aiSystemControlId", "aiSystemControl", "AiSystemControl"],
    AiControlTestEvidence: ["testId", "aiControlTest", "AiControlTest"],
    AiMonitoringReview: ["checkId", "aiMonitoringCheck", "AiMonitoringCheck"],
    RiskAcceptance: ["aiRiskId", "aiRisk", "AiRisk"],
  };
  const parent = parents[model];
  if (!parent || typeof row[parent[0]] !== "string") return null;
  const record = await delegate(parent[1]).findUnique({
    where: { id: row[parent[0]] },
  });
  return record ? systemId(parent[2], record) : null;
}
let installed = false;
export function registerGovernanceWriteGuard(app: FastifyInstance) {
  if (!installed) {
    installed = true;
    databaseClient.$use(async (params, next) => {
      const context = governanceTransaction.getStore();
      if (
        context &&
        params.model === "AuditEvent" &&
        params.action === "create" &&
        params.args.data.outcome === "DENIED"
      )
        context.deniedAudits?.push(
          params.args.data as Prisma.AuditEventUncheckedCreateInput,
        );
      const name = params.model && operational[params.model];
      if (
        !context ||
        !name ||
        !/^(create|update|upsert|delete)/.test(params.action)
      )
        return next(params);
      // This capability is enabled only around the reviewed approval side effects.
      if (context.retirementApproval) return next(params);
      const args = params.args as {
        data?: Row | Row[];
        create?: Row;
        where?: Row;
      };
      const model = params.model!;
      const data = args.data ?? args.create;
      if (
        model === "AiSystem" &&
        !Array.isArray(data) &&
        data?.lifecycleStatus === "RETIRED"
      ) {
        context.conflict = {
          statusCode: 409,
          message:
            "Use the independent retirement workflow to retire an AI System",
        };
        throw new GovernanceConflict(
          context.conflict.statusCode,
          context.conflict.message,
          true,
        );
      }
      if (!context.retiredSystemIds.size) return next(params);
      const rows: Row[] = [];
      if (params.action.startsWith("create"))
        rows.push(...(Array.isArray(data) ? data : [data ?? {}]));
      else if (args.where) {
        if (params.action === "updateMany" || params.action === "deleteMany")
          rows.push(...(await delegate(name).findMany({ where: args.where })));
        else {
          const row = await delegate(name).findUnique({ where: args.where });
          if (row) rows.push(row);
        }
        if (args.create) rows.push(args.create);
      }
      for (const row of rows) {
        const id = await systemId(model, row);
        if (!id) continue; // Vendor acceptances and new system registrations have no existing AI parent.
        if (context.retiredSystemIds.has(id)) {
          context.conflict = {
            statusCode: 409,
            message:
              "This AI System is permanently retired; operational changes are prohibited",
          };
          throw new GovernanceConflict(
            context.conflict.statusCode,
            context.conflict.message,
            true,
          );
        }
      }
      const result = await next(params);
      // Keep same-request parent lookups current without issuing a nested query.
      if (result && typeof result === "object" && "id" in result) {
        const stored = result as Row;
        const records = context.records[name]!;
        const at = records.findIndex((row) => row.id === stored.id);
        if (at >= 0) records[at] = { ...records[at], ...stored };
        else records.push(stored);
      }
      return result;
    });
  }
  app.addHook("onRoute", (options) => {
    const methods = Array.isArray(options.method)
      ? options.method
      : [options.method];
    if (!methods.some((m) => ["POST", "PATCH", "PUT", "DELETE"].includes(m)))
      return;
    if (
      !/^\/(ai-|governance-findings|governance-remediations|findings|remediation|risk-acceptance|evidence)/.test(
        options.url,
      )
    )
      return;
    if (options.url === "/ai-systems/:id/evidence/upload") return;
    const original = options.handler;
    options.handler = async function (request, reply) {
      const session = await sessionOf(request);
      if (!session) return original.call(this, request, reply);
      let captured = false;
      let capturedStatus = 200;
      let governanceViolation = false;
      let payload: unknown;
      const deniedAudits: Prisma.AuditEventUncheckedCreateInput[] = [];
      // Delay sending until COMMIT, including handlers that call reply.send().
      const deferred = new Proxy(reply, {
        get(target, property) {
          if (property === "then") return undefined; // FastifyReply is thenable; do not wait for the deferred send.
          if (property === "send")
            return (value: unknown) => {
              captured = true;
              capturedStatus = target.statusCode;
              payload = value;
              return deferred;
            };
          const value = Reflect.get(target, property);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            const result = value.apply(target, args);
            return result === target ? deferred : result;
          };
        },
      });
      try {
        const result = await databaseClient.$transaction(
          async (client) => {
            // Tenant advisory lock orders the per-system row locks consistently,
            // including source-neutral routes. All relevant writes share this guard.
            await client.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${session.tenantId}, 0))`;
            await client.$queryRaw`SELECT id FROM ai_systems WHERE "tenantId" = ${session.tenantId} ORDER BY id FOR UPDATE`;
            const retired = await client.aiSystem.findMany({
              where: { tenantId: session.tenantId, lifecycleStatus: "RETIRED" },
              select: { id: true },
            });
            const records: Record<string, Row[]> = {};
            if (retired.length) {
              // One query on this transaction connection; no nested middleware queries.
              const tables: Record<string, string> = {
                aiSystem: "ai_systems",
                aiSystemVendor: "ai_system_vendors",
                aiUseCase: "ai_use_cases",
                aiRiskAssessment: "ai_risk_assessments",
                aiImpactAssessment: "ai_impact_assessments",
                aiRisk: "ai_risks",
                aiImpact: "ai_impacts",
                aiSystemFrameworkApplicability:
                  "ai_system_framework_applicability",
                aiSystemControl: "ai_system_controls",
                aiSystemControlEvidence: "ai_system_control_evidence",
                aiControlTest: "ai_control_tests",
                aiControlTestEvidence: "ai_control_test_evidence",
                aiMonitoringCheck: "ai_monitoring_checks",
                aiMonitoringReview: "ai_monitoring_reviews",
                aiReassessment: "ai_reassessments",
                riskAcceptance: "risk_acceptances",
              };
              for (const name of Object.values(operational)) records[name] = [];
              const queries = Object.entries(tables).map(
                ([name, table]) =>
                  Prisma.sql`SELECT ${name}::text AS model, to_jsonb(t) AS row FROM ${Prisma.raw('"' + table + '"')} t WHERE "tenantId"=${session.tenantId}`,
              );
              const snapshot = await client.$queryRaw<
                { model: string; row: Row }[]
              >(Prisma.join(queries, " UNION ALL "));
              for (const entry of snapshot)
                records[entry.model]!.push(entry.row);
            }
            return governanceTransaction.run(
              {
                client,
                tenantId: session.tenantId,
                retirementApproval: false,
                retiredSystemIds: new Set(retired.map((x) => x.id)),
                records,
                deniedAudits,
              },
              async () => {
                const result = await original.call(
                  this,
                  request as FastifyRequest,
                  deferred as FastifyReply,
                );
                const conflict = governanceTransaction.getStore()?.conflict;
                if (conflict) {
                  governanceViolation = true;
                  throw new GovernanceConflict(
                    conflict.statusCode,
                    conflict.message,
                  );
                }
                if (reply.statusCode >= 400)
                  throw new GovernanceConflict(
                    reply.statusCode,
                    captured &&
                    typeof payload === "object" &&
                    payload !== null &&
                    "error" in payload
                      ? String(payload.error)
                      : "Governance operation rejected",
                  );
                return captured ? payload : result;
              },
            );
          },
          { maxWait: 15000, timeout: 30000 },
        );
        return reply.send(result);
      } catch (error) {
        governanceViolation ||=
          error instanceof GovernanceConflict && error.guardViolation;
        const status = (error as { statusCode?: number }).statusCode;
        if (status) {
          for (const data of deniedAudits.slice())
            await databaseClient.auditEvent.create({ data });
          if (governanceViolation || options.url.includes("retirement"))
            await databaseClient.auditEvent.create({
              data: {
                tenantId: session.tenantId,
                actorUserId: session.userId,
                action: options.url.includes("retirement")
                  ? "ai_retirement.operation_blocked"
                  : "ai_governance.operation_blocked",
                targetType: options.url.startsWith("/ai-retirements")
                  ? "AiSystemRetirement"
                  : options.url.startsWith("/ai-systems")
                    ? "AiSystem"
                    : "AiGovernanceOperation",
                targetId:
                  Object.values(request.params as Record<string, string>)[0] ??
                  "unknown",
                outcome: "DENIED",
                metadataJson: { operation: options.url, status },
              },
            });
          return reply
            .code(status)
            .send(
              !governanceViolation && captured && capturedStatus === status
                ? payload
                : { error: (error as Error).message },
            );
        }
        throw error;
      }
    };
  });
}
