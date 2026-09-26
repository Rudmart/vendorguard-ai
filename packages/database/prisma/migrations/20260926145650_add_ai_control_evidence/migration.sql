-- CreateEnum
CREATE TYPE "AiControlEvidenceStatus" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiControlEvidenceDecision" AS ENUM ('ACCEPT', 'REJECT');

-- AlterTable
ALTER TABLE "evidence_documents" ADD COLUMN     "aiSystemId" TEXT,
ALTER COLUMN "vendorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ai_system_control_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemControlId" TEXT NOT NULL,
    "evidenceDocumentId" TEXT NOT NULL,
    "status" "AiControlEvidenceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "submissionNote" TEXT,
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_system_control_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_control_evidence_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "AiControlEvidenceDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "previousStatus" "AiControlEvidenceStatus" NOT NULL,
    "newStatus" "AiControlEvidenceStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_control_evidence_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_system_control_evidence_tenantId_idx" ON "ai_system_control_evidence"("tenantId");

-- CreateIndex
CREATE INDEX "ai_system_control_evidence_tenantId_aiSystemControlId_idx" ON "ai_system_control_evidence"("tenantId", "aiSystemControlId");

-- CreateIndex
CREATE INDEX "ai_system_control_evidence_tenantId_status_idx" ON "ai_system_control_evidence"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_control_evidence_aiSystemControlId_evidenceDocume_key" ON "ai_system_control_evidence"("aiSystemControlId", "evidenceDocumentId");

-- CreateIndex
CREATE INDEX "ai_control_evidence_reviews_tenantId_idx" ON "ai_control_evidence_reviews"("tenantId");

-- CreateIndex
CREATE INDEX "ai_control_evidence_reviews_linkId_idx" ON "ai_control_evidence_reviews"("linkId");

-- CreateIndex
CREATE INDEX "evidence_documents_tenantId_aiSystemId_idx" ON "evidence_documents"("tenantId", "aiSystemId");

-- AddForeignKey
ALTER TABLE "evidence_documents" ADD CONSTRAINT "evidence_documents_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_control_evidence" ADD CONSTRAINT "ai_system_control_evidence_aiSystemControlId_fkey" FOREIGN KEY ("aiSystemControlId") REFERENCES "ai_system_controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_control_evidence" ADD CONSTRAINT "ai_system_control_evidence_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "evidence_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_control_evidence" ADD CONSTRAINT "ai_system_control_evidence_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_evidence_reviews" ADD CONSTRAINT "ai_control_evidence_reviews_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ai_system_control_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_evidence_reviews" ADD CONSTRAINT "ai_control_evidence_reviews_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
