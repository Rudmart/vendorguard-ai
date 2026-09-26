-- CreateEnum
CREATE TYPE "AiControlTestMethod" AS ENUM ('DOCUMENT_REVIEW', 'INTERVIEW', 'OBSERVATION', 'SAMPLE_TESTING', 'CONFIGURATION_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "AiControlTestStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ai_control_tests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemControlId" TEXT NOT NULL,
    "testerUserId" TEXT NOT NULL,
    "status" "AiControlTestStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "method" "AiControlTestMethod" NOT NULL,
    "procedure" TEXT NOT NULL,
    "testDate" TIMESTAMP(3),
    "sampleSize" INTEGER,
    "exceptionsFound" INTEGER,
    "designEffectiveness" "AiControlEffectiveness" NOT NULL DEFAULT 'NOT_ASSESSED',
    "operatingEffectiveness" "AiControlEffectiveness" NOT NULL DEFAULT 'NOT_ASSESSED',
    "overallEffectiveness" "AiControlEffectiveness" NOT NULL DEFAULT 'NOT_ASSESSED',
    "conclusionRationale" TEXT,
    "nextTestDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_control_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_control_test_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "evidenceLinkId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_control_test_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_control_tests_tenantId_idx" ON "ai_control_tests"("tenantId");

-- CreateIndex
CREATE INDEX "ai_control_tests_tenantId_aiSystemControlId_idx" ON "ai_control_tests"("tenantId", "aiSystemControlId");

-- CreateIndex
CREATE INDEX "ai_control_tests_tenantId_status_idx" ON "ai_control_tests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_control_test_evidence_tenantId_idx" ON "ai_control_test_evidence"("tenantId");

-- CreateIndex
CREATE INDEX "ai_control_test_evidence_testId_idx" ON "ai_control_test_evidence"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_control_test_evidence_testId_evidenceLinkId_key" ON "ai_control_test_evidence"("testId", "evidenceLinkId");

-- AddForeignKey
ALTER TABLE "ai_control_tests" ADD CONSTRAINT "ai_control_tests_aiSystemControlId_fkey" FOREIGN KEY ("aiSystemControlId") REFERENCES "ai_system_controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_tests" ADD CONSTRAINT "ai_control_tests_testerUserId_fkey" FOREIGN KEY ("testerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_test_evidence" ADD CONSTRAINT "ai_control_test_evidence_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ai_control_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_test_evidence" ADD CONSTRAINT "ai_control_test_evidence_evidenceLinkId_fkey" FOREIGN KEY ("evidenceLinkId") REFERENCES "ai_system_control_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_control_test_evidence" ADD CONSTRAINT "ai_control_test_evidence_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
