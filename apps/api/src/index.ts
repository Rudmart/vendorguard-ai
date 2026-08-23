import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "@vendorguard/database";
import { calculateInherentRisk } from "@vendorguard/risk-engine";
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

































