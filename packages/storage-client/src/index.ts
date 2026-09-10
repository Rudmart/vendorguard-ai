/**
 * packages/storage-client/src/index.ts
 *
 * Storage abstraction module, mirroring the AI_PROVIDER pattern in
 * packages/ai-client/src/analyzeEvidence.ts (reads process.env directly,
 * no shared env module). Branches on STORAGE_PROVIDER:
 *
 *   - "azurite"    -> BlobServiceClient.fromConnectionString(AZURITE_CONNECTION_STRING)
 *   - "azure-blob" -> BlobServiceClient with DefaultAzureCredential (managed identity)
 *                     against AZURE_STORAGE_ACCOUNT_URL
 *   - "local"      -> stubbed, throws "not yet implemented"
 */

import { BlobServiceClient, type BlockBlobClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { createHash } from "node:crypto";

export interface UploadResult {
  storageKey: string;
  sizeBytes: number;
  sha256Hash: string;
  mimeType: string;
}

export interface StorageClient {
  uploadFile(
    containerName: string,
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<UploadResult>;

  downloadFile(containerName: string, key: string): Promise<Buffer>;

  deleteFile(containerName: string, key: string): Promise<void>;

  getFileUrl(containerName: string, key: string): string;
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

class AzureBlobStorageClient implements StorageClient {
  constructor(private readonly serviceClient: BlobServiceClient) {}

  private getBlockBlobClient(containerName: string, key: string): BlockBlobClient {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    return containerClient.getBlockBlobClient(key);
  }

  async uploadFile(
    containerName: string,
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<UploadResult> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(key);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    return {
      storageKey: key,
      sizeBytes: buffer.byteLength,
      sha256Hash: sha256Hex(buffer),
      mimeType: contentType,
    };
  }

  async downloadFile(containerName: string, key: string): Promise<Buffer> {
    const blockBlobClient = this.getBlockBlobClient(containerName, key);
    const downloadResponse = await blockBlobClient.download();
    if (!downloadResponse.readableStreamBody) {
      throw new Error("No readable stream for blob: " + containerName + "/" + key);
    }
    return streamToBuffer(downloadResponse.readableStreamBody);
  }

  async deleteFile(containerName: string, key: string): Promise<void> {
    const blockBlobClient = this.getBlockBlobClient(containerName, key);
    await blockBlobClient.deleteIfExists();
  }

  getFileUrl(containerName: string, key: string): string {
    const blockBlobClient = this.getBlockBlobClient(containerName, key);
    return blockBlobClient.url;
  }
}

async function streamToBuffer(
  readableStream: NodeJS.ReadableStream
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on("data", (chunk) => {
      chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
    });
    readableStream.on("end", () => resolve(Buffer.concat(chunks)));
    readableStream.on("error", reject);
  });
}

class LocalStorageClient implements StorageClient {
  async uploadFile(): Promise<UploadResult> {
    throw new Error(
      "StorageClient: STORAGE_PROVIDER=local is not yet implemented. " +
        "Use STORAGE_PROVIDER=azurite for local development (Azurite container is already running)."
    );
  }
  async downloadFile(): Promise<Buffer> {
    throw new Error("StorageClient: STORAGE_PROVIDER=local is not yet implemented.");
  }
  async deleteFile(): Promise<void> {
    throw new Error("StorageClient: STORAGE_PROVIDER=local is not yet implemented.");
  }
  getFileUrl(): string {
    throw new Error("StorageClient: STORAGE_PROVIDER=local is not yet implemented.");
  }
}

let cachedClient: StorageClient | null = null;

export function getStorageClient(): StorageClient {
  if (cachedClient) return cachedClient;

  const provider = process.env.STORAGE_PROVIDER ?? "azurite";

  if (provider === "azurite") {
    const connectionString = process.env.AZURITE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error(
        "STORAGE_PROVIDER=azurite but AZURITE_CONNECTION_STRING is not set."
      );
    }
    const serviceClient = BlobServiceClient.fromConnectionString(connectionString);
    cachedClient = new AzureBlobStorageClient(serviceClient);
    return cachedClient;
  }

  if (provider === "azure-blob") {
    const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
    if (!accountUrl) {
      throw new Error(
        "STORAGE_PROVIDER=azure-blob but AZURE_STORAGE_ACCOUNT_URL is not set."
      );
    }
    const credential = new DefaultAzureCredential();
    const serviceClient = new BlobServiceClient(accountUrl, credential);
    cachedClient = new AzureBlobStorageClient(serviceClient);
    return cachedClient;
  }

  if (provider === "local") {
    cachedClient = new LocalStorageClient();
    return cachedClient;
  }

  throw new Error("Unknown STORAGE_PROVIDER: " + provider);
}

export function __resetStorageClientForTests(): void {
  cachedClient = null;
}