import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "@vendorguard/database";
import { calculateInherentRisk, calculateAIInherentRisk, calculateAIImpactScore, calculateResidualRisk, QUESTIONNAIRE_QUESTIONS, mapQuestionnaireToRiskFactors, calculateFullRiskRating, calculateRequirementRisk, type QuestionnaireAnswers } from "@vendorguard/risk-engine";
import { resolveApplicableRequirements } from "@vendorguard/framework-engine";
import { runEvidenceAnalysis } from "./evidenceAnalysis.js";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { getStorageClient } from "@vendorguard/storage-client";
import { extractAndSaveEvidenceChunks } from "./evidenceExtraction.js";
import { buildExecutiveReport } from "./executiveReport.js";
import { renderExecutiveReportPdf } from "./executiveReportPdf.js";
import { askAssistant } from "@vendorguard/ai-client";
import { buildAssistantContext } from "./assistantContext.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { getSessionFromCookie, COOKIE_NAME, requireFindingReviewAuthority, requireRiskAcceptanceAuthority, AuthorizationError, requestContextSchema, assertOwnedByTenant, requirePermission } from "@vendorguard/auth";
import type { Role } from "@vendorguard/shared";
import { DATA_CATEGORIES, AFFECTED_POPULATIONS, REGULATORY_RELEVANCE_TAGS } from "@vendorguard/shared";
import { readdirSync, readFileSync } from "fs";
import { join, dirname, resolve, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, "..", "..", "..", "frameworks");

export const server = Fastify({ logger: true });

server.register(cors, {
  origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  credentials: true,
});

server.register(cookie);
server.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

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
  try {
    assertOwnedByTenant(vendor, session, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "assessment:create");
  } catch {
    return reply.status(403).send({ error: "Not authorized to create assessments" });
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
  try {
    assertOwnedByTenant(assessment, session, "Assessment");
  } catch {
    return reply.status(404).send({ error: "Assessment not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "finding:propose");
  } catch {
    return reply.status(403).send({ error: "Not authorized to propose findings" });
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
server.post("/assessments/:id/evidence/:evidenceDocumentId/analyze", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: assessmentId, evidenceDocumentId } = request.params as {
    id: string;
    evidenceDocumentId: string;
  };
  try {
    const result = await runEvidenceAnalysis({
      tenantId: session.tenantId,
      assessmentId,
      evidenceDocumentId,
    });
    return reply.status(200).send(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return reply.status(400).send({ error: message });
  }
});
server.get("/reviews/findings", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  try {
    const context = requestContextSchema.parse({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      correlationId: randomUUID(),
    });
    requireFindingReviewAuthority(context);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return reply.status(403).send({ error: err.message });
    }
    return reply.status(400).send({ error: "Invalid session context" });
  }

  const findings = await prisma.controlFinding.findMany({
    where: { tenantId: session.tenantId, requiresHumanReview: true },
    select: {
      id: true,
      status: true,
      confidence: true,
      gaps: true,
      recommendations: true,
      createdAt: true,
      vendor: { select: { id: true, legalName: true } },
      assessment: { select: { id: true } },
      control: { select: { id: true, controlId: true, title: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return reply.status(200).send({ findings });
});

server.post("/assessments/:id/findings/:findingId/review", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  // RBAC: viewing a finding must never imply authority to review it.
  try {
    const context = requestContextSchema.parse({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      correlationId: randomUUID(),
    });
    requireFindingReviewAuthority(context);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return reply.status(403).send({ error: err.message });
    }
    return reply.status(400).send({ error: "Invalid session context" });
  }
  const { id: assessmentId, findingId } = request.params as { id: string; findingId: string };
  const body = request.body as {
    decision?: string;
    rationale?: string;
    finalStatus?: string;
  };
  const validDecisions = ["ACCEPT", "REJECT", "OVERRIDE", "REQUEST_MORE_EVIDENCE", "NOT_APPLICABLE"] as const;
  if (!body.decision || !validDecisions.includes(body.decision as (typeof validDecisions)[number])) {
    return reply.status(400).send({ error: "decision must be one of: " + validDecisions.join(", ") });
  }
  if (!body.rationale) {
    return reply.status(400).send({ error: "rationale is required" });
  }
  const validStatuses = ["PASS", "PARTIAL", "FAIL", "INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE", "NOT_APPLICABLE"] as const;
  if (body.finalStatus && !validStatuses.includes(body.finalStatus as (typeof validStatuses)[number])) {
    return reply.status(400).send({ error: "Invalid finalStatus" });
  }
  const finding = await prisma.controlFinding.findFirst({
    where: { id: findingId, assessmentId, tenantId: session.tenantId },
  });
  if (!finding) {
    return reply.status(404).send({ error: "Finding not found" });
  }
  const changedValuesJson =
    body.finalStatus && body.finalStatus !== finding.status
      ? { status: { from: finding.status, to: body.finalStatus } }
      : undefined;
  const reviewDecision = await prisma.reviewDecision.create({
    data: {
      tenantId: session.tenantId,
      findingId: finding.id,
      reviewerUserId: session.userId,
      decision: body.decision as (typeof validDecisions)[number],
      rationale: body.rationale,
      changedValuesJson,
    },
  });
  const updatedFinding = await prisma.controlFinding.update({
    where: { id: finding.id },
    data: {
      requiresHumanReview: false,
      status: (body.finalStatus as (typeof validStatuses)[number] | undefined) ?? finding.status,
    },
  });
  return reply.status(200).send({ reviewDecision, finding: updatedFinding });
});
server.post("/vendors/:id/risk-acceptance", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  // Accepting business risk is a higher bar than accepting a finding -
  // only ADMIN and REVIEWER roles, enforced server-side.
  try {
    const context = requestContextSchema.parse({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      correlationId: randomUUID(),
    });
    requireRiskAcceptanceAuthority(context);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return reply.status(403).send({ error: err.message });
    }
    return reply.status(400).send({ error: "Invalid session context" });
  }

  const { id: vendorId } = request.params as { id: string };
  const body = request.body as {
    justification?: string;
    assessmentId?: string;
    expiresAt?: string;
  };
  if (!body.justification || !body.justification.trim()) {
    return reply.status(400).send({ error: "justification is required" });
  }

  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, tenantId: session.tenantId },
  });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const riskAcceptance = await prisma.riskAcceptance.create({
    data: {
      tenantId: session.tenantId,
      vendorId: vendor.id,
      assessmentId: body.assessmentId,
      approvedByUserId: session.userId,
      justification: body.justification,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    },
  });

  return reply.status(200).send({ riskAcceptance });
});

server.get("/vendors/:id/risk-acceptance", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };
  const riskAcceptances = await prisma.riskAcceptance.findMany({
    where: { vendorId, tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
  });
  return reply.status(200).send({ riskAcceptances });
});

server.get("/evidence/:evidenceDocumentId", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { evidenceDocumentId } = request.params as { evidenceDocumentId: string };
  const document = await prisma.evidenceDocument.findFirst({
    where: { id: evidenceDocumentId, tenantId: session.tenantId },
  });
  if (!document) {
    return reply.status(404).send({ error: "Evidence document not found" });
  }
  return reply.status(200).send(document);
});

server.get("/vendors/:id/executive-report", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };

  const report = await buildExecutiveReport(session.tenantId, vendorId);
  if (!report) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "report.generated",
      targetType: "Vendor",
      targetId: vendorId,
      outcome: "SUCCESS",
    },
  });

  return reply.status(200).send(report);
});
server.get("/evidence/:evidenceDocumentId/download", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { evidenceDocumentId } = request.params as { evidenceDocumentId: string };
  const document = await prisma.evidenceDocument.findFirst({
    where: { id: evidenceDocumentId, tenantId: session.tenantId },
  });
  if (!document) {
    return reply.status(404).send({ error: "Evidence document not found" });
  }

  const containerName = process.env.AZURE_STORAGE_CONTAINER_EVIDENCE ?? "evidence";
  const storageClient = getStorageClient();
  const buffer = await storageClient.downloadFile(containerName, document.storageKey);

  reply.header("Content-Type", document.mimeType);
  reply.header("Content-Disposition", "inline; filename=\"" + document.displayFilename + "\"");
  return reply.send(buffer);
});
server.get("/assessments", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  const assessments = await prisma.assessment.findMany({
    where: { tenantId: session.tenantId },
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

server.get("/vendors/:id/executive-report/export", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };

  const report = await buildExecutiveReport(session.tenantId, vendorId);
  if (!report) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const pdfBuffer = await renderExecutiveReportPdf(report);

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "report.exported",
      targetType: "Vendor",
      targetId: vendorId,
      outcome: "SUCCESS",
    },
  });

  reply.header("Content-Type", "application/pdf");
  reply.header("Content-Disposition", "attachment; filename=\"executive-report-" + vendorId + ".pdf\"");
  return reply.send(pdfBuffer);
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
  try {
    assertOwnedByTenant(assessment, session, "Assessment");
  } catch {
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

server.post("/vendors/:id/assistant/messages", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };
  const body = request.body as { conversationId?: string; question?: string };
  const question = body.question;
  if (!question || question.trim().length === 0) {
    return reply.status(400).send({ error: "question is required" });
  }

  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, tenantId: session.tenantId },
  });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const MODEL_VERSION = "claude-sonnet-4-5-20250929";
  const PROMPT_TEMPLATE_VERSION = "assistant-v1";

  let conversation;
  if (body.conversationId) {
    conversation = await prisma.assistantConversation.findFirst({
      where: { id: body.conversationId, tenantId: session.tenantId, vendorId },
    });
    if (!conversation) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
  } else {
    conversation = await prisma.assistantConversation.create({
      data: {
        tenantId: session.tenantId,
        vendorId,
        userId: session.userId,
        modelVersion: MODEL_VERSION,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
      },
    });
  }

  const priorMessages = await prisma.assistantMessage.findMany({
    where: { tenantId: session.tenantId, conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });

  const context = await buildAssistantContext(session.tenantId, vendorId);

  const result = await askAssistant({
    question,
    priorMessages: priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    context,
  });

  await prisma.assistantMessage.create({
    data: {
      tenantId: session.tenantId,
      conversationId: conversation.id,
      role: "user",
      content: question,
      promptInjectionFlagged: false,
    },
  });

  const assistantMessage = await prisma.assistantMessage.create({
    data: {
      tenantId: session.tenantId,
      conversationId: conversation.id,
      role: "assistant",
      content: result.content,
      citationsJson: result.citations,
      promptInjectionFlagged: result.promptInjectionFlagged,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "assistant.message_sent",
      targetType: "Vendor",
      targetId: vendorId,
      outcome: "SUCCESS",
    },
  });

  return reply.status(200).send({
    conversationId: conversation.id,
    message: {
      id: assistantMessage.id,
      content: result.content,
      insufficientEvidence: result.insufficientEvidence,
      citations: result.citations,
      promptInjectionFlagged: result.promptInjectionFlagged,
    },
  });
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
  try {
    assertOwnedByTenant(assessment, session, "Assessment");
  } catch {
    return reply.status(404).send({ error: "Assessment not found" });
  }

  const findingsByControlId = new Map<string, (typeof assessment.findings)[number]>(assessment.findings.map((f: (typeof assessment.findings)[number]) => [f.controlId, f]));

  const allControls = await prisma.control.findMany({
    include: { frameworkVersion: { include: { framework: true } } },
  });

  const applicabilityControls = allControls.map((c: (typeof allControls)[number]) => ({
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
    aiProductType: (assessment.vendor.aiProductType ?? "NONE") as "GENERATIVE" | "PREDICTIVE" | "ML" | "AGENT" | "NONE",
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
      evidence: finding?.evidence.map((e: NonNullable<typeof finding>["evidence"][number]) => ({
        filename: e.document.displayFilename,
        page: e.page,
        section: e.section,
      })) ?? [],
      controlStatus: status,
      gaps: finding?.gaps ?? [],
      risk: { score: risk.score, band: risk.band },
      remediation: finding?.remediations.map((r: NonNullable<typeof finding>["remediations"][number]) => ({
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
  try {
    assertOwnedByTenant(assessment, session, "Assessment");
  } catch {
    return reply.status(404).send({ error: "Assessment not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "assessment:create");
  } catch {
    return reply.status(403).send({ error: "Not authorized to create questionnaires" });
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
  try {
    assertOwnedByTenant(questionnaire, session, "Questionnaire");
  } catch {
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
  try {
    assertOwnedByTenant(questionnaire, session, "Questionnaire");
  } catch {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "assessment:create");
  } catch {
    return reply.status(403).send({ error: "Not authorized to answer questionnaires" });
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
  try {
    assertOwnedByTenant(questionnaire, session, "Questionnaire");
  } catch {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "assessment:create");
  } catch {
    return reply.status(403).send({ error: "Not authorized to submit questionnaires" });
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
  try {
    assertOwnedByTenant(questionnaire, session, "Questionnaire");
  } catch {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "questionnaire:review");
  } catch {
    return reply.status(403).send({ error: "Not authorized to review questionnaires" });
  }
  if (questionnaire.submittedByUserId === session.userId) {
    return reply.status(403).send({ error: "Cannot review your own submission" });
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
  try {
    assertOwnedByTenant(questionnaire, session, "Questionnaire");
  } catch {
    return reply.status(404).send({ error: "Questionnaire not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "questionnaire:review");
  } catch {
    return reply.status(403).send({ error: "Not authorized to approve questionnaires" });
  }
  if (questionnaire.submittedByUserId === session.userId) {
    return reply.status(403).send({ error: "Cannot approve your own submission" });
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
  try {
    assertOwnedByTenant(vendor, session, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "evidence:upload");
  } catch {
    return reply.status(403).send({ error: "Not authorized to upload evidence" });
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

server.post("/vendors/:id/evidence/upload", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    assertOwnedByTenant(vendor, session, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "evidence:upload");
  } catch {
    return reply.status(403).send({ error: "Not authorized to upload evidence" });
  }

  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: "No file uploaded" });
  }

  const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);
  if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
    return reply.status(400).send({ error: "Unsupported file type. Allowed: PDF, DOCX, XLSX." });
  }

  const documentTypeField = data.fields.documentType as { value?: string } | undefined;
  const expirationDateField = data.fields.expirationDate as { value?: string } | undefined;
  const documentType = documentTypeField?.value;
  const expirationDateRaw = expirationDateField?.value;
  if (!documentType) {
    return reply.status(400).send({ error: "documentType is required" });
  }

  const buffer = await data.toBuffer();
  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    return reply.status(400).send({ error: "File exceeds 25 MB limit" });
  }

  const storageKey = "evidence/" + vendorId + "/" + Date.now() + "-" + data.filename;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_EVIDENCE ?? "evidence";
  const storageClient = getStorageClient();
  const uploadResult = await storageClient.uploadFile(containerName, storageKey, buffer, data.mimetype);

  const evidence = await prisma.evidenceDocument.create({
    data: {
      tenantId: session.tenantId,
      vendorId,
      displayFilename: data.filename,
      storageKey: uploadResult.storageKey,
      mimeType: uploadResult.mimeType,
      sizeBytes: uploadResult.sizeBytes,
      sha256Hash: uploadResult.sha256Hash,
      documentType,
      state: "UPLOADED",
      expirationDate: expirationDateRaw ? new Date(expirationDateRaw) : null,
      uploadedByUserId: session.userId,
    },
  });

  let chunksExtracted = 0;
  try {
    const extractionResult = await extractAndSaveEvidenceChunks({
      tenantId: session.tenantId,
      documentId: evidence.id,
      buffer,
      mimeType: uploadResult.mimeType,
    });
    chunksExtracted = extractionResult.chunksCreated;
  } catch (extractionError) {
    server.log.error(extractionError, "Evidence text extraction failed");
  }

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "evidence.uploaded",
      targetType: "EvidenceDocument",
      targetId: evidence.id,
      outcome: "SUCCESS",
    },
  });

  return reply.status(201).send({ ...evidence, chunksExtracted });
});
server.get("/vendors/:id/evidence", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id: vendorId } = request.params as { id: string };

  const evidence = await prisma.evidenceDocument.findMany({
    where: { vendorId, deletedAt: null, tenantId: session.tenantId },
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
  try {
    assertOwnedByTenant(vendor, session, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "remediation:create");
  } catch {
    return reply.status(403).send({ error: "Not authorized to create remediations" });
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
    where: { vendorId, tenantId: session.tenantId },
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
  try {
    assertOwnedByTenant(existing, session, "Remediation");
  } catch {
    return reply.status(404).send({ error: "Remediation not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "remediation:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to update remediations" });
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
    where: { deletedAt: null, tenantId: session.tenantId },
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
    where: { deletedAt: null, tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
  });
  return { vendors };
});

server.get("/vendors/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    assertOwnedByTenant(vendor, session, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  return vendor;
});

server.post("/vendors", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "vendor:create");
  } catch {
    return reply.status(403).send({ error: "Not authorized to create vendors" });
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
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const vendor = await prisma.vendor.findUnique({ where: { id } });

  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    assertOwnedByTenant(vendor, session, "Vendor");
  } catch {
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
  try {
    assertOwnedByTenant(existing, session, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "vendor:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to update vendors" });
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
  try {
    assertOwnedByTenant(existing, session, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "vendor:delete");
  } catch {
    return reply.status(403).send({ error: "Not authorized to delete vendors" });
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
// ---------------------------------------------------------------------------
// AI Systems (Slice 1) - a first-class platform object distinct from Vendor.
// See docs/VENDORGUARD_MIGRATION_PLAN.md for the approved design. Vendor
// represents an external organization; AiSystem represents an AI system or
// use of AI being governed. An AiSystem may be INTERNAL (organization owns
// and operates it, though it may still depend on third-party providers) or
// THIRD_PARTY (the AI capability itself is primarily externally provided).
// ---------------------------------------------------------------------------

const AI_SYSTEM_CATEGORIES = ["GENERATIVE", "PREDICTIVE_ML", "DECISION_SUPPORT", "EMBEDDED", "AGENT", "OTHER"];
const AI_SYSTEM_LIFECYCLE_STATUSES = ["PROPOSED", "DEVELOPMENT", "TESTING", "ASSESSMENT", "PENDING_APPROVAL", "APPROVED", "PRODUCTION", "SUSPENDED", "RETIRED"];
const AI_SYSTEM_VENDOR_ROLES = ["PRIMARY_PROVIDER", "MODEL_PROVIDER", "PLATFORM_PROVIDER", "AI_SERVICE_PROVIDER", "DATA_PROVIDER", "DEVELOPMENT_PROVIDER", "OTHER"];
const RISK_TIERS = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

// Step 5 - AI System Governance Profile classification value sets
const BUSINESS_CRITICALITY_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const DECISION_ROLE_VALUES = ["ADVISORY", "RECOMMENDS", "DECIDES", "EXECUTES"];
const HUMAN_OVERSIGHT_VALUES = ["REQUIRED", "OPTIONAL", "NOT_APPLICABLE"];
const IMPACT_LEVEL_VALUES = ["LOW", "MODERATE", "HIGH"];
const DATA_SENSITIVITY_VALUES = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
const ASSESSMENT_STATUS_VALUES = ["NOT_ASSESSED", "ASSESSMENT_REQUIRED", "ASSESSED"];

server.post("/ai-systems", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:create");
  } catch {
    return reply.status(403).send({ error: "Not authorized to create AI systems" });
  }

  const body = request.body as {
    name?: string;
    description?: string;
    origin?: string;
    category?: string;
    ownerUserId?: string;
    dataCategories?: string[];
    riskTier?: string;
  };

  if (!body.name) {
    return reply.status(400).send({ error: "name is required" });
  }
  if (body.origin !== "INTERNAL" && body.origin !== "THIRD_PARTY") {
    return reply.status(400).send({ error: "origin must be INTERNAL or THIRD_PARTY" });
  }
  const category = body.category ?? "OTHER";
  if (!AI_SYSTEM_CATEGORIES.includes(category)) {
    return reply.status(400).send({ error: "Invalid category" });
  }
  const dataCategories = body.dataCategories ?? [];
  const invalidDataCategories = dataCategories.filter((c) => !(DATA_CATEGORIES as readonly string[]).includes(c));
  if (invalidDataCategories.length > 0) {
    return reply.status(400).send({ error: `Invalid dataCategories: ${invalidDataCategories.join(", ")}` });
  }
  if (body.riskTier && !RISK_TIERS.includes(body.riskTier)) {
    return reply.status(400).send({ error: "Invalid riskTier" });
  }

  let ownerUserId: string | null = null;
  if (body.ownerUserId) {
    const membership = await prisma.tenantMembership.findFirst({
      where: { userId: body.ownerUserId, tenantId: session.tenantId },
    });
    if (!membership) {
      return reply.status(400).send({ error: "ownerUserId must belong to a user in this tenant" });
    }
    ownerUserId = body.ownerUserId;
  }

  const aiSystem = await prisma.aiSystem.create({
    data: {
      tenantId: session.tenantId,
      name: body.name,
      description: body.description ?? null,
      origin: body.origin as "INTERNAL" | "THIRD_PARTY",
      category: category as never,
      ownerUserId,
      dataCategories,
      riskTier: (body.riskTier as never) ?? null,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_system.created",
      targetType: "AiSystem",
      targetId: aiSystem.id,
      outcome: "SUCCESS",
    },
  });

  return reply.status(201).send(aiSystem);
});

server.get("/ai-systems", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:read");
  } catch {
    return reply.status(403).send({ error: "Not authorized to view AI systems" });
  }

  const aiSystems = await prisma.aiSystem.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
  });
  return reply.send({ aiSystems });
});

server.get("/ai-systems/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:read");
  } catch {
    return reply.status(403).send({ error: "Not authorized to view AI systems" });
  }

  const { id } = request.params as { id: string };
  const aiSystem = await prisma.aiSystem.findUnique({
    where: { id },
    include: { owner: { select: { id: true, displayName: true, email: true } } },
  });
  if (!aiSystem) {
    return reply.status(404).send({ error: "AI system not found" });
  }
  try {
    assertOwnedByTenant(aiSystem, { tenantId: session.tenantId }, "AI system");
  } catch {
    return reply.status(404).send({ error: "AI system not found" });
  }
  return reply.send(aiSystem);
});

server.patch("/ai-systems/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to update AI systems" });
  }

  const { id } = request.params as { id: string };
  const existing = await prisma.aiSystem.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "AI system not found" });
  }
  try {
    assertOwnedByTenant(existing, { tenantId: session.tenantId }, "AI system");
  } catch {
    return reply.status(404).send({ error: "AI system not found" });
  }

  const body = request.body as {
    name?: string;
    description?: string;
    category?: string;
    lifecycleStatus?: string;
    ownerUserId?: string | null;
    dataCategories?: string[];
    riskTier?: string | null;
    businessCriticality?: string | null;
    decisionRole?: string | null;
    humanOversight?: string | null;
    impactLevel?: string | null;
    dataSensitivity?: string | null;
    affectedPopulation?: string[];
    externalImpact?: boolean | null;
    regulatoryRelevance?: string[];
    assessmentStatus?: string;
  };

  if (body.category !== undefined && !AI_SYSTEM_CATEGORIES.includes(body.category)) {
    return reply.status(400).send({ error: "Invalid category" });
  }
  if (body.lifecycleStatus !== undefined && !AI_SYSTEM_LIFECYCLE_STATUSES.includes(body.lifecycleStatus)) {
    return reply.status(400).send({ error: "Invalid lifecycleStatus" });
  }
  if (body.dataCategories !== undefined) {
    const invalidDataCategories = body.dataCategories.filter((c) => !(DATA_CATEGORIES as readonly string[]).includes(c));
    if (invalidDataCategories.length > 0) {
      return reply.status(400).send({ error: `Invalid dataCategories: ${invalidDataCategories.join(", ")}` });
    }
  }
  if (body.riskTier !== undefined && body.riskTier !== null && !RISK_TIERS.includes(body.riskTier)) {
    return reply.status(400).send({ error: "Invalid riskTier" });
  }
  if (body.businessCriticality !== undefined && body.businessCriticality !== null && !BUSINESS_CRITICALITY_VALUES.includes(body.businessCriticality)) {
    return reply.status(400).send({ error: "Invalid businessCriticality" });
  }
  if (body.decisionRole !== undefined && body.decisionRole !== null && !DECISION_ROLE_VALUES.includes(body.decisionRole)) {
    return reply.status(400).send({ error: "Invalid decisionRole" });
  }
  if (body.humanOversight !== undefined && body.humanOversight !== null && !HUMAN_OVERSIGHT_VALUES.includes(body.humanOversight)) {
    return reply.status(400).send({ error: "Invalid humanOversight" });
  }
  if (body.impactLevel !== undefined && body.impactLevel !== null && !IMPACT_LEVEL_VALUES.includes(body.impactLevel)) {
    return reply.status(400).send({ error: "Invalid impactLevel" });
  }
  if (body.dataSensitivity !== undefined && body.dataSensitivity !== null && !DATA_SENSITIVITY_VALUES.includes(body.dataSensitivity)) {
    return reply.status(400).send({ error: "Invalid dataSensitivity" });
  }
  if (body.affectedPopulation !== undefined) {
    const invalidPops = body.affectedPopulation.filter((p) => !(AFFECTED_POPULATIONS as readonly string[]).includes(p));
    if (invalidPops.length > 0) {
      return reply.status(400).send({ error: `Invalid affectedPopulation: ${invalidPops.join(", ")}` });
    }
  }
  if (body.regulatoryRelevance !== undefined) {
    const invalidTags = body.regulatoryRelevance.filter((t) => !(REGULATORY_RELEVANCE_TAGS as readonly string[]).includes(t));
    if (invalidTags.length > 0) {
      return reply.status(400).send({ error: `Invalid regulatoryRelevance: ${invalidTags.join(", ")}` });
    }
  }
  if (body.assessmentStatus !== undefined && !ASSESSMENT_STATUS_VALUES.includes(body.assessmentStatus)) {
    return reply.status(400).send({ error: "Invalid assessmentStatus" });
  }

  let ownerUserId = existing.ownerUserId;
  if (body.ownerUserId !== undefined) {
    if (body.ownerUserId === null) {
      ownerUserId = null;
    } else {
      const membership = await prisma.tenantMembership.findFirst({
        where: { userId: body.ownerUserId, tenantId: session.tenantId },
      });
      if (!membership) {
        return reply.status(400).send({ error: "ownerUserId must belong to a user in this tenant" });
      }
      ownerUserId = body.ownerUserId;
    }
  }

  const ownerChanged = body.ownerUserId !== undefined && ownerUserId !== existing.ownerUserId;

  const CLASSIFICATION_FIELDS = ["businessCriticality", "decisionRole", "humanOversight", "impactLevel", "dataSensitivity", "affectedPopulation", "externalImpact", "regulatoryRelevance", "assessmentStatus"] as const;
  const classificationChanges: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of CLASSIFICATION_FIELDS) {
    const value = (body as Record<string, unknown>)[field];
    if (value !== undefined) {
      const before = (existing as unknown as Record<string, unknown>)[field];
      const changed = Array.isArray(before) || Array.isArray(value) ? JSON.stringify(before) !== JSON.stringify(value) : before !== value;
      if (changed) {
        classificationChanges[field] = { from: before, to: value };
      }
    }
  }

  if (
    body.lifecycleStatus !== undefined &&
    body.lifecycleStatus !== "PROPOSED" &&
    existing.origin === "THIRD_PARTY"
  ) {
    const linkCount = await prisma.aiSystemVendor.count({ where: { aiSystemId: existing.id } });
    if (linkCount === 0) {
      return reply.status(400).send({
        error: "A THIRD_PARTY AI system must have at least one vendor relationship before leaving PROPOSED status",
      });
    }
  }

  const lifecycleChanged = body.lifecycleStatus !== undefined && body.lifecycleStatus !== existing.lifecycleStatus;

  const updated = await prisma.aiSystem.update({
    where: { id: existing.id },
    data: {
      name: body.name ?? undefined,
      description: body.description !== undefined ? body.description : undefined,
      category: (body.category as never) ?? undefined,
      lifecycleStatus: (body.lifecycleStatus as never) ?? undefined,
      ownerUserId,
      dataCategories: body.dataCategories ?? undefined,
      riskTier: body.riskTier !== undefined ? (body.riskTier as never) : undefined,
      businessCriticality: body.businessCriticality !== undefined ? (body.businessCriticality as never) : undefined,
      decisionRole: body.decisionRole !== undefined ? (body.decisionRole as never) : undefined,
      humanOversight: body.humanOversight !== undefined ? (body.humanOversight as never) : undefined,
      impactLevel: body.impactLevel !== undefined ? (body.impactLevel as never) : undefined,
      dataSensitivity: body.dataSensitivity !== undefined ? (body.dataSensitivity as never) : undefined,
      affectedPopulation: body.affectedPopulation ?? undefined,
      externalImpact: body.externalImpact !== undefined ? body.externalImpact : undefined,
      regulatoryRelevance: body.regulatoryRelevance ?? undefined,
      assessmentStatus: (body.assessmentStatus as never) ?? undefined,
    },
    include: { owner: { select: { id: true, displayName: true, email: true } } },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: lifecycleChanged ? "ai_system.lifecycle_changed" : "ai_system.updated",
      targetType: "AiSystem",
      targetId: updated.id,
      outcome: "SUCCESS",
    },
  });

  if (body.lifecycleStatus === "RETIRED" && existing.lifecycleStatus !== "RETIRED") {
    await prisma.auditEvent.create({
      data: {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "ai_system.retired",
        targetType: "AiSystem",
        targetId: updated.id,
        outcome: "SUCCESS",
      },
    });
  }

  if (ownerChanged) {
    await prisma.auditEvent.create({
      data: {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "ai_system.owner_changed",
        targetType: "AiSystem",
        targetId: updated.id,
        outcome: "SUCCESS",
        metadataJson: { previousOwnerUserId: existing.ownerUserId, newOwnerUserId: ownerUserId },
      },
    });
  }

  if (Object.keys(classificationChanges).length > 0) {
    await prisma.auditEvent.create({
      data: {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "ai_system.classification_changed",
        targetType: "AiSystem",
        targetId: updated.id,
        outcome: "SUCCESS",
        metadataJson: classificationChanges as never,
      },
    });
  }

  return reply.send(updated);
});

server.post("/ai-systems/:id/vendors", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:link-vendor");
  } catch {
    return reply.status(403).send({ error: "Not authorized to link vendors to AI systems" });
  }

  const { id } = request.params as { id: string };
  const aiSystem = await prisma.aiSystem.findUnique({ where: { id } });
  if (!aiSystem) {
    return reply.status(404).send({ error: "AI system not found" });
  }
  try {
    assertOwnedByTenant(aiSystem, { tenantId: session.tenantId }, "AI system");
  } catch {
    return reply.status(404).send({ error: "AI system not found" });
  }

  const body = request.body as { vendorId?: string; role?: string };
  if (!body.vendorId) {
    return reply.status(400).send({ error: "vendorId is required" });
  }
  const role = body.role ?? "OTHER";
  if (!AI_SYSTEM_VENDOR_ROLES.includes(role)) {
    return reply.status(400).send({ error: "Invalid vendor role" });
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  try {
    assertOwnedByTenant(vendor, { tenantId: session.tenantId }, "Vendor");
  } catch {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  let link;
  try {
    link = await prisma.aiSystemVendor.create({
      data: {
        tenantId: session.tenantId,
        aiSystemId: aiSystem.id,
        vendorId: vendor.id,
        role: role as never,
      },
    });
  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    if (prismaErr?.code === "P2002") {
      return reply.status(409).send({ error: "This vendor is already linked to this AI system with that role" });
    }
    throw err;
  }

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_system.vendor_linked",
      targetType: "AiSystem",
      targetId: aiSystem.id,
      outcome: "SUCCESS",
    },
  });

  return reply.status(201).send(link);
});

server.get("/ai-systems/:id/vendors", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:read");
  } catch {
    return reply.status(403).send({ error: "Not authorized to view AI systems" });
  }

  const { id } = request.params as { id: string };
  const aiSystem = await prisma.aiSystem.findUnique({ where: { id } });
  if (!aiSystem) {
    return reply.status(404).send({ error: "AI system not found" });
  }
  try {
    assertOwnedByTenant(aiSystem, { tenantId: session.tenantId }, "AI system");
  } catch {
    return reply.status(404).send({ error: "AI system not found" });
  }

  const links = await prisma.aiSystemVendor.findMany({
    where: { aiSystemId: aiSystem.id, tenantId: session.tenantId },
    include: { vendor: true },
  });
  return reply.send({ vendorLinks: links });
});

server.delete("/ai-systems/:id/vendors/:linkId", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:link-vendor");
  } catch {
    return reply.status(403).send({ error: "Not authorized to unlink vendors from AI systems" });
  }

  const { id, linkId } = request.params as { id: string; linkId: string };
  const link = await prisma.aiSystemVendor.findUnique({ where: { id: linkId } });
  if (!link || link.aiSystemId !== id) {
    return reply.status(404).send({ error: "Vendor link not found" });
  }
  try {
    assertOwnedByTenant(link, { tenantId: session.tenantId }, "Vendor link");
  } catch {
    return reply.status(404).send({ error: "Vendor link not found" });
  }

  await prisma.aiSystemVendor.delete({ where: { id: link.id } });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_system.vendor_unlinked",
      targetType: "AiSystem",
      targetId: id,
      outcome: "SUCCESS",
    },
  });

  return reply.status(204).send();
});


server.get("/tenant-users", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to view tenant users" });
  }

  const memberships = await prisma.tenantMembership.findMany({
    where: { tenantId: session.tenantId },
    include: { user: { select: { id: true, displayName: true, email: true } } },
  });
  const users = memberships.map((m) => m.user);
  return reply.send({ users });
});


// ---------------------------------------------------------------------------
// AI Risk Assessment (Step 6) - a governance risk register attached to an
// AiSystem. Scores are always calculated server-side; the frontend never
// submits a score directly. Risk and Finding remain conceptually separate -
// this step does not create findings, only risks, controls, and (where a
// risk needs mitigation work) a linked RemediationAction.
// ---------------------------------------------------------------------------

const AI_RISK_ASSESSMENT_STATUSES = ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW", "COMPLETED"];
const AI_RISK_CATEGORIES = ["DATA", "PRIVACY", "FAIRNESS", "TRANSPARENCY", "RELIABILITY", "SAFETY", "SECURITY", "HUMAN_OVERSIGHT", "THIRD_PARTY", "LEGAL_COMPLIANCE", "OPERATIONAL"];
const AI_CONTROL_EFFECTIVENESS_VALUES = ["NOT_ASSESSED", "INEFFECTIVE", "PARTIALLY_EFFECTIVE", "EFFECTIVE"];
const AI_RISK_TREATMENT_VALUES = ["ACCEPT", "MITIGATE", "AVOID", "TRANSFER"];
const AI_ASSESSMENT_REVIEW_DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"];

function scoreToRiskBand(score: number): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  if (score <= 4) return "LOW";
  if (score <= 9) return "MODERATE";
  if (score <= 16) return "HIGH";
  return "CRITICAL";
}

function isValidScale(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

server.post("/ai-systems/:id/risk-assessments", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to create AI risk assessments" });
  }

  const { id } = request.params as { id: string };
  const aiSystem = await prisma.aiSystem.findUnique({ where: { id } });
  if (!aiSystem) {
    return reply.status(404).send({ error: "AI system not found" });
  }
  try {
    assertOwnedByTenant(aiSystem, { tenantId: session.tenantId }, "AI system");
  } catch {
    return reply.status(404).send({ error: "AI system not found" });
  }

  const body = request.body as { name?: string; assessorUserId?: string };
  if (!body.name) {
    return reply.status(400).send({ error: "name is required" });
  }

  let assessorUserId: string | null = session.userId ?? null;
  if (body.assessorUserId) {
    const membership = await prisma.tenantMembership.findFirst({
      where: { userId: body.assessorUserId, tenantId: session.tenantId },
    });
    if (!membership) {
      return reply.status(400).send({ error: "assessorUserId must belong to a user in this tenant" });
    }
    assessorUserId = body.assessorUserId;
  }

  const assessment = await prisma.aiRiskAssessment.create({
    data: {
      tenantId: session.tenantId,
      aiSystemId: aiSystem.id,
      name: body.name,
      assessorUserId,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_risk_assessment.created",
      targetType: "AiRiskAssessment",
      targetId: assessment.id,
      outcome: "SUCCESS",
    },
  });

  return reply.status(201).send(assessment);
});

server.get("/ai-systems/:id/risk-assessments", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:read");
  } catch {
    return reply.status(403).send({ error: "Not authorized to view AI risk assessments" });
  }

  const { id } = request.params as { id: string };
  const aiSystem = await prisma.aiSystem.findUnique({ where: { id } });
  if (!aiSystem) {
    return reply.status(404).send({ error: "AI system not found" });
  }
  try {
    assertOwnedByTenant(aiSystem, { tenantId: session.tenantId }, "AI system");
  } catch {
    return reply.status(404).send({ error: "AI system not found" });
  }

  const assessments = await prisma.aiRiskAssessment.findMany({
    where: { aiSystemId: aiSystem.id, tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
    include: { risks: true },
  });
  return reply.send({ assessments });
});

server.get("/ai-risk-assessments/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:read");
  } catch {
    return reply.status(403).send({ error: "Not authorized to view AI risk assessments" });
  }

  const { id } = request.params as { id: string };
  const assessment = await prisma.aiRiskAssessment.findUnique({
    where: { id },
    include: {
      risks: { include: { control: true } },
      assessor: { select: { id: true, displayName: true, email: true } },
      reviewer: { select: { id: true, displayName: true, email: true } },
    },
  });
  if (!assessment) {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }
  try {
    assertOwnedByTenant(assessment, { tenantId: session.tenantId }, "AI risk assessment");
  } catch {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }
  return reply.send(assessment);
});

server.patch("/ai-risk-assessments/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to update AI risk assessments" });
  }

  const { id } = request.params as { id: string };
  const existing = await prisma.aiRiskAssessment.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }
  try {
    assertOwnedByTenant(existing, { tenantId: session.tenantId }, "AI risk assessment");
  } catch {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }

  const body = request.body as { name?: string; status?: string; assessorUserId?: string | null };

  if (body.status !== undefined && !AI_RISK_ASSESSMENT_STATUSES.includes(body.status)) {
    return reply.status(400).send({ error: "Invalid status" });
  }

  let assessorUserId = existing.assessorUserId;
  if (body.assessorUserId !== undefined) {
    if (body.assessorUserId === null) {
      assessorUserId = null;
    } else {
      const membership = await prisma.tenantMembership.findFirst({
        where: { userId: body.assessorUserId, tenantId: session.tenantId },
      });
      if (!membership) {
        return reply.status(400).send({ error: "assessorUserId must belong to a user in this tenant" });
      }
      assessorUserId = body.assessorUserId;
    }
  }

  const statusChanged = body.status !== undefined && body.status !== existing.status;

  const updated = await prisma.aiRiskAssessment.update({
    where: { id: existing.id },
    data: {
      name: body.name ?? undefined,
      status: (body.status as never) ?? undefined,
      assessorUserId,
      completedAt: body.status === "COMPLETED" && existing.status !== "COMPLETED" ? new Date() : undefined,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: statusChanged ? "ai_risk_assessment.status_changed" : "ai_risk_assessment.updated",
      targetType: "AiRiskAssessment",
      targetId: updated.id,
      outcome: "SUCCESS",
      metadataJson: statusChanged ? ({ from: existing.status, to: updated.status } as never) : undefined,
    },
  });

  return reply.send(updated);
});

server.post("/ai-risk-assessments/:id/risks", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to add risks to an AI risk assessment" });
  }

  const { id } = request.params as { id: string };
  const assessment = await prisma.aiRiskAssessment.findUnique({ where: { id } });
  if (!assessment) {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }
  try {
    assertOwnedByTenant(assessment, { tenantId: session.tenantId }, "AI risk assessment");
  } catch {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }

  const body = request.body as {
    title?: string;
    category?: string;
    statement?: string;
    likelihood?: number;
    impact?: number;
    controlId?: string;
  };

  if (!body.title) {
    return reply.status(400).send({ error: "title is required" });
  }
  if (!body.category || !AI_RISK_CATEGORIES.includes(body.category)) {
    return reply.status(400).send({ error: "Invalid or missing category" });
  }
  if (!body.statement) {
    return reply.status(400).send({ error: "statement is required" });
  }
  if (!isValidScale(body.likelihood)) {
    return reply.status(400).send({ error: "likelihood must be an integer from 1 to 5" });
  }
  if (!isValidScale(body.impact)) {
    return reply.status(400).send({ error: "impact must be an integer from 1 to 5" });
  }

  let controlId: string | null = null;
  if (body.controlId) {
    const control = await prisma.control.findUnique({ where: { id: body.controlId } });
    if (!control) {
      return reply.status(400).send({ error: "controlId does not reference an existing control" });
    }
    controlId = body.controlId;
  }

  const inherentScore = body.likelihood * body.impact;
  const inherentRating = scoreToRiskBand(inherentScore);

  const risk = await prisma.aiRisk.create({
    data: {
      tenantId: session.tenantId,
      assessmentId: assessment.id,
      title: body.title,
      category: body.category as never,
      statement: body.statement,
      likelihood: body.likelihood,
      impact: body.impact,
      inherentScore,
      inherentRating: inherentRating as never,
      controlId,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_risk.created",
      targetType: "AiRisk",
      targetId: risk.id,
      outcome: "SUCCESS",
      metadataJson: { inherentScore, inherentRating } as never,
    },
  });

  return reply.status(201).send(risk);
});

server.patch("/ai-risks/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to update this risk" });
  }

  const { id } = request.params as { id: string };
  const existing = await prisma.aiRisk.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Risk not found" });
  }
  try {
    assertOwnedByTenant(existing, { tenantId: session.tenantId }, "Risk");
  } catch {
    return reply.status(404).send({ error: "Risk not found" });
  }

  const body = request.body as {
    title?: string;
    category?: string;
    statement?: string;
    likelihood?: number;
    impact?: number;
    existingControls?: string;
    controlId?: string | null;
    controlEffectiveness?: string;
    residualLikelihood?: number;
    residualImpact?: number;
    treatment?: string | null;
    treatmentRationale?: string;
    treatmentOwnerUserId?: string | null;
    treatmentTargetDate?: string | null;
  };

  if (body.category !== undefined && !AI_RISK_CATEGORIES.includes(body.category)) {
    return reply.status(400).send({ error: "Invalid category" });
  }
  if (body.likelihood !== undefined && !isValidScale(body.likelihood)) {
    return reply.status(400).send({ error: "likelihood must be an integer from 1 to 5" });
  }
  if (body.impact !== undefined && !isValidScale(body.impact)) {
    return reply.status(400).send({ error: "impact must be an integer from 1 to 5" });
  }
  if (body.controlEffectiveness !== undefined && !AI_CONTROL_EFFECTIVENESS_VALUES.includes(body.controlEffectiveness)) {
    return reply.status(400).send({ error: "Invalid controlEffectiveness" });
  }
  if (body.residualLikelihood !== undefined && body.residualLikelihood !== null && !isValidScale(body.residualLikelihood)) {
    return reply.status(400).send({ error: "residualLikelihood must be an integer from 1 to 5" });
  }
  if (body.residualImpact !== undefined && body.residualImpact !== null && !isValidScale(body.residualImpact)) {
    return reply.status(400).send({ error: "residualImpact must be an integer from 1 to 5" });
  }
  if (body.treatment !== undefined && body.treatment !== null && !AI_RISK_TREATMENT_VALUES.includes(body.treatment)) {
    return reply.status(400).send({ error: "Invalid treatment" });
  }

  let controlId = existing.controlId;
  if (body.controlId !== undefined) {
    if (body.controlId === null) {
      controlId = null;
    } else {
      const control = await prisma.control.findUnique({ where: { id: body.controlId } });
      if (!control) {
        return reply.status(400).send({ error: "controlId does not reference an existing control" });
      }
      controlId = body.controlId;
    }
  }

  let treatmentOwnerUserId = existing.treatmentOwnerUserId;
  if (body.treatmentOwnerUserId !== undefined) {
    if (body.treatmentOwnerUserId === null) {
      treatmentOwnerUserId = null;
    } else {
      const membership = await prisma.tenantMembership.findFirst({
        where: { userId: body.treatmentOwnerUserId, tenantId: session.tenantId },
      });
      if (!membership) {
        return reply.status(400).send({ error: "treatmentOwnerUserId must belong to a user in this tenant" });
      }
      treatmentOwnerUserId = body.treatmentOwnerUserId;
    }
  }

  const newLikelihood = body.likelihood ?? existing.likelihood;
  const newImpact = body.impact ?? existing.impact;
  const inherentChanged = body.likelihood !== undefined || body.impact !== undefined;
  const inherentScore = newLikelihood * newImpact;
  const inherentRating = scoreToRiskBand(inherentScore);

  const residualLikelihood = body.residualLikelihood !== undefined ? body.residualLikelihood : existing.residualLikelihood;
  const residualImpact = body.residualImpact !== undefined ? body.residualImpact : existing.residualImpact;
  const residualChanged = body.residualLikelihood !== undefined || body.residualImpact !== undefined;
  let residualScore = existing.residualScore;
  let residualRating: string | null = existing.residualRating;
  if (residualLikelihood !== null && residualLikelihood !== undefined && residualImpact !== null && residualImpact !== undefined) {
    residualScore = residualLikelihood * residualImpact;
    residualRating = scoreToRiskBand(residualScore);
  }

  const controlEffectivenessChanged = body.controlEffectiveness !== undefined && body.controlEffectiveness !== existing.controlEffectiveness;
  const treatmentChanged = body.treatment !== undefined && body.treatment !== existing.treatment;

  const updated = await prisma.aiRisk.update({
    where: { id: existing.id },
    data: {
      title: body.title ?? undefined,
      category: (body.category as never) ?? undefined,
      statement: body.statement ?? undefined,
      likelihood: newLikelihood,
      impact: newImpact,
      inherentScore,
      inherentRating: inherentRating as never,
      existingControls: body.existingControls !== undefined ? body.existingControls : undefined,
      controlId,
      controlEffectiveness: (body.controlEffectiveness as never) ?? undefined,
      residualLikelihood: body.residualLikelihood !== undefined ? body.residualLikelihood : undefined,
      residualImpact: body.residualImpact !== undefined ? body.residualImpact : undefined,
      residualScore: residualChanged ? residualScore : undefined,
      residualRating: residualChanged ? (residualRating as never) : undefined,
      treatment: body.treatment !== undefined ? (body.treatment as never) : undefined,
      treatmentRationale: body.treatmentRationale !== undefined ? body.treatmentRationale : undefined,
      treatmentOwnerUserId,
      treatmentTargetDate: body.treatmentTargetDate !== undefined ? (body.treatmentTargetDate ? new Date(body.treatmentTargetDate) : null) : undefined,
    },
  });

  const auditEvents: { action: string; metadataJson?: unknown }[] = [];
  if (inherentChanged) {
    auditEvents.push({ action: "ai_risk.inherent_risk_changed", metadataJson: { from: existing.inherentScore, to: inherentScore } });
  }
  if (controlEffectivenessChanged) {
    auditEvents.push({ action: "ai_risk.control_effectiveness_changed", metadataJson: { from: existing.controlEffectiveness, to: body.controlEffectiveness } });
  }
  if (residualChanged) {
    auditEvents.push({ action: "ai_risk.residual_risk_changed", metadataJson: { from: existing.residualScore, to: residualScore } });
  }
  if (treatmentChanged) {
    auditEvents.push({ action: "ai_risk.treatment_changed", metadataJson: { from: existing.treatment, to: body.treatment } });
  }
  if (auditEvents.length === 0) {
    auditEvents.push({ action: "ai_risk.updated" });
  }
  for (const evt of auditEvents) {
    await prisma.auditEvent.create({
      data: {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: evt.action,
        targetType: "AiRisk",
        targetId: updated.id,
        outcome: "SUCCESS",
        metadataJson: (evt.metadataJson as never) ?? undefined,
      },
    });
  }

  return reply.send(updated);
});

server.delete("/ai-risks/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to delete this risk" });
  }

  const { id } = request.params as { id: string };
  const existing = await prisma.aiRisk.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Risk not found" });
  }
  try {
    assertOwnedByTenant(existing, { tenantId: session.tenantId }, "Risk");
  } catch {
    return reply.status(404).send({ error: "Risk not found" });
  }

  await prisma.aiRisk.delete({ where: { id: existing.id } });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_risk.deleted",
      targetType: "AiRisk",
      targetId: id,
      outcome: "SUCCESS",
    },
  });

  return reply.status(204).send();
});

server.post("/ai-risk-assessments/:id/review", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const alreadyReviewedMessage = "This assessment has already been reviewed and approved. The original review decision cannot be overwritten.";
  const auditDenied = (reason: string) =>
    prisma.auditEvent.create({
      data: {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "ai_risk_assessment.review_denied",
        targetType: "AiRiskAssessment",
        targetId: id,
        outcome: "DENIED",
        metadataJson: { reason } as never,
      },
    });

  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-risk-assessment:review");
  } catch {
    await auditDenied("missing_permission");
    return reply.status(403).send({ error: "Not authorized to review AI risk assessments" });
  }

  const assessment = await prisma.aiRiskAssessment.findUnique({ where: { id } });
  if (!assessment) {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }
  try {
    assertOwnedByTenant(assessment, { tenantId: session.tenantId }, "AI risk assessment");
  } catch {
    return reply.status(404).send({ error: "AI risk assessment not found" });
  }

  const body = request.body as { decision?: string; rationale?: string };
  if (!body.decision || !AI_ASSESSMENT_REVIEW_DECISIONS.includes(body.decision)) {
    return reply.status(400).send({ error: "Invalid or missing decision" });
  }
  if (!body.rationale) {
    return reply.status(400).send({ error: "rationale is required" });
  }
  if (assessment.status === "COMPLETED" || assessment.reviewDecision === "APPROVED") {
    await auditDenied("already_completed");
    return reply.status(409).send({ error: alreadyReviewedMessage });
  }
  if (!assessment.assessorUserId) {
    await auditDenied("no_assessor_assigned");
    return reply.status(403).send({ error: "Review cannot proceed because an assessor has not been assigned to this assessment." });
  }
  if (assessment.assessorUserId === session.userId) {
    await auditDenied("self_review");
    return reply.status(403).send({ error: "The assessor cannot also review their own assessment" });
  }

  const newStatus = body.decision === "APPROVED" ? "COMPLETED" : "IN_PROGRESS";

  // Conditional update: only succeeds if the assessment is still not approved (guards against a race between two reviewers)
  const result = await prisma.aiRiskAssessment.updateMany({
    where: {
      id: assessment.id,
      tenantId: session.tenantId,
      status: { not: "COMPLETED" as never },
      OR: [{ reviewDecision: null }, { reviewDecision: { not: "APPROVED" as never } }],
    },
    data: {
      reviewedAt: new Date(),
      reviewerUserId: session.userId,
      reviewDecision: body.decision as never,
      reviewRationale: body.rationale,
      status: newStatus as never,
      completedAt: body.decision === "APPROVED" ? new Date() : undefined,
    },
  });
  if (result.count === 0) {
    await auditDenied("already_completed");
    return reply.status(409).send({ error: alreadyReviewedMessage });
  }
  const updated = await prisma.aiRiskAssessment.findUnique({ where: { id: assessment.id } });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_risk_assessment.review_recorded",
      targetType: "AiRiskAssessment",
      targetId: assessment.id,
      outcome: "SUCCESS",
      metadataJson: { decision: body.decision } as never,
    },
  });

  return reply.send(updated);
});

server.post("/ai-risks/:id/remediation", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, "ai-system:update");
  } catch {
    return reply.status(403).send({ error: "Not authorized to create remediation for this risk" });
  }

  const { id } = request.params as { id: string };
  const risk = await prisma.aiRisk.findUnique({ where: { id } });
  if (!risk) {
    return reply.status(404).send({ error: "Risk not found" });
  }
  try {
    assertOwnedByTenant(risk, { tenantId: session.tenantId }, "Risk");
  } catch {
    return reply.status(404).send({ error: "Risk not found" });
  }

  const body = request.body as { title?: string; description?: string; ownerUserId?: string; dueDate?: string };
  if (!body.title) {
    return reply.status(400).send({ error: "title is required" });
  }
  if (!body.description) {
    return reply.status(400).send({ error: "description is required" });
  }

  const remediation = await prisma.remediationAction.create({
    data: {
      tenantId: session.tenantId,
      aiRiskId: risk.id,
      title: body.title,
      description: body.description,
      ownerUserId: body.ownerUserId ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "ai_risk.remediation_created",
      targetType: "RemediationAction",
      targetId: remediation.id,
      outcome: "SUCCESS",
    },
  });

  return reply.status(201).send(remediation);
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

if (process.env.NODE_ENV !== "test") {
  start();
}

































