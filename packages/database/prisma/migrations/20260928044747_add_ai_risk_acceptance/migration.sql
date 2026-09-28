-- CreateEnum
CREATE TYPE "RiskAcceptanceStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "risk_acceptances" ADD COLUMN     "aiRiskId" TEXT,
ADD COLUMN     "conditions" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByUserId" TEXT,
ADD COLUMN     "decisionRationale" TEXT,
ADD COLUMN     "governanceFindingId" TEXT,
ADD COLUMN     "requestedByUserId" TEXT,
ADD COLUMN     "residualRatingAtRequest" "RiskBand",
ADD COLUMN     "residualRiskStatement" TEXT,
ADD COLUMN     "residualScoreAtRequest" INTEGER,
ADD COLUMN     "status" "RiskAcceptanceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
ALTER COLUMN "vendorId" DROP NOT NULL,
ALTER COLUMN "approvedByUserId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "risk_acceptances_tenantId_aiRiskId_idx" ON "risk_acceptances"("tenantId", "aiRiskId");

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_aiRiskId_fkey" FOREIGN KEY ("aiRiskId") REFERENCES "ai_risks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_governanceFindingId_fkey" FOREIGN KEY ("governanceFindingId") REFERENCES "governance_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
