/**
 * packages/storage-client/src/storage-client.test.ts
 *
 * Integration tests against the real, already-running Azurite container
 * (vendorguard-azurite, confirmed listening on 0.0.0.0:10000 per the M8
 * Phase 5 handoff). No mocking -- same "live DB verification" discipline
 * used for Phase 2's evidenceAnalysis tests.
 *
 * Requires STORAGE_PROVIDER=azurite and AZURITE_CONNECTION_STRING to be
 * set (already the case in .env per the handoff).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getStorageClient, __resetStorageClientForTests } from "./index.js";
import { createHash } from "node:crypto";

const TEST_CONTAINER = "evidence-test"; // separate from real "evidence" container to avoid polluting real data
const TEST_KEY = "storage-client-test/" + Date.now() + "-sample.txt";
const TEST_CONTENT = "VendorGuard AI storage-client round-trip test fixture.";

describe("storage-client (azurite, live)", () => {
  beforeAll(() => {
    __resetStorageClientForTests();
  });

  afterAll(async () => {
    const client = getStorageClient();
    await client.deleteFile(TEST_CONTAINER, TEST_KEY);
  });

  it("uploads a buffer and returns correct metadata", async () => {
    const client = getStorageClient();
    const buffer = Buffer.from(TEST_CONTENT, "utf-8");

    const result = await client.uploadFile(
      TEST_CONTAINER,
      TEST_KEY,
      buffer,
      "text/plain"
    );

    expect(result.storageKey).toBe(TEST_KEY);
    expect(result.sizeBytes).toBe(buffer.byteLength);
    expect(result.mimeType).toBe("text/plain");

    const expectedHash = createHash("sha256").update(buffer).digest("hex");
    expect(result.sha256Hash).toBe(expectedHash);
  });

  it("downloads the same content that was uploaded", async () => {
    const client = getStorageClient();
    const downloaded = await client.downloadFile(TEST_CONTAINER, TEST_KEY);

    expect(downloaded.toString("utf-8")).toBe(TEST_CONTENT);
  });

  it("returns a resolvable blob URL", async () => {
    const client = getStorageClient();
    const url = client.getFileUrl(TEST_CONTAINER, TEST_KEY);

    expect(url).toContain(TEST_CONTAINER);
  });

  it("deleteFile resolves silently for a non-existent key", async () => {
    const client = getStorageClient();
    await expect(
      client.deleteFile(TEST_CONTAINER, "does-not-exist-key.txt")
    ).resolves.not.toThrow();
  });

  it("downloadFile throws for a non-existent key", async () => {
    const client = getStorageClient();
    await expect(
      client.downloadFile(TEST_CONTAINER, "does-not-exist-key.txt")
    ).rejects.toThrow();
  });
});