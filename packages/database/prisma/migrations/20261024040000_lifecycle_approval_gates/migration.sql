ALTER TABLE "ai_risk_assessments" ADD COLUMN "noItemsJustification" TEXT;
ALTER TABLE "ai_impact_assessments" ADD COLUMN "noItemsJustification" TEXT;
CREATE TABLE "ai_system_approvals" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "aiSystemId" TEXT NOT NULL REFERENCES "ai_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK ("status" IN ('PENDING_REVIEW','APPROVED','REJECTED','CANCELLED')),
 "activeRequestKey" TEXT,
 "requestedByUserId" TEXT NOT NULL,
 "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "requestRationale" TEXT NOT NULL CHECK (length(btrim("requestRationale")) > 0),
 "contextHash" TEXT NOT NULL,
 "independentOfUserIds" TEXT[] NOT NULL,
 "decidedByUserId" TEXT,
 "decidedAt" TIMESTAMP(3),
 "decisionRationale" TEXT,
 CHECK (("status" = 'PENDING_REVIEW' AND "activeRequestKey" = "aiSystemId" AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL) OR
 ("status" <> 'PENDING_REVIEW' AND "activeRequestKey" IS NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND length(btrim("decisionRationale")) > 0)),
 CHECK ("status" <> 'APPROVED' OR ("decidedByUserId" <> "requestedByUserId" AND NOT ("decidedByUserId" = ANY("independentOfUserIds"))))
);
CREATE UNIQUE INDEX "ai_system_approvals_activeRequestKey_key" ON "ai_system_approvals"("activeRequestKey");
CREATE INDEX "ai_system_approvals_tenantId_aiSystemId_idx" ON "ai_system_approvals"("tenantId", "aiSystemId");
CREATE FUNCTION protect_system_approval_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'System approval history cannot be deleted';
 END IF;
 IF OLD."status" <> 'PENDING_REVIEW' THEN RAISE EXCEPTION 'System approval decisions are immutable'; END IF;
 IF ROW(NEW."tenantId",NEW."aiSystemId",NEW."requestedByUserId",NEW."requestedAt",NEW."requestRationale",NEW."contextHash",NEW."independentOfUserIds") IS DISTINCT FROM
 ROW(OLD."tenantId",OLD."aiSystemId",OLD."requestedByUserId",OLD."requestedAt",OLD."requestRationale",OLD."contextHash",OLD."independentOfUserIds") THEN
   RAISE EXCEPTION 'Submitted approval context is immutable';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER system_approval_decisions_protected BEFORE UPDATE OR DELETE ON "ai_system_approvals" FOR EACH ROW EXECUTE FUNCTION protect_system_approval_decision();
