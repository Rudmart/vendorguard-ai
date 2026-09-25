-- CreateEnum
CREATE TYPE "AiImpactCategory" AS ENUM ('FAIRNESS', 'PRIVACY', 'INDIVIDUAL_RIGHTS', 'ACCESSIBILITY', 'SAFETY', 'HUMAN_AUTONOMY', 'TRANSPARENCY', 'ECONOMIC', 'OPERATIONAL', 'SOCIETAL');

-- CreateEnum
CREATE TYPE "AiImpactDirection" AS ENUM ('BENEFICIAL', 'ADVERSE');

-- CreateEnum
CREATE TYPE "AiImpactScale" AS ENUM ('LIMITED', 'MODERATE', 'BROAD', 'MASS');

-- CreateEnum
CREATE TYPE "AiImpactReversibility" AS ENUM ('REVERSIBLE', 'PARTIALLY_REVERSIBLE', 'DIFFICULT_TO_REVERSE', 'IRREVERSIBLE');

-- CreateTable
CREATE TABLE "ai_impact_assessments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AiRiskAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "assessorUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewerUserId" TEXT,
    "reviewDecision" "AiAssessmentReviewDecision",
    "reviewRationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_impact_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_impacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "AiImpactCategory" NOT NULL,
    "direction" "AiImpactDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "affectedPopulation" TEXT NOT NULL,
    "affectedGroupDescription" TEXT,
    "severity" INTEGER NOT NULL,
    "scale" "AiImpactScale" NOT NULL,
    "reversibility" "AiImpactReversibility" NOT NULL,
    "vulnerablePopulations" BOOLEAN NOT NULL DEFAULT false,
    "vulnerablePopulationsExplanation" TEXT,
    "oversightRequirement" "AiSystemHumanOversight",
    "oversightDescription" TEXT,
    "escalationMechanism" TEXT,
    "humanCanOverride" BOOLEAN,
    "safeguards" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_impacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_impact_assessments_tenantId_idx" ON "ai_impact_assessments"("tenantId");

-- CreateIndex
CREATE INDEX "ai_impact_assessments_tenantId_aiSystemId_idx" ON "ai_impact_assessments"("tenantId", "aiSystemId");

-- CreateIndex
CREATE INDEX "ai_impact_assessments_tenantId_status_idx" ON "ai_impact_assessments"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_impact_assessments_aiSystemId_version_key" ON "ai_impact_assessments"("aiSystemId", "version");

-- CreateIndex
CREATE INDEX "ai_impacts_tenantId_idx" ON "ai_impacts"("tenantId");

-- CreateIndex
CREATE INDEX "ai_impacts_tenantId_assessmentId_idx" ON "ai_impacts"("tenantId", "assessmentId");

-- AddForeignKey
ALTER TABLE "ai_impact_assessments" ADD CONSTRAINT "ai_impact_assessments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_impact_assessments" ADD CONSTRAINT "ai_impact_assessments_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_impact_assessments" ADD CONSTRAINT "ai_impact_assessments_assessorUserId_fkey" FOREIGN KEY ("assessorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_impact_assessments" ADD CONSTRAINT "ai_impact_assessments_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_impacts" ADD CONSTRAINT "ai_impacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_impacts" ADD CONSTRAINT "ai_impacts_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ai_impact_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
