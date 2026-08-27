import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "@vendorguard/database";
import { calculateInherentRisk, calculateAIInherentRisk, calculateAIImpactScore, calculateResidualRisk, QUESTIONNAIRE_QUESTIONS, mapQuestionnaireToRiskFactors, calculateFullRiskRating, calculateRequirementRisk, type QuestionnaireAnswers } from "@vendorguard/risk-engine";
import { resolveApplicableRequirements } from "@vendorguard/framework-engine";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { registerAuthRoutes, getSessionFromCookie, COOKIE_NAME } from "./auth-routes.js";
import { readdirSync, readFileSync } from "fs";
import { join, dirname, resolve, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, "..", "..", "..", "frameworks");

const server = Fastify({ logger: true });

server.register(cors, {
  origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  credentials: true,
});

server.register(cookie);

server.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

server.register(registerAuthRoutes);

server.get("/health", async () => {
  return { status: "ok", service: "vendorguard-api" };
});

server.get("/frameworks", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const frameworkDirs = readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const frameworks = frameworkDirs
    .map((dir) => {
      try {
        const raw = readFileSync(join(FRAMEWORKS_DIR, dir, "controls.json"), "utf-8");
        const data = JSON.parse(raw);
        return {
          frameworkId: data.frameworkId,
          frameworkName: data.frameworkName,
          version: data.version,
          controlCount: data.controls?.length ?? 0,
        };
      } catch {
        return null;
      }
    })
    .filter((f) => f !== null);

  return { frameworks };
});

server.get("/frameworks/:frameworkId/controls", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { frameworkId } = request.params as { frameworkId: string };
  if (!/^[a-zA-Z0-9.-]+$/.test(frameworkId)) {
    return reply.status(400).send({ error: "Invalid framework id" });
  }
  const resolvedFrameworksDir = resolve(FRAMEWORKS_DIR);
  const resolvedPath = resolve(join(resolvedFrameworksDir, frameworkId, "controls.json"));
  if (!resolvedPath.startsWith(resolvedFrameworksDir + sep)) {
    return reply.status(400).send({ error: "Invalid framework id" });
  }
  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    const data = JSON.parse(raw);
    return data;
  } catch {
    return reply.status(404).send({ error: "Framework not found" });
  }
});

server.post("/vendors/:id/assessments", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };
  const body = request.body as { frameworkIds?: string[] };
  const frameworkIds = body.frameworkIds ?? [];

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const assessment = await prisma.assessment.create({
    data: {
      tenantId: session.tenantId,
      vendorId,
      status: "DRAFT",
      scoringModelVersion: "risk-model-2025.1",
      startedByUserId: session.userId,
    },
  });

  for (const catalogId of frameworkIds) {
    const framework = await prisma.framework.findUnique({ where: { catalogId } });
    if (!framework) continue;
    const version = await prisma.frameworkVersion.findFirst({
      where: { frameworkId: framework.id, isCurrent: true },
    });
    if (!version) continue;
    await prisma.assessmentFramework.create({
      data: {
        tenantId: session.tenantId,
        assessmentId: assessment.id,
        frameworkId: framework.id,
        frameworkVersion: version.version,
        applicabilityReason: "manually-selected",
      },
    });
  }


  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "assessment.created",
      targetType: "Assessment",
      targetId: assessment.id,
      outcome: "SUCCESS",
    },
  });
  return reply.status(201).send(assessment);
});

server.post("/assessments/:id/findings", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: assessmentId } = request.params as { id: string };
  const body = request.body as { controlId?: string; status?: string };

  if (!body.controlId || !body.status) {
    return reply.status(400).send({ error: "controlId and status are required" });
  }

  const validStatuses = ["PASS", "PARTIAL", "FAIL", "INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE", "NOT_APPLICABLE"] as const;
  if (!validStatuses.includes(body.status as (typeof validStatuses)[number])) {
    return reply.status(400).send({ error: "Invalid status" });
  }

  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const control = await prisma.control.findFirst({ where: { id: body.controlId } });
  if (!control) {
    return reply.status(404).send({ error: "Control not found" });
  }

  const existing = await prisma.controlFinding.findFirst({
    where: { assessmentId, controlId: body.controlId },
  });

  const finding = existing
    ? await prisma.controlFinding.update({
        where: { id: existing.id },
        data: { status: body.status as (typeof validStatuses)[number], requiresHumanReview: false },
      })
    : await prisma.controlFinding.create({
        data: {
          tenantId: session.tenantId,
          vendorId: assessment.vendorId,
          assessmentId,
          controlId: body.controlId,
          status: body.status as (typeof validStatuses)[number],
          requiresHumanReview: false,
        },
      });

  return reply.status(200).send(finding);
});

server.get("/assessments", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  const assessments = await prisma.assessment.findMany({
    include: { vendor: true },
    orderBy: { createdAt: "desc" },
  });

  return {
    assessments: assessments.map((a: (typeof assessments)[number]) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      vendor: { id: a.vendor.id, legalName: a.vendor.legalName },
    })),
  };
});

server.get("/assessments/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };

  const assessment = await prisma.assessment.findUnique({
    where: { id },
    include: {
      vendor: true,
      frameworks: { include: { framework: true } },
      findings: true,
    },
  });
  if (!assessment) {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const frameworkVersions = await Promise.all(
    assessment.frameworks.map(async (af: (typeof assessment.frameworks)[number]) => {
      const version = await prisma.frameworkVersion.findFirst({
        where: { frameworkId: af.frameworkId, version: af.frameworkVersion },
        include: { controls: true },
      });
      return {
        frameworkId: af.framework.catalogId,
        frameworkName: af.framework.name,
        controls: version?.controls ?? [],
      };
    })
  );

  return {
    id: assessment.id,
    status: assessment.status,
    vendor: { id: assessment.vendor.id, legalName: assessment.vendor.legalName },
    frameworks: frameworkVersions,
    findings: assessment.findings,
  };
});

server.get("/assessments/:id/framework-mapping", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };

  const assessment = await prisma.assessment.findUnique({
    where: { id },
    include: {
      vendor: true,
      findings: {
        include: {
          evidence: { include: { document: true } },
          remediations: true,
        },
      },
    },
  });
  if (!assessment) {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const findingsByControlId = new Map(assessment.findings.map((f) => [f.controlId, f]));

  const allControls = await prisma.control.findMany({
    include: { frameworkVersion: { include: { framework: true } } },
  });

  const applicabilityControls = allControls.map((c) => ({
    id: c.id,
    controlId: c.controlId,
    title: c.title,
    frameworkCatalogId: c.frameworkVersion.framework.catalogId,
  }));

  const vendorProfile = {
    serviceCategory: assessment.vendor.serviceCategory ?? undefined,
    category: assessment.vendor.category ?? undefined,
    dataClassifications: assessment.vendor.dataClassifications ?? [],
    aiFunctionality: assessment.vendor.aiFunctionality,
    aiProductType: (assessment.vendor.aiProductType ?? "NONE") as "GENERATIVE_AI" | "PREDICTIVE_ML" | "NONE",
    servesGovernmentCustomers: assessment.vendor.servesGovernmentCustomers ?? false,
    processingLocations: assessment.vendor.processingLocations ?? [],
    processesSwiftMessaging: assessment.vendor.processesSwiftMessaging ?? false,
    affectsFinancialReporting: assessment.vendor.affectsFinancialReporting ?? false,
    processesMedicareMedicaidClaims: assessment.vendor.processesMedicareMedicaidClaims ?? false,
  };

  const applicableRequirements = resolveApplicableRequirements(vendorProfile, applicabilityControls);

  const riskContext = {
    businessCriticality: assessment.vendor.businessCriticality,
    dataSensitivity: assessment.vendor.dataSensitivity,
    decisionAutonomyLevel: assessment.decisionAutonomyLevel,
    geographicRegulatoryExposure: assessment.vendor.geographicRegulatoryExposure,
  };

  const rows = applicableRequirements.map((req) => {
    const finding = findingsByControlId.get(req.control.id);
    const status = finding?.status ?? "INSUFFICIENT_EVIDENCE";
    const risk = calculateRequirementRisk(status, riskContext);

    return {
      framework: req.framework.name,
      requirement: req.control.title,
      applicability: req.applicable,
      applicabilityReason: req.reason,
      evidence: finding?.evidence.map((e) => ({
        filename: e.document.displayFilename,
        page: e.page,
        section: e.section,
      })) ?? [],
      controlStatus: status,
      gaps: finding?.gaps ?? [],
      risk: { score: risk.score, band: risk.band },
      remediation: finding?.remediations.map((r) => ({
        title: r.title,
        status: r.status,
        dueDate: r.dueDate,
      })) ?? [],
    };
  });

  return { assessmentId: id, rows };
});

server.post("/assessments/:id/ai-risk-score", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const body = request.body as {
    modelRisk?: number;
    dataRisk?: number;
    securityRisk?: number;
    regulatoryRisk?: number;
    humanOversightRisk?: number;
    governanceRisk?: number;
    controlEffectiveness?: number;
  };

  const assessment = await prisma.assessment.findUnique({ where: { id } });
  if (!assessment) {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const inherentResult = calculateAIInherentRisk({
    modelRisk: body.modelRisk,
    dataRisk: body.dataRisk,
    securityRisk: body.securityRisk,
    regulatoryRisk: body.regulatoryRisk,
    humanOversightRisk: body.humanOversightRisk,
    governanceRisk: body.governanceRisk,
  });

  const controlEffectiveness = body.controlEffectiveness ?? 0;
  const residualResult = calculateResidualRisk(inherentResult.score, controlEffectiveness);

  const updated = await prisma.assessment.update({
    where: { id },
    data: {
      aiInherentScore: inherentResult.score,
      aiResidualScore: residualResult.score,
      aiRiskBand: residualResult.band,
      aiControlEffectiveness: controlEffectiveness,
      aiFactorInputsJson: inherentResult.factors as object,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "assessment.ai_risk_scored",
      targetType: "Assessment",
      targetId: updated.id,
      outcome: "SUCCESS",
    },
  });

  return {
    assessment: updated,
    inherent: inherentResult,
    residual: residualResult,
  };
});
server.post("/assessments/:id/ai-impact-score", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const body = request.body as {
    potentialHarmSeverity?: number;
    individualsAffectedScale?: number;
    decisionAutonomyLevel?: number;
    sensitiveDataInvolved?: number;
    regulatoryExposureLevel?: number;
    explainabilityLevel?: number;
  };

  const assessment = await prisma.assessment.findUnique({ where: { id } });
  if (!assessment) {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const impactResult = calculateAIImpactScore({
    potentialHarmSeverity: body.potentialHarmSeverity,
    individualsAffectedScale: body.individualsAffectedScale,
    decisionAutonomyLevel: body.decisionAutonomyLevel,
    sensitiveDataInvolved: body.sensitiveDataInvolved,
    regulatoryExposureLevel: body.regulatoryExposureLevel,
    explainabilityLevel: body.explainabilityLevel,
  });

  const updated = await prisma.assessment.update({
    where: { id },
    data: {
      impactScore: impactResult.score,
      impactBand: impactResult.band,
      impactFactorInputsJson: impactResult.factors as object,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "assessment.ai_impact_scored",
      targetType: "Assessment",
      targetId: updated.id,
      outcome: "SUCCESS",
    },
  });

  return {
    assessment: updated,
    impact: impactResult,
  };
});

server.post("/assessments/:id/questionnaire", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const assessment = await prisma.assessment.findUnique({ where: { id } });
  if (!assessment) {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const questionnaire = await prisma.questionnaire.create({
    data: {
      tenantId: session.tenantId,
      assessmentId: id,
      name: "AI Vendor Risk Questionnaire",
      version: "1.0",
      status: "DRAFT",
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "questionnaire.created",
      targetType: "Questionnaire",
      targetId: questionnaire.id,
      outcome: "SUCCESS",
    },
  });

  return { questionnaire, questions: QUESTIONNAIRE_QUESTIONS };
});

server.get("/questionnaires/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id },
    include: { responses: true },
  });
  if (!questionnaire) {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }
  return { questionnaire, questions: QUESTIONNAIRE_QUESTIONS };
});

server.patch("/questionnaires/:id/responses", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const body = request.body as { answers: Record<string, unknown> };

  const questionnaire = await prisma.questionnaire.findUnique({ where: { id } });
  if (!questionnaire) {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }

  for (const [questionKey, value] of Object.entries(body.answers ?? {})) {
    const existing = await prisma.questionnaireResponse.findFirst({
      where: { questionnaireId: id, questionKey },
    });
    if (existing) {
      await prisma.questionnaireResponse.update({
        where: { id: existing.id },
        data: { answerJson: { value } as object, answeredByUserId: session.userId },
      });
    } else {
      await prisma.questionnaireResponse.create({
        data: {
          tenantId: session.tenantId,
          questionnaireId: id,
          questionKey,
          answerJson: { value } as object,
          answeredByUserId: session.userId,
        },
      });
    }
  }

  const updated = await prisma.questionnaire.update({
    where: { id },
    data: { status: questionnaire.status === "DRAFT" ? "IN_PROGRESS" : questionnaire.status },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "questionnaire.responses_saved",
      targetType: "Questionnaire",
      targetId: id,
      outcome: "SUCCESS",
    },
  });

  return { questionnaire: updated };
});

server.post("/questionnaires/:id/submit", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };

  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id },
    include: { responses: true },
  });
  if (!questionnaire) {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }

  const answers: QuestionnaireAnswers = {};
  for (const r of questionnaire.responses) {
    answers[r.questionKey] = r.answerJson as { value: boolean | string | string[] };
  }
  const { aiRiskFactors, aiImpactFactors } = mapQuestionnaireToRiskFactors(answers);

  const inherentResult = calculateAIInherentRisk(aiRiskFactors);
  const residualResult = calculateResidualRisk(inherentResult.score, 0);
  const impactResult = calculateAIImpactScore(aiImpactFactors);

  await prisma.assessment.update({
    where: { id: questionnaire.assessmentId },
    data: {
      aiInherentScore: inherentResult.score,
      aiResidualScore: residualResult.score,
      aiRiskBand: residualResult.band,
      aiFactorInputsJson: inherentResult.factors as object,
      impactScore: impactResult.score,
      impactBand: impactResult.band,
      impactFactorInputsJson: impactResult.factors as object,
    },
  });

  const updated = await prisma.questionnaire.update({
    where: { id },
    data: { status: "SUBMITTED", submittedByUserId: session.userId },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "questionnaire.submitted",
      targetType: "Questionnaire",
      targetId: id,
      outcome: "SUCCESS",
    },
  });

  return { questionnaire: updated, inherent: inherentResult, residual: residualResult, impact: impactResult };
});

server.post("/questionnaires/:id/review", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const questionnaire = await prisma.questionnaire.findUnique({ where: { id } });
  if (!questionnaire) {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }

  const updated = await prisma.questionnaire.update({
    where: { id },
    data: { status: "REVIEWED", reviewedByUserId: session.userId },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "questionnaire.reviewed",
      targetType: "Questionnaire",
      targetId: id,
      outcome: "SUCCESS",
    },
  });

  return { questionnaire: updated };
});

server.post("/questionnaires/:id/approve", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const questionnaire = await prisma.questionnaire.findUnique({ where: { id } });
  if (!questionnaire) {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }

  const updated = await prisma.questionnaire.update({
    where: { id },
    data: { status: "APPROVED", approvedByUserId: session.userId },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "questionnaire.approved",
      targetType: "Questionnaire",
      targetId: id,
      outcome: "SUCCESS",
    },
  });

  return { questionnaire: updated };
});


server.post("/assessments/:id/risk-rating", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const body = request.body as {
    businessCriticality?: number;
    dataSensitivity?: number;
    aiAutonomy?: number;
    regulatoryExposure?: number;
    securityPosture?: number;
    modelRisk?: number;
    vendorMaturity?: number;
    controlEffectiveness?: number;
  };

  const assessment = await prisma.assessment.findUnique({ where: { id } });
  if (!assessment) {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const controlEffectiveness = body.controlEffectiveness ?? 0;
  const result = calculateFullRiskRating(
    {
      businessCriticality: body.businessCriticality,
      dataSensitivity: body.dataSensitivity,
      aiAutonomy: body.aiAutonomy,
      regulatoryExposure: body.regulatoryExposure,
      securityPosture: body.securityPosture,
      modelRisk: body.modelRisk,
      vendorMaturity: body.vendorMaturity,
    },
    controlEffectiveness,
  );

  const riskRating = await prisma.riskRating.create({
    data: {
      tenantId: session.tenantId,
      assessmentId: id,
      inherentScore: result.inherent.score,
      controlEffectiveness: result.controlEffectiveness,
      residualScore: result.residualScore,
      finalRating: result.finalRating,
      factorInputsJson: result.inherent.factors as object,
      weightsUsedJson: result.inherent.weights as object,
      createdByUserId: session.userId,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "risk_rating.calculated",
      targetType: "Assessment",
      targetId: id,
      outcome: "SUCCESS",
    },
  });

  return { riskRating, result };
});

server.post("/vendors/:id/evidence", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };
  const body = request.body as { displayFilename?: string; documentType?: string; expirationDate?: string };

  if (!body.displayFilename || !body.documentType) {
    return reply.status(400).send({ error: "displayFilename and documentType are required" });
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const evidence = await prisma.evidenceDocument.create({
    data: {
      tenantId: session.tenantId,
      vendorId,
      displayFilename: body.displayFilename,
      storageKey: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mimeType: "application/octet-stream",
      sizeBytes: 0,
      sha256Hash: "manual-entry",
      documentType: body.documentType,
      state: "UPLOADED",
      expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
      uploadedByUserId: session.userId,
    },
  });


  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "evidence.created",
      targetType: "EvidenceDocument",
      targetId: evidence.id,
      outcome: "SUCCESS",
    },
  });
  return reply.status(201).send(evidence);
});

server.get("/vendors/:id/evidence", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };

  const evidence = await prisma.evidenceDocument.findMany({
    where: { vendorId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return { evidence };
});

server.post("/vendors/:id/remediations", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };
  const body = request.body as { title?: string; description?: string; dueDate?: string; findingId?: string };

  if (!body.title || !body.description) {
    return reply.status(400).send({ error: "title and description are required" });
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const remediation = await prisma.remediationAction.create({
    data: {
      tenantId: session.tenantId,
      vendorId,
      findingId: body.findingId ?? null,
      title: body.title,
      description: body.description,
      status: "OPEN",
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    },
  });

  return reply.status(201).send(remediation);
});

server.get("/remediations", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  const remediations = await prisma.remediationAction.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
    include: { vendor: { select: { legalName: true } } },
  });

  return { remediations };
});

server.get("/vendors/:id/remediations", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };

  const remediations = await prisma.remediationAction.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
  });

  return { remediations };
});

server.patch("/remediations/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const body = request.body as { status?: string };

  const validStatuses = ["OPEN", "IN_PROGRESS", "OVERDUE", "CLOSED"] as const;
  if (!body.status || !validStatuses.includes(body.status as (typeof validStatuses)[number])) {
    return reply.status(400).send({ error: "Invalid status" });
  }

  const existing = await prisma.remediationAction.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Remediation not found" });
  }

  const updated = await prisma.remediationAction.update({
    where: { id },
    data: {
      status: body.status as (typeof validStatuses)[number],
      closedAt: body.status === "CLOSED" ? new Date() : null,
      closedByUserId: body.status === "CLOSED" ? session.userId : null,
    },
  });

  return updated;
});

server.get("/ai-inventory", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  const allVendors = await prisma.vendor.findMany({
    where: { deletedAt: null },
    select: { id: true, legalName: true, serviceCategory: true, aiFunctionality: true },
  });

  const aiVendors = allVendors.filter((v: (typeof allVendors)[number]) => v.aiFunctionality);

  return {
    totalVendors: allVendors.length,
    aiVendorCount: aiVendors.length,
    vendors: aiVendors,
  };
});

server.get("/vendors", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return { vendors };
});

server.get("/vendors/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  return vendor;
});

server.post("/vendors", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  const body = request.body as {
    legalName?: string;
    serviceDescription?: string;
    serviceCategory?: string;
    criticality?: string;
    dataSensitivity?: number;
    businessCriticality?: number;
    accessPrivilege?: number;
    operationalDependency?: number;
    fourthPartyConcentration?: number;
    geographicRegulatoryExposure?: number;
    aiFunctionality?: boolean;
  };

  if (!body.legalName) {
    return reply.status(400).send({ error: "legalName is required" });
  }

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    return reply.status(500).send({ error: "No tenant exists yet" });
  }

  const vendor = await prisma.vendor.create({
    data: {
      tenantId: tenant.id,
      legalName: body.legalName,
      serviceDescription: body.serviceDescription || "",
      serviceCategory: body.serviceCategory || "",
      criticality: body.criticality || "",
      dataSensitivity: body.dataSensitivity ?? null,
      businessCriticality: body.businessCriticality ?? null,
      accessPrivilege: body.accessPrivilege ?? null,
      operationalDependency: body.operationalDependency ?? null,
      fourthPartyConcentration: body.fourthPartyConcentration ?? null,
      geographicRegulatoryExposure: body.geographicRegulatoryExposure ?? null,
      aiFunctionality: body.aiFunctionality ?? false,
    },
  });


  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorUserId: session.userId,
      action: "vendor.created",
      targetType: "Vendor",
      targetId: vendor.id,
      outcome: "SUCCESS",
    },
  });
  return reply.status(201).send(vendor);
});

server.get("/vendors/:id/risk-score", async (request, reply) => {
  const { id } = request.params as { id: string };
  const vendor = await prisma.vendor.findUnique({ where: { id } });

  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const result = calculateInherentRisk({
    dataSensitivity: vendor.dataSensitivity ?? undefined,
    businessCriticality: vendor.businessCriticality ?? undefined,
    accessPrivilege: vendor.accessPrivilege ?? undefined,
    operationalDependency: vendor.operationalDependency ?? undefined,
    fourthPartyConcentration: vendor.fourthPartyConcentration ?? undefined,
    geographicRegulatoryExposure: vendor.geographicRegulatoryExposure ?? undefined,
  });

  return result;
});

server.patch("/vendors/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  const body = request.body as {
    legalName?: string;
    serviceDescription?: string;
    serviceCategory?: string;
    criticality?: string;
    dataSensitivity?: number;
    businessCriticality?: number;
    accessPrivilege?: number;
    operationalDependency?: number;
    fourthPartyConcentration?: number;
    geographicRegulatoryExposure?: number;
    aiProductType?: string;
    aiProviders?: string[];
    customerDataTrainingPolicy?: boolean;
    humanOversightDocumented?: boolean;
  };
  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      ...(body.legalName !== undefined && { legalName: body.legalName }),
      ...(body.serviceDescription !== undefined && { serviceDescription: body.serviceDescription }),
      ...(body.serviceCategory !== undefined && { serviceCategory: body.serviceCategory }),
      ...(body.criticality !== undefined && { criticality: body.criticality }),
      ...(body.dataSensitivity !== undefined && { dataSensitivity: body.dataSensitivity }),
      ...(body.businessCriticality !== undefined && { businessCriticality: body.businessCriticality }),
      ...(body.accessPrivilege !== undefined && { accessPrivilege: body.accessPrivilege }),
      ...(body.operationalDependency !== undefined && { operationalDependency: body.operationalDependency }),
      ...(body.fourthPartyConcentration !== undefined && { fourthPartyConcentration: body.fourthPartyConcentration }),
      ...(body.geographicRegulatoryExposure !== undefined && { geographicRegulatoryExposure: body.geographicRegulatoryExposure }),
      ...(body.aiProductType !== undefined && { aiProductType: body.aiProductType }),
      ...(body.aiProviders !== undefined && { aiProviders: body.aiProviders }),
      ...(body.customerDataTrainingPolicy !== undefined && { customerDataTrainingPolicy: body.customerDataTrainingPolicy }),
      ...(body.humanOversightDocumented !== undefined && { humanOversightDocumented: body.humanOversightDocumented }),
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "vendor.updated",
      targetType: "Vendor",
      targetId: vendor.id,
      outcome: "SUCCESS",
    },
  });
  return vendor;
});
server.delete("/vendors/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  await prisma.vendor.update({ where: { id }, data: { deletedAt: new Date() } });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "vendor.deleted",
      targetType: "Vendor",
      targetId: existing.id,
      outcome: "SUCCESS",
    },
  });
  return reply.status(204).send();
});
const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 4000;
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`VendorGuard API running on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

































