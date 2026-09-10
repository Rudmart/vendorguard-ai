/**
 * apps/api/src/evidenceExtraction.ts
 *
 * Extracts real text from uploaded evidence documents and saves it as
 * EvidenceChunk records, so the AI analysis (evidenceAnalysis.ts) has
 * real content to work with instead of the placeholder fallback.
 *
 * PDF only for now -- Word/Excel extraction is a planned follow-up.
 *
 * Uses pdf-parse's simple whole-document extraction (not the per-page
 * pagerender hook, which proved fragile against pdf.js's lower-level
 * rendering internals on some real-world PDFs). Text is chunked by
 * size instead of by page -- EvidenceChunk.page is optional, so this
 * is a valid, simpler, more robust approach.
 */

import { createHash } from "node:crypto";
import { prisma } from "@vendorguard/database";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const CHUNK_SIZE_CHARS = 2000;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }
  return chunks;
}

export async function extractAndSaveEvidenceChunks(params: {
  tenantId: string;
  documentId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<{ chunksCreated: number }> {
  if (params.mimeType !== "application/pdf") {
    return { chunksCreated: 0 };
  }

  const parsed = await pdfParse(params.buffer);
  const fullText = parsed.text.trim();

  if (!fullText) {
    return { chunksCreated: 0 };
  }

  const textChunks = chunkText(fullText, CHUNK_SIZE_CHARS);

  let chunkIndex = 0;
  for (const chunkContent of textChunks) {
    const trimmed = chunkContent.trim();
    if (!trimmed) continue;

    await prisma.evidenceChunk.create({
      data: {
        tenantId: params.tenantId,
        documentId: params.documentId,
        chunkIndex,
        page: null,
        section: null,
        text: trimmed,
        contentHash: sha256Hex(trimmed),
      },
    });
    chunkIndex++;
  }

  return { chunksCreated: chunkIndex };
}