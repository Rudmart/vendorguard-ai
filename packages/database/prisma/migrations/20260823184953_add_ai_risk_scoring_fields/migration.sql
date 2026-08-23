-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "aiControlEffectiveness" DOUBLE PRECISION,
ADD COLUMN     "aiFactorInputsJson" JSONB,
ADD COLUMN     "aiInherentScore" DOUBLE PRECISION,
ADD COLUMN     "aiResidualScore" DOUBLE PRECISION,
ADD COLUMN     "aiRiskBand" "RiskBand";
