-- CreateEnum
CREATE TYPE "AiIncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'CLOSED');

-- AlterEnum
ALTER TYPE "AiReassessmentReason" ADD VALUE 'INCIDENT' BEFORE 'PERIODIC_REVIEW';

-- CreateTable
CREATE TABLE "ai_incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "aiUseCaseId" TEXT,
    "monitoringReviewId" TEXT,
    "reassessmentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "ControlSeverity" NOT NULL,
    "status" "AiIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "reporterUserId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "investigationSummary" TEXT,
    "responseSummary" TEXT,
    "followUpPlan" TEXT,
    "closureRationale" TEXT,
    "closureSubmitterUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incident_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "AiAssessmentReviewDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "previousStatus" "AiIncidentStatus" NOT NULL,
    "newStatus" "AiIncidentStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_incident_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incident_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "evidenceDocumentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_incident_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incident_findings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_incident_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_incidents_tenantId_aiSystemId_idx" ON "ai_incidents"("tenantId", "aiSystemId");

-- CreateIndex
CREATE INDEX "ai_incidents_tenantId_status_idx" ON "ai_incidents"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_incidents_tenantId_ownerUserId_idx" ON "ai_incidents"("tenantId", "ownerUserId");

-- CreateIndex
CREATE INDEX "ai_incident_reviews_tenantId_incidentId_idx" ON "ai_incident_reviews"("tenantId", "incidentId");

-- CreateIndex
CREATE INDEX "ai_incident_evidence_tenantId_idx" ON "ai_incident_evidence"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_incident_evidence_incidentId_evidenceDocumentId_key" ON "ai_incident_evidence"("incidentId", "evidenceDocumentId");

-- CreateIndex
CREATE INDEX "ai_incident_findings_tenantId_idx" ON "ai_incident_findings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_incident_findings_incidentId_findingId_key" ON "ai_incident_findings"("incidentId", "findingId");

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_aiUseCaseId_fkey" FOREIGN KEY ("aiUseCaseId") REFERENCES "ai_use_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_monitoringReviewId_fkey" FOREIGN KEY ("monitoringReviewId") REFERENCES "ai_monitoring_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_reassessmentId_fkey" FOREIGN KEY ("reassessmentId") REFERENCES "ai_reassessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incidents" ADD CONSTRAINT "ai_incidents_closureSubmitterUserId_fkey" FOREIGN KEY ("closureSubmitterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incident_reviews" ADD CONSTRAINT "ai_incident_reviews_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ai_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incident_reviews" ADD CONSTRAINT "ai_incident_reviews_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incident_evidence" ADD CONSTRAINT "ai_incident_evidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ai_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incident_evidence" ADD CONSTRAINT "ai_incident_evidence_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "evidence_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incident_findings" ADD CONSTRAINT "ai_incident_findings_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ai_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_incident_findings" ADD CONSTRAINT "ai_incident_findings_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "governance_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
