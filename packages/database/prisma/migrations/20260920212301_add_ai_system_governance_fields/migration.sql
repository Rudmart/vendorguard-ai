-- CreateEnum
CREATE TYPE "AiSystemBusinessCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AiSystemDecisionRole" AS ENUM ('ADVISORY', 'RECOMMENDS', 'DECIDES', 'EXECUTES');

-- CreateEnum
CREATE TYPE "AiSystemHumanOversight" AS ENUM ('REQUIRED', 'OPTIONAL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "AiSystemImpactLevel" AS ENUM ('LOW', 'MODERATE', 'HIGH');

-- CreateEnum
CREATE TYPE "AiSystemDataSensitivity" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "AiSystemAssessmentStatus" AS ENUM ('NOT_ASSESSED', 'ASSESSMENT_REQUIRED', 'ASSESSED');

-- AlterTable
ALTER TABLE "ai_systems" ADD COLUMN     "affectedPopulation" TEXT[],
ADD COLUMN     "assessmentStatus" "AiSystemAssessmentStatus" NOT NULL DEFAULT 'NOT_ASSESSED',
ADD COLUMN     "businessCriticality" "AiSystemBusinessCriticality",
ADD COLUMN     "dataSensitivity" "AiSystemDataSensitivity",
ADD COLUMN     "decisionRole" "AiSystemDecisionRole",
ADD COLUMN     "externalImpact" BOOLEAN,
ADD COLUMN     "humanOversight" "AiSystemHumanOversight",
ADD COLUMN     "impactLevel" "AiSystemImpactLevel",
ADD COLUMN     "regulatoryRelevance" TEXT[];
