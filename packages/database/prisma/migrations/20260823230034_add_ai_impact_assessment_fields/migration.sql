-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "decisionAutonomyLevel" DOUBLE PRECISION,
ADD COLUMN     "explainabilityLevel" DOUBLE PRECISION,
ADD COLUMN     "impactBand" "RiskBand",
ADD COLUMN     "impactFactorInputsJson" JSONB,
ADD COLUMN     "impactScore" DOUBLE PRECISION,
ADD COLUMN     "individualsAffectedScale" DOUBLE PRECISION,
ADD COLUMN     "potentialHarmSeverity" DOUBLE PRECISION,
ADD COLUMN     "regulatoryExposureLevel" DOUBLE PRECISION,
ADD COLUMN     "sensitiveDataInvolved" DOUBLE PRECISION;
