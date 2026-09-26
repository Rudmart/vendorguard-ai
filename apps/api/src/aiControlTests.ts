/**
 * Step 10 - Control Testing & Effectiveness.
 *
 * AI System -> Mapped Control -> Evidence -> Evidence Review (Step 9) -> Control Test -> Effectiveness.
 *
 * Evidence acceptance and control effectiveness are SEPARATE human decisions:
 * at least one ACCEPTED evidence item is required to COMPLETE a test, but accepted
 * evidence never implies an Effective control. Completed tests are locked; a retest
 * is a new record. Findings for AI-system controls are deferred to Step 11.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, cleanText, parseOptionalDate, audit, type Session } from "./aiControlEvidence.js";

export const TEST_METHODS = ["DOCUMENT_REVIEW", "INTERVIEW", "OBSERVATION", "SAMPLE_TESTING", "CONFIGURATION_REVIEW", "OTHER"] as const;
export type TestMethod = (typeof TEST_METHODS)[number];
export const EFFECTIVENESS_VALUES = ["NOT_ASSESSED", "INEFFECTIVE", "PARTIALLY_EFFECTIVE", "EFFECTIVE"] as const;
export type Effectiveness = (typeof EFFECTIVENESS_VALUES)[number];

const RANK: Record<Effectiveness, number> = { NOT_ASSESSED: 0, INEFFECTIVE: 1, PARTIALLY_EFFECTIVE: 2, EFFECTIVE: 3 };

/** Overall may not be better than the weaker of design and operating. Validation only - never auto-calculated. */
export function overallWithinLimit(design: Effectiveness, operating: Effectiveness, overall: Effectiveness): boolean {
  return RANK[overall] <= Math.min(RANK[design], RANK[operating]);
}

function isMethod(value: unknown): value is TestMethod {
  return typeof value === "string" && (TEST_METHODS as readonly string[]).includes(value);
}

function isEffectiveness(value: unknown): value is Effectiveness {
  return typeof value === "string" && (EFFECTIVENESS_VALUES as readonly string[]).includes(value);
}

function parseOptionalInt(value: unknown, min: number, max: number): number | null | "invalid" {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    return "invalid";
  }
  return n;
}

type TestFields = {
  method?: TestMethod;
  procedure?: string;
  testDate?: Date | null;
  nextTestDate?: Date | null;
  sampleSize?: number | null;
  exceptionsFound?: number | null;
  designEffectiveness?: Effectiveness;
  operatingEffectiveness?: Effectiveness;
  overallEffectiveness?: Effectiveness;
  conclusionRationale?: string | null;
};

function parseTestFields(body: Record<string, unknown>): { fields: TestFields } | { error: string } {
  const fields: TestFields = {};
  if ("method" in body) {
    const method = body.method;
    if (!isMethod(method)) {
      return { error: "method must be one of: " + TEST_METHODS.join(", ") };
    }
    fields.method = method;
  }
  if ("procedure" in body) {
    const procedure = cleanText(body.procedure, 4000);
    if (!procedure) {
      return { error: "procedure is required (max 4000 characters)" };
    }
    fields.procedure = procedure;
  }
  for (const key of ["testDate", "nextTestDate"] as const) {
    if (key in body) {
      const date = parseOptionalDate(body[key]);
      if (date === "invalid") {
        return { error: key + " must be a valid date" };
      }
      fields[key] = date;
    }
  }
  if ("sampleSize" in body) {
    const n = parseOptionalInt(body.sampleSize, 1, 100000);
    if (n === "invalid") {
      return { error: "sampleSize must be a whole number from 1 to 100000" };
    }
    fields.sampleSize = n;
  }
  if ("exceptionsFound" in body) {
    const n = parseOptionalInt(body.exceptionsFound, 0, 100000);
    if (n === "invalid") {
      return { error: "exceptionsFound must be a whole number of 0 or more" };
    }
    fields.exceptionsFound = n;
  }
  for (const key of ["designEffectiveness", "operatingEffectiveness", "overallEffectiveness"] as const) {
    if (key in body) {
      const value = body[key];
      if (!isEffectiveness(value)) {
        return { error: key + " must be one of: " + EFFECTIVENESS_VALUES.join(", ") };
      }
      fields[key] = value;
    }
  }
  if ("conclusionRationale" in body) {
    const raw = body.conclusionRationale;
    if (raw === null || raw === "") {
      fields.conclusionRationale = null;
    } else {
      const text = cleanText(raw, 4000);
      if (!text) {
        return { error: "conclusionRationale must be text of at most 4000 characters" };
      }
      fields.conclusionRationale = text;
    }
  }
  return { fields };
}

function exceptionsWithinSample(sample: number | null, exceptions: number | null): boolean {
  if (sample === null || exceptions === null) {
    return true;
  }
  return exceptions <= sample;
}

const USER_SELECT = { id: true, displayName: true, email: true } as const;
const TEST_INCLUDE = {
  tester: { select: USER_SELECT },
  evidence: {
    orderBy: { createdAt: "asc" },
    include: {
      evidenceLink: {
        select: {
          id: true,
          status: true,
          submittedByUserId: true,
          evidenceDocument: { select: { id: true, displayFilename: true, documentType: true, uploadedByUserId: true } },
        },
      },
    },
  },
} as const;

async function loadTest(id: string, tenantId: string) {
  return prisma.aiControlTest.findFirst({ where: { id, tenantId }, include: TEST_INCLUDE });
}

async function deny(session: Session, targetType: string, targetId: string, reason: string): Promise<void> {
  await audit(session, "ai_control_test.denied", targetType, targetId, { reason }, "DENIED");
}

const NOT_A_TESTER = "Only ADMIN, REVIEWER or AUDITOR users can perform control tests";
const LOCKED = "Completed control tests are locked. Start a new test to retest the control.";
const NOT_YOUR_TEST = "Only the tester who started this test can change or complete it";

export async function registerAiControlTestRoutes(app: FastifyInstance): Promise<void> {
  // 1. Start a control test (IN_PROGRESS). A new test after a completed one is a retest.
  app.post("/ai-system-controls/:controlRecordId/tests", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-control-test:perform")) {
      return reply.status(403).send({ error: NOT_A_TESTER });
    }
    const testerUserId = session.userId;
    if (!testerUserId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { controlRecordId } = request.params as { controlRecordId: string };
    const record = await prisma.aiSystemControl.findFirst({ where: { id: controlRecordId, tenantId: session.tenantId } });
    if (!record) {
      return reply.status(404).send({ error: "AI system control not found" });
    }
    if (record.applicability === "NOT_APPLICABLE") {
      return reply.status(400).send({ error: "A control marked Not Applicable cannot be tested" });
    }
    if (record.ownerUserId === testerUserId) {
      await deny(session, "AiSystemControl", record.id, "tester_is_control_owner");
      return reply.status(403).send({ error: "Separation of duties: the control owner cannot test their own control" });
    }
    const parsed = parseTestFields((request.body ?? {}) as Record<string, unknown>);
    if ("error" in parsed) {
      return reply.status(400).send({ error: parsed.error });
    }
    const f = parsed.fields;
    if (!f.method || !f.procedure) {
      return reply.status(400).send({ error: "method and procedure are required" });
    }
    if (!exceptionsWithinSample(f.sampleSize ?? null, f.exceptionsFound ?? null)) {
      return reply.status(400).send({ error: "exceptionsFound cannot be greater than sampleSize" });
    }
    const priorCompleted = await prisma.aiControlTest.count({
      where: { tenantId: session.tenantId, aiSystemControlId: record.id, status: "COMPLETED" },
    });
    const created = await prisma.aiControlTest.create({
      data: { ...f, method: f.method, procedure: f.procedure, tenantId: session.tenantId, aiSystemControlId: record.id, testerUserId },
    });
    await audit(session, "ai_control_test.created", "AiControlTest", created.id, {
      aiSystemControlId: record.id,
      method: f.method,
      isRetest: priorCompleted > 0,
    });
    if (priorCompleted > 0) {
      await audit(session, "ai_control_test.retest_recorded", "AiControlTest", created.id, { aiSystemControlId: record.id, priorCompletedTests: priorCompleted });
    }
    return reply.status(201).send(await loadTest(created.id, session.tenantId));
  });

  // 2. Test history for a mapped control (newest first) + latest completed result.
  app.get("/ai-system-controls/:controlRecordId/tests", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view control tests" });
    }
    const { controlRecordId } = request.params as { controlRecordId: string };
    const record = await prisma.aiSystemControl.findFirst({ where: { id: controlRecordId, tenantId: session.tenantId } });
    if (!record) {
      return reply.status(404).send({ error: "AI system control not found" });
    }
    const tests = await prisma.aiControlTest.findMany({
      where: { tenantId: session.tenantId, aiSystemControlId: record.id },
      orderBy: { createdAt: "desc" },
      include: TEST_INCLUDE,
    });
    return reply.send({
      aiSystemControlId: record.id,
      latestCompleted: tests.find((test) => test.status === "COMPLETED") ?? null,
      tests,
    });
  });

  // 3. One test.
  app.get("/ai-control-tests/:testId", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view control tests" });
    }
    const { testId } = request.params as { testId: string };
    const test = await loadTest(testId, session.tenantId);
    if (!test) {
      return reply.status(404).send({ error: "Control test not found" });
    }
    return reply.send(test);
  });

  // 4. Update an IN_PROGRESS test (tester only).
  app.patch("/ai-control-tests/:testId", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-control-test:perform")) {
      return reply.status(403).send({ error: NOT_A_TESTER });
    }
    const { testId } = request.params as { testId: string };
    const test = await loadTest(testId, session.tenantId);
    if (!test) {
      return reply.status(404).send({ error: "Control test not found" });
    }
    if (test.status !== "IN_PROGRESS") {
      return reply.status(409).send({ error: LOCKED });
    }
    if (!session.userId || test.testerUserId !== session.userId) {
      return reply.status(403).send({ error: NOT_YOUR_TEST });
    }
    const parsed = parseTestFields((request.body ?? {}) as Record<string, unknown>);
    if ("error" in parsed) {
      return reply.status(400).send({ error: parsed.error });
    }
    const f = parsed.fields;
    const sample = f.sampleSize !== undefined ? f.sampleSize : test.sampleSize;
    const exceptions = f.exceptionsFound !== undefined ? f.exceptionsFound : test.exceptionsFound;
    if (!exceptionsWithinSample(sample, exceptions)) {
      return reply.status(400).send({ error: "exceptionsFound cannot be greater than sampleSize" });
    }
    const updated = await prisma.aiControlTest.updateMany({
      where: { id: test.id, tenantId: session.tenantId, status: "IN_PROGRESS" },
      data: f,
    });
    if (updated.count === 0) {
      return reply.status(409).send({ error: LOCKED });
    }
    await audit(session, "ai_control_test.updated", "AiControlTest", test.id, { fields: Object.keys(f).join(",") });
    return reply.send(await loadTest(test.id, session.tenantId));
  });

  // 5. Associate a Step 9 evidence link with an IN_PROGRESS test (tester only, separation of duties).
  app.post("/ai-control-tests/:testId/evidence", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-control-test:perform")) {
      return reply.status(403).send({ error: NOT_A_TESTER });
    }
    const { testId } = request.params as { testId: string };
    const test = await loadTest(testId, session.tenantId);
    if (!test) {
      return reply.status(404).send({ error: "Control test not found" });
    }
    if (test.status !== "IN_PROGRESS") {
      return reply.status(409).send({ error: LOCKED });
    }
    const testerUserId = session.userId;
    if (!testerUserId || test.testerUserId !== testerUserId) {
      return reply.status(403).send({ error: NOT_YOUR_TEST });
    }
    const body = (request.body ?? {}) as { evidenceLinkId?: unknown };
    if (typeof body.evidenceLinkId !== "string" || body.evidenceLinkId.length === 0) {
      return reply.status(400).send({ error: "evidenceLinkId is required" });
    }
    const link = await prisma.aiSystemControlEvidence.findFirst({
      where: { id: body.evidenceLinkId, tenantId: session.tenantId },
      include: { evidenceDocument: { select: { uploadedByUserId: true } } },
    });
    if (!link) {
      return reply.status(404).send({ error: "Evidence not found" });
    }
    if (link.aiSystemControlId !== test.aiSystemControlId) {
      return reply.status(400).send({ error: "Evidence must be linked to the same mapped control as the test" });
    }
    if (link.submittedByUserId === testerUserId || link.evidenceDocument.uploadedByUserId === testerUserId) {
      await deny(session, "AiControlTest", test.id, "tester_submitted_or_uploaded_evidence");
      return reply.status(403).send({ error: "Separation of duties: you cannot test using evidence you submitted or uploaded" });
    }
    try {
      await prisma.aiControlTestEvidence.create({
        data: { tenantId: session.tenantId, testId: test.id, evidenceLinkId: link.id, addedByUserId: testerUserId },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return reply.status(409).send({ error: "This evidence is already part of the test" });
      }
      throw err;
    }
    await audit(session, "ai_control_test.evidence_associated", "AiControlTest", test.id, { evidenceLinkId: link.id, evidenceStatus: link.status });
    return reply.status(201).send(await loadTest(test.id, session.tenantId));
  });

  // 6. Complete a test: human conclusions + accepted evidence required, then locked.
  app.post("/ai-control-tests/:testId/complete", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-control-test:perform")) {
      return reply.status(403).send({ error: NOT_A_TESTER });
    }
    const { testId } = request.params as { testId: string };
    const test = await loadTest(testId, session.tenantId);
    if (!test) {
      return reply.status(404).send({ error: "Control test not found" });
    }
    if (test.status !== "IN_PROGRESS") {
      return reply.status(409).send({ error: LOCKED });
    }
    const testerUserId = session.userId;
    if (!testerUserId || test.testerUserId !== testerUserId) {
      return reply.status(403).send({ error: NOT_YOUR_TEST });
    }

    // Separation of duties is re-checked at completion (ownership or submitters may have changed).
    const record = await prisma.aiSystemControl.findFirst({ where: { id: test.aiSystemControlId, tenantId: session.tenantId } });
    if (!record || record.ownerUserId === testerUserId) {
      await deny(session, "AiControlTest", test.id, "tester_is_control_owner");
      return reply.status(403).send({ error: "Separation of duties: the control owner cannot test their own control" });
    }
    const conflict = test.evidence.some(
      (item) => item.evidenceLink.submittedByUserId === testerUserId || item.evidenceLink.evidenceDocument.uploadedByUserId === testerUserId,
    );
    if (conflict) {
      await deny(session, "AiControlTest", test.id, "tester_submitted_or_uploaded_evidence");
      return reply.status(403).send({ error: "Separation of duties: you cannot test using evidence you submitted or uploaded" });
    }

    const missing: string[] = [];
    if (!test.testDate) {
      missing.push("test date");
    }
    if (test.designEffectiveness === "NOT_ASSESSED") {
      missing.push("design effectiveness");
    }
    if (test.operatingEffectiveness === "NOT_ASSESSED") {
      missing.push("operating effectiveness");
    }
    if (test.overallEffectiveness === "NOT_ASSESSED") {
      missing.push("overall effectiveness");
    }
    if (!test.conclusionRationale) {
      missing.push("conclusion rationale");
    }
    if (missing.length > 0) {
      return reply.status(400).send({ error: "Before completing, record: " + missing.join(", ") });
    }
    if (!overallWithinLimit(test.designEffectiveness, test.operatingEffectiveness, test.overallEffectiveness)) {
      return reply.status(400).send({ error: "Overall effectiveness cannot be better than the weaker of design and operating effectiveness" });
    }
    if (!exceptionsWithinSample(test.sampleSize, test.exceptionsFound)) {
      return reply.status(400).send({ error: "exceptionsFound cannot be greater than sampleSize" });
    }
    const acceptedCount = test.evidence.filter((item) => item.evidenceLink.status === "ACCEPTED").length;
    if (acceptedCount === 0) {
      return reply.status(400).send({
        error: "At least one evidence item in this test must be ACCEPTED through evidence review before the test can be completed",
      });
    }

    const updated = await prisma.aiControlTest.updateMany({
      where: { id: test.id, tenantId: session.tenantId, status: "IN_PROGRESS" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (updated.count === 0) {
      return reply.status(409).send({ error: LOCKED });
    }
    await audit(session, "ai_control_test.completed", "AiControlTest", test.id, {
      aiSystemControlId: test.aiSystemControlId,
      acceptedEvidenceCount: acceptedCount,
    });
    await audit(session, "ai_control_test.effectiveness_determined", "AiControlTest", test.id, {
      design: test.designEffectiveness,
      operating: test.operatingEffectiveness,
      overall: test.overallEffectiveness,
    });
    return reply.send(await loadTest(test.id, session.tenantId));
  });
}