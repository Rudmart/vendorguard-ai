-- CreateEnum
CREATE TYPE "AiMonitoringCategory" AS ENUM ('HUMAN_OVERSIGHT', 'USE_AND_SCOPE', 'OUTCOMES_PERFORMANCE', 'FAIRNESS', 'COMPLAINTS_FEEDBACK', 'CONTROL_OPERATION', 'REGULATORY', 'OTHER');

-- CreateEnum
CREATE TYPE "AiMonitoringCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "AiMonitoringResult" AS ENUM ('ACCEPTABLE', 'ATTENTION_REQUIRED', 'REASSESSMENT_REQUIRED');

-- AlterEnum
ALTER TYPE "AiReassessmentReason" ADD VALUE 'MONITORING_REVIEW';

-- CreateTable
CREATE TABLE "ai_monitoring_checks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "whatToReview" TEXT NOT NULL,
    "expectation" TEXT NOT NULL,
    "category" "AiMonitoringCategory" NOT NULL,
    "cadence" "AiMonitoringCadence" NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_monitoring_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_monitoring_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodCovered" TEXT,
    "observation" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION,
    "unit" TEXT,
    "result" "AiMonitoringResult" NOT NULL,
    "rationale" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "reassessmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_monitoring_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_monitoring_checks_tenantId_idx" ON "ai_monitoring_checks"("tenantId");

-- CreateIndex
CREATE INDEX "ai_monitoring_checks_tenantId_aiSystemId_idx" ON "ai_monitoring_checks"("tenantId", "aiSystemId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_monitoring_reviews_reassessmentId_key" ON "ai_monitoring_reviews"("reassessmentId");

-- CreateIndex
CREATE INDEX "ai_monitoring_reviews_tenantId_idx" ON "ai_monitoring_reviews"("tenantId");

-- CreateIndex
CREATE INDEX "ai_monitoring_reviews_tenantId_checkId_idx" ON "ai_monitoring_reviews"("tenantId", "checkId");

-- AddForeignKey
ALTER TABLE "ai_monitoring_checks" ADD CONSTRAINT "ai_monitoring_checks_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_monitoring_reviews" ADD CONSTRAINT "ai_monitoring_reviews_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ai_monitoring_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_monitoring_reviews" ADD CONSTRAINT "ai_monitoring_reviews_reassessmentId_fkey" FOREIGN KEY ("reassessmentId") REFERENCES "ai_reassessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
