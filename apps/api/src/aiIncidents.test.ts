import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma, type Role } from "@vendorguard/database";
import { createSessionCookie } from "@vendorguard/auth";
import { server } from "./index.js";
import { pendingReviewsFor, myWorkFor } from "./aiWorkQueues.js";
let tenant: string;
let foreign: string;
let system: string;
let otherSystem: string;
let foreignSystem: string;
let framework: string;
const users: Record<string, string> = {};
let ip = 0;
function session(role = "ANALYST", t = tenant) {
  return {
    userId: users[role]!,
    tenantId: t,
    role,
    email: "incident@example.com",
    displayName: "Incident Test",
  };
}
async function call(
  method: "GET" | "POST" | "PATCH",
  path: string,
  payload?: object,
  role = "ANALYST",
  t = tenant,
) {
  const r = await server.inject({
    method,
    url: path,
    payload,
    cookies: { vg_session: createSessionCookie(session(role, t)) },
    remoteAddress: `10.88.${Math.floor(++ip / 250)}.${ip % 250}`,
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const registration = {
  title: "Unexpected AI output",
  description: "A human identified incorrect output",
  severity: "HIGH",
  detectedAt: "2026-01-01T10:00:00.000Z",
};
const closure = {
  investigationSummary: "Investigated the event",
  responseSummary: "Contained affected use",
  followUpPlan: "Owner tracks linked work; no automatic closure of that work",
  closureRationale: "Immediate response completed",
};
async function create(extra: object = {}, sys = system, role = "ANALYST") {
  const r = await call(
    "POST",
    `/ai-systems/${sys}/incidents`,
    { ...registration, ownerUserId: users.ADMIN, ...extra },
    role,
  );
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
async function act(
  i: { id: string; revision: number },
  action: string,
  extra: object = {},
  role = "ADMIN",
) {
  return call(
    "POST",
    `/ai-incidents/${i.id}/${action}`,
    { revision: i.revision, ...extra },
    role,
  );
}
async function pending(extra: object = {}, sys = system) {
  let i = await create(extra, sys);
  i = (await act(i, "start")).body;
  i = (
    await call(
      "PATCH",
      `/ai-incidents/${i.id}`,
      { ...closure, revision: i.revision },
      "ADMIN",
    )
  ).body;
  const r = await act(i, "submit-closure");
  expect(r.status).toBe(200);
  return r.body;
}
async function evidence(sys = system, t = tenant) {
  return prisma.evidenceDocument.create({
    data: {
      tenantId: t,
      aiSystemId: sys,
      displayFilename: "Incident policy.pdf",
      storageKey: `private-${Date.now()}-${Math.random()}`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      sha256Hash: "fixture",
      documentType: "Policy",
      uploadedByUserId: users.ADMIN!,
      state: "INDEXED",
    },
  });
}
async function finding(sys = system, t = tenant) {
  const version = await prisma.frameworkVersion.findFirstOrThrow({
    where: { frameworkId: framework },
  });
  const c = await prisma.control.findFirstOrThrow({
    where: { frameworkVersionId: version.id },
  });
  const applicability = await prisma.aiSystemFrameworkApplicability.upsert({
    where: {
      aiSystemId_frameworkId: { aiSystemId: sys, frameworkId: framework },
    },
    create: {
      tenantId: t,
      aiSystemId: sys,
      frameworkId: framework,
      status: "APPLICABLE",
      rationale: "Fixture",
      determinedAt: new Date(),
    },
    update: {},
  });
  const record = await prisma.aiSystemControl.upsert({
    where: { aiSystemId_controlId: { aiSystemId: sys, controlId: c.id } },
    create: {
      tenantId: t,
      aiSystemId: sys,
      controlId: c.id,
      sourceApplicabilityId: applicability.id,
    },
    update: {},
  });
  const test = await prisma.aiControlTest.create({
    data: {
      tenantId: t,
      aiSystemControlId: record.id,
      testerUserId: users.REVIEWER!,
      method: "SAMPLE_TESTING",
      procedure: "Fixture",
      status: "COMPLETED",
      overallEffectiveness: "INEFFECTIVE",
    },
  });
  return prisma.governanceFinding.create({
    data: {
      tenantId: t,
      aiControlTestId: test.id,
      title: "Existing deficiency",
      description: "Fixture",
      severity: "HIGH",
      status: "OPEN",
      createdByUserId: users.REVIEWER!,
    },
  });
}
beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  tenant = (await prisma.tenant.create({ data: { name: "Incident test A" } }))
    .id;
  foreign = (await prisma.tenant.create({ data: { name: "Incident test B" } }))
    .id;
  for (const role of [
    "ADMIN",
    "ANALYST",
    "REVIEWER",
    "AUDITOR",
    "READ_ONLY",
    "SECOND_REVIEWER",
    "FOREIGN",
  ]) {
    const u = await prisma.user.create({
      data: {
        externalId: `incident-${role}-${stamp}`,
        email: `incident-${role}-${stamp}@example.com`,
        displayName: role,
      },
    });
    users[role] = u.id;
    await prisma.tenantMembership.create({
      data: {
        tenantId: role === "FOREIGN" ? foreign : tenant,
        userId: u.id,
        role: (role === "FOREIGN"
          ? "ADMIN"
          : role === "SECOND_REVIEWER"
            ? "REVIEWER"
            : role) as Role,
      },
    });
  }
  system = (
    await prisma.aiSystem.create({
      data: { tenantId: tenant, name: "Incident AI", origin: "INTERNAL" },
    })
  ).id;
  otherSystem = (
    await prisma.aiSystem.create({
      data: { tenantId: tenant, name: "Other AI", origin: "INTERNAL" },
    })
  ).id;
  foreignSystem = (
    await prisma.aiSystem.create({
      data: { tenantId: foreign, name: "Foreign AI", origin: "INTERNAL" },
    })
  ).id;
  const f = await prisma.framework.create({
    data: {
      catalogId: `s8-test-incidents-${stamp}`,
      name: "Incident fixture framework",
      scope: "VENDOR_ASSESSMENT",
      industries: [],
    },
  });
  framework = f.id;
  const v = await prisma.frameworkVersion.create({
    data: { frameworkId: f.id, version: "1", isCurrent: true },
  });
  await prisma.control.create({
    data: {
      frameworkVersionId: v.id,
      controlId: "INC-1",
      title: "Incident control",
      summary: "Fixture",
      domain: "Test",
      expectedEvidenceTypes: [],
      validationGuidance: "Fixture",
    },
  });
});
afterAll(async () => {
  const where = { tenantId: { in: [tenant, foreign].filter(Boolean) } };
  await prisma.aiIncidentReview.deleteMany({ where });
  await prisma.aiIncidentEvidence.deleteMany({ where });
  await prisma.aiIncidentFinding.deleteMany({ where });
  await prisma.aiIncident.deleteMany({ where });
  await prisma.aiReassessment.deleteMany({ where });
  await prisma.aiMonitoringReview.deleteMany({ where });
  await prisma.aiMonitoringCheck.deleteMany({ where });
  await prisma.remediationAction.deleteMany({ where });
  await prisma.governanceFinding.deleteMany({ where });
  await prisma.aiControlTest.deleteMany({ where });
  await prisma.aiSystemControl.deleteMany({ where });
  await prisma.aiSystemFrameworkApplicability.deleteMany({ where });
  await prisma.evidenceDocument.deleteMany({ where });
  await prisma.aiUseCase.deleteMany({ where });
  await prisma.auditEvent.deleteMany({ where });
  await prisma.aiSystem.deleteMany({ where });
  await prisma.tenantMembership.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenant, foreign].filter(Boolean) } },
  });
  await prisma.control.deleteMany({
    where: { frameworkVersion: { frameworkId: framework } },
  });
  await prisma.frameworkVersion.deleteMany({
    where: { frameworkId: framework },
  });
  await prisma.framework.delete({ where: { id: framework } });
});
describe("AI Incidents V1", () => {
  it.each(["LOW", "MEDIUM", "HIGH", "CRITICAL"])(
    "registers %s severity with authoritative tenant and reporter",
    async (severity) => {
      const i = await create({ severity });
      expect(i.status).toBe("OPEN");
      expect(i.tenantId).toBe(tenant);
      expect(i.reporterUserId).toBe(users.ANALYST);
    },
  );
  it.each([
    {},
    { severity: "INVALID" },
    { title: "" },
    { description: "" },
    { detectedAt: "bad" },
    { detectedAt: "2099-01-01" },
    { occurredAt: "2026-01-02" },
    { tenantId: "override" },
    { status: "CLOSED" },
  ])("validates registration %j", async (extra) => {
    const b = Object.keys(extra).length ? { ...registration, ...extra } : {};
    expect(
      (await call("POST", `/ai-systems/${system}/incidents`, b)).status,
    ).toBe(400);
  });
  it("requires a valid AI system and tenant owner", async () => {
    expect(
      (await call("POST", "/ai-systems/missing/incidents", registration))
        .status,
    ).toBe(404);
    expect(
      (
        await call("POST", `/ai-systems/${system}/incidents`, {
          ...registration,
          ownerUserId: users.FOREIGN,
        })
      ).status,
    ).toBe(404);
  });
  it.each(["REVIEWER", "AUDITOR", "READ_ONLY"])(
    "denies %s registration/update",
    async (role) => {
      expect(
        (
          await call(
            "POST",
            `/ai-systems/${system}/incidents`,
            registration,
            role,
          )
        ).status,
      ).toBe(403);
      const i = await create();
      expect(
        (
          await call(
            "PATCH",
            `/ai-incidents/${i.id}`,
            { revision: i.revision, title: "New" },
            role,
          )
        ).status,
      ).toBe(403);
    },
  );
  it.each(["REVIEWER", "AUDITOR", "READ_ONLY"])(
    "denies %s lifecycle and link mutations",
    async (role) => {
      const i = await create();
      for (const action of [
        "start",
        "submit-closure",
        "evidence",
        "findings",
        "reassessment",
      ])
        expect((await act(i, action, {}, role)).status).toBe(403);
    },
  );
  it.each(["REVIEWER", "AUDITOR", "READ_ONLY"])(
    "rejects %s owners on creation and reassignment without changing records",
    async (role) => {
      expect(
        (
          await call("POST", `/ai-systems/${system}/incidents`, {
            ...registration,
            ownerUserId: users[role],
          })
        ).status,
      ).toBe(400);
      const i = await create();
      const auditCount = await prisma.auditEvent.count({
        where: { targetId: i.id },
      });
      expect(
        (
          await call("PATCH", `/ai-incidents/${i.id}`, {
            revision: i.revision,
            ownerUserId: users[role],
          })
        ).status,
      ).toBe(400);
      const unchanged = await prisma.aiIncident.findUniqueOrThrow({
        where: { id: i.id },
      });
      expect(unchanged.ownerUserId).toBe(users.ADMIN);
      expect(unchanged.revision).toBe(i.revision);
      expect(await prisma.auditEvent.count({ where: { targetId: i.id } })).toBe(
        auditCount,
      );
    },
  );
  it.each(["ADMIN", "ANALYST"])(
    "accepts eligible %s owners on creation and reassignment",
    async (role) => {
      const i = await create({ ownerUserId: users[role] });
      expect(i.ownerUserId).toBe(users[role]);
      const other = await create({ ownerUserId: null });
      const assigned = await call("PATCH", `/ai-incidents/${other.id}`, {
        revision: other.revision,
        ownerUserId: users[role],
      });
      expect(assigned.status).toBe(200);
      expect(assigned.body.ownerUserId).toBe(users[role]);
    },
  );
  it.each(["APPROVED", "REJECTED", "CHANGES_REQUESTED"])(
    "%s remains independently reviewable after owner membership removal",
    async (decision) => {
      const i = await pending();
      await prisma.tenantMembership.delete({
        where: { tenantId_userId: { tenantId: tenant, userId: users.ADMIN! } },
      });
      try {
        expect(
          (await call("GET", `/ai-incidents/${i.id}`, undefined, "ADMIN"))
            .status,
        ).toBe(401);
        for (const action of [
          "start",
          "submit-closure",
          "review",
          "evidence",
          "findings",
          "reassessment",
        ])
          expect((await act(i, action, {}, "ADMIN")).status).toBe(401);
        expect(
          (
            await call(
              "PATCH",
              `/ai-incidents/${i.id}`,
              { revision: i.revision, title: "Removed owner edit" },
              "ADMIN",
            )
          ).status,
        ).toBe(401);
        expect(
          (await pendingReviewsFor(session("REVIEWER"))).some(
            (w) => w.id === i.id,
          ),
        ).toBe(true);
        expect(
          (
            await call(
              "POST",
              `/ai-incidents/${i.id}/review`,
              {
                revision: i.revision,
                decision,
                rationale: "Foreign review",
              },
              "FOREIGN",
              foreign,
            )
          ).status,
        ).toBe(404);
        await prisma.tenantMembership.updateMany({
          where: { tenantId: tenant, userId: users.ANALYST },
          data: { role: "REVIEWER" },
        });
        try {
          expect(
            (
              await act(
                i,
                "review",
                { decision, rationale: "Reporter review" },
                "ANALYST",
              )
            ).status,
          ).toBe(403);
        } finally {
          await prisma.tenantMembership.updateMany({
            where: { tenantId: tenant, userId: users.ANALYST },
            data: { role: "ANALYST" },
          });
        }
        const reviewed = await act(
          i,
          "review",
          { decision, rationale: "Independent review of submitted closure" },
          "REVIEWER",
        );
        expect(reviewed.status).toBe(200);
        expect(reviewed.body.status).toBe(
          decision === "APPROVED" ? "CLOSED" : "IN_PROGRESS",
        );
        expect(reviewed.body.ownerUserId).toBe(users.ADMIN);
        expect(reviewed.body.closureSubmitterUserId).toBe(users.ADMIN);
        expect(reviewed.body.reviews).toHaveLength(1);
        expect(reviewed.body.reviews[0].reviewerUserId).toBe(users.REVIEWER);
        expect(
          await prisma.auditEvent.count({
            where: { targetId: i.id, action: "ai_incident.review_recorded" },
          }),
        ).toBe(1);
        if (decision !== "APPROVED") {
          const reassigned = await call("PATCH", `/ai-incidents/${i.id}`, {
            revision: reviewed.body.revision,
            ownerUserId: users.ANALYST,
          });
          expect(reassigned.status).toBe(200);
          expect(
            (await act(reassigned.body, "submit-closure", {}, "ANALYST"))
              .status,
          ).toBe(200);
        } else {
          expect(
            (
              await call("PATCH", `/ai-incidents/${i.id}`, {
                revision: reviewed.body.revision,
                ownerUserId: users.ANALYST,
              })
            ).status,
          ).toBe(409);
        }
      } finally {
        await prisma.tenantMembership.create({
          data: { tenantId: tenant, userId: users.ADMIN!, role: "ADMIN" },
        });
      }
    },
  );
  it("owner rejoining as reviewer still cannot review their submitted closure", async () => {
    const i = await pending();
    await prisma.tenantMembership.delete({
      where: { tenantId_userId: { tenantId: tenant, userId: users.ADMIN! } },
    });
    await prisma.tenantMembership.create({
      data: { tenantId: tenant, userId: users.ADMIN!, role: "REVIEWER" },
    });
    try {
      expect(
        (
          await act(i, "review", {
            decision: "APPROVED",
            rationale: "Self review",
          })
        ).status,
      ).toBe(403);
      expect(
        await prisma.aiIncidentReview.count({ where: { incidentId: i.id } }),
      ).toBe(0);
      expect(
        (await prisma.aiIncident.findUniqueOrThrow({ where: { id: i.id } }))
          .status,
      ).toBe("PENDING_REVIEW");
    } finally {
      await prisma.tenantMembership.updateMany({
        where: { tenantId: tenant, userId: users.ADMIN },
        data: { role: "ADMIN" },
      });
    }
  });
  it("all existing roles can read incidents without acquiring evidence permission", async () => {
    const i = await create();
    for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"])
      expect(
        (await call("GET", `/ai-incidents/${i.id}`, undefined, role)).status,
      ).toBe(200);
  });
  it("validates list filters and owner membership", async () => {
    for (const q of ["status=INVALID", "severity=INVALID"])
      expect((await call("GET", `/ai-incidents?${q}`)).status).toBe(400);
    expect(
      (await call("GET", `/ai-incidents?ownerUserId=${users.FOREIGN}`)).status,
    ).toBe(404);
    const i = await create({ severity: "CRITICAL" });
    const r = await call(
      "GET",
      `/ai-incidents?aiSystemId=${system}&status=OPEN&severity=CRITICAL&ownerUserId=${users.ADMIN}`,
    );
    expect(r.body.incidents.some((v: { id: string }) => v.id === i.id)).toBe(
      true,
    );
  });
  it("requires valid review decisions and rationale", async () => {
    const i = await pending();
    for (const b of [
      { decision: "INVALID", rationale: "No" },
      { decision: "APPROVED", rationale: "" },
    ])
      expect((await act(i, "review", b, "REVIEWER")).status).toBe(400);
    expect(
      await prisma.aiIncidentReview.count({ where: { incidentId: i.id } }),
    ).toBe(0);
  });
  it("rejects concurrent edits and preserves the winning revision", async () => {
    const i = await create();
    const rs = await Promise.all([
      call("PATCH", `/ai-incidents/${i.id}`, {
        revision: i.revision,
        title: "First",
      }),
      call("PATCH", `/ai-incidents/${i.id}`, {
        revision: i.revision,
        title: "Second",
      }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await prisma.aiIncident.findUniqueOrThrow({ where: { id: i.id } }))
        .revision,
    ).toBe(1);
  });
  it("validates foreign use cases and PATCH relationship changes", async () => {
    const u = await prisma.aiUseCase.create({
      data: {
        tenantId: foreign,
        aiSystemId: foreignSystem,
        name: "Foreign use",
        businessPurpose: "Fixture",
        createdByUserId: users.FOREIGN!,
        affectedParties: [],
      },
    });
    expect(
      (
        await call("POST", `/ai-systems/${system}/incidents`, {
          ...registration,
          aiUseCaseId: u.id,
        })
      ).status,
    ).toBe(404);
    const i = await create();
    expect(
      (
        await call("PATCH", `/ai-incidents/${i.id}`, {
          revision: i.revision,
          aiUseCaseId: u.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("PATCH", `/ai-incidents/${i.id}`, {
          revision: i.revision,
          ownerUserId: users.FOREIGN,
        })
      ).status,
    ).toBe(404);
  });
  it("requires authentication", async () => {
    expect(
      (await server.inject({ method: "GET", url: "/ai-incidents" })).statusCode,
    ).toBe(401);
  });
  it("scopes list, filters, detail and all operations to tenant", async () => {
    const i = await create();
    for (const action of [
      "start",
      "submit-closure",
      "review",
      "evidence",
      "findings",
      "reassessment",
    ])
      expect((await act(i, action, {}, "FOREIGN")).status).toBe(401);
    for (const action of [
      "start",
      "submit-closure",
      "review",
      "evidence",
      "findings",
      "reassessment",
    ])
      expect(
        (
          await call(
            "POST",
            `/ai-incidents/${i.id}/${action}`,
            { revision: i.revision },
            "FOREIGN",
            foreign,
          )
        ).status,
      ).toBe(404);
    expect(
      (
        await call(
          "GET",
          `/ai-incidents/${i.id}`,
          undefined,
          "FOREIGN",
          foreign,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "PATCH",
          `/ai-incidents/${i.id}`,
          { revision: 0, title: "Foreign" },
          "FOREIGN",
          foreign,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "GET",
          `/ai-systems/${system}/incidents`,
          undefined,
          "FOREIGN",
          foreign,
        )
      ).status,
    ).toBe(404);
    expect(
      (await call("GET", `/ai-incidents?aiSystemId=${foreignSystem}`)).status,
    ).toBe(404);
    const list = await call(
      "GET",
      "/ai-incidents",
      undefined,
      "FOREIGN",
      foreign,
    );
    expect(list.body.incidents).toEqual([]);
  });
  it("links only a use case and monitoring review belonging to the same system", async () => {
    const u = await prisma.aiUseCase.create({
      data: {
        tenantId: tenant,
        aiSystemId: system,
        name: "Use",
        businessPurpose: "Fixture",
        createdByUserId: users.ANALYST!,
        affectedParties: [],
      },
    });
    expect((await create({ aiUseCaseId: u.id })).aiUseCaseId).toBe(u.id);
    expect(
      (
        await call("POST", `/ai-systems/${otherSystem}/incidents`, {
          ...registration,
          aiUseCaseId: u.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("POST", `/ai-systems/${system}/incidents`, {
          ...registration,
          monitoringReviewId: "missing",
        })
      ).status,
    ).toBe(404);
    const check = await prisma.aiMonitoringCheck.create({
      data: {
        tenantId: tenant,
        aiSystemId: system,
        title: "Oversight",
        category: "HUMAN_OVERSIGHT",
        whatToReview: "Human decisions",
        expectation: "Human review",
        cadence: "MONTHLY",
        ownerUserId: users.ADMIN!,
        createdByUserId: users.ANALYST!,
      },
    });
    const review = await prisma.aiMonitoringReview.create({
      data: {
        tenantId: tenant,
        checkId: check.id,
        observation: "Concern",
        result: "ATTENTION_REQUIRED",
        rationale: "Review",
        reviewerUserId: users.REVIEWER!,
      },
    });
    expect(
      (await create({ monitoringReviewId: review.id })).monitoringReviewId,
    ).toBe(review.id);
    expect(
      (
        await call("POST", `/ai-systems/${otherSystem}/incidents`, {
          ...registration,
          monitoringReviewId: review.id,
        })
      ).status,
    ).toBe(404);
  });
  it("requires an owner to start and complete closure information to submit", async () => {
    let i = await create({ ownerUserId: null });
    expect((await act(i, "start")).status).toBe(403);
    i = await create();
    i = (await act(i, "start")).body;
    expect((await act(i, "submit-closure")).status).toBe(400);
    expect((await act(i, "submit-closure", {}, "ANALYST")).status).toBe(403);
  });
  it.each(["REJECTED", "CHANGES_REQUESTED"])(
    "%s returns to investigation and preserves review history",
    async (decision) => {
      const i = await pending();
      const r = await act(
        i,
        "review",
        { decision, rationale: "More work" },
        "REVIEWER",
      );
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("IN_PROGRESS");
      expect(r.body.reviews).toHaveLength(1);
      const p = await act(r.body, "submit-closure");
      const closed = await act(
        p.body,
        "review",
        { decision: "APPROVED", rationale: "Done" },
        "REVIEWER",
      );
      expect(closed.body.reviews).toHaveLength(2);
    },
  );
  it.each(["ADMIN", "ANALYST", "AUDITOR", "READ_ONLY"])(
    "denies closure review by %s",
    async (role) => {
      const i = await pending();
      expect(
        (
          await act(
            i,
            "review",
            { decision: "APPROVED", rationale: "Denied" },
            role,
          )
        ).status,
      ).toBe(403);
    },
  );
  it("denies reporter review even if reporter acquires review permission", async () => {
    const i = await pending();
    await prisma.tenantMembership.updateMany({
      where: { tenantId: tenant, userId: users.ANALYST },
      data: { role: "REVIEWER" },
    });
    expect(
      (
        await act(
          i,
          "review",
          { decision: "APPROVED", rationale: "Denied" },
          "ANALYST",
        )
      ).status,
    ).toBe(403);
    await prisma.tenantMembership.updateMany({
      where: { tenantId: tenant, userId: users.ANALYST },
      data: { role: "ANALYST" },
    });
  });
  it("denies former closure submitter after reassignment", async () => {
    const i = await pending();
    await prisma.aiIncident.update({
      where: { id: i.id },
      data: { ownerUserId: users.ANALYST },
    });
    expect(
      (
        await act(
          i,
          "review",
          { decision: "APPROVED", rationale: "Denied" },
          "ADMIN",
        )
      ).status,
    ).toBe(403);
  });
  it("pending review locks content, owner and relationships", async () => {
    const i = await pending();
    expect(
      (
        await call("PATCH", `/ai-incidents/${i.id}`, {
          revision: i.revision,
          ownerUserId: users.REVIEWER,
        })
      ).status,
    ).toBe(409);
    for (const action of ["evidence", "findings", "reassessment"])
      expect((await act(i, action)).status).toBe(409);
  });
  it("allows only one concurrent decision, retaining one history row and one audit event", async () => {
    const i = await pending();
    const rs = await Promise.all([
      act(i, "review", { decision: "APPROVED", rationale: "A" }, "REVIEWER"),
      act(
        i,
        "review",
        { decision: "REJECTED", rationale: "B" },
        "SECOND_REVIEWER",
      ),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.aiIncidentReview.count({ where: { incidentId: i.id } }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { targetId: i.id, action: "ai_incident.review_recorded" },
      }),
    ).toBe(1);
  });
  it("rejects stale edits and transitions and requires revision", async () => {
    const i = await create();
    expect(
      (await call("PATCH", `/ai-incidents/${i.id}`, { title: "No revision" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("PATCH", `/ai-incidents/${i.id}`, {
          title: "Changed",
          revision: i.revision,
        })
      ).status,
    ).toBe(200);
    expect((await act(i, "start")).status).toBe(409);
    expect(
      (
        await call("PATCH", `/ai-incidents/${i.id}`, {
          title: "Stale",
          revision: i.revision,
        })
      ).status,
    ).toBe(409);
  });
  it("protects server-controlled fields", async () => {
    const i = await create();
    for (const field of [
      "tenantId",
      "aiSystemId",
      "status",
      "reporterUserId",
      "closureSubmitterUserId",
      "closedAt",
      "reviews",
    ])
      expect(
        (
          await call("PATCH", `/ai-incidents/${i.id}`, {
            revision: i.revision,
            [field]: "override",
          })
        ).status,
      ).toBe(400);
  });
  it("closed incident is immutable across every mutation route", async () => {
    const i = await pending();
    const c = (
      await act(
        i,
        "review",
        { decision: "APPROVED", rationale: "Closed" },
        "REVIEWER",
      )
    ).body;
    expect(
      (
        await call("PATCH", `/ai-incidents/${i.id}`, {
          revision: c.revision,
          title: "Edit",
        })
      ).status,
    ).toBe(409);
    for (const action of [
      "start",
      "submit-closure",
      "review",
      "evidence",
      "findings",
      "reassessment",
    ])
      expect(
        (
          await act(
            c,
            action,
            { decision: "APPROVED", rationale: "Again" },
            action === "review" ? "REVIEWER" : "ADMIN",
          )
        ).status,
      ).toBe(409);
  });
  it("links metadata without exposing storage keys, chunks or file access", async () => {
    const i = await create();
    const doc = await evidence();
    const r = await act(i, "evidence", { evidenceDocumentId: doc.id });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(doc.storageKey);
    expect(r.body.evidence[0].evidenceDocument.displayFilename).toBe(
      doc.displayFilename,
    );
    for (const role of ["REVIEWER", "READ_ONLY"])
      expect(
        (await call("GET", `/ai-incidents/${i.id}`, undefined, role)).body
          .evidence,
      ).toBeUndefined();
    expect(
      (await call("GET", `/ai-incidents/${i.id}`, undefined, "AUDITOR")).body
        .evidence,
    ).toHaveLength(1);
    expect(
      (await call("GET", `/evidence/${doc.id}/download`, undefined, "REVIEWER"))
        .status,
    ).toBe(403);
  });
  it.each(["QUARANTINED", "REJECTED", "FAILED", "EXPIRED"] as const)(
    "blocks %s evidence",
    async (state) => {
      const i = await create();
      const doc = await evidence();
      await prisma.evidenceDocument.update({
        where: { id: doc.id },
        data: { state },
      });
      expect(
        (await act(i, "evidence", { evidenceDocumentId: doc.id })).status,
      ).toBe(400);
    },
  );
  it("rejects foreign, wrong-system, expired and deleted evidence", async () => {
    const i = await create();
    for (const [sys, t] of [
      [otherSystem, tenant],
      [foreignSystem, foreign],
    ]) {
      const d = await evidence(sys, t);
      expect(
        (await act(i, "evidence", { evidenceDocumentId: d.id })).status,
      ).toBe(404);
    }
    const d = await evidence();
    await prisma.evidenceDocument.update({
      where: { id: d.id },
      data: { expirationDate: new Date("2020-01-01") },
    });
    expect(
      (await act(i, "evidence", { evidenceDocumentId: d.id })).status,
    ).toBe(400);
    await prisma.evidenceDocument.update({
      where: { id: d.id },
      data: { deletedAt: new Date() },
    });
    expect(
      (await act(i, "evidence", { evidenceDocumentId: d.id })).status,
    ).toBe(404);
  });
  it("links same-system findings, rejects other systems and preserves finding on closure", async () => {
    let i = await create();
    const f = await finding();
    const remediation = await prisma.remediationAction.create({
      data: {
        tenantId: tenant,
        governanceFindingId: f.id,
        title: "Correct deficiency",
        description: "Existing work",
        ownerUserId: users.ADMIN,
      },
    });
    const wrong = await finding(otherSystem);
    const outside = await finding(foreignSystem, foreign);
    for (const id of [wrong.id, outside.id])
      expect((await act(i, "findings", { findingId: id })).status).toBe(404);
    i = (await act(i, "findings", { findingId: f.id })).body;
    expect(i.findings[0].finding.id).toBe(f.id);
    i = (await act(i, "start")).body;
    i = (
      await call("PATCH", `/ai-incidents/${i.id}`, {
        ...closure,
        revision: i.revision,
      })
    ).body;
    i = (await act(i, "submit-closure")).body;
    expect(
      (
        await act(
          i,
          "review",
          {
            decision: "APPROVED",
            rationale: "Response complete; finding owner tracks follow-up",
          },
          "REVIEWER",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await prisma.governanceFinding.findUniqueOrThrow({
          where: { id: f.id },
        })
      ).status,
    ).toBe("OPEN");
    expect(
      (
        await prisma.remediationAction.findUniqueOrThrow({
          where: { id: remediation.id },
        })
      ).status,
    ).toBe("OPEN");
  });
  it("duplicate evidence link rolls back revision and audit", async () => {
    let i = await create();
    const d = await evidence();
    i = (await act(i, "evidence", { evidenceDocumentId: d.id })).body;
    expect(
      (await act(i, "evidence", { evidenceDocumentId: d.id })).status,
    ).toBe(409);
    expect(
      (await prisma.aiIncident.findUniqueOrThrow({ where: { id: i.id } }))
        .revision,
    ).toBe(i.revision);
    expect(
      await prisma.auditEvent.count({
        where: { targetId: i.id, action: "ai_incident.evidence_linked" },
      }),
    ).toBe(1);
  });
  it("explicitly starts and links one existing reassessment without duplicate cycles", async () => {
    let i = await create({}, otherSystem);
    const before = await prisma.aiSystem.findUniqueOrThrow({
      where: { id: otherSystem },
    });
    expect(
      (await act(i, "reassessment", { whatChanged: "No explicit action" }))
        .status,
    ).toBe(400);
    i = (
      await act(i, "reassessment", {
        action: "START",
        whatChanged: "Incident warrants reassessment",
      })
    ).body;
    expect(i.reassessment.reason).toBe("INCIDENT");
    const second = await create({}, otherSystem);
    expect(
      (
        await act(second, "reassessment", {
          action: "START",
          whatChanged: "Another",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await act(second, "reassessment", {
          action: "LINK",
          reassessmentId: i.reassessment.id,
        })
      ).status,
    ).toBe(200);
    expect(
      (await prisma.aiSystem.findUniqueOrThrow({ where: { id: otherSystem } }))
        .assessmentStatus,
    ).toBe(before.assessmentStatus);
    const wrong = await create();
    expect(
      (
        await act(wrong, "reassessment", {
          action: "LINK",
          reassessmentId: i.reassessment.id,
        })
      ).status,
    ).toBe(404);
  });
  it("audits material changes and denials without narrative content", async () => {
    let i = await create();
    i = (
      await call("PATCH", `/ai-incidents/${i.id}`, {
        revision: i.revision,
        severity: "CRITICAL",
        ownerUserId: users.ANALYST,
        description: "Sensitive narrative fixture",
      })
    ).body;
    await act(
      i,
      "review",
      { decision: "APPROVED", rationale: "Denied" },
      "READ_ONLY",
    );
    const logs = await prisma.auditEvent.findMany({
      where: { targetId: i.id },
    });
    for (const action of [
      "created",
      "updated",
      "severity_changed",
      "owner_changed",
      "operation_denied",
    ])
      expect(logs.some((l) => l.action === `ai_incident.${action}`)).toBe(true);
    expect(JSON.stringify(logs.map((l) => l.metadataJson))).not.toContain(
      "Sensitive narrative fixture",
    );
  });
  it("derives owner work and independent pending-review queues", async () => {
    const open = await create();
    expect(
      (await myWorkFor(session("ADMIN"))).some((w) => w.id === open.id),
    ).toBe(true);
    const i = await pending();
    expect(
      (await pendingReviewsFor(session("REVIEWER"))).some((w) => w.id === i.id),
    ).toBe(true);
    expect(
      (await pendingReviewsFor(session("ADMIN"))).some((w) => w.id === i.id),
    ).toBe(false);
    expect(
      (await pendingReviewsFor(session("ANALYST"))).some((w) => w.id === i.id),
    ).toBe(false);
  });
});
