import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";

let tenantId: string;
let otherTenantId: string;
let submitterUserId: string;
let secondReviewerUserId: string;
let analystUserId: string;
let otherTenantReviewerUserId: string;
let vendorId: string;
let assessmentId: string;
let questionnaireId: string;

function cookieFor(userId: string, role: string, tid: string = tenantId) {
  return JSON.stringify({ userId, tenantId: tid, email: `${userId}@example.com`, displayName: "Test User", role });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Questionnaire Bypass Test Tenant" } });
  tenantId = tenant.id;

  const otherTenant = await prisma.tenant.create({ data: { name: "Questionnaire Bypass Other Tenant" } });
  otherTenantId = otherTenant.id;

  const submitter = await prisma.user.create({
    data: { externalId: `qb-submitter-${Date.now()}`, email: `qb-submitter-${Date.now()}@example.com`, displayName: "Submitter" },
  });
  submitterUserId = submitter.id;
  await prisma.tenantMembership.create({ data: { userId: submitter.id, tenantId, role: "REVIEWER" } });

  const secondReviewer = await prisma.user.create({
    data: { externalId: `qb-reviewer2-${Date.now()}`, email: `qb-reviewer2-${Date.now()}@example.com`, displayName: "Second Reviewer" },
  });
  secondReviewerUserId = secondReviewer.id;
  await prisma.tenantMembership.create({ data: { userId: secondReviewer.id, tenantId, role: "REVIEWER" } });

  const analyst = await prisma.user.create({
    data: { externalId: `qb-analyst-${Date.now()}`, email: `qb-analyst-${Date.now()}@example.com`, displayName: "Analyst" },
  });
  analystUserId = analyst.id;
  await prisma.tenantMembership.create({ data: { userId: analyst.id, tenantId, role: "ANALYST" } });

  const otherReviewer = await prisma.user.create({
    data: { externalId: `qb-other-reviewer-${Date.now()}`, email: `qb-other-reviewer-${Date.now()}@example.com`, displayName: "Other Tenant Reviewer" },
  });
  otherTenantReviewerUserId = otherReviewer.id;
  await prisma.tenantMembership.create({ data: { userId: otherReviewer.id, tenantId: otherTenantId, role: "REVIEWER" } });

  const vendor = await prisma.vendor.create({
    data: { tenantId, legalName: "Questionnaire Bypass Test Vendor", serviceCategory: "Cloud/SaaS", serviceDescription: "test", criticality: "MEDIUM" },
  });
  vendorId = vendor.id;

  const assessment = await prisma.assessment.create({
    data: { tenantId, vendorId, scoringModelVersion: "test-1", startedByUserId: submitter.id },
  });
  assessmentId = assessment.id;

  const questionnaire = await prisma.questionnaire.create({
    data: {
      tenantId,
      assessmentId,
      name: "Bypass Test Questionnaire",
      version: "1.0",
      status: "SUBMITTED",
      submittedByUserId: submitterUserId,
    },
  });
  questionnaireId = questionnaire.id;
});

afterAll(async () => {
  await prisma.questionnaireResponse.deleteMany({ where: { tenantId } });
  await prisma.questionnaire.deleteMany({ where: { tenantId } });
  await prisma.assessment.deleteMany({ where: { tenantId } });
  await prisma.vendor.deleteMany({ where: { tenantId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: otherTenantId } });
  await prisma.user.delete({ where: { id: submitterUserId } });
  await prisma.user.delete({ where: { id: secondReviewerUserId } });
  await prisma.user.delete({ where: { id: analystUserId } });
  await prisma.user.delete({ where: { id: otherTenantReviewerUserId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.tenant.delete({ where: { id: otherTenantId } });
});

describe("POST /questionnaires/:id/review (approval-bypass scenarios)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/review`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an ANALYST, who does not have questionnaire:review permission", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/review`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST") },
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks the original submitter from reviewing their own submission, even though their role (REVIEWER) would otherwise be authorized", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/review`,
      cookies: { vg_session: cookieFor(submitterUserId, "REVIEWER") },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/own submission/i);
  });

  it("rejects a REVIEWER from another tenant, treating it as not found rather than leaking existence", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/review`,
      cookies: { vg_session: cookieFor(otherTenantReviewerUserId, "REVIEWER", otherTenantId) },
    });
    expect(res.statusCode).toBe(404);
  });

  it("allows a REVIEWER who is not the submitter to review it", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/review`,
      cookies: { vg_session: cookieFor(secondReviewerUserId, "REVIEWER") },
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.questionnaire.findUniqueOrThrow({ where: { id: questionnaireId } });
    expect(updated.status).toBe("REVIEWED");
    expect(updated.reviewedByUserId).toBe(secondReviewerUserId);
  });
});

describe("POST /questionnaires/:id/approve (approval-bypass scenarios)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/approve`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an ANALYST, who does not have questionnaire:review permission", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/approve`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST") },
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks the original submitter from approving their own submission, even though their role (REVIEWER) would otherwise be authorized", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/approve`,
      cookies: { vg_session: cookieFor(submitterUserId, "REVIEWER") },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/own submission/i);
  });

  it("rejects a REVIEWER from another tenant, treating it as not found rather than leaking existence", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/approve`,
      cookies: { vg_session: cookieFor(otherTenantReviewerUserId, "REVIEWER", otherTenantId) },
    });
    expect(res.statusCode).toBe(404);
  });

  it("allows a REVIEWER who is not the submitter to approve it", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/questionnaires/${questionnaireId}/approve`,
      cookies: { vg_session: cookieFor(secondReviewerUserId, "REVIEWER") },
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.questionnaire.findUniqueOrThrow({ where: { id: questionnaireId } });
    expect(updated.status).toBe("APPROVED");
    expect(updated.approvedByUserId).toBe(secondReviewerUserId);
  });
});