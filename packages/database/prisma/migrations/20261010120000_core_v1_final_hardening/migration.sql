-- AlterTable
ALTER TABLE "control_findings" ADD COLUMN     "proposedByUserId" TEXT,
ADD COLUMN     "proposedStatus" "FindingStatus";

-- CreateTable
CREATE TABLE "stored_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "stored_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "useCaseId" TEXT,
    "riskAssessmentId" TEXT,
    "impactAssessmentId" TEXT,
    "decision" "AiAssessmentReviewDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "version" INTEGER,
    "context" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stored_sessions_tenantId_userId_idx" ON "stored_sessions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "stored_sessions_expiresAt_idx" ON "stored_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "governance_decisions_correlationId_key" ON "governance_decisions"("correlationId");

-- CreateIndex
CREATE INDEX "governance_decisions_tenantId_useCaseId_idx" ON "governance_decisions"("tenantId", "useCaseId");

-- CreateIndex
CREATE INDEX "governance_decisions_tenantId_riskAssessmentId_idx" ON "governance_decisions"("tenantId", "riskAssessmentId");

-- CreateIndex
CREATE INDEX "governance_decisions_tenantId_impactAssessmentId_idx" ON "governance_decisions"("tenantId", "impactAssessmentId");

-- AddForeignKey
ALTER TABLE "control_findings" ADD CONSTRAINT "control_findings_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_sessions" ADD CONSTRAINT "stored_sessions_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "tenant_memberships"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_decisions" ADD CONSTRAINT "governance_decisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_decisions" ADD CONSTRAINT "governance_decisions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_decisions" ADD CONSTRAINT "governance_decisions_useCaseId_fkey" FOREIGN KEY ("useCaseId") REFERENCES "ai_use_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_decisions" ADD CONSTRAINT "governance_decisions_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "ai_risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_decisions" ADD CONSTRAINT "governance_decisions_impactAssessmentId_fkey" FOREIGN KEY ("impactAssessmentId") REFERENCES "ai_impact_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE governance_decisions ADD CONSTRAINT governance_decision_one_parent CHECK (num_nonnulls("useCaseId", "riskAssessmentId", "impactAssessmentId") = 1);
CREATE FUNCTION protect_governance_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Governance decisions are append-only';
END;
$$;
CREATE TRIGGER governance_decisions_append_only BEFORE UPDATE OR DELETE ON governance_decisions FOR EACH ROW EXECUTE FUNCTION protect_governance_decision();
