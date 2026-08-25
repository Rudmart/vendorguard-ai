-- CreateTable
CREATE TABLE "risk_ratings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "inherentScore" DOUBLE PRECISION NOT NULL,
    "controlEffectiveness" DOUBLE PRECISION NOT NULL,
    "residualScore" DOUBLE PRECISION NOT NULL,
    "finalRating" "RiskBand" NOT NULL,
    "factorInputsJson" JSONB NOT NULL,
    "weightsUsedJson" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_ratings_tenantId_idx" ON "risk_ratings"("tenantId");

-- CreateIndex
CREATE INDEX "risk_ratings_assessmentId_idx" ON "risk_ratings"("assessmentId");

-- AddForeignKey
ALTER TABLE "risk_ratings" ADD CONSTRAINT "risk_ratings_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
