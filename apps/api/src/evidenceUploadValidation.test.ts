import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ blobs: new Map<string, Buffer>(), fail: "", upload: vi.fn(), cleanup: vi.fn() }));
vi.mock("@vendorguard/storage-client", () => ({ getStorageClient: () => ({ uploadFile: storage.upload, deleteFile: storage.cleanup }) }));
vi.mock("./evidenceExtraction.js", () => ({ extractAndSaveEvidenceChunks: async () => ({ chunksCreated: 0 }), extractEvidenceText: async () => [], evidenceTextHash: () => "test" }));
import { prisma, databaseClient } from "@vendorguard/database";
import { issueTestSessionCookie } from "./testSession.js";
import { server } from "./index.js";
let tenantId: string | undefined, userId: string | undefined, vendorId: string, systemId: string, cookie: string;
const bytes = Buffer.from("Section13 disposable upload");
let ip = 0;
function multipart(expirationDate = "") {
  const boundary = "section13-boundary";
  return { boundary, payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nTest evidence\r\n--${boundary}\r\nContent-Disposition: form-data; name="expirationDate"\r\n\r\n${expirationDate}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="disposable.pdf"\r\nContent-Type: application/pdf\r\n\r\n${bytes.toString()}\r\n--${boundary}--\r\n`) };
}
async function upload(date = "", aiSystem = false) {
  const { boundary, payload } = multipart(date);
  return server.inject({ method: "POST", url: aiSystem ? `/ai-systems/${systemId}/evidence/upload` : `/vendors/${vendorId}/evidence/upload`, cookies: { vg_session: cookie }, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload, remoteAddress: `10.195.0.${++ip}` });
}
beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Section13 evidence validation" } })).id;
  const id = randomUUID();
  userId = (await prisma.user.create({ data: { externalId: id, email: `${id}@section13.example.test`, displayName: "Section13" } })).id;
  await prisma.tenantMembership.create({ data: { tenantId, userId, role: "ADMIN" } });
  cookie = await issueTestSessionCookie({ tenantId, userId, role: "ADMIN", email: `${id}@section13.example.test`, displayName: "Section13" });
  vendorId = (await prisma.vendor.create({ data: { tenantId, legalName: "Disposable", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" } })).id;
  systemId = (await prisma.aiSystem.create({ data: { tenantId, name: "Disposable upload", origin: "INTERNAL" } })).id;
  storage.upload.mockImplementation(async (_container, key, buffer, mimeType) => {
    if (storage.fail === "storage") throw new Error("Disposable storage failure");
    storage.blobs.set(key, buffer);
    if (storage.fail === "ambiguous-storage") throw new Error("Upload response lost after writing disposable blob");
    return { storageKey: key, sizeBytes: buffer.length, mimeType, sha256Hash: createHash("sha256").update(buffer).digest("hex") };
  });
  storage.cleanup.mockImplementation(async (_container, key) => { storage.blobs.delete(key); });
  databaseClient.$use(async (params, next) => {
    if (params.args?.data?.tenantId === tenantId && params.action === "create" &&
      ((storage.fail === "database" && params.model === "EvidenceDocument") || (storage.fail === "audit" && params.model === "AuditEvent"))) throw new Error("Disposable persistence failure");
    return next(params);
  });
});
afterEach(() => { storage.fail = ""; storage.blobs.clear(); storage.upload.mockClear(); storage.cleanup.mockClear(); });
afterAll(async () => {
  if (tenantId) { await prisma.auditEvent.deleteMany({ where: { tenantId } }); await prisma.tenant.delete({ where: { id: tenantId } }); }
  if (userId) await prisma.user.delete({ where: { id: userId } });
});
it.each(["database", "audit"])("compensates upload and rolls back metadata on %s failure", async failure => {
  const before = await prisma.evidenceDocument.count({ where: { tenantId } });
  storage.fail = failure;
  try {
    expect((await upload()).statusCode).toBe(500);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.cleanup).toHaveBeenCalledTimes(1);
    expect(storage.blobs.size).toBe(0);
    expect(await prisma.evidenceDocument.count({ where: { tenantId } })).toBe(before);
  } finally { storage.fail = ""; }
});
it("rejects invalid upload dates before writing storage", async () => {
  expect((await upload("invalid-date")).statusCode).toBe(400);
  expect(storage.upload).not.toHaveBeenCalled();
});
it("storage failure creates no metadata", async () => {
  const before = await prisma.evidenceDocument.count({ where: { tenantId } });
  storage.fail = "storage";
  expect((await upload()).statusCode).toBe(500);
  expect(await prisma.evidenceDocument.count({ where: { tenantId } })).toBe(before);
  expect(storage.blobs.size).toBe(0);
});
it.each([false, true])("compensates an ambiguous storage failure (AI system: %s)", async aiSystem => {
  const before = await prisma.evidenceDocument.count({ where: { tenantId } });
  storage.fail = "ambiguous-storage";
  expect((await upload("", aiSystem)).statusCode).toBe(500);
  expect(storage.cleanup).toHaveBeenCalledTimes(1);
  expect(storage.blobs.size).toBe(0);
  expect(await prisma.evidenceDocument.count({ where: { tenantId } })).toBe(before);
});
it.each([false, true])("reports operator cleanup when compensation is unavailable (AI system: %s)", async aiSystem => {
  const before = await prisma.evidenceDocument.count({ where: { tenantId } });
  storage.fail = "database";
  storage.cleanup.mockRejectedValueOnce(new Error("Disposable cleanup unavailable"));
  const response = await upload("", aiSystem);
  expect(response.statusCode).toBe(500);
  expect(response.body).toContain("operator cleanup");
  expect(await prisma.evidenceDocument.count({ where: { tenantId } })).toBe(before);
  expect(storage.blobs.size).toBe(1);
});
it.each([null, { displayFilename: {} , documentType: "Test" }, { displayFilename: " ", documentType: "Test" }, { displayFilename: "test.pdf", documentType: "Test", expirationDate: "bad-date" }])("rejects malformed manual metadata %j", async body => {
  const response = await server.inject({ method: "POST", url: `/vendors/${vendorId}/evidence`, cookies: { vg_session: cookie }, headers: { "content-type": "application/json" }, payload: JSON.stringify(body), remoteAddress: `10.195.0.${++ip}` });
  expect(response.statusCode).toBe(400);
  expect(response.body).not.toMatch(/Prisma|TypeError/);
});
it("persists valid upload metadata and success audit with exact byte/hash values", async () => {
  const response = await upload();
  expect(response.statusCode).toBe(201);
  const saved = await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: response.json().id } });
  expect(saved).toMatchObject({ vendorId, tenantId, sizeBytes: bytes.length, sha256Hash: createHash("sha256").update(bytes).digest("hex") });
  expect(storage.blobs.get(saved.storageKey)).toEqual(bytes);
  expect(await prisma.auditEvent.count({ where: { targetId: saved.id, action: "evidence.uploaded" } })).toBe(1);
});
it("rolls back manual metadata when its success audit fails", async () => {
  const before = await prisma.evidenceDocument.count({ where: { tenantId } });
  storage.fail = "audit";
  const response = await server.inject({ method: "POST", url: `/vendors/${vendorId}/evidence`, cookies: { vg_session: cookie }, payload: { displayFilename: "disposable.pdf", documentType: "Test" }, remoteAddress: `10.195.0.${++ip}` });
  expect(response.statusCode).toBe(500);
  expect(await prisma.evidenceDocument.count({ where: { tenantId } })).toBe(before);
});
it("allocates distinct storage keys for repeated same-name uploads in the same millisecond", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
  try {
    const first = await upload();
    const second = await upload();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().storageKey).not.toBe(second.json().storageKey);
    expect(storage.blobs.size).toBe(2);
  } finally { clock.mockRestore(); }
});
