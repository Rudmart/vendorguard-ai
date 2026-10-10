import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it as test,
  expect,
  vi,
} from "vitest";
import { prisma, databaseClient, type Role } from "@vendorguard/database";
import { createSessionCookie } from "@vendorguard/auth";
import { server } from "./index.js";
import { pendingReviewsFor, myWorkFor } from "./aiWorkQueues.js";
let tenant: string, foreign: string, framework: string, controlId: string;
const users: Record<string, string> = {};
let sequence = 0;
let rollbackId: string | null = null;
const pendingOperations = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
let draining = false;
function tracked<T>(operation: Promise<T>): Promise<T> {
  pendingOperations.add(operation);
  void operation.then(
    () => pendingOperations.delete(operation),
    () => pendingOperations.delete(operation),
  );
  return operation;
}
// Vitest timeouts do not cancel bodies; they can start more fixture requests.
function it(name: string, body: () => void | Promise<void>) {
  test(name, () => tracked(Promise.resolve().then(body)));
}
async function drainPending() {
  draining = true;
  try {
    do {
      for (const release of releases) release();
      await Promise.allSettled([...pendingOperations]);
    } while (pendingOperations.size);
  } finally {
    releases.clear();
    draining = false;
  }
}
beforeEach(drainPending);
afterEach(drainPending);
function session(role = "ADMIN", t = tenant) {
  return {
    userId: users[role]!,
    tenantId: t,
    role: role === "SECOND_ADMIN" ? "ADMIN" : role,
    email: "retirement@example.com",
    displayName: "Retirement fixture",
  };
}
async function call(
  method: "GET" | "POST" | "PATCH",
  path: string,
  payload?: object,
  role = "ADMIN",
  t = tenant,
) {
  const r = await tracked(
    server.inject({
      method,
      url: path,
      payload,
      cookies: { vg_session: createSessionCookie(session(role, t)) },
      remoteAddress: `10.91.${Math.floor(++sequence / 250)}.${sequence % 250}`,
    }),
  );
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
async function sys(owner = users.ANALYST!, t = tenant) {
  return (
    await prisma.aiSystem.create({
      data: {
        tenantId: t,
        name: "Retirement fixture",
        origin: "INTERNAL",
        ownerUserId: owner,
      },
    })
  ).id;
}
const fields = {
  reason: "NO_LONGER_NEEDED",
  businessJustification: "Replaced service; preserve all accountability",
  requestedRetirementDate: "2026-01-01",
  cessationConfirmed: true,
  useCaseDisposition:
    "Retire associated use cases and retain their approval history",
  monitoringDisposition:
    "Deactivate operational monitoring while retaining reviews",
  retentionStatement: "Retain all governance records and evidence",
};
async function ds(id: string) {
  const r = await call("GET", `/ai-systems/${id}/retirement-readiness`);
  expect(r.status).toBe(200);
  return r.body.warnings.map((w: { key: string }) => ({
    key: w.key,
    remainingWork: "Identified unfinished governance obligation",
    whyProceed:
      "Operational use has ceased; accountable follow-up is documented",
    ownerUserId: users.ADMIN,
    followUpPlan:
      "Responsible owner retains and follows up the historical obligation",
  }));
}
async function draft(id?: string, extra: object = {}) {
  id ??= await sys();
  const r = await call("POST", `/ai-systems/${id}/retirements`, {
    ...fields,
    warningDispositions: await ds(id),
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function pending(id?: string) {
  const d = await draft(id);
  const r = await call(
    "POST",
    `/ai-retirements/${d.id}/submit`,
    { revision: d.revision },
    "ANALYST",
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
function reviewBody(
  i: {
    revision: number;
    readinessSnapshot: { token: string };
    readiness: { warnings: { key: string }[] };
  },
  extra: object = {},
) {
  return {
    revision: i.revision,
    decision: "APPROVED",
    rationale:
      "Independent reviewer confirms cessation and documented follow-up",
    readinessToken: i.readinessSnapshot.token,
    acknowledgedWarningKeys: i.readiness.warnings.map((w) => w.key),
    ...extra,
  };
}
async function approve(
  i: Parameters<typeof reviewBody>[0] & { id: string },
  extra: object = {},
  role = "REVIEWER",
) {
  return call(
    "POST",
    `/ai-retirements/${i.id}/review`,
    reviewBody(i, extra),
    role,
  );
}
async function control(sysId: string) {
  const applicability = await prisma.aiSystemFrameworkApplicability.create({
    data: {
      tenantId: tenant,
      aiSystemId: sysId,
      frameworkId: framework,
      status: "APPLICABLE",
      rationale: "Fixture",
      determinedAt: new Date(),
    },
  });
  return prisma.aiSystemControl.create({
    data: {
      tenantId: tenant,
      aiSystemId: sysId,
      controlId,
      sourceApplicabilityId: applicability.id,
    },
  });
}
async function finding(
  sysId: string,
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  status: "OPEN" | "PENDING_REVIEW" | "DISMISSED" = "OPEN",
) {
  const c = await control(sysId);
  const test = await prisma.aiControlTest.create({
    data: {
      tenantId: tenant,
      aiSystemControlId: c.id,
      testerUserId: users.REVIEWER!,
      method: "SAMPLE_TESTING",
      procedure: "Fixture",
      status: "COMPLETED",
    },
  });
  return prisma.governanceFinding.create({
    data: {
      tenantId: tenant,
      aiControlTestId: test.id,
      title: "Governance deficiency",
      description: "Fixture",
      severity,
      status,
      createdByUserId: users.ADMIN!,
    },
  });
}
async function evidence(id: string, t = tenant) {
  return prisma.evidenceDocument.create({
    data: {
      tenantId: t,
      aiSystemId: id,
      displayFilename: "Retirement policy.pdf",
      storageKey: `retirement-${Math.random()}`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      sha256Hash: "fixture",
      documentType: "Policy",
      uploadedByUserId: users.ADMIN!,
      state: "INDEXED",
    },
  });
}
beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  tenant = (await prisma.tenant.create({ data: { name: "Retirement test A" } }))
    .id;
  foreign = (
    await prisma.tenant.create({ data: { name: "Retirement test B" } })
  ).id;
  for (const role of [
    "ADMIN",
    "ANALYST",
    "REVIEWER",
    "AUDITOR",
    "READ_ONLY",
    "SECOND_ADMIN",
  ]) {
    users[role] = (
      await prisma.user.create({
        data: {
          externalId: `retirement-${role}-${stamp}`,
          email: `retirement-${role}-${stamp}@example.com`,
          displayName: role,
        },
      })
    ).id;
    await prisma.tenantMembership.create({
      data: {
        tenantId: tenant,
        userId: users[role]!,
        role: (role === "SECOND_ADMIN" ? "ADMIN" : role) as Role,
      },
    });
  }
  await prisma.tenantMembership.create({
    data: { tenantId: foreign, userId: users.ADMIN!, role: "ADMIN" },
  });
  framework = (
    await prisma.framework.create({
      data: {
        catalogId: `s8-test-retirement-${stamp}`,
        name: "Retirement fixture",
        scope: "VENDOR_ASSESSMENT",
        industries: [],
      },
    })
  ).id;
  const v = await prisma.frameworkVersion.create({
    data: { frameworkId: framework, version: "1", isCurrent: true },
  });
  controlId = (
    await prisma.control.create({
      data: {
        frameworkVersionId: v.id,
        controlId: "RET-1",
        title: "Fixture",
        summary: "Fixture",
        domain: "Test",
        expectedEvidenceTypes: [],
        validationGuidance: "Fixture",
      },
    })
  ).id;
  databaseClient.$use(async (params, next) => {
    if (
      rollbackId &&
      params.model === "AuditEvent" &&
      params.action === "create" &&
      params.args.data.action === "ai_retirement.completed" &&
      params.args.data.targetId === rollbackId
    )
      throw Error("Simulated audit failure");
    return next(params);
  });
}, 30000);
type CatalogCleanupClient = {
  control: { deleteMany(args: { where: { id: string } }): Promise<unknown> };
  frameworkVersion: {
    deleteMany(args: { where: { frameworkId: string } }): Promise<unknown>;
  };
  framework: { delete(args: { where: { id: string } }): Promise<unknown> };
};
async function cleanupCatalogFixtures(
  ids: { controlId?: string; frameworkId?: string },
  client: CatalogCleanupClient = prisma,
) {
  if (ids.controlId)
    await client.control.deleteMany({ where: { id: ids.controlId } });
  if (ids.frameworkId)
    await client.frameworkVersion.deleteMany({
      where: { frameworkId: ids.frameworkId },
    });
  if (ids.frameworkId)
    await client.framework.delete({ where: { id: ids.frameworkId } });
}

afterAll(async () => {
  await drainPending();
  rollbackId = null;
  const tenantIds = [tenant, foreign].filter((id): id is string => !!id);
  const where = { tenantId: { in: tenantIds } };
  for (const model of [
    "aiSystemRetirementReview",
    "aiSystemRetirementEvidence",
    "aiSystemRetirement",
    "aiIncidentReview",
    "aiIncidentFinding",
    "aiIncidentEvidence",
    "aiIncident",
    "remediationVerification",
    "remediationAction",
    "riskAcceptance",
    "governanceFindingReview",
    "governanceFinding",
    "aiControlTestEvidence",
    "aiControlTest",
    "aiControlEvidenceReview",
    "aiSystemControlEvidence",
    "aiMonitoringReview",
    "aiMonitoringCheck",
    "aiReassessment",
    "aiUseCase",
    "aiImpact",
    "aiImpactAssessment",
    "aiRisk",
    "aiRiskAssessment",
    "evidenceChunk",
    "evidenceDocument",
    "aiSystemControl",
    "aiSystemFrameworkApplicability",
    "aiSystemVendor",
    "aiSystem",
    "auditEvent",
    "tenantMembership",
  ]) {
    await (
      prisma as unknown as Record<
        string,
        { deleteMany(a: unknown): Promise<unknown> }
      >
    )[model]!.deleteMany({ where });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await cleanupCatalogFixtures({ controlId, frameworkId: framework });
}, 30000);
describe("Retirement partial fixture cleanup", () => {
  for (const stage of ["before framework", "before control", "after control"])
    it(`bounds catalog cleanup after setup failure ${stage}`, async () => {
      const ids: { controlId?: string; frameworkId?: string } = {};
      const client: CatalogCleanupClient = {
        control: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        frameworkVersion: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        framework: { delete: vi.fn().mockResolvedValue({}) },
      };
      async function initialize() {
        if (stage !== "before framework") ids.frameworkId = "fixture-framework";
        if (stage === "after control") ids.controlId = "fixture-control";
        throw new Error("Simulated fixture setup failure");
      }
      try {
        await expect(initialize()).rejects.toThrow(
          "Simulated fixture setup failure",
        );
      } finally {
        await cleanupCatalogFixtures(ids, client);
      }
      if (ids.controlId) {
        expect(client.control.deleteMany).toHaveBeenCalledTimes(1);
        expect(client.control.deleteMany).toHaveBeenCalledWith({
          where: { id: "fixture-control" },
        });
      } else expect(client.control.deleteMany).not.toHaveBeenCalled();
      if (ids.frameworkId) {
        expect(client.frameworkVersion.deleteMany).toHaveBeenCalledTimes(1);
        expect(client.frameworkVersion.deleteMany).toHaveBeenCalledWith({
          where: { frameworkId: "fixture-framework" },
        });
        expect(client.framework.delete).toHaveBeenCalledTimes(1);
        expect(client.framework.delete).toHaveBeenCalledWith({
          where: { id: "fixture-framework" },
        });
      } else {
        expect(client.frameworkVersion.deleteMany).not.toHaveBeenCalled();
        expect(client.framework.delete).not.toHaveBeenCalled();
      }
    });
});

describe("Retirement authorization and relationships", () => {
  for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"])
    it(`denies ${role} creation`, async () => {
      const id = await sys();
      expect(
        (await call("POST", `/ai-systems/${id}/retirements`, fields, role))
          .status,
      ).toBe(403);
    });
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"])
    it(`permits ${role} historical read`, async () => {
      const d = await draft();
      expect(
        (await call("GET", `/ai-retirements/${d.id}`, undefined, role)).status,
      ).toBe(200);
    });
  for (const role of ["ANALYST", "AUDITOR", "READ_ONLY"])
    it(`denies ${role} review`, async () => {
      const p = await pending();
      expect((await approve(p, {}, role)).status).toBe(403);
    });
  it("isolates readiness and creation across tenants", async () => {
    const id = await sys(users.ADMIN!, foreign);
    expect(
      (await call("GET", `/ai-systems/${id}/retirement-readiness`)).status,
    ).toBe(404);
    expect(
      (await call("POST", `/ai-systems/${id}/retirements`, fields)).status,
    ).toBe(404);
  });
  it("isolates every retirement operation across tenants", async () => {
    const d = await draft();
    for (const [method, suffix] of [
      ["GET", ""],
      ["PATCH", ""],
      ["POST", "/submit"],
      ["POST", "/cancel"],
      ["POST", "/evidence"],
      ["POST", "/review"],
    ] as const)
      expect(
        (
          await call(
            method,
            `/ai-retirements/${d.id}${suffix}`,
            method === "GET" ? undefined : { revision: d.revision },
            "ADMIN",
            foreign,
          )
        ).status,
      ).toBe(404);
  });
  it("rejects wrong-system and cross-tenant evidence", async () => {
    const d = await draft();
    for (const t of [tenant, foreign]) {
      const id = await sys(users.ADMIN!, t),
        e = await evidence(id, t);
      expect(
        (
          await call("POST", `/ai-retirements/${d.id}/evidence`, {
            revision: d.revision,
            evidenceDocumentId: e.id,
          })
        ).status,
      ).toBe(404);
    }
  });
  it("preserves evidence permissions for reviewers and read-only users", async () => {
    const d = await draft();
    const e = await evidence(d.aiSystemId);
    const linked = await call("POST", `/ai-retirements/${d.id}/evidence`, {
      revision: d.revision,
      evidenceDocumentId: e.id,
    });
    expect(linked.status).toBe(200);
    for (const role of ["REVIEWER", "READ_ONLY"])
      expect(
        (await call("GET", `/ai-retirements/${d.id}`, undefined, role)).body
          .evidence,
      ).toBeUndefined();
    expect(
      (await call("GET", `/ai-retirements/${d.id}`, undefined, "AUDITOR")).body
        .evidence,
    ).toHaveLength(1);
  });
  it("blocks quarantined evidence", async () => {
    const d = await draft(),
      e = await evidence(d.aiSystemId);
    await prisma.evidenceDocument.update({
      where: { id: e.id },
      data: { state: "QUARANTINED" },
    });
    expect(
      (
        await call("POST", `/ai-retirements/${d.id}/evidence`, {
          revision: d.revision,
          evidenceDocumentId: e.id,
        })
      ).status,
    ).toBe(400);
  });
  it("requires current owner to submit", async () => {
    const d = await draft();
    expect(
      (
        await call("POST", `/ai-retirements/${d.id}/submit`, {
          revision: d.revision,
        })
      ).status,
    ).toBe(403);
  });
  for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"])
    it(`blocks ineligible ${role} owner`, async () => {
      const id = await sys(users[role]!);
      const r = await call("GET", `/ai-systems/${id}/retirement-readiness`);
      expect(
        r.body.blockers.some((w: { kind: string }) => w.kind === "OWNER"),
      ).toBe(true);
    });
  it("does not let admin requesters review their own request", async () => {
    const p = await pending();
    expect((await approve(p, {}, "ADMIN")).status).toBe(403);
  });
  it("does not let the owner captured at submission review after reassignment", async () => {
    const id = await sys(users.SECOND_ADMIN!),
      d = await draft(id);
    const p = (
      await call(
        "POST",
        `/ai-retirements/${d.id}/submit`,
        { revision: d.revision },
        "SECOND_ADMIN",
      )
    ).body;
    await prisma.aiSystem.update({
      where: { id },
      data: { ownerUserId: users.ANALYST },
    });
    expect((await approve(p, {}, "SECOND_ADMIN")).status).toBe(403);
  });
  it("owner removal blocks approval but permits independent changes requested", async () => {
    const p = await pending();
    await prisma.tenantMembership.delete({
      where: { tenantId_userId: { tenantId: tenant, userId: users.ANALYST! } },
    });
    try {
      expect((await approve(p)).status).toBe(409);
      expect(
        (await call("GET", `/ai-retirements/${p.id}`, undefined, "ANALYST"))
          .status,
      ).toBe(401);
      const r = await approve(p, { decision: "CHANGES_REQUESTED" });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("DRAFT");
    } finally {
      await prisma.tenantMembership.create({
        data: { tenantId: tenant, userId: users.ANALYST!, role: "ANALYST" },
      });
    }
  });
});
describe("Retirement lifecycle and readiness policy", () => {
  it("allows a single active request and a new draft after cancellation", async () => {
    const d = await draft();
    expect(
      (await call("POST", `/ai-systems/${d.aiSystemId}/retirements`, fields))
        .status,
    ).toBe(409);
    const r = await call("POST", `/ai-retirements/${d.id}/cancel`, {
      revision: d.revision,
      rationale: "Reconsidered",
    });
    expect(r.body.status).toBe("CANCELLED");
    expect(
      (
        await call("PATCH", `/ai-retirements/${d.id}`, {
          revision: r.body.revision,
          businessJustification: "Change",
        })
      ).status,
    ).toBe(409);
    await draft(d.aiSystemId);
  });
  for (const decision of ["REJECTED", "CHANGES_REQUESTED"])
    it(`${decision} returns to DRAFT`, async () => {
      const p = await pending(),
        r = await approve(p, { decision });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("DRAFT");
      expect(r.body.reviews[0].decision).toBe(decision);
    });
  it("requires cessation confirmation", async () => {
    const d = await draft(undefined, { cessationConfirmed: false });
    expect(
      (
        await call(
          "POST",
          `/ai-retirements/${d.id}/submit`,
          { revision: d.revision },
          "ANALYST",
        )
      ).status,
    ).toBe(400);
  });
  it("accepts explained non-applicability for never-deployed system", async () => {
    const d = await draft(undefined, {
      cessationConfirmed: false,
      cessationNotApplicableReason: "Never deployed outside development",
    });
    expect(
      (
        await call(
          "POST",
          `/ai-retirements/${d.id}/submit`,
          { revision: d.revision },
          "ANALYST",
        )
      ).status,
    ).toBe(200);
  });
  it("blocks future-date approval without scheduling", async () => {
    const d = await draft(undefined, { requestedRetirementDate: "2099-01-01" });
    const p = (
      await call(
        "POST",
        `/ai-retirements/${d.id}/submit`,
        { revision: d.revision },
        "ANALYST",
      )
    ).body;
    expect((await approve(p)).status).toBe(400);
  });
  it("requires all warning dispositions at submission", async () => {
    const d = await draft(undefined, { warningDispositions: [] });
    expect(
      (
        await call(
          "POST",
          `/ai-retirements/${d.id}/submit`,
          { revision: d.revision },
          "ANALYST",
        )
      ).status,
    ).toBe(400);
  });
  for (const missing of [
    "remainingWork",
    "whyProceed",
    "ownerUserId",
    "followUpPlan",
  ])
    it(`requires warning ${missing}`, async () => {
      const id = await sys(),
        rows = await ds(id);
      rows[0][missing] = "";
      expect(
        (
          await call("POST", `/ai-systems/${id}/retirements`, {
            ...fields,
            warningDispositions: rows,
          })
        ).status,
      ).toBe(400);
    });
  it("requires explicit acknowledgment of every warning", async () => {
    const p = await pending();
    expect((await approve(p, { acknowledgedWarningKeys: [] })).status).toBe(
      400,
    );
  });
  for (const status of ["OPEN", "IN_PROGRESS", "PENDING_REVIEW"] as const)
    it(`blocks ${status} incidents`, async () => {
      const id = await sys();
      await prisma.aiIncident.create({
        data: {
          tenantId: tenant,
          aiSystemId: id,
          title: "Incident",
          description: "Fixture",
          severity: "LOW",
          status,
          reporterUserId: users.ADMIN!,
          ownerUserId: users.ANALYST!,
          detectedAt: new Date(),
        },
      });
      const p = await pending(id);
      expect((await approve(p)).status).toBe(409);
      expect((await approve(p, { decision: "REJECTED" })).status).toBe(200);
    });
  for (const severity of ["HIGH", "CRITICAL"] as const)
    for (const status of ["OPEN", "PENDING_REVIEW"] as const)
      it(`blocks ${severity} ${status} findings`, async () => {
        const id = await sys();
        await finding(id, severity, status);
        expect((await approve(await pending(id))).status).toBe(409);
      });
  for (const severity of ["LOW", "MEDIUM"] as const)
    it(`warns for ${severity} findings and permits acknowledged retirement`, async () => {
      const id = await sys();
      await finding(id, severity);
      expect((await approve(await pending(id))).status).toBe(200);
    });
  it("blocks pending risk acceptance", async () => {
    const id = await sys(),
      a = await prisma.aiRiskAssessment.create({
        data: { tenantId: tenant, aiSystemId: id, name: "Fixture", version: 1 },
      });
    const risk = await prisma.aiRisk.create({
      data: {
        tenantId: tenant,
        assessmentId: a.id,
        title: "Risk",
        category: "OPERATIONAL",
        statement: "Fixture",
        likelihood: 1,
        impact: 1,
        inherentScore: 1,
        inherentRating: "LOW",
      },
    });
    await prisma.riskAcceptance.create({
      data: {
        tenantId: tenant,
        aiRiskId: risk.id,
        justification: "Fixture",
        status: "PENDING_REVIEW",
        requestedByUserId: users.ADMIN!,
      },
    });
    expect((await approve(await pending(id))).status).toBe(409);
  });
  it("preserves unfinished assessments, tests and reassessments while retiring use cases and monitoring", async () => {
    const id = await sys(),
      c = await control(id);
    const risk = await prisma.aiRiskAssessment.create({
        data: {
          tenantId: tenant,
          aiSystemId: id,
          name: "Unfinished risk",
          version: 1,
          status: "IN_PROGRESS",
        },
      }),
      impact = await prisma.aiImpactAssessment.create({
        data: {
          tenantId: tenant,
          aiSystemId: id,
          name: "Unfinished impact",
          version: 1,
        },
      }),
      test = await prisma.aiControlTest.create({
        data: {
          tenantId: tenant,
          aiSystemControlId: c.id,
          testerUserId: users.REVIEWER!,
          method: "SAMPLE_TESTING",
          procedure: "Unfinished",
        },
      });
    const cycle = await prisma.aiReassessment.create({
      data: {
        tenantId: tenant,
        aiSystemId: id,
        reason: "OTHER",
        whatChanged: "Fixture",
        snapshotAtStart: {},
        initiatedByUserId: users.ADMIN!,
        openCycleKey: id,
      },
    });
    const use = await prisma.aiUseCase.create({
      data: {
        tenantId: tenant,
        aiSystemId: id,
        name: "Approved use",
        businessPurpose: "Fixture",
        status: "APPROVED",
        createdByUserId: users.ADMIN!,
        reviewerUserId: users.REVIEWER!,
        reviewDecision: "APPROVED",
        reviewRationale: "Existing history",
      },
    });
    const check = await prisma.aiMonitoringCheck.create({
      data: {
        tenantId: tenant,
        aiSystemId: id,
        title: "Check",
        whatToReview: "Fixture",
        expectation: "Fixture",
        category: "OTHER",
        cadence: "MONTHLY",
        ownerUserId: users.ANALYST!,
        createdByUserId: users.ADMIN!,
      },
    });
    const p = await pending(id),
      r = await approve(p);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(
      (
        await prisma.aiRiskAssessment.findUniqueOrThrow({
          where: { id: risk.id },
        })
      ).status,
    ).toBe("IN_PROGRESS");
    expect(
      (
        await prisma.aiImpactAssessment.findUniqueOrThrow({
          where: { id: impact.id },
        })
      ).status,
    ).toBe("DRAFT");
    expect(
      (await prisma.aiControlTest.findUniqueOrThrow({ where: { id: test.id } }))
        .status,
    ).toBe("IN_PROGRESS");
    expect(
      (
        await prisma.aiReassessment.findUniqueOrThrow({
          where: { id: cycle.id },
        })
      ).status,
    ).toBe("IN_PROGRESS");
    const saved = await prisma.aiUseCase.findUniqueOrThrow({
      where: { id: use.id },
    });
    expect(saved.status).toBe("RETIRED");
    expect(saved.reviewRationale).toBe("Existing history");
    expect(
      (
        await prisma.aiMonitoringCheck.findUniqueOrThrow({
          where: { id: check.id },
        })
      ).active,
    ).toBe(false);
    expect(
      (await prisma.aiSystem.findUniqueOrThrow({ where: { id } })).retiredAt,
    ).not.toBeNull();
  });
});
describe("Retirement concurrency, immutability and audits", () => {
  it("rejects stale draft revision", async () => {
    const d = await draft();
    const r = await call("PATCH", `/ai-retirements/${d.id}`, {
      revision: d.revision,
      businessJustification: "New justification",
    });
    expect(r.status).toBe(200);
    expect(
      (
        await call("PATCH", `/ai-retirements/${d.id}`, {
          revision: d.revision,
          businessJustification: "Stale",
        })
      ).status,
    ).toBe(409);
  });
  it("rejects changed readiness context", async () => {
    const p = await pending();
    await call("PATCH", `/ai-systems/${p.aiSystemId}`, {
      name: "Changed profile",
    });
    expect((await approve(p)).status).toBe(409);
  });
  it("permits only one concurrent approval and review-history entry", async () => {
    const p = await pending(),
      rs = await Promise.all([approve(p), approve(p)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.aiSystemRetirementReview.count({
        where: { retirementId: p.id },
      }),
    ).toBe(1);
  });
  it("serializes operational writes against approval", async () => {
    const p = await pending(),
      rs = await Promise.all([
        approve(p),
        call("PATCH", `/ai-systems/${p.aiSystemId}`, {
          name: "Concurrent operational change",
        }),
      ]);
    expect(rs.every((r) => r.status === 200)).toBe(false);
    const s = await prisma.aiSystem.findUniqueOrThrow({
      where: { id: p.aiSystemId },
    });
    if (s.lifecycleStatus === "RETIRED")
      expect(s.name).not.toBe("Concurrent operational change");
  });
  it("rolls back retirement and audit effects on transaction failure", async () => {
    const p = await pending();
    rollbackId = p.id;
    try {
      expect((await approve(p)).status).toBe(500);
      expect(
        (
          await prisma.aiSystem.findUniqueOrThrow({
            where: { id: p.aiSystemId },
          })
        ).lifecycleStatus,
      ).toBe("PROPOSED");
      expect(
        (
          await prisma.aiSystemRetirement.findUniqueOrThrow({
            where: { id: p.id },
          })
        ).status,
      ).toBe("PENDING_REVIEW");
      expect(
        await prisma.aiSystemRetirementReview.count({
          where: { retirementId: p.id },
        }),
      ).toBe(0);
      expect(
        await prisma.auditEvent.count({
          where: { targetId: p.id, action: "ai_retirement.completed" },
        }),
      ).toBe(0);
    } finally {
      rollbackId = null;
    }
  });
  it("preserves audit coverage and completed immutability", async () => {
    const p = await pending(),
      r = await approve(p);
    expect(r.status).toBe(200);
    expect(r.body.reviews[0].reviewedSnapshot.warningDispositions).toEqual(
      r.body.warningDispositions,
    );
    for (const action of [
      "created",
      "submitted",
      "reviewed",
      "completed",
      "warning_acknowledged",
    ])
      expect(
        await prisma.auditEvent.count({
          where: { targetId: p.id, action: `ai_retirement.${action}` },
        }),
      ).toBeGreaterThan(0);
    for (const suffix of ["/submit", "/cancel", "/review", "/evidence"])
      expect(
        (
          await call("POST", `/ai-retirements/${p.id}${suffix}`, {
            revision: r.body.revision,
            rationale: "Attempt",
          })
        ).status,
      ).toBe(409);
    expect(
      (
        await call("PATCH", `/ai-retirements/${p.id}`, {
          revision: r.body.revision,
          businessJustification: "Attempt",
        })
      ).status,
    ).toBe(409);
  });
  it("blocks direct retirement and reactivation", async () => {
    const id = await sys();
    expect(
      (await call("PATCH", `/ai-systems/${id}`, { lifecycleStatus: "RETIRED" }))
        .status,
    ).toBe(409);
    const p = await pending(id);
    expect((await approve(p)).status).toBe(200);
    for (const data of [
      { lifecycleStatus: "PRODUCTION" },
      { name: "Operational edit" },
    ])
      expect((await call("PATCH", `/ai-systems/${id}`, data)).status).toBe(409);
  });
  it("blocks new assessments/use cases but allows historical incident reporting", async () => {
    const p = await pending();
    await approve(p);
    expect(
      (
        await call("POST", `/ai-systems/${p.aiSystemId}/risk-assessments`, {
          name: "New assessment",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("POST", `/ai-systems/${p.aiSystemId}/use-cases`, {
          name: "New use",
          businessPurpose: "Fixture",
        })
      ).status,
    ).toBe(409);
    const r = await call("POST", `/ai-systems/${p.aiSystemId}/incidents`, {
      title: "Historical discovery",
      description: "Investigation remains permitted",
      severity: "LOW",
      detectedAt: new Date().toISOString(),
      ownerUserId: users.ANALYST,
    });
    expect(r.status).toBe(201);
    expect(
      (
        await call(
          "POST",
          `/ai-incidents/${r.body.id}/start`,
          { revision: r.body.revision },
          "ANALYST",
        )
      ).status,
    ).toBe(200);
  });
  it("integrates owner work and independent review queues", async () => {
    const d = await draft();
    expect(
      (await myWorkFor(session("ANALYST"))).some((x) => x.id === d.id),
    ).toBe(true);
    const p = (
      await call(
        "POST",
        `/ai-retirements/${d.id}/submit`,
        { revision: d.revision },
        "ANALYST",
      )
    ).body;
    expect(
      (await pendingReviewsFor(session("REVIEWER"))).some((x) => x.id === p.id),
    ).toBe(true);
    expect(
      (await pendingReviewsFor(session("ADMIN"))).some((x) => x.id === p.id),
    ).toBe(false);
  });
});

describe("Retirement governed edge cases", () => {
  for (const status of [
    "DRAFT",
    "PENDING_REVIEW",
    "APPROVED",
    "SUSPENDED",
  ] as const)
    it(`retires ${status} use cases without inventing approval`, async () => {
      const id = await sys();
      const u = await prisma.aiUseCase.create({
        data: {
          tenantId: tenant,
          aiSystemId: id,
          name: "Use fixture",
          businessPurpose: "Fixture",
          status,
          createdByUserId: users.ADMIN!,
        },
      });
      expect((await approve(await pending(id))).status).toBe(200);
      const saved = await prisma.aiUseCase.findUniqueOrThrow({
        where: { id: u.id },
      });
      expect(saved.status).toBe("RETIRED");
      expect(saved.reviewDecision).toBeNull();
    });
  it("blocks changed selected evidence at approval", async () => {
    const d = await draft(),
      e = await evidence(d.aiSystemId);
    const linked = (
      await call("POST", `/ai-retirements/${d.id}/evidence`, {
        revision: d.revision,
        evidenceDocumentId: e.id,
      })
    ).body;
    const p = (
      await call(
        "POST",
        `/ai-retirements/${d.id}/submit`,
        { revision: linked.revision },
        "ANALYST",
      )
    ).body;
    await prisma.evidenceDocument.update({
      where: { id: e.id },
      data: { state: "QUARANTINED" },
    });
    expect((await approve(p)).status).toBe(409);
  });
  it("rejects a cross-tenant follow-up owner", async () => {
    const id = await sys(),
      rows = await ds(id);
    await prisma.tenantMembership.delete({
      where: {
        tenantId_userId: { tenantId: tenant, userId: users.SECOND_ADMIN! },
      },
    });
    try {
      rows[0].ownerUserId = users.SECOND_ADMIN;
      expect(
        (
          await call("POST", `/ai-systems/${id}/retirements`, {
            ...fields,
            warningDispositions: rows,
          })
        ).status,
      ).toBe(404);
    } finally {
      await prisma.tenantMembership.create({
        data: { tenantId: tenant, userId: users.SECOND_ADMIN!, role: "ADMIN" },
      });
    }
  });
  it("retains active approved risk acceptance as an acknowledged warning", async () => {
    const id = await sys(),
      a = await prisma.aiRiskAssessment.create({
        data: { tenantId: tenant, aiSystemId: id, name: "Fixture", version: 1 },
      });
    const risk = await prisma.aiRisk.create({
      data: {
        tenantId: tenant,
        assessmentId: a.id,
        title: "Risk",
        category: "OPERATIONAL",
        statement: "Fixture",
        likelihood: 1,
        impact: 1,
        inherentScore: 1,
        inherentRating: "LOW",
      },
    });
    const acceptance = await prisma.riskAcceptance.create({
      data: {
        tenantId: tenant,
        aiRiskId: risk.id,
        justification: "Fixture",
        status: "APPROVED",
        expiresAt: new Date("2099-01-01"),
        requestedByUserId: users.ADMIN!,
        decidedByUserId: users.REVIEWER!,
      },
    });
    const p = await pending(id);
    expect(
      p.readiness.warnings.some(
        (w: { kind: string }) => w.kind === "ACTIVE_ACCEPTANCE",
      ),
    ).toBe(true);
    expect((await approve(p)).status).toBe(200);
    expect(
      (
        await prisma.riskAcceptance.findUniqueOrThrow({
          where: { id: acceptance.id },
        })
      ).status,
    ).toBe("APPROVED");
  });
  it("does not approve after the current owner loses update permission", async () => {
    const p = await pending();
    await prisma.tenantMembership.update({
      where: { tenantId_userId: { tenantId: tenant, userId: users.ANALYST! } },
      data: { role: "READ_ONLY" },
    });
    try {
      expect((await approve(p)).status).toBe(409);
      expect((await approve(p, { decision: "CHANGES_REQUESTED" })).status).toBe(
        200,
      );
    } finally {
      await prisma.tenantMembership.update({
        where: {
          tenantId_userId: { tenantId: tenant, userId: users.ANALYST! },
        },
        data: { role: "ANALYST" },
      });
    }
  });
  it("serializes a concurrently created incident blocker with approval", async () => {
    const p = await pending();
    let release!: () => void, locked!: () => void;
    const barrier = new Promise<void>((resolve) => (locked = resolve)),
      continueCommit = new Promise<void>((resolve) => (release = resolve));
    releases.add(release);
    if (draining) release();
    const blocker = tracked(
      databaseClient.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${tenant},0))`;
        await tx.$queryRaw`SELECT id FROM ai_systems WHERE id=${p.aiSystemId} FOR UPDATE`;
        await tx.aiIncident.create({
          data: {
            tenantId: tenant,
            aiSystemId: p.aiSystemId,
            title: "Concurrent blocker",
            description: "Fixture",
            severity: "HIGH",
            detectedAt: new Date(),
            reporterUserId: users.ADMIN!,
            ownerUserId: users.ANALYST!,
          },
        });
        locked();
        await continueCommit;
      }),
    );
    // A rejected transaction must also wake the body waiting for the barrier.
    void blocker.then(locked, locked);
    await barrier;
    const decision = approve(p);
    release();
    await blocker;
    expect((await decision).status).toBe(409);
    expect(
      (await prisma.aiSystem.findUniqueOrThrow({ where: { id: p.aiSystemId } }))
        .lifecycleStatus,
    ).toBe("PROPOSED");
  });
  it("keeps historical unfinished work out of executable work queues", async () => {
    const id = await sys(),
      a = await prisma.aiRiskAssessment.create({
        data: {
          tenantId: tenant,
          aiSystemId: id,
          name: "Historical unfinished",
          version: 1,
          assessorUserId: users.ANALYST!,
          status: "IN_PROGRESS",
        },
      });
    await approve(await pending(id));
    expect(
      (await myWorkFor(session("ANALYST"))).some((w) => w.id === a.id),
    ).toBe(false);
    expect(
      (await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe("IN_PROGRESS");
  });
});

describe("Retirement invalid historical relationships", () => {
  it("blocks a wrong-system reassessment assessment reference", async () => {
    const id = await sys(),
      other = await sys();
    const a = await prisma.aiRiskAssessment.create({
      data: {
        tenantId: tenant,
        aiSystemId: other,
        name: "Other system",
        version: 1,
      },
    });
    await prisma.aiReassessment.create({
      data: {
        tenantId: tenant,
        aiSystemId: id,
        reason: "OTHER",
        whatChanged: "Fixture",
        snapshotAtStart: {},
        initiatedByUserId: users.ADMIN!,
        priorRiskAssessmentId: a.id,
        openCycleKey: id,
      },
    });
    const p = await pending(id);
    expect(
      p.readiness.blockers.some(
        (b: { kind: string }) => b.kind === "INVALID_RELATIONSHIP",
      ),
    ).toBe(true);
    expect((await approve(p)).status).toBe(409);
  });
  it("blocks a closed incident with a wrong-system use-case relationship", async () => {
    const id = await sys(),
      other = await sys();
    const u = await prisma.aiUseCase.create({
      data: {
        tenantId: tenant,
        aiSystemId: other,
        name: "Other use",
        businessPurpose: "Fixture",
        createdByUserId: users.ADMIN!,
      },
    });
    await prisma.aiIncident.create({
      data: {
        tenantId: tenant,
        aiSystemId: id,
        aiUseCaseId: u.id,
        title: "Historical inconsistent relationship",
        description: "Fixture",
        severity: "LOW",
        status: "CLOSED",
        detectedAt: new Date(),
        reporterUserId: users.ADMIN!,
      },
    });
    const p = await pending(id);
    expect((await approve(p)).status).toBe(409);
  });
});

describe("Retirement assurance and authorized follow-up", () => {
  it("deduplicates expired evidence warnings from direct and control references", async () => {
    const id = await sys(),
      c = await control(id),
      e = await evidence(id);
    await prisma.aiSystemControlEvidence.create({
      data: {
        tenantId: tenant,
        aiSystemControlId: c.id,
        evidenceDocumentId: e.id,
        status: "ACCEPTED",
        submittedByUserId: users.ADMIN!,
      },
    });
    await prisma.evidenceDocument.update({
      where: { id: e.id },
      data: { state: "EXPIRED" },
    });
    const p = await pending(id);
    expect(
      p.readiness.warnings.filter(
        (w: { key: string }) => w.key === `ASSURANCE_EVIDENCE:${e.id}`,
      ),
    ).toHaveLength(1);
    expect((await approve(p)).status).toBe(200);
  });
  it("permits authorized remediation follow-up after retirement", async () => {
    const id = await sys(),
      f = await finding(id, "LOW");
    const remediation = await prisma.remediationAction.create({
      data: {
        tenantId: tenant,
        governanceFindingId: f.id,
        title: "Historical follow-up",
        description: "Fixture follow-up plan",
        ownerUserId: users.ADMIN!,
      },
    });
    expect((await approve(await pending(id))).status).toBe(200);
    const response = await call(
      "PATCH",
      `/governance-remediations/${remediation.id}`,
      { status: "IN_PROGRESS" },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(
      (
        await prisma.governanceFinding.findUniqueOrThrow({
          where: { id: f.id },
        })
      ).status,
    ).toBe("OPEN");
  });
});
