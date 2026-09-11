-- CreateEnum
CREATE TYPE "ControlSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "controls" ADD COLUMN     "severity" "ControlSeverity" NOT NULL DEFAULT 'MEDIUM';
