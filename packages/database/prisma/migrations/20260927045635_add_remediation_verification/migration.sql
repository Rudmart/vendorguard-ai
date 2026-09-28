/*
  Warnings:

  - A unique constraint covering the columns `[governanceFindingId]` on the table `remediation_actions` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "RemediationVerificationDecision" AS ENUM ('VERIFIED', 'REJECTED');

-- AlterEnum
ALTER TYPE "RemediationStatus" ADD VALUE 'PENDING_VERIFICATION';

-- AlterTable
ALTER TABLE "remediation_actions" ADD COLUMN     "governanceFindingId" TEXT;

-- CreateTable
CREATE TABLE "remediation_verifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "remediationId" TEXT NOT NULL,
    "verifierUserId" TEXT NOT NULL,
    "decision" "RemediationVerificationDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "previousStatus" "RemediationStatus" NOT NULL,
    "newStatus" "RemediationStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remediation_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remediation_verifications_tenantId_idx" ON "remediation_verifications"("tenantId");

-- CreateIndex
CREATE INDEX "remediation_verifications_remediationId_idx" ON "remediation_verifications"("remediationId");

-- CreateIndex
CREATE UNIQUE INDEX "remediation_actions_governanceFindingId_key" ON "remediation_actions"("governanceFindingId");

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_governanceFindingId_fkey" FOREIGN KEY ("governanceFindingId") REFERENCES "governance_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_verifications" ADD CONSTRAINT "remediation_verifications_remediationId_fkey" FOREIGN KEY ("remediationId") REFERENCES "remediation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_verifications" ADD CONSTRAINT "remediation_verifications_verifierUserId_fkey" FOREIGN KEY ("verifierUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
