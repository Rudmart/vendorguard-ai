-- CreateEnum
CREATE TYPE "AiSystemOrigin" AS ENUM ('INTERNAL', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "AiSystemCategory" AS ENUM ('GENERATIVE', 'PREDICTIVE_ML', 'DECISION_SUPPORT', 'EMBEDDED', 'AGENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AiSystemLifecycleStatus" AS ENUM ('PROPOSED', 'DEVELOPMENT', 'TESTING', 'ASSESSMENT', 'PENDING_APPROVAL', 'APPROVED', 'PRODUCTION', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AiSystemVendorRole" AS ENUM ('PRIMARY_PROVIDER', 'MODEL_PROVIDER', 'PLATFORM_PROVIDER', 'AI_SERVICE_PROVIDER', 'DATA_PROVIDER', 'DEVELOPMENT_PROVIDER', 'OTHER');

-- CreateTable
CREATE TABLE "ai_systems" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "origin" "AiSystemOrigin" NOT NULL,
    "category" "AiSystemCategory" NOT NULL DEFAULT 'OTHER',
    "lifecycleStatus" "AiSystemLifecycleStatus" NOT NULL DEFAULT 'PROPOSED',
    "ownerUserId" TEXT,
    "dataCategories" TEXT[],
    "riskTier" "RiskBand",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_system_vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "role" "AiSystemVendorRole" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_system_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_systems_tenantId_idx" ON "ai_systems"("tenantId");

-- CreateIndex
CREATE INDEX "ai_systems_tenantId_lifecycleStatus_idx" ON "ai_systems"("tenantId", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "ai_systems_tenantId_riskTier_idx" ON "ai_systems"("tenantId", "riskTier");

-- CreateIndex
CREATE INDEX "ai_systems_tenantId_origin_idx" ON "ai_systems"("tenantId", "origin");

-- CreateIndex
CREATE INDEX "ai_system_vendors_tenantId_idx" ON "ai_system_vendors"("tenantId");

-- CreateIndex
CREATE INDEX "ai_system_vendors_aiSystemId_idx" ON "ai_system_vendors"("aiSystemId");

-- CreateIndex
CREATE INDEX "ai_system_vendors_vendorId_idx" ON "ai_system_vendors"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_system_vendors_aiSystemId_vendorId_role_key" ON "ai_system_vendors"("aiSystemId", "vendorId", "role");

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_vendors" ADD CONSTRAINT "ai_system_vendors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_vendors" ADD CONSTRAINT "ai_system_vendors_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_system_vendors" ADD CONSTRAINT "ai_system_vendors_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
