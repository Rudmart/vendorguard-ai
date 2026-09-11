"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";

type Evidence = {
  id: string;
  displayFilename: string;
  documentType: string;
  state: string;
  sizeBytes: number;
  expirationDate: string | null;
  createdAt: string;
};

export default function EvidenceLibraryPage() {
  const params = useParams();
  const vendorId = params.id as string;
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("");
  const [expiration, setExpiration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/evidence`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      setEvidence(data.evidence);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [vendorId]);

  async function handleUpload() {
    setUploadError("");
    if (!selectedFile || !docType) {
      setUploadError("Please choose a file and enter a document type.");
      return;
    }
    setSubmitting(true);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("documentType", docType);
    if (expiration) {
      formData.append("expirationDate", expiration);
    }

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/evidence/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      setUploadError(err.error || "Upload failed");
      setSubmitting(false);
      return;
    }

    setSelectedFile(null);
    setDocType("");
    setExpiration("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    await load();
    setSubmitting(false);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Evidence Library</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {evidence.length} documents on record
      </p>

      <div
        style={{
          background: "#1a2340",
          border: "1px solid #2e3d63",
          borderRadius: 10,
          padding: 18,
          marginBottom: 24,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Upload Evidence</div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          style={{ width: "100%", color: "#e5e9f0", fontSize: 13, marginBottom: 10 }}
        />
        <div style={{ color: "#8b96ac", fontSize: 11, marginBottom: 12 }}>
          PDF, Word, or Excel &middot; up to 25 MB
        </div>

        <input
          placeholder="Document type (e.g. SOC 2 report)"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          style={{ width: "100%", background: "#141b2d", border: "1px solid #2e3d63", borderRadius: 8, padding: "8px 12px", color: "#e5e9f0", fontSize: 13, marginBottom: 10 }}
        />
        <input
          type="date"
          placeholder="Expiration date (optional)"
          value={expiration}
          onChange={(e) => setExpiration(e.target.value)}
          style={{ width: "100%", background: "#141b2d", border: "1px solid #2e3d63", borderRadius: 8, padding: "8px 12px", color: "#e5e9f0", fontSize: 13, marginBottom: 12 }}
        />

        {uploadError && (
          <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{uploadError}</div>
        )}

        <button
          onClick={handleUpload}
          disabled={submitting}
          style={{
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Uploading..." : "Upload Evidence"}
        </button>
      </div>

      {loading ? (
        <p style={{ color: "#8b96ac" }}>Loading...</p>
      ) : evidence.length === 0 ? (
        <p style={{ color: "#8b96ac" }}>No evidence on record yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {evidence.map((e) => (
            <div
              key={e.id}
              onClick={() => window.open(`${process.env.NEXT_PUBLIC_API_URL}/evidence/${e.id}/download`, "_blank")}
              style={{
                cursor: "pointer",
                background: "#1a2340",
                border: "1px solid #2e3d63",
                borderRadius: 10,
                padding: "14px 18px",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{e.displayFilename}</div>
              <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 4 }}>
                {e.documentType} &middot; {e.state} &middot; {formatSize(e.sizeBytes)}
                {e.expirationDate && ` \u00b7 Expires ${new Date(e.expirationDate).toLocaleDateString()}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}