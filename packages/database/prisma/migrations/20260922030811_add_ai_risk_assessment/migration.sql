-- CreateEnum
CREATE TYPE "AiRiskAssessmentStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AiRiskCategory" AS ENUM ('DATA', 'PRIVACY', 'FAIRNESS', 'TRANSPARENCY', 'RELIABILITY', 'SAFETY', 'SECURITY', 'HUMAN_OVERSIGHT', 'THIRD_PARTY', 'LEGAL_COMPLIANCE', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "AiControlEffectiveness" AS ENUM ('NOT_ASSESSED', 'INEFFECTIVE', 'PARTIALLY_EFFECTIVE', 'EFFECTIVE');

-- CreateEnum
CREATE TYPE "AiRiskTreatment" AS ENUM ('ACCEPT', 'MITIGATE', 'AVOID', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AiAssessmentReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- AlterTable
ALTER TABLE "remediation_actions" ADD COLUMN     "aiRiskId" TEXT,
ALTER COLUMN "vendorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ai_risk_assessments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AiRiskAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "assessorUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewerUserId" TEXT,
    "reviewDecision" "AiAssessmentReviewDecision",
    "reviewRationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_risks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "AiRiskCategory" NOT NULL,
    "statement" TEXT NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "inherentScore" INTEGER NOT NULL,
    "inherentRating" "RiskBand" NOT NULL,
    "existingControls" TEXT,
    "controlId" TEXT,
    "controlEffectiveness" "AiControlEffectiveness" NOT NULL DEFAULT 'NOT_ASSESSED',
    "residualLikelihood" INTEGER,
    "residualImpact" INTEGER,
    "residualScore" INTEGER,
    "residualRating" "RiskBand",
    "treatment" "AiRiskTreatment",
    "treatmentRationale" TEXT,
    "treatmentOwnerUserId" TEXT,
    "treatmentTargetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_risks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_risk_assessments_tenantId_idx" ON "ai_risk_assessments"("tenantId");

-- CreateIndex
CREATE INDEX "ai_risk_assessments_tenantId_aiSystemId_idx" ON "ai_risk_assessments"("tenantId", "aiSystemId");

-- CreateIndex
CREATE INDEX "ai_risk_assessments_tenantId_status_idx" ON "ai_risk_assessments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_risks_tenantId_idx" ON "ai_risks"("tenantId");

-- CreateIndex
CREATE INDEX "ai_risks_tenantId_assessmentId_idx" ON "ai_risks"("tenantId", "assessmentId");

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_aiRiskId_fkey" FOREIGN KEY ("aiRiskId") REFERENCES "ai_risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_assessorUserId_fkey" FOREIGN KEY ("assessorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risk_assessments" ADD CONSTRAINT "ai_risk_assessments_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ai_risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_risks" ADD CONSTRAINT "ai_risks_treatmentOwnerUserId_fkey" FOREIGN KEY ("treatmentOwnerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
