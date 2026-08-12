-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ANALYST', 'REVIEWER', 'AUDITOR', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "IndustryVertical" AS ENUM ('GENERAL', 'BANKING_FINANCIAL', 'HEALTHCARE');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EvidenceState" AS ENUM ('UPLOADED', 'QUARANTINED', 'SCANNING', 'CLEAN', 'REJECTED', 'EXTRACTING', 'INDEXED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('PASS', 'PARTIAL', 'FAIL', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ReviewDecisionType" AS ENUM ('ACCEPT', 'REJECT', 'OVERRIDE', 'REQUEST_MORE_EVIDENCE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "MappingStrength" AS ENUM ('EXACT', 'PARTIAL', 'RELATED');

-- CreateEnum
CREATE TYPE "RemediationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'OVERDUE', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" "IndustryVertical" NOT NULL DEFAULT 'GENERAL',
    "nydfsRegulated" BOOLEAN NOT NULL DEFAULT false,
    "baselTier" TEXT NOT NULL DEFAULT 'NONE',
    "isPubliclyTraded" BOOLEAN NOT NULL DEFAULT false,
    "operatesInEu" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "serviceDescription" TEXT NOT NULL,
    "serviceCategory" TEXT NOT NULL,
    "category" TEXT,
    "criticality" TEXT NOT NULL,
    "dataClassifications" TEXT[],
    "privilegedAccess" BOOLEAN NOT NULL DEFAULT false,
    "networkConnectivity" BOOLEAN NOT NULL DEFAULT false,
    "productionAccess" BOOLEAN NOT NULL DEFAULT false,
    "processingLocations" TEXT[],
    "businessContinuityDep" BOOLEAN NOT NULL DEFAULT false,
    "aiFunctionality" BOOLEAN NOT NULL DEFAULT false,
    "aiProductType" TEXT NOT NULL DEFAULT 'NONE',
    "aiProviders" TEXT[],
    "customerDataTrainingPolicy" BOOLEAN NOT NULL DEFAULT false,
    "humanOversightDocumented" BOOLEAN NOT NULL DEFAULT false,
    "servesGovernmentCustomers" BOOLEAN NOT NULL DEFAULT false,
    "processesSwiftMessaging" BOOLEAN NOT NULL DEFAULT false,
    "affectsFinancialReporting" BOOLEAN NOT NULL DEFAULT false,
    "processesMedicareMedicaidClaims" BOOLEAN NOT NULL DEFAULT false,
    "contractStartDate" TIMESTAMP(3),
    "contractReviewDate" TIMESTAMP(3),
    "businessOwnerUserId" TEXT,
    "securityOwnerUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subprocessors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "dataAccessScope" TEXT NOT NULL,
    "location" TEXT,
    "disclosedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subprocessors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "scoringModelVersion" TEXT NOT NULL,
    "inherentScore" DOUBLE PRECISION,
    "residualScore" DOUBLE PRECISION,
    "riskBand" "RiskBand",
    "controlEffectiveness" DOUBLE PRECISION,
    "factorInputsJson" JSONB,
    "startedByUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_frameworks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "frameworkVersion" TEXT NOT NULL,
    "applicabilityReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaires" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaire_responses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answerJson" JSONB NOT NULL,
    "answeredByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "displayFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "documentType" TEXT NOT NULL,
    "state" "EvidenceState" NOT NULL DEFAULT 'UPLOADED',
    "expirationDate" TIMESTAMP(3),
    "uploadedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_chunks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "page" INTEGER,
    "section" TEXT,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embeddingRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frameworks" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "industries" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "framework_versions" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "licenseNote" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "framework_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controls" (
    "id" TEXT NOT NULL,
    "frameworkVersionId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "parentControlId" TEXT,
    "expectedEvidenceTypes" TEXT[],
    "validationGuidance" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_mappings" (
    "id" TEXT NOT NULL,
    "fromControlId" TEXT NOT NULL,
    "toControlId" TEXT NOT NULL,
    "strength" "MappingStrength" NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_findings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "gaps" TEXT[],
    "recommendations" TEXT[],
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "proposedByMcpInvocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "control_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "evidenceDocumentId" TEXT NOT NULL,
    "page" INTEGER,
    "section" TEXT,
    "chunkId" TEXT,
    "excerpt" TEXT NOT NULL,
    "retrievalScore" DOUBLE PRECISION,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "ReviewDecisionType" NOT NULL,
    "rationale" TEXT NOT NULL,
    "changedValuesJson" JSONB,
    "modelVersion" TEXT,
    "frameworkVersion" TEXT,
    "promptTemplateVersion" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remediation_actions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "findingId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "status" "RemediationStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remediation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_acceptances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "approvedByUserId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT,
    "assessmentId" TEXT,
    "userId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptTemplateVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citationsJson" JSONB,
    "promptInjectionFlagged" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_invocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "actorUserId" TEXT,
    "inputJson" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorSystem" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "outcome" TEXT NOT NULL,
    "metadataJson" JSONB,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_externalId_key" ON "users"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "tenant_memberships_tenantId_idx" ON "tenant_memberships"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenantId_userId_key" ON "tenant_memberships"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "vendors_tenantId_idx" ON "vendors"("tenantId");

-- CreateIndex
CREATE INDEX "vendors_tenantId_criticality_idx" ON "vendors"("tenantId", "criticality");

-- CreateIndex
CREATE INDEX "vendor_contacts_tenantId_idx" ON "vendor_contacts"("tenantId");

-- CreateIndex
CREATE INDEX "vendor_contacts_vendorId_idx" ON "vendor_contacts"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_services_tenantId_idx" ON "vendor_services"("tenantId");

-- CreateIndex
CREATE INDEX "vendor_services_vendorId_idx" ON "vendor_services"("vendorId");

-- CreateIndex
CREATE INDEX "subprocessors_tenantId_idx" ON "subprocessors"("tenantId");

-- CreateIndex
CREATE INDEX "subprocessors_vendorId_idx" ON "subprocessors"("vendorId");

-- CreateIndex
CREATE INDEX "assessments_tenantId_idx" ON "assessments"("tenantId");

-- CreateIndex
CREATE INDEX "assessments_tenantId_vendorId_idx" ON "assessments"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "assessments_tenantId_status_idx" ON "assessments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "assessment_frameworks_tenantId_idx" ON "assessment_frameworks"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_frameworks_assessmentId_frameworkId_key" ON "assessment_frameworks"("assessmentId", "frameworkId");

-- CreateIndex
CREATE INDEX "questionnaires_tenantId_idx" ON "questionnaires"("tenantId");

-- CreateIndex
CREATE INDEX "questionnaires_assessmentId_idx" ON "questionnaires"("assessmentId");

-- CreateIndex
CREATE INDEX "questionnaire_responses_tenantId_idx" ON "questionnaire_responses"("tenantId");

-- CreateIndex
CREATE INDEX "questionnaire_responses_questionnaireId_idx" ON "questionnaire_responses"("questionnaireId");

-- CreateIndex
CREATE INDEX "evidence_documents_tenantId_idx" ON "evidence_documents"("tenantId");

-- CreateIndex
CREATE INDEX "evidence_documents_tenantId_vendorId_idx" ON "evidence_documents"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "evidence_documents_tenantId_state_idx" ON "evidence_documents"("tenantId", "state");

-- CreateIndex
CREATE INDEX "evidence_documents_sha256Hash_idx" ON "evidence_documents"("sha256Hash");

-- CreateIndex
CREATE INDEX "evidence_chunks_tenantId_idx" ON "evidence_chunks"("tenantId");

-- CreateIndex
CREATE INDEX "evidence_chunks_documentId_idx" ON "evidence_chunks"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "frameworks_catalogId_key" ON "frameworks"("catalogId");

-- CreateIndex
CREATE INDEX "frameworks_tenantId_idx" ON "frameworks"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "framework_versions_frameworkId_version_key" ON "framework_versions"("frameworkId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "controls_frameworkVersionId_controlId_key" ON "controls"("frameworkVersionId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "control_mappings_fromControlId_toControlId_key" ON "control_mappings"("fromControlId", "toControlId");

-- CreateIndex
CREATE INDEX "control_findings_tenantId_idx" ON "control_findings"("tenantId");

-- CreateIndex
CREATE INDEX "control_findings_tenantId_vendorId_idx" ON "control_findings"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "control_findings_tenantId_assessmentId_idx" ON "control_findings"("tenantId", "assessmentId");

-- CreateIndex
CREATE INDEX "control_findings_tenantId_status_idx" ON "control_findings"("tenantId", "status");

-- CreateIndex
CREATE INDEX "finding_evidence_tenantId_idx" ON "finding_evidence"("tenantId");

-- CreateIndex
CREATE INDEX "finding_evidence_findingId_idx" ON "finding_evidence"("findingId");

-- CreateIndex
CREATE INDEX "review_decisions_tenantId_idx" ON "review_decisions"("tenantId");

-- CreateIndex
CREATE INDEX "review_decisions_findingId_idx" ON "review_decisions"("findingId");

-- CreateIndex
CREATE INDEX "remediation_actions_tenantId_idx" ON "remediation_actions"("tenantId");

-- CreateIndex
CREATE INDEX "remediation_actions_tenantId_vendorId_idx" ON "remediation_actions"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "remediation_actions_tenantId_status_idx" ON "remediation_actions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "risk_acceptances_tenantId_idx" ON "risk_acceptances"("tenantId");

-- CreateIndex
CREATE INDEX "risk_acceptances_tenantId_vendorId_idx" ON "risk_acceptances"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "assistant_conversations_tenantId_idx" ON "assistant_conversations"("tenantId");

-- CreateIndex
CREATE INDEX "assistant_messages_tenantId_idx" ON "assistant_messages"("tenantId");

-- CreateIndex
CREATE INDEX "assistant_messages_conversationId_idx" ON "assistant_messages"("conversationId");

-- CreateIndex
CREATE INDEX "mcp_invocations_tenantId_idx" ON "mcp_invocations"("tenantId");

-- CreateIndex
CREATE INDEX "mcp_invocations_correlationId_idx" ON "mcp_invocations"("correlationId");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_idx" ON "audit_events"("tenantId");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_action_idx" ON "audit_events"("tenantId", "action");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_createdAt_idx" ON "audit_events"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_services" ADD CONSTRAINT "vendor_services_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subprocessors" ADD CONSTRAINT "subprocessors_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_frameworks" ADD CONSTRAINT "assessment_frameworks_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_frameworks" ADD CONSTRAINT "assessment_frameworks_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_documents" ADD CONSTRAINT "evidence_documents_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "evidence_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "frameworks" ADD CONSTRAINT "frameworks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framework_versions" ADD CONSTRAINT "framework_versions_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controls" ADD CONSTRAINT "controls_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "framework_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mappings" ADD CONSTRAINT "control_mappings_fromControlId_fkey" FOREIGN KEY ("fromControlId") REFERENCES "controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mappings" ADD CONSTRAINT "control_mappings_toControlId_fkey" FOREIGN KEY ("toControlId") REFERENCES "controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_findings" ADD CONSTRAINT "control_findings_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_findings" ADD CONSTRAINT "control_findings_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_findings" ADD CONSTRAINT "control_findings_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_findings" ADD CONSTRAINT "control_findings_proposedByMcpInvocationId_fkey" FOREIGN KEY ("proposedByMcpInvocationId") REFERENCES "mcp_invocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_evidence" ADD CONSTRAINT "finding_evidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "control_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_evidence" ADD CONSTRAINT "finding_evidence_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "evidence_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "control_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "control_findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_invocations" ADD CONSTRAINT "mcp_invocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
