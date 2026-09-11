-- CreateEnum
CREATE TYPE "ImpactType" AS ENUM ('REGULATORY', 'FINANCIAL', 'SECURITY', 'OPERATIONAL');

-- AlterTable
ALTER TABLE "controls" ADD COLUMN     "impactType" "ImpactType" NOT NULL DEFAULT 'OPERATIONAL';
