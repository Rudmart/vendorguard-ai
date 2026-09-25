-- CreateEnum
CREATE TYPE "AiFrameworkApplicabilityStatus" AS ENUM ('APPLICABLE', 'PARTIALLY_APPLICABLE', 'NOT_APPLICABLE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AiControlApplicability" AS ENUM ('NOT_ASSESSED', 'APPLICABLE', 'PARTIALLY_APPLICABLE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "AiControlImplementationStatus" AS ENUM ('NOT_STARTED', 'PLANNED', 'IMPLEMENTED');

-- CreateTable
CREATE TABLE "ai_system_framework_applicability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "status" "AiFrameworkApplicabilityStatus" NOT NULL,
    "rationale" TEXT NOT NULL,
    "determinedByUserId" TEXT,
    "determinedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_system_framework_applicability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_controls" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "sourceApplicabilityId" TEXT NOT NULL,
    "applicability" "AiControlApplicability" NOT NULL DEFAULT 'NOT_ASSESSED',
    "rationale" TEXT,
    "ownerUserId" TEXT,
    "implementationStatus" "AiControlImplementationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "mappedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_system_controls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_system_framework_applicability_tenantId_idx" ON "ai_system_framework_applicability"("tenantId");

-- CreateIndex
CREATE INDEX "ai_system_framework_applicability_tenantId_aiSystemId_idx" ON "ai_system_framework_applicability"("tenantId", "aiSystemId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_framework_applicability_aiSystemId_frameworkId_key" ON "ai_system_framework_applicability"("aiSystemId", "frameworkId");

-- CreateIndex
CREATE INDEX "ai_system_controls_tenantId_idx" ON "ai_system_controls"("tenantId");

-- CreateIndex
CREATE INDEX "ai_system_controls_tenantId_aiSystemId_idx" ON "ai_system_controls"("tenantId", "aiSystemId");

-- CreateIndex
CREATE INDEX "ai_system_controls_tenantId_ownerUserId_idx" ON "ai_system_controls"("tenantId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_controls_aiSystemId_controlId_key" ON "ai_system_controls"("aiSystemId", "controlId");

-- AddForeignKey
ALTER TABLE "ai_system_framework_applicability" ADD CONSTRAINT "ai_system_framework_applicability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_framework_applicability" ADD CONSTRAINT "ai_system_framework_applicability_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_framework_applicability" ADD CONSTRAINT "ai_system_framework_applicability_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_framework_applicability" ADD CONSTRAINT "ai_system_framework_applicability_determinedByUserId_fkey" FOREIGN KEY ("determinedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_sourceApplicabilityId_fkey" FOREIGN KEY ("sourceApplicabilityId") REFERENCES "ai_system_framework_applicability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_mappedByUserId_fkey" FOREIGN KEY ("mappedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
