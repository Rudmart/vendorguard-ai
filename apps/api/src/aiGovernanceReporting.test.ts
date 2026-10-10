import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it as test,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, databaseClient, Prisma } from "@vendorguard/database";
import { createSessionCookie } from "@vendorguard/auth";
import { server } from "./index.js";
import { loadReportData } from "./aiGovernanceReportData.js";
import { buildReport } from "./aiGovernanceReportMetrics.js";
import { renderGovernanceReportPdf } from "./aiGovernanceReportPdf.js";
import { safeAuditMetadata } from "./auditEvents.js";
import { buildExecutiveReport } from "./executiveReport.js";
import { ROLE_PERMISSIONS } from "@vendorguard/shared";
import type {
  GovernanceReport,
  ReportRecords,
  Role,
} from "@vendorguard/shared";
import type { Session } from "./aiControlEvidence.js";

const it = (name: string, fn: () => void | Promise<void>) =>
  test(name, fn, 20000);
const tenants: string[] = [],
  users: string[] = [];
const roles: Record<string, string> = {};
const ids: Record<string, string> = {};
const stamp = randomUUID(),
  DAY = 86400000;
let frameworkId: string | undefined,
  versionId: string | undefined,
  controlId: string | undefined;
let ip = 0;
function session(role: Role = "ADMIN", tenant = tenants[0]!): Session {
  return {
    userId: roles[role]!,
    tenantId: tenant,
    email: "report-test@example.com",
    displayName: "Reporting fixture",
    role,
  };
}
async function get(
  path: string,
  role: Role | null = "ADMIN",
  tenant = tenants[0]!,
) {
  const s = role ? session(role, tenant) : null;
  const response = await server.inject({
    method: "GET",
    url: path,
    remoteAddress: "10.98." + Math.floor(++ip / 250) + "." + (ip % 250),
    cookies: s ? { vg_session: createSessionCookie(s) } : {},
  });
  return response;
}
const value = (report: GovernanceReport, key: string) => {
  const m = report.metrics.find((m) => m.key === key);
  return m?.access === "AVAILABLE" ? m.value : undefined;
};
const report = async (query = "") =>
  (await get("/reports/ai-governance" + query)).json<GovernanceReport>();

beforeAll(async () => {
  server.log.level = "silent";
  for (const name of ["A", "B", "Empty"])
    tenants.push(
      (
        await prisma.tenant.create({
          data: { name: "Reporting " + name + " " + stamp },
        })
      ).id,
    );
  for (const role of [
    "ADMIN",
    "AUDITOR",
    "REVIEWER",
    "ANALYST",
    "READ_ONLY",
  ] as Role[]) {
    const user = await prisma.user.create({
      data: {
        externalId: stamp + role,
        email: stamp + role + "@example.com",
        displayName: "Reporting " + role,
      },
    });
    users.push(user.id);
    roles[role] = user.id;
    for (const tenantId of tenants)
      await prisma.tenantMembership.create({
        data: { tenantId, userId: user.id, role },
      });
  }
  for (const [key, tenantId, status] of [
    ["active", tenants[0]!, "PRODUCTION"],
    ["retired", tenants[0]!, "RETIRED"],
    ["foreign", tenants[1]!, "PRODUCTION"],
  ] as const) {
    ids[key] = (
      await prisma.aiSystem.create({
        data: {
          tenantId,
          name: "Report " + key,
          origin: "INTERNAL",
          lifecycleStatus: status,
          ownerUserId: roles.ADMIN,
          dataCategories: [],
          affectedPopulation: [],
          regulatoryRelevance: [],
        },
      })
    ).id;
  }
  const assessment = async (
    key: string,
    aiSystemId: string,
    version: number,
    status: "COMPLETED" | "DRAFT" | "READY_FOR_REVIEW",
  ) => {
    ids[key] = (
      await prisma.aiRiskAssessment.create({
        data: {
          tenantId: tenants[0]!,
          aiSystemId,
          name: key,
          version,
          status,
          reviewDecision: status === "COMPLETED" ? "APPROVED" : null,
          reviewerUserId: status === "COMPLETED" ? roles.REVIEWER : null,
          reviewedAt: status === "COMPLETED" ? new Date() : null,
        },
      })
    ).id;
    return ids[key]!;
  };
  await assessment("old", ids.active!, 1, "COMPLETED");
  await assessment("latest", ids.active!, 2, "COMPLETED");
  await assessment("draft", ids.active!, 3, "READY_FOR_REVIEW");
  await assessment("retiredDraft", ids.retired!, 1, "DRAFT");
  for (const [key, assessmentId, band] of [
    ["oldRisk", ids.old!, "CRITICAL"],
    ["risk", ids.latest!, "LOW"],
    ["draftRisk", ids.draft!, "HIGH"],
  ] as const) {
    ids[key] = (
      await prisma.aiRisk.create({
        data: {
          tenantId: tenants[0]!,
          assessmentId,
          title: key,
          category: "OPERATIONAL",
          statement: "fixture",
          likelihood: 2,
          impact: 2,
          inherentScore: 4,
          inherentRating: "LOW",
          residualRating: band,
          treatmentOwnerUserId: roles.ADMIN,
        },
      })
    ).id;
  }
  ids.impact = (
    await prisma.aiImpactAssessment.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.active!,
        name: "Impact",
        version: 1,
        status: "COMPLETED",
      },
    })
  ).id;
  ids.useCase = (
    await prisma.aiUseCase.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.active!,
        name: "Use case",
        businessPurpose: "fixture",
        affectedParties: [],
        createdByUserId: roles.ADMIN!,
        status: "PENDING_REVIEW",
      },
    })
  ).id;
  frameworkId = (
    await prisma.framework.create({
      data: {
        tenantId: tenants[0]!,
        catalogId: "s8-test-report-" + stamp,
        name: "Report framework",
        scope: "VENDOR_ASSESSMENT",
        industries: [],
      },
    })
  ).id;
  versionId = (
    await prisma.frameworkVersion.create({
      data: { frameworkId, version: "1.0", isCurrent: true },
    })
  ).id;
  controlId = (
    await prisma.control.create({
      data: {
        frameworkVersionId: versionId,
        controlId: "R-1",
        title: "Report control",
        summary: "fixture",
        domain: "fixture",
        expectedEvidenceTypes: [],
        validationGuidance: "fixture",
      },
    })
  ).id;
  ids.applicability = (
    await prisma.aiSystemFrameworkApplicability.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.active!,
        frameworkId,
        status: "APPLICABLE",
        rationale: "fixture",
        determinedAt: new Date(),
        determinedByUserId: roles.ADMIN,
      },
    })
  ).id;
  ids.control = (
    await prisma.aiSystemControl.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.active!,
        controlId,
        sourceApplicabilityId: ids.applicability!,
        applicability: "APPLICABLE",
        implementationStatus: "IMPLEMENTED",
      },
    })
  ).id;
  ids.test = (
    await prisma.aiControlTest.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemControlId: ids.control!,
        testerUserId: roles.ADMIN!,
        method: "DOCUMENT_REVIEW",
        procedure: "fixture",
        status: "COMPLETED",
        testDate: new Date(),
        overallEffectiveness: "INEFFECTIVE",
        nextTestDate: new Date(Date.now() - DAY),
      },
    })
  ).id;
  for (const [key, aiSystemId, status] of [
    ["incident", ids.active!, "OPEN"],
    ["closedIncident", ids.active!, "CLOSED"],
    ["retiredIncident", ids.retired!, "IN_PROGRESS"],
  ] as const) {
    ids[key] = (
      await prisma.aiIncident.create({
        data: {
          tenantId: tenants[0]!,
          aiSystemId,
          title: key,
          description: "fixture",
          severity: "HIGH",
          status,
          detectedAt: new Date(),
          reporterUserId: roles.ADMIN!,
          ownerUserId: roles.ANALYST,
        },
      })
    ).id;
  }
  ids.finding = (
    await prisma.governanceFinding.create({
      data: {
        tenantId: tenants[0]!,
        aiControlTestId: ids.test,
        title: "Linked finding",
        description: "fixture",
        severity: "HIGH",
        status: "OPEN",
        createdByUserId: roles.ADMIN!,
      },
    })
  ).id;
  for (const incidentId of [ids.incident!, ids.closedIncident!])
    await prisma.aiIncidentFinding.create({
      data: { tenantId: tenants[0]!, incidentId, findingId: ids.finding! },
    });
  ids.retiredFinding = (
    await prisma.governanceFinding.create({
      data: {
        tenantId: tenants[0]!,
        title: "Retired finding",
        description: "fixture",
        severity: "CRITICAL",
        status: "OPEN",
        createdByUserId: roles.ADMIN!,
      },
    })
  ).id;
  await prisma.aiIncidentFinding.create({
    data: {
      tenantId: tenants[0]!,
      incidentId: ids.retiredIncident!,
      findingId: ids.retiredFinding!,
    },
  });
  ids.remediation = (
    await prisma.remediationAction.create({
      data: {
        tenantId: tenants[0]!,
        governanceFindingId: ids.finding!,
        aiRiskId: ids.risk,
        title: "Dual-linked remediation",
        description: "fixture",
        status: "IN_PROGRESS",
        dueDate: new Date(Date.now() - DAY),
      },
    })
  ).id;
  ids.retiredRemediation = (
    await prisma.remediationAction.create({
      data: {
        tenantId: tenants[0]!,
        governanceFindingId: ids.retiredFinding!,
        title: "Retired remediation",
        description: "fixture",
        status: "PENDING_VERIFICATION",
      },
    })
  ).id;
  for (const [key, status, days] of [
    ["pending", "PENDING_REVIEW", 20],
    ["activeAcceptance", "APPROVED", 10],
    ["expired", "APPROVED", -1],
    ["rejected", "REJECTED", 10],
  ] as const) {
    ids[key] = (
      await prisma.riskAcceptance.create({
        data: {
          tenantId: tenants[0]!,
          aiRiskId: ids.risk,
          status,
          justification: "fixture",
          expiresAt: new Date(Date.now() + days * DAY),
          residualRatingAtRequest: "HIGH",
        },
      })
    ).id;
  }
  ids.monitor = (
    await prisma.aiMonitoringCheck.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.active!,
        title: "Overdue monitor",
        whatToReview: "fixture",
        expectation: "fixture",
        category: "OTHER",
        cadence: "MONTHLY",
        ownerUserId: roles.ADMIN!,
        createdByUserId: roles.ADMIN!,
        createdAt: new Date(Date.now() - 90 * DAY),
      },
    })
  ).id;
  ids.reassessment = (
    await prisma.aiReassessment.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.retired!,
        reason: "OTHER",
        whatChanged: "fixture",
        snapshotAtStart: {},
        initiatedByUserId: roles.ADMIN!,
        targetDate: new Date(Date.now() - DAY),
      },
    })
  ).id;
  ids.retirement = (
    await prisma.aiSystemRetirement.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.retired!,
        status: "COMPLETED",
        requesterUserId: roles.ADMIN!,
        reason: "OTHER",
        businessJustification: "fixture",
        requestedRetirementDate: new Date(),
        useCaseDisposition: "retained",
        monitoringDisposition: "inactive",
        retentionStatement: "retain",
      },
    })
  ).id;
  ids.evidence = (
    await prisma.evidenceDocument.create({
      data: {
        tenantId: tenants[0]!,
        aiSystemId: ids.active!,
        displayFilename: "restricted-fixture.pdf",
        documentType: "OTHER",
        mimeType: "application/pdf",
        storageKey: "NEVER-RETURN-STORAGE",
        state: "QUARANTINED",
        uploadedByUserId: roles.ADMIN!,
        sizeBytes: 1,
        sha256Hash: "a".repeat(64),
        expirationDate: new Date(Date.now() - DAY),
      },
    })
  ).id;
  await prisma.aiSystemControlEvidence.create({
    data: {
      tenantId: tenants[0]!,
      aiSystemControlId: ids.control!,
      evidenceDocumentId: ids.evidence!,
      submittedByUserId: roles.ADMIN!,
      status: "ACCEPTED",
    },
  });
  ids.vendor = (
    await prisma.vendor.create({
      data: {
        tenantId: tenants[0]!,
        legalName: "Report vendor",
        serviceDescription: "fixture",
        serviceCategory: "fixture",
        criticality: "LOW",
      },
    })
  ).id;
  ids.foreignAudit = (
    await prisma.auditEvent.create({
      data: {
        tenantId: tenants[1]!,
        action: "report-fixture",
        outcome: "SUCCESS",
      },
    })
  ).id;
}, 30000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (tenants.length) {
    const tenantId = { in: tenants };
    await prisma.aiIncidentFinding.deleteMany({ where: { tenantId } });
    await prisma.aiIncidentReview.deleteMany({ where: { tenantId } });
    await prisma.aiIncident.deleteMany({ where: { tenantId } });
    await prisma.aiSystemRetirementReview.deleteMany({ where: { tenantId } });
    await prisma.aiSystemRetirement.deleteMany({ where: { tenantId } });
    await prisma.aiReassessment.deleteMany({ where: { tenantId } });
    await prisma.aiMonitoringCheck.deleteMany({ where: { tenantId } });
    await prisma.riskAcceptance.deleteMany({ where: { tenantId } });
    await prisma.remediationAction.deleteMany({ where: { tenantId } });
    await prisma.governanceFinding.deleteMany({ where: { tenantId } });
    await prisma.aiControlTest.deleteMany({ where: { tenantId } });
    await prisma.aiSystemControlEvidence.deleteMany({ where: { tenantId } });
    await prisma.evidenceDocument.deleteMany({ where: { tenantId } });
    await prisma.aiSystemControl.deleteMany({ where: { tenantId } });
    await prisma.aiSystemFrameworkApplicability.deleteMany({
      where: { tenantId },
    });
    await prisma.aiRisk.deleteMany({ where: { tenantId } });
    await prisma.aiRiskAssessment.deleteMany({ where: { tenantId } });
    await prisma.aiImpactAssessment.deleteMany({ where: { tenantId } });
    await prisma.aiUseCase.deleteMany({ where: { tenantId } });
    await prisma.aiSystem.deleteMany({ where: { tenantId } });
    await prisma.vendor.deleteMany({ where: { tenantId } });
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  }
  if (controlId) await prisma.control.deleteMany({ where: { id: controlId } });
  if (versionId)
    await prisma.frameworkVersion.deleteMany({ where: { id: versionId } });
  if (frameworkId)
    await prisma.framework.deleteMany({ where: { id: frameworkId } });
  if (tenants.length)
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  if (users.length)
    await prisma.user.deleteMany({ where: { id: { in: users } } });
}, 30000);

describe("Reporting authentication and permissions", () => {
  it("requires a signed session", async () =>
    expect((await get("/reports/ai-governance", null)).statusCode).toBe(401));
  for (const role of [
    "ADMIN",
    "AUDITOR",
    "REVIEWER",
    "ANALYST",
    "READ_ONLY",
  ] as Role[]) {
    it(role + " report permission", async () =>
      expect((await get("/reports/ai-governance", role)).statusCode).toBe(
        ["ADMIN", "AUDITOR", "REVIEWER"].includes(role) ? 200 : 403,
      ),
    );
    it(role + " PDF export permission", async () =>
      expect(
        (await get("/reports/ai-governance/export", role)).statusCode,
      ).toBe(["ADMIN", "AUDITOR"].includes(role) ? 200 : 403),
    );
    it(role + " audit permission", async () =>
      expect((await get("/audit-events", role)).statusCode).toBe(
        ["ADMIN", "AUDITOR"].includes(role) ? 200 : 403,
      ),
    );
  }
  it("uses current membership rather than cookie role", async () => {
    await prisma.tenantMembership.update({
      where: {
        tenantId_userId: { tenantId: tenants[0]!, userId: roles.REVIEWER! },
      },
      data: { role: "READ_ONLY" },
    });
    try {
      expect((await get("/reports/ai-governance", "REVIEWER")).statusCode).toBe(
        403,
      );
    } finally {
      await prisma.tenantMembership.update({
        where: {
          tenantId_userId: { tenantId: tenants[0]!, userId: roles.REVIEWER! },
        },
        data: { role: "REVIEWER" },
      });
    }
  });
  it("removed membership loses access", async () => {
    await prisma.tenantMembership.delete({
      where: {
        tenantId_userId: { tenantId: tenants[0]!, userId: roles.REVIEWER! },
      },
    });
    try {
      expect((await get("/reports/ai-governance", "REVIEWER")).statusCode).toBe(
        401,
      );
    } finally {
      await prisma.tenantMembership.create({
        data: {
          tenantId: tenants[0]!,
          userId: roles.REVIEWER!,
          role: "REVIEWER",
        },
      });
    }
  });
});
describe("Reporting tenant, validation and evidence boundaries", () => {
  for (const suffix of ["", "/export", "/records?metric=incidents.OPEN&"])
    it("rejects foreign system filter " + suffix, async () => {
      const path =
        "/reports/ai-governance" +
        suffix +
        (suffix.includes("?") ? "" : "?") +
        "aiSystemId=" +
        ids.foreign;
      expect((await get(path)).statusCode).toBe(404);
    });
  for (const query of [
    "?tenantId=" + randomUUID(),
    "?lifecycleScope=bad",
    "?aiSystemId=bad",
    "/records?metric=bad",
    "/records?metric=incidents.OPEN&limit=101",
    "/records?metric=incidents.OPEN&limit=0",
  ])
    it("rejects invalid query " + query, async () =>
      expect((await get("/reports/ai-governance" + query)).statusCode).toBe(
        400,
      ),
    );
  it("has private no-store responses", async () =>
    expect((await get("/reports/ai-governance")).headers["cache-control"]).toBe(
      "private, no-store",
    ));
  it("restricted evidence has no value/denominator/source information", async () => {
    const response = await get("/reports/ai-governance", "REVIEWER");
    const body = response.json<GovernanceReport>();
    for (const m of body.metrics.filter((m) => m.section === "Evidence")) {
      expect(m.access).toBe("RESTRICTED");
      expect(m).not.toHaveProperty("value");
      expect(m).not.toHaveProperty("denominator");
    }
    expect(response.body).not.toContain("restricted-fixture");
    expect(response.body).not.toContain(ids.evidence);
  });
  it("denies restricted evidence drill-down", async () =>
    expect(
      (
        await get(
          "/reports/ai-governance/records?metric=evidence.total",
          "REVIEWER",
        )
      ).statusCode,
    ).toBe(403));
  it("metadata reader sees assurance but no storage keys", async () => {
    const response = await get(
      "/reports/ai-governance/records?metric=evidence.total",
      "AUDITOR",
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(ids.evidence);
    expect(response.body).not.toContain("NEVER-RETURN-STORAGE");
  });
  it("report permissions do not grant evidence-file access", async () =>
    expect(
      (await get("/evidence/" + ids.evidence + "/download", "AUDITOR"))
        .statusCode,
    ).toBe(403));
  it("empty tenant reports actual zero without invented denominators", async () => {
    const r = (
      await get("/reports/ai-governance", "ADMIN", tenants[2]!)
    ).json<GovernanceReport>();
    expect(value(r, "systems.operational")).toBe(0);
    expect(r.metrics.find((m) => m.key === "risk.coverage")).toMatchObject({
      value: 0,
      denominator: 0,
    });
  });
});
describe("Reporting authoritative metrics and traceability", () => {
  it("separates operational/retired systems", async () => {
    const r = await report();
    expect(value(r, "systems.operational")).toBe(1);
    expect(value(r, "systems.historical")).toBe(1);
  });
  it("keeps newer drafts separate from completed assessment coverage", async () => {
    const r = await report();
    expect(r.metrics.find((m) => m.key === "risk.coverage")).toMatchObject({
      value: 1,
      denominator: 1,
    });
    expect(value(r, "riskAssessments.READY_FOR_REVIEW")).toBe(1);
  });
  it("counts risk items only from latest completed versions", async () => {
    const r = await report();
    expect(value(r, "risks.LOW")).toBe(1);
    expect(value(r, "risks.CRITICAL")).toBe(0);
    expect(value(r, "risks.HIGH")).toBe(0);
  });
  it("historical scope does not pollute operational risk posture", async () => {
    const r = await report("?lifecycleScope=historical");
    expect(value(r, "riskAssessments.DRAFT")).toBe(1);
    expect(value(r, "risks.LOW")).toBe(0);
  });
  it("deduplicates control/incident findings", async () => {
    const r = await report();
    expect(value(r, "findings.OPEN")).toBe(1);
    expect(value(r, "findings.highCritical")).toBe(1);
  });
  it("deduplicates remediation associated by two paths", async () => {
    const r = await report();
    expect(value(r, "remediation.IN_PROGRESS")).toBe(1);
    expect(value(r, "remediation.overdue")).toBe(1);
  });
  it("retains retired-system obligations even in operational report", async () => {
    const r = await get(
      "/reports/ai-governance/records?metric=historical.followUp",
    );
    const body = r.json<ReportRecords>();
    expect(body.records.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        ids.retiredIncident,
        ids.retiredFinding,
        ids.retiredRemediation,
        ids.retiredDraft,
        ids.reassessment,
      ]),
    );
  });
  it("keeps closed incidents distinct", async () => {
    const r = await report();
    expect(value(r, "incidents.OPEN")).toBe(1);
    expect(value(r, "incidents.CLOSED")).toBe(1);
    expect(value(r, "incidentSeverity.HIGH")).toBe(1);
  });
  it("reports active/expired/pending/rejected acceptance states", async () => {
    const r = await report();
    for (const state of ["ACTIVE", "EXPIRED", "PENDING_REVIEW", "REJECTED"])
      expect(value(r, "acceptances." + state)).toBe(1);
    expect(value(r, "acceptances.expiring")).toBe(1);
  });
  it("uses existing monitoring due rules", async () =>
    expect(value(await report(), "monitoring.OVERDUE")).toBe(1));
  it("reports unfinished retired reassessments without completing them", async () =>
    expect(
      value(
        await report("?lifecycleScope=historical"),
        "reassessments.overdue",
      ),
    ).toBe(1));
  it("keeps implementation, testing and evidence assurance separate", async () => {
    const r = await report();
    expect(value(r, "implementation.IMPLEMENTED")).toBe(1);
    expect(value(r, "effectiveness.INEFFECTIVE")).toBe(1);
    expect(value(r, "assurance.ACCEPTED")).toBe(1);
    expect(value(r, "evidence.QUARANTINED")).toBe(1);
  });
  it("has exact metric-to-record parity, source version and human decision", async () => {
    const summary = await report();
    const detail = (
      await get(
        "/reports/ai-governance/records?metric=riskAssessments.COMPLETED",
      )
    ).json<ReportRecords>();
    expect(detail.total).toBe(value(summary, "riskAssessments.COMPLETED"));
    expect(detail.records.find((r) => r.id === ids.latest)).toMatchObject({
      version: 2,
      href: "/ai-risk-assessments/" + ids.latest,
    });
    expect(
      detail.records.find((r) => r.id === ids.latest)?.decisions[0]
        ?.actorUserId,
    ).toBe(roles.REVIEWER);
  });
  it("bounded drill-down pagination does not duplicate records", async () => {
    const first = (
      await get(
        "/reports/ai-governance/records?metric=riskAssessments.COMPLETED&limit=1",
      )
    ).json<ReportRecords>();
    const second = (
      await get(
        "/reports/ai-governance/records?metric=riskAssessments.COMPLETED&limit=1&cursor=" +
          first.nextCursor,
      )
    ).json<ReportRecords>();
    expect(first.records).toHaveLength(1);
    expect(second.records).toHaveLength(1);
    expect(first.records[0]?.id).not.toBe(second.records[0]?.id);
    expect(second.nextCursor).toBeNull();
  });
  it("rejects a cursor outside the current result", async () =>
    expect(
      (
        await get(
          "/reports/ai-governance/records?metric=incidents.OPEN&cursor=AiIncident:" +
            ids.retiredIncident,
        )
      ).statusCode,
    ).toBe(400));
  it("dashboard uses identical report metrics, separate from personal work", async () => {
    const d = (await get("/dashboard/summary", "REVIEWER")).json<{
      governanceReport: GovernanceReport;
      attention: Record<string, number>;
      posture: Record<string, number>;
    }>();
    expect(d.posture.aiSystems).toBe(
      value(d.governanceReport, "systems.operational"),
    );
    expect(d.attention.findingsOpen).toBe(
      value(d.governanceReport, "findings.OPEN"),
    );
    expect(
      d.governanceReport.metrics.some((m) => /My Work|for you/i.test(m.label)),
    ).toBe(false);
  });
  it("does not expose consolidated report to legacy dashboard roles", async () =>
    expect(
      (await get("/dashboard/summary", "ANALYST")).json(),
    ).not.toHaveProperty("governanceReport"));
  it("PDF uses the authorized snapshot and source manifest", async () => {
    const data = await loadReportData(session()),
      built = buildReport(data, { lifecycleScope: "operational" });
    const pdf = await renderGovernanceReportPdf(built.report, built.records);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.toString("latin1")).toContain(
      Buffer.from(built.report.generatedAt).toString("hex"),
    );
  });
  it("PDF appendix limit is disclosed", async () => {
    const data = await loadReportData(session()),
      built = buildReport(data, { lifecycleScope: "operational" }),
      r = built.records.get("systems.operational")![0]!;
    const many = new Map([
      [
        "fixture",
        Array.from({ length: 201 }, (_, i) => ({ ...r, id: String(i) })),
      ],
    ]);
    const pdf = await renderGovernanceReportPdf(built.report, many);
    expect(pdf.toString("latin1")).toContain(
      Buffer.from("Appendix bounded").toString("hex"),
    );
  });
  it("bounded sources fail explicitly instead of silently truncating", async () => {
    vi.spyOn(databaseClient, "$transaction").mockImplementationOnce((async (
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) =>
      fn({
        aiSystem: {
          findMany: async () =>
            Array.from({ length: 5001 }, () => ({ id: "fixture" })),
        },
      } as unknown as Prisma.TransactionClient)) as typeof databaseClient.$transaction);
    expect((await get("/reports/ai-governance")).statusCode).toBe(413);
  });
  it("repeatable snapshot remains coherent during a concurrent lifecycle update", async () => {
    const original = databaseClient.$transaction.bind(databaseClient);
    vi.spyOn(databaseClient, "$transaction").mockImplementationOnce((async (
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: unknown,
    ) =>
      original(
        async (tx) => {
          await tx.aiSystem.count({ where: { tenantId: tenants[0]! } });
          await databaseClient.aiSystem.update({
            where: { id: ids.active! },
            data: { lifecycleStatus: "RETIRED" },
          });
          return fn(tx);
        },
        options as {
          isolationLevel: Prisma.TransactionIsolationLevel;
          timeout: number;
        },
      )) as typeof databaseClient.$transaction);
    try {
      const r = await report();
      expect(value(r, "systems.operational")).toBe(1);
      expect(value(r, "risk.coverage")).toBe(1);
    } finally {
      await databaseClient.aiSystem.update({
        where: { id: ids.active! },
        data: { lifecycleStatus: "PRODUCTION" },
      });
    }
  });
  it("reporting leaves authoritative records unchanged", async () => {
    const before = await prisma.aiSystem.findMany({
      where: { tenantId: tenants[0]! },
      orderBy: { id: "asc" },
    });
    const findingBefore = await prisma.governanceFinding.findMany({
      where: { tenantId: tenants[0]! },
      orderBy: { id: "asc" },
    });
    await report();
    await get("/reports/ai-governance/export");
    expect(
      await prisma.aiSystem.findMany({
        where: { tenantId: tenants[0]! },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(
      await prisma.governanceFinding.findMany({
        where: { tenantId: tenants[0]! },
        orderBy: { id: "asc" },
      }),
    ).toEqual(findingBefore);
    expect(
      (
        await prisma.aiRiskAssessment.findUniqueOrThrow({
          where: { id: ids.retiredDraft! },
        })
      ).status,
    ).toBe("DRAFT");
  });
});
describe("Reporting metric boundaries", () => {
  it("expiration equal to generation time remains ACTIVE per existing acceptance rule", async () => {
    const data = await loadReportData(session());
    data.generatedAt = new Date("2026-10-09T00:00:00Z");
    data.acceptances = data.acceptances
      .filter((a) => a.id === ids.activeAcceptance)
      .map((a) => ({ ...a, expiresAt: new Date(data.generatedAt) }));
    const built = buildReport(data, { lifecycleScope: "operational" });
    expect(value(built.report, "acceptances.ACTIVE")).toBe(1);
    expect(value(built.report, "acceptances.EXPIRED")).toBe(0);
  });
  it("expiration before generation is EXPIRED", async () => {
    const data = await loadReportData(session());
    data.acceptances = data.acceptances
      .filter((a) => a.id === ids.activeAcceptance)
      .map((a) => ({
        ...a,
        expiresAt: new Date(data.generatedAt.getTime() - 1),
      }));
    expect(
      value(
        buildReport(data, { lifecycleScope: "operational" }).report,
        "acceptances.EXPIRED",
      ),
    ).toBe(1);
  });
  it("due date equal to generation time is not overdue", async () => {
    const data = await loadReportData(session());
    data.remediations = data.remediations.map((r) => ({
      ...r,
      dueDate: new Date(data.generatedAt),
    }));
    expect(
      value(
        buildReport(data, { lifecycleScope: "all" }).report,
        "remediation.overdue",
      ),
    ).toBe(0);
  });
  it("closed remediation is not overdue even with a past date", async () => {
    const data = await loadReportData(session());
    data.remediations = data.remediations.map((r) => ({
      ...r,
      status: "CLOSED" as const,
      dueDate: new Date(0),
    }));
    expect(
      value(
        buildReport(data, { lifecycleScope: "all" }).report,
        "remediation.overdue",
      ),
    ).toBe(0);
  });
  it("no completed risk version means unknown posture rather than draft risk counts", async () => {
    const data = await loadReportData(session());
    data.riskAssessments = data.riskAssessments.map((a) => ({
      ...a,
      status: "DRAFT" as const,
    }));
    const r = buildReport(data, { lifecycleScope: "operational" }).report;
    expect(value(r, "risk.missing")).toBe(1);
    expect(value(r, "risks.HIGH")).toBe(0);
    expect(value(r, "risks.LOW")).toBe(0);
  });
  it("inactive monitoring is separate from overdue", async () => {
    const data = await loadReportData(session());
    data.monitoring = data.monitoring.map((m) => ({ ...m, active: false }));
    const r = buildReport(data, { lifecycleScope: "all" }).report;
    expect(value(r, "monitoring.INACTIVE")).toBe(1);
    expect(value(r, "monitoring.OVERDUE")).toBe(0);
  });
  it("evidence-restricted reporting never touches evidence delegates", async () => {
    const original = databaseClient.$transaction.bind(databaseClient);
    vi.spyOn(databaseClient, "$transaction").mockImplementationOnce((async (
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: unknown,
    ) =>
      original(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(target, key) {
                if (
                  [
                    "evidenceDocument",
                    "aiSystemControlEvidence",
                    "aiIncidentEvidence",
                    "aiSystemRetirementEvidence",
                  ].includes(String(key))
                )
                  throw new Error("Restricted evidence delegate touched");
                return Reflect.get(target, key);
              },
            }),
          ),
        options as {
          isolationLevel: Prisma.TransactionIsolationLevel;
          timeout: number;
        },
      )) as typeof databaseClient.$transaction);
    expect((await get("/reports/ai-governance", "REVIEWER")).statusCode).toBe(
      200,
    );
  });
  it("ALL scope deduplicates active and retired findings", async () => {
    const r = await report("?lifecycleScope=all");
    expect(value(r, "findings.OPEN")).toBe(2);
    expect(value(r, "remediation.PENDING_VERIFICATION")).toBe(1);
  });
  it("reporting does not mutate any queried governance domain", async () => {
    const snapshot = () =>
      databaseClient.$transaction([
        prisma.aiSystem.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiRiskAssessment.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiImpactAssessment.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiUseCase.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiSystemControl.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiControlTest.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiIncident.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.governanceFinding.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.remediationAction.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.riskAcceptance.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiMonitoringCheck.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiReassessment.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.aiSystemRetirement.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
        prisma.evidenceDocument.findMany({
          where: { tenantId: tenants[0]! },
          orderBy: { id: "asc" },
        }),
      ]);
    const before = await snapshot();
    await report("?lifecycleScope=all");
    await get("/reports/ai-governance/export");
    expect(await snapshot()).toEqual(before);
  });
});
describe("Reporting cross-tenant relationship regressions", () => {
  it("private frameworks cannot leak through stale foreign relationships", async () => {
    await prisma.framework.update({
      where: { id: frameworkId! },
      data: { tenantId: tenants[1]! },
    });
    try {
      const r = await report();
      expect(value(r, "frameworks.APPLICABLE")).toBe(0);
      expect(value(r, "controls.APPLICABLE")).toBe(0);
    } finally {
      await prisma.framework.update({
        where: { id: frameworkId! },
        data: { tenantId: tenants[0]! },
      });
    }
  });
  it("control applicability must belong to the same AI system", async () => {
    await prisma.aiSystemFrameworkApplicability.update({
      where: { id: ids.applicability! },
      data: { aiSystemId: ids.retired! },
    });
    try {
      expect(value(await report(), "controls.APPLICABLE")).toBe(0);
    } finally {
      await prisma.aiSystemFrameworkApplicability.update({
        where: { id: ids.applicability! },
        data: { aiSystemId: ids.active! },
      });
    }
  });
  it("foreign evidence cannot leak through a stale control link", async () => {
    let documentId: string | undefined, linkId: string | undefined;
    try {
      documentId = (
        await prisma.evidenceDocument.create({
          data: {
            tenantId: tenants[1]!,
            aiSystemId: ids.foreign!,
            displayFilename: "FOREIGN-EVIDENCE-DO-NOT-LEAK",
            documentType: "OTHER",
            mimeType: "application/pdf",
            storageKey: "fixture",
            sha256Hash: "b".repeat(64),
            sizeBytes: 1,
            uploadedByUserId: roles.ADMIN!,
            state: "INDEXED",
          },
        })
      ).id;
      linkId = (
        await prisma.aiSystemControlEvidence.create({
          data: {
            tenantId: tenants[0]!,
            aiSystemControlId: ids.control!,
            evidenceDocumentId: documentId,
            submittedByUserId: roles.ADMIN!,
          },
        })
      ).id;
      const r = await get(
        "/reports/ai-governance/records?metric=evidence.total",
      );
      expect(r.body).not.toContain(documentId);
      expect(r.body).not.toContain("FOREIGN-EVIDENCE-DO-NOT-LEAK");
      expect(r.json<ReportRecords>().total).toBe(1);
    } finally {
      if (linkId)
        await prisma.aiSystemControlEvidence.deleteMany({
          where: { id: linkId },
        });
      if (documentId)
        await prisma.evidenceDocument.deleteMany({ where: { id: documentId } });
    }
  });
});
describe("Audit and legacy vendor report regressions", () => {
  it("legacy reports explicitly enforce vendor:read and audit denial", async () => {
    const original = ROLE_PERMISSIONS.REVIEWER;
    ROLE_PERMISSIONS.REVIEWER = original.filter((p) => p !== "vendor:read");
    try {
      expect(
        (await get("/vendors/" + ids.vendor + "/executive-report", "REVIEWER"))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await get(
            "/vendors/" + ids.vendor + "/executive-report/export",
            "REVIEWER",
          )
        ).statusCode,
      ).toBe(403);
      expect(
        await prisma.auditEvent.count({
          where: { tenantId: tenants[0]!, action: "report.denied" },
        }),
      ).toBeGreaterThan(0);
    } finally {
      ROLE_PERMISSIONS.REVIEWER = original;
    }
  });
  it("audit display rejects arbitrary text even under an allowed key", () =>
    expect(
      safeAuditMetadata({
        format: "sensitive secret",
        operation: "untrusted narrative",
        records: -1,
      }),
    ).toEqual({}));

  it("records report generation/export/denial", async () => {
    await report();
    await get("/reports/ai-governance/export");
    await get("/reports/ai-governance", "READ_ONLY");
    for (const action of [
      "governance_report.generated",
      "governance_report.exported",
      "governance_report.denied",
    ])
      expect(
        await prisma.auditEvent.count({
          where: { tenantId: tenants[0]!, action },
        }),
      ).toBeGreaterThan(0);
  });
  it("audit failure prevents export delivery", async () => {
    const original = databaseClient.auditEvent.create;
    databaseClient.auditEvent.create = vi
      .fn()
      .mockRejectedValueOnce(new Error("simulated audit failure"))
      .mockImplementation(original) as typeof original;
    try {
      const r = await get("/reports/ai-governance/export");
      expect(r.statusCode).toBe(500);
      expect(r.headers["content-type"]).not.toContain("pdf");
    } finally {
      databaseClient.auditEvent.create = original;
    }
  });
  it("audit action/target/time filtering and stable pagination", async () => {
    const path =
      "/audit-events?action=governance_report.generated&targetType=GovernanceReport&from=2020-01-01T00:00:00Z&to=2099-01-01T00:00:00Z&limit=1";
    const first = (await get(path)).json<{
      events: { id: string; action: string }[];
      nextCursor: string;
    }>();
    const second = (await get(path + "&cursor=" + first.nextCursor)).json<{
      events: { id: string }[];
    }>();
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.action).toBe("governance_report.generated");
    expect(second.events[0]?.id).not.toBe(first.events[0]?.id);
  });
  it("audit rejects cross-tenant cursor", async () =>
    expect(
      (await get("/audit-events?cursor=" + ids.foreignAudit)).statusCode,
    ).toBe(400));
  for (const query of [
    "?limit=101",
    "?from=invalid",
    "?from=2099-01-01T00:00:00Z&to=2020-01-01T00:00:00Z",
    "?tenantId=" + randomUUID(),
  ])
    it("audit validates " + query, async () =>
      expect((await get("/audit-events" + query)).statusCode).toBe(400),
    );
  it("audit target ID filter cannot disclose foreign events", async () =>
    expect(
      (await get("/audit-events?targetId=" + ids.foreignAudit)).json().events,
    ).toEqual([]));
  it("safe audit metadata excludes narratives and credentials", () =>
    expect(
      safeAuditMetadata({
        format: "PDF",
        password: "secret fixture",
        rationale: "sensitive",
        token: "fixture",
        nested: {},
      }),
    ).toEqual({ format: "PDF" }));
  it("legacy vendor report redacts unauthorized evidence summary", async () => {
    const response = await get(
      "/vendors/" + ids.vendor + "/executive-report",
      "REVIEWER",
    );
    expect(response.statusCode, response.body).toBe(200);
    const r = response.json();
    expect(r.evidenceStatus).toEqual({ access: "RESTRICTED" });
    expect(r.evidenceStatus).not.toHaveProperty("total");
  });
  it("legacy builder defaults to restricted evidence", async () =>
    expect(
      (await buildExecutiveReport(tenants[0]!, ids.vendor!))?.evidenceStatus,
    ).toEqual({ access: "RESTRICTED" }));
  it("legacy vendor report does not cross tenants", async () =>
    expect(
      (
        await get(
          "/vendors/" + ids.vendor + "/executive-report",
          "ADMIN",
          tenants[1]!,
        )
      ).statusCode,
    ).toBe(404));
});
