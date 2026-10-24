import { randomUUID } from "node:crypto";
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  prisma,
  resourceScope,
  issueStoredSession,
  SESSION_MAX_AGE_MS,
  scopeResourceRead,
} from "@vendorguard/database";
import {
  createSessionCookie,
  getSessionFromCookie,
  evidenceAllowed,
} from "@vendorguard/auth";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";
import { runEvidenceAnalysis } from "./evidenceAnalysis.js";
import { getStorageClient } from "@vendorguard/storage-client";
import type { Role } from "@vendorguard/shared";

let tenant: string,
  other: string,
  system: string,
  vendor: string,
  assessment: string,
  document: string,
  control: string,
  foreign: string,
  mapped: string,
  link: string;
const users: Record<string, string> = {},
  frameworks: string[] = [];
let ip = 0;
const applicability: Record<string, string> = {};
const identity = (role: string) => ({
  userId: users[role]!,
  tenantId: tenant,
  role,
  email: "hardening@example.com",
  displayName: "Hardening fixture",
});
async function request(
  method: "GET" | "POST" | "PATCH",
  url: string,
  role = "ADMIN",
  payload?: object,
  cookie?: string,
) {
  return server.inject({
    method,
    url,
    payload,
    cookies: {
      vg_session: cookie ?? (await issueTestSessionCookie(identity(role))),
    },
    remoteAddress: `10.66.${Math.floor(++ip / 250)}.${ip % 250}`,
  });
}
beforeAll(async () => {
  tenant = (
    await prisma.tenant.create({ data: { name: "Hardening regression A" } })
  ).id;
  other = (
    await prisma.tenant.create({ data: { name: "Hardening regression B" } })
  ).id;
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"]) {
    const id = randomUUID();
    users[role] = (
      await prisma.user.create({
        data: { externalId: id, email: `${id}@example.com`, displayName: role },
      })
    ).id;
    await prisma.tenantMembership.create({
      data: { userId: users[role]!, tenantId: tenant, role: role as Role },
    });
  }
  system = (
    await prisma.aiSystem.create({
      data: { tenantId: tenant, name: "Hardening system", origin: "INTERNAL" },
    })
  ).id;
  vendor = (
    await prisma.vendor.create({
      data: {
        tenantId: tenant,
        legalName: "Hardening vendor",
        serviceDescription: "test",
        serviceCategory: "test",
        criticality: "LOW",
      },
    })
  ).id;
  assessment = (
    await prisma.assessment.create({
      data: {
        tenantId: tenant,
        vendorId: vendor,
        scoringModelVersion: "test",
        startedByUserId: users.ANALYST!,
      },
    })
  ).id;
  for (const owner of [tenant, other, null]) {
    const framework = await prisma.framework.create({
      data: {
        catalogId: `s8-test-hardening-${randomUUID()}`,
        tenantId: owner,
        name: "Private security probe",
        scope: "VENDOR_ASSESSMENT",
        industries: [],
      },
    });
    frameworks.push(framework.id);
    if (owner)
      applicability[owner] = (
        await prisma.aiSystemFrameworkApplicability.create({
          data: {
            tenantId: tenant,
            aiSystemId: system,
            frameworkId: framework.id,
            status: "APPLICABLE",
            rationale: "Historical test fixture",
            determinedAt: new Date(),
            determinedByUserId: users.ADMIN!,
          },
        })
      ).id;
    const version = await prisma.frameworkVersion.create({
      data: { frameworkId: framework.id, version: "1" },
    });
    const row = await prisma.control.create({
      data: {
        frameworkVersionId: version.id,
        controlId: randomUUID(),
        title:
          owner === other
            ? "FOREIGN PRIVATE SENTINEL"
            : "Visible governance control",
        summary: "Security regression fixture",
        domain: "test",
        expectedEvidenceTypes: ["Policy"],
        validationGuidance: "Human review",
      },
    });
    if (owner === tenant) control = row.id;
    if (owner === other) foreign = row.id;
  }
  mapped = (
    await prisma.aiSystemControl.create({
      data: {
        tenantId: tenant,
        aiSystemId: system,
        controlId: control,
        sourceApplicabilityId: applicability[tenant]!,
      },
    })
  ).id;
  document = (
    await prisma.evidenceDocument.create({
      data: {
        tenantId: tenant,
        aiSystemId: system,
        vendorId: vendor,
        displayFilename: "RESTRICTED EVIDENCE SENTINEL.pdf",
        storageKey: randomUUID(),
        mimeType: "application/pdf",
        sizeBytes: 4,
        sha256Hash: randomUUID(),
        documentType: "Policy",
        uploadedByUserId: users.ANALYST!,
      },
    })
  ).id;
  link = (
    await prisma.aiSystemControlEvidence.create({
      data: {
        tenantId: tenant,
        aiSystemControlId: mapped,
        evidenceDocumentId: document,
        submittedByUserId: users.ANALYST!,
      },
    })
  ).id;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.aiControlTestEvidence.deleteMany({
    where: { tenantId: tenant },
  });
  await prisma.aiControlTest.deleteMany({ where: { tenantId: tenant } });
  await prisma.aiControlEvidenceReview.deleteMany({
    where: { tenantId: tenant },
  });
  await prisma.aiSystemControlEvidence.deleteMany({
    where: { tenantId: tenant },
  });
  await prisma.aiSystemControl.deleteMany({ where: { tenantId: tenant } });
  await prisma.aiSystemFrameworkApplicability.deleteMany({
    where: { tenantId: tenant },
  });
  await prisma.reviewDecision.deleteMany({ where: { tenantId: tenant } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: tenant } });
  await prisma.findingEvidence.deleteMany({ where: { tenantId: tenant } });
  await prisma.controlFinding.deleteMany({ where: { tenantId: tenant } });
  await prisma.evidenceDocument.deleteMany({ where: { tenantId: tenant } });
  await prisma.aiUseCase.deleteMany({ where: { tenantId: tenant } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenant } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId: tenant } });
  await prisma.assessment.deleteMany({ where: { tenantId: tenant } });
  await prisma.vendor.deleteMany({ where: { tenantId: tenant } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenant } });
  await prisma.framework.deleteMany({ where: { id: { in: frameworks } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenant } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenant } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenant, other] } } });
});

describe("B1 visibility mutation regression", () => {
  it("keeps frozen reusable selections unchanged and scoped predicates stable", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const selection = Object.freeze({
      riskAcceptances: Object.freeze({
        where: Object.freeze({ status: "APPROVED" }),
        select: Object.freeze({ id: true }),
      }),
    });
    const args = Object.freeze({
      where: Object.freeze({ createdAt: date }),
      include: selection,
    });
    const original = JSON.stringify(args);
    const first = scopeResourceRead("GovernanceFinding", args, tenant);
    for (let i = 0; i < 12; i++) {
      const reused = scopeResourceRead("GovernanceFinding", args, tenant);
      const fresh = scopeResourceRead(
        "GovernanceFinding",
        {
          where: { createdAt: date },
          include: {
            riskAcceptances: {
              where: { status: "APPROVED" },
              select: { id: true },
            },
          },
        },
        tenant,
      );
      expect(reused).toEqual(first);
      expect(JSON.stringify(reused)).toBe(JSON.stringify(fresh));
      expect((reused.where as { createdAt: Date }).createdAt).toBe(date);
      expect(JSON.stringify(args)).toBe(original);
    }
  });

  it("does not retain a previous tenant predicate in shared nested selections", () => {
    const shared = { include: { controls: { include: { control: true } } } };
    const original = JSON.stringify(shared);
    const a = scopeResourceRead("AiSystem", shared, tenant);
    const b = scopeResourceRead("AiSystem", shared, other);
    expect(JSON.stringify(a)).toContain(tenant);
    expect(JSON.stringify(a)).not.toContain(other);
    expect(JSON.stringify(b)).toContain(other);
    expect(JSON.stringify(b)).not.toContain(tenant);
    expect(scopeResourceRead("AiSystem", shared, tenant)).toEqual(a);
    expect(JSON.stringify(shared)).toBe(original);
  });

  it("reuses a selection across tenant requests with own/global success and foreign denial", async () => {
    const query = {
      where: { id: { in: frameworks } },
      include: { versions: { include: { controls: true } } },
    };
    const original = JSON.stringify(query);
    for (const current of [tenant, other, tenant]) {
      const result = await resourceScope.run(
        { tenantId: current },
        async () => await prisma.framework.findMany(query),
      );
      expect(result.map((row) => row.id).sort()).toEqual(
        [frameworks[current === tenant ? 0 : 1]!, frameworks[2]!].sort(),
      );
      const visible = result.flatMap((row) =>
        row.versions.flatMap((version) =>
          version.controls.map((entry) => entry.id),
        ),
      );
      expect(visible).toContain(current === tenant ? control : foreign);
      expect(visible).not.toContain(current === tenant ? foreign : control);
      expect(JSON.stringify(query)).toBe(original);
    }
  });
});

describe("B1 authoritative private-control visibility", () => {
  it("repeats the original AI-risk control-selection and nested historical-read probes", async () => {
    const a = await prisma.aiRiskAssessment.create({
      data: {
        tenantId: tenant,
        aiSystemId: system,
        name: "Private-control risk probe",
        version: 2,
        assessorUserId: users.ANALYST!,
      },
    });
    const risk = {
      title: "Private control selection",
      category: "FAIRNESS",
      statement: "Security regression",
      likelihood: 2,
      impact: 2,
    };
    expect(
      (
        await request("POST", `/ai-risk-assessments/${a.id}/risks`, "ANALYST", {
          ...risk,
          controlId: foreign,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", `/ai-risk-assessments/${a.id}/risks`, "ANALYST", {
          ...risk,
          controlId: control,
        })
      ).statusCode,
    ).toBe(201);
    const old = await prisma.aiRisk.create({
      data: {
        ...risk,
        category: "FAIRNESS",
        tenantId: tenant,
        assessmentId: a.id,
        inherentScore: 4,
        inherentRating: "LOW",
        controlId: foreign,
      },
    });
    const read = await request("GET", `/ai-risk-assessments/${a.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain("FOREIGN PRIVATE SENTINEL");
    expect(
      read.json().risks.map((row: { id: string }) => row.id),
    ).not.toContain(old.id);
    expect(
      (await prisma.aiRisk.findUniqueOrThrow({ where: { id: old.id } }))
        .controlId,
    ).toBe(foreign);
  });
  it("denies a foreign control proposal while allowing the current tenant control", async () => {
    expect(
      (
        await request(
          "POST",
          `/assessments/${assessment}/findings`,
          "ANALYST",
          { controlId: foreign, status: "PASS" },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      await prisma.controlFinding.count({
        where: { assessmentId: assessment, controlId: foreign },
      }),
    ).toBe(0);
    const res = await request(
      "POST",
      `/assessments/${assessment}/findings`,
      "ANALYST",
      { controlId: control, status: "PASS" },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().requiresHumanReview).toBe(true);
    expect(res.json().status).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("applies visibility to unique reads, search and nested historical relationships without deleting them", async () => {
    const historical = await prisma.aiSystemControl.create({
      data: {
        tenantId: tenant,
        aiSystemId: system,
        controlId: foreign,
        sourceApplicabilityId: applicability[other]!,
      },
    });
    await resourceScope.run({ tenantId: tenant }, async () => {
      expect(
        await prisma.control.findUnique({ where: { id: foreign } }),
      ).toBeNull();
      expect(
        await prisma.control.findUnique({ where: { id: control } }),
      ).not.toBeNull();
      expect(await prisma.control.count({ where: { id: foreign } })).toBe(0);
      const nested = await prisma.aiSystem.findUnique({
        where: { id: system },
        include: { controls: { include: { control: true } } },
      });
      expect(JSON.stringify(nested)).not.toContain("FOREIGN PRIVATE SENTINEL");
      expect(
        (await prisma.framework.findMany({ where: { id: { in: frameworks } } }))
          .length,
      ).toBe(2);
    });
    expect(
      await prisma.aiSystemControl.findUnique({ where: { id: historical.id } }),
    ).not.toBeNull();
    const response = await request("GET", `/ai-systems/${system}/controls`);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("FOREIGN PRIVATE SENTINEL");
    const foreignFinding = await prisma.controlFinding.create({
      data: {
        tenantId: tenant,
        vendorId: vendor,
        assessmentId: assessment,
        controlId: foreign,
        status: "PASS",
      },
    });
    const remediation = await prisma.remediationAction.create({
      data: {
        tenantId: tenant,
        vendorId: vendor,
        findingId: foreignFinding.id,
        title: "Historical relationship",
        description: "Private control regression",
      },
    });
    await resourceScope.run({ tenantId: tenant }, async () => {
      expect(
        await prisma.remediationAction.findUnique({
          where: { id: remediation.id },
          include: { finding: { include: { control: true } } },
        }),
      ).toBeNull();
    });
    expect(
      await prisma.remediationAction.findUnique({
        where: { id: remediation.id },
      }),
    ).not.toBeNull();
  });
});
describe("H2 evidence operations and narrowly scoped independent review", () => {
  for (const role of ["READ_ONLY", "REVIEWER"] as const)
    it(`denies ${role} general metadata, content and analysis`, async () => {
      const originalLookup = prisma.evidenceDocument.findFirst;
      const lookup = vi.spyOn(prisma.evidenceDocument, "findFirst");
      expect(
        (await request("GET", `/ai-systems/${system}/evidence`, role))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "POST",
            `/assessments/${assessment}/evidence/${document}/analyze`,
            role,
          )
        ).statusCode,
      ).toBe(403);
      expect(lookup).not.toHaveBeenCalled();
      lookup.mockRestore();
      prisma.evidenceDocument.findFirst = originalLookup;
      expect(
        (await request("GET", `/evidence/${document}/download`, role))
          .statusCode,
      ).toBe(403);
      expect(
        (await request("GET", `/evidence/${document}`, role)).statusCode,
      ).toBe(403);
    });
  it("allows auditor metadata but denies auditor content and analysis", async () => {
    expect(
      (await request("GET", `/ai-systems/${system}/evidence`, "AUDITOR"))
        .statusCode,
    ).toBe(200);
    expect(
      (await request("GET", `/evidence/${document}`, "AUDITOR")).statusCode,
    ).toBe(200);
    expect(
      (await request("GET", `/evidence/${document}/download`, "AUDITOR"))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          "POST",
          `/assessments/${assessment}/evidence/${document}/analyze`,
          "AUDITOR",
        )
      ).statusCode,
    ).toBe(403);
  });
  it("allows content for ADMIN and ANALYST through the same operation policy", async () => {
    const previousProvider = process.env.STORAGE_PROVIDER;
    const previousConnection = process.env.AZURITE_CONNECTION_STRING;
    // Constructor-only emulator configuration; download is mocked below.
    process.env.STORAGE_PROVIDER = "azurite";
    process.env.AZURITE_CONNECTION_STRING = "UseDevelopmentStorage=true";
    let download:
      | MockInstance<ReturnType<typeof getStorageClient>["downloadFile"]>
      | undefined;
    try {
      download = vi
        .spyOn(getStorageClient(), "downloadFile")
        .mockResolvedValue(Buffer.from("test"));
      for (const role of ["ADMIN", "ANALYST"])
        expect(
          (await request("GET", `/evidence/${document}/download`, role))
            .statusCode,
        ).toBe(200);
      expect(download).toHaveBeenCalledTimes(2);
    } finally {
      download?.mockRestore();
      if (previousProvider === undefined) delete process.env.STORAGE_PROVIDER;
      else process.env.STORAGE_PROVIDER = previousProvider;
      if (previousConnection === undefined)
        delete process.env.AZURITE_CONNECTION_STRING;
      else process.env.AZURITE_CONNECTION_STRING = previousConnection;
    }
  });
  it("allows only pending metadata for an eligible independent reviewer; general access remains denied", async () => {
    const response = await request(
      "GET",
      `/ai-system-controls/${mapped}/evidence`,
      "REVIEWER",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().evidenceAccess).toBe("REVIEW_CONTEXT");
    expect(response.json().links[0].id).toBe(link);
    expect(response.body).not.toContain("storageKey");
    expect(response.body).not.toContain("chunks");
    const restricted = await request(
      "GET",
      `/ai-system-controls/${mapped}/evidence`,
      "READ_ONLY",
    );
    expect(restricted.json().links).toBeNull();
    expect(restricted.json().assuranceStatus).toBeNull();
    expect(
      (
        await request(
          "POST",
          `/ai-control-evidence/${link}/review`,
          "REVIEWER",
          { decision: "ACCEPT", rationale: "Independent evidence review" },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          "GET",
          `/ai-system-controls/${mapped}/evidence`,
          "REVIEWER",
        )
      ).json().links,
    ).toBeNull();
  });
  it("limits control-test metadata to its assigned independent tester", async () => {
    const started = await request(
      "POST",
      `/ai-system-controls/${mapped}/tests`,
      "REVIEWER",
      { method: "DOCUMENT_REVIEW", procedure: "Independent hardening test" },
    );
    expect(started.statusCode).toBe(201);
    const id = started.json().id;
    const candidates = await request(
      "GET",
      `/ai-system-controls/${mapped}/evidence`,
      "REVIEWER",
    );
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().evidenceAccess).toBe("REVIEW_CONTEXT");
    expect(
      candidates.json().links.map((item: { id: string }) => item.id),
    ).toContain(link);
    const attached = await request(
      "POST",
      `/ai-control-tests/${id}/evidence`,
      "REVIEWER",
      { evidenceLinkId: link },
    );
    expect(attached.statusCode).toBe(201);
    expect(attached.json().evidenceAccess).toBe("REVIEW_CONTEXT");
    expect(attached.json().evidence).toHaveLength(1);
    expect(attached.body).not.toContain("storageKey");
    expect(attached.body).not.toContain("chunks");
    const restricted = await request(
      "GET",
      `/ai-control-tests/${id}`,
      "READ_ONLY",
    );
    expect(restricted.statusCode).toBe(200);
    expect(restricted.json().evidence).toBeNull();
    await prisma.aiControlTest.update({
      where: { id },
      data: { testerUserId: users.ADMIN! },
    });
    const unassigned = await request(
      "GET",
      `/ai-control-tests/${id}`,
      "REVIEWER",
    );
    expect(unassigned.statusCode).toBe(200);
    expect(unassigned.json().evidence).toBeNull();
    expect(
      (
        await request(
          "GET",
          `/ai-system-controls/${mapped}/evidence`,
          "REVIEWER",
        )
      ).json().links,
    ).toBeNull();
    const assurance = await request(
      "GET",
      `/ai-systems/${system}/assurance`,
      "READ_ONLY",
    );
    expect(assurance.json().byControl).toBeNull();
    expect(
      (await request("GET", `/evidence/${document}/download`, "REVIEWER"))
        .statusCode,
    ).toBe(403);
  });
  it("authorizes analysis for ANALYST without allowing AI to finalize any finding", async () => {
    const result = await runEvidenceAnalysis({
      tenantId: tenant,
      assessmentId: assessment,
      evidenceDocumentId: document,
      actor: { userId: users.ANALYST!, role: "ANALYST" },
    });
    expect(result.analysis).toBeDefined();
    expect(result.findings.length).toBeGreaterThan(0);
    for (const row of result.findings)
      expect(row.requiresHumanReview).toBe(true);
    expect(evidenceAllowed("REVIEWER", "analysis")).toBe(false);
  });
});
describe("H1 independent human decisions and legacy reconciliation", () => {
  it("denies an authorized reviewer who is also the proposer", async () => {
    const a = await prisma.assessment.create({
      data: {
        tenantId: tenant,
        vendorId: vendor,
        scoringModelVersion: "self-review",
        startedByUserId: users.ADMIN!,
      },
    });
    const proposed = await request(
      "POST",
      `/assessments/${a.id}/findings`,
      "ADMIN",
      { controlId: control, status: "PASS" },
    );
    expect(proposed.statusCode).toBe(200);
    expect(
      (
        await request(
          "POST",
          `/assessments/${a.id}/findings/${proposed.json().id}/review`,
          "ADMIN",
          { decision: "ACCEPT", rationale: "Self approval" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      await prisma.reviewDecision.count({
        where: { findingId: proposed.json().id },
      }),
    ).toBe(0);
    expect(
      (
        await request(
          "POST",
          `/assessments/${a.id}/findings/${proposed.json().id}/review`,
          "REVIEWER",
          { decision: "ACCEPT", rationale: "Independent review" },
        )
      ).statusCode,
    ).toBe(200);
  });
  it("requires reviewer authority, rationale and separation of duties, then protects the durable decision", async () => {
    const finding = await prisma.controlFinding.findFirstOrThrow({
      where: { assessmentId: assessment, controlId: control },
    });
    const url = `/assessments/${assessment}/findings/${finding.id}/review`;
    expect(
      (
        await request("POST", url, "ANALYST", {
          decision: "ACCEPT",
          rationale: "Self approval",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request("POST", url, "REVIEWER", {
          decision: "ACCEPT",
          rationale: " ",
        })
      ).statusCode,
    ).toBe(400);
    const reviewed = await request("POST", url, "REVIEWER", {
      decision: "OVERRIDE",
      finalStatus: "PASS",
      rationale: "Independent human conclusion",
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().finding.requiresHumanReview).toBe(false);
    expect(
      (
        await request(
          "POST",
          `/assessments/${assessment}/findings`,
          "ANALYST",
          { controlId: control, status: "FAIL" },
        )
      ).statusCode,
    ).toBe(409);
    await runEvidenceAnalysis({
      tenantId: tenant,
      assessmentId: assessment,
      evidenceDocumentId: document,
      actor: { userId: users.ANALYST!, role: "ANALYST" },
    });
    expect(
      (
        await prisma.controlFinding.findUniqueOrThrow({
          where: { id: finding.id },
        })
      ).status,
    ).toBe("PASS");
    expect(
      await prisma.reviewDecision.count({ where: { findingId: finding.id } }),
    ).toBe(1);
  });
  it("preserves an unattributed record and requires audited human reconciliation instead of fabricated history", async () => {
    const a = await prisma.assessment.create({
      data: {
        tenantId: tenant,
        vendorId: vendor,
        scoringModelVersion: "legacy",
        startedByUserId: users.ANALYST!,
      },
    });
    const f = await prisma.controlFinding.create({
      data: {
        tenantId: tenant,
        vendorId: vendor,
        assessmentId: a.id,
        controlId: control,
        status: "PASS",
        requiresHumanReview: false,
      },
    });
    const snapshot = {
      controlId: control,
      assessmentId: a.id,
      status: "PASS",
      requiresHumanReview: false,
      reviewDecisions: [],
    };
    const historicalAudit = await prisma.auditEvent.create({
      data: {
        tenantId: tenant,
        actorUserId: users.ADMIN!,
        action: "historical.snapshot",
        targetType: "ControlFinding",
        targetId: f.id,
        outcome: "SUCCESS",
        metadataJson: snapshot,
      },
    });
    await resourceScope.run({ tenantId: tenant }, async () => {
      expect(
        (
          await prisma.auditEvent.findUniqueOrThrow({
            where: { id: historicalAudit.id },
          })
        ).metadataJson,
      ).toEqual(snapshot);
    });
    const url = `/assessments/${a.id}/findings/${f.id}`;
    expect(
      (
        await request("POST", `${url}/review`, "REVIEWER", {
          decision: "ACCEPT",
          rationale: "Unknown author",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await prisma.reviewDecision.count({ where: { findingId: f.id } }),
    ).toBe(0);
    expect(
      (
        await request("POST", `${url}/reconcile`, "ANALYST", {
          proposedStatus: "PASS",
          rationale: "New accountable proposal, not historical attribution",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request("POST", `${url}/review`, "REVIEWER", {
          decision: "ACCEPT",
          rationale: "Explicit independent review",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await prisma.auditEvent.count({
        where: { targetId: f.id, action: "legacy_finding.reconciled_proposal" },
      }),
    ).toBe(1);
  });
});
describe("M1 append-only, attributable decision history", () => {
  for (const rationale of ["Actual retained rationale", null])
    it(`preserves only existing historical rationale: ${rationale ?? "missing"}`, async () => {
      const reviewedAt = new Date(Date.now() - 2000);
      const uc = await prisma.aiUseCase.create({
        data: {
          tenantId: tenant,
          aiSystemId: system,
          name: "Legacy decision",
          businessPurpose: "Attribution validation",
          ownerUserId: users.ADMIN!,
          createdByUserId: users.ANALYST!,
          status: "PENDING_REVIEW",
          reviewerUserId: users.REVIEWER!,
          reviewDecision: "CHANGES_REQUESTED",
          reviewRationale: rationale,
          reviewedAt,
        },
      });
      if (!rationale) {
        expect(
          (
            await request("POST", `/ai-use-cases/${uc.id}/review`, "REVIEWER", {
              decision: "APPROVED",
              rationale: "New genuine review",
            })
          ).statusCode,
        ).toBe(409);
        expect(
          (await prisma.aiUseCase.findUniqueOrThrow({ where: { id: uc.id } }))
            .status,
        ).toBe("PENDING_REVIEW");
      }
      expect(
        (
          await request("POST", `/ai-use-cases/${uc.id}/review`, "REVIEWER", {
            decision: "APPROVED",
            rationale: "New genuine review",
            ...(!rationale
              ? {
                  reconciliationRationale:
                    "The original rationale is unavailable; this is a new human decision",
                }
              : {}),
          })
        ).statusCode,
      ).toBe(200);
      const history = await prisma.governanceDecision.findMany({
        where: { useCaseId: uc.id },
        orderBy: { createdAt: "asc" },
      });
      expect(history.map((x) => x.rationale)).toEqual(
        rationale ? [rationale, "New genuine review"] : ["New genuine review"],
      );
      if (rationale) {
        expect(history[0]!.createdAt).toEqual(reviewedAt);
        expect(history[0]!.context).toEqual({
          origin: "preserved_stored_decision",
        });
      } else
        expect(history[0]!.context).toMatchObject({
          origin: "audited_human_legacy_reconciliation",
          legacyReviewSnapshot: {
            rationale: null,
            reviewerUserId: users.REVIEWER,
          },
        });
    });
  for (const kind of ["use-case", "risk", "impact"] as const)
    it(`requires audited ${kind} reconciliation and preserves a known rationale with unknown historical actor`, async () => {
      const common = {
        tenantId: tenant,
        aiSystemId: system,
        name: "Incomplete legacy attribution",
        reviewDecision: "CHANGES_REQUESTED" as const,
        reviewRationale: "Known legacy text",
        reviewedAt: new Date(Date.now() - 1000),
      };
      const record =
        kind === "use-case"
          ? await prisma.aiUseCase.create({
              data: {
                ...common,
                businessPurpose: "Legacy reconciliation",
                ownerUserId: users.ADMIN!,
                createdByUserId: users.ANALYST!,
                status: "PENDING_REVIEW",
              },
            })
          : kind === "risk"
            ? await prisma.aiRiskAssessment.create({
                data: {
                  ...common,
                  version: 90,
                  status: "READY_FOR_REVIEW",
                  noItemsJustification: "Assessor documented no items for reconciliation fixture",
                  assessorUserId: users.ANALYST!,
                },
              })
            : await prisma.aiImpactAssessment.create({
                data: {
                  ...common,
                  version: 90,
                  status: "READY_FOR_REVIEW",
                  noItemsJustification: "Assessor documented no items for reconciliation fixture",
                  assessorUserId: users.ANALYST!,
                },
              });
      const url =
        kind === "use-case"
          ? `/ai-use-cases/${record.id}/review`
          : `/ai-${kind}-assessments/${record.id}/review`;
      expect(
        (
          await request("POST", url, "REVIEWER", {
            decision: "APPROVED",
            rationale: "Current independent decision",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await request("POST", url, "REVIEWER", {
            decision: "APPROVED",
            rationale: "Current independent decision",
            reconciliationRationale:
              "Acknowledge unknown original actor; retain the known original text",
          })
        ).statusCode,
      ).toBe(200);
      const history = await prisma.governanceDecision.findMany({
        where:
          kind === "use-case"
            ? { useCaseId: record.id }
            : kind === "risk"
              ? { riskAssessmentId: record.id }
              : { impactAssessmentId: record.id },
      });
      expect(history).toHaveLength(1);
      expect(history[0]!.actorUserId).toBe(users.REVIEWER);
      expect(history[0]!.context).toMatchObject({
        origin: "audited_human_legacy_reconciliation",
        legacyReviewSnapshot: {
          reviewerUserId: null,
          rationale: "Known legacy text",
        },
      });
      expect(
        await prisma.auditEvent.findFirst({
          where: {
            correlationId: history[0]!.correlationId,
            actorUserId: users.REVIEWER,
            outcome: "SUCCESS",
          },
        }),
      ).not.toBeNull();
    });
  for (const kind of ["risk", "impact"] as const)
    it(`retains both ${kind} assessment rationales and version context`, async () => {
      const data = {
        name: "Review history regression",
        status: "READY_FOR_REVIEW" as const,
        noItemsJustification: "Assessor documented no items for history fixture",
        tenantId: tenant,
        aiSystemId: system,
        version: 1,
        assessorUserId: users.ANALYST!,
      };
      const assessment =
        kind === "risk"
          ? await prisma.aiRiskAssessment.create({ data })
          : await prisma.aiImpactAssessment.create({ data });
      const url = `/ai-${kind}-assessments/${assessment.id}`;
      expect(
        (
          await request("POST", `${url}/review`, "ANALYST", {
            decision: "APPROVED",
            rationale: "Self review",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request("POST", `${url}/review`, "REVIEWER", {
            decision: "CHANGES_REQUESTED",
            rationale: "Original rationale",
          })
        ).statusCode,
      ).toBe(200);
      expect((await request("PATCH", url, "ANALYST", { status: "READY_FOR_REVIEW" })).statusCode).toBe(200);
      expect(
        (
          await request("POST", `${url}/review`, "REVIEWER", {
            decision: "APPROVED",
            rationale: "Resolved rationale",
          })
        ).statusCode,
      ).toBe(200);
      const history = await prisma.governanceDecision.findMany({
        where:
          kind === "risk"
            ? { riskAssessmentId: assessment.id }
            : { impactAssessmentId: assessment.id },
        orderBy: { createdAt: "asc" },
      });
      expect(history.map((x) => x.rationale)).toEqual([
        "Original rationale",
        "Resolved rationale",
      ]);
      expect(
        history.every(
          (x) => x.version === 1 && x.actorUserId === users.REVIEWER,
        ),
      ).toBe(true);
      expect((await request("GET", url)).json().decisionHistory).toHaveLength(
        2,
      );
    });
  it("retains the first use-case rationale through resubmission and an independent second review", async () => {
    const uc = await prisma.aiUseCase.create({
      data: {
        tenantId: tenant,
        aiSystemId: system,
        name: "Decision history",
        businessPurpose: "Regression validation",
        ownerUserId: users.ADMIN!,
        createdByUserId: users.ANALYST!,
        decisionRole: "RECOMMENDS",
        humanOversight: "REQUIRED",
        status: "PENDING_REVIEW",
      },
    });
    const url = `/ai-use-cases/${uc.id}`;
    expect(
      (
        await request("POST", `${url}/review`, "REVIEWER", {
          decision: "CHANGES_REQUESTED",
          rationale: "FIRST RATIONALE",
        })
      ).statusCode,
    ).toBe(200);
    expect((await request("POST", `${url}/submit`, "ANALYST")).statusCode).toBe(
      200,
    );
    expect(
      (
        await request("POST", `${url}/review`, "REVIEWER", {
          decision: "APPROVED",
          rationale: "SECOND RATIONALE",
        })
      ).statusCode,
    ).toBe(200);
    const history = await prisma.governanceDecision.findMany({
      where: { useCaseId: uc.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((x) => x.rationale)).toEqual([
      "FIRST RATIONALE",
      "SECOND RATIONALE",
    ]);
    for (const row of history) {
      expect(row.actorUserId).toBe(users.REVIEWER);
      expect(
        await prisma.auditEvent.findFirst({
          where: { correlationId: row.correlationId },
        }),
      ).not.toBeNull();
    }
    expect((await request("GET", url)).json().decisionHistory).toHaveLength(2);
    await expect(
      prisma.governanceDecision.update({
        where: { id: history[0]!.id },
        data: { rationale: "overwrite" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.governanceDecision.delete({ where: { id: history[0]!.id } }),
    ).rejects.toThrow();
  });
});
describe("M2 durable sessions, absolute expiration and replay denial", () => {
  it("revokes logout before success and rejects retained-cookie replay", async () => {
    const cookie = await issueTestSessionCookie(identity("ADMIN"));
    expect(
      (await request("GET", "/auth/me", "ADMIN", undefined, cookie)).statusCode,
    ).toBe(200);
    expect(
      (await request("POST", "/auth/logout", "ADMIN", undefined, cookie))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await prisma.storedSession.findUniqueOrThrow({
          where: { id: getSessionFromCookie(cookie)!.sessionId! },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      (await request("GET", "/auth/me", "ADMIN", undefined, cookie)).statusCode,
    ).toBe(401);
  });
  it("rejects old claim-only cookies and cookies beyond seven days", async () => {
    const base = identity("ADMIN");
    expect(
      (
        await request(
          "GET",
          "/auth/me",
          "ADMIN",
          undefined,
          createSessionCookie(base),
        )
      ).statusCode,
    ).toBe(401);
    const lifetime = await issueStoredSession(base.userId, base.tenantId);
    const retained = createSessionCookie({ ...base, ...lifetime });
    expect(
      (await request("GET", "/auth/me", "ADMIN", undefined, retained))
        .statusCode,
    ).toBe(200);
    await prisma.storedSession.update({
      where: { id: lifetime.sessionId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(
      (await request("GET", "/auth/me", "ADMIN", undefined, retained))
        .statusCode,
    ).toBe(401);
    expect(
      getSessionFromCookie(
        createSessionCookie({
          ...base,
          ...lifetime,
          expiresAt: lifetime.issuedAt + SESSION_MAX_AGE_MS + 1,
        }),
      ),
    ).toBeNull();
    expect(
      getSessionFromCookie(
        createSessionCookie({
          ...base,
          ...lifetime,
          issuedAt: Date.now() - 100,
          expiresAt: Date.now() - 1,
        }),
      ),
    ).toBeNull();
  });
  it("fails closed on authentication storage failure and never reports logout success when revocation fails", async () => {
    const cookie = await issueTestSessionCookie(identity("ADMIN"));
    const originalRead = prisma.storedSession.findUnique;
    const read = vi
      .spyOn(prisma.storedSession, "findUnique")
      .mockRejectedValue(new Error("unavailable"));
    try {
      expect(
        (await request("GET", "/auth/me", "ADMIN", undefined, cookie))
          .statusCode,
      ).toBe(401);
    } finally {
      read.mockRestore();
      prisma.storedSession.findUnique = originalRead;
    }
    const originalRevoke = prisma.storedSession.updateMany;
    const revoke = vi
      .spyOn(prisma.storedSession, "updateMany")
      .mockRejectedValue(new Error("unavailable"));
    try {
      expect(
        (await request("POST", "/auth/logout", "ADMIN", undefined, cookie))
          .statusCode,
      ).toBe(503);
    } finally {
      revoke.mockRestore();
      prisma.storedSession.updateMany = originalRevoke;
    }
    expect(
      (await request("GET", "/auth/me", "ADMIN", undefined, cookie)).statusCode,
    ).toBe(200);
  });
  it("membership removal permanently invalidates a cookie even after membership is re-added", async () => {
    const cookie = await issueTestSessionCookie(identity("AUDITOR"));
    await prisma.tenantMembership.delete({
      where: { tenantId_userId: { tenantId: tenant, userId: users.AUDITOR! } },
    });
    await prisma.tenantMembership.create({
      data: { tenantId: tenant, userId: users.AUDITOR!, role: "AUDITOR" },
    });
    expect(
      (await request("GET", "/auth/me", "AUDITOR", undefined, cookie))
        .statusCode,
    ).toBe(401);
    expect((await request("GET", "/auth/me", "AUDITOR")).statusCode).toBe(200);
  });
});
