-- CreateEnum
CREATE TYPE "AiUseCaseStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SUSPENDED', 'RETIRED');

-- CreateTable
CREATE TABLE "ai_use_cases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessPurpose" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT,
    "department" TEXT,
    "intendedUsers" TEXT,
    "affectedParties" TEXT[],
    "decisionRole" "AiSystemDecisionRole",
    "humanOversight" "AiSystemHumanOversight",
    "dataSensitivity" "AiSystemDataSensitivity",
    "status" "AiUseCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewerUserId" TEXT,
    "reviewDecision" "AiAssessmentReviewDecision",
    "reviewRationale" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_use_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_use_cases_tenantId_idx" ON "ai_use_cases"("tenantId");

-- CreateIndex
CREATE INDEX "ai_use_cases_tenantId_aiSystemId_idx" ON "ai_use_cases"("tenantId", "aiSystemId");

-- CreateIndex
CREATE INDEX "ai_use_cases_tenantId_status_idx" ON "ai_use_cases"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_use_cases" ADD CONSTRAINT "ai_use_cases_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
