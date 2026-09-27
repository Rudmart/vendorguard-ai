-- CreateEnum
CREATE TYPE "GovernanceFindingStatus" AS ENUM ('PENDING_REVIEW', 'OPEN', 'DISMISSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "GovernanceFindingDecision" AS ENUM ('CONFIRM', 'DISMISS');

-- CreateTable
CREATE TABLE "governance_findings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiControlTestId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "ControlSeverity" NOT NULL,
    "status" "GovernanceFindingStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "ownerUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_finding_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "GovernanceFindingDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "previousStatus" "GovernanceFindingStatus" NOT NULL,
    "newStatus" "GovernanceFindingStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_finding_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "governance_findings_aiControlTestId_key" ON "governance_findings"("aiControlTestId");

-- CreateIndex
CREATE INDEX "governance_findings_tenantId_idx" ON "governance_findings"("tenantId");

-- CreateIndex
CREATE INDEX "governance_findings_tenantId_status_idx" ON "governance_findings"("tenantId", "status");

-- CreateIndex
CREATE INDEX "governance_finding_reviews_tenantId_idx" ON "governance_finding_reviews"("tenantId");

-- CreateIndex
CREATE INDEX "governance_finding_reviews_findingId_idx" ON "governance_finding_reviews"("findingId");

-- AddForeignKey
ALTER TABLE "governance_findings" ADD CONSTRAINT "governance_findings_aiControlTestId_fkey" FOREIGN KEY ("aiControlTestId") REFERENCES "ai_control_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_findings" ADD CONSTRAINT "governance_findings_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_findings" ADD CONSTRAINT "governance_findings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_finding_reviews" ADD CONSTRAINT "governance_finding_reviews_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "governance_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_finding_reviews" ADD CONSTRAINT "governance_finding_reviews_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
