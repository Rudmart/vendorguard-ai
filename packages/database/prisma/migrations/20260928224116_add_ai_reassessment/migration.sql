/*
  Warnings:

  - A unique constraint covering the columns `[aiSystemId,version]` on the table `ai_risk_assessments` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AiReassessmentReason" AS ENUM ('PERIODIC_REVIEW', 'MATERIAL_CHANGE', 'REMEDIATION_COMPLETED', 'RISK_ACCEPTANCE_REVIEW', 'REGULATORY_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "AiReassessmentStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AiReassessmentConclusion" AS ENUM ('NO_MATERIAL_CHANGE', 'GOVERNANCE_UPDATED', 'FOLLOW_UP_REQUIRED');

-- CreateTable
CREATE TABLE "ai_reassessments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "reason" "AiReassessmentReason" NOT NULL,
    "status" "AiReassessmentStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "openCycleKey" TEXT,
    "whatChanged" TEXT NOT NULL,
    "materialChange" BOOLEAN NOT NULL DEFAULT false,
    "materialChangeDescription" TEXT,
    "targetDate" TIMESTAMP(3),
    "priorRiskAssessmentId" TEXT,
    "priorImpactAssessmentId" TEXT,
    "newRiskAssessmentId" TEXT,
    "newImpactAssessmentId" TEXT,
    "relatedRiskAcceptanceId" TEXT,
    "snapshotAtStart" JSONB NOT NULL,
    "snapshotAtCompletion" JSONB,
    "conclusion" "AiReassessmentConclusion",
    "conclusionRationale" TEXT,
    "initiatedByUserId" TEXT NOT NULL,
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_reassessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_reassessments_openCycleKey_key" ON "ai_reassessments"("openCycleKey");

-- CreateIndex
CREATE INDEX "ai_reassessments_tenantId_idx" ON "ai_reassessments"("tenantId");

-- CreateIndex
CREATE INDEX "ai_reassessments_tenantId_aiSystemId_idx" ON "ai_reassessments"("tenantId", "aiSystemId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_risk_assessments_aiSystemId_version_key" ON "ai_risk_assessments"("aiSystemId", "version");

-- AddForeignKey
ALTER TABLE "ai_reassessments" ADD CONSTRAINT "ai_reassessments_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reassessments" ADD CONSTRAINT "ai_reassessments_priorRiskAssessmentId_fkey" FOREIGN KEY ("priorRiskAssessmentId") REFERENCES "ai_risk_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reassessments" ADD CONSTRAINT "ai_reassessments_newRiskAssessmentId_fkey" FOREIGN KEY ("newRiskAssessmentId") REFERENCES "ai_risk_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reassessments" ADD CONSTRAINT "ai_reassessments_priorImpactAssessmentId_fkey" FOREIGN KEY ("priorImpactAssessmentId") REFERENCES "ai_impact_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reassessments" ADD CONSTRAINT "ai_reassessments_newImpactAssessmentId_fkey" FOREIGN KEY ("newImpactAssessmentId") REFERENCES "ai_impact_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reassessments" ADD CONSTRAINT "ai_reassessments_relatedRiskAcceptanceId_fkey" FOREIGN KEY ("relatedRiskAcceptanceId") REFERENCES "risk_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
