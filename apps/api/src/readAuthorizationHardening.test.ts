import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";

// Test fixture: the storage client's downloadFile is mocked so authorization can be proven without blob storage.
// Known test keys return fake file bytes; any other key behaves like a missing file (distinct from tenant 404).
vi.mock("@vendorguard/storage-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getStorageClient: () => ({
      downloadFile: async (_container: string, key: string) => {
        if (key.startsWith("rh-secret-key-")) {
          return Buffer.from("%PDF-1.4 vendorguard read-hardening fixture");
        }
        throw Object.assign(new Error("Stored file not found"), { statusCode: 404 });
      },
    }),
  };
});
import { createSessionCookie } from "@vendorguard/auth";

// Third-Party AI READ authorization hardening (A1: ADMIN evidence:* + existing catalog).
// evidence:* = ADMIN; evidence:read/upload = ANALYST; evidence:read-metadata = AUDITOR; REVIEWER / READ_ONLY = no evidence access;
// remediation:read = ADMIN, ANALYST, REVIEWER, AUDITOR.
const ROLES = ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"] as const;
type Role = (typeof ROLES)[number];

let tenantAId: string;
let tenantBId: string;
const usersA = {} as Record<Role, string>;
let adminB: string;
let vendorA: string;
let vendorB: string;
let docA: string;
let docB: string;
const userIds: string[] = [];
const stamp = `${Date.now()}`;

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.111." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
async function get(url: string, role: Role, tenantId = tenantAId, userId?: string) {
  const id = userId ?? usersA[role];
  const res = await server.inject({
    method: "GET", url,
    cookies: { vg_session: createSessionCookie({ userId: id, tenantId, email: `${id}@example.com`, displayName: "RH", role }) },
    remoteAddress: nextIp(),
  });
  let body: unknown = null;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = null;
  }
  return { status: res.statusCode, body };
}
async function newUser(label: string, role: string, tenantId: string) {
  const u = await prisma.user.create({ data: { externalId: `rh-${label}-${stamp}`, email: `rh-${label}-${stamp}@example.com`, displayName: `RH ${label}` } });
  await prisma.tenantMembership.create({ data: { userId: u.id, tenantId, role: role as never } });
  userIds.push(u.id);
  return u.id;
}
async function vendorWithDoc(tenantId: string, userId: string, label: string) {
  const vendor = await prisma.vendor.create({ data: { tenantId, legalName: `RH AI Vendor ${label}`, serviceDescription: "x", serviceCategory: "x", criticality: "LOW" } });
  const doc = await prisma.evidenceDocument.create({
    data: { tenantId, vendorId: vendor.id, displayFilename: `rh-${label}.pdf`, storageKey: `rh-secret-key-${label}-${stamp}`, mimeType: "application/pdf", sizeBytes: 10, sha256Hash: `rh-${label}-${stamp}`, documentType: "SOC 2 report", uploadedByUserId: userId },
  });
  return { vendorId: vendor.id, docId: doc.id };
}

beforeAll(async () => {
  tenantAId = (await prisma.tenant.create({ data: { name: "RH Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "RH Tenant B" } })).id;
  for (const r of ROLES) {
    usersA[r] = await newUser(`a-${r.toLowerCase()}`, r, tenantAId);
  }
  adminB = await newUser("b-admin", "ADMIN", tenantBId);
  const a = await vendorWithDoc(tenantAId, usersA.ADMIN, "a");
  const b = await vendorWithDoc(tenantBId, adminB, "b");
  vendorA = a.vendorId;
  docA = a.docId;
  vendorB = b.vendorId;
  docB = b.docId;
});

afterAll(async () => {
  const tenantId = { in: [tenantAId, tenantBId] };
  await prisma.auditEvent.deleteMany({ where: { tenantId } });
  await prisma.evidenceDocument.deleteMany({ where: { tenantId } });
  await prisma.vendor.deleteMany({ where: { tenantId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe("Read hardening - GET /evidence/:id/download (evidence:read)", () => {
  for (const role of ["ADMIN", "ANALYST"] as const) {
    it(`${role} -> 200 with the file bytes (ADMIN via evidence:*, ANALYST via evidence:read)`, async () => {
      const res = await server.inject({
        method: "GET", url: `/evidence/${docA}/download`,
        cookies: { vg_session: createSessionCookie({ userId: usersA[role], tenantId: tenantAId, email: "x@example.com", displayName: "x", role }) },
        remoteAddress: nextIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("vendorguard read-hardening fixture");
    });
  }
  for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"] as const) {
    it(`${role} -> 403`, async () => {
      expect((await get(`/evidence/${docA}/download`, role)).status).toBe(403);
    });
  }
  it("wrong tenant -> tenant-hidden 404 'Evidence document not found' (authorized and unauthorized roles)", async () => {
    for (const role of ["ADMIN", "READ_ONLY"] as const) {
      const res = await get(`/evidence/${docB}/download`, role);
      expect(res.status).toBe(404);
      expect((res.body as { error?: string }).error).toBe("Evidence document not found");
    }
  });
  it("authorized but physical file missing -> storage error, never 403 and never the tenant 404", async () => {
    const missing = await prisma.evidenceDocument.create({
      data: { tenantId: tenantAId, vendorId: vendorA, displayFilename: "missing.pdf", storageKey: `not-in-storage-${stamp}`, mimeType: "application/pdf", sizeBytes: 1, sha256Hash: `missing-${stamp}`, documentType: "SOC 2 report", uploadedByUserId: usersA.ADMIN },
    });
    const res = await get(`/evidence/${missing.id}/download`, "ADMIN");
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(200);
    expect((res.body as { error?: string } | null)?.error).not.toBe("Evidence document not found");
  });
});

describe("Read hardening - evidence upload authorization (evidence:upload; ADMIN via evidence:*)", () => {
  // The upload route checks evidence:upload before reading the multipart body, so an empty request proves
  // the authorization decision without needing real blob storage.
  async function upload(role: Role) {
    const res = await server.inject({
      method: "POST", url: `/vendors/${vendorA}/evidence/upload`,
      cookies: { vg_session: createSessionCookie({ userId: usersA[role], tenantId: tenantAId, email: "x@example.com", displayName: "x", role }) },
      payload: {},
      remoteAddress: nextIp(),
    });
    return res.statusCode;
  }
  for (const role of ["ADMIN", "ANALYST"] as const) {
    it(`${role} passes the evidence:upload check (not 403 / 404)`, async () => {
      const status = await upload(role);
      expect(status).not.toBe(403);
      expect(status).not.toBe(404);
    });
  }
  for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"] as const) {
    it(`${role} -> 403`, async () => {
      expect(await upload(role)).toBe(403);
    });
  }
});

describe("Read hardening - GET /evidence/:id (evidence:read OR evidence:read-metadata)", () => {
  for (const role of ["ADMIN", "ANALYST", "AUDITOR"] as const) {
    it(`${role} -> 200 without storageKey`, async () => {
      const res = await get(`/evidence/${docA}`, role);
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.id).toBe(docA);
      expect(body).not.toHaveProperty("storageKey");
    });
  }
  for (const role of ["REVIEWER", "READ_ONLY"] as const) {
    it(`${role} -> 403`, async () => {
      expect((await get(`/evidence/${docA}`, role)).status).toBe(403);
    });
  }
  it("cross-tenant id -> 404 (authorized and unauthorized roles)", async () => {
    expect((await get(`/evidence/${docB}`, "ADMIN")).status).toBe(404);
    expect((await get(`/evidence/${docB}`, "REVIEWER")).status).toBe(404);
  });
});

describe("Read hardening - GET /vendors/:id/evidence (evidence:read OR evidence:read-metadata)", () => {
  for (const role of ["ADMIN", "ANALYST", "AUDITOR"] as const) {
    it(`${role} -> 200, list without storageKey`, async () => {
      const res = await get(`/vendors/${vendorA}/evidence`, role);
      expect(res.status).toBe(200);
      const list = (res.body as { evidence: Record<string, unknown>[] }).evidence;
      expect(list.map((d) => d.id)).toContain(docA);
      for (const d of list) {
        expect(d).not.toHaveProperty("storageKey");
      }
    });
  }
  for (const role of ["REVIEWER", "READ_ONLY"] as const) {
    it(`${role} -> 403`, async () => {
      expect((await get(`/vendors/${vendorA}/evidence`, role)).status).toBe(403);
    });
  }
  it("cross-tenant vendor -> existing tenant-hidden behaviour (empty list, no foreign evidence)", async () => {
    const res = await get(`/vendors/${vendorB}/evidence`, "ADMIN");
    expect(res.status).toBe(200);
    expect((res.body as { evidence: unknown[] }).evidence).toHaveLength(0);
  });
});

describe("Read hardening - GET /vendors/:id/remediations (remediation:read)", () => {
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR"] as const) {
    it(`${role} -> 200`, async () => {
      expect((await get(`/vendors/${vendorA}/remediations`, role)).status).toBe(200);
    });
  }
  it("READ_ONLY -> 403", async () => {
    expect((await get(`/vendors/${vendorA}/remediations`, "READ_ONLY")).status).toBe(403);
  });
  it("cross-tenant vendor -> existing tenant-hidden behaviour (empty list)", async () => {
    const res = await get(`/vendors/${vendorB}/remediations`, "ADMIN");
    expect(res.status).toBe(200);
    expect((res.body as { remediations: unknown[] }).remediations).toHaveLength(0);
  });
});

describe("Read hardening - regression", () => {
  it("vendor and assessment reads still work for READ_ONLY (vendor:read / assessment:read)", async () => {
    expect((await get(`/vendors/${vendorA}`, "READ_ONLY")).status).toBe(200);
    expect((await get("/assessments", "READ_ONLY")).status).toBe(200);
  });
  it("a cookie claiming ADMIN cannot override the database READ_ONLY role on evidence download", async () => {
    const res = await server.inject({
      method: "GET", url: `/evidence/${docA}/download`,
      cookies: { vg_session: createSessionCookie({ userId: usersA.READ_ONLY, tenantId: tenantAId, email: "x@example.com", displayName: "x", role: "ADMIN" }) },
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(403);
  });
});