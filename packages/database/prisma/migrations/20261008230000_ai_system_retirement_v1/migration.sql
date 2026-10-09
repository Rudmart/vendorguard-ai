-- CreateEnum
CREATE TYPE "AiSystemRetirementStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiSystemRetirementReason" AS ENUM ('REPLACED', 'NO_LONGER_NEEDED', 'RISK_OR_COMPLIANCE', 'VENDOR_SERVICE_ENDED', 'OTHER');

-- AlterTable
ALTER TABLE "ai_systems" ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ai_system_retirements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "status" "AiSystemRetirementStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "activeRequestKey" TEXT,
    "requesterUserId" TEXT NOT NULL,
    "submitterUserId" TEXT,
    "ownerAtSubmissionUserId" TEXT,
    "reason" "AiSystemRetirementReason" NOT NULL,
    "businessJustification" TEXT NOT NULL,
    "requestedRetirementDate" TIMESTAMP(3) NOT NULL,
    "cessationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "cessationNotApplicableReason" TEXT,
    "useCaseDisposition" TEXT NOT NULL,
    "monitoringDisposition" TEXT NOT NULL,
    "retentionStatement" TEXT NOT NULL,
    "warningDispositions" JSONB NOT NULL DEFAULT '[]',
    "readinessSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationRationale" TEXT,

    CONSTRAINT "ai_system_retirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_retirement_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "retirementId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "AiAssessmentReviewDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "previousStatus" "AiSystemRetirementStatus" NOT NULL,
    "newStatus" "AiSystemRetirementStatus" NOT NULL,
    "reviewedSnapshot" JSONB NOT NULL,
    "acknowledgedWarningKeys" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_system_retirement_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_retirement_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "retirementId" TEXT NOT NULL,
    "evidenceDocumentId" TEXT NOT NULL,
    "linkedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_system_retirement_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_retirements_activeRequestKey_key" ON "ai_system_retirements"("activeRequestKey");

-- CreateIndex
CREATE INDEX "ai_system_retirements_tenantId_aiSystemId_idx" ON "ai_system_retirements"("tenantId", "aiSystemId");

-- CreateIndex
CREATE INDEX "ai_system_retirements_tenantId_status_idx" ON "ai_system_retirements"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_system_retirement_reviews_tenantId_retirementId_idx" ON "ai_system_retirement_reviews"("tenantId", "retirementId");

-- CreateIndex
CREATE INDEX "ai_system_retirement_evidence_tenantId_idx" ON "ai_system_retirement_evidence"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_retirement_evidence_retirementId_evidenceDocument_key" ON "ai_system_retirement_evidence"("retirementId", "evidenceDocumentId");

-- AddForeignKey
ALTER TABLE "ai_system_retirements" ADD CONSTRAINT "ai_system_retirements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirements" ADD CONSTRAINT "ai_system_retirements_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirements" ADD CONSTRAINT "ai_system_retirements_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirements" ADD CONSTRAINT "ai_system_retirements_submitterUserId_fkey" FOREIGN KEY ("submitterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirements" ADD CONSTRAINT "ai_system_retirements_ownerAtSubmissionUserId_fkey" FOREIGN KEY ("ownerAtSubmissionUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirement_reviews" ADD CONSTRAINT "ai_system_retirement_reviews_retirementId_fkey" FOREIGN KEY ("retirementId") REFERENCES "ai_system_retirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirement_reviews" ADD CONSTRAINT "ai_system_retirement_reviews_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirement_evidence" ADD CONSTRAINT "ai_system_retirement_evidence_retirementId_fkey" FOREIGN KEY ("retirementId") REFERENCES "ai_system_retirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirement_evidence" ADD CONSTRAINT "ai_system_retirement_evidence_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "evidence_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_retirement_evidence" ADD CONSTRAINT "ai_system_retirement_evidence_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
