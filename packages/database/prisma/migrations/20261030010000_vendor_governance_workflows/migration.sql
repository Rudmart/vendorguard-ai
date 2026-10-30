-- Additive only. Historical acceptance attribution and decisions are not backfilled.
ALTER TABLE "risk_acceptances" ADD COLUMN "vendorFindingId" TEXT,
 ADD COLUMN "vendorRiskSnapshot" JSONB, ADD COLUMN "vendorRiskContextHash" TEXT;
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_vendorFindingId_fkey"
 FOREIGN KEY ("vendorFindingId") REFERENCES "control_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "vendor_reassessments" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "vendorId" TEXT NOT NULL REFERENCES "vendors"("id") ON DELETE CASCADE,
 "priorAssessmentId" TEXT NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT,
 "newAssessmentId" TEXT NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT,
 "activeKey" TEXT, "trigger" TEXT NOT NULL, "rationale" TEXT NOT NULL CHECK (length(btrim("rationale")) > 0),
 "materialChanges" TEXT NOT NULL CHECK (length(btrim("materialChanges")) > 0), "targetDate" TIMESTAMP(3),
 "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK ("status" IN ('IN_PROGRESS','COMPLETED')),
 "startedByUserId" TEXT NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedByUserId" TEXT, "completedAt" TIMESTAMP(3), "conclusion" TEXT, "priorSnapshot" JSONB NOT NULL,
 CHECK ("priorAssessmentId" <> "newAssessmentId"),
 CHECK (("status" = 'IN_PROGRESS' AND "activeKey" IS NOT NULL AND "completedAt" IS NULL) OR
 ("status" = 'COMPLETED' AND "activeKey" IS NULL AND "completedAt" IS NOT NULL AND "completedByUserId" IS NOT NULL AND "conclusion" IS NOT NULL))
);
CREATE UNIQUE INDEX "vendor_reassessments_newAssessmentId_key" ON "vendor_reassessments"("newAssessmentId");
CREATE UNIQUE INDEX "vendor_reassessments_activeKey_key" ON "vendor_reassessments"("activeKey");
CREATE INDEX "vendor_reassessments_tenantId_vendorId_status_idx" ON "vendor_reassessments"("tenantId","vendorId","status");
CREATE FUNCTION protect_vendor_governance_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'risk_acceptances' THEN
  IF OLD."vendorRiskContextHash" IS NULL THEN RETURN NEW; END IF;
  IF OLD."status" <> 'PENDING_REVIEW' THEN RAISE EXCEPTION 'Vendor acceptance decisions are immutable'; END IF;
  IF ROW(NEW."tenantId",NEW."vendorId",NEW."assessmentId",NEW."vendorFindingId",NEW."requestedByUserId",NEW."createdAt",NEW."justification",NEW."residualRiskStatement",NEW."expiresAt",NEW."vendorRiskSnapshot",NEW."vendorRiskContextHash") IS DISTINCT FROM
     ROW(OLD."tenantId",OLD."vendorId",OLD."assessmentId",OLD."vendorFindingId",OLD."requestedByUserId",OLD."createdAt",OLD."justification",OLD."residualRiskStatement",OLD."expiresAt",OLD."vendorRiskSnapshot",OLD."vendorRiskContextHash") THEN RAISE EXCEPTION 'Vendor acceptance request context is immutable'; END IF;
 ELSIF OLD."status" = 'COMPLETED' THEN RAISE EXCEPTION 'Completed vendor reassessments are immutable';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER vendor_acceptance_history_protected BEFORE UPDATE ON "risk_acceptances" FOR EACH ROW EXECUTE FUNCTION protect_vendor_governance_history();
CREATE TRIGGER vendor_reassessment_history_protected BEFORE UPDATE ON "vendor_reassessments" FOR EACH ROW EXECUTE FUNCTION protect_vendor_governance_history();
