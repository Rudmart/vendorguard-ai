/**
 * Step 9 - AI Controls, Evidence & Assurance.
 *
 * Flow: AI system -> mapped control (AiSystemControl) -> evidence (EvidenceDocument)
 *       -> human review (AiControlEvidenceReview, append-only) -> derived assurance status.
 *
 * Deliberately NOT here: control testing, design/operating effectiveness, formal test results.
 * Those belong to the later Control Testing capability.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma, databaseClient, type Prisma } from "@vendorguard/database";
import { getSessionFromCookie, requirePermission } from "@vendorguard/auth";
import { resolveSession } from "./session.js";
import type { Role } from "@vendorguard/shared";
import { getStorageClient } from "@vendorguard/storage-client";
import { extractEvidenceText, evidenceTextHash } from "./evidenceExtraction.js";

export type Session = NonNullable<ReturnType<typeof getSessionFromCookie>>;
export type Permission = Parameters<typeof requirePermission>[1];
export type AuditMeta = Record<string, string | number | boolean | null>;

export type AssuranceStatus = "NO_EVIDENCE" | "PENDING_REVIEW" | "ACCEPTED" | "REJECTED";

/** Simple Step 9 assurance status. Derived on read, never stored, so it cannot drift. */
export function deriveAssuranceStatus(linkStatuses: readonly string[]): AssuranceStatus {
  if (linkStatuses.includes("ACCEPTED")) {
    return "ACCEPTED";
  }
  if (linkStatuses.includes("PENDING_REVIEW")) {
    return "PENDING_REVIEW";
  }
  if (linkStatuses.includes("REJECTED")) {
    return "REJECTED";
  }
  return "NO_EVIDENCE";
}

const BLOCKED_EVIDENCE_STATES: ReadonlySet<string> = new Set(["QUARANTINED", "REJECTED", "FAILED", "EXPIRED"]);
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const EVIDENCE_SELECT = {
  id: true,
  displayFilename: true,
  documentType: true,
  state: true,
  expirationDate: true,
  vendorId: true,
  aiSystemId: true,
  uploadedByUserId: true,
  sizeBytes: true,
  createdAt: true,
} as const;
const USER_SELECT = { id: true, displayName: true, email: true } as const;

export async function sessionOf(request: FastifyRequest): Promise<Session | null> {
  return resolveSession(request);
}

export function hasPermission(session: Session, permission: Permission): boolean {
  try {
    requirePermission({ tenantId: session.tenantId, role: session.role as Role }, permission);
    return true;
  } catch {
    return false;
  }
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

export function parseOptionalDate(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function isUsableEvidence(doc: { state: string; expirationDate: Date | null }): boolean {
  if (BLOCKED_EVIDENCE_STATES.has(doc.state)) {
    return false;
  }
  if (doc.expirationDate && doc.expirationDate.getTime() < Date.now()) {
    return false;
  }
  return true;
}

export async function audit(
  session: Session,
  action: string,
  targetType: string,
  targetId: string,
  metadata: AuditMeta,
  outcome: "SUCCESS" | "DENIED" = "SUCCESS",
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action,
      targetType,
      targetId,
      outcome,
      metadataJson: metadata,
    },
  });
}

async function loadAiSystem(id: string, tenantId: string) {
  return prisma.aiSystem.findFirst({ where: { id, tenantId } });
}

async function loadControlRecord(id: string, tenantId: string) {
  return prisma.aiSystemControl.findFirst({ where: { id, tenantId } });
}

async function linkedVendorIds(tenantId: string, aiSystemId: string): Promise<string[]> {
  const links = await prisma.aiSystemVendor.findMany({ where: { tenantId, aiSystemId }, select: { vendorId: true } });
  return links.map((link) => link.vendorId);
}

export async function registerAiControlEvidenceRoutes(app: FastifyInstance): Promise<void> {
  // 1. Record AI-system evidence metadata (no file). Mirrors POST /vendors/:id/evidence.
  app.post("/ai-systems/:id/evidence", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to add AI system evidence" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await loadAiSystem(id, session.tenantId);
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const body = (request.body ?? {}) as { displayFilename?: unknown; documentType?: unknown; expirationDate?: unknown };
    const displayFilename = cleanText(body.displayFilename, 255);
    const documentType = cleanText(body.documentType, 200);
    if (!displayFilename || !documentType) {
      return reply.status(400).send({ error: "displayFilename (max 255) and documentType (max 200) are required" });
    }
    const expirationDate = parseOptionalDate(body.expirationDate);
    if (expirationDate === "invalid") {
      return reply.status(400).send({ error: "expirationDate must be a valid date" });
    }
    const evidence = await prisma.evidenceDocument.create({
      data: {
        tenantId: session.tenantId,
        aiSystemId: aiSystem.id,
        displayFilename,
        storageKey: "manual-" + randomUUID(),
        mimeType: "application/octet-stream",
        sizeBytes: 0,
        sha256Hash: "manual-entry",
        documentType,
        state: "UPLOADED",
        expirationDate,
        uploadedByUserId: userId,
      },
    });
    await audit(session, "ai_system_evidence.created", "EvidenceDocument", evidence.id, { aiSystemId: aiSystem.id, documentType });
    return reply.status(201).send(evidence);
  });

  // 2. Upload an AI-system evidence file. Mirrors POST /vendors/:id/evidence/upload.
  app.post("/ai-systems/:id/evidence/upload", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply
        .status(403)
        .send({ error: "Not authorized to upload AI system evidence" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply
        .status(403)
        .send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await loadAiSystem(id, session.tenantId);
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const query = request.query as Record<string, unknown>;
    if (
      Object.keys(query).some(
        (key) => !["incidentId", "remediationId"].includes(key),
      )
    )
      return reply.code(400).send({ error: "Unknown upload context" });
    const incidentId =
      query.incidentId === undefined ? null : cleanText(query.incidentId, 200);
    const remediationId =
      query.remediationId === undefined
        ? null
        : cleanText(query.remediationId, 200);
    if (
      (query.incidentId !== undefined && !incidentId) ||
      (query.remediationId !== undefined && !remediationId) ||
      (incidentId && remediationId)
    )
      return reply
        .code(400)
        .send({ error: "Specify one valid historical follow-up context" });
    function fail(statusCode: number, message: string): never {
      throw Object.assign(new Error(message), { statusCode });
    }
    async function checked<T>(
      operation: (
        tx: Prisma.TransactionClient,
        contextToken: string,
      ) => Promise<T>,
    ): Promise<T> {
      return databaseClient
        .$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${session!.tenantId}, 0))`;
            await tx.$queryRaw`SELECT id FROM ai_systems WHERE id=${id} AND "tenantId"=${session!.tenantId} FOR UPDATE`;
            const membership = await tx.tenantMembership.findUnique({
              where: {
                tenantId_userId: { tenantId: session!.tenantId, userId },
              },
            });
            if (!membership) fail(401, "Tenant membership is no longer active");
            const current = { ...session!, role: membership.role };
            if (
              !hasPermission(current, "ai-system:update") ||
              !hasPermission(current, "evidence:upload")
            )
              fail(403, "Not authorized to upload evidence");
            const system = await tx.aiSystem.findFirst({
              where: { id, tenantId: session!.tenantId },
            });
            if (!system) fail(404, "AI System not found");
            let token = "operational";
            if (incidentId) {
              const incident = await tx.aiIncident.findFirst({
                where: {
                  id: incidentId,
                  tenantId: session!.tenantId,
                  aiSystemId: id,
                },
              });
              if (!incident) fail(404, "Incident not found for this AI System");
              if (!["OPEN", "IN_PROGRESS"].includes(incident.status))
                fail(409, "Incident follow-up is locked");
              if (current.role !== "ADMIN" && incident.ownerUserId !== userId)
                fail(
                  403,
                  "Only the incident owner or ADMIN may upload follow-up evidence",
                );
              token = JSON.stringify([
                incident.id,
                incident.revision,
                incident.ownerUserId,
                incident.status,
              ]);
            } else if (remediationId) {
              const remediation = await tx.remediationAction.findFirst({
                where: {
                  id: remediationId,
                  tenantId: session!.tenantId,
                  OR: [
                    {
                      aiRisk: {
                        assessment: {
                          aiSystemId: id,
                          tenantId: session!.tenantId,
                        },
                      },
                    },
                    {
                      governanceFinding: {
                        tenantId: session!.tenantId,
                        OR: [
                          {
                            aiControlTest: {
                              aiSystemControl: { aiSystemId: id },
                            },
                          },
                          {
                            incidentLinks: {
                              some: {
                                incident: {
                                  aiSystemId: id,
                                  tenantId: session!.tenantId,
                                },
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              });
              if (!remediation)
                fail(404, "Remediation not found for this AI System");
              if (
                !["OPEN", "IN_PROGRESS", "OVERDUE"].includes(remediation.status)
              )
                fail(409, "Remediation follow-up is locked");
              if (
                current.role !== "ADMIN" &&
                remediation.ownerUserId !== userId
              )
                fail(
                  403,
                  "Only the remediation owner or ADMIN may upload follow-up evidence",
                );
              token = JSON.stringify([
                remediation.id,
                remediation.updatedAt,
                remediation.ownerUserId,
                remediation.status,
              ]);
            } else if (system.lifecycleStatus === "RETIRED")
              fail(
                409,
                "Operational evidence uploads are prohibited after retirement; an authorized historical follow-up context is required",
              );
            return operation(tx, token);
          },
          { maxWait: 15000, timeout: 10000 },
        )
        .catch(async (error: unknown) => {
          const status = (error as { statusCode?: number }).statusCode;
          if (status)
            await audit(
              session!,
              "ai_system_evidence.upload_blocked",
              "AiSystem",
              id,
              { status },
              "DENIED",
            );
          throw error;
        });
    }
    const contextToken = await checked(async (_tx, token) => token);
    // No multipart reading, storage calls or text extraction occur while locked.
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });
    if (!ALLOWED_MIME_TYPES.has(data.mimetype))
      return reply
        .code(400)
        .send({ error: "Unsupported file type. Allowed: PDF, DOCX, XLSX." });
    const documentType = cleanText(
      (data.fields.documentType as { value?: unknown } | undefined)?.value,
      200,
    );
    if (!documentType)
      return reply.code(400).send({ error: "documentType is required" });
    const expirationDate = parseOptionalDate(
      (data.fields.expirationDate as { value?: unknown } | undefined)?.value,
    );
    if (expirationDate === "invalid")
      return reply
        .code(400)
        .send({ error: "expirationDate must be a valid date" });
    const buffer = await data.toBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES)
      return reply.code(400).send({ error: "File exceeds 25 MB limit" });
    let chunks: string[] = [];
    try {
      chunks = await extractEvidenceText(buffer, data.mimetype);
    } catch (error) {
      request.log.error(error, "Evidence text extraction failed");
    }
    const storageKey = `evidence/ai-systems/${id}/${randomUUID()}`;
    const containerName =
      process.env.AZURE_STORAGE_CONTAINER_EVIDENCE ?? "evidence";
    const storage = getStorageClient();
    const uploadResult = await storage.uploadFile(
      containerName,
      storageKey,
      buffer,
      data.mimetype,
    );
    try {
      const evidence = await checked(async (tx, freshToken) => {
        if (contextToken !== freshToken)
          fail(
            409,
            "Historical follow-up context changed during upload; retry",
          );
        const doc = await tx.evidenceDocument.create({
          data: {
            tenantId: session.tenantId,
            aiSystemId: id,
            displayFilename: data.filename.slice(0, 255),
            storageKey: uploadResult.storageKey,
            mimeType: uploadResult.mimeType,
            sizeBytes: uploadResult.sizeBytes,
            sha256Hash: uploadResult.sha256Hash,
            documentType,
            state: "UPLOADED",
            expirationDate,
            uploadedByUserId: userId,
          },
        });
        for (const [chunkIndex, text] of chunks.entries())
          await tx.evidenceChunk.create({
            data: {
              tenantId: session.tenantId,
              documentId: doc.id,
              chunkIndex,
              page: null,
              section: null,
              text,
              contentHash: evidenceTextHash(text),
            },
          });
        await tx.auditEvent.create({
          data: {
            tenantId: session.tenantId,
            actorUserId: userId,
            action: "ai_system_evidence.uploaded",
            targetType: "EvidenceDocument",
            targetId: doc.id,
            outcome: "SUCCESS",
            metadataJson: {
              aiSystemId: id,
              ...(incidentId ? { incidentId } : {}),
              ...(remediationId ? { remediationId } : {}),
            },
          },
        });
        return doc;
      });
      return reply
        .code(201)
        .send({ ...evidence, chunksExtracted: chunks.length });
    } catch (error) {
      try {
        await storage.deleteFile(containerName, uploadResult.storageKey);
      } catch (cleanupError) {
        request.log.error(
          { err: cleanupError, storageKey: uploadResult.storageKey },
          "Evidence upload compensation failed; operator cleanup required",
        );
        await audit(
          session,
          "ai_system_evidence.cleanup_failed",
          "AiSystem",
          id,
          { storageKey: uploadResult.storageKey },
          "DENIED",
        );
        fail(
          500,
          "Evidence persistence failed and blob cleanup failed; operator cleanup is required",
        );
      }
      await audit(
        session,
        "ai_system_evidence.upload_rolled_back",
        "AiSystem",
        id,
        { compensated: true },
        "DENIED",
      );
      throw error;
    }
  });

  // 3. Evidence available to this AI system: its own evidence + evidence of its linked vendors.
  app.get("/ai-systems/:id/evidence", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view AI system evidence" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await loadAiSystem(id, session.tenantId);
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const vendorIds = await linkedVendorIds(session.tenantId, aiSystem.id);
    const docs = await prisma.evidenceDocument.findMany({
      where: {
        tenantId: session.tenantId,
        deletedAt: null,
        OR: [{ aiSystemId: aiSystem.id }, ...(vendorIds.length > 0 ? [{ vendorId: { in: vendorIds } }] : [])],
      },
      select: { ...EVIDENCE_SELECT, vendor: { select: { id: true, legalName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({
      evidence: docs.map((doc) => ({
        ...doc,
        source: doc.aiSystemId === aiSystem.id ? "AI_SYSTEM" : "VENDOR",
        usable: isUsableEvidence(doc),
      })),
    });
  });

  // 4. Submit (link) evidence to a mapped AI-system control -> PENDING_REVIEW.
  app.post("/ai-system-controls/:controlRecordId/evidence", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to submit control evidence" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { controlRecordId } = request.params as { controlRecordId: string };
    const record = await loadControlRecord(controlRecordId, session.tenantId);
    if (!record) {
      return reply.status(404).send({ error: "AI system control not found" });
    }
    if (record.applicability === "NOT_APPLICABLE") {
      return reply.status(400).send({ error: "Evidence cannot be submitted for a control marked Not Applicable" });
    }
    const body = (request.body ?? {}) as { evidenceDocumentId?: unknown; note?: unknown };
    if (typeof body.evidenceDocumentId !== "string" || body.evidenceDocumentId.length === 0) {
      return reply.status(400).send({ error: "evidenceDocumentId is required" });
    }
    let note: string | null = null;
    if (body.note !== undefined && body.note !== null && body.note !== "") {
      note = cleanText(body.note, 2000);
      if (!note) {
        return reply.status(400).send({ error: "note must be text of at most 2000 characters" });
      }
    }
    const doc = await prisma.evidenceDocument.findFirst({
      where: { id: body.evidenceDocumentId, tenantId: session.tenantId, deletedAt: null },
    });
    if (!doc) {
      return reply.status(404).send({ error: "Evidence document not found" });
    }
    const vendorIds = await linkedVendorIds(session.tenantId, record.aiSystemId);
    const belongs = doc.aiSystemId === record.aiSystemId || (doc.vendorId !== null && vendorIds.includes(doc.vendorId));
    if (!belongs) {
      return reply.status(400).send({ error: "Evidence must belong to this AI system or one of its linked vendors" });
    }
    if (!isUsableEvidence(doc)) {
      return reply.status(400).send({ error: "Evidence is not usable (quarantined, rejected, failed, or expired)" });
    }
    try {
      const link = await prisma.aiSystemControlEvidence.create({
        data: {
          tenantId: session.tenantId,
          aiSystemControlId: record.id,
          evidenceDocumentId: doc.id,
          submittedByUserId: userId,
          submissionNote: note,
        },
      });
      await audit(session, "ai_control_evidence.submitted", "AiSystemControlEvidence", link.id, {
        aiSystemId: record.aiSystemId,
        aiSystemControlId: record.id,
        evidenceDocumentId: doc.id,
      });
      return reply.status(201).send(link);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return reply.status(409).send({ error: "This evidence is already submitted for this control" });
      }
      throw err;
    }
  });

  // 5. Evidence links, review history and assurance status for one mapped control.
  app.get("/ai-system-controls/:controlRecordId/evidence", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view control evidence" });
    }
    const { controlRecordId } = request.params as { controlRecordId: string };
    const record = await prisma.aiSystemControl.findFirst({
      where: { id: controlRecordId, tenantId: session.tenantId },
      include: { control: { select: { id: true, controlId: true, title: true, summary: true, expectedEvidenceTypes: true } } },
    });
    if (!record) {
      return reply.status(404).send({ error: "AI system control not found" });
    }
    const links = await prisma.aiSystemControlEvidence.findMany({
      where: { tenantId: session.tenantId, aiSystemControlId: record.id },
      orderBy: { submittedAt: "desc" },
      include: {
        evidenceDocument: { select: EVIDENCE_SELECT },
        submittedBy: { select: USER_SELECT },
        reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: USER_SELECT } } },
      },
    });
    return reply.send({
      controlRecord: {
        id: record.id,
        aiSystemId: record.aiSystemId,
        applicability: record.applicability,
        implementationStatus: record.implementationStatus,
        control: record.control,
      },
      assuranceStatus: deriveAssuranceStatus(links.map((link) => link.status)),
      links,
    });
  });

  // 6. Human review: ACCEPT or REJECT a pending evidence link (rationale required, separation of duties).
  app.post("/ai-control-evidence/:linkId/review", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-control-evidence:review")) {
      return reply.status(403).send({ error: "Not authorized to review control evidence" });
    }
    const reviewerUserId = session.userId;
    if (!reviewerUserId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { linkId } = request.params as { linkId: string };
    const body = (request.body ?? {}) as { decision?: unknown; rationale?: unknown };
    if (body.decision !== "ACCEPT" && body.decision !== "REJECT") {
      return reply.status(400).send({ error: "decision must be ACCEPT or REJECT" });
    }
    const decision = body.decision;
    const rationale = cleanText(body.rationale, 2000);
    if (!rationale) {
      return reply.status(400).send({ error: "A rationale (max 2000 characters) is required" });
    }
    const link = await prisma.aiSystemControlEvidence.findFirst({
      where: { id: linkId, tenantId: session.tenantId },
      include: { evidenceDocument: { select: { uploadedByUserId: true } } },
    });
    if (!link) {
      return reply.status(404).send({ error: "Evidence submission not found" });
    }
    if (link.submittedByUserId === reviewerUserId || link.evidenceDocument.uploadedByUserId === reviewerUserId) {
      await audit(session, "ai_control_evidence.review_denied", "AiSystemControlEvidence", link.id, { reason: "separation_of_duties" }, "DENIED");
      return reply.status(403).send({ error: "Separation of duties: you cannot review evidence you submitted or uploaded" });
    }
    if (link.status !== "PENDING_REVIEW") {
      return reply.status(409).send({ error: "Only evidence pending review can be reviewed" });
    }
    const newStatus = decision === "ACCEPT" ? ("ACCEPTED" as const) : ("REJECTED" as const);
    const review = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiSystemControlEvidence.updateMany({
        where: { id: link.id, tenantId: session.tenantId, status: "PENDING_REVIEW" },
        data: { status: newStatus },
      });
      if (updated.count === 0) {
        return null;
      }
      return tx.aiControlEvidenceReview.create({
        data: {
          tenantId: session.tenantId,
          linkId: link.id,
          reviewerUserId,
          decision,
          rationale,
          previousStatus: "PENDING_REVIEW",
          newStatus,
        },
      });
    });
    if (!review) {
      return reply.status(409).send({ error: "This evidence was already reviewed" });
    }
    await audit(session, decision === "ACCEPT" ? "ai_control_evidence.accepted" : "ai_control_evidence.rejected", "AiSystemControlEvidence", link.id, {
      aiSystemControlId: link.aiSystemControlId,
      evidenceDocumentId: link.evidenceDocumentId,
      reviewId: review.id,
    });
    return reply.send({ linkId: link.id, status: newStatus, review });
  });

  // 7. Resubmit rejected evidence -> PENDING_REVIEW again (history is preserved).
  app.post("/ai-control-evidence/:linkId/resubmit", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to resubmit control evidence" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { linkId } = request.params as { linkId: string };
    const body = (request.body ?? {}) as { note?: unknown };
    let note: string | null = null;
    if (body.note !== undefined && body.note !== null && body.note !== "") {
      note = cleanText(body.note, 2000);
      if (!note) {
        return reply.status(400).send({ error: "note must be text of at most 2000 characters" });
      }
    }
    const link = await prisma.aiSystemControlEvidence.findFirst({
      where: { id: linkId, tenantId: session.tenantId },
      include: { evidenceDocument: { select: { state: true, expirationDate: true, deletedAt: true } } },
    });
    if (!link) {
      return reply.status(404).send({ error: "Evidence submission not found" });
    }
    if (link.status !== "REJECTED") {
      return reply.status(409).send({ error: "Only rejected evidence can be resubmitted" });
    }
    if (link.evidenceDocument.deletedAt || !isUsableEvidence(link.evidenceDocument)) {
      return reply.status(400).send({ error: "Evidence is no longer usable" });
    }
    const updated = await prisma.aiSystemControlEvidence.updateMany({
      where: { id: link.id, tenantId: session.tenantId, status: "REJECTED" },
      data: { status: "PENDING_REVIEW", submittedByUserId: userId, submittedAt: new Date(), submissionNote: note },
    });
    if (updated.count === 0) {
      return reply.status(409).send({ error: "This evidence was changed by someone else" });
    }
    await audit(session, "ai_control_evidence.resubmitted", "AiSystemControlEvidence", link.id, {
      aiSystemControlId: link.aiSystemControlId,
      evidenceDocumentId: link.evidenceDocumentId,
    });
    return reply.send({ linkId: link.id, status: "PENDING_REVIEW" });
  });

  // 8. Assurance summary for an AI system (in-scope = every mapped control not marked Not Applicable).
  app.get("/ai-systems/:id/assurance", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view assurance status" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await loadAiSystem(id, session.tenantId);
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const controls = await prisma.aiSystemControl.findMany({
      where: { tenantId: session.tenantId, aiSystemId: aiSystem.id },
      select: { id: true, applicability: true, evidenceLinks: { select: { status: true } } },
    });
    const byControl: Record<string, AssuranceStatus> = {};
    const summary = { inScopeControls: 0, noEvidence: 0, pendingReview: 0, accepted: 0, rejected: 0 };
    for (const control of controls) {
      if (control.applicability === "NOT_APPLICABLE") {
        continue;
      }
      const status = deriveAssuranceStatus(control.evidenceLinks.map((link) => link.status));
      byControl[control.id] = status;
      summary.inScopeControls += 1;
      if (status === "NO_EVIDENCE") {
        summary.noEvidence += 1;
      } else if (status === "PENDING_REVIEW") {
        summary.pendingReview += 1;
      } else if (status === "ACCEPTED") {
        summary.accepted += 1;
      } else {
        summary.rejected += 1;
      }
    }
    return reply.send({ aiSystemId: aiSystem.id, byControl, summary });
  });
}