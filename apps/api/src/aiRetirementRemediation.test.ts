import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  it as test,
  expect,
  vi,
} from "vitest";
const mocks = vi.hoisted(() => {
  const originalUrl = process.env.DATABASE_URL!;
  const url = new URL(originalUrl);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "15");
  process.env.DATABASE_URL = url.toString();
  return {
    originalUrl,
    upload: vi.fn(),
    cleanup: vi.fn(),
    parse: vi.fn(),
    fail: false,
  };
});
vi.mock("@vendorguard/storage-client", () => ({
  getStorageClient: () => ({
    uploadFile: mocks.upload,
    deleteFile: mocks.cleanup,
  }),
}));
vi.mock("./evidenceExtraction.js", () => ({
  extractEvidenceText: mocks.parse,
  evidenceTextHash: () => "fixture-hash",
}));
import {
  prisma,
  databaseClient,
  governanceTransaction,
} from "@vendorguard/database";
import { createSessionCookie } from "@vendorguard/auth";
import { server } from "./index.js";
let tenant: string;
const users: Record<string, string> = {};
let sequence = 0;
const pending = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
let draining = false;
function tracked<T>(operation: Promise<T>): Promise<T> {
  pending.add(operation);
  void operation.then(
    () => pending.delete(operation),
    () => pending.delete(operation),
  );
  return operation;
}
// Vitest timeouts do not cancel test bodies; drain those too, since they can
// start an upload after an earlier fixture request finally completes.
function it(name: string, body: () => Promise<void>) {
  test(name, () => tracked(Promise.resolve().then(body)));
}
async function drainPending() {
  draining = true;
  try {
    do {
      for (const release of releases) release();
      await Promise.allSettled([...pending]);
    } while (pending.size);
  } finally {
    releases.clear();
    draining = false;
  }
}
const cookie = (role = "ADMIN") =>
  createSessionCookie({
    tenantId: tenant,
    userId: users[role]!,
    role,
    email: "fixture@example.com",
    displayName: role,
  });
async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: object,
  role = "ADMIN",
) {
  const r = await server.inject({
    method,
    url,
    payload,
    cookies: { vg_session: cookie(role) },
    remoteAddress: `10.92.0.${++sequence}`,
  });
  return { status: r.statusCode, body: r.json() };
}
async function system() {
  return (
    await prisma.aiSystem.create({
      data: {
        tenantId: tenant,
        name: "Remediation fixture",
        origin: "INTERNAL",
        ownerUserId: users.ANALYST,
      },
    })
  ).id;
}
async function draft(id: string) {
  const r = (await call("GET", `/ai-systems/${id}/retirement-readiness`)).body;
  return (
    await call("POST", `/ai-systems/${id}/retirements`, {
      reason: "NO_LONGER_NEEDED",
      businessJustification: "Fixture retirement",
      requestedRetirementDate: "2026-01-01",
      cessationConfirmed: true,
      useCaseDisposition: "Retain history",
      monitoringDisposition: "Deactivate monitoring",
      retentionStatement: "Retain accountability",
      warningDispositions: r.warnings.map((w: { key: string }) => ({
        key: w.key,
        remainingWork: "Fixture",
        whyProceed: "Use ceased",
        ownerUserId: users.ADMIN,
        followUpPlan: "Follow up",
      })),
    })
  ).body;
}
async function retire(id: string) {
  const d = await draft(id);
  const p = await call(
    "POST",
    `/ai-retirements/${d.id}/submit`,
    { revision: d.revision },
    "ANALYST",
  );
  expect(p.status).toBe(200);
  const r = await call(
    "POST",
    `/ai-retirements/${d.id}/review`,
    {
      revision: p.body.revision,
      decision: "APPROVED",
      rationale: "Independent review",
      readinessToken: p.body.readinessSnapshot.token,
      acknowledgedWarningKeys: p.body.readiness.warnings.map(
        (w: { key: string }) => w.key,
      ),
    },
    "REVIEWER",
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
async function incident(id: string) {
  return prisma.aiIncident.create({
    data: {
      tenantId: tenant,
      aiSystemId: id,
      title: "Historical investigation",
      description: "Fixture",
      severity: "LOW",
      detectedAt: new Date(),
      reporterUserId: users.ADMIN!,
      ownerUserId: users.ANALYST!,
    },
  });
}
async function upload(id: string, query = "", role = "ADMIN") {
  const boundary = "fixture-boundary";
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nFollow-up\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.pdf"\r\nContent-Type: application/pdf\r\n\r\nfixture\r\n--${boundary}--\r\n`,
  );
  const r = await tracked(
    server.inject({
      method: "POST",
      url: `/ai-systems/${id}/evidence/upload${query}`,
      payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      cookies: { vg_session: cookie(role) },
      remoteAddress: `10.92.0.${++sequence}`,
    }),
  );
  return { status: r.statusCode, body: r.json() };
}
function delayed() {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    wait = new Promise<void>((r) => (release = r));
  releases.add(release);
  if (draining) release();
  mocks.upload.mockImplementationOnce(async (_c: string, key: string) => {
    entered();
    await wait;
    return {
      storageKey: key,
      mimeType: "application/pdf",
      sizeBytes: 7,
      sha256Hash: "fixture",
    };
  });
  return { started, release };
}
beforeAll(async () => {
  tenant = (
    await prisma.tenant.create({ data: { name: `Remediation ${Date.now()}` } })
  ).id;
  for (const role of ["ADMIN", "ANALYST", "REVIEWER"]) {
    users[role] = (
      await prisma.user.create({
        data: {
          externalId: `${tenant}-${role}`,
          email: `${tenant}-${role}@example.com`,
          displayName: role,
        },
      })
    ).id;
    await prisma.tenantMembership.create({
      data: {
        tenantId: tenant,
        userId: users[role]!,
        role: role as "ADMIN" | "ANALYST" | "REVIEWER",
      },
    });
  }
  databaseClient.$use(async (params, next) => {
    if (
      mocks.fail &&
      params.model === "AuditEvent" &&
      params.action === "create" &&
      params.args.data.action === "ai_system_evidence.uploaded"
    )
      throw Error("Simulated persistence failure");
    return next(params);
  });
}, 30000);
beforeEach(async () => {
  await drainPending();
  mocks.fail = false;
  mocks.upload.mockReset();
  mocks.cleanup.mockReset();
  mocks.parse.mockReset();
  mocks.upload.mockImplementation(async (_c: string, key: string) => ({
    storageKey: key,
    mimeType: "application/pdf",
    sizeBytes: 7,
    sha256Hash: "fixture",
  }));
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.parse.mockResolvedValue(["Fixture text"]);
});
afterEach(drainPending);
afterAll(async () => {
  await drainPending();
  mocks.fail = false;
  if (!tenant) {
    await databaseClient.$disconnect();
    process.env.DATABASE_URL = mocks.originalUrl;
    return;
  }
  for (const model of [
    "aiSystemRetirementReview",
    "aiSystemRetirementEvidence",
    "aiSystemRetirement",
    "aiIncidentReview",
    "aiIncidentEvidence",
    "aiIncidentFinding",
    "aiIncident",
    "remediationAction",
    "aiRisk",
    "aiRiskAssessment",
    "evidenceChunk",
    "evidenceDocument",
    "aiSystem",
    "auditEvent",
    "tenantMembership",
  ])
    await (
      prisma as unknown as Record<
        string,
        { deleteMany(args: unknown): Promise<unknown> }
      >
    )[model]!.deleteMany({ where: { tenantId: tenant } });
  await prisma.tenant.delete({ where: { id: tenant } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await server.close();
  await databaseClient.$disconnect();
  process.env.DATABASE_URL = mocks.originalUrl;
}, 30000);
it("completes concurrent writes with a single pooled connection", async () => {
  const retired = await system();
  await prisma.aiSystem.update({
    where: { id: retired },
    data: { lifecycleStatus: "RETIRED", retiredAt: new Date() },
  });
  const id = await system();
  const rs = await Promise.all([
    call("PATCH", `/ai-systems/${id}`, { name: "First" }),
    call("PATCH", `/ai-systems/${id}`, { name: "Second" }),
  ]);
  expect(rs.map((r) => r.status)).toEqual([200, 200]);
});
it("blocks retired operational uploads before parsing or storage", async () => {
  const id = await system();
  await retire(id);
  expect((await upload(id)).status).toBe(409);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.parse).not.toHaveBeenCalled();
});
it("permits authorized historical incident uploads", async () => {
  const id = await system();
  await retire(id);
  const i = await incident(id),
    r = await upload(id, `?incidentId=${i.id}`, "ANALYST");
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(
    await prisma.evidenceChunk.count({ where: { documentId: r.body.id } }),
  ).toBe(1);
});
it("permits authorized historical remediation uploads", async () => {
  const id = await system();
  await retire(id);
  const a = await prisma.aiRiskAssessment.create({
      data: { tenantId: tenant, aiSystemId: id, name: "History", version: 1 },
    }),
    risk = await prisma.aiRisk.create({
      data: {
        tenantId: tenant,
        assessmentId: a.id,
        title: "Risk",
        statement: "Fixture",
        category: "OPERATIONAL",
        likelihood: 1,
        impact: 1,
        inherentScore: 1,
        inherentRating: "LOW",
      },
    }),
    rem = await prisma.remediationAction.create({
      data: {
        tenantId: tenant,
        aiRiskId: risk.id,
        title: "Follow-up",
        description: "Fixture",
        ownerUserId: users.ANALYST,
      },
    });
  expect((await upload(id, `?remediationId=${rem.id}`, "ANALYST")).status).toBe(
    201,
  );
});
it("rejects wrong-system and locked follow-up contexts before storage", async () => {
  const id = await system(),
    other = await system();
  await retire(id);
  const i = await incident(other);
  expect((await upload(id, `?incidentId=${i.id}`)).status).toBe(404);
  await prisma.aiIncident.update({
    where: { id: i.id },
    data: { status: "CLOSED" },
  });
  expect((await upload(other, `?incidentId=${i.id}`)).status).toBe(409);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("keeps delayed storage and extraction outside locks", async () => {
  const id = await system();
  mocks.parse.mockImplementationOnce(async () => {
    expect(governanceTransaction.getStore()).toBeUndefined();
    return [];
  });
  const delay = delayed(),
    op = upload(id);
  await delay.started;
  try {
    expect(
      (await call("PATCH", `/ai-systems/${id}`, { name: "During storage" }))
        .status,
    ).toBe(200);
  } finally {
    delay.release();
  }
  expect((await op).status).toBe(201);
});
it("rejects retirement during storage and compensates", async () => {
  const id = await system(),
    delay = delayed(),
    op = upload(id);
  await delay.started;
  try {
    await retire(id);
  } finally {
    delay.release();
  }
  expect((await op).status).toBe(409);
  expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  expect(
    await prisma.evidenceDocument.count({ where: { aiSystemId: id } }),
  ).toBe(0);
});
it("revalidates ownership changes during storage", async () => {
  const id = await system();
  await retire(id);
  const i = await incident(id),
    delay = delayed(),
    op = upload(id, `?incidentId=${i.id}`, "ANALYST");
  await delay.started;
  try {
    await prisma.aiIncident.update({
      where: { id: i.id },
      data: { ownerUserId: users.ADMIN, revision: { increment: 1 } },
    });
  } finally {
    delay.release();
  }
  expect((await op).status).toBe(403);
  expect(mocks.cleanup).toHaveBeenCalledTimes(1);
});
it("rolls back persistence and compensates uploaded blobs", async () => {
  const id = await system();
  mocks.fail = true;
  expect((await upload(id)).status).toBe(500);
  expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  expect(
    await prisma.evidenceDocument.count({ where: { aiSystemId: id } }),
  ).toBe(0);
  expect(
    await prisma.auditEvent.count({
      where: {
        tenantId: tenant,
        targetId: id,
        action: "ai_system_evidence.upload_rolled_back",
      },
    }),
  ).toBe(1);
});
it("reports and audits compensation failure", async () => {
  const id = await system();
  mocks.fail = true;
  mocks.cleanup.mockRejectedValueOnce(Error("Storage unavailable"));
  const r = await upload(id);
  expect(r.status).toBe(500);
  expect(r.body.message ?? r.body.error).toContain("operator cleanup");
  expect(
    await prisma.auditEvent.count({
      where: {
        tenantId: tenant,
        targetId: id,
        action: "ai_system_evidence.cleanup_failed",
      },
    }),
  ).toBe(1);
});
it("retains cancellation rationale without copying narrative into audit metadata", async () => {
  const id = await system(),
    d = await draft(id),
    rationale = "Business review postponed";
  expect(
    (
      await call("POST", `/ai-retirements/${d.id}/cancel`, {
        revision: d.revision,
        rationale,
      })
    ).status,
  ).toBe(200);
  expect(
    (await call("GET", `/ai-retirements/${d.id}`, undefined, "REVIEWER")).body
      .cancellationRationale,
  ).toBe(rationale);
  const event = await prisma.auditEvent.findFirstOrThrow({
    where: {
      tenantId: tenant,
      targetId: d.id,
      action: "ai_retirement.cancelled",
    },
  });
  expect(JSON.stringify(event.metadataJson)).not.toContain(rationale);
});
