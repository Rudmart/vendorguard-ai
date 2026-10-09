/** Permanent AI retirement. Historical governance records are never deleted or completed here. */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  prisma,
  governanceTransaction,
  Prisma,
  type AiSystemRetirement,
} from "@vendorguard/database";
import { roleHasPermission } from "@vendorguard/shared";
import {
  sessionOf,
  hasPermission,
  cleanText,
  audit,
  type Session,
} from "./aiControlEvidence.js";
import { nextDueDate } from "./aiMonitoring.js";
import { GovernanceConflict } from "./aiGovernanceWriteGuard.js";

const REASONS = [
  "REPLACED",
  "NO_LONGER_NEEDED",
  "RISK_OR_COMPLIANCE",
  "VENDOR_SERVICE_ENDED",
  "OTHER",
] as const;
const DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
const FIELDS = [
  "businessJustification",
  "useCaseDisposition",
  "monitoringDisposition",
  "retentionStatement",
] as const;
type Issue = { key: string; kind: string; id: string; description: string };
export type Disposition = {
  key: string;
  remainingWork: string;
  whyProceed: string;
  ownerUserId: string;
  followUpPlan: string;
};
function fail(status: number, message: string): never {
  throw new GovernanceConflict(status, message);
}
function text(v: unknown): string {
  return (
    cleanText(v, 4000) ??
    fail(400, "Required text must be nonempty and at most 4000 characters")
  );
}
function body(r: FastifyRequest): Record<string, unknown> {
  if (!r.body || typeof r.body !== "object" || Array.isArray(r.body))
    fail(400, "An object body is required");
  return r.body as Record<string, unknown>;
}
function revision(i: AiSystemRetirement, b: Record<string, unknown>) {
  if (!Number.isInteger(b.revision) || b.revision !== i.revision)
    fail(409, "Retirement changed; reload before continuing");
}
async function system(id: string, tenantId: string) {
  return (
    (await prisma.aiSystem.findFirst({ where: { id, tenantId } })) ??
    fail(404, "AI System not found")
  );
}
async function load(id: string, s: Session) {
  return (
    (await prisma.aiSystemRetirement.findFirst({
      where: { id, tenantId: s.tenantId, aiSystem: { tenantId: s.tenantId } },
    })) ?? fail(404, "Retirement not found")
  );
}
async function eligibleOwner(
  tenantId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const m = await prisma.tenantMembership.findFirst({
    where: { tenantId, userId },
  });
  return !!m && roleHasPermission(m.role, "ai-system:update");
}
const findingSystem = (id: string) => ({
  OR: [
    { aiControlTest: { aiSystemControl: { aiSystemId: id } } },
    { incidentLinks: { some: { incident: { aiSystemId: id } } } },
  ],
});
export async function retirementReadiness(
  tenantId: string,
  aiSystemId: string,
) {
  const sys = await system(aiSystemId, tenantId);
  const orderBy = { id: "asc" } as const;
  const [
    incidents,
    findings,
    acceptances,
    risks,
    impacts,
    tests,
    cycles,
    uses,
    monitoring,
    remediation,
    documents,
    controls,
    applicability,
    assurance,
    riskItems,
    impactItems,
    vendorLinks,
  ] = await Promise.all([
    prisma.aiIncident.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: { id: true, status: true, revision: true },
    }),
    prisma.governanceFinding.findMany({
      where: { tenantId, ...findingSystem(aiSystemId) },
      orderBy,
      select: { id: true, status: true, severity: true, updatedAt: true },
    }),
    prisma.riskAcceptance.findMany({
      where: {
        tenantId,
        OR: [
          { aiRisk: { assessment: { aiSystemId } } },
          { governanceFinding: findingSystem(aiSystemId) },
        ],
      },
      orderBy,
      select: { id: true, status: true, expiresAt: true },
    }),
    prisma.aiRiskAssessment.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.aiImpactAssessment.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.aiControlTest.findMany({
      where: { tenantId, aiSystemControl: { aiSystemId } },
      orderBy,
      select: { id: true, status: true, updatedAt: true, nextTestDate: true },
    }),
    prisma.aiReassessment.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.aiUseCase.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.aiMonitoringCheck.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      include: { reviews: { orderBy: { reviewedAt: "desc" }, take: 1 } },
    }),
    prisma.remediationAction.findMany({
      where: {
        tenantId,
        OR: [
          { governanceFinding: findingSystem(aiSystemId) },
          { aiRisk: { assessment: { aiSystemId } } },
        ],
      },
      orderBy,
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.evidenceDocument.findMany({
      where: { tenantId, aiSystemId, deletedAt: null },
      orderBy,
      select: { id: true, state: true, expirationDate: true, version: true },
    }),
    prisma.aiSystemControl.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: {
        id: true,
        updatedAt: true,
        applicability: true,
        implementationStatus: true,
      },
    }),
    prisma.aiSystemFrameworkApplicability.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.aiSystemControlEvidence.findMany({
      where: { tenantId, aiSystemControl: { aiSystemId } },
      orderBy,
      include: {
        evidenceDocument: {
          select: {
            id: true,
            state: true,
            expirationDate: true,
            version: true,
            deletedAt: true,
          },
        },
      },
    }),
    prisma.aiRisk.findMany({
      where: { tenantId, assessment: { aiSystemId } },
      orderBy,
      select: { id: true, updatedAt: true },
    }),
    prisma.aiImpact.findMany({
      where: { tenantId, assessment: { aiSystemId } },
      orderBy,
      select: { id: true, updatedAt: true },
    }),
    prisma.aiSystemVendor.findMany({
      where: { tenantId, aiSystemId },
      orderBy,
      select: { id: true, vendorId: true, role: true, createdAt: true },
    }),
  ]);
  const blockers: Issue[] = [],
    warnings: Issue[] = [];
  const add = (list: Issue[], kind: string, id: string, description: string) =>
    list.some((x) => x.key === `${kind}:${id}`)
      ? undefined
      : list.push({ key: `${kind}:${id}`, kind, id, description });
  const ownerEligible = await eligibleOwner(tenantId, sys.ownerUserId);
  if (!ownerEligible)
    add(
      blockers,
      "OWNER",
      sys.id,
      "Current system owner must be a current tenant member with update permission",
    );
  if (sys.lifecycleStatus === "RETIRED")
    add(
      blockers,
      "RETIRED",
      sys.id,
      "The system is already permanently retired",
    );
  for (const row of incidents.filter((x) => x.status !== "CLOSED"))
    add(blockers, "INCIDENT", row.id, "Unresolved incident");
  for (const row of findings.filter(
    (x) => x.status === "OPEN" || x.status === "PENDING_REVIEW",
  ))
    add(
      ["HIGH", "CRITICAL"].includes(row.severity) ? blockers : warnings,
      "FINDING",
      row.id,
      `Unresolved ${row.severity} finding`,
    );
  for (const row of acceptances) {
    if (row.status === "PENDING_REVIEW")
      add(
        blockers,
        "PENDING_ACCEPTANCE",
        row.id,
        "Pending risk-acceptance decision",
      );
    if (
      row.status === "APPROVED" &&
      (!row.expiresAt || row.expiresAt.getTime() > Date.now())
    )
      add(
        warnings,
        "ACTIVE_ACCEPTANCE",
        row.id,
        "Active approved risk acceptance retains its original decision and expiry",
      );
  }
  for (const [kind, rows] of [
    ["RISK_ASSESSMENT", risks],
    ["IMPACT_ASSESSMENT", impacts],
    ["CONTROL_TEST", tests],
    ["REASSESSMENT", cycles],
  ] as const) {
    for (const row of rows.filter((x) => x.status !== "COMPLETED"))
      add(
        warnings,
        kind,
        row.id,
        `Unfinished ${kind.toLowerCase().replaceAll("_", " ")}`,
      );
  }
  if (!risks.some((x) => x.status === "COMPLETED"))
    add(
      warnings,
      "MISSING_RISK_ASSESSMENT",
      sys.id,
      "No completed risk assessment",
    );
  if (!impacts.some((x) => x.status === "COMPLETED"))
    add(
      warnings,
      "MISSING_IMPACT_ASSESSMENT",
      sys.id,
      "No completed impact assessment",
    );
  for (const row of uses.filter((x) => x.status !== "RETIRED"))
    add(
      warnings,
      "USE_CASE",
      row.id,
      "This use case will be retired while retaining its approval history",
    );
  for (const row of monitoring.filter((x) => x.active))
    add(
      warnings,
      "MONITORING",
      row.id,
      "Operational monitoring will be deactivated; review history retained",
    );
  for (const row of monitoring.filter(
    (x) =>
      x.active &&
      nextDueDate(
        x.reviews[0]?.reviewedAt ?? x.createdAt,
        x.cadence,
      ).getTime() < Date.now(),
  ))
    add(warnings, "OVERDUE_MONITORING", row.id, "Monitoring review is overdue");
  for (const row of assurance.filter((x) => x.status !== "ACCEPTED"))
    add(
      warnings,
      "INCOMPLETE_ASSURANCE",
      row.id,
      "Control assurance evidence has not been accepted",
    );
  for (const row of tests.filter(
    (x) => x.nextTestDate && x.nextTestDate.getTime() < Date.now(),
  ))
    add(warnings, "OVERDUE_RETEST", row.id, "Control retest is overdue");
  for (const row of remediation.filter((x) => x.status !== "CLOSED"))
    add(
      warnings,
      "REMEDIATION",
      row.id,
      "Remediation remains open for authorized follow-up",
    );
  for (const row of assurance) {
    const d = row.evidenceDocument;
    if (
      d.deletedAt ||
      [
        "QUARANTINED",
        "REJECTED",
        "FAILED",
        "EXPIRED",
        "UPLOADED",
        "SCANNING",
      ].includes(d.state) ||
      (d.expirationDate && d.expirationDate.getTime() < Date.now())
    ) {
      if (!warnings.some((x) => x.key === `ASSURANCE_EVIDENCE:${d.id}`))
        add(
          warnings,
          "ASSURANCE_EVIDENCE",
          d.id,
          "Incomplete or expired linked assurance evidence",
        );
    }
  }
  for (const row of documents.filter(
    (x) =>
      [
        "EXPIRED",
        "FAILED",
        "REJECTED",
        "QUARANTINED",
        "UPLOADED",
        "SCANNING",
      ].includes(x.state) ||
      (x.expirationDate && x.expirationDate.getTime() < Date.now()),
  ))
    add(
      warnings,
      "ASSURANCE_EVIDENCE",
      row.id,
      "Incomplete or expired assurance evidence",
    );
  // Relationships corrupted outside normal API paths must not silently disappear.
  const invalidCounts = await Promise.all([
    prisma.aiRiskAssessment.count({
      where: { aiSystemId, tenantId: { not: tenantId } },
    }),
    prisma.aiImpactAssessment.count({
      where: { aiSystemId, tenantId: { not: tenantId } },
    }),
    prisma.aiRisk.count({
      where: { assessment: { aiSystemId }, tenantId: { not: tenantId } },
    }),
    prisma.aiImpact.count({
      where: { assessment: { aiSystemId }, tenantId: { not: tenantId } },
    }),
    prisma.aiSystemControl.count({
      where: {
        aiSystemId,
        OR: [
          { tenantId: { not: tenantId } },
          { sourceApplicability: { tenantId: { not: tenantId } } },
          { sourceApplicability: { aiSystemId: { not: aiSystemId } } },
        ],
      },
    }),
    prisma.aiControlTest.count({
      where: { aiSystemControl: { aiSystemId }, tenantId: { not: tenantId } },
    }),
    prisma.aiSystemControlEvidence.count({
      where: {
        aiSystemControl: { aiSystemId },
        OR: [
          { tenantId: { not: tenantId } },
          { evidenceDocument: { tenantId: { not: tenantId } } },
        ],
      },
    }),
    prisma.aiMonitoringCheck.count({
      where: { aiSystemId, tenantId: { not: tenantId } },
    }),
    prisma.aiMonitoringReview.count({
      where: {
        check: { aiSystemId },
        OR: [
          { tenantId: { not: tenantId } },
          { reassessment: { is: { aiSystemId: { not: aiSystemId } } } },
        ],
      },
    }),
    prisma.aiReassessment.count({
      where: {
        aiSystemId,
        OR: [
          { tenantId: { not: tenantId } },
          { priorRiskAssessment: { is: { aiSystemId: { not: aiSystemId } } } },
          { newRiskAssessment: { is: { aiSystemId: { not: aiSystemId } } } },
          {
            priorImpactAssessment: { is: { aiSystemId: { not: aiSystemId } } },
          },
          { newImpactAssessment: { is: { aiSystemId: { not: aiSystemId } } } },
        ],
      },
    }),
    prisma.aiUseCase.count({
      where: { aiSystemId, tenantId: { not: tenantId } },
    }),
    prisma.aiIncident.count({
      where: {
        aiSystemId,
        OR: [
          { tenantId: { not: tenantId } },
          { aiUseCase: { is: { tenantId: { not: tenantId } } } },
          { aiUseCase: { is: { aiSystemId: { not: aiSystemId } } } },
        ],
      },
    }),
    prisma.governanceFinding.count({
      where: { ...findingSystem(aiSystemId), tenantId: { not: tenantId } },
    }),
    prisma.riskAcceptance.count({
      where: {
        AND: [
          {
            OR: [
              { aiRisk: { assessment: { aiSystemId } } },
              { governanceFinding: findingSystem(aiSystemId) },
            ],
          },
          {
            OR: [
              { tenantId: { not: tenantId } },
              { aiRisk: { tenantId: { not: tenantId } } },
              { aiRisk: { assessment: { aiSystemId: { not: aiSystemId } } } },
              { governanceFinding: { is: { NOT: findingSystem(aiSystemId) } } },
            ],
          },
        ],
      },
    }),
    prisma.remediationAction.count({
      where: {
        AND: [
          {
            OR: [
              { aiRisk: { assessment: { aiSystemId } } },
              { governanceFinding: findingSystem(aiSystemId) },
            ],
          },
          {
            OR: [
              { tenantId: { not: tenantId } },
              { aiRisk: { assessment: { aiSystemId: { not: aiSystemId } } } },
              { governanceFinding: { is: { NOT: findingSystem(aiSystemId) } } },
            ],
          },
        ],
      },
    }),
  ]);
  const invalid = invalidCounts.reduce((total, count) => total + count, 0);
  if (invalid)
    add(
      blockers,
      "INVALID_RELATIONSHIP",
      sys.id,
      "Invalid tenant relationships require correction",
    );
  blockers.sort((a, b) => a.key.localeCompare(b.key));
  warnings.sort((a, b) => a.key.localeCompare(b.key));
  const facts = {
    system: {
      id: sys.id,
      lifecycleStatus: sys.lifecycleStatus,
      ownerUserId: sys.ownerUserId,
      updatedAt: sys.updatedAt,
      ownerEligible,
    },
    incidents,
    findings,
    acceptances,
    risks,
    impacts,
    tests,
    cycles,
    uses,
    monitoring,
    remediation,
    documents,
    controls,
    applicability,
    assurance,
    riskItems,
    impactItems,
    vendorLinks,
    blockers,
    warnings,
  };
  const token = createHash("sha256")
    .update(JSON.stringify(facts))
    .digest("hex");
  return { aiSystemId, blockers, warnings, token };
}
async function dispositions(
  value: unknown,
  tenantId: string,
): Promise<Disposition[]> {
  if (!Array.isArray(value) || value.length > 1000)
    fail(400, "Warning dispositions must be an array of at most 1000 entries");
  const rows: Disposition[] = [],
    seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object")
      fail(400, "Invalid warning disposition");
    const e = entry as Record<string, unknown>;
    const key = text(e.key);
    if (seen.has(key)) fail(400, "Duplicate warning disposition");
    seen.add(key);
    const ownerUserId = text(e.ownerUserId);
    if (
      !(await prisma.tenantMembership.findFirst({
        where: { tenantId, userId: ownerUserId },
      }))
    )
      fail(404, "Follow-up owner not found in tenant");
    rows.push({
      key,
      ownerUserId,
      remainingWork: text(e.remainingWork),
      whyProceed: text(e.whyProceed),
      followUpPlan: text(e.followUpPlan),
    });
  }
  return rows;
}
async function selectedEvidence(i: AiSystemRetirement, tenantId: string) {
  const links = await prisma.aiSystemRetirementEvidence.findMany({
    where: { retirementId: i.id },
    include: { evidenceDocument: true },
  });
  for (const l of links) {
    const d = l.evidenceDocument;
    if (
      l.tenantId !== tenantId ||
      d.tenantId !== tenantId ||
      d.aiSystemId !== i.aiSystemId
    )
      fail(409, "Invalid retirement evidence relationship");
    if (
      d.deletedAt ||
      [
        "QUARANTINED",
        "REJECTED",
        "FAILED",
        "EXPIRED",
        "UPLOADED",
        "SCANNING",
      ].includes(d.state) ||
      (d.expirationDate && d.expirationDate.getTime() <= Date.now())
    )
      fail(409, "Linked retirement evidence is no longer usable");
  }
  return links.map((l) => ({
    id: l.evidenceDocumentId,
    version: l.evidenceDocument.version,
    state: l.evidenceDocument.state,
    expirationDate: l.evidenceDocument.expirationDate,
  }));
}
async function context(i: AiSystemRetirement, tenantId: string) {
  const readiness = await retirementReadiness(tenantId, i.aiSystemId);
  const evidence = await selectedEvidence(i, tenantId);
  const ds = await dispositions(i.warningDispositions, tenantId);
  const token = createHash("sha256")
    .update(
      JSON.stringify({ token: readiness.token, evidence, dispositions: ds }),
    )
    .digest("hex");
  return { ...readiness, token, warningDispositions: ds, evidence };
}
async function required(
  i: AiSystemRetirement,
  s: Session,
  ready: Awaited<ReturnType<typeof context>>,
) {
  for (const key of FIELDS) text(i[key]);
  const sys = await system(i.aiSystemId, s.tenantId);
  if (
    !i.cessationConfirmed &&
    !(
      i.cessationNotApplicableReason &&
      [
        "PROPOSED",
        "DEVELOPMENT",
        "TESTING",
        "ASSESSMENT",
        "PENDING_APPROVAL",
      ].includes(sys.lifecycleStatus)
    )
  )
    fail(
      400,
      "Confirm cessation or explain non-applicability for a never-deployed system",
    );
  const ds = await dispositions(i.warningDispositions, s.tenantId);
  for (const warning of ready.warnings)
    if (!ds.some((d) => d.key === warning.key))
      fail(400, `Missing documented disposition for ${warning.key}`);
}
async function detail(i: AiSystemRetirement, s: Session) {
  const mayReadEvidence =
    hasPermission(s, "evidence:read") ||
    hasPermission(s, "evidence:read-metadata");
  const record = await prisma.aiSystemRetirement.findFirst({
    where: { id: i.id, tenantId: s.tenantId },
    include: {
      aiSystem: {
        select: {
          id: true,
          name: true,
          ownerUserId: true,
          lifecycleStatus: true,
        },
      },
      reviews: {
        where: { tenantId: s.tenantId },
        orderBy: { createdAt: "asc" },
      },
      ...(mayReadEvidence
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
                  },
                },
              },
            },
          }
        : {}),
    },
  });
  return {
    ...record,
    readiness:
      i.status === "COMPLETED"
        ? i.readinessSnapshot
        : await retirementReadiness(s.tenantId, i.aiSystemId),
  };
}
async function mutate(
  i: AiSystemRetirement,
  s: Session,
  data: Prisma.AiSystemRetirementUncheckedUpdateManyInput,
) {
  const r = await prisma.aiSystemRetirement.updateMany({
    where: {
      id: i.id,
      tenantId: s.tenantId,
      revision: i.revision,
      status: i.status,
    },
    data: { ...data, revision: { increment: 1 } },
  });
  if (!r.count) fail(409, "Retirement changed; reload before continuing");
}
export async function registerRetirementRoutes(app: FastifyInstance) {
  const route = (
    method: "GET" | "POST" | "PATCH",
    url: string,
    permission: string,
    handler: (r: FastifyRequest, s: Session) => Promise<unknown>,
  ) =>
    app.route({
      method,
      url,
      handler: async (r, reply) => {
        const s = await sessionOf(r);
        if (!s) return reply.code(401).send({ error: "Not logged in" });
        if (!hasPermission(s, permission)) {
          await audit(
            s,
            "ai_retirement.operation_denied",
            "AiSystemRetirement",
            (r.params as { id: string }).id,
            { operation: url },
            "DENIED",
          );
          fail(403, "Not authorized for retirement operation");
        }
        try {
          return await handler(r, s);
        } catch (e) {
          if ((e as { code?: string }).code === "P2002")
            fail(409, "An active request or evidence link already exists");
          throw e;
        }
      },
    });
  route(
    "GET",
    "/ai-systems/:id/retirement-readiness",
    "ai-system:read",
    (r, s) => retirementReadiness(s.tenantId, (r.params as { id: string }).id),
  );
  route(
    "GET",
    "/ai-systems/:id/retirements",
    "ai-system:read",
    async (r, s) => {
      const sys = await system((r.params as { id: string }).id, s.tenantId);
      return {
        retirements: await prisma.aiSystemRetirement.findMany({
          where: { tenantId: s.tenantId, aiSystemId: sys.id },
          orderBy: { createdAt: "desc" },
        }),
      };
    },
  );
  route(
    "POST",
    "/ai-systems/:id/retirements",
    "ai-system:update",
    async (r, s) => {
      const sys = await system((r.params as { id: string }).id, s.tenantId);
      if (sys.lifecycleStatus === "RETIRED")
        fail(409, "System is permanently retired");
      const b = body(r);
      if (
        Object.keys(b).some(
          (k) =>
            ![
              ...FIELDS,
              "reason",
              "requestedRetirementDate",
              "cessationConfirmed",
              "cessationNotApplicableReason",
              "warningDispositions",
            ].includes(k),
        )
      )
        fail(400, "Unknown or server-controlled retirement field");
      if (!REASONS.includes(b.reason as (typeof REASONS)[number]))
        fail(400, "Invalid retirement reason");
      const date =
        typeof b.requestedRetirementDate === "string"
          ? new Date(b.requestedRetirementDate)
          : new Date(NaN);
      if (Number.isNaN(date.getTime()))
        fail(400, "A valid requested retirement date is required");
      if (
        b.cessationConfirmed !== undefined &&
        typeof b.cessationConfirmed !== "boolean"
      )
        fail(400, "Invalid cessation confirmation");
      const data = {
        tenantId: s.tenantId,
        aiSystemId: sys.id,
        activeRequestKey: sys.id,
        requesterUserId: s.userId,
        reason: b.reason as (typeof REASONS)[number],
        requestedRetirementDate: date,
        cessationConfirmed: b.cessationConfirmed === true,
        cessationNotApplicableReason: b.cessationNotApplicableReason
          ? text(b.cessationNotApplicableReason)
          : null,
        warningDispositions: (await dispositions(
          b.warningDispositions ?? [],
          s.tenantId,
        )) as unknown as Prisma.InputJsonValue,
        ...Object.fromEntries(FIELDS.map((k) => [k, text(b[k])])),
      };
      const created = await prisma.aiSystemRetirement.create({
        data: data as Prisma.AiSystemRetirementUncheckedCreateInput,
      });
      await audit(
        s,
        "ai_retirement.created",
        "AiSystemRetirement",
        created.id,
        { aiSystemId: sys.id },
      );
      return detail(created, s);
    },
  );
  route("GET", "/ai-retirements/:id", "ai-system:read", async (r, s) =>
    detail(await load((r.params as { id: string }).id, s), s),
  );
  route("PATCH", "/ai-retirements/:id", "ai-system:update", async (r, s) => {
    const i = await load((r.params as { id: string }).id, s),
      b = body(r);
    revision(i, b);
    if (i.status !== "DRAFT") fail(409, "Only DRAFT requests are editable");
    const permitted = [
      "revision",
      ...FIELDS,
      "reason",
      "requestedRetirementDate",
      "cessationConfirmed",
      "cessationNotApplicableReason",
      "warningDispositions",
    ];
    if (Object.keys(b).some((k) => !permitted.includes(k)))
      fail(400, "Unknown or server-controlled retirement field");
    const data: Prisma.AiSystemRetirementUncheckedUpdateManyInput = {};
    for (const k of FIELDS) if (k in b) data[k] = text(b[k]);
    if ("reason" in b) {
      if (!REASONS.includes(b.reason as (typeof REASONS)[number]))
        fail(400, "Invalid reason");
      data.reason = b.reason as (typeof REASONS)[number];
    }
    if ("requestedRetirementDate" in b) {
      const d =
        typeof b.requestedRetirementDate === "string"
          ? new Date(b.requestedRetirementDate)
          : new Date(NaN);
      if (Number.isNaN(d.getTime())) fail(400, "Invalid requested date");
      data.requestedRetirementDate = d;
    }
    if ("cessationConfirmed" in b) {
      if (typeof b.cessationConfirmed !== "boolean")
        fail(400, "Invalid cessation confirmation");
      data.cessationConfirmed = b.cessationConfirmed;
    }
    if ("cessationNotApplicableReason" in b)
      data.cessationNotApplicableReason =
        b.cessationNotApplicableReason === null
          ? null
          : text(b.cessationNotApplicableReason);
    if ("warningDispositions" in b)
      data.warningDispositions = (await dispositions(
        b.warningDispositions,
        s.tenantId,
      )) as unknown as Prisma.InputJsonValue;
    await mutate(i, s, data);
    await audit(s, "ai_retirement.updated", "AiSystemRetirement", i.id, {
      revision: i.revision + 1,
    });
    return detail(await load(i.id, s), s);
  });
  route(
    "POST",
    "/ai-retirements/:id/evidence",
    "ai-system:update",
    async (r, s) => {
      if (!hasPermission(s, "evidence:read"))
        fail(
          403,
          "Existing evidence read permission is required to link evidence",
        );
      const i = await load((r.params as { id: string }).id, s),
        b = body(r);
      revision(i, b);
      if (i.status !== "DRAFT")
        fail(409, "Evidence can only be linked to DRAFT requests");
      const id = text(b.evidenceDocumentId);
      const d = await prisma.evidenceDocument.findFirst({
        where: {
          id,
          tenantId: s.tenantId,
          aiSystemId: i.aiSystemId,
          deletedAt: null,
        },
      });
      if (!d) fail(404, "Evidence not found for this AI System");
      if (
        [
          "QUARANTINED",
          "REJECTED",
          "FAILED",
          "EXPIRED",
          "UPLOADED",
          "SCANNING",
        ].includes(d.state) ||
        (d.expirationDate && d.expirationDate.getTime() <= Date.now())
      )
        fail(400, "Evidence is not usable");
      await prisma.aiSystemRetirementEvidence.create({
        data: {
          tenantId: s.tenantId,
          retirementId: i.id,
          evidenceDocumentId: id,
          linkedByUserId: s.userId,
        },
      });
      await mutate(i, s, {});
      await audit(
        s,
        "ai_retirement.evidence_linked",
        "AiSystemRetirement",
        i.id,
        { evidenceDocumentId: id },
      );
      return detail(await load(i.id, s), s);
    },
  );
  route(
    "POST",
    "/ai-retirements/:id/submit",
    "ai-system:update",
    async (r, s) => {
      const i = await load((r.params as { id: string }).id, s),
        b = body(r);
      revision(i, b);
      if (i.status !== "DRAFT")
        fail(409, "Only DRAFT requests can be submitted");
      const sys = await system(i.aiSystemId, s.tenantId);
      if (
        sys.ownerUserId !== s.userId ||
        !(await eligibleOwner(s.tenantId, sys.ownerUserId))
      )
        fail(403, "Only the current eligible system owner may submit");
      const ready = await context(i, s.tenantId);
      await required(i, s, ready);
      // Preparation/submission remains possible with blockers; approval does not.
      await mutate(i, s, {
        status: "PENDING_REVIEW",
        submitterUserId: s.userId,
        ownerAtSubmissionUserId: sys.ownerUserId,
        submittedAt: new Date(),
        readinessSnapshot: ready as unknown as Prisma.InputJsonValue,
      });
      await audit(s, "ai_retirement.submitted", "AiSystemRetirement", i.id, {
        revision: i.revision + 1,
        warningCount: ready.warnings.length,
      });
      return detail(await load(i.id, s), s);
    },
  );
  route(
    "POST",
    "/ai-retirements/:id/cancel",
    "ai-system:update",
    async (r, s) => {
      const i = await load((r.params as { id: string }).id, s),
        b = body(r);
      revision(i, b);
      if (i.status !== "DRAFT")
        fail(409, "Only DRAFT requests can be cancelled");
      const cancellationRationale = text(b.rationale);
      await mutate(i, s, {
        status: "CANCELLED",
        activeRequestKey: null,
        cancelledAt: new Date(),
        cancellationRationale,
      });
      await audit(s, "ai_retirement.cancelled", "AiSystemRetirement", i.id, {});
      return detail(await load(i.id, s), s);
    },
  );
  route(
    "POST",
    "/ai-retirements/:id/review",
    "ai-retirement:review",
    async (r, s) => {
      const i = await load((r.params as { id: string }).id, s),
        b = body(r);
      revision(i, b);
      if (i.status !== "PENDING_REVIEW")
        fail(409, "Retirement is not pending review");
      if (!DECISIONS.includes(b.decision as (typeof DECISIONS)[number]))
        fail(400, "Invalid review decision");
      const rationale = text(b.rationale);
      const sys = await system(i.aiSystemId, s.tenantId);
      if (
        [
          i.requesterUserId,
          i.submitterUserId,
          i.ownerAtSubmissionUserId,
          sys.ownerUserId,
        ].includes(s.userId)
      )
        fail(
          403,
          "Independent review required: reviewer cannot be requester, submitter, or owner",
        );
      let snapshot: Prisma.InputJsonValue =
        i.readinessSnapshot as Prisma.InputJsonValue;
      let acknowledgedWarningKeys: string[] = [];
      if (b.decision === "APPROVED") {
        const ready = await context(i, s.tenantId);
        await required(i, s, ready);
        if (ready.blockers.length)
          fail(
            409,
            `Retirement blocked: ${ready.blockers.map((x) => x.kind).join(", ")}`,
          );
        const previous = i.readinessSnapshot as { token?: string } | null;
        if (previous?.token !== ready.token || b.readinessToken !== ready.token)
          fail(
            409,
            "Readiness context changed; request changes and resubmit before approval",
          );
        if (i.requestedRetirementDate.getTime() > Date.now())
          fail(
            400,
            "Requested retirement date is not yet due; approval executes immediately",
          );
        if (
          !Array.isArray(b.acknowledgedWarningKeys) ||
          b.acknowledgedWarningKeys.some((x) => typeof x !== "string")
        )
          fail(400, "Explicit warning acknowledgment array is required");
        acknowledgedWarningKeys = b.acknowledgedWarningKeys as string[];
        if (
          new Set(acknowledgedWarningKeys).size !==
            acknowledgedWarningKeys.length ||
          acknowledgedWarningKeys.length !== ready.warnings.length ||
          ready.warnings.some((w) => !acknowledgedWarningKeys.includes(w.key))
        )
          fail(400, "Every current warning must be explicitly acknowledged");
        snapshot = ready as unknown as Prisma.InputJsonValue;
        const transaction = governanceTransaction.getStore();
        if (!transaction)
          fail(
            500,
            "Retirement approval requires the shared transaction guard",
          );
        transaction.retirementApproval = true;
        try {
          const now = new Date();
          await prisma.aiSystem.update({
            where: { id: sys.id },
            data: { lifecycleStatus: "RETIRED", retiredAt: now },
          });
          const useCases = await prisma.aiUseCase.findMany({
            where: {
              tenantId: s.tenantId,
              aiSystemId: sys.id,
              status: { not: "RETIRED" },
            },
          });
          for (const useCase of useCases) {
            await prisma.aiUseCase.update({
              where: { id: useCase.id },
              data: { status: "RETIRED" },
            });
            await audit(s, "ai_use_case.retired", "AiUseCase", useCase.id, {
              retirementId: i.id,
              previousStatus: useCase.status,
            });
          }
          const checks = await prisma.aiMonitoringCheck.findMany({
            where: { tenantId: s.tenantId, aiSystemId: sys.id, active: true },
          });
          for (const check of checks) {
            await prisma.aiMonitoringCheck.update({
              where: { id: check.id },
              data: { active: false, deactivatedAt: now },
            });
            await audit(
              s,
              "ai_monitoring_check.deactivated",
              "AiMonitoringCheck",
              check.id,
              { retirementId: i.id },
            );
          }
          await mutate(i, s, {
            status: "COMPLETED",
            activeRequestKey: null,
            completedAt: now,
          });
          await audit(s, "ai_system.lifecycle_changed", "AiSystem", sys.id, {
            from: sys.lifecycleStatus,
            to: "RETIRED",
            retirementId: i.id,
          });
          await audit(s, "ai_system.retired", "AiSystem", sys.id, {
            retirementId: i.id,
          });
          await audit(
            s,
            "ai_retirement.completed",
            "AiSystemRetirement",
            i.id,
            { aiSystemId: sys.id },
          );
          for (const key of acknowledgedWarningKeys)
            await audit(
              s,
              "ai_retirement.warning_acknowledged",
              "AiSystemRetirement",
              i.id,
              { warningKey: key },
            );
        } finally {
          transaction.retirementApproval = false;
        }
      } else {
        await mutate(i, s, {
          status: "DRAFT",
          readinessSnapshot: Prisma.JsonNull,
        });
      }
      await prisma.aiSystemRetirementReview.create({
        data: {
          tenantId: s.tenantId,
          retirementId: i.id,
          reviewerUserId: s.userId,
          decision: b.decision as (typeof DECISIONS)[number],
          rationale,
          previousStatus: i.status,
          newStatus: b.decision === "APPROVED" ? "COMPLETED" : "DRAFT",
          reviewedSnapshot: snapshot,
          acknowledgedWarningKeys,
        },
      });
      await audit(s, "ai_retirement.reviewed", "AiSystemRetirement", i.id, {
        decision: String(b.decision),
      });
      return detail(await load(i.id, s), s);
    },
  );
}
